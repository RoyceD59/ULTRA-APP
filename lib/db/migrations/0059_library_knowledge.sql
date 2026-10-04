ALTER TABLE team_library_docs
  ADD COLUMN IF NOT EXISTS knowledge_status text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS knowledge_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knowledge_title text,
  ADD COLUMN IF NOT EXISTS knowledge_text text,
  ADD COLUMN IF NOT EXISTS knowledge_hash text,
  ADD COLUMN IF NOT EXISTS knowledge_reviewed_by text,
  ADD COLUMN IF NOT EXISTS knowledge_reviewed_at timestamptz;