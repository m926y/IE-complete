"""Deterministic, per-vehicle, past-only feature calculations."""
import math
import statistics
from collections import defaultdict
from .event_groups import SERIES, EVENT_GROUPS
from .runtime import records
from .window_definitions import DAY

def ratio(n, d):
    return n / d if n is not None and d is not None and d > 0 else None

def total(values):
    values = [v for v in values if v is not None]
    return sum(values) if values else None

def mean(values):
    values = [v for v in values if v is not None]
    return statistics.fmean(values) if values else None

def std(values):
    values = [v for v in values if v is not None]
    return statistics.pstdev(values) if values else None

def maximum(values):
    values = [v for v in values if v is not None]
    return max(values) if values else None

def pooled_moments(rows, n_col, mean_col, std_col):
    rows = [r for r in rows if r.get(n_col,0) and r.get(mean_col) is not None and r.get(std_col) is not None]
    n = sum(r[n_col] for r in rows)
    if not n:
        return None, None
    mu = sum(r[n_col]*r[mean_col] for r in rows)/n
    second = sum(r[n_col]*(r[std_col]**2+r[mean_col]**2) for r in rows)/n
    return mu, math.sqrt(max(0,second-mu**2))

def longest_run(values):
    best = current = 0
    for value in values:
        current = current+1 if value else 0
        best = max(best,current)
    return best

class Sources:
    def __init__(self, con):
        self.profiles = records(con,'SELECT * FROM profile ORDER BY gpsno')
        self.daily = {}
        for name in ('risk_daily','trajectory','imu'):
            grouped = defaultdict(dict)
            for row in records(con,f'SELECT * FROM {name} ORDER BY gpsno,event_date'):
                grouped[row['gpsno']][row['event_date']] = row
            self.daily[name] = grouped

    def between(self, table, gpsno, start, end):
        data = self.daily[table][gpsno]
        return [data[d] for i in range((end-start).days+1) if (d:=start+i*DAY) in data]

