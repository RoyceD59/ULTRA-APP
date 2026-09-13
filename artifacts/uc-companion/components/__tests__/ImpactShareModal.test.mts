import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareMessage } from '../ImpactShareModal';

describe('ImpactShareModal pure logic', () => {
  it('buildShareMessage formats the litres correctly without PII', () => {
    const message = buildShareMessage(1250);
    assert.match(message, /1250 litres/);
    assert.match(message, /Ultra-Clear/);
    assert.match(message, /zero plastic waste/);
    
    // Ensure no name or other PII placeholders snuck in
    assert.doesNotMatch(message, /Name/i);
    assert.doesNotMatch(message, /User/i);
  });
});
