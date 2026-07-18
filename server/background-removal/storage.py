#!/usr/bin/env python3
"""Garde-fous de stockage privé pour les images de cards F.A.T."""
from __future__ import annotations

import time
from pathlib import Path


MAX_IMAGE_BYTES = 102_400
DEFAULT_OWNER_QUOTA_BYTES = 2 * 1024 * 1024
DEFAULT_ORPHAN_GRACE_SECONDS = 7 * 24 * 60 * 60


class StorageRejected(RuntimeError):
    """Refus applicatif sans écriture partielle."""


def enforce_owner_quota(
    active_bytes: int,
    retained_bytes: int,
    incoming_bytes: int,
    *,
    quota_bytes: int = DEFAULT_OWNER_QUOTA_BYTES,
) -> int:
    """Compte image active, restauration différée et nouvelle image ensemble."""
    values = (active_bytes, retained_bytes, incoming_bytes, quota_bytes)
    if any(not isinstance(value, int) or value < 0 for value in values):
        raise StorageRejected("compteurs de quota invalides")
    if incoming_bytes == 0 or incoming_bytes > MAX_IMAGE_BYTES:
        raise StorageRejected("taille de l'image finale invalide")
    total = active_bytes + retained_bytes + incoming_bytes
    if total > quota_bytes:
        raise StorageRejected("quota de stockage dépassé")
    return total


def orphaned_webps(
    directory: Path,
    referenced_names: set[str],
    *,
    now: float | None = None,
    grace_seconds: int = DEFAULT_ORPHAN_GRACE_SECONDS,
) -> list[Path]:
    """Retourne seulement les WebP non référencés dont le délai est expiré."""
    if grace_seconds < 0:
        raise StorageRejected("délai de restauration invalide")
    clock = time.time() if now is None else now
    candidates: list[Path] = []
    if not directory.exists():
        return candidates
    for path in directory.iterdir():
        if (
            not path.is_file()
            or path.is_symlink()
            or path.suffix.lower() != ".webp"
            or path.name in referenced_names
        ):
            continue
        if clock - path.stat().st_mtime >= grace_seconds:
            candidates.append(path)
    return sorted(candidates, key=lambda path: path.name)


def delete_orphaned_webps(
    directory: Path,
    referenced_names: set[str],
    *,
    now: float | None = None,
    grace_seconds: int = DEFAULT_ORPHAN_GRACE_SECONDS,
) -> list[str]:
    """Supprime les seuls orphelins expirés et renvoie les noms supprimés."""
    removed: list[str] = []
    for path in orphaned_webps(
        directory,
        referenced_names,
        now=now,
        grace_seconds=grace_seconds,
    ):
        path.unlink()
        removed.append(path.name)
    return removed
