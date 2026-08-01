import { MongoClient, GridFSBucket } from "mongodb";
import logger from "../utils/logger";

const uri = useRuntimeConfig().mongoUri;

let client;
/**
 * @type {import('mongodb').Db}
 */
export let db;

/**
 * Lazily created GridFS buckets, keyed by bucket name. Bucket names per
 * domain live in server/core/domains.js — new buckets no longer need a
 * dedicated getter here.
 */
const buckets = {};

/**
 * @param {string} bucketName
 * @returns {Promise<GridFSBucket>}
 */
export async function getBucket(bucketName) {
  await connectDB();
  if (!buckets[bucketName]) {
    buckets[bucketName] = new GridFSBucket(db, { bucketName });
  }
  return buckets[bucketName];
}

/**
 * @type {GridFSBucket}
 */
let avatarBucket;

/**
 * @returns {Promise<GridFSBucket>}
 */
export async function getAvatarBucket() {
  await connectDB();
  if (!avatarBucket) {
    avatarBucket = new GridFSBucket(db, {
      bucketName: "avatars",
    });
  }
  return avatarBucket;
}

/** @returns {Promise<GridFSBucket>} */
export async function getSvgResultBucket() {
  return getBucket("nestSvg");
}

/** @returns {Promise<GridFSBucket>} */
export async function getUserDxfFilesSvgBucket() {
  return getBucket("userDxfFilesSvg");
}

/** @returns {Promise<GridFSBucket>} */
export async function getDxfResultBucket() {
  return getBucket("nestDxf");
}

/** @returns {Promise<GridFSBucket>} */
export async function getUserDxfBucket() {
  return getBucket("userDxf");
}

/** @returns {Promise<GridFSBucket>} */
export async function getStripUserDxfBucket() {
  return getBucket("stripUserDxf");
}

/** @returns {Promise<GridFSBucket>} */
export async function getStripNestDxfBucket() {
  return getBucket("stripNestDxf");
}

/**
 * @type {GridFSBucket}
 */
let userSvgBucket;

/**
 * @returns {Promise<GridFSBucket>}
 */
export async function getUserSvgBucket() {
  await connectDB();
  if (!userSvgBucket) {
    userSvgBucket = new GridFSBucket(db, {
      bucketName: "userSvg",
    });
  }
  return userSvgBucket;
}

/** @returns {Promise<GridFSBucket>} */
export async function getValidUserDxfBucket() {
  return getBucket("validDxf");
}

export async function connectDB() {
  if (!client) {
    try {
      client = new MongoClient(uri);
      await client.connect();
      logger.info("Connected to MongoDB");
    } catch (error) {
      logger.error("Failed to connect to MongoDB", error);
      throw error;
    }
  }
  if (!db) {
    db = client.db();
  }
  return db;
}
