def build_config(n_samples=20000, prng_seed=None, min_separation=None, has_holes=False):
    """Solver config. n_samples is the exploration budget (higher = better
    layouts, slower). prng_seed None = non-deterministic run (lbf picks its
    own seed); pass an int for reproducible runs.

    min_separation is the exact minimum distance between any two placed items
    (and between items and the bin edge). jagua-rs enforces it natively by
    inflating items / deflating containers by half the value, so the geometry
    stays untouched and the gap is exactly `min_separation` — do NOT pre-buffer
    the polygons on the Python side (that used to double the requested gap).

    has_holes disables narrow-concavity closing: holed items are opened to
    the exterior by a hairline channel (core/holed_polygons.py) and the
    closing heuristic would seal that channel shut, silently re-filling the
    holes. Without holed items, the heuristic stays on (faster collision
    checks on noisy contours).
    """
    config = {
        'cde_config': {
            'quadtree_depth': 5,
            'cd_threshold': 16,
            'item_surrogate_config': {
                'n_pole_limits': [[100, 0.0], [20, 0.75], [10, 0.90]],
                'n_ff_poles': 2,
                'n_ff_piers': 0
            }
        },
        'poly_simpl_tolerance': 0.001,
        'min_item_separation': float(min_separation) if min_separation else None,
        # Explicit null disables concavity closing for holed instances; omit
        # the field otherwise to keep the solver default (Some((0.01, 0.01))).
        'narrow_concavity_cutoff': None,
        'n_samples': n_samples,
        'ls_frac': 0.2
    }
    if not has_holes:
        del config['narrow_concavity_cutoff']
    if prng_seed is not None:
        config['prng_seed'] = prng_seed
    return config

def build_item(id, demand, points, allowed_orientations):
    return {
        'id': id,
        'demand': demand,
        'allowed_orientations': allowed_orientations,
        'shape': {
            'type': 'simple_polygon',
            'data': points
        }
    }

def build_bin(bin_id, stock, width, height):
    return {
        'id': bin_id,
        'cost': 1,
        'stock': stock,
        'shape': {
            'type': 'polygon',
            'data': {
                'outer': [
                    [0.0, 0.0],
                    [width, 0.0],
                    [width, height],
                    [0.0, height],
                    [0.0, 0.0]
                ]
            }
        }
    }

def build_input_json(bins, items, n_samples=20000, prng_seed=None, min_separation=None, has_holes=False):
    """bins: list of build_bin dicts (heterogeneous sheet types supported by
    jagua-rs natively, each with its own stock). min_separation: exact gap
    enforced between items and hazards (see build_config). has_holes: set when
    any item was channel-converted from a holed polygon (see build_config)."""
    return {
        'config': build_config(n_samples, prng_seed, min_separation, has_holes),
        'problem_type': 'bpp',
        'instance': {
            'name': 'Test',
            'items': items,
            'bins': bins
        },
    }
