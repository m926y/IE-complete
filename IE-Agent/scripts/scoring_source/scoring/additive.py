"""Low-complexity monotone piecewise-linear risk functions in six dimensions."""
import numpy as np
from scipy.optimize import minimize
from .enhanced import DIMS
from .scoring_rules import validate_weights

CAPS = np.array([100., 100., 100., 100., 100., 60.])
KNOTS = np.array([0., 1/3, 2/3, 1.])


def basis(x):
    x = np.asarray(x, dtype=float)
    return np.clip((x[..., None] - KNOTS[:-1]) / np.diff(KNOTS), 0, 1)


def fit_scales(reference):
    result = {}
    for d in DIMS:
        observed = np.asarray(reference[d]['rates'], dtype=float)
        positive = observed[np.isfinite(observed) & (observed > 0)]
        result[d] = max(float(np.quantile(positive, .75)) if len(positive) else .01, 1e-9)
    return result


def inputs(details, config):
    if config['mapping'] == 'percentile':
        x = details[[d + '_penalty' for d in DIMS]].to_numpy(dtype=float) / CAPS
    elif config['mapping'] == 'rate':
        rate = details[[d + '_rate' for d in DIMS]].to_numpy(dtype=float)
        scale = np.array([config['scales'][d] for d in DIMS])
        x = rate / (rate + scale)
    else:
        raise ValueError('Unknown additive mapping')
    # Missing IMU has no observed deduction; uncertainty remains a separate field.
    return np.clip(np.nan_to_num(x, nan=0.), 0, 1)


def contributions(details, config):
    coefficients = np.asarray(config['coefficients'])
    return (basis(inputs(details, config)) * coefficients[None, :, :]).sum(axis=2) * CAPS


def fit(details, official, auxiliary, mapping, scales, initial_weights):
    config = {'mapping': mapping, 'scales': scales, 'knots': KNOTS.tolist()}
    x = (basis(inputs(details, config)) * (CAPS / 100)[None, :, None]).reshape(len(details), -1)
    pairs = []
    for target in [official, auxiliary]:
        y = np.asarray(target, dtype=int)
        if len(np.unique(y)) == 2:
            pairs.append((x[y == 1, None, :] - x[None, y == 0, :]).reshape(-1, x.shape[1]))
    if not pairs:
        raise ValueError('No class pairs in training')
    prior = np.array([initial_weights[d] for d in DIMS])
    initial = np.repeat(prior[:, None] / 3, 3, axis=1).ravel()
    def loss(flat):
        coefficients = flat.reshape(6, 3)
        weights = coefficients.sum(axis=1)
        shape = coefficients - weights[:, None] / 3
        return float(np.mean([np.logaddexp(0, -4 * delta.dot(flat)).mean() for delta in pairs])
                     + 4 * np.square(weights - prior).sum() + 4 * np.square(shape).sum())
    def restrictions(flat):
        w = flat.reshape(6, 3).sum(axis=1)
        # A tiny feasibility margin prevents solver roundoff violating strict business checks.
        return np.r_[w[0] - w[1:] - 1e-7, w[1] - w[3] - 1e-7,
                     w[2] - w[3] - 1e-7, .10 - w[5] - 1e-7,
                     w - np.maximum(.01, prior - .05), np.minimum(1, prior + .05) - w]
    result = minimize(loss, initial, method='SLSQP', bounds=[(0, 1)] * len(initial),
                      constraints=[{'type': 'eq', 'fun': lambda b: b.sum() - 1},
                                   {'type': 'ineq', 'fun': restrictions}],
                      options={'ftol': 1e-11, 'maxiter': 400})
    if not result.success:
        raise ValueError(f'Additive optimization failed: {result.message}')
    config['coefficients'] = result.x.reshape(6, 3).tolist()
    config['weights'] = dict(zip(DIMS, map(float, result.x.reshape(6, 3).sum(axis=1))))
    validate_weights(config['weights'])
    config['fit'] = {'objective': float(result.fun), 'iterations': int(result.nit),
                     'official_positives': int(np.sum(official)), 'auxiliary_positives': int(np.sum(auxiliary)),
                     'weight_l2': 4., 'shape_l2': 4., 'max_weight_change': .05}
    return config


def apply(details, config):
    result = details.copy()
    values = contributions(result, config)
    for i, d in enumerate(DIMS):
        w = config['weights'][d]
        missing = result[d + '_penalty'].isna()
        result[d + '_contribution'] = values[:, i]
        result[d + '_weight'] = w
        result[d + '_penalty'] = np.where(missing, np.nan, values[:, i] / max(w, 1e-9))
    return result
