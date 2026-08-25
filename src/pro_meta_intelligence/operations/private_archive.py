"""Authenticated, compressed rolling state for a hosted private OE archive."""

from __future__ import annotations

import base64
import hashlib
import io
import os
import shutil
import struct
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from pro_meta_intelligence.sources import SnapshotArchive

SOURCE_ID = "oracles-elixir-match-data"
MAGIC = b"PMIOEA01"
CHUNK_SIZE = 4 * 1024 * 1024
NONCE_PREFIX_SIZE = 8
TAG_SIZE = 16
HEADER_SIZE = len(MAGIC) + NONCE_PREFIX_SIZE + 4
MAX_SOURCE_FILES = 2048
MAX_SOURCE_BYTES = 8 * 1024 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_ZSTD_WINDOW_BYTES = 256 * 1024 * 1024


class PrivateArchiveError(RuntimeError):
    """Raised when encrypted archive state is invalid or cannot be safely restored."""


def pack_private_oe_archive(
    archive_dir: Path,
    output: Path,
    *,
    key_environment_variable: str,
) -> dict[str, Any]:
    """Validate, stream-compress, and authenticate the private OE archive."""

    AESGCM, zstandard = _hosted_dependencies()
    key = _load_key(key_environment_variable)
    inspection = SnapshotArchive(archive_dir).inspect(SOURCE_ID)
    if inspection.issues:
        codes = sorted({issue.code for issue in inspection.issues})
        raise PrivateArchiveError(f"source archive integrity failed: {', '.join(codes)}")
    if not inspection.snapshots:
        raise PrivateArchiveError("source archive has no verified OE snapshots")
    source_dir = archive_dir.resolve() / SOURCE_ID
    if not source_dir.is_dir():
        raise PrivateArchiveError("verified source archive directory is missing")
    if output.exists():
        raise FileExistsError(f"encrypted archive output already exists: {output}")
    files = [path for path in source_dir.rglob("*") if path.is_file()]
    source_byte_count = sum(path.stat().st_size for path in files)
    if len(files) > MAX_SOURCE_FILES:
        raise PrivateArchiveError("source archive exceeds the bounded file-count limit")
    if source_byte_count > MAX_SOURCE_BYTES:
        raise PrivateArchiveError("source archive exceeds the bounded byte-size limit")

    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with temporary.open("wb") as encrypted_handle:
            encryptor = _ChunkEncryptor(encrypted_handle, AESGCM(key))
            parameters = zstandard.ZstdCompressionParameters.from_level(
                10,
                window_log=27,
                enable_ldm=True,
                threads=-1,
            )
            compressor = zstandard.ZstdCompressor(compression_params=parameters)
            with compressor.stream_writer(encryptor, closefd=False) as compressed_handle:
                with tarfile.open(fileobj=compressed_handle, mode="w|") as archive:
                    archive.add(
                        source_dir,
                        arcname=SOURCE_ID,
                        recursive=True,
                        filter=_normalized_tar_info,
                    )
            encryptor.finalize()
            encrypted_handle.flush()
            os.fsync(encrypted_handle.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)

    return {
        "schema_version": "1",
        "artifact_type": "encrypted-private-oe-archive",
        "source_id": SOURCE_ID,
        "snapshot_count": len(inspection.snapshots),
        "unique_content_count": len({item.content_hash for item in inspection.snapshots}),
        "source_file_count": len(files),
        "source_byte_count": source_byte_count,
        "encrypted_byte_count": output.stat().st_size,
        "encrypted_content_hash": _file_sha256(output),
        "compression": "ZSTANDARD_LEVEL_10_LONG_DISTANCE_128M_WINDOW",
        "encryption": "AES_256_GCM_AUTHENTICATED_CHUNKS",
        "key_source": f"ENVIRONMENT:{key_environment_variable}",
        "raw_rows_in_output": False,
    }


