import { describe, expect, it } from 'vitest'
import {
    PART_PALETTE,
    adaptivePlateauPatienceSec,
    buildLocalPayload,
    canonicalJson,
    channelWidthForSpace,
    channelsUsable,
    colorForPart,
    deterministicSeed,
    ringAreaAbs,
    ringSelfIntersects,
    simplifyRing,
} from '../composables/localPayloadBuilder'

// ---------------------------------------------------------------------------
// Fixtures de VERROUILLAGE generees par le pipeline Python de reference
// (workers/nesting/core/main.py branche locale + nesting_input_builder.py,
// holed_polygons.py, holefill.py, colors.py — voir rapport J-090). Le DP JS
// est asserte identique a shapely _simplify_part a la generation.
// Convention canonique : JSON.stringify (floats integraux -> int), seed en
// string (63 bits > 2^53, piege #16).
// ---------------------------------------------------------------------------

const FIXTURE_A = {"input": {"files": [{"slug": "cross-k7m2n9.dxf", "name": "cross.dxf", "count": 3, "rotations": [0, 90, 180, 270], "parts": [{"coordinates": [[20, 0], [30.0, 0.0], [40, 0], [40.0, 10.0], [40, 20], [50.0, 20.0], [60, 20], [60.0, 30.0], [60, 40], [50.0, 40.0], [40, 40], [40.0, 50.0], [40, 60], [30.0, 60.0], [20, 60], [20.0, 50.0], [20, 40], [10.0, 40.0], [0, 40], [0.0, 30.0], [0, 20], [10.0, 20.0], [20, 20], [20.0, 10.0], [20, 0]], "holes": [], "width": 60, "height": 60, "handles": ["A1", "B2"], "color": null}]}, {"slug": "rect-p4q8r3.dxf", "name": "rect.dxf", "count": 2, "rotations": [0, 90], "parts": [{"coordinates": [[0, 0], [40.0, 0.0], [80, 0], [80.0, 25.0], [80, 50], [40.0, 50.0], [0, 50], [0.0, 25.0], [0, 0]], "holes": [], "width": 80, "height": 50, "handles": ["C3"], "color": "#123456"}]}], "params": {"sheets": [{"width": 1500, "height": 1000, "count": 1}], "space": 2, "fillHoles": true, "addOutShape": false, "outputUnit": "mm", "directions": ["left"], "alternativesCount": 3}, "profile": {"timeBudgetSec": 13, "vcores": 1, "maxDirections": 1, "level": "browser"}}, "opened": {}, "expected": {"payload": {"problem": "spp", "instance": {"name": "nest2d", "items": [{"id": 0, "demand": 3, "allowed_orientations": [0, 90, 180, 270], "shape": {"type": "simple_polygon", "data": [[20, 0], [40, 0], [40, 20], [60, 20], [60, 40], [40, 40], [40, 60], [20, 60], [20, 40], [0, 40], [0, 20], [20, 20], [20, 0]]}}, {"id": 1, "demand": 2, "allowed_orientations": [0, 90], "shape": {"type": "simple_polygon", "data": [[0, 0], [80, 0], [80, 50], [0, 50], [0, 0]]}}], "strip_height": 1000.0}, "meta": null, "engineConfig": {"time_budget_sec": 13, "prng_seed": "2392622648408206490", "n_alternatives": 3, "poly_simpl_tolerance": 0.001, "min_item_separation": 2.0, "narrow_concavity_cutoff": [0.01, 0.01], "live_events": true, "max_strip_width": 1500.0, "n_workers": 1, "biases": ["left"], "plateau_patience_sec": 2.2826666666666666, "separator_workers": 1}, "parts": [{"id": 0, "file_slug": "cross-k7m2n9.dxf", "handles": ["A1", "B2"], "color": "#059669", "coords": [[20, 0], [40, 0], [40, 20], [60, 20], [60, 40], [40, 40], [40, 60], [20, 60], [20, 40], [0, 40], [0, 20], [20, 20], [20, 0]], "holes": [], "count": 3}, {"id": 1, "file_slug": "rect-p4q8r3.dxf", "handles": ["C3"], "color": "#123456", "coords": [[0, 0], [80, 0], [80, 50], [0, 50], [0, 0]], "holes": [], "count": 2}], "outputUnit": "mm", "addOutShape": false}, "seed": "2392622648408206490", "itemMap": [{"id": 0, "slug": "cross-k7m2n9.dxf", "part": 0}, {"id": 1, "slug": "rect-p4q8r3.dxf", "part": 0}]}}
const FIXTURE_B = {"input": {"files": [{"slug": "plate-s5t6u7.dxf", "name": "plate.dxf", "count": 4, "parts": [{"coordinates": [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], "holes": [], "width": 100, "height": 100, "handles": [], "color": null}]}], "params": {"sheets": [{"width": 1500, "height": 1000, "count": 1}, {"width": 2000, "height": 1200, "count": 2}], "space": 0, "fillHoles": true, "addOutShape": true, "outputUnit": "inch"}, "profile": {"timeBudgetSec": 13, "vcores": 1, "maxDirections": 1, "level": "browser"}}, "opened": {}, "expected": {"payload": {"problem": "bpp", "instance": {"name": "nest2d", "items": [{"id": 0, "demand": 4, "allowed_orientations": [0, 90, 180, 270], "shape": {"type": "simple_polygon", "data": [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]}}], "bins": [{"id": 0, "cost": 1, "stock": 1, "shape": {"type": "polygon", "data": {"outer": [[0.0, 0.0], [1500.0, 0.0], [1500.0, 1000.0], [0.0, 1000.0], [0.0, 0.0]]}}}, {"id": 1, "cost": 1, "stock": 2, "shape": {"type": "polygon", "data": {"outer": [[0.0, 0.0], [2000.0, 0.0], [2000.0, 1200.0], [0.0, 1200.0], [0.0, 0.0]]}}}]}, "meta": null, "engineConfig": {"time_budget_sec": 13, "prng_seed": "1034089931991362994", "n_alternatives": 3, "poly_simpl_tolerance": 0.001, "min_item_separation": null, "narrow_concavity_cutoff": [0.01, 0.01], "live_events": true, "n_workers": 1, "plateau_patience_sec": 2.2133333333333334, "separator_workers": 1}, "parts": [{"id": 0, "file_slug": "plate-s5t6u7.dxf", "handles": [], "color": "#BE185D", "coords": [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], "holes": [], "count": 4}], "outputUnit": "inch", "addOutShape": true}, "seed": "1034089931991362994", "itemMap": [{"id": 0, "slug": "plate-s5t6u7.dxf", "part": 0}]}}
const FIXTURE_C = {"input": {"files": [{"slug": "fill-v1w2x3.dxf", "name": "fill.dxf", "count": 1, "rotations": [0, 90, 180, 270], "parts": [{"coordinates": [[1.5, 1.5], [11.5, 1.5], [11.5, 11.5], [1.5, 11.5], [1.5, 1.5]], "holes": [], "width": 10, "height": 10, "handles": [], "color": null}]}, {"slug": "host-y4z5a6.dxf", "name": "host.dxf", "count": 1, "rotations": [0, 90, 180, 270], "parts": [{"coordinates": [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]], "holes": [[[35.0, 0.0], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [35.0, 0.0]]], "width": 100, "height": 100, "handles": ["H1"], "color": "#7C3AED"}]}], "params": {"sheets": [{"width": 1500, "height": 1000, "count": 1}], "space": 2, "fillHoles": true, "addOutShape": false, "outputUnit": "mm"}, "profile": {"timeBudgetSec": 13, "vcores": 1, "maxDirections": 1, "level": "browser"}}, "opened": {"1": [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, 1.05], [34.896584026474976, 1.05], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [34.896584026474976, -1.05], [50.0, -1.05], [50.0, -50.0]]}, "expected": {"payload": {"problem": "spp", "instance": {"name": "nest2d", "items": [{"id": 0, "demand": 1, "allowed_orientations": [0, 90, 180, 270], "shape": {"type": "simple_polygon", "data": [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]]}}], "strip_height": 1000.0}, "meta": {"host": 1, "fill": 0, "slots": [1], "ringRotations": [[0.0, 90.0, 180.0, 270.0]], "idMap": [1]}, "engineConfig": {"time_budget_sec": 13, "prng_seed": "2665006712421168654", "n_alternatives": 3, "poly_simpl_tolerance": 0.001, "min_item_separation": 2.0, "narrow_concavity_cutoff": null, "live_events": true, "max_strip_width": 1500.0, "n_workers": 1, "plateau_patience_sec": 2.262, "separator_workers": 1}, "parts": [{"id": 0, "file_slug": "fill-v1w2x3.dxf", "handles": [], "color": "#059669", "coords": [[1.5, 1.5], [11.5, 1.5], [11.5, 11.5], [1.5, 11.5], [1.5, 1.5]], "holes": [], "count": 1}, {"id": 1, "file_slug": "host-y4z5a6.dxf", "handles": ["H1"], "color": "#7C3AED", "coords": [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]], "holes": [[[35.0, 0.0], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [35.0, 0.0]]], "count": 1}], "outputUnit": "mm", "addOutShape": false}, "seed": "2665006712421168654", "itemMap": [{"id": 0, "slug": "fill-v1w2x3.dxf", "part": 0}, {"id": 1, "slug": "host-y4z5a6.dxf", "part": 0}]}}
const FIXTURE_D = {"input": {"files": [{"slug": "host-y4z5a6.dxf", "name": "host.dxf", "count": 1, "rotations": [0, 90, 180, 270], "parts": [{"coordinates": [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]], "holes": [[[35.0, 0.0], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [35.0, 0.0]]], "width": 100, "height": 100, "handles": ["H1"], "color": "#7C3AED"}]}, {"slug": "fill-v1w2x3.dxf", "name": "fill.dxf", "count": 1, "rotations": [0, 90, 180, 270], "parts": [{"coordinates": [[1.5, 1.5], [11.5, 1.5], [11.5, 11.5], [1.5, 11.5], [1.5, 1.5]], "holes": [], "width": 10, "height": 10, "handles": [], "color": null}]}, {"slug": "fill2-b7c8d9.dxf", "name": "fill2.dxf", "count": 1, "rotations": [0, 90, 180, 270], "parts": [{"coordinates": [[2.5, 2.5], [10.5, 2.5], [10.5, 10.5], [2.5, 10.5], [2.5, 2.5]], "holes": [], "width": 8, "height": 8, "handles": [], "color": null}]}], "params": {"sheets": [{"width": 1500, "height": 1000, "count": 1}], "space": 2, "fillHoles": true, "addOutShape": false, "outputUnit": "mm"}, "profile": {"timeBudgetSec": 13, "vcores": 1, "maxDirections": 1, "level": "browser"}}, "opened": {"0": [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, 1.05], [34.896584026474976, 1.05], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [34.896584026474976, -1.05], [50.0, -1.05], [50.0, -50.0]]}, "expected": {"payload": {"problem": "spp", "instance": {"name": "nest2d", "items": [{"id": 0, "demand": 1, "allowed_orientations": [0, 90, 180, 270], "shape": {"type": "simple_polygon", "data": [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, 1.05], [34.896584026474976, 1.05], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [34.896584026474976, -1.05], [50.0, -1.05], [50.0, -50.0]]}}, {"id": 1, "demand": 1, "allowed_orientations": [0, 90, 180, 270], "shape": {"type": "simple_polygon", "data": [[1.5, 1.5], [11.5, 1.5], [11.5, 11.5], [1.5, 11.5], [1.5, 1.5]]}}, {"id": 2, "demand": 1, "allowed_orientations": [0, 90, 180, 270], "shape": {"type": "simple_polygon", "data": [[2.5, 2.5], [10.5, 2.5], [10.5, 10.5], [2.5, 10.5], [2.5, 2.5]]}}], "strip_height": 1000.0}, "meta": null, "engineConfig": {"time_budget_sec": 13, "prng_seed": "6994499636147844416", "n_alternatives": 3, "poly_simpl_tolerance": 0.001, "min_item_separation": 2.0, "narrow_concavity_cutoff": null, "live_events": true, "max_strip_width": 1500.0, "n_workers": 1, "plateau_patience_sec": 2.382, "separator_workers": 1}, "parts": [{"id": 0, "file_slug": "host-y4z5a6.dxf", "handles": ["H1"], "color": "#7C3AED", "coords": [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]], "holes": [[[35.0, 0.0], [34.32748481411306, 6.828161270564489], [32.335783637895034, 13.393920132778142], [29.101436430589082, 19.444958155686077], [24.748737341529164, 24.748737341529164], [19.44495815568608, 29.101436430589082], [13.393920132778144, 32.335783637895034], [6.828161270564491, 34.32748481411306], [2.1431318985078682e-15, 35.0], [-6.828161270564487, 34.32748481411306], [-13.39392013277814, 32.335783637895034], [-19.44495815568607, 29.101436430589086], [-24.74873734152916, 24.748737341529164], [-29.101436430589086, 19.444958155686077], [-32.335783637895034, 13.393920132778145], [-34.32748481411306, 6.828161270564501], [-35.0, 4.2862637970157365e-15], [-34.32748481411306, -6.828161270564492], [-32.33578363789504, -13.393920132778138], [-29.10143643058909, -19.44495815568607], [-24.748737341529168, -24.74873734152916], [-19.444958155686077, -29.101436430589082], [-13.393920132778161, -32.33578363789503], [-6.828161270564503, -34.32748481411306], [-6.429395695523604e-15, -35.0], [6.8281612705644905, -34.32748481411306], [13.39392013277815, -32.335783637895034], [19.444958155686063, -29.10143643058909], [24.748737341529157, -24.748737341529168], [29.101436430589082, -19.444958155686077], [32.33578363789503, -13.393920132778163], [34.32748481411306, -6.828161270564506], [35.0, 0.0]]], "count": 1}, {"id": 1, "file_slug": "fill-v1w2x3.dxf", "handles": [], "color": "#059669", "coords": [[1.5, 1.5], [11.5, 1.5], [11.5, 11.5], [1.5, 11.5], [1.5, 1.5]], "holes": [], "count": 1}, {"id": 2, "file_slug": "fill2-b7c8d9.dxf", "handles": [], "color": "#EA580C", "coords": [[2.5, 2.5], [10.5, 2.5], [10.5, 10.5], [2.5, 10.5], [2.5, 2.5]], "holes": [], "count": 1}], "outputUnit": "mm", "addOutShape": false}, "seed": "6994499636147844416", "itemMap": [{"id": 0, "slug": "host-y4z5a6.dxf", "part": 0}, {"id": 1, "slug": "fill-v1w2x3.dxf", "part": 0}, {"id": 2, "slug": "fill2-b7c8d9.dxf", "part": 0}]}}
const EXTRA = {"tooLargeMessage": "Part(s) too large for the sheet: 'toobig-x9y8z7.dxf' (2000x50mm, x1) \u2014 sheet(s): 1500x1000mm, spacing: 2.0mm. Use a larger sheet, allow more rotations, or reduce spacing.", "spacingMessage": "Spacing 3.0 mm is too large for this instance: parts total 2500 mm\u00b2 on a 1000 mm-high sheet (initial strip width 2.5 mm). Reduce the spacing or add more parts/stock.", "colors": {"cross-k7m2n9.dxf:0": "#059669", "plate-s5t6u7.dxf:0": "#BE185D", "fill-v1w2x3.dxf:0": "#059669", "fill2-b7c8d9.dxf:0": "#EA580C", "alpha-e1f2g3.dxf:1": "#E11D48"}, "plateau": {"13/4/20/false": 2.2133333333333334, "13/0/0/false": 2.0, "13/4/20/true": 2.48, "300/60/5000/true": 11.333333333333334, "300/60/5000/false": 8.333333333333334, "300/10000/10000000/true": 30.0, "3/100/100000/true": 3.0}, "channels": {"0": {"width": 0.1, "usable": true}, "0.5": {"width": 0.6, "usable": true}, "1.0": {"width": 1.1, "usable": true}, "2.0": {"width": 2.1, "usable": true}, "2.39": {"width": 2.49, "usable": true}, "2.4": {"width": 2.5, "usable": true}, "2.41": {"width": 2.5, "usable": true}, "2.5": {"width": 2.5, "usable": false}, "3.0": {"width": 2.5, "usable": false}}}

