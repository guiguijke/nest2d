import { MongoClient, type Db } from 'mongodb'

// Shared MongoDB connection for the admin panel. Points at the SAME database
// as the main app (the DB name is taken from the URI path, matching the
// behaviour of server/db/mongo.js in the main app and of the Python workers).
//
// Reads from NUXT_ADMIN_MONGO_URI, falling back to NUXT_MONGO_URI so the panel
// can run alongside the main app with no extra config in dev.

let client: MongoClient | null = null
let dbInstance: Db | null = null

export async function connectDB(): Promise<Db> {
  if (dbInstance) return dbInstance

  const uri = useRuntimeConfig().adminMongoUri as string
  if (!uri) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Admin DB not configured (NUXT_ADMIN_MONGO_URI missing).',
    })
  }

  client = new MongoClient(uri)
  await client.connect()
  dbInstance = client.db() // DB name comes from the URI path
  return dbInstance
}

// Collection names mirror the main app exactly — they are shared data.
export const COL = {
  users: 'users',
  admins: 'admins',
  projects: 'projects',
  nestingJobs: 'nesting_jobs',
  stripProjects: 'strip_projects',
  stripJobQueue: 'strip_nesting_job_queue',
  transactions: 'transactions',
  subscriptionCheckouts: 'subscription_checkouts',
  subscriptionPlan: 'subscription_plan',
  paywallProduct: 'paywallProduct',
  tracking: 'tracking',
  http: 'http',
  supportMessages: 'supportMessages',
} as const
