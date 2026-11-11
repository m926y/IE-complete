from .event_groups import CODES, EVENT_GROUPS
from .runtime import quote

def build_risk_daily(con, output):
    """Dense 500 x 61 panel. Zero means no recorded event, not verified safety."""
    expr = [f'count_if(event_type={c})::BIGINT AS evt_{c}_count' for c in CODES]
    expr += [f"count_if(event_type IN ({','.join(map(str, codes))}))::BIGINT AS {g}_count"
             for g, codes in EVENT_GROUPS.items()]
    expr += [f'count_if(hour(event_time)={h})::BIGINT AS hour_{h:02d}_count' for h in range(24)]
    expr += ['count(*)::BIGINT AS total_count', 'count(speed_kmh)::BIGINT AS speed_valid_count',
             'sum(speed_kmh) AS speed_sum', 'avg(speed_kmh) AS risk_speed_mean_kmh',
             'max(speed_kmh) AS risk_speed_max_kmh', 'count(DISTINCT hour(event_time)) AS active_hour_count',
             'count(DISTINCT event_type) AS event_type_nunique',
             'bool_or(event_type IN (11803,11804)) AS has_severe_event']
    con.execute('CREATE OR REPLACE TEMP TABLE rd_sparse AS SELECT gpsno, event_date, ' + ','.join(expr) +
                ' FROM risk_events GROUP BY gpsno, event_date')
    names = [d[0] for d in con.execute('SELECT * FROM rd_sparse LIMIT 0').description][2:]
    cols = [f's.{n}' if n in ('risk_speed_mean_kmh', 'risk_speed_max_kmh', 'speed_sum')
            else f'coalesce(s.{n}, {"false" if n == "has_severe_event" else "0"}) AS {n}' for n in names]
    dims = ' + '.join(f'CAST(coalesce(s.{g}_count,0)>0 AS INTEGER)' for g in EVENT_GROUPS)
    con.execute(f"""CREATE OR REPLACE TEMP TABLE risk_daily AS
        SELECT p.gpsno, CAST(d.day AS DATE) event_date, {','.join(cols)},
               ({dims}) AS risk_group_nunique, s.gpsno IS NOT NULL AS has_recorded_event
        FROM profile p CROSS JOIN generate_series(DATE '2026-06-01', DATE '2026-07-31', INTERVAL 1 DAY) d(day)
        LEFT JOIN rd_sparse s ON p.gpsno=s.gpsno AND CAST(d.day AS DATE)=s.event_date
    """)
    con.execute(f'COPY (SELECT * FROM risk_daily ORDER BY gpsno,event_date) TO {quote(output)} (FORMAT PARQUET, COMPRESSION ZSTD)')

def short_warning_counts(con, window):
    """Both timestamps restricted to feature period, even across midnight."""
    end = window.end.isoformat()
    start = window.start.isoformat()
    sql = f"""WITH e AS (
      SELECT gpsno,event_time,event_type FROM risk_events
      WHERE event_time >= TIMESTAMP '{start}' AND event_time < DATE '{end}' + INTERVAL 1 DAY
    ), s AS (SELECT * FROM e WHERE event_type IN (11803,11804))
    SELECT s.gpsno,
      count_if(e.event_time < s.event_time) AS before_count,
      count_if(e.event_time >= s.event_time) AS after_count
    FROM s JOIN e ON s.gpsno=e.gpsno AND e.event_type NOT IN (11803,11804)
      AND e.event_time BETWEEN s.event_time-INTERVAL 5 MINUTE AND s.event_time+INTERVAL 5 MINUTE
    GROUP BY s.gpsno"""
    return {r[0]: (r[1],r[2]) for r in con.execute(sql).fetchall()}
