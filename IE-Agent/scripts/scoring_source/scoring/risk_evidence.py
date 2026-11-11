"""Descriptive uncertainty, direct contrasts and dependence-aware comparisons."""
import numpy as np
import pandas as pd
from scipy.optimize import brentq
from scipy.special import betaln, betainc, logsumexp
from scipy.stats import beta, fisher_exact
from sklearn.metrics import roc_auc_score, average_precision_score
from .enhanced import wilson_interval


def group_counts(labels, groups, order):
    result = {}
    for name in order:
        y = np.asarray(labels)[np.asarray(groups) == name]
        result[name] = {'n': len(y), 'positive': int(y.sum()),
                        'rate': float(y.mean()) if len(y) else None,
                        'wilson_ci95': wilson_interval(int(y.sum()), len(y))}
    return result


def difference(high, low):
    """Newcombe unpooled Wilson difference interval, conditional on fixed groups."""
    ph, pl = high['rate'], low['rate']
    lh, uh = high['wilson_ci95']; ll, ul = low['wilson_ci95']
    delta = ph - pl
    lower = delta - np.sqrt((ph - lh)**2 + (ul - pl)**2)
    upper = delta + np.sqrt((uh - ph)**2 + (pl - ll)**2)
    p = fisher_exact([[high['positive'], high['n'] - high['positive']],
                      [low['positive'], low['n'] - low['positive']]]).pvalue
    return {'risk_difference': float(delta), 'difference_ci95': [float(lower), float(upper)],
            'fisher_two_sided_p': float(p)}


def holm_adjust(contrasts):
    names = sorted(contrasts, key=lambda k: contrasts[k]['fisher_two_sided_p'])
    previous = 0.
    for i, name in enumerate(names):
        previous = max(previous, min(1., (len(names) - i) * contrasts[name]['fisher_two_sided_p']))
        contrasts[name]['holm_adjusted_p'] = previous
    return contrasts


def hierarchical_intervals(groups, concentration=10., grid_size=401):
    """Integrate global m~Beta(.5,.5), p_g|m~Beta(k*m,k*(1-m))."""
    m = beta.ppf((np.arange(grid_size) + .5) / grid_size, .5, .5)
    alpha, other = concentration * m, concentration * (1 - m)
    log_weight = np.zeros(grid_size)
    for group in groups.values():
        n, k = group['n'], group['positive']
        log_weight += betaln(alpha + k, other + n - k) - betaln(alpha, other)
    weight = np.exp(log_weight - logsumexp(log_weight))
    result = {}
    for name, group in groups.items():
        n, k = group['n'], group['positive']
        a, b = alpha + k, other + n - k
        def quantile(q):
            return float(brentq(lambda x: np.dot(weight, betainc(a, b, x)) - q, 0., 1.))
        result[name] = {'posterior_mean': float(np.dot(weight, a / (a + b))),
                        'credible_interval95': [quantile(.025), quantile(.975)]}
    return {'prior': {'global_beta': [.5, .5], 'group_concentration': concentration},
            'groups': result, 'scope': 'Descriptive posterior; not used in scores or candidate selection'}


def risk_stats(labels, risk):
    y, risk = np.asarray(labels, dtype=int), np.asarray(risk, dtype=float)
    ordered = np.argsort(-risk, kind='stable')
    n, positives = len(y), y.sum()
    top10, safest20 = y[ordered[:int(np.ceil(.1*n))]], y[ordered[int(np.floor(.8*n)):]]
    top20 = y[ordered[:int(np.ceil(.2*n))]]
    return {'auc': float(roc_auc_score(y, risk)), 'ap': float(average_precision_score(y, risk)),
            'top50_recall': float(y[ordered[:50]].sum() / max(1, positives)),
            'top10_risk': float(top10.mean()), 'top20_risk': float(top20.mean()),
            'top10_lift': float(top10.mean()/y.mean()), 'top20_lift': float(top20.mean()/y.mean()),
            'safest20_risk': float(safest20.mean()), 'extreme_risk_difference': float(top10.mean()-safest20.mean())}


