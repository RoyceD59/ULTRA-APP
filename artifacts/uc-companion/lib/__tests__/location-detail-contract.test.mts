import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('LocationDetailModal features', () => {
  it('uses valid report enums and renders reviewed city-tap provenance', () => {
    const srcPath = path.join(process.cwd(), 'components', 'LocationDetailModal.tsx');
    const content = fs.readFileSync(srcPath, 'utf-8');

    for (const value of ['spam', 'unsafe', 'inaccurate', 'offensive', 'other']) {
      assert.match(content, new RegExp(`value:\\s*'${value}'`));
    }
    assert.match(content, /reason\s*===\s*r\.value/);
    assert.match(content, /location\.type\s*===\s*'city_tap'/);
    for (const field of ['city', 'countryIso', 'municipal', 'sourceAttribution', 'accessNotes']) {
      assert.match(content, new RegExp(`location\\.${field}`));
    }
    assert.match(content, /Operator:\s*\{location\.municipal\}/);
    assert.match(content, /Source:\s*\{location\.sourceAttribution\}/);
  });
});