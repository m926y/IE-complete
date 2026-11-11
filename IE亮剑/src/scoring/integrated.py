"""Fixed-reference and keyed label helpers."""
from .event_taxonomy import DIMENSION_LABELS

def make_reference(details):
    result={}
    for dim in DIMENSION_LABELS:
        result[dim]={'rates':details[f'{dim}_rate'].dropna().tolist()}
        if dim!='imu_evidence':
            result[dim].update(mu=float(details[f'{dim}_prior_mean'].iloc[0]),
                               tau=float(details[f'{dim}_prior_exposure'].iloc[0]))
    return result

def aligned_labels(details, labels):
    if labels.gpsno.duplicated().any():
        raise ValueError('Nonunique vehicle label key')
    mapped=details.gpsno.map(labels.set_index('gpsno').label)
    if mapped.isna().any():
        raise ValueError('Missing vehicle labels')
    return mapped
