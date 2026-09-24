CREATE TABLE IF NOT EXISTS uc_blog_articles (
  id text PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Water education',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','upload','brief','weekly','agent')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','rejected','published')),
  rationale text,
  rejection_feedback text,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  published_by text,
  version text NOT NULL DEFAULT '1',
  published_at timestamptz,
  published_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_blog_articles_slug_idx ON uc_blog_articles(slug);
CREATE UNIQUE INDEX IF NOT EXISTS uc_blog_articles_published_slug_idx
  ON uc_blog_articles ((published_snapshot->>'slug'))
  WHERE status='published' AND published_snapshot IS NOT NULL;
CREATE INDEX IF NOT EXISTS uc_blog_articles_status_updated_idx ON uc_blog_articles(status, updated_at);

CREATE TABLE IF NOT EXISTS uc_blog_article_history (
  id text PRIMARY KEY,
  article_id text NOT NULL REFERENCES uc_blog_articles(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  action text NOT NULL,
  rationale text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uc_blog_article_history_article_created_idx ON uc_blog_article_history(article_id, created_at);

CREATE TABLE IF NOT EXISTS uc_blog_topics (
  id text PRIMARY KEY,
  topic text NOT NULL,
  rationale text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('alison_aggregate','external_research','projecthub_brief','agent')),
  run_id text,
  source_url text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','drafted','skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uc_blog_topics_created_idx ON uc_blog_topics(created_at);

CREATE TABLE IF NOT EXISTS uc_blog_runs (
  id text PRIMARY KEY,
  run_key text NOT NULL UNIQUE,
  run_type text NOT NULL CHECK (run_type IN ('weekly','brief')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  requested_by text,
  brief text,
  result_summary text,
  error text,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS uc_blog_runs_created_idx ON uc_blog_runs(created_at);