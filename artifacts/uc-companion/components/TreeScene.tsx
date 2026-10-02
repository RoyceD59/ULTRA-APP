/**
 * Illustrated scene for the Impact Card tree: Kenyan highland restoration
 * site under the live sky (real sun position and current weather, see
 * hooks/useLiveSky), with the customer's shared tree
 * drawn botanically for its stage — seed in a mound, seedling, staked sapling,
 * young tree, mature tree. Geometry comes from lib/treeGeometry and is cached
 * per stage; the static backdrop and the swaying tree are separate layers so
 * animation never re-renders the scene.
 */
import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { growTree, grassPath, ridgePath, rng, type TreeShape } from '@/lib/treeGeometry';
import type { TreeStage } from '@/lib/impactTree';
import type { ScenePalette, Weather } from '@/lib/skyState';

const VW = 320, VH = 150, BASE_X = 160, BASE_Y = 136, HORIZON = 82;

// Fixed cloud field; how many show depends on cloud cover.
const CLOUDS = (() => {
  const r = rng(91);
  return Array.from({ length: 9 }, () => ({
    x: r() * VW, y: 10 + r() * 46, w: 34 + r() * 50, puffs: 3 + Math.floor(r() * 3), seed: r(),
  }));
})();
function cloudPath(c: { x: number; y: number; w: number; puffs: number; seed: number }): string {
  const r = rng(Math.floor(c.seed * 1e6));
  let d = '';
  for (let i = 0; i < c.puffs; i++) {
    const px = c.x + (i / (c.puffs - 1) - 0.5) * c.w * 0.8, rx = c.w * (0.22 + r() * 0.12), ry = rx * 0.55;
    const py = c.y - r() * ry * 0.6;
    d += `M${px - rx} ${py}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
  }
  return d;
}
const RAIN = (() => {
  const r = rng(17);
  let d = '';
  for (let i = 0; i < 90; i++) {
    const x = r() * (VW + 30) - 15, y = r() * VH, l = 6 + r() * 6;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}l${(-l * 0.25).toFixed(1)} ${l.toFixed(1)}`;
  }
  return d;
})();

// Geometry is deterministic, so compute it once per stage for the app's life.
const cache = new Map<string, TreeShape>();
function tree(key: string, make: () => TreeShape): TreeShape {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}
const STAGE_TREE: Partial<Record<TreeStage, () => TreeShape>> = {
  sapling: () => tree('sapling', () => growTree(77, 52, 'broadleaf', 260)),
  growing: () => tree('growing', () => growTree(311, 84, 'broadleaf', 480)),
  funded: () => tree('funded', () => growTree(523, 112)),
  established: () => tree('funded', () => growTree(523, 112)),
};
const DISTANT = [
  { x: 40, y: 92, seed: 11, h: 16, sp: 'acacia' as const },
  { x: 92, y: 88, seed: 29, h: 12, sp: 'broadleaf' as const },
  { x: 236, y: 90, seed: 47, h: 14, sp: 'broadleaf' as const },
  { x: 290, y: 95, seed: 61, h: 19, sp: 'acacia' as const },
];
const GRASS = grassPath(5, VW, HORIZON + 4, VH, 140);
const STARS = (() => {
  const r = rng(3);
  let d = '';
  for (let i = 0; i < 50; i++) d += `M${(r() * VW).toFixed(1)} ${(r() * HORIZON * 0.75).toFixed(1)}h0.1`;
  return d;
})();
const RIDGES = [0, 1, 2].map(i => ridgePath(3 + i * 7, VW, HORIZON - (2 - i) * 9 - 2, 6 + i * 2, VH));

function TreeShapeView({ t, leaf, bark }: { t: TreeShape; leaf: string[]; bark: string[] }) {
  return (
    <>
      {t.bark.map(b => <Path key={`b${b.width}`} d={b.d} stroke={bark[0]} strokeWidth={b.width} strokeLinecap="round" fill="none" />)}
      {t.barkLight.map(b => <Path key={`l${b.width}`} d={b.d} stroke={bark[1]} strokeWidth={b.width} strokeLinecap="round" fill="none" />)}
      <Path d={t.crown} fill={leaf[0]} opacity={0.92} />
      <Path d={t.leafShadow} fill={leaf[0]} />
      {t.leaves.map((d, i) => <Path key={`v${i}`} d={d} fill={leaf[i]} />)}
    </>
  );
}

interface Props {
  stage: TreeStage;
  palette: ScenePalette;
  weather: Weather;
  /** Wraps the tree layer: grow + sway transforms from the parent. */
  treeStyle?: object;
}

