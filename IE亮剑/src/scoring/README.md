# 任务二：司机安全评分

运行 `python -m src.scoring.evidence_score`，生成 `outputs/scoring/v2/safety_scores.csv`、事件归因台账和历史验证记录。评分使用 14 天行为证据、六维权重和冻结参考分布；公开扣分扣除同暴露零事件先验背景。缺失 IMU 影响单独的可信度和保守下界。预测概率仅进入复核队列，不改写安全分。配置见 `configs/submission/scoring_reference.json`。
