"""Unit tests for the compute-token pool (no real Mongo: a fake collection
reproduces the exact update shapes used by compute_tokens)."""
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# worker_common.mongo requires a URI at import time (client is lazy — no
# server is ever contacted by these tests).
os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017/test")

sys.path.insert(0, str(Path(__file__).parent.parent))

from worker_common import compute_tokens
from worker_common.compute_tokens import (
    acquire_tokens,
    ensure_pool,
    reap_stale_leases,
    refresh_lease,
    release_tokens,
)


class FakeResult:
    def __init__(self, modified):
        self.modified_count = modified


class FakePool:
    """Minimal stand-in for the compute_pool collection."""

    def __init__(self):
        self.doc = None

    def update_one(self, filt, update, upsert=False):
        if self.doc is None:
            if not upsert:
                return FakeResult(0)
            self.doc = {"_id": compute_tokens.POOL_ID, "used": 0, "leases": []}

        doc = self.doc

        # ensure_pool
        if "$setOnInsert" in update:
            doc.update(update.get("$set", {}))
            return FakeResult(1)

        # Conditional acquire ($expr: used + cost <= total)
        expr = filt.get("$expr")
        if expr is not None:
            cost = expr["$lte"][0]["$add"][1]
            if doc["used"] + cost > doc["total"]:
                return FakeResult(0)

        # Lease-scoped filters (release / refresh): lease must exist
        lease_id = filt.get("leases.lease_id")
        if lease_id is not None and not any(
            l["lease_id"] == lease_id for l in doc["leases"]
        ):
            return FakeResult(0)

        inc = update.get("$inc", {})
        doc["used"] = doc.get("used", 0) + inc.get("used", 0)

        push = update.get("$push", {}).get("leases")
        if push:
            doc["leases"].append(push)

        pull = update.get("$pull", {}).get("leases")
        if pull:
            ids = pull.get("lease_id")
            ids = set(ids.get("$in", [])) if isinstance(ids, dict) else {ids}
            doc["leases"] = [l for l in doc["leases"] if l["lease_id"] not in ids]

        set_op = update.get("$set", {})
        if "leases.$.last_seen" in set_op:
            for l in doc["leases"]:
                if l["lease_id"] == lease_id:
                    l["last_seen"] = set_op["leases.$.last_seen"]

        return FakeResult(1)

    def find_one(self, filt):
        return self.doc


import pytest


@pytest.fixture
def pool(monkeypatch):
    fake = FakePool()
    monkeypatch.setattr(compute_tokens, "_pool", lambda: fake)
    ensure_pool()
    return fake


def test_acquire_up_to_total_then_refused(pool):
    assert acquire_tokens("w1", "job1", 8) is not None
    assert acquire_tokens("w2", "job2", 8) is not None
    # Pool full (16/16): next acquire fails
    assert acquire_tokens("w3", "job3", 1) is None
    assert pool.doc["used"] == 16
    assert len(pool.doc["leases"]) == 2


def test_release_reenables_acquire(pool):
    lease = acquire_tokens("w1", "job1", 8)
    assert acquire_tokens("w2", "job2", 8) is not None
    release_tokens(lease)
    assert pool.doc["used"] == 8
    assert acquire_tokens("w3", "job3", 8) is not None


def test_release_is_idempotent(pool):
    lease = acquire_tokens("w1", "job1", 8)
    assert release_tokens(lease) is True
    assert release_tokens(lease) is False
    assert pool.doc["used"] == 0


def test_refresh_then_reap_keeps_fresh_releases_stale(pool):
    fresh = acquire_tokens("w1", "job1", 4)
    stale = acquire_tokens("w2", "job2", 4)
    # Age the stale lease by hand, refresh the fresh one
    for l in pool.doc["leases"]:
        if l["lease_id"] == stale[0]:
            l["last_seen"] = datetime.now() - timedelta(seconds=120)
    refresh_lease(fresh)

    freed = reap_stale_leases()
    assert freed == 4
    assert pool.doc["used"] == 4
    assert [l["lease_id"] for l in pool.doc["leases"]] == [fresh[0]]


def test_total_comes_from_env(pool):
    assert pool.doc["total"] == compute_tokens.total_tokens()
