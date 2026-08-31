/**
 * Minimal in-memory MongoDB fake for server unit tests. Supports exactly the
 * query/update operators used by entitlement.js and promo.js — no more.
 * Collections record their calls so tests can assert on the filters sent
 * (e.g. the atomic quota guard carries the per-user limit).
 */

function evalExpr(doc, expr) {
    const [op, args] = Object.entries(expr)[0]
    const resolve = (v) => (typeof v === 'string' && v.startsWith('$') ? getPath(doc, v.slice(1)) : v)
    const [a, b] = args.map(resolve)
    if (op === '$lt') return a < b
    throw new Error(`fakeMongo: unsupported $expr operator ${op}`)
}

// Dot-path resolution ('promo.expiresAt' → doc.promo.expiresAt); missing
// intermediate segments yield undefined, matching Mongo's semantics.
function getPath(doc, key) {
    return key.split('.').reduce((o, k) => (o == null ? o : o[k]), doc)
}

function setPath(doc, key, value) {
    const parts = key.split('.')
    const last = parts.pop()
    const target = parts.reduce((o, k) => (o[k] ??= {}), doc)
    target[last] = value
}

export function matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
        if (key === '$and') return cond.every((f) => matches(doc, f))
        if (key === '$or') return cond.some((f) => matches(doc, f))
        if (key === '$expr') return evalExpr(doc, cond)
        const value = getPath(doc, key)
        if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
            return Object.entries(cond).every(([op, arg]) => {
                if (op === '$gt') return value != null && value > arg
                if (op === '$gte') return value != null && value >= arg
                if (op === '$lt') return value != null && value < arg
                if (op === '$lte') return value != null && value <= arg
                if (op === '$ne') return value !== arg
                if (op === '$exists') return (arg ? value !== undefined : value === undefined)
                if (op === '$in') return Array.isArray(arg) && arg.includes(value)
                throw new Error(`fakeMongo: unsupported operator ${op}`)
            })
        }
        return value === cond
    })
}

function applyUpdate(doc, update) {
    if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
            setPath(doc, k, v)
        }
    }
    if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
            doc[k] = (doc[k] || 0) + v
        }
    }
    if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
            delete doc[k]
        }
    }
}

function makeCollection(docs) {
    const calls = { findOne: [], updateOne: [], findOneAndUpdate: [], find: [], insertOne: [], deleteOne: [], deleteMany: [] }
    return {
        calls,
        async insertOne(doc) {
            calls.insertOne.push(doc)
            docs.push(doc)
            return { insertedId: doc._id ?? `fake-${docs.length}` }
        },
        async findOne(filter) {
            calls.findOne.push(filter)
            return docs.find((d) => matches(d, filter)) || null
        },
        find(filter) {
            calls.find.push(filter)
            const matched = docs.filter((d) => matches(d, filter))
            return {
                project(proj) {
                    const included = Object.keys(proj || {}).filter((k) => proj[k])
                    // Dot-path aware ('compute.level' → { compute: { level } }),
                    // matching Mongo's inclusion projection semantics.
                    const projected = included.length
                        ? matched.map((d) => {
                              const out = {}
                              for (const k of included) {
                                  const v = getPath(d, k)
                                  if (v !== undefined) setPath(out, k, v)
                              }
                              return out
                          })
                        : matched
                    return { sort() { return this }, toArray: async () => projected }
                },
                sort() { return this },
                toArray: async () => matched,
            }
        },
        async updateOne(filter, update) {
            calls.updateOne.push({ filter, update })
            const doc = docs.find((d) => matches(d, filter))
            if (!doc) return { matchedCount: 0, modifiedCount: 0 }
            applyUpdate(doc, update)
            return { matchedCount: 1, modifiedCount: 1 }
        },
        async findOneAndUpdate(filter, update) {
            calls.findOneAndUpdate.push({ filter, update })
            const doc = docs.find((d) => matches(d, filter))
            if (!doc) return null
            applyUpdate(doc, update)
            return doc
        },
        async deleteOne(filter) {
            calls.deleteOne.push(filter)
            const index = docs.findIndex((d) => matches(d, filter))
            if (index === -1) return { deletedCount: 0 }
            docs.splice(index, 1)
            return { deletedCount: 1 }
        },
        async deleteMany(filter) {
            calls.deleteMany.push(filter)
            let deletedCount = 0
            // Backwards so splice does not shift the docs still to check.
            for (let i = docs.length - 1; i >= 0; i--) {
                if (matches(docs[i], filter)) {
                    docs.splice(i, 1)
                    deletedCount++
                }
            }
            return { deletedCount }
        },
    }
}

/**
 * @param {Record<string, object[]>} collections collection name → mutable docs
 */
export function fakeDb(collections = {}) {
    const cols = new Map(Object.entries(collections).map(([name, docs]) => [name, makeCollection(docs)]))
    return {
        collection(name) {
            if (!cols.has(name)) cols.set(name, makeCollection([]))
            return cols.get(name)
        },
    }
}
