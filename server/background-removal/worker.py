#!/usr/bin/env python3
"""Détourage local et asynchrone des photos de répliques F.A.T."""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
import time
from pathlib import Path

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
# Pillow expose certains JPEG de smartphone multivues comme MPO. Le serveur
# les reçoit néanmoins avec un MIME image/jpeg ; seule la première vue est
# utilisée après décodage et normalisation EXIF.
ALLOWED_IMAGE_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}
MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 36_000_000


def safe_name(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return f"{digest.hexdigest()[:24]}.webp"


def claim_candidate(source: Path) -> tuple[Path, str]:
    """Déplace atomiquement un job sans perdre son extension d’origine."""
    original_suffix = source.suffix.lower()
    if original_suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"format refusé: {source.name}")
    working = source.with_name(f"{source.name}.processing")
    source.rename(working)
    return working, original_suffix


def process_one(source: Path, original_suffix: str, destination: Path, session) -> Path:
    if original_suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"format refusé: {source.name}")
    size = source.stat().st_size
    if size <= 0 or size > MAX_BYTES:
        raise ValueError(f"taille refusée: {source.name}")

    from PIL import Image, ImageOps
    from rembg import remove

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with Image.open(source) as opened:
        if opened.format not in ALLOWED_IMAGE_FORMATS:
            raise ValueError(f"contenu image refusé: {source.name}")
        if opened.width * opened.height > MAX_PIXELS:
            raise ValueError(f"dimensions refusées: {source.name}")
        opened.load()
        image = ImageOps.exif_transpose(opened).convert("RGBA")
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        result = remove(image, session=session).convert("RGBA")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            suffix=".webp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
        try:
            result.save(temporary, "WEBP", quality=84, method=6)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    parser.add_argument("--failed", type=Path)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--drain", action="store_true")
    parser.add_argument("--sleep", type=float, default=10)
    args = parser.parse_args()

    try:
        from rembg import new_session
    except ImportError:
        print("rembg n'est pas installé; worker désactivé", file=sys.stderr)
        return 2

    session = new_session(os.getenv("FAT_REMBG_MODEL", "u2netp"))
    args.queue.mkdir(parents=True, exist_ok=True)
    args.public.mkdir(parents=True, exist_ok=True)
    failed_directory = args.failed or args.queue / "failed"
    failed_directory.mkdir(parents=True, exist_ok=True)

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
        destination = args.public / safe_name(source)
        working = source
        try:
            working, original_suffix = claim_candidate(source)
            print(f"traitement {source.name}", flush=True)
            process_one(working, original_suffix, destination, session)
            working.unlink(missing_ok=True)
            print(f"sortie {destination.name}", flush=True)
        except Exception as error:  # un fichier fautif ne doit pas tuer le worker
            failed = failed_directory / f"{source.name}.{int(time.time())}.failed"
            try:
                if working.exists():
                    working.rename(failed)
            except OSError:
                pass
            print(f"échec {source.name}: {type(error).__name__}", file=sys.stderr, flush=True)
        if args.once:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