export default function TreeScene({ stage, palette: p, weather, treeStyle }: Props) {
  const shape = STAGE_TREE[stage]?.();
  const disc = p.disc;
  const cloudCount = Math.round(weather.cloudCover * CLOUDS.length);
  const rainy = weather.kind === 'rain' || weather.kind === 'storm' || weather.kind === 'drizzle';

  return (
    <View style={styles.frame}>
      {/* Static backdrop */}
      <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMax slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.sky[0]} />
            <Stop offset="0.6" stopColor={p.sky[1]} />
            <Stop offset="1" stopColor={p.sky[2]} />
          </LinearGradient>
          <RadialGradient id="sun" cx={disc?.x ?? 160} cy={disc?.y ?? 80} r={disc?.moon ? 50 : 90} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={p.sunGlow} stopOpacity={disc ? (disc.moon ? 0.35 : 0.7) : 0} />
            <Stop offset="1" stopColor={p.sunGlow} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.soil[0]} />
            <Stop offset="0.5" stopColor={p.soil[1]} />
            <Stop offset="1" stopColor={p.soil[2]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={VW} height={VH} fill="url(#sky)" />
        {p.phase === 'night' && weather.cloudCover < 0.7 && (
          <Path d={STARS} stroke="#e8eeff" strokeWidth={0.7} strokeLinecap="round" opacity={0.7 * (1 - weather.cloudCover)} />
        )}
        <Rect x="0" y="0" width={VW} height={VH} fill="url(#sun)" />
        {disc && <Ellipse cx={disc.x} cy={disc.y} rx={disc.moon ? 5 : 7} ry={disc.moon ? 5 : 7} fill={p.sunCore} />}
        {CLOUDS.slice(0, cloudCount).map((c, i) => (
          <Path key={`c${i}`} d={cloudPath(c)} fill={p.cloud} opacity={0.55 + weather.cloudCover * 0.35} />
        ))}
        {RIDGES.map((d, i) => <Path key={i} d={d} fill={p.hills[i]} />)}
        <Path d={`M0 ${HORIZON}Q80 ${HORIZON - 3} 160 ${HORIZON}T${VW} ${HORIZON}L${VW} ${VH}L0 ${VH}Z`} fill="url(#soil)" />
        {DISTANT.map(t => (
          <G key={t.seed} transform={`translate(${t.x} ${t.y})`} opacity={0.75}>
            <Ellipse cx={-t.h * 0.2} cy={0.5} rx={t.h * 0.5} ry={t.h * 0.08} fill={p.shadow} opacity={0.2} />
            <TreeShapeView t={tree(`d${t.seed}`, () => growTree(t.seed, t.h, t.sp, 70))} leaf={p.leaf} bark={p.bark} />
          </G>
        ))}
        <Path d={GRASS} stroke={p.grass} strokeWidth={0.5} strokeLinecap="round" fill="none" opacity={0.5} />
        {weather.kind === 'fog' && <Rect x="0" y={HORIZON - 30} width={VW} height={VH} fill={p.cloud} opacity={0.35} />}
        {/* Ground shadow / planting pit under the customer's tree */}
        <Ellipse cx={BASE_X - (shape ? shape.canopyWidth * 0.15 : 0)} cy={BASE_Y + 1}
          rx={shape ? Math.max(14, shape.canopyWidth * 0.5) : 16} ry={shape ? 5 : 3.5}
          fill={p.shadow} opacity={shape ? p.shadowOpacity : 0.25} />
      </Svg>

      {/* Customer's tree layer (animated by the parent) */}
      <Animated.View style={[StyleSheet.absoluteFill, treeStyle]} pointerEvents="none">
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMax slice">
          <G transform={`translate(${BASE_X} ${BASE_Y})`}>
            {(stage === 'seed' || stage === 'sprout') && (
              <Path d="M-18 0Q-10 -7 0 -7.5Q10 -7 18 0Z" fill={p.mound} />
            )}
            {stage === 'seed' && (
              <>
                <Ellipse cx={2} cy={-6.5} rx={3.6} ry={2.3} fill={p.seed} transform="rotate(-22 2 -6.5)" />
                <Ellipse cx={3} cy={-7.6} rx={1.2} ry={0.6} fill="#fff0d2" opacity={0.6} />
              </>
            )}
            {stage === 'sprout' && (
              <>
                <Path d="M0 -6Q-3 -16 0.5 -27" stroke={p.leaf[1]} strokeWidth={1.6} strokeLinecap="round" fill="none" />
                <Path d="M0 -19Q-6 -24 -12 -19.5Q-6 -16 0 -19Z" fill={p.leaf[2]} />
                <Path d="M0.5 -20Q7 -25 13 -20.5Q7 -17 0.5 -20Z" fill={p.leaf[3]} />
                <Path d="M0.5 -27Q-3 -33 -1.5 -37Q2 -32 0.5 -27Z" fill={p.leaf[2]} />
                <Path d="M0.5 -27Q4 -32 7 -33Q5 -28 0.5 -27Z" fill={p.leaf[3]} />
              </>
            )}
            {stage === 'sapling' && (
              <>
                <Ellipse cx={0} cy={0.5} rx={13} ry={3.2} fill="#3c2314" opacity={0.6} />
                <Path d="M5 2L5 -46" stroke="#c9b27a" strokeWidth={2} />
                <Path d="M4 -14L6.2 -14M4 -30L6.2 -30" stroke="#8c7444" strokeWidth={0.8} />
                <Path d="M0.5 -34L5 -35" stroke="#e8e2d0" strokeWidth={1} />
              </>
            )}
            {shape && <TreeShapeView t={shape} leaf={p.leaf} bark={p.bark} />}
          </G>
        </Svg>
      </Animated.View>

      {rainy && (
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMax slice" pointerEvents="none">
          <Path d={RAIN} stroke="#d8e4ee" strokeWidth={weather.kind === 'drizzle' ? 0.4 : 0.7}
            strokeLinecap="round" opacity={weather.kind === 'drizzle' ? 0.35 : 0.55} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: VW / VH, borderRadius: 10, overflow: 'hidden' },
});
