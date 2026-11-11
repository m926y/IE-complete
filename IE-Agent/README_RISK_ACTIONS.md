# 案卷处置与平台动作

原页面的风险确认、误报、证据不足、文字干预和反馈已有后端状态写入；原培训按钮只预填分配页面，文字中的休息/检修不会产生操作。

新增结构化措施：发送司机消息、安排培训、休息换班跟进、调度协调跟进、设备数据核验、回访。填写核查依据，选择措施，预览后确认执行。模型不负责推断接收人或执行权限；执行使用确定性业务接口。

消息同步写入交流窗口、干预记录和站内通知；培训创建真实training_tasks，关联alert_id及分配时评分版本，司机通知可直接进入培训。已有相同课程的未结束任务会复用并在案卷中保留关联。其余措施创建risk_action_followups，进入管理端待办，由安全员填写落实依据后完成；系统不声称已控制车辆、实际完成换班或检修。

risk_case_actions保存执行回执，risk_action_plans保存30分钟待确认预览。执行前复查当前账号范围、案卷、绑定、评分、课程版本及审核状态；状态变化需要重新预览。发送与培训仅用于已确认的非影子风险；培训仅限高/中可信C、D，综合决策仅D，并要求演示停车信号。所有动作与案卷、审计在同一事务内提交，失败全量回滚；同一计划重试不会重复发消息或派任务。

消息再次发送会清除旧反馈，要求司机针对最新措施反馈。跟进尚未落实、培训尚未审核时禁止关闭案卷，原有复核、处置、反馈门禁继续生效。所有事件仍标注历史回放，不下发真实终端。

接口：POST /api/risk/actionPreview、actionApply、actionComplete。GET /api/risk/live的管理端案卷含action_state与action_options；司机不返回内部回执、课程列表和管理端跟进内容。

验证：node --test tests/risk-actions.test.mjs tests/risk-monitor.test.mjs tests/risk-monitor-api.test.mjs tests/action-center.test.mjs。
