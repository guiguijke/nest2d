/**
 * J-090 (import 100 % navigateur) : construction côté client du payload
 * moteur — port EXACT de ce que le worker Python assemble pour un job local
 * (workers/nesting/core/main.py `nesting_process`, branche
 * `computeLocation == "local"` + core/nesting_input_builder.py). Pour un
 * projet « local », RIEN ne transite par le serveur : géométrie lue depuis
 * IndexedDB (localFilesStore), instance assemblée ici, solve wasm dans le
 * navigateur (localJobPrivate/localCompute).
 *
 * Références Python portées (vérité = le Python, verrous =
 * app/tests/localPayloadBuilder.test.js contre fixtures générées par le
 * pipeline Python) :
 *   a) input_items : ids séquentiels 0..n-1 (fichier × pièce), rotations
 *      [0,90,180,270] par défaut, simplification Douglas-Peucker 0.05 mm
 *      (SIMPLIFY_MM) des anneaux AVANT tout — garde validité : anneau
 *      simplifié auto-intersectant ou < 3 points ⇒ anneau d'origine
 *      conservé (miroir du preserve_topology shapely de _simplify_part).
 *   b) couleurs : part.color sinon fallback déterministe
 *      sha1(`${slug}:${index}`)[0] % 24 sur PART_PALETTE — même palette que
 *      server/utils/colors.js et worker_common/colors.py (sync manuelle :
 *      le module serveur importe node:crypto, inimportable navigateur).
 *   c) feasibility pre-check : bbox du polygone tourné (anti-horaire, y-up,
 *      origine (0,0)) pour chaque rotation permise × chaque tôle ; message
 *      d'erreur au format EXACT de main.py.
 *   d) trous/canaux : hasHoles = fillHoles && channelsUsable(space) &&
 *      au moins un item à trous (piège #2 : au-delà de ~2.4 mm le canal est
 *      scellé par l'inflation — les trous restent fermés, job vivant).
 *      channel_width_for_space / channels_usable : miroirs de
 *      core/holed_polygons.py. L'ouverture elle-même est déléguée au wasm.
 *   e) SPP vs BPP + garde #2b (strip initial déflaté vide).
 *   f) pré-passe meta J-085/J-089 : 1 hôte + 1 filler, capacité pinwheel
 *      VALIDÉE, hôte résolu trous FERMÉS, ids réindexés 0..n-1 (piège #3b),
 *      meta = { host, fill, slots, ringRotations, idMap }.
 *   g) engineConfig : miroir de build_engine_config, profil navigateur
 *      mono-walk (n_workers = separator_workers = 1, piège #14c).
 *   h) seed : sha256 du JSON canonique → 63 bits, en STRING (63 bits > 2^53,
 *      un number JS perdrait des bits — et BSON Int64 côté serveur,
 *      piège #16).
 *   i) parts du payload : coords/holes SIMPLIFIÉS (jamais les anneaux à
 *      canal — miroir de payload_parts).
 *
 * Dépendances injectées (JAMAIS d'import de geometryClient ici — le câblage
 * prod est dans le composable appelant, les tests injectent des stubs) :
 *   - openHoles(coords, holes, spaceMm) → { ring, channels_opened } :
 *     ouverture des trous par canal capillaire (wasm ; la largeur de canal
 *     est calculée côté wasm via channel_width_for_space — on passe
 *     l'ESPACEMENT). Le builder n'utilise que `.ring`.
 *   - pinwheelCapacity(holeRing, fillerCoords, spaceMm, allowedRots|null)
 *     → { rotations: [...] } : rotations du pinwheel validées avec la
 *     sémantique exacte du moteur (trou érodé de `space`, piège #3).
 *
 * Divergences CONNUES et assumées vs le chemin Python (le flux J-090 est
 * construit ET résolu dans le navigateur — la parité cross-impl n'est
 * requise que sur les fixtures de verrouillage) :
 *   - Douglas-Peucker maison sans preserve_topology : la garde validité
 *     (auto-intersection, < 3 points, aire nulle) remplace la garantie
 *     shapely ; identique sur les fixtures, sinon repli sur l'anneau
 *     d'origine (dégradation sûre, jamais d'anneau cassé).
 *   - JSON canonique : JSON.stringify à clés triées récursivement, sans
 *     espaces. JS ne distingue pas int/float — un float intégral Python
 *     (strip_height 1000.0) s'écrit « 1000 » ici : le seed diffère alors du
 *     seed que le worker Python aurait calculé pour la même géométrie, mais
 *     il est DÉTERMINISTE dans le flux navigateur (le seul qui compte ici).
 *     float64 → string est spécifié ECMA (shortest round-trip) : stable
 *     cross-navigateurs. Non-ASCII échappé en \uXXXX (ensure_ascii Python).
 *   - isSpp exige totalArea > 0 (brief) là où Python exige sheetArea > 0 —
 *     ne diffère que sur l'entrée dégénérée « zéro géométrie ».
 *   - messages d'erreur : `:.0f`/`:.1f`/`round()` Python = arrondi
 *     half-even — porté tel quel ; un espacement entier s'imprime « 2.0 »
 *     (Python le lit toujours en float depuis Mongo).
 */

