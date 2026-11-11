"""Fit only on rows selected as train by split_manifest.csv."""
import math
import statistics

class FoldFeatureSelector:
    def fit(self, rows, candidates, limit=100, correlation_limit=.995):
        self.columns=[]
        self.reasons={}
        vectors={}
        medians={}
        for name in candidates:
            values=[r.get(name) for r in rows]
            available=[v for v in values if v is not None]
            if not available:
                self.reasons[name]='all_null_in_training'
                continue
            if len(set(available))==1:
                self.reasons[name]='constant_in_training'
                continue
            if any(v is not None and not math.isfinite(v) for v in values):
                raise ValueError(f'Nonfinite: {name}')
            median=statistics.median(available)
            vector=[median if v is None else v for v in values]
            center=statistics.fmean(vector)
            centered=[v-center for v in vector]
            scale=math.sqrt(sum(v*v for v in centered))
            redundant=None
            for previous,(other,other_scale) in vectors.items():
                corr=sum(x*y for x,y in zip(centered,other))/(scale*other_scale)
                if abs(corr)>=correlation_limit:
                    redundant=previous
                    break
            if redundant:
                self.reasons[name]='duplicate_or_high_correlation:'+redundant
            elif len(self.columns)>=limit:
                self.reasons[name]='core_limit'
            else:
                self.columns.append(name)
                self.reasons[name]='selected_on_training_only'
                vectors[name]=(centered,scale)
                medians[name]=median
        self.training_medians=medians
        return self

    def transform(self, rows):
        # Missing values are retained. B owns fitted model imputation/scaling.
        return [{name:r[name] for name in self.columns} for r in rows]

class ExposureShrinker:
    """Empirical pooled-rate prior; tau defaults to train median positive exposure.

    Tau is a documented heuristic, not an optimized Gamma-Poisson MLE.
    Exposure units MUST match count/exposure risk rates (e.g. 100 hours).
    Missing or zero exposure remains unavailable even when count is zero.
    """
    def fit(self, counts, exposures, tau=None):
        pairs=[(n,e) for n,e in zip(counts,exposures) if n is not None and e is not None and e>0]
        if not pairs:
            raise ValueError('No positive training exposure')
        if any(n<0 or not math.isfinite(n+e) for n,e in pairs):
            raise ValueError('Invalid count/exposure')
        self.mu=sum(n for n,e in pairs)/sum(e for n,e in pairs)
        self.tau=statistics.median(e for n,e in pairs) if tau is None else tau
        if not math.isfinite(self.tau) or self.tau<=0:
            raise ValueError('tau must be positive and finite')
        return self

    def transform(self, counts, exposures):
        if not hasattr(self,'mu'):
            raise ValueError('Fit on training rows first')
        return [(n+self.tau*self.mu)/(e+self.tau) if n is not None and e is not None and e>0 else None
                for n,e in zip(counts,exposures)]
