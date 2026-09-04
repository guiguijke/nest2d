
import { describe, expect, it } from 'vitest'
import { smallLattice, ringDist, rotateRing } from '../composables/structureClient'

// Anneau scallopé RÉEL (Piece_Fillx4, même géométrie que le banc — 52
// sommets, festons fins). Constat 2026-09-02 : la validation des pas du
// lattice courait sur un anneau décimé et acceptait des pas qui
// CHEVAUCHENT l'anneau réel (95 paires à ~33 mm² sur le run navigateur
// 2×1000×1000, tôle 2). Ce test verrouille l'acceptation exacte.
const SCALLOP = [
        [-19.799, 22.6274],
        [-19.4618, 22.959],
        [-19.119, 23.2848],
        [-18.7708, 23.6048],
        [-18.4172, 23.9189],
        [-18.0584, 24.2269],
        [-17.6944, 24.5289],
        [-17.3253, 24.8246],
        [-16.9514, 25.1141],
        [-16.5726, 25.3972],
        [-16.189, 25.6739],
        [-15.8009, 25.9441],
        [-15.4082, 26.2076],
        [-15.0111, 26.4645],
        [-14.6098, 26.7147],
        [-14.2043, 26.958],
        [-13.7947, 27.1945],
        [-13.3812, 27.424],
        [-12.9639, 27.6465],
        [-12.5429, 27.8619],
        [-12.1183, 28.0702],
        [-11.6903, 28.2713],
        [-11.2589, 28.4651],
        [-10.8243, 28.6516],
        [-10.3866, 28.8307],
        [-9.9459, 29.0024],
        [-9.5025, 29.1667],
        [-9.0563, 29.3234],
        [-8.6075, 29.4726],
        [-8.1563, 29.6142],
        [-7.7027, 29.7481],
        [-7.2469, 29.8744],
        [-6.7891, 29.9929],
        [-6.3293, 30.1037],
        [-5.8678, 30.2067],
        [-5.4045, 30.3019],
        [-4.9398, 30.3892],
        [-4.4736, 30.4687],
        [-4.0061, 30.5404],
        [-3.5375, 30.6041],
        [-3.0679, 30.6599],
        [-2.5974, 30.7077],
        [-2.1261, 30.7476],
        [-1.6543, 30.7795],
        [-1.182, 30.8035],
        [-0.7093, 30.8194],
        [-0.2365, 30.8274],
        [0.2365, 30.8274],
        [0.7093, 30.8194],
        [1.182, 30.8035],
        [1.6543, 30.7795],
        [2.1261, 30.7476],
        [2.5974, 30.7077],
        [3.0679, 30.6599],
        [3.5375, 30.6041],
        [4.0061, 30.5404],
        [4.4736, 30.4687],
        [4.9398, 30.3892],
        [5.4045, 30.3019],
        [5.8678, 30.2067],
        [6.3293, 30.1037],
        [6.7891, 29.9929],
        [7.2469, 29.8744],
        [7.7027, 29.7481],
        [8.6075, 29.4726],
        [9.0563, 29.3234],
        [9.5025, 29.1667],
        [9.9459, 29.0024],
        [10.3866, 28.8307],
        [10.8243, 28.6516],
        [11.2589, 28.4651],
        [11.6903, 28.2713],
        [12.1183, 28.0702],
        [12.5429, 27.8619],
        [12.9639, 27.6465],
        [13.3812, 27.424],
        [13.7947, 27.1945],
        [14.2043, 26.958],
        [14.6098, 26.7147],
        [15.0111, 26.4645],
        [15.4082, 26.2076],
        [15.8009, 25.9441],
        [16.189, 25.6739],
        [16.5726, 25.3972],
        [16.9514, 25.1141],
        [17.3253, 24.8246],
        [17.6944, 24.5289],
        [18.0584, 24.2269],
        [18.4172, 23.9189],
        [18.7708, 23.6048],
        [19.119, 23.2848],
        [19.4618, 22.959],
        [19.799, 22.6274],
        [0.0, 2.8284],
        [-19.799, 22.6274],
    ]

const placedRing = (p) => {
    const r = rotateRing(SCALLOP, p.transformation.rotation)
    const [tx, ty] = p.transformation.translation
    return r.map(([x, y]) => [x + tx, y + ty])
}

describe('smallLattice — anneau scallopé réel (régression 2026-09-02)', () => {
    it('bande verticale 547×999 : toutes les poses mutuellement ≥ space (anneau complet)', { timeout: 60_000 }, () => {
        const lat = smallLattice(
            { id: 1, coords: SCALLOP, rotations: [0, 90, 180, 270] },
            0.1, [451.1, 0.1, 998.4, 999.9], { want: 120, axis: 'x' })
        expect(lat).not.toBeNull()
        expect(lat.length).toBeGreaterThanOrEqual(60)
        const rings = lat.map(placedRing)
        let mind = Infinity
        for (let i = 0; i < rings.length; i++) {
            for (let j = i + 1; j < rings.length; j++) {
                const bbA = rings[i].reduce(([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)], [Infinity, Infinity, -Infinity, -Infinity])
                const bbB = rings[j].reduce(([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)], [Infinity, Infinity, -Infinity, -Infinity])
                if (bbA[2] + 0.1 < bbB[0] || bbB[2] + 0.1 < bbA[0] || bbA[3] + 0.1 < bbB[1] || bbB[3] + 0.1 < bbA[1]) continue
                mind = Math.min(mind, ringDist(rings[i], rings[j]))
            }
        }
        expect(mind).toBeGreaterThanOrEqual(0.1 - 0.02)
    })
})
