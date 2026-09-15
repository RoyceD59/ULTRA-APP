import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildImpactShareMessage } from '../../lib/impactBadge.ts';

describe('ImpactShareModal pure logic', () => {
  it('uses the shared badge caption with current impact and no PII', () => {
    const message = buildImpactShareMessage(1250, 4, 'UC123');
    assert.match(message, /1,250 L refilled/);
    assert.match(message, /Level 4/);
    assert.match(message, /UC123/);
    assert.match(message, /Ultra-Clear/);
    
    // Ensure no name or other PII placeholders snuck in
    assert.doesNotMatch(message, /Name/i);
    assert.doesNotMatch(message, /User/i);
  });
});
