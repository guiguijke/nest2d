// Aggregate a V8 .cpuprofile: self time by function, overall and inside the
// window [winStart, winEnd] ms relative to profile start.
import fs from 'node:fs'
const [file, ws, we] = process.argv.slice(2)
const p = JSON.parse(fs.readFileSync(file, 'utf8'))
const byId = new Map(p.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id)
const t0 = p.startTime
let t = t0
const times = []
for (let i = 0; i < p.samples.length; i++) { t += p.timeDeltas[i]; times.push((t - t0) / 1000) }
const label = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`
function agg(from, to) {
  const self = new Map(), incl = new Map()
  let total = 0
  for (let i = 0; i < p.samples.length; i++) {
    if (times[i] < from || times[i] > to) continue
    const dt = (p.timeDeltas[i + 1] ?? 2000) / 1000
    total += dt
    let id = p.samples[i]
    const n = byId.get(id)
    self.set(label(n), (self.get(label(n)) || 0) + dt)
    const seen = new Set()
    while (id != null) {
      const l = label(byId.get(id))
      if (!seen.has(l)) { incl.set(l, (incl.get(l) || 0) + dt); seen.add(l) }
      id = parent.get(id)
    }
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${(v / 1000).toFixed(2)}s  ${k}`).join('\n')
  return `total ${(total / 1000).toFixed(2)}s\n-- self --\n${top(self)}\n-- inclusive --\n${top(incl)}`
}
console.log(`profile ${(times.at(-1) / 1000).toFixed(1)}s, ${p.samples.length} samples`)
console.log(`\n=== window ${ws}-${we} ms ===\n` + agg(Number(ws), Number(we)))
// find the busiest 1 s bucket to locate the freeze
const buckets = new Map()
for (let i = 0; i < times.length; i++) {
  const n = byId.get(p.samples[i]); const fn = n.callFrame.functionName
  if (fn === '(idle)' || fn === '(program)' || fn === '(garbage collector)' && false) continue
  const b = Math.floor(times[i] / 1000); buckets.set(b, (buckets.get(b) || 0) + (p.timeDeltas[i + 1] ?? 2000) / 1000)
}
console.log('\nbusiest seconds (ms busy):', [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([b, v]) => `${b}s:${Math.round(v)}`).join('  '))
