BEGIN;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_account_avatar_size' AND conrelid = 'app_users'::regclass) THEN
    ALTER TABLE app_users ADD CONSTRAINT ck_account_avatar_size CHECK (avatar_url IS NULL OR length(avatar_url) <= 65536);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_username_lower ON app_users (lower(username));
COMMIT;
