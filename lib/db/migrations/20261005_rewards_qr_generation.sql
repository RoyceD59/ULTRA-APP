-- Additive only: existing tokens remain valid, and no customer is rotated.
-- The nonce is not an opaque credential; the QR also requires the server key.
ALTER TABLE uc_users ADD COLUMN IF NOT EXISTS rewards_qr_nonce text;