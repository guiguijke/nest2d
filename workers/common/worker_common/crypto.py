"""
Zero-knowledge vault crypto — mirrors server/utils/crypto.js exactly.

File format (identical wire format as the Node server):
    frame[i] = nonce (12 bytes) || ciphertext || GCM tag (16 bytes)
    AAD      = "{fileId}|{ownerId}|{frameIndex}"
Each frame encrypts up to PLAINTEXT_BLOCK bytes, so frames have a fixed size
(12 + PLAINTEXT_BLOCK + 16) except the last one.

DEK delivery (D-PRV-7, see docs/THREAT-MODEL.md §4): the DEK is NEVER
persisted anymore — the session_keys collection and the master-key wrap are
gone. At job claim the worker generates an ephemeral ECDH P-256 keypair
(RAM only) and writes the public key on the claimed doc (`workerKeyPub`);
the app server then answers POST {NEST_APP_URL}/api/security/vault/job-dek
with its own ephemeral public key and the DEK parcelled under a transport
key derived from the ECDH shared secret:

    shared       = ECDH(workerPriv, serverPub)                (32 bytes)
    transportKey = HKDF-SHA256(ikm=shared, salt=32 zero bytes,
                               info=b"nest2d-job-dek-v1", length=32)
    parcel       = base64( nonce(12) || AES-256-GCM(transportKey, DEK,
                               AAD=jobSlug) || tag(16) )

The DEK is cached in a wipeable bytearray for the duration of the job and
wiped (plus `workerKeyPub` unset) at the end of the job, success or failure.

⚠️ The file format must stay mirrored in server/utils/crypto.js and
re-validated with the interop vectors in scripts/crypto-interop/.
"""

import base64
import hashlib
import json
import logging
import os
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PLAINTEXT_BLOCK = 256 * 1024
NONCE_SIZE = 12
TAG_SIZE = 16
FRAME_SIZE = NONCE_SIZE + PLAINTEXT_BLOCK + TAG_SIZE
ENC_FLAG = {"v": 1, "algo": "aes-256-gcm"}

_JOB_DEK_PATH = "/api/security/vault/job-dek"
_TRANSPORT_INFO = b"nest2d-job-dek-v1"
# Explicit 32 zero bytes — never salt=None, the JS side derives with the
# same explicit salt and HKDF treats None as zeros only by convention.
_TRANSPORT_SALT = b"\x00" * 32

logger = logging.getLogger(__name__)


class VaultLockedError(Exception):
    """The user's vault is locked (the app answered 409: no active RAM
    session for the job owner — e.g. the session expired mid-queue)."""


def fingerprint_key(dek: bytes) -> str:
    """SHA-256 hex of the DEK — miroir de fingerprintKey côté Node
    (server/utils/crypto.js), consommé par scripts/crypto-interop/
    verify_vector.py (champ dek_fingerprint des vecteurs)."""
    return hashlib.sha256(dek).hexdigest()


def _aad(file_id: str, owner_id: str, frame_index: int) -> bytes:
    return f"{file_id}|{owner_id}|{frame_index}".encode("utf-8")


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


# ---------------------------------------------------------------------------
# Per-job DEK delivery (D-PRV-7) — RAM-only module state. The worker daemon
# processes ONE job at a time per process, so a single slot is enough.
# ---------------------------------------------------------------------------
_job_priv_key = None  # ephemeral ECDH P-256 private key of the in-flight job
_job_slug: str | None = None  # slug of the job the state was prepared for
_job_dek: bytearray | None = None  # unwrapped DEK, wipeable


def _reset_job_state() -> None:
    """Zeroes and drops every per-job secret (RAM only, no db access)."""
    global _job_priv_key, _job_slug, _job_dek
    if _job_dek is not None:
        _job_dek[:] = b"\x00" * len(_job_dek)
    _job_dek = None
    _job_priv_key = None
    _job_slug = None


