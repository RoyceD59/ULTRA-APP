// Deterministic crystal-blue droplet artwork; no logo is altered.
// Requires ImageMagick only when regenerating, not when running the app.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const out = fileURLToPath(new URL('../assets/loading/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'uc-droplets-'));
const frames = [];
try {
  for (let frame = 0; frame < 24; frame++) {
    const droplets = [
      { x: 20, y: 66, size: 0.88 },
      { x: 48, y: 44, size: 1.08 },
      { x: 76, y: 66, size: 0.88 },
    ].map(({ x, y, size }, index) => {
      // Smooth 2.4-second loop, offset per drop; no flashing or large travel.
      const pulse = (1 - Math.cos(2 * Math.PI * (frame / 24 - index / 3))) / 2;
      const scale = size * (0.94 + 0.06 * pulse);
      return `<g transform="translate(${x} ${y - pulse}) scale(${scale})">
        <path d="M0 -26 C-3 -18 -14 -8 -14 3 C-14 22 14 22 14 3 C14 -8 3 -18 0 -26Z"
          fill="url(#water)" stroke="#005d8f" stroke-width="1.4"/>
        <path d="M0 -23 C-3 -15 -11 -7 -11 2" fill="none"
          stroke="#52b6dc" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M-5 -9 C-8 -5 -10 -1 -9 4" fill="none"
          stroke="white" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="-7" cy="8" rx="1.6" ry="2" fill="white"/>
        <path d="M1 14 C6 14 10 10 11 6" fill="none"
          stroke="#52b6dc" stroke-width="1.5" stroke-linecap="round"/>
      </g>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 0 96 112">
      <defs><linearGradient id="water" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#52b6dc"/>
        <stop offset="0.4" stop-color="#52b6dc"/>
        <stop offset="1" stop-color="#005d8f"/>
      </linearGradient></defs>
      ${droplets}
      </svg>`;
    const source = join(temp, `${frame}.svg`);
    const png = join(temp, `${frame}.png`);
    writeFileSync(source, svg);
    execFileSync('convert', ['-background', 'none', '-density', '288', source,
      '-resize', '96x112', '-strip', png]);
    frames.push(png);
  }
  execFileSync('convert', [frames[0], '-strip', join(out, 'water-still.png')]);
  // Full transparent frames with background disposal avoid trails on dark UI.
  execFileSync('convert', ['-delay', '10', '-dispose', 'Background', ...frames,
    '-channel', 'A', '-threshold', '50%', '+channel', '-loop', '0', '-colors', '64',
    join(out, 'water.gif')]);
} finally {
  rmSync(temp, { recursive: true, force: true });
}