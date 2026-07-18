#!/usr/bin/env python3
"""Benchmark privé d'un modèle rembg, sans persister les photos ni les masques."""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import threading
import time
from pathlib import Path

import worker


def resident_bytes() -> int:
    if os.name == "nt":
        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        get_process = ctypes.windll.kernel32.GetCurrentProcess
        get_process.restype = ctypes.c_void_p
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = (ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong)
        get_memory.restype = ctypes.c_int
        handle = get_process()
        if get_memory(handle, ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize)
        return 0
    try:
        pages = int(Path("/proc/self/statm").read_text().split()[1])
        return pages * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError):
        return 0


class PeakMemory:
    def __init__(self):
        self.peak = resident_bytes()
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self):
        while not self.stopped.wait(0.05):
            self.peak = max(self.peak, resident_bytes())

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.stopped.set()
        self.thread.join(timeout=1)
        self.peak = max(self.peak, resident_bytes())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    args = parser.parse_args()

    worker.configure_threads()
    from rembg import new_session
    fixtures = sorted(
        path for path in args.fixtures.iterdir()
        if path.is_file() and path.suffix.lower() in worker.ALLOWED_EXTENSIONS
    )
    if len(fixtures) != 3:
        raise SystemExit(f"trois fixtures attendues, {len(fixtures)} trouvées")

    started = time.perf_counter()
    with PeakMemory() as memory:
        session_started = time.perf_counter()
        session = new_session(args.model)
        session_seconds = time.perf_counter() - session_started
        images = []
        for fixture in fixtures:
            image = worker.decode_source(fixture, fixture.suffix.lower())
            inference_started = time.perf_counter()
            mask = worker.extract_mask(image, session)
            image, cleaned, geometry, rotation_degrees = worker.normalize_subject_orientation(image, mask)
            images.append({
                "name": fixture.name,
                "seconds": round(time.perf_counter() - inference_started, 3),
                "geometry": {
                    "foreground_ratio": round(geometry.foreground_ratio, 4),
                    "bbox": geometry.bbox,
                    "bbox_ratio": round(geometry.bbox_ratio, 3),
                    "components": geometry.components,
                    "removed_components": geometry.removed_components,
                },
                "alpha_bbox": cleaned.getbbox(),
                "rotation_degrees": rotation_degrees,
            })
    model_path = Path(os.getenv("U2NET_HOME", Path.home() / ".u2net")) / f"{args.model}.onnx"
    print(json.dumps({
        "model": args.model,
        "model_bytes": model_path.stat().st_size if model_path.exists() else None,
        "session_seconds": round(session_seconds, 3),
        "total_seconds": round(time.perf_counter() - started, 3),
        "peak_rss_bytes": memory.peak,
        "images": images,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
