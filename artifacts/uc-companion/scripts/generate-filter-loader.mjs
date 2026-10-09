// Deterministic glossy falling-water artwork built from the retained source SVGs in
// assets/loading/source. The uploaded SVG is static (no native animation); this
// generator rasterises one falling drop and expanding ripples (motion modelled on the
// HTML reference) into lossless animated WebP and a still PNG. ImageMagick is needed only to regenerate.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const FRAME_COUNT = 15; // 15 x 100 ms = 1.5 s loop
export const FRAME_DELAY_CS = 10;
const src = readFileSync(new URL('../assets/loading/source/companion-water-loader.svg', import.meta.url), 'utf8');
const defs = src.match(/<defs>([\s\S]*?)<\/defs>/)[1].replace(/<g id="cw-wave-ring">[\s\S]*?<\/g>\s*(?=<radialGradient id="cw-glass")/, '');
const ring = src.match(/<g id="cw-wave-ring">([\s\S]*?)<\/g>/)[1];
const dropPaths = [...src.matchAll(/<path d="(M12 1c[^"]+)" fill="url\(#(cw-glass|cw-reflection)\)"\/>/g)];
const surface = src.match(/<ellipse cx="12" cy="21" rx="11"[^>]*\/>/)[0];
const ease = (t) => t * t; // gravity

export function renderStillFrame() {
  return readFileSync(new URL('../assets/loading/source/companion-water-loader-static.svg', import.meta.url), 'utf8')
    .replace(/<svg\b[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 -2 24 28">');
}

export function renderDropletFrame(frame) {
  const t = (frame % FRAME_COUNT) / FRAME_COUNT;
  const fall = 0.62; // fraction of loop spent falling
  let drop = '';
  if (t < fall) {
    const p = ease(t / fall);
    const dy = 11.2 * p; // tip-to-surface travel
    const sx = 0.78 + 0.1 * p, sy = 0.95 + 0.1 * p;
    drop = `<g transform="translate(12 ${1 + dy}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-12 -1)">${dropPaths.map((m) => `<path d="${m[1]}" fill="url(#${m[2]})"/>`).join('')}</g>`;
  }
  const rings = [0, 0.14].map((lag) => {
    const q = (t - fall - lag + 1) % 1;
    // Waves survive the loop boundary while the next droplet starts falling.
    const span = 0.7;
    if (q >= span) return '';
    const k = q / span;
    const s = 0.15 + 0.85 * k;
    return `<g opacity="${(0.9 * (1 - k)).toFixed(3)}" transform="translate(12 21) scale(${s.toFixed(3)}) translate(-12 -21)">${ring}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 -2 24 28">
      <defs>${defs}</defs>${surface}${rings}${drop}</svg>`;
}

export function generateArtwork() {
  const out = fileURLToPath(new URL('../assets/loading/', import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), 'uc-droplet-'));
  const frames = [];
  try {
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      const source = join(temp, `${frame}.svg`);
      const png = join(temp, `${frame}.png`);
      writeFileSync(source, renderDropletFrame(frame));
      execFileSync('convert', ['-background', 'none', '-density', '288', source,
        '-resize', '96x112', '-strip', png]);
      frames.push(png);
    }
    // Use the supplied static droplet, not a post-impact animation frame without a drop.
    const still = join(temp, 'still.svg');
    writeFileSync(still, renderStillFrame());
    execFileSync('convert', ['-background', 'none', '-density', '288', still, '-resize', '96x112', '-strip', join(out, 'water-still.png')]);
    // Expo Image supports animated WebP, which preserves full alpha unlike GIF.
    execFileSync('convert', ['-delay', String(FRAME_DELAY_CS), '-dispose', 'Background', ...frames,
      '-loop', '0', '-define', 'webp:lossless=true', '-quality', '100', join(out, 'water.webp')]);
    execFileSync('convert', ['-delay', String(FRAME_DELAY_CS), '-dispose', 'Background', ...frames,
      // GIF has binary alpha: dither partial opacity so soft fading ripples survive.
      '-channel', 'A', '-ordered-dither', 'o8x8,2', '+channel', '-loop', '0', '-colors', '64',
      join(out, 'water.gif')]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) generateArtwork();
