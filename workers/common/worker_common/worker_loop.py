"""Generic worker loop shared by all 4 Nest2D workers.

Each worker's main.py only declares a WorkerConfig (which Mongo collection to
poll, how statuses are named, what to run per job, optional hooks) and calls
run_worker(). The loop handles:

  - atomic job claiming via find_one_and_update (pending -> processing)
  - heartbeat thread touching `update_ts` while a job is in flight
  - graceful SIGTERM shutdown (in-flight job reset to pending)
  - success / retry / error status transitions, optional timing fields
    (startAt / finishedAt / timeTaken) and optional refund on failure

Two historical flavours are covered through the config:

  - file processing (user_dxf_files / strip_user_dxf_files):
    status_field="processingStatus", done_status="completed",
    error_field="processingError", result_based_completion=True
    (a falsy result sends the doc back to pending for a later retry)
  - nesting (nesting_jobs / strip_nesting_job_queue):
    status_field="status", done_status="done", error_field="error",
    track_timing=True, optional priority sort, refund hook and a
    cancelled_exception type for user-cancelled jobs
"""

import math
import os
import signal
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from pymongo import ReturnDocument

from .compute_tokens import (
    acquire_tokens,
    ensure_pool,
    reap_stale_leases,
    refresh_lease,
    release_tokens,
)
from .logger import setup_logger
from .mongo import db


@dataclass
class WorkerConfig:
    name: str
    collection: str
    process: Callable[[dict], Any]
    # Status vocabulary differs between the file-processing collections
    # ("processingStatus"/"completed"/"processingError") and the nesting
    # queues ("status"/"done"/"error") — no default, set them explicitly.
    status_field: str
    done_status: str
    error_field: str
    # Extra filter merged into the claim query, e.g. {"worker_tag": "normal"}.
    query_extra: dict = field(default_factory=dict)
    # Claim order, e.g. [("priority", 1), ("createdAt", 1)] for the bin queue.
    sort: list | None = None
    # Write startAt/finishedAt/timeTaken alongside the status transitions.
    track_timing: bool = False
    # File flavour: a falsy process() result resets the doc to pending.
    result_based_completion: bool = False
    # Runs after a successful job, e.g. incrementing users.nesting_count.
    on_success: Callable[[dict], None] | None = None
    # Runs when a job fails or is cancelled, e.g. refund_charge.
    refund: Callable[[dict], None] | None = None
    # Exception type(s) raised by process() when the user cancelled the job;
    # such jobs are already finalized by process() and are only refunded.
    cancelled_exception: type[BaseException] | tuple | None = None
    # Compute tokens: returns the job's cost in the shared vcore pool
    # (worker_common.compute_tokens). When set, the loop acquires tokens
    # before claiming a job and releases them on finalize; when the pool
    # cannot fit any pending job, the worker idles. None = untracked.
    token_cost: Callable[[dict], int] | None = None
    idle_sleep: float = 5.0
    heartbeat_interval: float = 10.0