/** Stub openHoles (contrat geoClient) : (coords, holes, spaceMm) →
 * { ring, channels_opened }. Enregistre les appels. */
function stubOpenHoles(ringByCall, calls = []) {
    return async (coords, holes, spaceMm) => {
        calls.push({ coords, holes, spaceMm })
        const ring = typeof ringByCall === 'function' ? ringByCall(coords, holes, spaceMm) : ringByCall
        return { ring, channels_opened: holes?.length || 0 }
    }
}

/** Stub pinwheelCapacity : (holeRing, fillerCoords, spaceMm, allowedRots) →
 * { rotations }. Enregistre les appels. */
function stubPinwheel(rotations, calls = []) {
    return async (holeRing, fillerCoords, spaceMm, allowedRots) => {
        calls.push({ holeRing, fillerCoords, spaceMm, allowedRots })
        return { rotations }
    }
}

describe('fixtures Python — parite exacte du payload moteur (J-090)', () => {
    it('cas A — SPP 2 fichiers, directions biaisees, couleur fallback', async () => {
        const { payload, seed, itemMap } = await buildLocalPayload(FIXTURE_A.input, {})
        expect(payload).toEqual(FIXTURE_A.expected.payload)
        expect(seed).toBe(FIXTURE_A.expected.seed)
        expect(typeof seed).toBe('string')
        expect(itemMap).toEqual(FIXTURE_A.expected.itemMap)
    })

    it('cas B — BPP multi-toles, space 0, addOutShape, sortie pouces', async () => {
        const { payload, seed, itemMap } = await buildLocalPayload(FIXTURE_B.input, {})
        expect(payload).toEqual(FIXTURE_B.expected.payload)
        expect(seed).toBe(FIXTURE_B.expected.seed)
        expect(itemMap).toEqual(FIXTURE_B.expected.itemMap)
        // BPP : pas de max_strip_width ; space 0 → min_item_separation null
        expect(payload.engineConfig.max_strip_width).toBeUndefined()
        expect(payload.engineConfig.min_item_separation).toBeNull()
    })

    it('cas C — SPP + trous : pre-passe meta J-085 (instance reduite, idMap)', async () => {
        const openCalls = []
        const openedRing = FIXTURE_C.opened['1']
        const deps = {
            openHoles: stubOpenHoles(openedRing, openCalls),
            pinwheelCapacity: stubPinwheel([0, 90, 180, 270]),
        }
        const { payload, seed, itemMap } = await buildLocalPayload(FIXTURE_C.input, deps)
        expect(payload).toEqual(FIXTURE_C.expected.payload)
        expect(seed).toBe(FIXTURE_C.expected.seed)
        expect(itemMap).toEqual(FIXTURE_C.expected.itemMap)
        // openHoles appele avec l'ESPACEMENT (la largeur est cote wasm)
        expect(openCalls).toHaveLength(1)
        expect(openCalls[0].spaceMm).toBe(2)
        // meta : hote resolu trous FERMES, filler droppe (demande 0), id reindexe
        expect(payload.meta).toMatchObject({ host: 1, fill: 0, slots: [1], idMap: [1] })
        expect(payload.instance.items).toHaveLength(1)
        expect(payload.instance.items[0].id).toBe(0)
        expect(payload.instance.items[0].shape.data).toEqual(FIXTURE_C.expected.payload.parts[1].coords)
    })

    it('cas D — SPP + 2 types de fillers : pre-pass mixte (D-MOT-16)', async () => {
        const openCalls = []
        const deps = { openHoles: stubOpenHoles(FIXTURE_D.opened['0'], openCalls) }
        const { payload, itemMap } = await buildLocalPayload(FIXTURE_D.input, deps)
        expect(itemMap).toEqual(FIXTURE_D.expected.itemMap)
        expect(openCalls).toHaveLength(1)
        expect(payload.meta).toBeTruthy()
        expect(payload.meta.packs?.length).toBeGreaterThan(0)
        const placedIds = new Set(payload.meta.packs.flatMap((p) => p.fills.map((f) => f.fillId)))
        expect(placedIds.size).toBeGreaterThan(0)
        // hôte fermé (anneau externe, plus le canal)
        expect(payload.instance.items[0].shape.data).toEqual(payload.parts[0].coords)
        expect(payload.engineConfig.narrow_concavity_cutoff).toBeNull()
    })
})