def build_window_features(sources, window, registry, warning_counts=None):
    output=[]
    for profile in sources.profiles:
        gpsno=profile['gpsno']
        row={'gpsno':gpsno,**window.metadata()}
        def emit(name,value,group,description,**kwargs):
            registry.add(name,group,description,**kwargs)
            row[name]=value

        for key,value in profile.items():
            if key=='gpsno':
                continue
            is_ratio=key.endswith('_ratio')
            emit('profile_'+key,value,'profile','原始近半年画像；统计截止日未提供，严格时间验证禁用',
                 unit='fraction' if is_ratio else ('category' if key=='energy_type' else 'source_unit'),
                 window='unknown_snapshot', dtype='VARCHAR' if key=='energy_type' else 'DOUBLE',
                 source='vehicle_profile', eligibility='snapshot_time_unverified',
                 numerator=key if is_ratio else '', denominator='画像原定义的总里程/总时长（截止日未知）' if is_ratio else '')

        # Same fixed14 names have identical meanings in train and full-61d output.
        for tag,days in [('window',window.days),('14d',14)]:
            start=window.end-(days-1)*DAY
            available=start>=window.start
            risks=sources.between('risk_daily',gpsno,start,window.end) if available else []
            traj=sources.between('trajectory',gpsno,start,window.end) if available else []
            imu=sources.between('imu',gpsno,start,window.end) if available else []
            recommend=tag=='14d'
            wind='feature_window' if tag=='window' else 14
            def put(base,value,group,description,unit='count',denominator='',numerator='',rec=None,source='risk_event_daily',missing='unavailable -> NULL'):
                emit(f'{base}_{tag}',value if available else None,group,description,unit=unit,window=wind,
                     denominator=denominator,numerator=numerator,source=source,missing=missing,
                     recommend=recommend if rec is None else (recommend and rec))
            distance=total(r['distance_km'] for r in traj)
            hours=total(r['run_time_hours'] for r in traj)
            active=sum(r['moving_rows']>0 for r in traj)
            put('distance_km',distance,'exposure','窗口有效距离之和','km',source='trajectory_daily')
            put('run_time_hours',hours,'exposure','清洗层累计运行时长之和；不等同于驾驶时长','hour',source='trajectory_daily')
            put('active_days',active,'exposure','moving_rows>0的车辆日期数','day',source='trajectory_daily')
            for name,data in [('trajectory',traj),('imu',imu)]:
                put(name+'_days',len(data),'quality','存在该数据源记录的天数','day',rec=False,source=name+'_daily')
                put(name+'_coverage',len(data)/days,'quality','有记录天数/窗口日历天数','fraction',
                    'feature_window_days' if tag=='window' else '14 calendar days',name+'_days',source=name+'_daily')
                put(name+'_missing',int(not data),'quality','整个窗口没有该传感器数据','flag',rec=False,source=name+'_daily')
                put(name+'_complete',int(len(data)==days),'quality','窗口每个日历日都有该数据源记录','flag',rec=False,source=name+'_daily')
            put('distance_daily_mean',ratio(distance,len(traj)),'exposure','有轨迹日期的日均里程','km/day','trajectory_days','distance_km',rec=False,source='trajectory_daily')
            put('hours_daily_mean',ratio(hours,len(traj)),'exposure','有轨迹日期的日均运行时长','hour/day','trajectory_days','run_time_hours',rec=False,source='trajectory_daily')
            put('distance_daily_std',std(r['distance_km'] for r in traj),'trajectory','已观测日里程标准差','km',source='trajectory_daily')
            put('hours_daily_std',std(r['run_time_hours'] for r in traj),'trajectory','已观测日运行时长标准差','hour',source='trajectory_daily')
            n=total(r['source_rows'] for r in traj)
            valid=total(r['valid_speed_rows'] for r in traj)
            moving=total(r['moving_rows'] for r in traj)
            put('moving_rows',moving,'exposure','移动轨迹点数',rec=False,source='trajectory_daily')
            mu,sigma=pooled_moments(traj,'valid_speed_rows','speed_mean_kmh','speed_std_kmh')
            put('speed_mean',mu,'trajectory','按有效速度点数合并的均速','km/h',source='trajectory_daily')
            put('speed_std',sigma,'trajectory','按有效点数合并二阶矩得到的速度标准差','km/h',source='trajectory_daily')
            put('speed_max',maximum(r['speed_max_kmh'] for r in traj),'trajectory','最大有效速度','km/h',source='trajectory_daily')
            for base,num in [('moving_fraction',moving),('speed_valid_fraction',valid),
                ('coordinate_valid_fraction',total(r['valid_coordinate_rows'] for r in traj)),
                ('coordinate_invalid_fraction',total(r['invalid_coordinate_rows'] for r in traj)),
                ('large_distance_gap_fraction',total(r['large_distance_gap_rows'] for r in traj))]:
                put(base,ratio(num,n),'quality',base+'；按原始点数计算','fraction','trajectory source_rows',base+' numerator',source='trajectory_daily')

            for series,codes in SERIES.items():
                values=[sum(r[f'evt_{c}_count'] for c in codes) for r in risks]
                cnt=sum(values)
                group='event_type' if series.startswith('evt_') else 'event_group'
                put(series+'_count',cnt,group,'窗口内记录的事件次数',missing='no recorded event -> 0',rec=True)
                put(series+'_event_days',sum(v>0 for v in values),group,'有该事件的日期数','day',rec=series in EVENT_GROUPS)
                put(series+'_max_daily',max(values,default=0),group,'最大单日次数',rec=False)
                decay=sum(v*2**(-(window.end-r['event_date']).days/14) for r,v in zip(risks,values))
                put(series+'_decayed_count',decay,group,'半衰期14天，截止日权重1的衰减次数',rec=series in EVENT_GROUPS)
                for suffix,den,den_name,unit in [('per_1000km',ratio(distance,1000),'distance_km/1000','events/1000km'),
                                               ('per_100h',ratio(hours,100),'run_time_hours/100','events/100h'),
                                               ('per_active_day',active,'active_days','events/day')]:
                    put(series+'_rate_'+suffix,ratio(cnt,den),group,'计数/同一窗口暴露量；缺失或零分母保持NULL',unit,den_name,series+'_count',rec=series in EVENT_GROUPS)
                dates=[r['event_date'] for r,v in zip(risks,values) if v]
                put(series+'_recency_days',(window.end-max(dates)).days if dates else None,group,
                    '距窗口内最近一次记录天数；无记录为NULL（左删失）','day',rec=series in EVENT_GROUPS or series in ('evt_11803','evt_11804'))
                put(series+'_has_history',int(bool(dates)),group,'此窗口内有事件记录','flag',rec=False)

            counts=[r['total_count'] for r in risks]
            put('risk_count',sum(counts),'clustering','所有类型事件计数',rec=False)
            put('risk_max_daily',max(counts,default=0),'clustering','最大单日总次数')
            put('risk_day_fraction',sum(v>0 for v in counts)/days,'clustering','有记录事件日期/日历天数','fraction','calendar days','risk event days')
            put('risk_longest_run',longest_run(counts),'clustering','最长连续有记录事件天数','day')
            put('multigroup_days',sum(r['risk_group_nunique']>=3 for r in risks),'clustering','至少三个风险维度同日出现的天数','day')
            hour_counts=[sum(r[f'hour_{h:02d}_count'] for r in risks) for h in range(24)]
            put('hour_peak_fraction',ratio(max(hour_counts,default=0),sum(counts)),'clustering',
                '24个小时桶最大次数/总次数','fraction','risk_count','maximum hour bucket')
            put('event_speed_mean',ratio(total(r['speed_sum'] for r in risks),sum(r['speed_valid_count'] for r in risks)),
                'clustering','事件有效速度加权均值','km/h',source='risk_event_daily')
            put('event_speed_max',maximum(r['risk_speed_max_kmh'] for r in risks),'clustering','事件最大有效速度','km/h')

            imu_n=total(r['source_rows'] for r in imu)
            for base,col in [('ems_missing_fraction','missing_ems_speed_rows'),('gps_missing_fraction','missing_gps_speed_rows'),
                ('accel_outlier_fraction','accel_norm_outlier_rows'),('gyro_gt20_fraction','gyro_norm_gt20_rows')]:
                put('imu_'+base,ratio(total(r[col] for r in imu),imu_n),'imu',
                    '候选/缺失点数除以IMU原始记录数；不是事故率','fraction','imu source_rows',col,source='imu_daily')
            for field in ('ems_speed_mean','gps_speed_mean','ems_gps_abs_diff_mean'):
                put('imu_'+field+'_daily_mean',mean(r[field] for r in imu),'imu',
                    '非空日均值的等权平均；日表缺有效样本数，非逐点平均','km/h',source='imu_daily',rec=True)
            for axis in ('accel_x','accel_y','accel_z','gyro_x','gyro_y','gyro_z','accel_norm','gyro_norm'):
                norm=axis.endswith('norm')
                for statistic in ('mean','std'):
                    put('imu_'+axis+'_'+statistic+'_daily_mean',mean(r[f'{axis}_{statistic}'] for r in imu),'imu',
                        '非空日'+statistic+'的等权平均；不声称全窗口逐点统计','raw_sensor_unit',source='imu_daily',rec=norm)
                key=axis+('_max' if norm else '_abs_max')
                put('imu_'+key,maximum(r[key] for r in imu),'imu','各日极值的最大值','raw_sensor_unit',source='imu_daily',rec=norm)

        # Fixed-length counts; a 14-day window must not peek back 30 days.
        for length in (7,14,30):
            start=window.end-(length-1)*DAY
            risks=sources.between('risk_daily',gpsno,start,window.end) if start>=window.start else None
            for series,codes in SERIES.items():
                name=f'{series}_recent_count_{length}d'
                value=sum(sum(r[f'evt_{c}_count'] for c in codes) for r in risks) if risks is not None else None
                emit(name,value,'recent','固定长度近期记录次数；历史不足为NULL',window=length,
                     recommend=length==7 and series in EVENT_GROUPS)

        recent_start=window.end-6*DAY
        previous_start=window.end-13*DAY
        for group,codes in EVENT_GROUPS.items():
            rates=[]
            for start,end in [(recent_start,window.end),(previous_start,recent_start-DAY)]:
                risks=sources.between('risk_daily',gpsno,start,end) if start>=window.start else []
                traj=sources.between('trajectory',gpsno,start,end) if start>=window.start else []
                cnt=sum(sum(r[f'evt_{c}_count'] for c in codes) for r in risks)
                hours=total(r['run_time_hours'] for r in traj)
                rates.append(ratio(cnt,ratio(hours,100)))
            trend=math.log((rates[0]+.1)/(rates[1]+.1)) if all(v is not None for v in rates) else None
            emit(group+'_trend_7d_vs_prev7d',trend,'trend','log((近期每百小时率+0.1)/(前期每百小时率+0.1))',
                 unit='log_ratio',window=14,numerator='recent7 rate_per_100h + 0.1',
                 denominator='previous7 rate_per_100h + 0.1',recommend=True)

        before,after=(warning_counts or {}).get(gpsno,(0,0))
        for label,value in [('before',before),('after',after)]:
            emit('warnings_'+label+'_severe_5min_window',value,'clustering',
                 '历史高危事件前/后5分钟的非高危预警配对数；两端均限定在特征期，可重复配对')
        output.append(row)
    return output
