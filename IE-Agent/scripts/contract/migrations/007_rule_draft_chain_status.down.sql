ALTER TABLE evaluation_rule_drafts DROP CONSTRAINT IF EXISTS evaluation_rule_drafts_status_check;
ALTER TABLE evaluation_rule_drafts ADD CONSTRAINT evaluation_rule_drafts_status_check CHECK (status IN ('draft','pending_review','archived'));
