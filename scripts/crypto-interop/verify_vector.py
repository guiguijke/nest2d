"""
Interop test: JS -> Python.
Decrypts scripts/crypto-interop/vector-js.json (produced by
scripts/crypto-roundtrip.mjs) with the worker-side crypto module, then
produces vector-py.json for the Node side to decrypt.

Run: python scripts/crypto-interop/verify_vector.py
"""
import base64
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "workers", "common"))

from worker_common.crypto import (  # noqa: E402
    PLAINTEXT_BLOCK,
    decrypt_bytes,
    encrypt_bytes,
    fingerprint_key,
    unwrap_dek,
    wrap_dek,
)

HERE = os.path.dirname(__file__)


def main() -> None:
    with open(os.path.join(HERE, "vector-js.json"), encoding="utf-8") as fh:
        vector = json.load(fh)

    dek = base64.b64decode(vector["dek"])
    ciphertext = base64.b64decode(vector["ciphertext"])

    plain = decrypt_bytes(dek, vector["fileId"], vector["ownerId"], ciphertext)
    digest = hashlib.sha256(plain).hexdigest()
    assert digest == vector["plaintext_sha256"], (
        f"JS vector decryption mismatch: {digest} != {vector['plaintext_sha256']}"
    )
    assert fingerprint_key(dek) == vector["dek_fingerprint"], "fingerprint mismatch"
    print("✓ Python decrypts the JS vector (multi-frame) and fingerprints match")

    # Master-key wrap/unwrap round-trip (uses a throwaway local key).
    os.environ["ENCRYPTION_MASTER_KEY"] = os.urandom(32).hex()
    wrapped = wrap_dek(dek)
    assert unwrap_dek(wrapped) == dek, "wrap/unwrap mismatch"
    print("✓ Python wrap/unwrap DEK")

    # Produce the Python -> JS vector.
    plain_py = (
        b"Nest2D interop vector, Python side.\n"
        + os.urandom(PLAINTEXT_BLOCK + 42)
    )
    encrypted_py = encrypt_bytes(dek, vector["fileId"], vector["ownerId"], plain_py)
    with open(os.path.join(HERE, "vector-py.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "dek": vector["dek"],
                "fileId": vector["fileId"],
                "ownerId": vector["ownerId"],
                "plaintext_sha256": hashlib.sha256(plain_py).hexdigest(),
                "ciphertext": base64.b64encode(encrypted_py).decode("ascii"),
                "dek_fingerprint": fingerprint_key(dek),
            },
            fh,
            indent=2,
        )
    print("✓ vector-py.json written")


if __name__ == "__main__":
    main()
