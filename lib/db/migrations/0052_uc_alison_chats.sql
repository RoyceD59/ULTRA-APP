CREATE TABLE IF NOT EXISTS uc_alison_conversations (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uc_alison_conversations_cursor_idx
  ON uc_alison_conversations(created_at, id);
CREATE INDEX IF NOT EXISTS uc_alison_conversations_expiry_idx
  ON uc_alison_conversations(created_at);

CREATE TABLE IF NOT EXISTS uc_alison_turns (
  conversation_id text NOT NULL REFERENCES uc_alison_conversations(id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  user_message text NOT NULL,
  assistant_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, turn_id)
);
CREATE INDEX IF NOT EXISTS uc_alison_turns_order_idx
  ON uc_alison_turns(conversation_id, created_at, turn_id);