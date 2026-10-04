import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeRecommendation,
  effectiveLifespanDays,
  type FilterActivation,
  type FlowRate,
  type PerfRecommendation,
  type Taste,
  type WaterSource,
} from '../useNotifications';

function activation(overrides: Partial<FilterActivation> = {}): FilterActivation {
  return {
    activatedAt: '2026-01-01T00:00:00.000Z',
    productId: 1,
    productName: 'Test filter',
    lifespanDays: 90,
    notifIds: [],
    ...overrides,
  };
}

describe('effectiveLifespanDays', () => {
  // Literal day counts deliberately avoid reproducing the production formula.
  const sourceCases: Array<[WaterSource | undefined, number[]]> = [
    [undefined, [90, 72, 59, 59]],
    ['mains', [90, 72, 59, 59]],
    ['surface', [50, 40, 33, 33]],
    ['borehole', [63, 51, 41, 41]],
    ['mixed', [74, 60, 48, 48]],
  ];
  const cleanCounts = [0, 1, 2, 5];

  for (const [source, expectedDays] of sourceCases) {
    for (const [index, cleanCount] of cleanCounts.entries()) {
      it(`${source ?? 'unspecified'} water, ${cleanCount} cleans: ${expectedDays[index]} days`, () => {
        assert.equal(
          effectiveLifespanDays(activation({ lastWaterSource: source, cleanCount })),
          expectedDays[index],
        );
      });
    }

    it(`${source ?? 'unspecified'} water defaults an omitted clean count to zero`, () => {
      assert.equal(
        effectiveLifespanDays(activation({ lastWaterSource: source })),
        expectedDays[0],
      );
    });

    for (const cleanCount of cleanCounts) {
      it(`${source ?? 'unspecified'} water, ${cleanCount} cleans never falls below 21 days`, () => {
        assert.equal(
          effectiveLifespanDays(activation({ lifespanDays: 20, lastWaterSource: source, cleanCount })),
          21,
        );
      });
    }
  }

  for (const [ratedDays, expectedDays] of [[21, 21], [22, 22]]) {
    it(`preserves an unadjusted ${ratedDays}-day lifespan at or above the floor`, () => {
      assert.equal(effectiveLifespanDays(activation({ lifespanDays: ratedDays })), expectedDays);
    });
  }

  for (const [ratedDays, expectedDays] of [[58, 21], [59, 22]]) {
    it(`rounds the combined surface/two-clean adjustment upward for ${ratedDays} rated days`, () => {
      assert.equal(
        effectiveLifespanDays(activation({
          lifespanDays: ratedDays,
          lastWaterSource: 'surface',
          cleanCount: 2,
        })),
        expectedDays,
      );
    });
  }
});

describe('computeRecommendation', () => {
  type ScoreCase = [string, FlowRate, Taste, WaterSource, number, PerfRecommendation];
  const cases: ScoreCase[] = [
    ['score 0 stays good', 'good', 'normal', 'mains', 0, 'good'],
    ['score 1 stays good', 'slow', 'normal', 'mains', 0, 'good'],
    ['score 2 stays good', 'slow', 'slight', 'mains', 0, 'good'],
    ['score 3 starts cleaning', 'slow', 'slight', 'borehole', 0, 'clean'],
    ['score 6 still recommends cleaning', 'very_slow', 'strong', 'mains', 0, 'clean'],
    ['score 7 starts replacement', 'very_slow', 'strong', 'borehole', 0, 'replace'],
    ['score above 7 recommends replacement', 'barely', 'strong', 'surface', 2, 'replace'],
    ['very slow flow contributes 3', 'very_slow', 'normal', 'mains', 0, 'clean'],
    ['barely flowing contributes 5, not 7', 'barely', 'normal', 'mains', 0, 'clean'],
    ['barely flowing plus one clean reaches 7', 'barely', 'normal', 'mains', 1, 'replace'],
    ['slight taste contributes 1 to a score of 2', 'good', 'slight', 'mains', 1, 'clean'],
    ['strong taste contributes 3', 'good', 'strong', 'mains', 0, 'clean'],
    ['strong taste plus two cleans reaches 7', 'good', 'strong', 'mains', 2, 'replace'],
    ['surface water contributes 3', 'good', 'normal', 'surface', 0, 'clean'],
    ['surface water plus two cleans reaches 7', 'good', 'normal', 'surface', 2, 'replace'],
    ['borehole water contributes 1, not 3', 'good', 'normal', 'borehole', 0, 'good'],
    ['borehole water plus one clean reaches 3', 'good', 'normal', 'borehole', 1, 'clean'],
    ['mixed water contributes 1, not 3', 'good', 'normal', 'mixed', 0, 'good'],
    ['mixed water plus one clean reaches 3', 'good', 'normal', 'mixed', 1, 'clean'],
    ['mixed water takes score 6 to replacement', 'very_slow', 'strong', 'mixed', 0, 'replace'],
    ['one clean contributes 2, not 3', 'good', 'normal', 'mains', 1, 'good'],
    ['two cleans contribute 4', 'good', 'normal', 'mains', 2, 'clean'],
    ['two cleans plus very slow flow reaches 7', 'very_slow', 'normal', 'mains', 2, 'replace'],
    ['more than two cleans keeps the same contribution', 'good', 'normal', 'mains', 5, 'clean'],
    ['more than two cleans plus very slow flow reaches 7', 'very_slow', 'normal', 'mains', 5, 'replace'],
  ];

  for (const [name, flow, taste, source, cleanCount, expected] of cases) {
    it(name, () => {
      assert.equal(computeRecommendation(flow, taste, source, cleanCount, 0, 100), expected);
    });
  }

  const ageCases: Array<[number, PerfRecommendation, PerfRecommendation]> = [
    [0, 'good', 'clean'],
    [64.99, 'good', 'clean'],
    [65, 'good', 'clean'],
    [65.01, 'clean', 'clean'],
    [84.99, 'clean', 'clean'],
    [85, 'clean', 'clean'],
    [85.01, 'clean', 'replace'],
    [100, 'clean', 'replace'],
    [120, 'clean', 'replace'],
  ];

  for (const [elapsedDays, withScore2, withScore4] of ageCases) {
    it(`${elapsedDays}% elapsed applies the strict 65%/85% thresholds to base score 2`, () => {
      assert.equal(
        computeRecommendation('good', 'normal', 'mains', 1, elapsedDays, 100),
        withScore2,
      );
    });

    it(`${elapsedDays}% elapsed applies the strict 65%/85% thresholds to base score 4`, () => {
      assert.equal(
        computeRecommendation('good', 'normal', 'mains', 2, elapsedDays, 100),
        withScore4,
      );
    });
  }

  it('uses the proportion of rated lifespan rather than an absolute day threshold', () => {
    assert.equal(computeRecommendation('good', 'normal', 'mains', 1, 33, 50), 'clean');
    assert.equal(computeRecommendation('good', 'normal', 'mains', 2, 43, 50), 'replace');
  });
});