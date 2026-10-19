import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('customer map city-tap contract', () => {
  it('lists the tap city on web and opens native marker details', () => {
    const webMap = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'map.tsx'), 'utf-8');
    const nativeMap = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'map.native.tsx'), 'utf-8');

    assert.match(webMap, /filterMapLocations\(locations,\s*filter\)/);
    assert.match(webMap, /\$\{loc\.city\},\s*\$\{loc\.countryIso\}/);
    assert.match(webMap, /<LocationDetailModal[\s\S]*location=\{selected\}/);

    assert.match(nativeMap, /visible\.map\(loc\s*=>\s*\(/);
    assert.match(nativeMap, /<Marker[\s\S]*coordinate=\{\{\s*latitude:\s*loc\.lat,\s*longitude:\s*loc\.lng\s*\}\}/);
    assert.match(nativeMap, /onPress=\{event => \{\s*event\.stopPropagation\(\);\s*handleMarkerPress\(loc\);/);
    assert.match(nativeMap, /setSelected\(loc\)/);
    assert.match(nativeMap, /<LocationDetailModal[\s\S]*location=\{selected\}/);
  });
});