def restore_private_oe_archive(
    encrypted_input: Path,
    archive_dir: Path,
    *,
    key_environment_variable: str,
) -> dict[str, Any]:
    """Authenticate and restore one private OE archive into a new empty target."""

    AESGCM, zstandard = _hosted_dependencies()
    key = _load_key(key_environment_variable)
    if not encrypted_input.is_file():
        raise FileNotFoundError(f"encrypted archive input is missing: {encrypted_input}")
    if archive_dir.exists():
        raise FileExistsError(f"restore target must not already exist: {archive_dir}")
    archive_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{archive_dir.name}.restore-", dir=archive_dir.parent))
    try:
        with encrypted_input.open("rb") as encrypted_handle:
            decryptor = _ChunkDecryptReader(encrypted_handle, AESGCM(key))
            decompressor = zstandard.ZstdDecompressor(max_window_size=MAX_ZSTD_WINDOW_BYTES)
            with decompressor.stream_reader(decryptor) as decompressed_handle:
                with tarfile.open(fileobj=decompressed_handle, mode="r|") as archive:
                    _extract_safe_archive(archive, staging)
        inspection = SnapshotArchive(staging).inspect(SOURCE_ID)
        if inspection.issues:
            codes = sorted({issue.code for issue in inspection.issues})
            raise PrivateArchiveError(f"restored archive integrity failed: {', '.join(codes)}")
        if not inspection.snapshots:
            raise PrivateArchiveError("restored archive has no verified OE snapshots")
        os.replace(staging, archive_dir)
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    return {
        "schema_version": "1",
        "artifact_type": "restored-private-oe-archive",
        "source_id": SOURCE_ID,
        "snapshot_count": len(inspection.snapshots),
        "unique_content_count": len({item.content_hash for item in inspection.snapshots}),
        "encrypted_byte_count": encrypted_input.stat().st_size,
        "encrypted_content_hash": _file_sha256(encrypted_input),
        "authenticated": True,
        "key_source": f"ENVIRONMENT:{key_environment_variable}",
    }


def _hosted_dependencies():
    try:
        import zstandard
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as error:
        raise PrivateArchiveError(
            'private archive operations require: pip install -e ".[hosted-ops]"'
        ) from error
    return AESGCM, zstandard