// ---------------------------------------------------------------------------
// Constantes (miroirs Python)
// ---------------------------------------------------------------------------

// SIMPLIFY_MM (core/main.py) : Douglas-Peucker avant envoi au moteur — les
// DXF exportés sont reconstruits depuis les entités D'ORIGINE, la fidélité
// de coupe est intouchée.
export const SIMPLIFY_MM = 0.05
// SPP_MAX_AREA_RATIO (core/main.py) : SPP seulement si l'aire des pièces
// tient plausiblement sur une tôle.
export const SPP_MAX_AREA_RATIO = 0.80
export const N_ALTERNATIVES_DEFAULT = 3
// Profil navigateur (J-083) si l'appelant ne fournit rien.
export const DEFAULT_TIME_BUDGET_SEC = 13
// PINWHEEL (core/holefill.py) : les 4 rotations du remplissage de trous.
export const PINWHEEL = [0, 90, 180, 270]

// Canaux capillaires (core/holed_polygons.py) — formules portées, voir (d).
export const CHANNEL_WIDTH = 0.01
export const CHANNEL_SEPARATION_MARGIN = 0.1
export const CHANNEL_MAX_WIDTH = 2.5

// 24 couleurs — DOIT rester en sync avec server/utils/colors.js et
// workers/common/worker_common/colors.py (le fallback doit donner la MÊME
// couleur pour un (slug, index) donné en Python, Node et navigateur).
export const PART_PALETTE = [
    '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777',
    '#0D9488', '#EA580C', '#4F46E5', '#65A30D', '#0891B2', '#BE185D',
    '#16A34A', '#9333EA', '#0284C7', '#C026D3', '#CA8A04', '#E11D48',
    '#0F766E', '#9F1239', '#3F6212', '#1D4ED8', '#B45309', '#6D28D9',
]

// ---------------------------------------------------------------------------
// Géométrie de base
// ---------------------------------------------------------------------------

const isClosedRing = (ring) =>
    ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]

/** Aire absolue d'un anneau (shoelace) — égale à l'aire shapely pour des
 * anneaux simples (gère anneau fermé ou non). */
export function ringAreaAbs(ring) {
    let acc = 0
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        const q = ring[(i + 1) % ring.length]
        acc += p[0] * q[1] - q[0] * p[1]
    }
    return Math.abs(acc) / 2
}

/** Aire pièce = |outer| − Σ|trous| (Polygon(coords, holes).area côté Python). */
export function partArea(coords, holes) {
    let area = ringAreaAbs(coords)
    for (const h of holes || []) area -= ringAreaAbs(h)
    return area
}

/** Bbox [w, h] d'un anneau. */
function ringBBoxSize(ring) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
    }
    return [maxX - minX, maxY - minY]
}

/** Bbox [w, h] de l'anneau tourné de `angleDeg` (anti-horaire, y-up, autour
 * de (0,0) — miroir de shapely.affinity.rotate). */
function rotatedBBoxSize(ring, angleDeg) {
    if (!angleDeg) return ringBBoxSize(ring)
    const r = (angleDeg * Math.PI) / 180
    const c = Math.cos(r)
    const s = Math.sin(r)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
        const rx = c * x - s * y
        const ry = s * x + c * y
        if (rx < minX) minX = rx
        if (ry < minY) minY = ry
        if (rx > maxX) maxX = rx
        if (ry > maxY) maxY = ry
    }
    return [maxX - minX, maxY - minY]
}

// ---------------------------------------------------------------------------
// Douglas-Peucker + garde validité (miroir de _simplify_part, SIMPLIFY_MM)
// ---------------------------------------------------------------------------

