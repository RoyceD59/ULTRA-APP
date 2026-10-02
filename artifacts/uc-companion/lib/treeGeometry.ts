/**
 * Procedural tree geometry for the Impact Card scene — the same branching
 * and leaf-lighting rules as the public forest page, packed into a few SVG
 * path strings so react-native-svg draws hundreds of leaves as a handful of
 * elements. Deterministic: the same seed always grows the same tree.
 */

export type Species = 'broadleaf' | 'acacia';

export interface TreeShape {
  /** Bark paths grouped by stroke width (units). */
  bark: { width: number; d: string }[];
  /** Thin sunlit edge along the larger limbs. */
  barkLight: { width: number; d: string }[];
  /** Leaf dabs grouped into 4 light bands: 0 = deep shade … 3 = sunlit. */
  leaves: [string, string, string, string];
  /** Soft shadow layer under the leaves. */
  leafShadow: string;
  /** Dense inner crown behind the leaves, so gaps read as shaded foliage. */
  crown: string;
  leafCount: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  canopyWidth: number;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const f = (n: number) => Math.round(n * 10) / 10;
export const MAX_LEAVES = 650;

function dab(x: number, y: number, rx: number, ry: number): string {
  // Two arcs make an ellipse; enough at this size, and keeps one path per band.
  return `M${f(x - rx)} ${f(y)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0`;
}

/** Grow a tree whose base is at (0, 0), rising to about `h` units. */
export function growTree(seed: number, h: number, species: Species = 'broadleaf', budget = MAX_LEAVES): TreeShape {
  const r = rng(seed);
  const acacia = species === 'acacia';
  const maxDepth = acacia ? 4 : 5;
  type Seg = { x1: number; y1: number; x2: number; y2: number; w: number };
  type Tip = { x: number; y: number; inner?: boolean };
  const segs: Seg[] = [];
  const tips: Tip[] = [];

  function branch(x: number, y: number, ang: number, len: number, w: number, depth: number) {
    const bend = (r() - 0.5) * 0.18;
    const x2 = x + Math.cos(ang + bend) * len;
    const y2 = y + Math.sin(ang + bend) * len;
    segs.push({ x1: x, y1: y, x2, y2, w });
    if (depth >= maxDepth || len < h * 0.04) { tips.push({ x: x2, y: y2 }); return; }
    const kids = acacia ? (depth === 0 ? 3 : 2) : (r() < 0.35 ? 3 : 2);
    for (let i = 0; i < kids; i++) {
      const spread = acacia ? (depth === 0 ? 0.6 + r() * 0.3 : 0.35 + r() * 0.3) : 0.26 + r() * 0.2;
      const side = (i / (kids - 1) - 0.5) * 2;
      let a = ang + side * spread + (r() - 0.5) * 0.25;
      if (acacia) a = Math.min(-0.25, Math.max(-Math.PI + 0.25, a));
      branch(x2, y2, a, len * (acacia ? (depth === 0 ? 0.62 : 0.7) : 0.74 + r() * 0.08), w * 0.68, depth + 1);
    }
    if (!acacia && depth >= 2) {
      tips.push({ x: x2, y: y2, inner: true });
      if (r() < 0.6) tips.push({ x: (x + x2) / 2, y: (y + y2) / 2, inner: true });
    }
  }
  branch(0, 0, -Math.PI / 2 + (r() - 0.5) * 0.1, h * (acacia ? 0.36 : 0.3), h * (acacia ? 0.045 : 0.055), 0);

  type Leaf = { x: number; y: number; s: number; j: number; light: number };
  const leaves: Leaf[] = [];
  const crownParts: string[] = [];
  const outer = tips.filter(t => !t.inner);
  const minTipY = Math.min(...outer.map(t => t.y));
  for (const t of tips) {
    const R = acacia ? h * (0.1 + r() * 0.05) : h * (0.07 + r() * 0.045) * (t.inner ? 0.85 : 1);
    const cy = acacia ? minTipY + (t.y - minTipY) * 0.35 - h * 0.02 : t.y;
    const flat = acacia ? 0.32 : 0.85;
    crownParts.push(dab(t.x, cy, R * 0.72, R * 0.72 * flat));
    // Density is size-independent (normalised to a 100-unit tree) so a mature
    // tree stays around 600 leaves — light enough for phones.
    const rn = (R / h) * 100;
    const n = Math.round((rn * rn) / (acacia ? 30 : 28)) + 4;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = R * Math.pow(r(), 0.6);
      leaves.push({ x: t.x + Math.cos(a) * d, y: cy + Math.sin(a) * d * flat, s: h * (0.014 + r() * 0.017), j: r(), light: 0 });
    }
  }

