// Deterministic small bundled filter illustration; no logo is altered.
// Requires ImageMagick only when regenerating, not when running the app.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const out = fileURLToPath(new URL('../assets/loading/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'uc-filter-'));
const frames = [];
try {
  for (let frame = 0; frame < 16; frame++) {
    const y = 71 + (frame % 8) * 3;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 0 96 112">
      <rect width="96" height="112" fill="white"/>
      <path d="M37 8h22v10H37z" fill="#005d8f"/>
      <rect x="28" y="18" width="40" height="47" rx="11" fill="white" stroke="#005d8f" stroke-width="3"/>
      <rect x="28" y="22" width="40" height="10" rx="4" fill="#52b6dc" stroke="#005d8f" stroke-width="2"/>
      <path d="M36 38v17m8-17v17m8-17v17m8-17v17" stroke="#52b6dc" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 65h16v6H40z" fill="#005d8f"/>
      <path d="M48 ${y}c-2 4-5 6-5 9a5 5 0 0 0 10 0c0-3-3-5-5-9z" fill="#52b6dc" stroke="#005d8f" stroke-width="1"/>
      <ellipse cx="48" cy="105" rx="${8 + frame % 8}" ry="2" fill="none" stroke="#52b6dc" stroke-width="1.5"/>
      </svg>`;
    const source = join(temp, `${frame}.svg`);
    const png = join(temp, `${frame}.png`);
    writeFileSync(source, svg);
    execFileSync('convert', [source, '-strip', png]);
    frames.push(png);
  }
  execFileSync('convert', [frames[3], '-strip', join(out, 'water-still.png')]);
  execFileSync('convert', ['-delay', '8', ...frames.slice(0, 8), '-loop', '0', '-colors', '32', '-layers', 'Optimize', join(out, 'water.gif')]);
} finally {
  rmSync(temp, { recursive: true, force: true });
}