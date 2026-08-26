/**
 * Every route's outer shell.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` — the four screen headers at
 * L170, L232, L427 and L796, which are identical in structure: `12px 18px` of
 * padding, a 44px round `--g` button on each end, and NO RULE UNDERNEATH. That
 * last part is the change. The design contains twelve `border-bottom` hairlines
 * and every one of them is a row separator inside a card; not one is a chrome
 * divider across a screen. A header in this direction is separated from the
 * content below it by the content's own shadow, nothing else.
 *
 * The bottom inset is consumed ONLY through `reserveDock`, and only because the
 * floating nav capsule is positioned against it. Everything else here stays
 * inset-agnostic: a screen that genuinely reaches the bottom edge for its own
 * reasons applies useSafeAreaInsets itself.
 *
 * `reserveDock` used to pad by a bare constant and under-reserved by exactly the
 * bottom inset on every device that has one, which put the last row of the list
 * under the glass. It now asks `useDockReserve()`, which cannot be short.
 */

import { ArrowLeft } from 'lucide-react-native';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDockReserve } from '@/lib/dock';

import { useColors } from '@/lib/theme-context';
import { GRID, PointerEvents, Radii, Rule, Space, TOUCH_TARGET, Type } from '@/lib/theme';

/**
 * The screen gutter, and `Space` has no step for it — `lg` is 16 and `xl` is 20.
 * All four artboard headers and all four scroll bodies say 18. Held locally
 * rather than rounded, because the gutter sets the line length of every screen
 * in the app and 20 visibly narrows the feed's cards. The token layer wants a
 * `Space.gutter = 18`; this constant disappears the day it lands.
 */
const GUTTER = 18;

export type ScreenProps = {
  children: ReactNode;
  title?: string;
  scroll?: boolean;
  padded?: boolean;
  right?: ReactNode;
  onBack?: () => void;
  /**
   * Overlay the 25px modular grid the whole design is set on. Decorative and
   * barely visible (`grid` is 3% ink) — it belongs on the surfaces that are
   * mostly artwork, like the Session stage, not on every list.
   */
  grid?: boolean;
  /**
   * Leave room at the bottom of a `scroll` body for the floating nav capsule.
   *
   * The capsule takes NO layout space, so without this the last row of a
   * scrolling screen inside `(tabs)` sits underneath it — unreadable and
   * untappable. Every FlatList in the app already pays this itself via
   * `useDockReserve()`; this is the same reservation for the screens that let
   * `Screen` own their scroller. Off by default because routes outside the tab
   * group have no capsule to clear.
   */
  reserveDock?: boolean;
  /**
   * Paint the app ground behind this screen.
   *
   * THE RULE IS POSITIONAL, NOT AESTHETIC: inside `(tabs)` this must be
   * `false`, everywhere else it must be `true`. The ambient blobs are mounted
   * ONCE behind the tab navigator, so an opaque `bg` here covers them for that
   * whole screen — and a covered ground is the failure that takes the glass
   * with it, because a 5.5%-white card over flat `bg` composites to a grey
   * plate with nothing behind it (see `GlassCard`). Routes outside the group
   * have no blobs to reveal and need the fill.
   *
   * `true` by default because a missing fill outside the group is instantly
   * visible, where the reverse mistake is not: a screen INSIDE the group that
   * forgets to opt out looks completely normal and has simply lost its light.
   * That is the one to check first when a screen's cards look flat.
   *
   * Whichever way this goes, the navigator's own scene background has to agree,
   * or the problem just moves one layer out.
   */
  ground?: boolean;
};

export function Screen({
  children,
  title,
  scroll = false,
  padded = true,
  right,
  onBack,
  grid = false,
  reserveDock = false,
  ground = true,
}: ScreenProps) {
  const C = useColors();
  const dockReserve = useDockReserve();
  const hasHeader = Boolean(title || onBack || right);

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, ground && { backgroundColor: C.bg }]}>
      {grid ? <GridOverlay color={C.grid} /> : null}

      {hasHeader ? (
        <View style={[styles.constrain, styles.header, padded && styles.gutter]}>
          {onBack ? <BackButton onPress={onBack} /> : null}

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
          contentContainerStyle={[
            styles.scrollContent,
            styles.constrain,
            padded && styles.gutter,
            /*
              Inline rather than a StyleSheet entry, because the value depends on
              the device inset and a static object cannot carry that. This is the
              whole reason the old `dockTail` was wrong.
            */
            reserveDock ? { paddingBottom: dockReserve } : null,
          ]}
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
 * The back control, and it is a CARD now rather than a bare glyph.
 *
 * Every chrome button in the design is the same 44px circle of `--g` behind a
 * `--gb` hairline (L234 settings, L429 back, L430 invite), pressing to
 * `surface2`. That matters more here than it looks: on a ground this dark a
 * bare 20px arrow with nothing behind it stops reading as a target at all, and
 * the header no longer has a rule under it to imply one.
 *
 * No negative margin any more. The circle is a visible object, so its own edge
 * is what should line up with the gutter, not the optical centre of the arrow.
 */
function BackButton({ onPress }: { onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={({ pressed }) => [
        styles.back,
        { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
      ]}>
      <ArrowLeft size={19} strokeWidth={2} color={C.ink} />
    </Pressable>
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
  gutter: {
    paddingHorizontal: GUTTER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // The artboard's own `12px … 10px`. Tighter than the 54px minimum this used
    // to hold, because the 44px button now sets the height on its own.
    paddingTop: Space.md,
    paddingBottom: 10,
    gap: Space.md,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
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
