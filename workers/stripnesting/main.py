import time
import math
import traceback
import threading
import signal
import sys
from datetime import datetime
from utils.logger import setup_logger
from utils.mongo import db
from pymongo import ReturnDocument
from core.main import strip_nesting_process

logger = setup_logger("main_stripnesting")
logger.info("Starting strip nesting worker")

keep_alive_interval = 10

current_doc_id = None
shutdown_requested = False

strip_nesting_jobs = db["strip_nesting_job_queue"]


def refund_charge(doc):
    """Refund the unit consumed at enqueue time when a job definitively fails.

    Jobs carry a `charge` object written by the API:
      - {"type": "free"}                 -> give back one free nesting slot
      - {"type": "credits", "amount": N} -> give back N paid credits
      - {"type": "admin"|"subscription"} -> nothing was consumed
    """
    charge = doc.get("charge")
    if not charge or charge.get("refunded"):
        return
    charge_type = charge.get("type")
    try:
        if charge_type == "free":
            db["users"].update_one(
                {"id": doc["ownerId"], "freeNestingUsed": {"$gt": 0}},
                {"$inc": {"freeNestingUsed": -1}},
            )
            logger.info(f"Refunded free nesting slot to user {doc['ownerId']}")
        elif charge_type == "credits":
            db["users"].update_one(
                {"id": doc["ownerId"]},
                {"$inc": {"balance": charge.get("amount", 10)}},
            )
            logger.info(f"Refunded {charge.get('amount', 10)} credits to user {doc['ownerId']}")
        strip_nesting_jobs.update_one(
            {"_id": doc["_id"]},
            {"$set": {"charge.refunded": True}},
        )
    except Exception as e:
        logger.error(f"Failed to refund charge for job {doc['_id']}: {e}")


def signal_handler(signum, frame):
    """Handle graceful shutdown signals — reset the in-flight job to pending."""
    global current_doc_id, shutdown_requested

    logger.info(f"Received {signum} signal, initiating graceful shutdown")
    shutdown_requested = True

    if current_doc_id:
        try:
            logger.info(f"Resetting current job {current_doc_id} to pending status")
            strip_nesting_jobs.update_one(
                {"_id": current_doc_id},
                {"$set": {"status": "pending"}},
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
    global current_doc_id

    while not shutdown_requested:
        if current_doc_id:
            try:
                strip_nesting_jobs.update_one(
                    {"_id": current_doc_id},
                    {"$set": {"update_ts": datetime.now()}},
                )
                logger.debug(f"Updated keep-alive for document {current_doc_id}")
            except Exception as e:
                logger.error(f"Failed to update keep-alive: {e}")

        time.sleep(keep_alive_interval)


keepalive_thread = threading.Thread(target=keep_alive_worker, daemon=True)
keepalive_thread.start()

while not shutdown_requested:
    logger.info("Strip nesting worker looking for pending jobs")
    doc = strip_nesting_jobs.find_one_and_update(
        {"status": "pending"},
        {"$set": {"status": "processing"}},
        return_document=ReturnDocument.AFTER,
    )

    if doc is None:
        time.sleep(5)
        continue

    current_doc_id = doc["_id"]

    try:
        start_at = datetime.now()
        strip_nesting_jobs.update_one(
            {"_id": current_doc_id},
            {"$set": {"update_ts": datetime.now(), "startAt": start_at}},
        )

        strip_nesting_process(doc)

        time_taken = datetime.now() - start_at
        time_taken_minutes = math.ceil(time_taken.total_seconds() / 60)

        strip_nesting_jobs.update_one(
            {"_id": current_doc_id},
            {
                "$set": {
                    "status": "done",
                    "finishedAt": datetime.now(),
                    "update_ts": datetime.now(),
                    "timeTaken": time_taken_minutes,
                }
            },
        )
    except Exception as e:
        logger.error(
            "Error in strip nesting processing",
            extra={"error": str(e), "traceback": traceback.format_exc()},
        )
        refund_charge(doc)
        strip_nesting_jobs.update_one(
            {"_id": current_doc_id},
            {
                "$set": {
                    "status": "error",
                    "error": str(e),
                    "update_ts": datetime.now(),
                    "finishedAt": datetime.now(),
                }
            },
        )
    finally:
        current_doc_id = None
