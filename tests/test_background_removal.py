from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = ROOT / "server" / "background-removal" / "worker.py"
STORAGE_PATH = ROOT / "server" / "background-removal" / "storage.py"
SPEC = importlib.util.spec_from_file_location("fat_background_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)

STORAGE_SPEC = importlib.util.spec_from_file_location("fat_background_storage", STORAGE_PATH)
storage = importlib.util.module_from_spec(STORAGE_SPEC)
assert STORAGE_SPEC and STORAGE_SPEC.loader
sys.modules[STORAGE_SPEC.name] = storage
STORAGE_SPEC.loader.exec_module(storage)


class BackgroundRemovalTests(unittest.TestCase):
    def horizontal_mask(self, shift: int = 0) -> Image.Image:
        mask = Image.new("L", (900, 540), 0)
        draw = ImageDraw.Draw(mask)
        draw.rounded_rectangle((110 + shift, 225, 760 + shift, 330), radius=18, fill=255)
        draw.rectangle((660 + shift, 205, 735 + shift, 245), fill=220)
        return mask

    def test_geometry_removes_remote_component(self):
        mask = self.horizontal_mask()
        draw = ImageDraw.Draw(mask)
        draw.rectangle((40, 20, 190, 100), fill=255)  # lampe isolée
        cleaned, report = worker.clean_subject_mask(mask)
        alpha = np.asarray(cleaned)
        self.assertEqual(int(alpha[50, 100]), 0)
        self.assertGreater(int(alpha[270, 400]), 0)
        self.assertGreaterEqual(report.removed_components, 1)
        self.assertGreater(report.bbox_ratio, worker.MIN_HORIZONTAL_ASPECT)

    def test_consensus_accepts_small_shift_and_rejects_divergence(self):
        first, _ = worker.clean_subject_mask(self.horizontal_mask())
        second, _ = worker.clean_subject_mask(self.horizontal_mask(6))
        report = worker.compare_masks(first, second)
        self.assertGreater(report.mask_iou, worker.MASK_IOU_MIN)

        vertical = Image.new("L", (900, 540), 0)
        ImageDraw.Draw(vertical).rectangle((420, 40, 500, 500), fill=255)
        with self.assertRaises(worker.ProcessingRejected):
            worker.compare_masks(first, vertical)

    def test_portrait_subject_is_rotated_before_horizontal_validation(self):
        image = Image.new("RGBA", (540, 900), (20, 30, 40, 255))
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((215, 110, 325, 790), radius=18, fill=255)

        oriented, cleaned, report, degrees = worker.normalize_subject_orientation(image, mask)

        self.assertEqual(degrees, 90)
        self.assertEqual(oriented.size, (900, 540))
        self.assertEqual(cleaned.size, oriented.size)
        self.assertGreaterEqual(report.bbox_ratio, worker.MIN_HORIZONTAL_ASPECT)

    def test_crop_encode_and_atomic_verification(self):
        width, height = 1600, 1000
        y, x = np.indices((height, width))
        rgb = np.stack(((x % 251), (y % 241), ((x + y) % 239)), axis=-1).astype(np.uint8)
        image = Image.fromarray(rgb, mode="RGB").convert("RGBA")
        alpha = Image.new("L", image.size, 0)
        ImageDraw.Draw(alpha).rounded_rectangle((130, 330, 1480, 690), radius=35, fill=255)
        cropped = worker.crop_and_resize(image, alpha)
        self.assertLessEqual(cropped.width, worker.MAX_FRAME[0])
        self.assertLessEqual(cropped.height, worker.MAX_FRAME[1])
        encoded = worker.encode_webp(cropped)
        self.assertLessEqual(len(encoded.data), worker.MAX_FINAL_BYTES)
        self.assertEqual(worker.verify_webp(encoded.data), (encoded.width, encoded.height))

        with tempfile.TemporaryDirectory() as directory:
            destination = worker.atomic_write(Path(directory), encoded)
            self.assertTrue(destination.exists())
            self.assertEqual(len(list(Path(directory).glob("*.webp"))), 1)
            self.assertFalse(list(Path(directory).glob("*.tmp")))

    def test_compression_refuses_below_floor(self):
        image = Image.new("RGBA", (1200, 700), (80, 100, 60, 255))
        with mock.patch.object(worker, "_webp_bytes", return_value=b"x" * (worker.MAX_FINAL_BYTES + 1)):
            with self.assertRaises(worker.ProcessingRejected) as raised:
                worker.encode_webp(image)
        self.assertEqual(raised.exception.code, "compression")

    def test_threads_are_bounded(self):
        self.assertEqual(worker.configure_threads(0), 1)
        self.assertEqual(worker.configure_threads(99), 4)

    def test_worker_event_is_atomic_and_contains_no_intermediate(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            job_id = "11111111-1111-4111-8111-111111111111"
            worker.write_event(directory, job_id, {"jobId": job_id, "status": "rejected", "code": "fixture"})
            payload = json.loads((directory / f"{job_id}.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "rejected")
            self.assertFalse(list(directory.glob("*.tmp")))

    def test_mpo_suffix_is_accepted_as_a_real_decoded_format(self):
        self.assertIn(".mpo", worker.ALLOWED_EXTENSIONS)
        self.assertIn("MPO", worker.ALLOWED_IMAGE_FORMATS)

    def test_quota_counts_active_retained_and_incoming_images(self):
        total = storage.enforce_owner_quota(80_000, 40_000, 90_000, quota_bytes=220_000)
        self.assertEqual(total, 210_000)
        with self.assertRaises(storage.StorageRejected):
            storage.enforce_owner_quota(80_000, 40_000, 90_000, quota_bytes=200_000)
        with self.assertRaises(storage.StorageRejected):
            storage.enforce_owner_quota(0, 0, worker.MAX_FINAL_BYTES + 1)

    def test_orphan_cleanup_respects_references_and_restoration_delay(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            referenced = directory / "referenced.webp"
            recent = directory / "recent.webp"
            expired = directory / "expired.webp"
            unrelated = directory / "notes.txt"
            for path in (referenced, recent, expired, unrelated):
                path.write_bytes(b"fixture")
            now = 2_000_000_000.0
            old = now - storage.DEFAULT_ORPHAN_GRACE_SECONDS - 1
            os.utime(referenced, (old, old))
            os.utime(expired, (old, old))
            os.utime(recent, (now, now))

            removed = storage.delete_orphaned_webps(
                directory,
                {referenced.name},
                now=now,
            )

            self.assertEqual(removed, [expired.name])
            self.assertTrue(referenced.exists())
            self.assertTrue(recent.exists())
            self.assertTrue(unrelated.exists())


if __name__ == "__main__":
    unittest.main()
