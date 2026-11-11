# 部署与数据交付

## 文件组成

| 文件 | 用途 |
|---|---|
| `IE-Agent-platform-v0.3.1.zip` | 当前完整源码、文档、测试及预构建界面 |
| `IE-Agent-data-v0.3.1.zip` | 干净业务库、只读历史索引压缩件、四份评分重算Parquet和CSV导出 |
| `PRODUCT_DESIGN.md` | 简明产品设计，可直接阅读 |
| `SHA256SUMS.txt` | Release附件完整性校验 |

本次源码与完整数据发布于 Karlll330/IE-Agent 的 platform-v0.3.1 Release，包含2026年11月3日至4日的功能修正。

## 数据还原

按根目录README启动。`scripts/install-data.py`使用`data/release-manifest.json`中的固定Release地址和SHA-256，先校验数据ZIP，再逐文件校验，最后还原`var/history.sqlite`。下载到本机的ZIP和密码文件均被Git忽略。

数据约需1GB以上磁盘空间，另外还需依赖和下载缓存空间。历史索引原大小约784MB，压缩件约149MB；事件索引3152654行。重算使用`scoring-data/data/processed/cleaned/`下的`risk_events.parquet`、`trajectory_daily.parquet`、`imu_daily.parquet`和`vehicle_profile.parquet`。

数据库路径相对于`var/data-manifest.json`解析，已经移除原作者电脑路径。`SCORING_DATA_ROOT`缺省指向本项目`scoring-data/`。日常启动不重新建库、重置账号或重算评分。

还原脚本不会覆盖已经改变的业务库；如提示已有库与发行基线不同，请使用新目录并保留旧库。脚本中断后，校验一致的文件可复用，完整性不一致时会停止。

## 公开包做了什么处理

保留车辆演示映射、标签、评分、预测、台账、课程及审核状态、运营参数和评分版本基线。公开副本清空原账号、口令哈希、SSO绑定、登录会话、聊天、个人资料、历史操作审计、学习反思、私人案卷处置和个人报告。清理后执行SQLite安全删除和VACUUM，避免删除内容残留在空闲页。

本机原业务库没有被修改。部署者运行`npm run setup:local`后，在自己的电脑创建三个随机密码的演示账号；首次登录强制修改密码。首次启动再按当前日期生成个人简报，不把原使用者的运行记录当成新部署的业务记录。

`history.sqlite`与四份Parquet保留用户要求的比赛查询/评分数据。数据包含车辆历史行为信息，使用者应按比赛与数据来源授权范围使用；不要自行加入真实姓名、电话等身份资料后再公开。

## 模型与后台任务

`.env.example`只列配置项，不含密钥。填写自己的`QW_AI_BASE_URL`、`QW_AI_MODEL`和`QW_AI_API_KEY`后重启；比赛部署只使用组委会千问办公企业版提供的标准、高级或 Qwen3.8-MAX 能力；端点和模型标识以该工作台实际分配值为准，不使用其他第三方大模型服务。示例不预置外部付费接口。外部模型未配置时，不会自动切换本地模型。

新电脑初次部署时，按实际团队的数据发送安排配置AI功能。每日简报在北京时间07:00后由本地队列生成；交接班按个人设置执行。进程关闭后暂停，恢复运行会继续未完成工作。本地HTTP服务及私有数据库网关均监听回环地址，不能直接当作多人公网部署。

## 功能与权限核验

1. 首次登录三个账号，分别修改初始密码；司机只见自己的绑定车辆，安全员界面没有模型配置入口。
2. 管理员车队页面应有500辆车及A/B/C/D四级，评分数据截止2026-07-31，历史评分共7000条（14个日期）。
3. 选择车辆和历史日期回放事件，确认案卷、消息和处置可以关联；历史回放与真实当日预警应保持区分。
4. 选择已审核课程向C/D级司机分配；司机答题、反思、提交，安全员验收，核对两端通知与任务状态。
5. 等待或手动查看每日简报；已配置模型时可请求AI解读，核对发布日、实际数据日和来源卡。

自动化验证：`npm run typecheck`、`npm run build`、`npm run test:distribution`。完整数据/权限/重算测试还可运行`node --test tests/full-data.test.mjs tests/model-duty.test.mjs tests/driver-merge.test.mjs`，它们使用临时数据库副本；因子重算测试需要先安装Python依赖。

## 常见问题

- **Node报无法加载node:sqlite：** 本地完整模式需Node.js 24+。
- **没有登录账号：** 确认已运行`npm run setup:local`，在本机打开`var/initial-accounts.json`。
- **首次登录多数接口拒绝：** 先按个人信息页面要求修改初始密码，这是正常门禁。
- **查询正常，因子预览失败：** 安装`requirements-model.txt`，检查`.venv`或`MODEL_PYTHON`及四份Parquet；只改权重不需要这一过程。
- **AI提示未配置：** 填写`.env.local`中的模型配置后重启，不要把密钥写进前端。
- **端口占用：** 停止原服务，或在`.env.local`设置`LOCAL_PORT`。

该发行版没有执行云端发布。旧云端/PostgREST启动方式保留，但新增SQLite模块、后台任务和数据迁移仍需要独立部署适配。
