"""Tests for the D-PRV-7 per-job DEK delivery (worker side).

Wire contract locked here (see docs/THREAT-MODEL.md §4):
  - workerKeyPub = base64 X9.62 uncompressed point (65 bytes, 0x04 prefix)
  - shared = ECDH P-256, transport = HKDF-SHA256(shared, salt=32 zero bytes,
    info=b"nest2d-job-dek-v1", length=32)
  - parcel = base64( nonce(12) || AES-256-GCM(transport, DEK, AAD=jobSlug) )
  - POST {NEST_APP_URL}/api/security/vault/job-dek {"jobSlug": ...}
  - 409 -> VaultLockedError

The fake HTTP server below is played with `cryptography`, exactly like the
Node side does it — the Node<->Python interop vector itself lives in
scripts/crypto-interop/.

Run: PYTHONPATH=workers/common python -m pytest workers/common/tests/test_job_dek.py -q
"""
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

sys.path.insert(0, str(Path(__file__).parent.parent))

import worker_common.crypto as crypto


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.updates = []

    def find_one(self, filter, projection=None, *a, **kw):
        return next(
            (d for d in self.docs if all(d.get(k) == v for k, v in filter.items())),
            None,
        )

    def update_one(self, filter, update, *a, **kw):
        self.updates.append(update)
        doc = next((d for d in self.docs if d.get("_id") == filter.get("_id")), None)
        if doc is None:
            return None
        for k, v in update.get("$set", {}).items():
            doc[k] = v
        for k in update.get("$unset", {}):
            doc.pop(k, None)
        return doc


class FakeDb(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = FakeCollection()
        return dict.__getitem__(self, name)


VAULT_USER = {"id": "u1", "encryption": {"enabled": True}}
JOB_DOC = {"_id": "j1", "slug": "job-1", "ownerId": "u1"}


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    crypto._reset_job_state()
    monkeypatch.setenv("NEST_APP_URL", "http://app.test")
    yield
    crypto._reset_job_state()


def make_db(user=VAULT_USER, doc=JOB_DOC):
    return FakeDb(users=FakeCollection([dict(user)] if user else []),
                  jobs=FakeCollection([dict(doc)]))


def forbid_http(monkeypatch):
    def _boom(*a, **kw):
        raise AssertionError("no HTTP call allowed on the plaintext path")

    monkeypatch.setattr(urllib.request, "urlopen", _boom)


def play_server(monkeypatch, db, dek: bytes, aad_slug: str | None = None):
    """Monkeypatches urllib.request.urlopen with a fake app server: reads the
    workerKeyPub off the job doc (like the real server reads Mongo), runs its
    own ephemeral ECDH pair and parcels the DEK. Returns the request log."""
    requests = []

    def fake_urlopen(request, timeout=0):
        body = json.loads(request.data.decode("utf-8"))
        job_slug = body["jobSlug"]
        requests.append((request.full_url, body, timeout))
        doc = db["jobs"].docs[0]
        worker_pub = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), base64.b64decode(doc["workerKeyPub"])
        )
        server_priv = ec.generate_private_key(ec.SECP256R1())
        shared = server_priv.exchange(ec.ECDH(), worker_pub)
        transport = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"\x00" * 32,
            info=b"nest2d-job-dek-v1",
        ).derive(shared)
        nonce = os.urandom(12)
        parcel = nonce + AESGCM(transport).encrypt(
            nonce, dek, (aad_slug or job_slug).encode("utf-8")
        )
        response = {
            "serverPub": base64.b64encode(
                server_priv.public_key().public_bytes(
                    serialization.Encoding.X962,
                    serialization.PublicFormat.UncompressedPoint,
                )
            ).decode("ascii"),
            "parcel": base64.b64encode(parcel).decode("ascii"),
        }
        return io.BytesIO(json.dumps(response).encode("utf-8"))

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return requests


def test_prepare_without_owner_returns_false_no_http(monkeypatch):
    forbid_http(monkeypatch)
    db = make_db(doc={"_id": "j1", "slug": "job-1"})  # no ownerId
    assert crypto.prepare_job_dek(db, "jobs", db["jobs"].docs[0]) is False
    assert "workerKeyPub" not in db["jobs"].docs[0]
    assert crypto.get_dek(db, db["jobs"].docs[0]) is None


@pytest.mark.parametrize(
    "user",
    [
        None,  # owner unknown
        {"id": "u1"},  # vault never enabled
        {"id": "u1", "encryption": {"enabled": False}},
    ],
)
def test_prepare_without_vault_returns_false_no_http(monkeypatch, user):
    forbid_http(monkeypatch)
    db = make_db(user=user)
    assert crypto.prepare_job_dek(db, "jobs", db["jobs"].docs[0]) is False
    assert "workerKeyPub" not in db["jobs"].docs[0]
    # Plaintext path: get_dek resolves to None without any HTTP call.
    assert crypto.get_dek(db, db["jobs"].docs[0]) is None


