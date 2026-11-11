"""Human-readable deduction reasons and operational actions."""

from __future__ import annotations

from .event_taxonomy import DIMENSION_LABELS

REASON_CODES = {
    "history": "R_HISTORY",
    "fatigue_distraction": "R_FATIGUE",
    "driving_stability": "R_STABILITY",
    "road_rule": "R_ROAD_RULE",
    "management": "R_MANAGEMENT",
    "imu_evidence": "R_IMU_EVIDENCE",
}

TRAINING_TOPICS = {
    "history": "事故与未遂事件复盘",
    "fatigue_distraction": "疲劳识别与分心驾驶纠正",
    "driving_stability": "跟车距离、车道保持与防御性驾驶",
    "road_rule": "重点路段限速与规则复训",
    "management": "监控设备规范与配合要求",
    "imu_evidence": "平稳驾驶与车辆/传感器复核",
}


def reason_record(row, dimension: str, rank: int) -> dict:
    label = DIMENSION_LABELS[dimension]
    percentile = float(row[f"{dimension}_penalty"])
    points = float(row[f"{dimension}_contribution"])
    count = int(row.get(f"{dimension}_event_count", 0) or 0)
    rate = float(row[f"{dimension}_rate"])
    if dimension == "imu_evidence":
        text = f"IMU风险佐证处于全体第{percentile:.1f}百分位（仅作低权重佐证）"
    elif count == 0:
        text = (
            f"{label}未记录事件；低暴露收缩后风险率处于全体第{percentile:.1f}百分位"
            "（证据不足不按零风险处理）"
        )
    else:
        text = f"{label}事件{count}次，暴露调整风险率处于全体第{percentile:.1f}百分位"
    return {
        "reason_rank": rank,
        "reason_code": REASON_CODES[dimension],
        "reason_text": text,
        "dimension": dimension,
        "dimension_name": label,
        "penalty_points": round(points, 4),
        "event_count": count,
        "normalized_rate": round(rate, 6),
        "comparison_percentile": round(percentile, 2),
    }


def operational_action(
    risk_level: str,
    primary_dimension: str,
    confidence_level: str,
    primary_event_count: int,
) -> dict:
    action = {
        "A": ("正向激励、常规观察", "monthly", "保持当前安全表现"),
        "B": ("月度提醒和复盘", "monthly", "主要维度风险率下降10%"),
        "C": ("针对性培训、每周跟踪", "weekly", "主要维度风险率下降20%"),
        "D": ("重点干预、事件复核和管理闭环", "weekly", "完成事件闭环并使主要维度风险率下降30%"),
    }[risk_level]
    evidence_present = primary_dimension == "imu_evidence" or primary_event_count > 0
    training_topic = TRAINING_TOPICS[primary_dimension] if evidence_present else "补充驾驶暴露与持续观察"
    return {
        "recommended_action": action[0],
        "training_topic": training_topic,
        "review_cycle": action[1],
        "device_check_required": bool(
            (primary_dimension == "management" and primary_event_count > 0)
            or confidence_level == "low"
        ),
        "next_cycle_goal": action[2],
    }
