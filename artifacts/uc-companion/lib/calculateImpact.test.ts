// @ts-nocheck
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { calculateImpact, getActiveMilestone } from './calculateImpact';

describe('calculateImpact', () => {
  it('calculates exact values for 576 L', () => {
    const impact = calculateImpact(576);
    assert.strictEqual(impact.litres, 576);
    assert.strictEqual(impact.bottleEquivalent, 1152);
    assert.strictEqual(Math.round(impact.co2eAvoidedKg), 46);
    assert.strictEqual(impact.estimatedAnnualSavingKes, 16000);
  });

  it('calculates values after adding 20 L (596 L)', () => {
    const impact = calculateImpact(596);
    assert.strictEqual(impact.litres, 596);
    assert.strictEqual(impact.bottleEquivalent, 1192);
    assert.strictEqual(impact.co2eAvoidedKg.toFixed(1), '47.6');
    assert.strictEqual(impact.estimatedAnnualSavingKes, 16556);
  });

  it('handles zero or negative', () => {
    const impact = calculateImpact(0);
    assert.strictEqual(impact.litres, 0);
    assert.strictEqual(impact.bottleEquivalent, 0);
    assert.strictEqual(impact.co2eAvoidedKg, 0);
    assert.strictEqual(impact.estimatedAnnualSavingKes, 0);

    const negative = calculateImpact(-10);
    assert.strictEqual(negative.litres, 0);
  });
});

describe('getActiveMilestone', () => {
  it('calculates 576 L milestone', () => {
    const milestone = getActiveMilestone(576);
    assert.strictEqual(milestone.label, '500–2,000 L');
    assert.strictEqual(milestone.progressPercent, 5);
    assert.strictEqual(milestone.remaining, 1424);
  });

  it('calculates 596 L milestone', () => {
    const milestone = getActiveMilestone(596);
    assert.strictEqual(milestone.label, '500–2,000 L');
    assert.strictEqual(milestone.progressPercent, 6);
    assert.strictEqual(milestone.remaining, 1404);
  });
});