describe('feasibility pre-check (message exact main.py)', () => {
    const tooBigFile = (rotations) => ({
        slug: 'toobig-x9y8z7.dxf', name: 'toobig.dxf', count: 1, rotations,
        parts: [{
            coordinates: [[0, 0], [2000, 0], [2000, 50], [0, 50], [0, 0]],
            holes: [], width: 2000, height: 50, handles: [], color: null,
        }],
    })
    const params = {
        sheets: [{ width: 1500, height: 1000, count: 1 }],
        space: 2, fillHoles: true, addOutShape: false, outputUnit: 'mm',
    }

    it('piece trop grande dans toutes les rotations → Error au format Python', async () => {
        await expect(buildLocalPayload(
            { files: [tooBigFile([0])], params, profile: { timeBudgetSec: 13 } }, {},
        )).rejects.toThrow(EXTRA.tooLargeMessage)
    })

    it('une rotation permise qui sauve la piece → pas d\'erreur', async () => {
        const paramsTall = { ...params, sheets: [{ width: 1000, height: 1500, count: 1 }] }
        // 2000x50 ne rentre pas a 0° dans 1000x1500, ni a 90° (50x2000 > 1500)
        // → meme message avec la tole haute
        await expect(buildLocalPayload(
            { files: [tooBigFile([0, 90])], params: paramsTall, profile: { timeBudgetSec: 13 } }, {},
        )).rejects.toThrow('Part(s) too large for the sheet')
        // 1200x800 tourne a 90° → 800x1200 rentre dans 1000x1500
        const file = {
            slug: 'ok-q1w2e3.dxf', name: 'ok.dxf', count: 1, rotations: [0, 90],
            parts: [{
                coordinates: [[0, 0], [1200, 0], [1200, 800], [0, 800], [0, 0]],
                holes: [], width: 1200, height: 800, handles: [], color: null,
            }],
        }
        const { payload } = await buildLocalPayload(
            { files: [file], params: paramsTall, profile: { timeBudgetSec: 13 } }, {},
        )
        expect(payload.problem).toBe('spp')
    })
})

