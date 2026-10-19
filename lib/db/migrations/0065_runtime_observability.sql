CREATE TABLE IF NOT EXISTS runtime_diagnostics (
 fingerprint text NOT NULL, bucket timestamptz NOT NULL, environment text NOT NULL,
 metadata jsonb NOT NULL, count integer NOT NULL DEFAULT 1, last_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(fingerprint,bucket));
CREATE INDEX IF NOT EXISTS runtime_diagnostics_expiry_idx ON runtime_diagnostics(bucket);
CREATE TABLE IF NOT EXISTS runtime_health_samples (
 environment text NOT NULL, key text NOT NULL, bucket timestamptz NOT NULL, sample jsonb NOT NULL,
 PRIMARY KEY(environment,key,bucket));
CREATE INDEX IF NOT EXISTS runtime_health_expiry_idx ON runtime_health_samples(bucket);
CREATE TABLE IF NOT EXISTS runtime_api_metrics (
 environment text NOT NULL, instance text NOT NULL, bucket timestamptz NOT NULL,
 route text NOT NULL, method text NOT NULL, summary jsonb NOT NULL,
 PRIMARY KEY(environment,instance,bucket,route,method));
CREATE INDEX IF NOT EXISTS runtime_metrics_expiry_idx ON runtime_api_metrics(bucket);
CREATE TABLE IF NOT EXISTS runtime_ingestion_limits (
 key text NOT NULL, bucket timestamptz NOT NULL, count integer NOT NULL, PRIMARY KEY(key,bucket));
CREATE TABLE IF NOT EXISTS runtime_incidents (
 environment text NOT NULL, key text NOT NULL, state text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(), delivery text NOT NULL DEFAULT 'disabled',
 PRIMARY KEY(environment,key));
CREATE TABLE IF NOT EXISTS runtime_observability_config (
 environment text PRIMARY KEY, mode text NOT NULL DEFAULT 'off', destination text NOT NULL DEFAULT 'slack');