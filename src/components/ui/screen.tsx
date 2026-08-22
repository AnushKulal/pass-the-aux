import { ArrowLeft } from 'lucide-react-native';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '@/lib/theme-context';
import { GRID, PointerEvents, Rule, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type ScreenProps = {
  children: ReactNode;
  title?: string;
  scroll?: boolean;
  padded?: boolean;
  right?: ReactNode;
  onBack?: () => void;
  /**
   * Overlay the 25px modular grid the whole design is set on. Decorative and
   * barely visible (`grid` is 4.5% ink) — it belongs on the surfaces that are
   * mostly artwork, like the Session stage, not on every list.
   */
  grid?: boolean;
};

/**
 * Every route's outer shell.
 *
 * Bottom inset is deliberately not consumed here: screens sit under the tab bar
 * or the docked bar, both of which own their own bottom padding. A screen that
 * genuinely reaches the bottom edge should apply useSafeAreaInsets itself.
 */
export function Screen({
  children,
  title,
  scroll = false,
  padded = true,
  right,
  onBack,
  grid = false,
}: ScreenProps) {
  const C = useColors();
  const hasHeader = Boolean(title || onBack || right);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      {grid ? <GridOverlay color={C.grid} /> : null}

      {hasHeader ? (
        <View
          style={[
            styles.constrain,
            styles.header,
            { borderBottomColor: C.rule },
            padded && styles.gutter,
          ]}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ pressed }) => [styles.back, pressed && styles.backPressed]}>
              <ArrowLeft size={20} strokeWidth={2} color={C.ink} />
            </Pressable>
          ) : null}

          {title ? (
            <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
              {title}
            </Text>
          ) : (
            <View style={styles.spacer} />
          )}

          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      ) : null}

      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, styles.constrain, padded && styles.gutter]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.constrain, padded && styles.gutter]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/**
 * The 25px grid, drawn as lines rather than a repeating background — React
 * Native has no `background-image`, so the pitch is laid out by hand.
 *
 * It measures itself instead of taking a size prop so it can sit behind a
 * screen of any height, and it is memoised because the line count only changes
 * when the window does. Always decorative: untouchable and hidden from screen
 * readers.
 */
const GridOverlay = memo(function GridOverlay({ color }: { color: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  const columns = useMemo(
    () => Array.from({ length: Math.ceil(size.w / GRID) }, (_, i) => i * GRID),
    [size.w],
  );
  const rows = useMemo(
    () => Array.from({ length: Math.ceil(size.h / GRID) }, (_, i) => i * GRID),
    [size.h],
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, PointerEvents.none]}>
      {columns.map((x) => (
        <View
          key={`c${x}`}
          style={[styles.gridLine, { left: x, top: 0, bottom: 0, width: Rule.hair, backgroundColor: color }]}
        />
      ))}
      {rows.map((y) => (
        <View
          key={`r${y}`}
          style={[styles.gridLine, { top: y, left: 0, right: 0, height: Rule.hair, backgroundColor: color }]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  /**
   * react-native-web has no phone to constrain it, so an unbounded column
   * stretches to the full window and the line length becomes unreadable.
   */
  constrain: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  /** Every artboard sets its screen gutter to 20, not 16. */
  gutter: {
    paddingHorizontal: Space.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    gap: Space.md,
    borderBottomWidth: Rule.hair,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pulls the optical centre of the arrow back onto the gutter line.
    marginLeft: -Space.md,
  },
  backPressed: {
    opacity: 0.6,
  },
  title: {
    ...Type.display(22),
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  right: {
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Space.xxl,
  },
  gridLine: {
    position: 'absolute',
  },
});
