#!/usr/bin/env python3
"""Pipeline privé de détourage et d'encodage des répliques F.A.T."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
import os
import signal
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".mpo", ".png", ".webp"}
ALLOWED_IMAGE_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 36_000_000
MAX_FINAL_BYTES = 102_400
MAX_FRAME = (1200, 700)
MIN_FRAME = (720, 420)
WEBP_QUALITIES = (82, 76, 70, 64, 58, 52)
ALPHA_THRESHOLD = 96
MASK_IOU_MIN = 0.56
BBOX_IOU_MIN = 0.68
BBOX_EDGE_DELTA_MAX = 0.12
MIN_HORIZONTAL_ASPECT = 1.35
MIN_FOREGROUND_RATIO = 0.015
MAX_FOREGROUND_RATIO = 0.62
DEFAULT_FAST_MODEL = "u2netp"
DEFAULT_QUALITY_MODEL = "isnet-general-use"
DEFAULT_TIMEOUT_SECONDS = 150


class ProcessingRejected(RuntimeError):
    """Refus attendu : aucun fichier image ne doit survivre à cette erreur."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GeometryReport:
    foreground_ratio: float
    bbox: tuple[int, int, int, int]
    bbox_ratio: float
    bbox_coverage: tuple[float, float]
    edge_contacts: int
    components: int
    removed_components: int


@dataclass(frozen=True)
class ConsensusReport:
    mask_iou: float
    bbox_iou: float
    maximum_edge_delta: float


@dataclass(frozen=True)
class EncodedImage:
    data: bytes
    width: int
    height: int
    quality: int
    sha256: str


@dataclass(frozen=True)
class ProcessedImage:
    path: Path
    bytes: int
    width: int
    height: int
    sha256: str
    quality: int
    rotation_degrees: int
    fast_geometry: GeometryReport
    quality_geometry: GeometryReport
    final_geometry: GeometryReport
    consensus: ConsensusReport


def configure_threads(value: str | int | None = None) -> int:
    requested = value if value is not None else os.getenv("FAT_REMBG_THREADS", "1")
    try:
        threads = int(requested)
    except (TypeError, ValueError):
        threads = 1
    threads = min(4, max(1, threads))
    os.environ["OMP_NUM_THREADS"] = str(threads)
    os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")
    return threads


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def claim_candidate(source: Path) -> tuple[Path, str]:
    """Prend atomiquement un job sans perdre l'extension du fichier reçu."""
    original_suffix = source.suffix.lower()
    if original_suffix not in ALLOWED_EXTENSIONS:
        raise ProcessingRejected("extension", f"format refusé: {source.name}")
    working = source.with_name(f"{source.name}.processing")
    source.rename(working)
    return working, original_suffix


def decode_source(source: Path, original_suffix: str):
    from PIL import Image, ImageOps, ImageStat

    if original_suffix not in ALLOWED_EXTENSIONS:
        raise ProcessingRejected("extension", f"format refusé: {source.name}")
    size = source.stat().st_size
    if size <= 0 or size > MAX_UPLOAD_BYTES:
        raise ProcessingRejected("upload_size", f"taille refusée: {source.name}")

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(source) as opened:
            if opened.format not in ALLOWED_IMAGE_FORMATS:
                raise ProcessingRejected("mime", f"contenu image refusé: {source.name}")
            # Un MPO de smartphone est un JPEG multivue. Seule sa première image
            # est utilisée, conformément au contrat d'upload.
            if getattr(opened, "n_frames", 1) > 1:
                opened.seek(0)
            if opened.width * opened.height > MAX_PIXELS:
                raise ProcessingRejected("pixels", f"dimensions refusées: {source.name}")
            if min(opened.width, opened.height) < 420 or max(opened.width, opened.height) < 720:
                raise ProcessingRejected("resolution", "photo trop petite")
            opened.load()
            normalized = ImageOps.exif_transpose(opened).convert("RGBA")
            # Une nouvelle image ne transporte ni EXIF, ni ICC, ni commentaire.
            image = Image.new("RGBA", normalized.size)
            image.paste(normalized)
    except ProcessingRejected:
        raise
    except Exception as error:
        raise ProcessingRejected("decode", "image indécodable") from error

    contrast = ImageStat.Stat(image.convert("L").resize((128, 128))).stddev[0]
    if contrast < 8:
        raise ProcessingRejected("contrast", "contraste insuffisant")
    return image


