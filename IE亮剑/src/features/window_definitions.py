from dataclasses import dataclass
from datetime import date, timedelta

START = date(2026, 6, 1)
END = date(2026, 7, 31)
DAY = timedelta(days=1)

@dataclass(frozen=True)
class Window:
    start: date
    end: date
    horizon: int = 14
    role: str = 'auxiliary'

    @property
    def days(self):
        return (self.end - self.start).days + 1

    @property
    def id(self):
        return f'{self.role}_{self.days}d_{self.end:%Y%m%d}_h{self.horizon}'

    def metadata(self):
        return dict(window_id=self.id, window_role=self.role, feature_start=self.start,
                    feature_end=self.end, feature_window_days=self.days,
                    label_start=self.end + DAY if self.horizon else None,
                    label_end=self.end + self.horizon * DAY if self.horizon else None,
                    label_horizon_days=self.horizon)

def training_windows():
    result = [Window(START, date(2026, 6, 21), 40, 'main_40d')]
    for days in (14, 21, 30):
        cutoff = START + (days - 1) * DAY
        cutoffs = []
        while cutoff + 14 * DAY <= END:
            cutoffs.append(cutoff)
            cutoff += 7 * DAY
        if END - 14 * DAY not in cutoffs:
            cutoffs.append(END - 14 * DAY)
        result.extend(Window(c - (days - 1) * DAY, c) for c in cutoffs)
    result.append(validation_window())
    return result

def splits(windows):
    # One observation length per experiment. Same cutoff => identical target,
    # so never randomly split rows or mix lengths as independent samples.
    rows = []
    train_ids = [w for w in windows if w.days == 14 and w.end == date(2026, 6, 14)]
    valid = next(w for w in windows if w.role == 'validation_extra')
    test = next(w for w in windows if w.days == 14 and w.end == date(2026, 7, 17))
    for phase, evaluation, eligible in [
        ('model_selection', valid, train_ids),
        ('locked_test', test, [w for w in windows if w.role in ('auxiliary', 'validation_extra') and w.days == 14 and w.end + w.horizon * DAY <= test.end]),
    ]:
        for w in eligible + [evaluation]:
            role = ('validation' if phase == 'model_selection' else 'test') if w == evaluation else 'train'
            rows.append(dict(experiment='fixed14_time', phase=phase, split_role=role, **w.metadata(),
                             information_cutoff=evaluation.end,
                             note='test window reserved; refit only after parameters are frozen'))
    return rows

def validation_window():
    return Window(date(2026, 6, 17), date(2026, 6, 30), 14, 'validation_extra')
