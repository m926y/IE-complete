# 任务一：40 天事故风险预测

运行 `python -m src.prediction.forecast_v2`，生成 `outputs/prediction/v2/forecast_result.csv` 和内部验证记录。模型使用截至 2026-07-31 的 14 天特征，直接学习比赛定义的未来 40 天二分类标签。历史验证按车辆分组，概率经训练外校准。固定特征列见 `configs/submission/prediction_features.json`。
