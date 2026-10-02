// Original UC droplet/ripple artwork, reproducible with ImageMagick.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-water-'));
const target = path.join(__dirname, '../assets/loading');
fs.mkdirSync(target, { recursive: true });
try {
  const frames = [];
  for (let i = 0; i < 16; i++) {
    const phase = i / 16;
    const y = 3 * Math.sin(phase * Math.PI * 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <rect width="96" height="96" rx="24" fill="white"/>
      <ellipse cx="48" cy="76" rx="${12 + phase * 24}" ry="${3 + phase * 5}" fill="none" stroke="#52b6dc" stroke-width="2" opacity="${1 - phase}"/>
      <path transform="translate(0 ${y})" d="M48 14 C43 25 29 38 29 49 A19 19 0 0 0 67 49 C67 38 53 25 48 14Z" fill="#005d8f"/>
      <path transform="translate(0 ${y})" d="M39 45 Q35 54 43 59" fill="none" stroke="#52b6dc" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
    const input = path.join(dir, `${i}.svg`);
    const output = path.join(dir, `${i}.png`);
    fs.writeFileSync(input, svg);
    execFileSync('magick', [input, output]);
    frames.push(output);
  }
  execFileSync('magick', ['-delay', '8', ...frames, '-loop', '0', '-layers', 'Optimize', path.join(target, 'water.gif')]);
  fs.copyFileSync(frames[0], path.join(target, 'water-still.png'));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}