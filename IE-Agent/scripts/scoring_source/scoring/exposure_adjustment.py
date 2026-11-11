"""Time decay, empirical-Bayes exposure smoothing, and monotone penalties."""

from __future__ import annotations

import numpy as np
import pandas as pd


def decay_weight(age_days, half_life_days: float = 14.0):
    if half_life_days <= 0:
        raise ValueError("half_life_days must be positive")
    age = np.asarray(age_days, dtype=float)
    if np.any(age < 0):
        raise ValueError("age_days must not be negative")
    return np.power(2.0, -age / half_life_days)


def empirical_bayes_rate(numerator, exposure, tau: float | None = None, prior_mean=None):
    numerator = np.asarray(numerator, dtype=float)
    exposure = np.asarray(exposure, dtype=float)
    if numerator.shape != exposure.shape:
        raise ValueError("numerator and exposure must have the same shape")
    if np.any(numerator[np.isfinite(numerator)] < 0) or np.any(exposure[np.isfinite(exposure)] < 0):
        raise ValueError("numerator and exposure must not be negative")
    valid = np.isfinite(numerator) & np.isfinite(exposure) & (exposure > 0)
    total_exposure = exposure[valid].sum()
    mu = float(numerator[valid].sum() / total_exposure) if total_exposure > 0 else 0.0
    if prior_mean is not None:
        mu = float(prior_mean)
    if tau is None:
        positive = exposure[valid]
        tau = float(np.median(positive)) if len(positive) else 1.0
    tau = max(float(tau), 1e-9)
    clean_numerator = np.where(np.isfinite(numerator), numerator, 0.0)
    clean_exposure = np.where(np.isfinite(exposure), exposure, 0.0)
    return (clean_numerator + tau * mu) / (clean_exposure + tau), mu, tau


def monotone_percentile_penalty(rate, available=None, cap: float = 100.0, reference_rate=None) -> pd.Series:
    """Map nonnegative rates monotonically to a 0..cap percentile penalty."""
    if not 0 < cap <= 100:
        raise ValueError("cap must be in (0, 100]")
    values = pd.Series(rate, dtype="float64")
    mask = values.notna() if available is None else pd.Series(available, index=values.index).astype(bool) & values.notna()
    result = pd.Series(np.nan, index=values.index, dtype="float64")
    if not mask.any():
        return result
    observed = np.log1p(values[mask].clip(lower=0))
    if reference_rate is None:
        result.loc[mask] = (observed.rank(method="average") - 0.5) / len(observed) * float(cap)
        return result
    reference = pd.Series(reference_rate, dtype="float64").dropna().clip(lower=0)
    if reference.empty:
        raise ValueError("reference_rate has no usable values")
    sorted_reference = np.sort(np.log1p(reference).to_numpy())
    left = np.searchsorted(sorted_reference, observed.to_numpy(), side="left")
    right = np.searchsorted(sorted_reference, observed.to_numpy(), side="right")
    result.loc[mask] = ((left + right) / 2.0 / len(sorted_reference)) * float(cap)
    return result
