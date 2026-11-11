-- 迁移 007：evaluation_rule_drafts.status 扩展批准/生效两态（属主 2026-10-27 指令开放评分标准配置）
-- 状态：**已于 2026-10-27 经平台控制 API database/migrate 执行成功**（schema 相对形式，与前缀教训一致）
-- 效果：draft → pending_review → approved → effectuated（或 archived/withdraw 边不变）
-- 仅改 CHECK 枚举；零数据改写；回退 down.sql=恢复旧枚举（存在 approved/effectuated 行时会失败——回退需先归档这些行，属预期人工步骤）
ALTER TABLE evaluation_rule_drafts DROP CONSTRAINT IF EXISTS evaluation_rule_drafts_status_check;
ALTER TABLE evaluation_rule_drafts ADD CONSTRAINT evaluation_rule_drafts_status_check CHECK (status IN ('draft','pending_review','approved','effectuated','archived'));
-- 补（同日）：002 时代旧约束 ck_erd_status（仅三态）也限制新链路，经 008 迁移删除：
ALTER TABLE evaluation_rule_drafts DROP CONSTRAINT IF EXISTS ck_erd_status;
