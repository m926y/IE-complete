# 最终司机安全评分

入口：python -m src.scoring.enhanced；更新：python -m src.scoring.enhanced --as-of 2026-07-31。输出outputs/scoring。

固定14天观察与半衰期，读取configs/submission/scoring_frozen.json的参考分布和权重。行为安全分=100减六维贡献；IMU缺失的不确定性只影响单列下界。贡献包含先验收缩，等级按20%/40%/30%/10%容量分层。

提供8天动态评分、7日变化、等级观察率Wilson区间与前三项原因。IMU异常采样点不是独立事件数；低可信度先复核设备，不自动处罚。详见docs/final_optimization.md。