describe('SPP vs BPP — stock count', () => {
    const square = {
        slug: 'sq-a1b2c3.dxf', name: 'sq.dxf', count: 2, rotations: [0],
        parts: [{
            coordinates: [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]],
            holes: [], width: 40, height: 40, handles: [], color: null,
        }],
    }
    it('une tôle physique (count 1) + aire faible → SPP', async () => {
        const { payload } = await buildLocalPayload({
            files: [square],
            params: { sheets: [{ width: 1500, height: 1000, count: 1 }], space: 2, fillHoles: true, addOutShape: false, outputUnit: 'mm' },
            profile: { timeBudgetSec: 13 },
        }, {})
        expect(payload.problem).toBe('spp')
    })
    it('même format en 3 exemplaires (démo) → BPP, sparrow ne peut pas enjamber', async () => {
        const { payload } = await buildLocalPayload({
            files: [square],
            params: { sheets: [{ width: 1500, height: 1000, count: 3 }], space: 2, fillHoles: true, addOutShape: false, outputUnit: 'mm' },
            profile: { timeBudgetSec: 13 },
        }, {})
        expect(payload.problem).toBe('bpp')
        expect(payload.instance.bins?.[0]?.stock).toBe(3)
        expect(payload.engineConfig.max_strip_width).toBeUndefined()
    })
})

