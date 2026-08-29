"""Shared compute-token pool: caps the total vcores used across all worker
daemons on the host (the app budget, e.g. 16 of the machine's 32 threads).

A single Mongo document (`compute_pool`, _id="global") tracks the leases.
A daemon acquires `cost` tokens right before claiming a job and releases
them when the job finalizes (or on SIGTERM). Leases heartbeat through the
worker loop's keep-alive thread; leases whose owner died mid-job are reaped
by every daemon's loop after STALE_AFTER_SEC.

Atomicity: the acquire is a single conditional update (`used + cost <=
total` via $expr), so concurrent daemons can never oversubscribe the pool.
"""

import os
import uuid
from datetime import datetime, timedelta

from .mongo import db

POOL_ID = "global"

# A lease is stale when its daemon has not refreshed it for this long.
# Generous vs the 10s keep-alive interval — a busy-but-alive daemon must
# never be reaped.
STALE_AFTER_SEC = 60


def total_tokens():
    """Pool size in vcores (env NEST_COMPUTE_TOKENS, default 16)."""
    return int(os.environ.get("NEST_COMPUTE_TOKENS", "16"))


def _pool():
    return db["compute_pool"]


def ensure_pool():
    """Creates the pool doc on first use; refreshes the total from env."""
    _pool().update_one(
        {"_id": POOL_ID},
        {
            "$setOnInsert": {"used": 0, "leases": []},
            "$set": {"total": total_tokens()},
        },
        upsert=True,
    )


def acquire_tokens(worker_name, job_id, cost):
    """Tries to lease `cost` vcores for a job. Returns (lease_id, cost) or
    None when the pool cannot fit the job right now.

    Un coût > total (tier Pro 8 vcores sur un pool de 4 — serveur 2 vCPU,
    constat QA 2026-08-30) serait INACQUIRABLE : le job resterait « pending »
    à vie. On borne le coût au pool : le job prend la machine entière plutôt
    que de mourir de faim (comportement égal au serialisé d'avant le pool).
    """
    cost = max(1, int(cost))
    total = total_tokens()
    if cost > total:
        cost = total
    lease_id = f"{worker_name}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    res = _pool().update_one(
        {
            "_id": POOL_ID,
            "$expr": {"$lte": [{"$add": ["$used", cost]}, "$total"]},
        },
        {
            "$inc": {"used": cost},
            "$push": {
                "leases": {
                    "lease_id": lease_id,
                    "job_id": job_id,
                    "worker": worker_name,
                    "vcores": cost,
                    "last_seen": datetime.now(),
                }
            },
        },
    )
    return (lease_id, cost) if res.modified_count else None


def release_tokens(lease):
    """Returns a lease to the pool. Idempotent (pull of a missing lease is
    a no-op; `used` is only decremented when the lease was actually there)."""
    if not lease:
        return
    lease_id, cost = lease
    res = _pool().update_one(
        {"_id": POOL_ID, "leases.lease_id": lease_id},
        {
            "$inc": {"used": -cost},
            "$pull": {"leases": {"lease_id": lease_id}},
        },
    )
    return res.modified_count > 0


def refresh_lease(lease):
    """Heartbeat: marks the lease alive (called by the keep-alive thread)."""
    if not lease:
        return
    lease_id, _ = lease
    _pool().update_one(
        {"_id": POOL_ID, "leases.lease_id": lease_id},
        {"$set": {"leases.$.last_seen": datetime.now()}},
    )


def reap_stale_leases(logger=None):
    """Releases leases whose heartbeat expired (owner daemon died mid-job).
    The 60s staleness vs 10s refresh margin makes reaping a live daemon
    practically impossible, so the read-then-pull race is safe."""
    doc = _pool().find_one({"_id": POOL_ID})
    if not doc:
        return 0
    cutoff = datetime.now() - timedelta(seconds=STALE_AFTER_SEC)
    stale = [
        lease for lease in doc.get("leases", [])
        if lease.get("last_seen") is None or lease["last_seen"] < cutoff
    ]
    if not stale:
        return 0
    freed = sum(lease.get("vcores", 0) for lease in stale)
    stale_ids = [lease["lease_id"] for lease in stale]
    _pool().update_one(
        {"_id": POOL_ID},
        {
            "$inc": {"used": -freed},
            "$pull": {"leases": {"lease_id": {"$in": stale_ids}}},
        },
    )
    if logger:
        logger.warning(
            "Reaped stale compute leases",
            extra={"leases": stale_ids, "freed_vcores": freed},
        )
    return freed
