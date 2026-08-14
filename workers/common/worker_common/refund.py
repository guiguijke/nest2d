from .logger import setup_logger
from .mongo import db

logger = setup_logger("refund")


def refund_charge(jobs_collection, doc) -> None:
    """Refund the unit consumed at enqueue time when a job definitively fails.

    Jobs carry a `charge` object written by the API:
      - {"type": "free"}                 -> give back one free nesting slot
      - {"type": "demo"}                 -> give back one demo nesting slot
      - {"type": "grant"|"subscription"} -> nothing was consumed
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
        elif charge_type == "demo" and not charge.get("skippedQuota"):
            db["users"].update_one(
                {"id": doc["ownerId"], "demoNestingUsed": {"$gt": 0}},
                {"$inc": {"demoNestingUsed": -1}},
            )
            logger.info(f"Refunded demo nesting slot to user {doc['ownerId']}")
        jobs_collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {"charge.refunded": True}},
        )
    except Exception as e:
        logger.error(f"Failed to refund charge for job {doc['_id']}: {e}")
