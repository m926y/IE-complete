# 驾驶安全算法比赛提交方案

本仓库提供任务一未来 40 天事故风险预测、任务二司机安全评分，以及比赛要求的四件提交材料生成程序。算法报告源码为 [`docs/method_report.tex`](docs/method_report.tex)。比赛原始数据、清洗表、逐车结果和提交包保留在本地，不纳入公开代码仓库。

## 环境与输入

建议使用 Python 3.11 或更新版本。执行 `python -m pip install -r requirements-lock.txt` 安装已验证的依赖版本，也可使用 `requirements.txt` 的版本区间。编译报告需要 XeLaTeX。将比赛数据放在 `data/raw/`；清洗脚本使用原始压缩文件和画像工作簿，具体文件校验见 `src/data/clean_data.py`。

仓库中的 `data/templates/forecast_result_template.csv` 是结果格式模板，不包含比赛结果。

## 一键复现

```powershell
python -m src.reproduce_submission --clean --rebuild-features --package
python -m src.delivery.validate submission/final
```

已有 `data/processed/cleaned/` 和 `outputs/features/` 时，可省略 `--clean --rebuild-features`。只生成两项结果和运行测试时，省略 `--package`。若 XeLaTeX 不可用，可先提供已编译 PDF：

```powershell
python -m src.delivery.build --precompiled-pdf path/to/method_report.pdf
```

生成的四件材料位于 `submission/final/`：`forecast_result.csv`、`safety_scores.csv`、`method_report.pdf`、`source_code.zip`。代码包仅包含复现所需的程序、配置、报告 TeX 和汇总评估，不包含原始或清洗数据、逐车特征及模型文件。

## 代码结构

| 位置 | 作用 |
| --- | --- |
| `src/data/` | 原始数据清洗 |
| `src/features/` | 时间窗口、标签、特征构造及交付审计 |
| `src/prediction/forecast_v2.py` | 40 天目标训练、验证与任务一结果 |
| `src/scoring/evidence_score.py` | 六维行为评分、事件台账、动态复核与任务二结果 |
| `src/delivery/` | 四件套构建与格式、内容验收 |
| `configs/submission/` | 冻结特征列、评分权重和参考分布 |
| `tests/` | 时序、计分、归因和交付规则测试 |

任务一的内部车辆分组五折平均 AUC 为 0.8445。任务二在 2026-07-17 截止的 14 天历史回顾 AUC 为 0.8618，在 2026-06-21 截止的 40 天回顾 AUC 为 0.8385。这些是历史数据上的验证结果，不代表未来盲测成绩。详情见 `outputs/prediction/v2/evaluation.json` 与 `outputs/scoring/v2/evaluation.json`（本地生成）。
