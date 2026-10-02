-- Persist preview activation in the existing durable team settings singleton.
-- Defaults are deliberately off and existing settings/data are preserved.
ALTER TABLE team_settings
  ADD COLUMN IF NOT EXISTS care_overview_preview boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refill_governance_preview boolean NOT NULL DEFAULT false;