describe('garde #2b (strip initial deflate vide)', () => {
    it('espacement >= largeur initiale de bande → Error au format Python', async () => {
        const file = {
            slug: 'tiny-r4t5y6.dxf', name: 'tiny.dxf', count: 1, rotations: [0, 90, 180, 270],
            parts: [{
                coordinates: [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]],
                holes: [], width: 50, height: 50, handles: [], color: null,
            }],
        }
        const params = {
            sheets: [{ width: 1000, height: 1000, count: 1 }],
            space: 3, fillHoles: true, addOutShape: false, outputUnit: 'mm',
        }
        await expect(buildLocalPayload(
            { files: [file], params, profile: { timeBudgetSec: 13 } }, {},
        )).rejects.toThrow(EXTRA.spacingMessage)
    })
})

describe('Douglas-Peucker + garde validite (miroir SIMPLIFY_MM shapely)', () => {
    it('supprime les points colineaires (verrouille par fixture A)', () => {
        const ring = [[0, 0], [40, 0], [80, 0], [80, 25], [80, 50], [40, 50], [0, 50], [0, 25], [0, 0]]
        expect(simplifyRing(ring)).toEqual([[0, 0], [80, 0], [80, 50], [0, 50], [0, 0]])
    })

    it('anneau reduit a < 3 points → anneau d\'origine conserve', () => {
        const tiny = [[0, 0], [0.02, 0], [0, 0.02], [0, 0]]
        expect(simplifyRing(tiny)).toEqual(tiny)
    })

    it('ringSelfIntersects detecte le huit ; simplifyRing garde l\'original', () => {
        const eight = [[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]
        expect(ringSelfIntersects(eight.slice(0, -1))).toBe(true)
        expect(ringSelfIntersects([[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(false)
        expect(simplifyRing(eight)).toEqual(eight)
    })

    it('ringAreaAbs : aire shoelace absolue (sens de parcours indifferent)', () => {
        expect(ringAreaAbs([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])).toBe(100)
        expect(ringAreaAbs([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]])).toBe(100)
    })
})

describe('couleurs (fallback deterministe, sync colors.py)', () => {
    it('sha1(`${slug}:${index}`)[0] % 24 — valeurs verrouillees par le Python', async () => {
        for (const [key, expected] of Object.entries(EXTRA.colors)) {
            const sep = key.lastIndexOf(':')
            expect(await colorForPart(key.slice(0, sep), Number(key.slice(sep + 1)))).toBe(expected)
        }
    })
    it('stable entre appels et membre de la palette', async () => {
        const c1 = await colorForPart('cross-k7m2n9.dxf', 0)
        const c2 = await colorForPart('cross-k7m2n9.dxf', 0)
        expect(c1).toBe(c2)
        expect(PART_PALETTE).toContain(c1)
    })
})

describe('canaux capillaires (miroir holed_polygons.py)', () => {
    it('channelWidthForSpace / channelsUsable — table verrouillee par le Python', () => {
        for (const [space, ref] of Object.entries(EXTRA.channels)) {
            const s = Number(space)
            expect(channelWidthForSpace(s)).toBe(ref.width)
            expect(channelsUsable(s)).toBe(ref.usable)
        }
    })
})

describe('plateau adaptatif (miroir adaptive_plateau_patience_sec)', () => {
    it('valeurs verrouillees par le Python', () => {
        for (const [key, expected] of Object.entries(EXTRA.plateau)) {
            const [budget, nParts, nVertices, holes] = key.split('/')
            expect(adaptivePlateauPatienceSec(
                Number(budget), Number(nParts), Number(nVertices), holes === 'true',
            )).toBe(expected)
        }
    })
})

describe('canonicalJson + deterministicSeed', () => {
    it('cles triees recursivement, sans espaces', () => {
        expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 0, y: 1 }] } }))
            .toBe('{"a":{"c":[3,{"y":1,"z":0}],"d":2},"b":1}')
    })
    it('non-ASCII echappe comme json.dumps(ensure_ascii=True)', () => {
        expect(canonicalJson({ n: 'é—²' })).toBe('{"n":"\\u00e9\\u2014\\u00b2"}')
    })
    it('undefined omis, NaN/Infinity → null (semantique JSON.stringify)', () => {
        expect(canonicalJson({ a: undefined, b: NaN, c: Infinity })).toBe('{"b":null,"c":null}')
    })
    it('seed : string 63 bits, stable, verrouillee', async () => {
        const s1 = await deterministicSeed({ a: 1 })
        expect(s1).toBe('97598696656828973') // sha256('{"a":1}')[:8] & 2^63-1 (Python)
        expect(typeof s1).toBe('string')
        expect(BigInt(s1) < 2n ** 63n).toBe(true)
        expect(await deterministicSeed({ a: 1 })).toBe(s1)
        expect(await deterministicSeed({ a: 2 })).not.toBe(s1)
    })
})

