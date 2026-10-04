import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

type Props = {
  /** Remaining life 0-100, or null when unknown. */
  percent: number | null;
  /** Semantic status color (green/amber/red) for the pointer. */
  color: string;
  /** Accessibility label for the whole gauge. */
  label: string;
};

const WIDTH = 62;
const HEIGHT = 140;
const TUBE_W = 22;
const TUBE_X = 14;
const TUBE_Y = 4;
const TUBE_H = HEIGHT - 8;
const INNER = 3;
const INNER_X = TUBE_X + INNER;
const INNER_Y = TUBE_Y + INNER;
const INNER_W = TUBE_W - INNER * 2;
const INNER_H = TUBE_H - INNER * 2;

export function FilterLifeGauge({ percent, color, label }: Props) {
  const colors = useColors();
  const known = typeof percent === 'number' && Number.isFinite(percent);
  const pct = known ? Math.min(100, Math.max(0, percent as number)) : 0;
  const pointerY = INNER_Y + INNER_H * (1 - pct / 100);
  const pointerH = 4;
  const py = Math.min(
    INNER_Y + INNER_H - pointerH / 2,
    Math.max(INNER_Y - pointerH / 2, pointerY - pointerH / 2),
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <Svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <Defs>
          <LinearGradient id="ucGaugeFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#5DB84A" />
            <Stop offset="0.5" stopColor="#E3B73A" />
            <Stop offset="1" stopColor="#D0452F" />
          </LinearGradient>
          <LinearGradient id="ucGaugeRim" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#E6E9EC" />
            <Stop offset="0.5" stopColor="#B4BAC1" />
            <Stop offset="1" stopColor="#D8DCE0" />
          </LinearGradient>
        </Defs>
        <Rect
          x={TUBE_X}
          y={TUBE_Y}
          width={TUBE_W}
          height={TUBE_H}
          rx={TUBE_W / 2}
          fill="url(#ucGaugeRim)"
          stroke={colors.border}
          strokeWidth={1}
        />
        <Rect
          x={INNER_X}
          y={INNER_Y}
          width={INNER_W}
          height={INNER_H}
          rx={INNER_W / 2}
          fill="url(#ucGaugeFill)"
          opacity={known ? 1 : 0.28}
        />
        {known ? (
          <>
            <Rect
              x={TUBE_X - 4}
              y={py - 1}
              width={TUBE_W + 8}
              height={pointerH + 2}
              rx={2}
              fill={colors.card}
            />
            <Rect
              x={TUBE_X - 3}
              y={py}
              width={TUBE_W + 6}
              height={pointerH}
              rx={2}
              fill={color}
            />
            <Rect
              x={TUBE_X + TUBE_W + 3}
              y={py}
              width={14}
              height={pointerH}
              rx={2}
              fill={color}
            />
          </>
        ) : (
          <Rect
            x={TUBE_X + TUBE_W + 3}
            y={HEIGHT / 2 - 1.5}
            width={10}
            height={3}
            rx={1.5}
            fill={colors.mutedForeground}
          />
        )}
      </Svg>
    </View>
  );
}

export default FilterLifeGauge;
