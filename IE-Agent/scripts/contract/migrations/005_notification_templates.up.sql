-- ============================================================
-- 迁移 005：notification_templates（通知模板内容审核表）
-- 状态：**已于 2026-10-24T06:53:32Z 经平台控制 API database/migrate 执行成功**
-- （属主本轮指令授权）。实际执行=本文件内容去掉 "public." 前缀的 schema 相对形式
--   （平台 migrate 在当前页 tenant schema 内执行，带前缀触发 42501；语句体
--   列/约束/索引逐字一致，已由 GET /database/schema 与 information_schema 复核：
--   17 列、PRIMARY KEY(template_id)、UNIQUE(template_key,version)、
--   CHECK status/role/title/body、索引 nt_status_scene_idx；新表 0 行；22→23 表，
--   原业务表行数零变化）。回退仍用 down.sql，本轮不执行。
-- 基线影响：应用数据层 原15张表 + 扩展4张表 → 扩展层新增 1 张（共5张）。
--           （库内另有平台运行表 app_users/app_sessions/user_bindings，不计入业务扩展层。）
-- 设计约束：
--   * 模板正文不得混入 knowledge_articles；不改任何只读算法表
--     （drivers/risk_snapshots/score_snapshots/score_history/deduction_ledger/
--      review_queue/replay_events/evaluation_rules/training_courses/operation_config 的
--      *审核状态列* 除外——本表与之同类但物理独立）。
--   * 与业务表**零外键**：RM03 发送时把渲染结果注入既有可编辑草稿正文，
--     interventions/notification_events 不加列不加约束 → 回退仅需删本表。
--   * 同一 template_key 的多版本并存：修改已审核正文 = 生成新 draft 版本，
--     不静默覆盖 approved（应用层强制 + (template_key,version) 唯一约束兜底）。
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_templates (
  template_id          text PRIMARY KEY,            -- 'nt-' + 16hex，每个版本行独立 id
  template_key         text NOT NULL,               -- 业务键，如 rm3_verify_notice / rm3_contact_notice
  version              integer NOT NULL DEFAULT 1,  -- 同 key 自增
  title                text NOT NULL,               -- ≤160 字符（服务端校验）
  body                 text NOT NULL,               -- ≤4000，含 {{占位符}}
  allowed_placeholders text NOT NULL DEFAULT 'event_date,evidence_type,review_note',
  scene                text NOT NULL DEFAULT 'rm3_draft',   -- rm3_draft | task_assigned | review_answer
  applicable_role      text NOT NULL DEFAULT 'driver',      -- driver | safety_admin | all
  review_status        text NOT NULL DEFAULT 'draft',       -- draft→pending_review→approved→disabled
  status_version       integer NOT NULL DEFAULT 0,          -- 乐观锁状态版本
  source_note          text,                                -- 起草口径来源（人工填写；不由模型生成）
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz,
  reviewed_by          text,
  reviewed_at            timestamptz,
  review_note          text,
  CONSTRAINT notification_templates_key_version UNIQUE (template_key, version),
  CONSTRAINT notification_templates_status_enum CHECK (review_status IN ('draft','pending_review','approved','disabled')),
  CONSTRAINT notification_templates_role_enum    CHECK (applicable_role IN ('driver','safety_admin','all')),
  CONSTRAINT notification_templates_title_len    CHECK (char_length(title) <= 160),
  CONSTRAINT notification_templates_body_len     CHECK (char_length(body) <= 4000)
);
CREATE INDEX IF NOT EXISTS nt_status_scene_idx ON public.notification_templates (review_status, scene);
-- 种子数据：**不随迁移批量注入**。表建成后由安全管理员在 SM06「通知模板」页
-- 手工起草（初始即 draft，永不自动批准）——与“知识种子/三门演示课”同一红线。
