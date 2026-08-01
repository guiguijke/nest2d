"""
Zero-knowledge vault crypto — mirrors server/utils/crypto.js exactly.

File format (identical wire format as the Node server):
    frame[i] = nonce (12 bytes) || ciphertext || GCM tag (16 bytes)
    AAD      = "{fileId}|{ownerId}|{frameIndex}"
Each frame encrypts up to PLAINTEXT_BLOCK bytes, so frames have a fixed size
(12 + PLAINTEXT_BLOCK + 16) except the last one.

⚠️ Any change must be mirrored in server/utils/crypto.js and re-validated
with the interop vectors in scripts/crypto-interop/.
"""

import base64
import hashlib
import json
import os
from datetime import datetime

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PLAINTEXT_BLOCK = 256 * 1024
NONCE_SIZE = 12
TAG_SIZE = 16
FRAME_SIZE = NONCE_SIZE + PLAINTEXT_BLOCK + TAG_SIZE
ENC_FLAG = {"v": 1, "algo": "aes-256-gcm"}

_WRAP_AAD = b"nest2d-session-key-wrap"


class VaultLockedError(Exception):
    """The user's vault is locked (no active session_keys entry)."""


def _master_key() -> bytes:
    hex_key = os.environ.get("ENCRYPTION_MASTER_KEY", "")
    if len(hex_key) != 64:
        raise RuntimeError(
            "ENCRYPTION_MASTER_KEY is not configured (expected 64 hex chars)"
        )
    return bytes.fromhex(hex_key)


def fingerprint_key(dek: bytes) -> str:
    return hashlib.sha256(dek).hexdigest()


def _aad(file_id: str, owner_id: str, frame_index: int) -> bytes:
    return f"{file_id}|{owner_id}|{frame_index}".encode("utf-8")


def wrap_dek(dek: bytes) -> str:
    nonce = os.urandom(NONCE_SIZE)
    ct = AESGCM(_master_key()).encrypt(nonce, dek, _WRAP_AAD)
    return base64.b64encode(nonce + ct).decode("ascii")


def unwrap_dek(wrapped_b64: str) -> bytes:
    raw = base64.b64decode(wrapped_b64)
    nonce, ct = raw[:NONCE_SIZE], raw[NONCE_SIZE:]
    return AESGCM(_master_key()).decrypt(nonce, ct, _WRAP_AAD)


def encrypt_bytes(dek: bytes, file_id: str, owner_id: str, data: bytes) -> bytes:
    aes = AESGCM(dek)
    out = bytearray()
    for frame_index, off in enumerate(range(0, len(data), PLAINTEXT_BLOCK)):
        nonce = os.urandom(NONCE_SIZE)
        block = data[off : off + PLAINTEXT_BLOCK]
        out += nonce + aes.encrypt(nonce, block, _aad(file_id, owner_id, frame_index))
    return bytes(out)


def decrypt_bytes(dek: bytes, file_id: str, owner_id: str, data: bytes) -> bytes:
    aes = AESGCM(dek)
    out = bytearray()
    frame_index = 0
    off = 0
    while len(data) - off > FRAME_SIZE:
        frame = data[off : off + FRAME_SIZE]
        out += aes.decrypt(
            frame[:NONCE_SIZE], frame[NONCE_SIZE:], _aad(file_id, owner_id, frame_index)
        )
        frame_index += 1
        off += FRAME_SIZE
    if off < len(data):
        frame = data[off:]
        if len(frame) <= NONCE_SIZE + TAG_SIZE:
            raise ValueError("Corrupted encrypted payload: truncated final frame")
        out += aes.decrypt(
            frame[:NONCE_SIZE], frame[NONCE_SIZE:], _aad(file_id, owner_id, frame_index)
        )
    return bytes(out)


def polygon_parts_aad_id(file_slug: str) -> str:
    return f"polygonParts:{file_slug}"


def get_dek(db, user_id: str):
    """Returns the user's unwrapped DEK when a vault session is active."""
    doc = db["session_keys"].find_one(
        {"userId": user_id, "expiresAt": {"$gt": datetime.utcnow()}}
    )
    if not doc:
        return None
    return unwrap_dek(doc["wrappedDek"])


def get_file_metadata(bucket, filename: str):
    """Metadata of the latest GridFS file version (uploadDate desc).

    pymongo's GridFSBucket.find yields GridOut objects (not dicts), hence the
    attribute access.
    """
    grid_out = bucket.find({"filename": filename}).sort("uploadDate", -1).limit(1).next()
    return grid_out.metadata or {}


def read_gridfs(bucket, filename: str, owner_id: str, dek=None) -> bytes:
    """Reads a GridFS file, transparently decrypting when it carries the enc
    flag. Raises VaultLockedError when encrypted but no DEK is available."""
    metadata = get_file_metadata(bucket, filename)
    data = bucket.open_download_stream_by_name(filename).read()
    if metadata.get("enc"):
        if dek is None:
            raise VaultLockedError(f"File '{filename}' is encrypted but the vault is locked")
        return decrypt_bytes(dek, filename, owner_id, data)
    return data


def write_gridfs(bucket, filename: str, data: bytes, owner_id: str, dek=None):
    """Uploads to GridFS, encrypting and flagging when a DEK is provided."""
    metadata = {"ownerId": owner_id}
    if dek is not None:
        metadata["enc"] = ENC_FLAG
        data = encrypt_bytes(dek, filename, owner_id, data)
    bucket.upload_from_stream(filename=filename, source=data, metadata=metadata)


def encrypt_polygon_parts(dek: bytes, file_slug: str, owner_id: str, parts) -> dict:
    """Encrypts polygonParts for storage on the Mongo file doc."""
    plain = json.dumps(parts).encode("utf-8")
    blob = encrypt_bytes(dek, polygon_parts_aad_id(file_slug), owner_id, plain)
    return {"v": 1, "data": base64.b64encode(blob).decode("ascii")}


def decrypt_polygon_parts(dek: bytes, file_slug: str, owner_id: str, blob: dict):
    plain = decrypt_bytes(
        dek,
        polygon_parts_aad_id(file_slug),
        owner_id,
        base64.b64decode(blob["data"]),
    )
    return json.loads(plain.decode("utf-8"))


def resolve_polygon_parts(db, doc: dict, dek=None):
    """Returns polygonParts from a file doc, decrypting the enc blob when
    present. Raises VaultLockedError when encrypted but the vault is locked."""
    blob = doc.get("encPolygonParts")
    if blob:
        if dek is None:
            raise VaultLockedError(
                f"polygonParts of '{doc.get('slug')}' are encrypted but the vault is locked"
            )
        return decrypt_polygon_parts(dek, doc["slug"], doc["ownerId"], blob)
    return doc.get("polygonParts") or []
