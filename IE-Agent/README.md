# 易流智安 · 驾驶安全管理平台

完整合并版 v0.3.1：管理员、安全员和司机共用同一套评分、风险案卷、培训、消息和AI工具。

- 车队安全评价：500辆车、六维评分、可信度、排名、趋势及事件证据。
- 管理员配置：权重、因子、严重度、参考口径、影响预览、版本比较与恢复。
- 风险处置：历史事件时钟回放、预警案卷、沟通、措施、培训及复查。
- 培训闭环：课程入库→审核→C/D级分配→司机学习/答题/反思→人工验收；支持线下预约。
- 司机端：行动摘要、风险沟通、培训、个人资料和每日安全简报。
- AI：周报HTML/Markdown文件、平台数据分析、培训及账号批次待确认清单、案卷学习建议和交接单。

这是完整历史数据演示版，事件数据覆盖2026年6—7月；报告当天生成不代表当天新增驾驶数据。当前没有接入真实车端实时事件流。

## 本次交付说明

- [各模块功能说明](docs/MODULE_GUIDE.md)
- [决赛要求核对及未完成的云端验收](docs/FINAL_REQUIREMENTS_AUDIT.md)
- [产品设计 PDF](docs/PRODUCT_DESIGN.pdf)

此前合并版曾完成188项回归；本次更新的验证情况见发行说明。千问办公正式部署及真实模型调用仍须由工作台所有者完成联调。

## 下载

[v0.3.1 Release](https://github.com/Karlll330/IE-Agent/releases/tag/platform-v0.3.1)提供完整代码包、完整数据包、产品设计文档和SHA-256校验清单。大文件以Release附件发布，不放进Git历史。

## 在新电脑启动

需要Node.js 24+、Python 3.10+；完整因子重算建议使用Python 3.12。首次登录账号在本机随机初始化，发布包不含原账号密码、会话、聊天、个人资料或模型密钥。

```powershell
git clone --branch delivery/platform-v0.3.1-20261104 https://github.com/Karlll330/IE-Agent.git
cd IE-Agent
python scripts/install-data.py
npm ci
npm run setup:local
npm run build
npm run start:local
```

打开 http://127.0.0.1:3100/ 。初始化生成`demo_admin`、`demo_officer`、`demo_driver`三个账号，随机初始密码只保存在本机`var/initial-accounts.json`。首次登录会要求修改密码，已有账号不会被初始化脚本覆盖。

已经手动下载数据包时：

```powershell
python scripts/install-data.py --bundle "C:/Downloads/IE-Agent-data-v0.3.1.zip"
```

需要AI时，将`.env.example`复制成`.env.local`并填写自己的外部模型密钥，再重启。默认接口使用现有`qwen3.7-plus`配置；未填写密钥时，查询、评分、培训、聊天和规则式简报仍可使用，AI会明确提示未配置。

需要调整因子、严重度、参考口径或评价窗口时，另安装评分依赖：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-model.txt
```

Windows自动优先使用`.venv/Scripts/python.exe`，Linux/macOS使用`.venv/bin/python`，也可通过`MODEL_PYTHON`指定。单纯调整六维权重使用已有基线，不需要重新读取Parquet；因子和窗口变更才调用Python重算。

## 数据范围

| 内容 | 数量 |
|---|---:|
| 车辆、当前评分及预测 | 各500 |
| 历史评分 | 4,000（8天×500辆） |
| 历史事件索引 | 3,152,654 |
| 事件日统计 | 198,873 |
| 轨迹日汇总 / IMU日汇总 | 28,827 / 14,836 |
| 扣分台账 | 6,267 |
| 课程 | 16，其中10门已审核 |

数据包还包含四份因子重算必需的清洗Parquet。原始轨迹/IMU逐点文件、其他训练实验、私人业务操作记录不属于本运行数据包。当前车辆映射为演示身份，不把过去车辆记录直接认定为现在绑定司机的行为。

## 文档

- [简明产品设计](docs/PRODUCT_DESIGN.md)：目标、角色、核心流程、AI、人因设计与边界。
- [部署与数据说明](docs/DEPLOYMENT.md)：包内容、恢复、环境配置、核验及常见问题。
- [合并记录](README_MERGE.md)：两版功能取舍和回归结果，文中的本机工作区路径属于历史记录。
- 其他`README_*.md`保留各模块的开发与使用说明；首次部署以本README及部署文档为准。

## 代码与校验

`src/`为React界面；`server.mjs`统一鉴权与API；`server/`为数据、评分、风险、聊天、培训及Agent模块；`scripts/scoring_source/`保存冻结评分逻辑；`tests/`为自动化回归。

```powershell
npm run typecheck
npm run build
npm run test:distribution
```

合并阶段124项相关回归已通过。本发行版另验证相对路径、干净数据还原、随机账号初始化、角色权限及因子重算。验证结果见发布说明。后台简报和交接任务需要服务进程保持运行；关闭浏览器不会停止后台任务。

本次是源码与本地运行数据的GitHub交付，没有部署公网业务服务。`npm start`保留旧云端入口，完整演示应使用`npm run start:local`。
