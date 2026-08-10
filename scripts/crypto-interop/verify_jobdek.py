"""
Interop lock for the D-PRV-7 job-dek delivery (THREAT-MODEL §4.2).

Python = worker role, using the REAL unwrap path of worker_common.crypto
(`get_dek` with a stubbed HTTP transport) to open the parcel sealed by
scripts/crypto-interop/verify_jobdek.mjs (Node = server role). Then plays
the server role itself and writes vector-jobdek-py.json for the Node side
to open.

Run after verify_jobdek.mjs (first pass):
    python scripts/crypto-interop/verify_jobdek.py
Then re-run verify_jobdek.mjs to close the reverse direction.
"""
import base64
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "workers", "common"))

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402
from cryptography.hazmat.primitives.kdf.hkdf import HKDF  # noqa: E402

import worker_common.crypto as worker_crypto  # noqa: E402

HERE = os.path.dirname(__file__)
NODE_VECTOR = os.path.join(HERE, "vector-jobdek-node.json")
PY_VECTOR = os.path.join(HERE, "vector-jobdek-py.json")

_TRANSPORT_INFO = b"nest2d-job-dek-v1"
_TRANSPORT_SALT = b"\x00" * 32  # explicit zeros — part of the contract


def main() -> None:
    with open(NODE_VECTOR, encoding="utf-8") as fh:
        vector = json.load(fh)

    job_slug = vector["job_slug"]
    dek = base64.b64decode(vector["dek"])
    worker_priv_raw = base64.b64decode(vector["worker_priv"])
    worker_pub = base64.b64decode(vector["worker_pub"])

    # Rebuild the worker private key from its raw 32-byte scalar and lock the
    # point encoding agreement (derived pub must equal the Node-emitted pub).
    priv = ec.derive_private_key(
        int.from_bytes(worker_priv_raw, "big"), ec.SECP256R1()
    )
    derived_pub = priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    assert derived_pub == worker_pub, "P-256 point encoding mismatch Node vs Python"

    # --- Direction 1: open the Node-sealed parcel through the REAL worker
    # code path (get_dek), with only the HTTP transport stubbed. ---
    worker_crypto._job_priv_key = priv
    worker_crypto._job_slug = job_slug
    worker_crypto._post_job_dek = lambda app_url, slug: {
        "serverPub": vector["server_pub"],
        "parcel": vector["parcel"],
    }
    os.environ["NEST_APP_URL"] = "http://interop.local"
    opened = worker_crypto.get_dek(None, {"slug": job_slug})
    assert opened == dek, "Python could not open the Node-sealed job-dek parcel"
    assert hashlib.sha256(opened).hexdigest() == vector["dek_fingerprint"]
    print("✓ Python opens the Node-sealed job-dek parcel via the real get_dek path")

    # A wrong AAD (different slug) MUST fail the GCM open.
    worker_crypto._job_dek = None
    worker_crypto._job_slug = "other-slug"
    try:
        worker_crypto.get_dek(None, {"slug": "other-slug"})
        raise AssertionError("wrong slug (AAD) was NOT rejected")
    except Exception as e:
        assert not isinstance(e, AssertionError), e
    print("✓ wrong job slug (AAD) rejected")
    worker_crypto._reset_job_state()

    # --- Direction 2: Python seals (server role) for Node to open. ---
    new_dek = os.urandom(32)
    server_priv = ec.generate_private_key(ec.SECP256R1())
    worker_pub_key = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), worker_pub
    )
    shared = server_priv.exchange(ec.ECDH(), worker_pub_key)
    transport_key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=_TRANSPORT_SALT, info=_TRANSPORT_INFO
    ).derive(shared)
    nonce = os.urandom(12)
    ct = AESGCM(transport_key).encrypt(nonce, new_dek, job_slug.encode("utf-8"))
    server_pub = server_priv.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    with open(PY_VECTOR, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "job_slug": job_slug,
                "dek": base64.b64encode(new_dek).decode("ascii"),
                "server_pub": base64.b64encode(server_pub).decode("ascii"),
                "parcel": base64.b64encode(nonce + ct).decode("ascii"),
            },
            fh,
            indent=2,
        )
    print("✓ vector-jobdek-py.json written — re-run verify_jobdek.mjs to close the loop")


if __name__ == "__main__":
    main()
