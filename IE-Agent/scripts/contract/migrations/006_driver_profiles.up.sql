-- 迁移 006：driver_profiles（司机自维护资料表——题面"维护司机个人信息"补齐）
-- 状态：**已于 2026-10-27 经平台控制 API database/migrate 执行成功**（schema 相对形式，同 005 先例）
-- 设计：仅司机本人经 /api/me/profile 读写（服务端强制 role=driver + 自身 user_id）；
--       phone 有格式 CHECK；不入 RESOURCE_DEFS（防任何列表通道越权读他人）；
--       与业务/算法表零外键，回退=DROP TABLE。
CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id    text PRIMARY KEY,
  phone      text,
  intro      text,
  prefs      text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_profiles_phone_fmt CHECK (phone IS NULL OR phone ~ '^[0-9+() -]{5,24}$')
);