def run_worker(config: WorkerConfig) -> None:
    logger = setup_logger(config.name)
    logger.info(f"Starting worker {config.name}")

    if os.environ.get("ENCRYPTION_MASTER_KEY"):
        # D-PRV-7: the DEK is no longer wrapped server-side — the master key
        # has no consumer left in the workers.
        logger.warning(
            "ENCRYPTION_MASTER_KEY is deprecated (D-PRV-7): unused by the "
            "workers, it can be removed from the environment"
        )

    collection = db[config.collection]
    current_doc_id = None
    current_lease = None  # (lease_id, cost) while a job is in flight
    shutdown_requested = False

    def signal_handler(signum, frame):
        """Handle graceful shutdown signals — reset the in-flight job to pending."""
        nonlocal current_doc_id, current_lease, shutdown_requested

        logger.info(f"Received {signum} signal, initiating graceful shutdown")
        shutdown_requested = True

        if current_lease:
            try:
                release_tokens(current_lease)
            except Exception as e:
                logger.error(f"Failed to release compute tokens: {e}")

        if current_doc_id:
            try:
                logger.info(f"Resetting current job {current_doc_id} to pending status")
                collection.update_one(
                    {"_id": current_doc_id},
                    {"$set": {config.status_field: "pending"}},
                )
                logger.info(f"Successfully reset job {current_doc_id} to pending")
            except Exception as e:
                logger.error(f"Failed to reset job {current_doc_id}: {e}")
        else:
            logger.info("No current job to reset")

        logger.info("Graceful shutdown completed")
        sys.exit(0)

    signal.signal(signal.SIGTERM, signal_handler)

    try:
        db.command("ping")
        logger.info("Database connection successful")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise e

    def keep_alive_worker():
        while not shutdown_requested:
            if current_doc_id:
                try:
                    collection.update_one(
                        {"_id": current_doc_id},
                        {"$set": {"update_ts": datetime.now()}},
                    )
                    logger.debug(f"Updated keep-alive for document {current_doc_id}")
                except Exception as e:
                    logger.error(f"Failed to update keep-alive: {e}")
            if current_lease:
                try:
                    refresh_lease(current_lease)
                except Exception as e:
                    logger.error(f"Failed to refresh compute lease: {e}")

            time.sleep(config.heartbeat_interval)

    keepalive_thread = threading.Thread(target=keep_alive_worker, daemon=True)
    keepalive_thread.start()

    if config.token_cost:
        ensure_pool()

    query = {config.status_field: "pending", **config.query_extra}

    def claim_with_tokens():
        """Peek pending jobs in priority order, acquire tokens for the first
        one the pool can fit, then claim it. Avoids head-of-line blocking:
        an expensive job that does not fit never starves cheaper ones."""
        reap_stale_leases(logger)
        finder = collection.find(query)
        if config.sort:
            finder = finder.sort(config.sort)
        for candidate in finder.limit(5):
            lease = acquire_tokens(config.name, candidate["_id"], config.token_cost(candidate))
            if lease is None:
                continue
            claimed = collection.find_one_and_update(
                {"_id": candidate["_id"], config.status_field: "pending"},
                {"$set": {config.status_field: "processing"}},
                return_document=ReturnDocument.AFTER,
            )
            if claimed is None:
                # Another daemon won the claim race: hand the tokens back.
                release_tokens(lease)
                continue
            return claimed, lease
        return None, None

    while not shutdown_requested:
        logger.info(f"Worker {config.name} looking for pending jobs")
        lease = None
        if config.token_cost:
            doc, lease = claim_with_tokens()
        else:
            doc = collection.find_one_and_update(
                query,
                {"$set": {config.status_field: "processing"}},
                sort=config.sort,
                return_document=ReturnDocument.AFTER,
            )

        if doc is None:
            time.sleep(config.idle_sleep)
            continue

        current_doc_id = doc["_id"]
        current_lease = lease

        try:
            from . import crypto

            start_at = datetime.now()
            claim_update = {"update_ts": start_at}
            if config.track_timing:
                claim_update["startAt"] = start_at
            collection.update_one({"_id": current_doc_id}, {"$set": claim_update})

            # D-PRV-7: per-job DEK delivery — on the vault path this writes
            # workerKeyPub on the claimed doc. A failure here must fail the
            # job (and refund it): a vault job without the app is impossible.
            crypto.prepare_job_dek(db, config.collection, doc)

            result = config.process(doc)

            if config.result_based_completion and not result:
                collection.update_one(
                    {"_id": current_doc_id},
                    {"$set": {config.status_field: "pending"}},
                )
            else:
                # process() may have rerouted the job out of "processing"
                # (Phase 2 local compute: status is now "awaiting_local" and
                # the browser owns completion). Clobbering that transition
                # with the done write loses the job: the browser never sees
                # awaiting_local, no result is ever produced and the quota is
                # gone. Only finalize when the job is still in-flight.
                current_status = collection.find_one(
                    {"_id": current_doc_id}, {config.status_field: 1}
                ).get(config.status_field)
                if current_status != "processing":
                    logger.info(
                        f"Job rerouted by process() (status={current_status}), "
                        "skipping the done transition",
                        extra={"slug": doc.get("slug")},
                    )
                    continue
                done_update = {config.status_field: config.done_status}
                if config.track_timing:
                    finished_at = datetime.now()
                    done_update["finishedAt"] = finished_at
                    done_update["update_ts"] = finished_at
                    done_update["timeTaken"] = math.ceil(
                        (finished_at - start_at).total_seconds() / 60
                    )
                collection.update_one({"_id": current_doc_id}, {"$set": done_update})
                if config.on_success:
                    config.on_success(doc)
        except Exception as e:
            if config.cancelled_exception and isinstance(e, config.cancelled_exception):
                # The job doc is already finalized (status=cancelled) by
                # process(); just refund the consumed unit like any failure.
                logger.info("Job cancelled by user", extra={"slug": doc.get("slug")})
                if config.refund:
                    config.refund(doc)
            else:
                logger.error(
                    f"Error in {config.name} processing",
                    extra={"error": str(e), "traceback": traceback.format_exc()},
                )
                if config.refund:
                    config.refund(doc)
                error_update = {
                    config.status_field: "error",
                    config.error_field: str(e),
                }
                if config.track_timing:
                    error_update["update_ts"] = datetime.now()
                    error_update["finishedAt"] = datetime.now()
                collection.update_one({"_id": current_doc_id}, {"$set": error_update})
        finally:
            # Wipe the job DEK (and unset workerKeyPub) BEFORE dropping the
            # doc reference — success, failure or reroute alike.
            try:
                from . import crypto

                crypto.wipe_job_dek(db, config.collection, current_doc_id)
            except Exception as e:
                logger.error(f"Failed to wipe job DEK: {e}")
            if current_lease:
                try:
                    release_tokens(current_lease)
                except Exception as e:
                    logger.error(f"Failed to release compute tokens: {e}")
            current_lease = None
            current_doc_id = None
