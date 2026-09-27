CREATE TABLE IF NOT EXISTS uc_guides (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  products text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'document-text-outline',
  read_time text NOT NULL DEFAULT '3 min read',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  published_snapshot jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uc_guides_status_updated_idx ON uc_guides(status, updated_at);
CREATE TABLE IF NOT EXISTS uc_guide_sections (
  id text PRIMARY KEY,
  guide_id text NOT NULL REFERENCES uc_guides(id) ON DELETE CASCADE,
  position integer NOT NULL,
  heading text NOT NULL,
  body text,
  steps text[] NOT NULL DEFAULT '{}',
  tip text,
  warning text,
  illustration_icon text
);
CREATE INDEX IF NOT EXISTS uc_guide_sections_guide_position_idx ON uc_guide_sections(guide_id, position);
CREATE TABLE IF NOT EXISTS uc_guide_media (
  id text PRIMARY KEY,
  section_id text NOT NULL REFERENCES uc_guide_sections(id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','animation','video')),
  url text NOT NULL,
  object_path text,
  mime_type text NOT NULL,
  alt_text text NOT NULL,
  caption text,
  poster_url text,
  byte_size integer,
  duration_seconds integer,
  animated boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS uc_guide_media_section_position_idx ON uc_guide_media(section_id, position);