describe('meta pre-passe — branches de repli', () => {
    const metaInput = FIXTURE_C.input

    it('capacite partielle : pre-pass s\'engage quand meme (D-MOT-16)', async () => {
        const deps = {
            openHoles: stubOpenHoles(FIXTURE_C.opened['1']),
            pinwheelCapacity: stubPinwheel([0, 90]), // 2/4 — plus un motif de refus
        }
        const { payload } = await buildLocalPayload(metaInput, deps)
        expect(payload.meta).toBeTruthy()
        expect(payload.meta.packs?.length || payload.meta.slots?.length).toBeGreaterThan(0)
        // hôte fermé (anneau externe, pas le canal)
        const host = payload.instance.items.find((it) => it.id === 0) || payload.instance.items[0]
        expect(host.shape.data).toEqual(payload.parts.find((p) => p.holes?.length)?.coords)
    })

    it('capacite pinwheel nulle : packer JS peut quand meme remplir', async () => {
        const deps = {
            openHoles: stubOpenHoles(FIXTURE_C.opened['1']),
            pinwheelCapacity: stubPinwheel([]),
        }
        const { payload } = await buildLocalPayload(metaInput, deps)
        // D-MOT-16 : le glouton ne dépend pas du stub pinwheel
        expect(payload.instance.items.length).toBeGreaterThan(0)
    })

    it('instance a trous sans dep openHoles → erreur explicite', async () => {
        await expect(buildLocalPayload(metaInput, {})).rejects.toThrow('openHoles')
    })

    it('sans dep pinwheelCapacity : packer JS, pas d\'erreur', async () => {
        const deps = { openHoles: stubOpenHoles(FIXTURE_C.opened['1']) }
        const { payload } = await buildLocalPayload(metaInput, deps)
        expect(payload.instance.items.length).toBeGreaterThan(0)
    })

    it('fillHoles false → trous scelles, pas d\'appel openHoles, cutoff actif', async () => {
        const openCalls = []
        const deps = {
            openHoles: stubOpenHoles(FIXTURE_C.opened['1'], openCalls),
            pinwheelCapacity: stubPinwheel([0, 90, 180, 270]),
        }
        const input = { ...metaInput, params: { ...metaInput.params, fillHoles: false } }
        const { payload } = await buildLocalPayload(input, deps)
        expect(openCalls).toHaveLength(0)
        expect(payload.meta).toBeNull()
        expect(payload.engineConfig.narrow_concavity_cutoff).toEqual([0.01, 0.01])
        // shapes = anneaux externes nets (jamais d'anneau a canal)
        expect(payload.instance.items[1].shape.data).toEqual(payload.parts[1].coords)
    })

    it('espacement qui scelle les canaux (space 3 > 2.5) → trous fermes', async () => {
        const openCalls = []
        const deps = {
            openHoles: stubOpenHoles(FIXTURE_C.opened['1'], openCalls),
            pinwheelCapacity: stubPinwheel([0, 90, 180, 270]),
        }
        const input = { ...metaInput, params: { ...metaInput.params, space: 3 } }
        const { payload } = await buildLocalPayload(input, deps)
        expect(channelsUsable(3)).toBe(false)
        expect(openCalls).toHaveLength(0)
        expect(payload.meta).toBeNull()
    })
})