/** Distance point ↔ segment AU CARRÉ (bornée — GEOS DouglasPeuckerSimplifier
 * utilise pointToSegment, pas la distance à la droite porteuse). Comparée en
 * quadratique : + − × ÷ sont IEEE-exacts partout (Math.hypot/sqrt n'ont pas
 * d'arrondi spécifié ECMA) — décisions DP identiques sur tous les
 * navigateurs (esprit piège #14b : le seed doit être reproductible). */
function pointSegmentDistanceSq(p, a, b) {
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const l2 = abx * abx + aby * aby
    const dx = p[0] - a[0]
    const dy = p[1] - a[1]
    if (l2 === 0) return dx * dx + dy * dy
    let t = (dx * abx + dy * aby) / l2
    t = Math.max(0, Math.min(1, t))
    const ex = dx - t * abx
    const ey = dy - t * aby
    return ex * ex + ey * ey
}

/** DP itératif sur anneau OUVERT (sans le point de fermeture dupliqué) :
 * la séquence ancrée est [...open, open[0]] — l'arête de fermeture
 * participe. Renvoie l'anneau ouvert réduit (sous-ensemble, ordre conservé).
 * Distances comparées au carré (d² > tol² ⟺ d > tol). */
function douglasPeuckerRing(open, tol) {
    const seq = [...open, open[0]]
    const tol2 = tol * tol
    const keep = new Uint8Array(seq.length)
    keep[0] = 1
    keep[seq.length - 1] = 1
    const stack = [[0, seq.length - 1]]
    while (stack.length) {
        const [a, b] = stack.pop()
        if (b <= a + 1) continue
        let dmax = 0
        let idx = -1
        for (let i = a + 1; i < b; i++) {
            const d = pointSegmentDistanceSq(seq[i], seq[a], seq[b])
            if (d > dmax) {
                dmax = d
                idx = i
            }
        }
        if (dmax > tol2 && idx >= 0) {
            keep[idx] = 1
            stack.push([a, idx], [idx, b])
        }
    }
    const out = []
    for (let i = 0; i < seq.length - 1; i++) {
        if (keep[i]) out.push(seq[i])
    }
    return out
}

const orient = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

const onSegment = (a, b, p) =>
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
    && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])

/** Intersection segments (le contact compte — conservateur : le moindre
 * toucher non adjacent invalide l'anneau simplifié ⇒ repli sur l'original). */
function segmentsIntersect(a, b, c, d) {
    // Segments de longueur nulle (points dupliqués) : ne croisent rien.
    if ((a[0] === b[0] && a[1] === b[1]) || (c[0] === d[0] && c[1] === d[1])) return false
    const o1 = orient(a, b, c)
    const o2 = orient(a, b, d)
    const o3 = orient(c, d, a)
    const o4 = orient(c, d, b)
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
    if (o1 === 0 && onSegment(a, b, c)) return true
    if (o2 === 0 && onSegment(a, b, d)) return true
    if (o3 === 0 && onSegment(c, d, a)) return true
    if (o4 === 0 && onSegment(c, d, b)) return true
    return false
}

/** Auto-intersection d'un anneau ouvert (O(n²), segments adjacents exclus —
 * n = anneau APRÈS réduction DP, ~5× plus court que la source). */
export function ringSelfIntersects(open) {
    const n = open.length
    for (let i = 0; i < n; i++) {
        const a = open[i]
        const b = open[(i + 1) % n]
        for (let j = i + 1; j < n; j++) {
            if (j === i + 1) continue // adjacent
            if (i === 0 && j === n - 1) continue // adjacents par la fermeture
            if (segmentsIntersect(a, b, open[j], open[(j + 1) % n])) return true
        }
    }
    return false
}

/**
 * Simplifie UN anneau (DP tolérance SIMPLIFY_MM). Garde-fou (miroir du
 * rôle de preserve_topology côté shapely) : anneau réduit à < 3 points,
 * aire nulle (miroir de `is_empty`) ou auto-intersectant ⇒ anneau
 * D'ORIGINE conservé (dégradation sûre). L'anneau retourné est fermé.
 */
export function simplifyRing(ring, tol = SIMPLIFY_MM) {
    const original = ring.map((p) => [...p])
    const open = isClosedRing(ring) ? ring.slice(0, -1) : ring.slice()
    if (open.length <= 3) return original
    const kept = douglasPeuckerRing(open, tol)
    if (kept.length < 3) return original
    if (ringAreaAbs(kept) === 0) return original
    if (ringSelfIntersects(kept)) return original
    return [...kept.map((p) => [...p]), [...kept[0]]]
}

