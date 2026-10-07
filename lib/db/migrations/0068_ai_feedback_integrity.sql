ALTER TABLE uc_ai_feedback ADD COLUMN IF NOT EXISTS user_id integer;
ALTER TABLE uc_ai_feedback ADD COLUMN IF NOT EXISTS feedback_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uc_ai_feedback_key_idx ON uc_ai_feedback(feedback_key);