describe('itemMap (miroir part_index_by_id, multi-fichiers/multi-pieces)', () => {
    it('compteur par file_slug, ordre des input_items', async () => {
        const part = (x) => ({
            coordinates: [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]],
            holes: [], width: 10, height: 10, handles: [], color: null,
        })
        const files = [
            { slug: 'multi-a1b2c3.dxf', name: 'a.dxf', count: 1, rotations: [0], parts: [part(0), part(20)] },
            { slug: 'single-d4e5f6.dxf', name: 'b.dxf', count: 1, rotations: [0], parts: [part(40)] },
        ]
        const params = {
            sheets: [{ width: 1500, height: 1000, count: 1 }],
            space: 0, fillHoles: true, addOutShape: false, outputUnit: 'mm',
        }
        const { itemMap, payload } = await buildLocalPayload(
            { files, params, profile: { timeBudgetSec: 13 } }, {},
        )
        expect(itemMap).toEqual([
            { id: 0, slug: 'multi-a1b2c3.dxf', part: 0 },
            { id: 1, slug: 'multi-a1b2c3.dxf', part: 1 },
            { id: 2, slug: 'single-d4e5f6.dxf', part: 0 },
        ])
        expect(payload.parts.map((p) => p.id)).toEqual([0, 1, 2])
    })
})
