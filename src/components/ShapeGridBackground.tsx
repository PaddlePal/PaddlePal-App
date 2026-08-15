import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { Colors } from '@/constants/colors';

/**
 * ShapeGridBackground
 *
 * A decorative, non-interactive background that renders a repeated grid of
 * square outlines and scrolls it continuously in one direction. The whole
 * grid layer is translated by exactly one cell and then snapped back — because
 * the pattern repeats every `squareSize`, the reset is visually seamless.
 *
 * Pure React Native: no canvas, SVG, Skia, Reanimated, Gesture Handler, or any
 * third-party dependency — just `Animated` + `View`.
 */

export type ShapeGridDirection = 'up' | 'down' | 'left' | 'right' | 'diagonal';

export interface ShapeGridBackgroundProps {
  /** Scroll direction of the grid. Default `'right'`. */
  direction?: ShapeGridDirection;
  /** Speed multiplier (1 = ~40px/sec). Higher is faster. Default `1`. */
  speed?: number;
  /** Color of the square outlines. Default `Colors.border`. */
  borderColor?: string;
  /** Side length of each square cell in px. Default `40`. */
  squareSize?: number;
  /** Extra style for the absolute-fill container. */
  style?: StyleProp<ViewStyle>;
}

/** Unit translation vector per direction (in cells). */
const DIRECTION_VECTORS: Record<ShapeGridDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  diagonal: { x: 1, y: 1 },
};

/** Baseline scroll rate: pixels traveled per second at `speed = 1`. */
const BASE_PX_PER_SEC = 40;

export function ShapeGridBackground({
  direction = 'right',
  speed = 1,
  borderColor = Colors.border,
  squareSize = 40,
  style,
}: ShapeGridBackgroundProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const progress = useRef(new Animated.Value(0)).current;

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) =>
      prev.width === width && prev.height === height
        ? prev
        : { width, height },
    );
  };

  // +2 cells of overflow on each axis so the grid always extends beyond the
  // container edges — the layer can shift a full cell in any direction (incl.
  // diagonal) without ever exposing an uncovered gap.
  const cols = size.width ? Math.ceil(size.width / squareSize) + 2 : 0;
  const rows = size.height ? Math.ceil(size.height / squareSize) + 2 : 0;
  const layerWidth = cols * squareSize;

  const cells = useMemo(() => Array.from({ length: cols * rows }), [cols, rows]);

  const vector = DIRECTION_VECTORS[direction] ?? DIRECTION_VECTORS.right;

  useEffect(() => {
    if (!cols || !rows) return;

    const safeSpeed = speed > 0 ? speed : 1;
    const duration = (squareSize / (BASE_PX_PER_SEC * safeSpeed)) * 1000;

    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();

    return () => animation.stop();
  }, [progress, direction, speed, squareSize, cols, rows]);

  // Map 0→1 progress onto a one-cell translation in the chosen direction.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, squareSize * vector.x],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, squareSize * vector.y],
  });

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.container, style]}
      onLayout={handleLayout}
      pointerEvents="none"
    >
      {cols > 0 && rows > 0 && (
        <Animated.View
          style={[
            styles.layer,
            {
              width: layerWidth,
              // Start shifted up-left by one cell so there is overflow on the
              // leading edges regardless of direction.
              top: -squareSize,
              left: -squareSize,
              transform: [{ translateX }, { translateY }],
            },
          ]}
        >
          {cells.map((_, i) => (
            <View
              key={i}
              style={{
                width: squareSize,
                height: squareSize,
                borderWidth: 1,
                borderColor,
              }}
            />
          ))}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