def prepare_job_dek(db, collection_name: str, doc: dict) -> bool:
    """Claim-time vault setup (D-PRV-7). Call once per claimed job.

    Returns False on the plaintext path (doc without owner, or owner's vault
    not enabled) — NO HTTP call is ever made in that case. On the vault path,
    generates the ephemeral ECDH P-256 keypair (the private key stays in
    module RAM) and writes the public key (base64 X9.62 uncompressed point)
    as `workerKeyPub` on the claimed doc, for the app server to ECDH against.
    """
    # A crash must never leak a previous job's DEK into the next one (the
    # loop normally wipes in its finally, this is the belt-and-braces reset).
    _reset_job_state()
    owner_id = doc.get("ownerId")
    if not owner_id:
        return False
    user = db["users"].find_one({"id": owner_id}, {"encryption.enabled": 1})
    if not user or not (user.get("encryption") or {}).get("enabled"):
        return False
    slug = doc.get("slug")
    if not slug:
        # The slug is the parcel AAD — without it the DEK cannot be unwrapped,
        # and silently falling back to plaintext would break the vault promise.
        raise ValueError("Vault-enabled job doc has no slug (needed as parcel AAD)")
    global _job_priv_key, _job_slug
    priv = ec.generate_private_key(ec.SECP256R1())
    pub_b64 = base64.b64encode(
        priv.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
    ).decode("ascii")
    _job_priv_key = priv
    _job_slug = slug
    db[collection_name].update_one(
        {"_id": doc["_id"]}, {"$set": {"workerKeyPub": pub_b64}}
    )
    return True


def _post_job_dek(app_url: str, job_slug: str) -> dict:
    """POSTs the job-dek request to the app server. Stdlib urllib only —
    workers carry no HTTP client dependency."""
    payload = json.dumps({"jobSlug": job_slug}).encode("utf-8")
    request = urllib.request.Request(
        app_url.rstrip("/") + _JOB_DEK_PATH,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 409:
            raise VaultLockedError(
                f"Vault is locked for job '{job_slug}' (no active session)"
            ) from e
        raise


def get_dek(db, doc: dict):
    """Returns the job owner's DEK on the vault path, None on the plaintext
    path (vault not enabled / not prepared for this doc).

    The first call fetches the DEK from the app (ECDH parcel, see module
    header) and caches it in a wipeable bytearray for the rest of the job.
    Raises VaultLockedError when the app answers 409 (vault locked, session
    expired mid-queue). `db` is kept for call-site compatibility — the DEK
    is never read from Mongo anymore (D-PRV-7).
    """
    global _job_dek
    if _job_priv_key is None or _job_slug is None or doc.get("slug") != _job_slug:
        return None
    if _job_dek is not None:
        return bytes(_job_dek)
    app_url = os.environ.get("NEST_APP_URL")
    if not app_url:
        raise RuntimeError(
            "NEST_APP_URL is not configured: cannot fetch the job DEK from the app"
        )
    body = _post_job_dek(app_url, _job_slug)
    server_pub = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), base64.b64decode(body["serverPub"])
    )
    shared = _job_priv_key.exchange(ec.ECDH(), server_pub)
    transport_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_TRANSPORT_SALT,
        info=_TRANSPORT_INFO,
    ).derive(shared)
    parcel = base64.b64decode(body["parcel"])
    nonce, ct = parcel[:NONCE_SIZE], parcel[NONCE_SIZE:]
    dek = AESGCM(transport_key).decrypt(nonce, ct, _job_slug.encode("utf-8"))
    _job_dek = bytearray(dek)
    return bytes(_job_dek)


def wipe_job_dek(db, collection_name: str, doc_id) -> None:
    """End-of-job cleanup: zeroes the DEK buffer, drops the ephemeral private
    key and unsets `workerKeyPub` on the job doc. Never raises — cleanup must
    not mask the job's real outcome."""
    try:
        _reset_job_state()
        if db is not None and doc_id is not None:
            db[collection_name].update_one(
                {"_id": doc_id}, {"$unset": {"workerKeyPub": ""}}
            )
    except Exception as e:
        logger.error(f"Failed to wipe job DEK state: {e}")


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
