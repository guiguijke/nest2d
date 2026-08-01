import os

import gridfs
from pymongo import MongoClient
from dotenv import load_dotenv

from .logger import setup_logger

load_dotenv()

logger = setup_logger("mongo")


def create_mongo_client():
    mongo_uri = os.environ.get("MONGO_URI")
    if not mongo_uri:
        logger.error("Error: 'MONGO_URI' key not found in environment variables.")
        raise Exception("Mongo connection failed")

    return MongoClient(mongo_uri)


_client: MongoClient = create_mongo_client()
db = _client.get_default_database()

# GridFS buckets are created lazily by name: each worker declares the bucket
# names it needs (e.g. "userDxf", "stripNestDxf") instead of importing a
# pre-instantiated global.
_buckets: dict[str, gridfs.GridFSBucket] = {}


def get_bucket(name: str) -> gridfs.GridFSBucket:
    if name not in _buckets:
        _buckets[name] = gridfs.GridFSBucket(db, bucket_name=name)
    return _buckets[name]
