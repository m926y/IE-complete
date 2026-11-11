from .window_definitions import START, END, Window
from .build_window_features import build_window_features
from .build_risk_daily import short_warning_counts

def build_full_features(con, sources, registry):
    window=Window(START,END,0,'forecast')
    return build_window_features(sources,window,registry,short_warning_counts(con,window))