/** Miroir de core/main.py `_simplify_part` : allège outer + trous. */
export function simplifyPart(coords, holes, tol = SIMPLIFY_MM) {
    if (tol <= 0) {
        return {
            coords: (coords || []).map((p) => [...p]),
            holes: (holes || []).map((h) => h.map((p) => [...p])),
        }
    }
    return {
        coords: simplifyRing(coords || [], tol),
        holes: (holes || []).map((h) => simplifyRing(h, tol)),
    }
}

// ---------------------------------------------------------------------------
// Canaux capillaires (miroir de core/holed_polygons.py)
// ---------------------------------------------------------------------------

/** Largeur de canal survivant à l'inflation min_item_separation de jagua
 * (±space/2 de chaque côté ⇒ le canal se referme de `space` : il doit être
 * strictement plus large, plafonné à CHANNEL_MAX_WIDTH). */
export function channelWidthForSpace(space) {
    const s = Number(space) || 0
    return Math.min(Math.max(CHANNEL_WIDTH, s + CHANNEL_SEPARATION_MARGIN), CHANNEL_MAX_WIDTH)
}

/** Les canaux survivent-ils à l'inflation ? Au-delà de ~2.4 mm
 * d'espacement, le plafond de largeur scelle le canal — et l'anneau écrasé
 * casse l'import moteur (piège #2) : les trous DOIVENT rester fermés. */
export function channelsUsable(space) {
    return channelWidthForSpace(space) > (Number(space) || 0)
}

// ---------------------------------------------------------------------------
// Couleurs (fallback déterministe — sync colors.py / server/utils/colors.js)
// ---------------------------------------------------------------------------

async function sha1FirstByte(text) {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
    return new Uint8Array(digest)[0]
}

/** Fallback déterministe : sha1(`${slug}:${index}`), 1er octet % 24. */
export async function colorForPart(slug, index) {
    return PART_PALETTE[(await sha1FirstByte(`${slug}:${index}`)) % PART_PALETTE.length]
}

// ---------------------------------------------------------------------------
// JSON canonique + seed (miroir de deterministic_seed, convention JS)
// ---------------------------------------------------------------------------

/** Échappement chaîne identique à json.dumps(ensure_ascii=True) : non-ASCII
 * en \uXXXX (paires de surrogates pour l'astral), contrôles en courts. */
function jsonString(s) {
    let out = '"'
    for (const ch of String(s)) {
        const cp = ch.codePointAt(0)
        if (ch === '"') out += '\\"'
        else if (ch === '\\') out += '\\\\'
        else if (ch === '\n') out += '\\n'
        else if (ch === '\r') out += '\\r'
        else if (ch === '\t') out += '\\t'
        else if (ch === '\b') out += '\\b'
        else if (ch === '\f') out += '\\f'
        else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, '0')}`
        else if (cp < 0x7f) out += ch
        else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`
        else {
            const v = cp - 0x10000
            out += `\\u${(0xd800 + (v >> 10)).toString(16)}\\u${(0xdc00 + (v & 0x3ff)).toString(16)}`
        }
    }
    return `${out}"`
}

/**
 * JSON canonique déterministe : clés triées récursivement, sans espaces —
 * convention JSON.stringify (les float64 → string sont spécifiés ECMA,
 * shortest round-trip : stable cross-navigateurs). undefined dans un objet
 * = clé omise (comme JSON.stringify) ; NaN/Infinity → null.
 */
export function canonicalJson(value) {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 'null'
        return String(value)
    }
    if (typeof value === 'string') return jsonString(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
    return `{${keys.map((k) => `${jsonString(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

/**
 * Seed 63 bits déterministe : sha256 du JSON canonique, premiers 8 octets
 * big-endian & 0x7FFFFFFFFFFFFFFF — miroir de deterministic_seed. Renvoyé
 * en STRING (63 bits > 2^53 : un number JS perdrait des bits ; piège #16).
 */
export async function deterministicSeed(payload) {
    const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(payload))),
    )
    let v = 0n
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(digest[i])
    return (v & 0x7fffffffffffffffn).toString()
}

// ---------------------------------------------------------------------------
// Formatage Python exact des messages d'erreur (round half-even)
// ---------------------------------------------------------------------------

