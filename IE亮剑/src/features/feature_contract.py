VERSION = 'member-a-v1.1-qa20260923'
SEED = 20260922
META_TYPES = {
    'gpsno': 'VARCHAR', 'window_id': 'VARCHAR', 'window_role': 'VARCHAR',
    'feature_start': 'DATE', 'feature_end': 'DATE', 'feature_window_days': 'INTEGER',
    'label_start': 'DATE', 'label_end': 'DATE', 'label_horizon_days': 'INTEGER',
}
FORBIDDEN_MODEL_COLUMNS = set(META_TYPES) | {'label', 'accident_label', 'near_miss_label'}

class Registry:
    def __init__(self):
        self.entries = {}

    def add(self, name, group, description, unit='count', window='feature_window',
            numerator='', denominator='', missing='unavailable -> NULL', recommend=False,
            dtype='DOUBLE', source='risk_event_daily', eligibility='candidate'):
        entry = dict(feature_name=name, feature_group=group, description=description,
                     unit=unit, window_days=window, numerator=numerator, denominator=denominator,
                     missing_policy=missing, source_table=source, dtype=dtype,
                     recommended_candidate=recommend, eligibility=eligibility,
                     enabled_v1=False, selection_reason='not_in_core', version=VERSION)
        if name in self.entries and self.entries[name] != entry:
            raise ValueError(f'Inconsistent feature definition: {name}')
        self.entries[name] = entry
