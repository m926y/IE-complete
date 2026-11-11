# Data-Technology-Competiton

驾驶安全项目合集。两个子项目独立维护，不共享依赖或业务数据库。

| 子项目 | 内容 | 入口 |
| --- | --- | --- |
| IE-Agent | 行安 Agent 工作台 v0.3.1，React + Node.js + SQLite | [使用说明](IE-Agent/README.md) |
| IE亮剑 | 比赛算法：40 天风险预测、安全评分与提交材料 | [复现说明](IE亮剑/README.md) |

请先阅读 [项目结构说明](docs/项目结构说明.md) 和 [工作台检查报告](docs/工作台检查报告.md)。

## 本地使用

工作台：进入 `IE-Agent`，Windows 完整包可双击 `启动平台.cmd`。首次账号由本机生成，见 `var/initial-accounts.json`。从 GitHub 获取源码时需要 Node.js 24+，执行 `npm ci`、`python scripts/install-data.py`、`npm run setup:local`、`npm run build`、`npm run start:local`。完整数据的下载与来源见子项目发行清单。

算法：进入 `IE亮剑`，安装 `requirements-lock.txt` 后按其 README 复现。原始比赛数据需另行准备，编译报告需要 XeLaTeX。

数据库、比赛原始/清洗数据、账号、密钥、会话、聊天、个人材料、本机依赖与构建产物只保留本地。代码上传不等于线上部署或真实模型联调验收。
