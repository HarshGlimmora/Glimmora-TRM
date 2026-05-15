"""Local-filesystem storage adapter.

Files live at `Backend/data/uploads/{user_id}/{document_id}.{ext}`. Per
FILING_FLOW.md §0, this is the v1 storage. Swappable later via a storage
abstraction interface — keep this module's surface small.
"""

from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.config import BACKEND_ROOT


UPLOAD_ROOT = BACKEND_ROOT / "data" / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB (per FILING_FLOW.md §3.3)


@dataclass(frozen=True)
class StoredFile:
    storage_path: str
    sha256: str
    size_bytes: int


class UploadTooLarge(ValueError):
    """Raised when an upload exceeds MAX_UPLOAD_BYTES."""


def _safe_ext(file_name: str) -> str:
    """Return a lowercase extension without the leading dot, stripped of any
    path separators or oddities. Bare files (no extension) return ''.
    """
    name = Path(file_name).name
    suffix = Path(name).suffix.lower().lstrip(".")
    return "".join(c for c in suffix if c.isalnum())[:8]


def save_upload(
    *,
    user_id: str,
    document_id: str,
    file_name: str,
    content: bytes,
) -> StoredFile:
    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadTooLarge(
            f"Upload {len(content)} bytes exceeds maximum {MAX_UPLOAD_BYTES} bytes."
        )

    ext = _safe_ext(file_name)
    user_dir = UPLOAD_ROOT / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    fname = f"{document_id}.{ext}" if ext else document_id
    dest = user_dir / fname
    dest.write_bytes(content)

    sha = hashlib.sha256(content).hexdigest()
    return StoredFile(
        storage_path=str(dest.relative_to(BACKEND_ROOT).as_posix()),
        sha256=sha,
        size_bytes=len(content),
    )


def open_for_download(storage_path: str) -> Path:
    """Resolve a stored relative path back to an absolute path. Raises if the
    resolved path escapes UPLOAD_ROOT — defence in depth against path
    traversal smuggled in via `storage_path`.
    """
    candidate = (BACKEND_ROOT / storage_path).resolve()
    upload_root_resolved = UPLOAD_ROOT.resolve()
    try:
        candidate.relative_to(upload_root_resolved)
    except ValueError as e:
        raise FileNotFoundError("storage_path escapes upload root") from e
    if not candidate.is_file():
        raise FileNotFoundError(str(candidate))
    return candidate


def delete_file(storage_path: str) -> None:
    try:
        path = open_for_download(storage_path)
    except FileNotFoundError:
        return  # already gone — soft-delete behaviour
    path.unlink(missing_ok=True)


def remove_user_dir(user_id: str) -> None:
    """Used by data_retention erasure flow (deferred to later steps)."""
    d = UPLOAD_ROOT / user_id
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)