def test_prepare_vault_writes_worker_key_pub():
    db = make_db()
    assert crypto.prepare_job_dek(db, "jobs", db["jobs"].docs[0]) is True
    raw = base64.b64decode(db["jobs"].docs[0]["workerKeyPub"])
    # X9.62 uncompressed point: 0x04 prefix, 65 bytes on P-256.
    assert len(raw) == 65 and raw[0] == 0x04


def test_get_dek_round_trip(monkeypatch):
    dek = os.urandom(32)
    db = make_db()
    doc = db["jobs"].docs[0]
    assert crypto.prepare_job_dek(db, "jobs", doc) is True
    requests = play_server(monkeypatch, db, dek)

    got = crypto.get_dek(db, doc)

    assert got == dek
    assert isinstance(got, bytes)
    assert crypto._job_dek == bytearray(dek)
    # Wire shape: exact path, exact JSON body, explicit timeout.
    assert requests == [
        ("http://app.test/api/security/vault/job-dek", {"jobSlug": "job-1"}, 15)
    ]
    # Second call is served from the RAM cache — no extra HTTP request.
    assert crypto.get_dek(db, doc) == dek
    assert len(requests) == 1


def test_get_dek_unprepared_for_this_doc_returns_none(monkeypatch):
    forbid_http(monkeypatch)
    db = make_db()
    assert crypto.prepare_job_dek(db, "jobs", db["jobs"].docs[0]) is True
    other_doc = {"_id": "j2", "slug": "someone-elses-job", "ownerId": "u1"}
    assert crypto.get_dek(db, other_doc) is None


def test_get_dek_409_raises_vault_locked(monkeypatch):
    db = make_db()
    doc = db["jobs"].docs[0]
    assert crypto.prepare_job_dek(db, "jobs", doc) is True

    def locked(request, timeout=0):
        raise urllib.error.HTTPError(request.full_url, 409, "Conflict", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", locked)
    with pytest.raises(crypto.VaultLockedError):
        crypto.get_dek(db, doc)


def test_get_dek_other_http_error_propagates(monkeypatch):
    db = make_db()
    doc = db["jobs"].docs[0]
    assert crypto.prepare_job_dek(db, "jobs", doc) is True

    def broken(request, timeout=0):
        raise urllib.error.HTTPError(request.full_url, 500, "Server Error", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", broken)
    with pytest.raises(urllib.error.HTTPError):
        crypto.get_dek(db, doc)


def test_get_dek_missing_app_url_raises(monkeypatch):
    monkeypatch.delenv("NEST_APP_URL", raising=False)
    db = make_db()
    doc = db["jobs"].docs[0]
    assert crypto.prepare_job_dek(db, "jobs", doc) is True
    play_server(monkeypatch, db, os.urandom(32))
    with pytest.raises(RuntimeError, match="NEST_APP_URL"):
        crypto.get_dek(db, doc)


def test_get_dek_wrong_aad_fails_decryption(monkeypatch):
    """The AAD is the job slug — a parcel sealed for another job must not open."""
    db = make_db()
    doc = db["jobs"].docs[0]
    assert crypto.prepare_job_dek(db, "jobs", doc) is True
    play_server(monkeypatch, db, os.urandom(32), aad_slug="another-job")
    with pytest.raises(Exception):  # cryptography.exceptions.InvalidTag
        crypto.get_dek(db, doc)


def test_wipe_zeroes_buffer_and_unsets_worker_key_pub(monkeypatch):
    dek = os.urandom(32)
    db = make_db()
    doc = db["jobs"].docs[0]
    assert crypto.prepare_job_dek(db, "jobs", doc) is True
    play_server(monkeypatch, db, dek)
    assert crypto.get_dek(db, doc) == dek

    dek_buffer = crypto._job_dek
    crypto.wipe_job_dek(db, "jobs", doc["_id"])

    # The bytearray itself was overwritten in place, then every ref dropped.
    assert bytes(dek_buffer) == b"\x00" * 32
    assert crypto._job_dek is None
    assert crypto._job_priv_key is None
    assert crypto._job_slug is None
    assert "workerKeyPub" not in doc
    assert any("$unset" in u and "workerKeyPub" in u["$unset"] for u in db["jobs"].updates)


def test_wipe_never_raises():
    crypto.wipe_job_dek(None, "jobs", None)
    broken_db = FakeDb()  # no such collection doc: update targets nothing
    crypto.wipe_job_dek(broken_db, "jobs", "missing")
