from .window_definitions import DAY

def build_labels(con, window):
    """Recorded-event labels. Missing event is not proof of event ascertainment."""
    rows = con.execute(f"""SELECT p.gpsno,
        CAST(coalesce(count_if(r.event_type=11803),0)>=1 OR coalesce(count_if(r.event_type=11804),0)>=2 AS INTEGER) AS "label",
        CAST(coalesce(count_if(r.event_type=11803),0)>0 AS INTEGER) accident_label,
        CAST(coalesce(count_if(r.event_type=11804),0)>0 AS INTEGER) near_miss_label
        FROM profile p LEFT JOIN risk_events r ON p.gpsno=r.gpsno
          AND r.event_time >= TIMESTAMP '{window.end + DAY}'
          AND r.event_time < TIMESTAMP '{window.end + (window.horizon+1)*DAY}'
        GROUP BY p.gpsno ORDER BY p.gpsno""").fetchall()
    return {r[0]: dict(zip(('label','accident_label','near_miss_label'),r[1:])) for r in rows}
