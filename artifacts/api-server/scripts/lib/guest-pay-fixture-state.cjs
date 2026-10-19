'use strict';
const { createCipheriv, createDecipheriv, hkdfSync, randomBytes } = require('node:crypto');
function key(secret) {
  if (!secret) throw new Error('Fixture state key unavailable');
  return Buffer.from(hkdfSync('sha256', secret, 'uc-guest-pay-fixture', 'private-state-v1', 32));
}
function encodeState(state, secret) {
  if (!secret) return state; // Credential-free local preparation only.
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  return { encrypted: true, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64') };
}
function decodeState(state, secret) {
  if (state.encrypted !== true) return state;
  if (typeof state.ciphertext !== 'string' || state.ciphertext.length > 65536) throw new Error('Invalid fixture state');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(state.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(state.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(state.ciphertext, 'base64')),
    decipher.final()]).toString('utf8'));
}
async function hasUnresolvedAttempt(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query(`SELECT count(*)::int AS count FROM uc_orders
      WHERE payment_confirmed_at IS NULL AND checkout_state NOT IN ('cancelled','expired')
      AND (NULLIF(payment_reference,'') IS NOT NULL OR checkout_snapshot->>'guestMpesaTokenHash' IS NOT NULL)`);
    return result.rows[0].count > 0;
  } finally { await pool.end(); }
}
module.exports = { encodeState, decodeState, hasUnresolvedAttempt };
