-- 回退：**未执行**。仅删除本表（业务表未被改动：interventions/notification_events 无新增列/外键）。
-- 前置检查（属主执行前人工确认）：
--   select count(*) from audit_logs where entity_type='notification_template';  -- 审计保留于 audit_logs，不随回退删除
--   回退前确认无发送流程依赖（RM03 只是把模板渲染文本注入既有可编辑草稿，不存 template_ref）。
DROP INDEX IF EXISTS public.nt_status_scene_idx;
DROP TABLE IF EXISTS public.notification_templates;
