"""Authoritative mapping from all 24 documented event codes to score dimensions."""

from __future__ import annotations

DIMENSION_LABELS = {
    "history": "历史事故与未遂",
    "fatigue_distraction": "疲劳与分心",
    "driving_stability": "驾驶稳定性",
    "road_rule": "道路规则风险",
    "management": "管理配合度",
    "imu_evidence": "IMU风险佐证",
}

# Blind-spot warnings are assigned to driving stability so every documented
# event belongs to one of the repository's fixed six dimensions.
EVENT_TAXONOMY = {
    11803: ("事故", "history"),
    11804: ("未遂事故", "history"),
    41001: ("疲劳（闭眼）", "fatigue_distraction"),
    41002: ("打哈欠", "fatigue_distraction"),
    41003: ("注意力分散", "fatigue_distraction"),
    41004: ("打电话", "fatigue_distraction"),
    41005: ("抽烟", "fatigue_distraction"),
    41009: ("频繁低头", "fatigue_distraction"),
    41023: ("看手机", "fatigue_distraction"),
    41029: ("困倦", "fatigue_distraction"),
    30000: ("前碰撞预警", "driving_stability"),
    30002: ("左车道偏移", "driving_stability"),
    30003: ("右车道偏移", "driving_stability"),
    30005: ("车距过近", "driving_stability"),
    30017: ("长时间压线", "driving_stability"),
    60292: ("后盲区报警", "driving_stability"),
    60294: ("右盲区报警", "driving_stability"),
    11401: ("路口超速", "road_rule"),
    11402: ("主路弯道超速", "road_rule"),
    11403: ("危险路段超速报警", "road_rule"),
    11405: ("匝道超速", "road_rule"),
    11406: ("高速长下坡超速", "road_rule"),
    41006: ("摄像头遮挡", "management"),
    41021: ("摄像头角度扭转", "management"),
}

EXPECTED_EVENT_CODES = frozenset(EVENT_TAXONOMY)


def dimension_for(event_type: int) -> str:
    """Return the configured dimension; unknown event codes fail loudly."""
    return EVENT_TAXONOMY[int(event_type)][1]
