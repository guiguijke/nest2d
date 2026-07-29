import { connectDB, COL } from '../../db/mongo'

// Tells the UI whether first-time setup is needed (no admin exists yet).
// No auth required: it only returns a boolean.
export default defineEventHandler(async () => {
  const db = await connectDB()
  const count = await db.collection(COL.admins).estimatedDocumentCount()
  return { needsSetup: count === 0 }
})
