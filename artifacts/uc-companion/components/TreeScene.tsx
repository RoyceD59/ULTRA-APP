/**
 * Illustrated scene for the Impact Card tree: Kenyan highland restoration
 * site at golden hour (moonlit in dark mode), with the customer's shared tree
 * drawn botanically for its stage — seed in a mound, seedling, staked sapling,
 * young tree, mature tree. Geometry comes from lib/treeGeometry and is cached
 * per stage; the static backdrop and the swaying tree are separate layers so
 * animation never re-renders the scene.
 */
import React from 'react';
import { Animated, StyleSheet, View, useColorScheme } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { growTree, grassPath, ridgePath, type TreeShape } from '@/lib/treeGeometry';
import type { TreeStage } from '@/lib/impactTree';

const VW = 320, VH = 150, BASE_X = 160, BASE_Y = 136, HORIZON = 82;

const PALETTES = {
  day: {
    sky: ['#6fa6c9', '#b9d6e0', '#f3dcb4'], sunGlow: '#ffe8b4', sunCore: '#fff6dc',
    hills: ['#b7c3bf', '#9aaea4', '#7f9888'], soil: ['#b5673f', '#8e4528', '#6a2f1a'],
    grass: '#8f9a50', bark: ['#3e2a1d', '#7a5640'],
    leaf: ['#183d22', '#2d5a31', '#4f8340', '#93b45a'], shadow: '#2a1408', mound: '#5b2b18', seed: '#7a5230',
  },
  night: {
    sky: ['#081321', '#16263a', '#36324a'], sunGlow: '#bfcdf0', sunCore: '#e9eefc',
    hills: ['#33445a', '#2a3a48', '#22323b'], soil: ['#4d2c1f', '#3a2016', '#2a160f'],
    grass: '#3d4a2e', bark: ['#1e150f', '#4a3626'],
    leaf: ['#0c1f12', '#16331d', '#2a4f2d', '#4d6e44'], shadow: '#000000', mound: '#2a160f', seed: '#5a3a22',
  },
};

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
  /** Wraps the tree layer: grow + sway transforms from the parent. */
  treeStyle?: object;
}

export default function TreeScene({ stage, treeStyle }: Props) {
  const dark = useColorScheme() === 'dark';
  const p = dark ? PALETTES.night : PALETTES.day;
  const shape = STAGE_TREE[stage]?.();

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
          <RadialGradient id="sun" cx="250" cy="34" r="90" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={p.sunGlow} stopOpacity="0.7" />
            <Stop offset="1" stopColor={p.sunGlow} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.soil[0]} />
            <Stop offset="0.5" stopColor={p.soil[1]} />
            <Stop offset="1" stopColor={p.soil[2]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={VW} height={VH} fill="url(#sky)" />
        <Rect x="0" y="0" width={VW} height={VH} fill="url(#sun)" />
        <Ellipse cx="250" cy="34" rx="7" ry="7" fill={p.sunCore} />
        {RIDGES.map((d, i) => <Path key={i} d={d} fill={p.hills[i]} />)}
        <Path d={`M0 ${HORIZON}Q80 ${HORIZON - 3} 160 ${HORIZON}T${VW} ${HORIZON}L${VW} ${VH}L0 ${VH}Z`} fill="url(#soil)" />
        {DISTANT.map(t => (
          <G key={t.seed} transform={`translate(${t.x} ${t.y})`} opacity={0.75}>
            <Ellipse cx={-t.h * 0.2} cy={0.5} rx={t.h * 0.5} ry={t.h * 0.08} fill={p.shadow} opacity={0.2} />
            <TreeShapeView t={tree(`d${t.seed}`, () => growTree(t.seed, t.h, t.sp, 70))} leaf={p.leaf} bark={p.bark} />
          </G>
        ))}
        <Path d={GRASS} stroke={p.grass} strokeWidth={0.5} strokeLinecap="round" fill="none" opacity={0.5} />
        {/* Ground shadow / planting pit under the customer's tree */}
        <Ellipse cx={BASE_X - (shape ? shape.canopyWidth * 0.15 : 0)} cy={BASE_Y + 1}
          rx={shape ? Math.max(14, shape.canopyWidth * 0.5) : 16} ry={shape ? 5 : 3.5}
          fill={p.shadow} opacity={shape ? 0.3 : 0.25} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: VW / VH, borderRadius: 10, overflow: 'hidden' },
});