/** Arrondi half-even de x·scale à l'entier (miroir du formatage Python :
 * `round()` et `:.Nf` arrondissent au pair sur la valeur binaire). */
function roundHalfEvenScaled(x, scale) {
    const y = x * scale
    const floor = Math.floor(y)
    const diff = y - floor
    if (diff > 0.5) return floor + 1
    if (diff < 0.5) return floor
    return floor % 2 === 0 ? floor : floor + 1
}

const pyFixed0 = (x) => String(roundHalfEvenScaled(x, 1))
const pyFixed1 = (x) => (roundHalfEvenScaled(x, 10) / 10).toFixed(1)
const pyRoundInt = (x) => String(roundHalfEvenScaled(x, 1))

/** str() Python d'un nombre lu en float depuis Mongo : un entier s'imprime
 * « 2.0 » ; 0 vient du `or 0` (int) et s'imprime « 0 ». */
const pyStrSpace = (v) => {
    if (v === 0) return '0'
    return Number.isInteger(v) ? `${v}.0` : String(v)
}

// ---------------------------------------------------------------------------
// Plateau adaptatif (miroir de adaptive_plateau_patience_sec, J-083)
// ---------------------------------------------------------------------------

export function adaptivePlateauPatienceSec(timeBudgetSec, nParts, nVertices, hasHoles) {
    const base = 2.0
        + nVertices / 1500
        + (hasHoles ? Math.min(3, nParts / 15) : 0)
        + Math.min(6, nParts / 20)
    return Math.max(2, Math.min(base, 30, Number(timeBudgetSec)))
}

// ---------------------------------------------------------------------------
// Instance jagua (miroir de nesting_input_builder.py)
// ---------------------------------------------------------------------------

function buildItem(id, demand, points, allowedOrientations) {
    return {
        id,
        demand,
        allowed_orientations: allowedOrientations,
        shape: { type: 'simple_polygon', data: points },
    }
}

function buildBin(binId, stock, width, height) {
    return {
        id: binId,
        cost: 1,
        stock,
        shape: {
            type: 'polygon',
            data: { outer: [[0, 0], [width, 0], [width, height], [0, height], [0, 0]] },
        },
    }
}

/** Miroir de holefill.meta_slots : (slots par position d'hôte, reste). */
function metaSlots(inputItems, hostId, fillId, capacity) {
    const hostQty = inputItems.find((i) => i.id === hostId).count
    const fillQty = inputItems.find((i) => i.id === fillId).count
    const slots = []
    let remaining = fillQty
    for (let h = 0; h < hostQty; h++) {
        const k = Math.min(capacity, remaining)
        slots.push(k)
        remaining -= k
    }
    return { slots, remaining }
}

// ---------------------------------------------------------------------------
// Construction principale
// ---------------------------------------------------------------------------

/**
 * Assemble le payload moteur 100 % navigateur.
 *
 * @param {object} args
 * @param {Array}  args.files   [{ slug, name, count, rotations?, parts: [...] }]
 *                              (géométrie IndexedDB déjà chargée par l'appelant)
 * @param {object} args.params  { sheets: [{width,height,count}], space,
 *                              fillHoles?, addOutShape?, outputUnit?,
 *                              directions?, alternativesCount?, name? }
 * @param {object} args.profile profil navigateur (BROWSER_COMPUTE) :
 *                              { timeBudgetSec?, vcores?, maxDirections?,
 *                              level? } — 13 s / 1 vcore / 1 direction par
 *                              défaut.
 * @param {object} deps         { openHoles, pinwheelCapacity } — async, voir
 *                              l'en-tête (geoClient en prod, stubs en test).
 * @returns {Promise<{ payload: { problem, instance, meta, engineConfig,
 *   parts, outputUnit, addOutShape }, seed: string, itemMap: Array }>}
 *   - payload : la forme EXACTE du localPayload Python ;
 *   - seed : graine 63 bits en string (aussi dans engineConfig.prng_seed) ;
 *   - itemMap : [{ id, slug, part }] — part = index de la pièce dans son
 *     fichier (compteur par file_slug, ordre des input_items ; miroir de
 *     main.py part_index_by_id). La vue live mappe ids moteur → fichier/pièce.
 */