def extract_mask(image, session):
    from rembg import remove

    mask = remove(
        image,
        session=session,
        only_mask=True,
        post_process_mask=True,
    )
    return mask.convert("L")


def _bbox_distance(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
    ax0, ay0, ax1, ay1 = first
    bx0, by0, bx1, by1 = second
    dx = max(bx0 - ax1, ax0 - bx1, 0)
    dy = max(by0 - ay1, ay0 - by1, 0)
    return math.hypot(dx, dy)


def _mask_bbox(binary) -> tuple[int, int, int, int]:
    import numpy as np

    ys, xs = np.nonzero(binary)
    if not len(xs):
        raise ProcessingRejected("empty_mask", "masque vide")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _component_table(binary):
    import numpy as np
    from scipy import ndimage

    labels, count = ndimage.label(binary, structure=np.ones((3, 3), dtype=np.uint8))
    if count == 0:
        raise ProcessingRejected("empty_mask", "aucun sujet détecté")
    areas = np.bincount(labels.ravel(), minlength=count + 1)
    objects = ndimage.find_objects(labels)
    components = []
    for label_id, slices in enumerate(objects, 1):
        if slices is None or areas[label_id] == 0:
            continue
        y_slice, x_slice = slices
        components.append({
            "label": label_id,
            "area": int(areas[label_id]),
            "bbox": (x_slice.start, y_slice.start, x_slice.stop, y_slice.stop),
        })
    return labels, components


def clean_subject_mask(mask, *, enforce_horizontal: bool = True):
    """Conserve le sujet dominant et ses petits accessoires réellement proches."""
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    alpha = np.asarray(mask.convert("L"), dtype=np.uint8)
    binary = alpha >= ALPHA_THRESHOLD
    height, width = binary.shape
    labels, components = _component_table(binary)
    total_foreground = max(1, int(binary.sum()))
    center_x0, center_x1 = int(width * 0.25), int(width * 0.75)
    center_y0, center_y1 = int(height * 0.20), int(height * 0.80)
    diagonal = math.hypot(width, height)

    for component in components:
        x0, y0, x1, y1 = component["bbox"]
        box_width = max(1, x1 - x0)
        box_height = max(1, y1 - y0)
        center_intersects = x1 > center_x0 and x0 < center_x1 and y1 > center_y0 and y0 < center_y1
        component_center_x = (x0 + x1) / 2
        component_center_y = (y0 + y1) / 2
        distance = math.hypot(component_center_x - width / 2, component_center_y - height / 2) / diagonal
        horizontal = min(1.0, box_width / box_height / 3)
        component["score"] = (
            0.30 * (component["area"] / total_foreground)
            + 0.27 * (box_width / width)
            + 0.20 * float(center_intersects)
            + 0.15 * horizontal
            + 0.08 * max(0.0, 1.0 - 2 * distance)
        )

    dominant = max(components, key=lambda item: item["score"])
    x0, y0, x1, y1 = dominant["bbox"]
    if not (x1 > center_x0 and x0 < center_x1 and y1 > center_y0 and y0 < center_y1):
        raise ProcessingRejected("off_center", "le sujet principal n'intersecte pas la zone centrale")

    keep_labels = {dominant["label"]}
    proximity_limit = diagonal * 0.045
    for component in components:
        if component is dominant:
            continue
        near = _bbox_distance(dominant["bbox"], component["bbox"]) <= proximity_limit
        small_accessory = component["area"] <= dominant["area"] * 0.08
        if near and small_accessory:
            keep_labels.add(component["label"])

    selected = np.isin(labels, tuple(keep_labels))
    # Le lissage ne dépasse pas un pixel et évite de détruire canon ou crosse.
    selected = ndimage.binary_closing(selected, structure=np.ones((3, 3), dtype=bool), iterations=1)
    filled = ndimage.binary_fill_holes(selected)
    holes = filled & ~selected
    if holes.any():
        hole_labels, hole_count = ndimage.label(holes)
        hole_areas = np.bincount(hole_labels.ravel(), minlength=hole_count + 1)
        tiny_limit = max(4, int(width * height * 0.00015))
        for hole_id in range(1, hole_count + 1):
            if hole_areas[hole_id] <= tiny_limit:
                selected[hole_labels == hole_id] = True

    cleaned = np.where(selected, alpha, 0).astype(np.uint8)
    report = analyze_geometry(
        cleaned,
        removed_components=len(components) - len(keep_labels),
        enforce_horizontal=enforce_horizontal,
    )
    return Image.fromarray(cleaned, mode="L"), report


def analyze_geometry(
    mask,
    removed_components: int = 0,
    *,
    enforce_horizontal: bool = True,
) -> GeometryReport:
    import numpy as np

    alpha = np.asarray(mask, dtype=np.uint8)
    binary = alpha >= ALPHA_THRESHOLD
    height, width = binary.shape
    labels, components = _component_table(binary)
    foreground_ratio = float(binary.mean())
    bbox = _mask_bbox(binary)
    x0, y0, x1, y1 = bbox
    box_width, box_height = x1 - x0, y1 - y0
    bbox_ratio = box_width / max(1, box_height)
    coverage = (box_width / width, box_height / height)
    edge_contacts = sum((x0 <= 0, y0 <= 0, x1 >= width, y1 >= height))
    central = binary[int(height * 0.20):math.ceil(height * 0.80), int(width * 0.25):math.ceil(width * 0.75)]

    if not MIN_FOREGROUND_RATIO <= foreground_ratio <= MAX_FOREGROUND_RATIO:
        raise ProcessingRejected("foreground_ratio", "surface de premier plan incohérente")
    if enforce_horizontal and bbox_ratio < MIN_HORIZONTAL_ASPECT:
        raise ProcessingRejected("orientation", "le sujet n'est pas majoritairement horizontal")
    if coverage[0] > 0.97 and coverage[1] > 0.92:
        raise ProcessingRejected("full_frame", "le masque couvre presque tout le cadre")
    if edge_contacts > 1:
        raise ProcessingRejected("edges", "le sujet touche plusieurs bords")
    if not central.any():
        raise ProcessingRejected("off_center", "le sujet n'intersecte pas la zone centrale")

    significant = [item for item in components if item["area"] >= int(binary.sum() * 0.08)]
    if len(significant) > 1:
        raise ProcessingRejected("multiple_subjects", "plusieurs sujets importants subsistent")
    return GeometryReport(
        foreground_ratio=foreground_ratio,
        bbox=bbox,
        bbox_ratio=bbox_ratio,
        bbox_coverage=coverage,
        edge_contacts=edge_contacts,
        components=len(components),
        removed_components=removed_components,
    )


def normalize_subject_orientation(image, mask):
    """Tourne une prise portrait après sélection, sans réinterpréter la physique du sujet."""
    from PIL import Image

    cleaned, preliminary = clean_subject_mask(mask, enforce_horizontal=False)
    rotation_degrees = 0
    if preliminary.bbox_ratio < 1:
        image = image.transpose(Image.Transpose.ROTATE_90)
        cleaned = cleaned.transpose(Image.Transpose.ROTATE_90)
        rotation_degrees = 90
    report = analyze_geometry(
        cleaned,
        removed_components=preliminary.removed_components,
        enforce_horizontal=True,
    )
    return image, cleaned, report, rotation_degrees


def compare_masks(first, second) -> ConsensusReport:
    import numpy as np

    first_binary = np.asarray(first, dtype=np.uint8) >= ALPHA_THRESHOLD
    second_binary = np.asarray(second, dtype=np.uint8) >= ALPHA_THRESHOLD
    intersection = int(np.logical_and(first_binary, second_binary).sum())
    union = int(np.logical_or(first_binary, second_binary).sum())
    mask_iou = intersection / max(1, union)
    first_bbox = _mask_bbox(first_binary)
    second_bbox = _mask_bbox(second_binary)
    ax0, ay0, ax1, ay1 = first_bbox
    bx0, by0, bx1, by1 = second_bbox
    ix0, iy0, ix1, iy1 = max(ax0, bx0), max(ay0, by0), min(ax1, bx1), min(ay1, by1)
    intersection_box = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    first_box = (ax1 - ax0) * (ay1 - ay0)
    second_box = (bx1 - bx0) * (by1 - by0)
    bbox_iou = intersection_box / max(1, first_box + second_box - intersection_box)
    height, width = first_binary.shape
    maximum_edge_delta = max(
        abs(ax0 - bx0) / width,
        abs(ax1 - bx1) / width,
        abs(ay0 - by0) / height,
        abs(ay1 - by1) / height,
    )
    report = ConsensusReport(mask_iou, bbox_iou, maximum_edge_delta)
    if mask_iou < MASK_IOU_MIN or bbox_iou < BBOX_IOU_MIN or maximum_edge_delta > BBOX_EDGE_DELTA_MAX:
        raise ProcessingRejected("model_disagreement", "les deux modèles ne convergent pas")
    return report


def consensus_alpha(first, second):
    import numpy as np
    from PIL import Image

    first_alpha = np.asarray(first, dtype=np.uint8)
    second_alpha = np.asarray(second, dtype=np.uint8)
    agreed = np.minimum(first_alpha, second_alpha)
    return Image.fromarray(agreed.astype(np.uint8), mode="L")


def crop_and_resize(image, alpha, margin_ratio: float = 0.05):
    from PIL import Image

    thresholded = alpha.point(lambda value: 255 if value >= 8 else 0)
    bbox = thresholded.getbbox()
    if not bbox:
        raise ProcessingRejected("empty_alpha", "alpha final vide")
    x0, y0, x1, y1 = bbox
    margin_x = math.ceil((x1 - x0) * min(0.06, max(0.04, margin_ratio)))
    margin_y = math.ceil((y1 - y0) * min(0.06, max(0.04, margin_ratio)))
    crop_box = (
        max(0, x0 - margin_x),
        max(0, y0 - margin_y),
        min(image.width, x1 + margin_x),
        min(image.height, y1 + margin_y),
    )
    result = image.copy()
    result.putalpha(alpha)
    result = result.crop(crop_box)
    scale = min(1.0, MAX_FRAME[0] / result.width, MAX_FRAME[1] / result.height)
    if scale < 1:
        result = result.resize(
            (max(1, round(result.width * scale)), max(1, round(result.height * scale))),
            Image.Resampling.LANCZOS,
        )
    return result


def _webp_bytes(image, quality: int) -> bytes:
    output = io.BytesIO()
    image.save(output, "WEBP", quality=quality, method=6, exact=True)
    return output.getvalue()


def verify_webp(data: bytes, alpha_expected: bool = True) -> tuple[int, int]:
    from PIL import Image

    if len(data) > MAX_FINAL_BYTES:
        raise ProcessingRejected("final_size", "WebP supérieur à 100 Ko")
    try:
        with Image.open(io.BytesIO(data)) as decoded:
            if decoded.format != "WEBP":
                raise ProcessingRejected("final_format", "sortie non WebP")
            decoded.load()
            if alpha_expected and "A" not in decoded.getbands():
                raise ProcessingRejected("final_alpha", "canal alpha absent")
            return decoded.width, decoded.height
    except ProcessingRejected:
        raise
    except Exception as error:
        raise ProcessingRejected("final_decode", "WebP final indécodable") from error


def encode_webp(image) -> EncodedImage:
    from PIL import Image

    current = image.convert("RGBA")
    while True:
        for quality in WEBP_QUALITIES:
            data = _webp_bytes(current, quality)
            if len(data) <= MAX_FINAL_BYTES:
                width, height = verify_webp(data, alpha_expected=True)
                return EncodedImage(
                    data=data,
                    width=width,
                    height=height,
                    quality=quality,
                    sha256=hashlib.sha256(data).hexdigest(),
                )
        next_width = max(1, round(current.width * 0.9))
        next_height = max(1, round(current.height * 0.9))
        if next_width < MIN_FRAME[0] and next_height < MIN_FRAME[1]:
            raise ProcessingRejected("compression", "plafond de 100 Ko impossible sans dépasser le plancher")
        current = current.resize((next_width, next_height), Image.Resampling.LANCZOS)


def atomic_write(public_directory: Path, encoded: EncodedImage) -> Path:
    public_directory.mkdir(parents=True, exist_ok=True)
    destination = public_directory / f"{encoded.sha256[:24]}.webp"
    with tempfile.NamedTemporaryFile(dir=public_directory, suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(encoded.data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        verify_webp(temporary.read_bytes(), alpha_expected=True)
        os.replace(temporary, destination)
        verify_webp(destination.read_bytes(), alpha_expected=True)
    except Exception:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise
    return destination


@contextlib.contextmanager
def processing_timeout(seconds: int) -> Iterator[None]:
    """Timeout dur sous Unix ; garde également un contrôle de durée portable."""
    seconds = max(1, int(seconds))
    started = time.monotonic()
    previous_handler = None
    alarm_available = hasattr(signal, "SIGALRM") and hasattr(signal, "alarm")

    def timeout_handler(_signum, _frame):
        raise ProcessingRejected("timeout", "temps de traitement dépassé")

    if alarm_available:
        previous_handler = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(seconds)
    try:
        yield
        if time.monotonic() - started > seconds:
            raise ProcessingRejected("timeout", "temps de traitement dépassé")
    finally:
        if alarm_available:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous_handler)


def process_one(
    source: Path,
    original_suffix: str,
    public_directory: Path,
    fast_session,
    quality_session,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> ProcessedImage:
    with processing_timeout(timeout_seconds):
        image = decode_source(source, original_suffix)
        image, fast_mask, fast_geometry, rotation_degrees = normalize_subject_orientation(
            image,
            extract_mask(image, fast_session),
        )
        # Une passe rapide invalide est rejetée avant de payer la seconde inférence.
        quality_mask, quality_geometry = clean_subject_mask(extract_mask(image, quality_session))
        consensus = compare_masks(fast_mask, quality_mask)
        final_alpha = consensus_alpha(fast_mask, quality_mask)
        final_geometry = analyze_geometry(final_alpha)
        cropped = crop_and_resize(image, final_alpha)
        encoded = encode_webp(cropped)
        destination = atomic_write(public_directory, encoded)
        return ProcessedImage(
            path=destination,
            bytes=len(encoded.data),
            width=encoded.width,
            height=encoded.height,
            sha256=encoded.sha256,
            quality=encoded.quality,
            rotation_degrees=rotation_degrees,
            fast_geometry=fast_geometry,
            quality_geometry=quality_geometry,
            final_geometry=final_geometry,
            consensus=consensus,
        )


@contextlib.contextmanager
def single_worker_lock(queue: Path) -> Iterator[None]:
    """Empêche deux workers de consommer simultanément la même file."""
    lock_path = queue / ".fat-rembg.lock"
    handle = lock_path.open("a+b")
    try:
        handle.seek(0)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise RuntimeError("un worker traite déjà cette file") from error
        else:
            import fcntl
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise RuntimeError("un worker traite déjà cette file") from error
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        handle.close()
        lock_path.unlink(missing_ok=True)


def public_result(result: ProcessedImage) -> dict:
    payload = asdict(result)
    payload["path"] = result.path.name
    payload["status"] = "ready"
    payload["mime"] = "image/webp"
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    parser.add_argument("--failed", type=Path, help="obsolète : aucun original rejeté n'est conservé")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--drain", action="store_true")
    parser.add_argument("--sleep", type=float, default=10)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args()

    configure_threads()
    try:
        from rembg import new_session
    except ImportError:
        print("rembg n'est pas installé; worker désactivé", file=sys.stderr)
        return 2

    fast_model = os.getenv("FAT_REMBG_FAST_MODEL", DEFAULT_FAST_MODEL)
    quality_model = os.getenv("FAT_REMBG_QUALITY_MODEL", DEFAULT_QUALITY_MODEL)
    fast_session = new_session(fast_model)
    quality_session = new_session(quality_model)
    args.queue.mkdir(parents=True, exist_ok=True)
    args.public.mkdir(parents=True, exist_ok=True)

    with single_worker_lock(args.queue):
        while True:
            candidates = sorted(
                path for path in args.queue.iterdir()
                if path.is_file() and not path.is_symlink()
                and path.suffix.lower() in ALLOWED_EXTENSIONS
            )
            if not candidates:
                if args.once or args.drain:
                    return 0
                time.sleep(max(1, args.sleep))
                continue

            source = candidates[0]
            working = source
            started = time.monotonic()
            try:
                working, original_suffix = claim_candidate(source)
                result = process_one(
                    working,
                    original_suffix,
                    args.public,
                    fast_session,
                    quality_session,
                    timeout_seconds=args.timeout,
                )
                print(json.dumps({**public_result(result), "seconds": round(time.monotonic() - started, 3)}), flush=True)
            except ProcessingRejected as error:
                print(json.dumps({
                    "status": "rejected",
                    "code": error.code,
                    "message": str(error),
                    "seconds": round(time.monotonic() - started, 3),
                }), file=sys.stderr, flush=True)
            except Exception as error:  # aucun fichier fautif ne doit tuer la file
                print(json.dumps({
                    "status": "rejected",
                    "code": "internal",
                    "message": type(error).__name__,
                    "seconds": round(time.monotonic() - started, 3),
                }), file=sys.stderr, flush=True)
            finally:
                # Succès ou refus : l'upload et le fichier .processing disparaissent.
                working.unlink(missing_ok=True)
                source.unlink(missing_ok=True)
            if args.once:
                return 0


if __name__ == "__main__":
    raise SystemExit(main())
