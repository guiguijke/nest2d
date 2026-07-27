def build_config(n_samples=20000, prng_seed=None):
    """Solver config. n_samples is the exploration budget (higher = better
    layouts, slower). prng_seed None = non-deterministic run (lbf picks its
    own seed); pass an int for reproducible runs."""
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
        'min_item_separation': 0.0,
        'n_samples': n_samples,
        'ls_frac': 0.2
    }
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

def build_input_json(bins, items, n_samples=20000, prng_seed=None):
    """bins: list of build_bin dicts (heterogeneous sheet types supported by
    jagua-rs natively, each with its own stock)."""
    return {
        'config': build_config(n_samples, prng_seed),
        'problem_type': 'bpp',
        'instance': {
            'name': 'Test',
            'items': items,
            'bins': bins
        },
    }