export async function buildLocalPayload({ files, params = {}, profile = {} }, deps = {}) {
    const space = Number(params.space) || 0
    // fillHoles : défaut ON (rétro-compat, miroir de params.get("fillHoles", True))
    const fillHoles = params.fillHoles !== false
    const addOutShape = Boolean(params.addOutShape)
    const outputUnit = params.outputUnit || 'mm'
    const sheets = (params.sheets || []).map((s) => ({
        width: Number(s.width),
        height: Number(s.height),
        count: Math.trunc(Number(s.count)),
    }))
    if (!sheets.length) throw new Error('buildLocalPayload: params.sheets requis (au moins une tôle)')
    const name = params.name || 'nest2d'

    // Profil navigateur (valeurs de l'appelant ; défauts documentés).
    const timeBudgetSec = Math.trunc(Number(profile.timeBudgetSec ?? DEFAULT_TIME_BUDGET_SEC))
    const explicitDirs = Array.isArray(params.directions) && params.directions.length
    let directions = explicitDirs ? params.directions.slice() : null
    const maxDirections = Math.trunc(Number(profile.maxDirections ?? 0))
    if (directions && maxDirections > 0) directions = directions.slice(0, maxDirections)
    // Production (UI / local-payload) envoie alternativesCount ou directions.
    // Sans les deux : défaut historique 3 (fixtures de parité Python).
    const nAlternatives = Math.max(
        1,
        Math.trunc(Number(
            params.alternativesCount
            ?? (explicitDirs ? directions.length : N_ALTERNATIVES_DEFAULT),
        )),
    )

    // a) input_items : ids séquentiels fichier × pièce, géométrie simplifiée
    //    AVANT tout (miroir de convert_files_to_input_items).
    const inputItems = []
    for (const file of files || []) {
        const fileSlug = file.slug
        const count = file.count
        const rotations = file.rotations ?? [0, 90, 180, 270]
        const parts = file.parts || []
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex]
            const { coords, holes } = simplifyPart(
                part.coordinates ?? part.coords ?? [],
                part.holes ?? [],
            )
            inputItems.push({
                id: inputItems.length,
                file_slug: fileSlug,
                coords,
                holes,
                handles: part.handles,
                count,
                rotations,
                // Couleur d'affichage persistée à l'import ; fallback
                // déterministe sinon (resolve_part_color côté Python).
                color: part.color || (await colorForPart(fileSlug, partIndex)),
            })
        }
    }

    // itemMap : id moteur → (fichier, index de la pièce DANS son fichier) —
    // miroir exact de part_index_by_id/per_file_counter (main.py 560-571).
    const itemMap = []
    const perFileCounter = new Map()
    for (const item of inputItems) {
        const part = perFileCounter.get(item.file_slug) ?? 0
        itemMap.push({ id: item.id, slug: item.file_slug, part })
        perFileCounter.set(item.file_slug, part + 1)
    }

    // c) Feasibility pre-check : une pièce dont la bbox (+ l'espacement,
    //    appliqué par le moteur de chaque côté) ne rentre dans AUCUNE tôle
    //    dans AUCUNE rotation permise ne sera jamais placée — échec immédiat
    //    avec le message EXACT du worker Python.
    const unplaceable = []
    for (const item of inputItems) {
        const rotations = item.rotations?.length ? item.rotations : [0]
        let fitsAnywhere = false
        for (const angle of rotations) {
            const [w, h] = rotatedBBoxSize(item.coords, Number(angle) || 0)
            for (const sheet of sheets) {
                if (w + space <= sheet.width + 1e-6 && h + space <= sheet.height + 1e-6) {
                    fitsAnywhere = true
                    break
                }
            }
            if (fitsAnywhere) break
        }
        if (!fitsAnywhere) {
            const [w, h] = ringBBoxSize(item.coords)
            unplaceable.push({ name: item.file_slug, width: w, height: h, count: item.count })
        }
    }
    if (unplaceable.length) {
        const details = unplaceable
            .slice(0, 5)
            .map((p) => `'${p.name}' (${pyFixed0(p.width)}x${pyFixed0(p.height)}mm, x${p.count})`)
            .join(', ')
        const sheetDesc = sheets.map((s) => `${pyFixed0(s.width)}x${pyFixed0(s.height)}mm`).join(' / ')
        throw new Error(
            `Part(s) too large for the sheet: ${details} — sheet(s): ${sheetDesc}, `
            + `spacing: ${pyStrSpace(space)}mm. Use a larger sheet, allow more rotations, or reduce spacing.`,
        )
    }

    // d) Trous / canaux : le canal plus large que l'inflation sinon jagua le
    //    scelle (piège #2) ; au-delà, les trous restent fermés (dégradation
    //    sûre). L'ouverture est faite par le wasm (dep openHoles) — on lui
    //    passe l'espacement, la largeur est calculée côté wasm.
    const hasHoles = fillHoles && channelsUsable(space) && inputItems.some((it) => it.holes?.length)

    // e) Items jagua + aire totale (shoelace = aire shapely, anneaux simples).
    const jaguarItems = []
    let totalRequestedCount = 0
    let totalPartArea = 0
    for (const item of inputItems) {
        const allowedOrientations = item.rotations ?? [0, 90, 180, 270]
        let shapeCoords = item.coords
        if (hasHoles && item.holes?.length) {
            if (typeof deps.openHoles !== 'function') {
                throw new Error('buildLocalPayload: dep openHoles requise (instance à trous)')
            }
            const opened = await deps.openHoles(item.coords, item.holes, space)
            shapeCoords = opened.ring
        }
        jaguarItems.push(buildItem(item.id, item.count, shapeCoords, allowedOrientations))
        totalRequestedCount += item.count
        totalPartArea += partArea(item.coords, item.holes) * item.count
    }

    // SPP (une seule tôle physique = la bande, largeur minimisée) seulement
    // si le stock déclaré est UNE tôle ET que l'aire tient à 80 %. count > 1
    // → BPP : sparrow ne peut pas répartir sur plusieurs tôles, et un job
    // démo 3×3000×1500 en SPP échoue (« no feasible solution in directions
    // mode ») même quand l'aire tient statistiquement sur une plaque.
    const sheetArea = sheets[0].width * sheets[0].height
    const totalStock = sheets.reduce((n, s) => n + (Number(s.count) || 1), 0)
    // –X (left seul) = strip : on minimise la largeur même si le stock
    // déclaré est > 1 (défaut UI historique 100 tôles → BPP, packing en
    // rangées, pas un –X). Démo count=3 sans left-only reste BPP.
    const leftOnly = Array.isArray(directions)
        && directions.length === 1
        && directions[0] === 'left'
    const isSpp = sheets.length === 1
        && totalPartArea > 0
        && totalPartArea <= sheetArea * SPP_MAX_AREA_RATIO
        && (totalStock === 1 || leftOnly)

    // Garde #2b : jagua initialise la bande à aire_totale/hauteur puis la
    // DÉFLATE de space/2 — si l'espacement dépasse cette largeur initiale,
    // l'offset sort vide et le moteur panique dans un thread rayon.
    if (isSpp && space > 0 && totalPartArea / sheets[0].height <= space) {
        throw new Error(
            `Spacing ${pyStrSpace(space)} mm is too large for this instance: parts total `
            + `${pyRoundInt(totalPartArea)} mm² on a ${pyFixed0(sheets[0].height)} mm-high sheet `
            + `(initial strip width ${pyFixed1(totalPartArea / sheets[0].height)} mm). `
            + `Reduce the spacing or add more parts/stock.`,
        )
    }

    let instance
    let maxStripWidth
    if (isSpp) {
        instance = { name, items: jaguarItems, strip_height: sheets[0].height }
        maxStripWidth = sheets[0].width
    } else {
        instance = {
            name,
            items: jaguarItems,
            bins: sheets.map((s, i) => buildBin(i, s.count, s.width, s.height)),
        }
        maxStripWidth = undefined
    }

    // D-MOT-16 : trous d'abord (SPP et BPP, pièces mixtes). Packer générique
    // + repli J-085. Ids RÉINDEXÉS 0..n-1 (piège #3b).
    let meta = null
    let solveInstance = instance
    if (hasHoles) {
        const { planHoleFills, reduceForSolve } = await import('./localBridge')
        let packs = null
        try {
            packs = planHoleFills(inputItems, space)
        } catch {
            packs = null
        }
        // Repli test/prod : si le packer JS n'a rien et qu'une dep pinwheel
        // est fournie, tenter le chemin 1+1 historique (stubs de test).
        if (!packs && typeof deps.pinwheelCapacity === 'function') {
            const hosts = inputItems.filter((it) => it.holes?.length)
            const fills = inputItems.filter((it) => !it.holes?.length)
            if (hosts.length === 1 && fills.length === 1) {
                const hostItem = hosts[0]
                const fillItem = fills[0]
                const fillRotations = fillItem.rotations?.length ? fillItem.rotations : PINWHEEL
                const allowedRots = PINWHEEL.filter((r) => fillRotations.includes(r))
                const ringRotations = []
                for (const ring of hostItem.holes) {
                    const res = await deps.pinwheelCapacity(ring, fillItem.coords, space, allowedRots)
                    ringRotations.push(res?.rotations || [])
                }
                const capacity = ringRotations.reduce((n, rr) => n + rr.length, 0)
                const full = ringRotations.length > 0
                    && ringRotations.every((rr) => rr.length === allowedRots.length)
                if (capacity && full) {
                    const { slots } = metaSlots(inputItems, hostItem.id, fillItem.id, capacity)
                    const cxcy = (ring) => {
                        let sx = 0; let sy = 0
                        for (const p of ring) { sx += p[0]; sy += p[1] }
                        return [sx / ring.length, sy / ring.length]
                    }
                    const area = (fillItem.coords || []).reduce((a, p, i, arr) => {
                        const q = arr[(i + 1) % arr.length]
                        return a + p[0] * q[1] - q[0] * p[1]
                    }, 0)
                    const fillArea = Math.abs(area) * 0.5
                    packs = slots.map((k) => {
                        const poses = []
                        let left = k
                        for (let ri = 0; ri < hostItem.holes.length && left > 0; ri++) {
                            const [cx, cy] = cxcy(hostItem.holes[ri])
                            for (const rot of ringRotations[ri] || []) {
                                if (left <= 0) break
                                poses.push({ fillId: fillItem.id, rot, lx: cx, ly: cy, area: fillArea })
                                left -= 1
                            }
                        }
                        return { hostId: hostItem.id, fills: poses }
                    })
                }
            }
        }
        if (packs) {
            const reduced = reduceForSolve(inputItems, jaguarItems, packs, space)
            meta = reduced.meta
            if (reduced.reduced.length) {
                solveInstance = isSpp
                    ? { name, items: reduced.reduced, strip_height: sheets[0].height }
                    : { name, items: reduced.reduced, bins: instance.bins }
            } else {
                meta = null
            }
        }
    }

    // h) Seed déterministe (instance + espacement + budget — la config est
    //    EXCLUE : un A/B à seed égal reste possible, piège #17).
    const seed = await deterministicSeed({
        instance: solveInstance,
        space,
        budget: timeBudgetSec,
    })

    // g) engineConfig (miroir de build_engine_config). Profil navigateur
    //    mono-walk (#14c) : wasm n'a AUCUN thread OS — le multi-start y
    //    serait séquentiel, temps mur multiplié sans gain de qualité.
    const placedVertices = inputItems.reduce(
        (n, it) => n + ((it.coords?.length || 0) + (it.holes || []).reduce((a, h) => a + h.length, 0)) * (it.count || 1),
        0,
    )
    const engineConfig = {
        time_budget_sec: timeBudgetSec,
        prng_seed: seed,
        n_alternatives: nAlternatives,
        poly_simpl_tolerance: 0.001,
        min_item_separation: space > 0 ? space : null,
        // null explicite : désactive la fermeture de concavités (elle
        // refermerait les canaux des pièces à trous).
        narrow_concavity_cutoff: hasHoles ? null : [0.01, 0.01],
        live_events: true,
        n_workers: Math.trunc(Number(profile.nWorkers ?? 1)),
        separator_workers: Math.trunc(Number(profile.separatorWorkers ?? 1)),
        plateau_patience_sec: adaptivePlateauPatienceSec(
            timeBudgetSec, totalRequestedCount, placedVertices, hasHoles,
        ),
    }
    if (isSpp) engineConfig.max_strip_width = maxStripWidth
    if (directions) engineConfig.biases = directions

    // i) parts du payload : coords/holes SIMPLIFIÉS (jamais les anneaux à
    //    canal), couleur d'affichage, handles DXF (exports copient par
    //    handle) — mêmes données que la finalisation serveur.
    const parts = inputItems.map((it) => ({
        id: it.id,
        file_slug: it.file_slug,
        handles: it.handles || [],
        color: it.color,
        coords: it.coords,
        holes: it.holes || [],
        count: it.count || 0,
    }))

    return {
        payload: {
            problem: isSpp ? 'spp' : 'bpp',
            instance: solveInstance,
            meta,
            engineConfig,
            parts,
            outputUnit,
            addOutShape,
        },
        seed,
        itemMap,
    }
}