  // Hard budget for phones: thin evenly rather than truncating one side.
  if (leaves.length > budget) {
    const keep = budget / leaves.length;
    let acc = 0;
    for (let i = leaves.length - 1; i >= 0; i--) {
      acc += keep;
      if (acc >= 1) acc -= 1; else leaves.splice(i, 1);
    }
  }

  const xs = leaves.map(l => l.x), ys = leaves.map(l => l.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cyC = (Math.min(...ys) + Math.max(...ys)) / 2;
  const R = Math.max(Math.max(...xs) - cx, cyC - Math.min(...ys), 1);
  const bands: [string[], string[], string[], string[]] = [[], [], [], []];
  const shadow: string[] = [];
  for (const l of leaves) {
    const v = ((l.x - cx) / R) * 0.6 - ((l.y - cyC) / R) * 0.8 + (r() - 0.5) * 0.7 + (l.j - 0.5) * 0.35;
    const band = v < -0.5 ? 0 : v < 0 ? 1 : v < 0.6 ? 2 : 3;
    bands[band].push(dab(l.x, l.y, l.s * 1.25, l.s * 0.8));
    if (l.j < 0.5) shadow.push(dab(l.x - l.s * 0.4, l.y + l.s * 0.8, l.s * 1.5, l.s * 1.15));
  }

  const byWidth = new Map<number, string[]>();
  const lightByWidth = new Map<number, string[]>();
  for (const s of segs) {
    const w = Math.max(0.4, Math.round(s.w * 0.85 * 2) / 2);
    const d = `M${f(s.x1)} ${f(s.y1)}L${f(s.x2)} ${f(s.y2)}`;
    (byWidth.get(w) ?? byWidth.set(w, []).get(w)!).push(d);
    if (s.w > h * 0.012) {
      const lw = Math.max(0.3, Math.round(s.w * 0.35 * 2) / 2), off = s.w * 0.22;
      (lightByWidth.get(lw) ?? lightByWidth.set(lw, []).get(lw)!)
        .push(`M${f(s.x1 + off)} ${f(s.y1)}L${f(s.x2 + off)} ${f(s.y2)}`);
    }
  }

  const allX = xs.concat(segs.flatMap(s => [s.x1, s.x2]));
  const allY = ys.concat(segs.flatMap(s => [s.y1, s.y2]));
  return {
    bark: [...byWidth].map(([width, ds]) => ({ width, d: ds.join('') })),
    barkLight: [...lightByWidth].map(([width, ds]) => ({ width, d: ds.join('') })),
    leaves: bands.map(b => b.join('')) as TreeShape['leaves'],
    leafShadow: shadow.join(''),
    crown: crownParts.join(''),
    leafCount: leaves.length,
    box: { x0: Math.min(...allX), y0: Math.min(...allY), x1: Math.max(...allX), y1: Math.max(...allY) },
    canopyWidth: Math.max(...xs) - Math.min(...xs),
  };
}

/** A gently undulating ridge line as an SVG area path across `width`. */
export function ridgePath(seed: number, width: number, base: number, amp: number, bottom: number): string {
  const r = rng(seed);
  const p = [r() * 6, r() * 6, r() * 6], fr = [1.3 + r(), 3.1 + r() * 2, 7 + r() * 4];
  let d = `M0 ${bottom}`;
  for (let x = 0; x <= width; x += 8) {
    const t = (x / width) * 3;
    const y = base - amp * (0.55 * Math.sin(t * fr[0] + p[0]) + 0.3 * Math.sin(t * fr[1] + p[1]) + 0.15 * Math.sin(t * fr[2] + p[2]));
    d += `L${x} ${f(y)}`;
  }
  return `${d}L${width} ${bottom}Z`;
}

/** Grass tufts as one stroked path; taller toward the viewer. */
export function grassPath(seed: number, width: number, top: number, bottom: number, count: number): string {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const y = top + Math.pow(r(), 0.7) * (bottom - top);
    const depth = (y - top) / (bottom - top);
    const x = r() * width, len = 1.5 + depth * 7 * (0.5 + r() * 0.8);
    const blades = 2 + Math.floor(r() * 4);
    for (let b = 0; b < blades; b++) {
      const lean = (r() - 0.5) * 0.9;
      d += `M${f(x)} ${f(y)}Q${f(x + lean * len * 0.4)} ${f(y - len * 0.6)} ${f(x + lean * len)} ${f(y - len)}`;
    }
  }
  return d;
}