def evidence(details, labels, draws=2000):
    y = np.asarray(labels, dtype=int)
    risk = 100 - details.safety_score.to_numpy()
    groups = group_counts(y, details.risk_level, 'ABCD')
    contrasts = {f'{h}-{l}': difference(groups[h], groups[l])
                 for h, l in [('B', 'A'), ('C', 'B'), ('D', 'C'), ('D', 'A')]}
    merged = details.risk_level.map({'A': 'low', 'B': 'middle', 'C': 'middle', 'D': 'high'})
    three = group_counts(y, merged, ['low', 'middle', 'high'])
    ranks = pd.Series(risk).rank(method='average').to_numpy()
    ranks = ranks - ranks.mean()
    observed = np.dot(ranks, y)
    rng = np.random.default_rng(20260926)
    permutations = sum(np.dot(ranks, rng.permutation(y)) >= observed for _ in range(draws))
    return {'metrics': risk_stats(y, risk), 'four_levels': groups,
            'direct_contrasts': holm_adjust(contrasts), 'three_level_explanation': three,
            'hierarchical_four_levels': hierarchical_intervals(groups),
            'hierarchical_three_levels': hierarchical_intervals(three),
            'trend': {'one_sided_permutation_p': (permutations + 1)/(draws + 1), 'draws': draws,
                      'scope': 'Exploratory rank trend conditional on this already viewed window'},
            'limitations': ['Intervals condition on fixed groups and model; exclude selection bias and time drift.',
                           'Merged groups simplify explanation without increasing ranking AUC.',
                           'Bayesian credible intervals and Wilson confidence intervals have different meanings.']}


def paired_comparison(y, baseline, candidate, draws=1000):
    y = np.asarray(y, dtype=int)
    base, new = risk_stats(y, baseline), risk_stats(y, candidate)
    pos, neg = np.flatnonzero(y == 1), np.flatnonzero(y == 0)
    rng = np.random.default_rng(20260926)
    differences = {k: [] for k in base}
    for _ in range(draws):
        ix = np.r_[rng.choice(pos, len(pos)), rng.choice(neg, len(neg))]
        a, b = risk_stats(y[ix], np.asarray(baseline)[ix]), risk_stats(y[ix], np.asarray(candidate)[ix])
        for k in differences:
            differences[k].append(b[k] - a[k])
    return {k: {'baseline': base[k], 'candidate': new[k], 'delta': new[k]-base[k],
                'delta_ci95': np.quantile(v, [.025, .975]).tolist()} for k, v in differences.items()}


def clustered_auc_difference(labels, baseline, candidate, draws=1000):
    """Matrices: windows x vehicles; resample whole gpsno trajectories together."""
    labels, baseline, candidate = map(np.asarray, [labels, baseline, candidate])
    if labels.shape != baseline.shape or labels.shape != candidate.shape:
        raise ValueError('Window/vehicle matrices must match')
    rng = np.random.default_rng(20260926)
    differences = []
    for _ in range(draws):
        ix = rng.choice(labels.shape[1], labels.shape[1])
        values = [roc_auc_score(y[ix], b[ix])-roc_auc_score(y[ix], a[ix])
                  for y, a, b in zip(labels, baseline, candidate) if len(np.unique(y[ix])) == 2]
        if len(values) == labels.shape[0]:
            differences.append(np.mean(values))
    point = np.mean([roc_auc_score(y,b)-roc_auc_score(y,a) for y,a,b in zip(labels,baseline,candidate)])
    return {'mean_auc_delta': float(point), 'vehicle_cluster_ci95': np.quantile(differences, [.025,.975]).tolist(),
            'valid_draws': len(differences), 'windows': labels.shape[0], 'unique_vehicles': labels.shape[1],
            'limitation': 'Preserves repeated-vehicle dependence; does not establish temporal independence or unseen-test validity'}
