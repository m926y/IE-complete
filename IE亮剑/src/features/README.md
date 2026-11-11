# 特征与标签

运行 `python -m src.features.pipeline --overwrite` 构造历史训练窗口和截至 2026-07-31 的特征；运行 `python -m src.features.audit_delivery` 检查时间截止、数据来源与未来字段隔离。正式正类为未来 40 天内事故 11803 至少 1 条或未遂 11804 至少 2 条。全部输出位于本地 `outputs/features/`。