def _load_key(environment_variable: str) -> bytes:
    if not environment_variable or environment_variable.strip() != environment_variable:
        raise ValueError("key environment variable name must be non-empty and trimmed")
    encoded = os.environ.get(environment_variable)
    if not encoded:
        raise PrivateArchiveError(f"required archive key is missing: {environment_variable}")
    try:
        key = base64.urlsafe_b64decode(encoded.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise PrivateArchiveError("archive key is not valid URL-safe base64") from error
    if len(key) != 32:
        raise PrivateArchiveError("archive key must decode to exactly 32 bytes")
    return key


class _ChunkEncryptor:
    def __init__(self, handle: BinaryIO, cipher) -> None:
        self.handle = handle
        self.cipher = cipher
        self.header = MAGIC + os.urandom(NONCE_PREFIX_SIZE) + struct.pack(">I", CHUNK_SIZE)
        self.nonce_prefix = self.header[len(MAGIC) : len(MAGIC) + NONCE_PREFIX_SIZE]
        self.buffer = bytearray()
        self.index = 0
        self.finalized = False
        self.handle.write(self.header)

    def write(self, data: bytes | bytearray | memoryview) -> int:
        if self.finalized:
            raise ValueError("cannot write after encrypted archive finalization")
        payload = bytes(data)
        self.buffer.extend(payload)
        while len(self.buffer) >= CHUNK_SIZE:
            chunk = bytes(self.buffer[:CHUNK_SIZE])
            del self.buffer[:CHUNK_SIZE]
            self._write_frame(chunk, final=False)
        return len(payload)

    def flush(self) -> None:
        self.handle.flush()

    def finalize(self) -> None:
        if self.finalized:
            return
        if self.buffer:
            self._write_frame(bytes(self.buffer), final=False)
            self.buffer.clear()
        self._write_frame(b"", final=True)
        self.finalized = True

    def _write_frame(self, plaintext: bytes, *, final: bool) -> None:
        if self.index >= 2**32:
            raise PrivateArchiveError("encrypted archive exceeded the chunk counter limit")
        index_bytes = struct.pack(">I", self.index)
        nonce = self.nonce_prefix + index_bytes
        aad = self.header + index_bytes + (b"F" if final else b"D")
        ciphertext = self.cipher.encrypt(nonce, plaintext, aad)
        self.handle.write(struct.pack(">I", len(plaintext)))
        self.handle.write(ciphertext)
        self.index += 1


class _ChunkDecryptReader(io.RawIOBase):
    def __init__(self, handle: BinaryIO, cipher) -> None:
        self.handle = handle
        self.cipher = cipher
        self.header = _read_exact(handle, HEADER_SIZE)
        if self.header[: len(MAGIC)] != MAGIC:
            raise PrivateArchiveError("encrypted archive magic/version is invalid")
        self.nonce_prefix = self.header[len(MAGIC) : len(MAGIC) + NONCE_PREFIX_SIZE]
        configured_chunk_size = struct.unpack(">I", self.header[-4:])[0]
        if configured_chunk_size != CHUNK_SIZE:
            raise PrivateArchiveError("encrypted archive chunk size is unsupported")
        self.index = 0
        self.buffer = bytearray()
        self.finished = False

    def readable(self) -> bool:
        return True

    def readinto(self, destination) -> int:
        data = self.read(len(destination))
        destination[: len(data)] = data
        return len(data)

    def read(self, size: int = -1) -> bytes:
        if size == 0:
            return b""
        while not self.finished and (size < 0 or len(self.buffer) < size):
            self._read_frame()
        if size < 0:
            result = bytes(self.buffer)
            self.buffer.clear()
            return result
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def _read_frame(self) -> None:
        if self.index >= 2**32:
            raise PrivateArchiveError("encrypted archive exceeded the chunk counter limit")
        length = struct.unpack(">I", _read_exact(self.handle, 4))[0]
        if length > CHUNK_SIZE:
            raise PrivateArchiveError("encrypted archive frame exceeds the configured chunk size")
        ciphertext = _read_exact(self.handle, length + TAG_SIZE)
        index_bytes = struct.pack(">I", self.index)
        nonce = self.nonce_prefix + index_bytes
        final = length == 0
        aad = self.header + index_bytes + (b"F" if final else b"D")
        try:
            plaintext = self.cipher.decrypt(nonce, ciphertext, aad)
        except Exception as error:
            raise PrivateArchiveError("encrypted archive authentication failed") from error
        self.index += 1
        if final:
            if self.handle.read(1):
                raise PrivateArchiveError("encrypted archive has trailing bytes after final frame")
            self.finished = True
        else:
            self.buffer.extend(plaintext)


def _extract_safe_archive(archive: tarfile.TarFile, staging: Path) -> None:
    root = staging.resolve()
    saw_source_root = False
    file_count = 0
    restored_bytes = 0
    for member in archive:
        path = PurePosixPath(member.name)
        if path.is_absolute() or not path.parts or path.parts[0] != SOURCE_ID:
            raise PrivateArchiveError("private archive member escaped the expected source root")
        if any(part in {"", ".", ".."} for part in path.parts):
            raise PrivateArchiveError("private archive member contains an unsafe path segment")
        if member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
            raise PrivateArchiveError("private archive contains an unsupported member type")
        if member.size < 0 or member.size > MAX_MEMBER_BYTES:
            raise PrivateArchiveError("private archive member exceeds the bounded byte-size limit")
        target = (staging / Path(*path.parts)).resolve()
        if root not in target.parents and target != root:
            raise PrivateArchiveError("private archive member escaped the restore directory")
        saw_source_root = saw_source_root or path.parts[0] == SOURCE_ID
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        file_count += 1
        restored_bytes += member.size
        if file_count > MAX_SOURCE_FILES:
            raise PrivateArchiveError("private archive exceeds the bounded file-count limit")
        if restored_bytes > MAX_SOURCE_BYTES:
            raise PrivateArchiveError("private archive exceeds the bounded total byte-size limit")
        target.parent.mkdir(parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise PrivateArchiveError("private archive file member has no readable content")
        with source, target.open("xb") as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)
    if not saw_source_root:
        raise PrivateArchiveError("private archive did not contain the expected source root")


def _normalized_tar_info(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = 0
    info.mode = 0o755 if info.isdir() else 0o600
    return info


def _read_exact(handle: BinaryIO, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = handle.read(size - len(chunks))
        if not chunk:
            raise PrivateArchiveError("encrypted archive ended before a complete frame")
        chunks.extend(chunk)
    return bytes(chunks)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"
