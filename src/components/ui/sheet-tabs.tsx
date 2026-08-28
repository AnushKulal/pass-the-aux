/**
 * The segmented control, and its flatter sibling.
 *
 * From design/nocturne/aux-nocturne.dc.html: the lounge tabs at L433-436, the
 * session view toggle at L910-913, the visibility toggle at L535-537 and the
 * auth switch at L117-119.
 *
 * THE SELECTED SEGMENT IS BLUE, AND THIS FILE USED TO ARGUE THE OPPOSITE.
 * The old reasoning was that a selected tab is what you are currently *in*,
 * which is the claim coral makes everywhere else. Nocturne draws the line
 * differently and the artboards are unambiguous: every selected segment is the
 * primary gradient. Selecting is something you DO, so it takes the action
 * colour; coral is reserved for things happening on their own — a live badge, a
 * speaking ring, a playing bar. Painting a tab coral here would put the two
 * accents in competition on the one control where a user switches fastest.
 *
 * The active pill is a LAYER, not a fill on the cell. Every segment carries its
 * own gradient at zero opacity and cross-fades in, which is what lets the pill
 * appear to move without measuring anything: a `flex: 1` cell's width is not
 * known until layout, and a sliding pill that has to wait for `onLayout` snaps
 * visibly on first paint. A true slide is the only thing given up.
 */

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useColors } from '@/lib/theme-context';
import { Duration, Fonts, Radii, Rule, Space, TOUCH_TARGET, tracking } from '@/lib/theme';

export type SheetTab = { key: string; label: string };

/**
 * - `segmented` — the design's control: a recessed pill track with a raised
 *   gradient pill riding in it.
 * - `underline` — the flat alternative, for a header where a filled track would
 *   be a second box inside an already-boxed sheet. Not drawn in nocturne; kept
 *   because screens still call for it, and retinted blue to match.
 */
export type SheetTabsVariant = 'underline' | 'segmented';

export type SheetTabsProps = {
  tabs: SheetTab[];
  active: string;
  onChange: (k: string) => void;
  variant?: SheetTabsVariant;
};

/** L434: `min-height:44px` inside a 5px track padding. */
const SEGMENT_HEIGHT = 44;
/** L433: `gap:5;padding:5`. Small enough that the track reads as one object. */
const TRACK_PAD = 5;

export function SheetTabs({ tabs, active, onChange, variant = 'underline' }: SheetTabsProps) {
  const C = useColors();
  const segmented = variant === 'segmented';

  const press = (key: string, selected: boolean) => {
    if (selected) return;
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
    onChange(key);
  };

  if (segmented) {
    return (
      <View
        accessibilityRole="tablist"
        /*
          `bgRecessed`, not `surface`. The design uses both — `surface` on the
          two tab bars (L433, L910) and `bgRecessed` on the two controls that
          sit inside a card (L535, L591) — and this component is used inside
          sheets and cards, where a second translucent layer composites to ~11%
          and the track stops reading as a well at all. The opaque value is
          right in every position; the translucent one is only right in two.
        */
        style={[styles.segTrack, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        {tabs.map((tab) => (
          <Segment
            key={tab.key}
            tab={tab}
            selected={tab.key === active}
            onPress={() => press(tab.key, tab.key === active)}
          />
        ))}
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.underlineTrack, { borderBottomColor: C.rule }]}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => press(tab.key, selected)}
            style={styles.underlineTab}>
            {/*
              The rule lives on a wrapper rather than on the Text: Android drops
              bottom borders applied directly to text nodes. Its width is held at
              2 on both states so selecting a tab never moves the baseline.
            */}
            <View
              style={[styles.underline, { borderBottomColor: selected ? C.pill : 'transparent' }]}>
              <Text numberOfLines={1} style={[styles.label, { color: selected ? C.ink : C.ink2 }]}>
                {tab.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One cell of the segmented track.
 *
 * Its own component so each cell owns one shared value — the alternative is an
 * array of them in the parent, which React's rules of hooks forbid the moment
 * `tabs` changes length.
 */
function Segment({
  tab,
  selected,
  onPress,
}: {
  tab: SheetTab;
  selected: boolean;
  onPress: () => void;
}) {
  const C = useColors();
  const reduced = useReducedMotion();

  /*
    The shared value is written from an effect, never from the press handler:
    the compiler treats a shared value as immutable outside one. Here the state
    is already a prop, so this costs no extra render.
  */
  const on = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: reduced ? 0 : Duration.press });
  }, [selected, reduced, on]);

  const fill = useAnimatedStyle(() => ({ opacity: on.value }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={tab.label}
      onPress={onPress}
      style={styles.segTab}>
      {/*
        L434: `0 6px 16px var(--aux-glow)`. The glow rides the animated wrapper
        rather than the gradient itself so it fades out with the pill — parked
        on a static parent it would linger under a deselected cell.
      */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.segFill,
          { boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 16, color: C.glow }] },
          fill,
        ]}>
        <LinearGradient
          colors={[C.priTint, C.pill]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.segFill]}
        />
      </Animated.View>

      <Text
        numberOfLines={1}
        style={[styles.label, styles.segLabel, { color: selected ? C.pillInk : C.ink2 }]}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * L434: `font:800 11-12px;letter-spacing:.04em`, and NOT uppercased — the
   * artboards read "Sessions", "Chat", "Members". Whatever case the caller
   * passes is the case that shows.
   */
  label: {
    fontFamily: Fonts.extrabold,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: tracking(12, 0.04),
  },

  segTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: TRACK_PAD,
    padding: TRACK_PAD,
    width: '100%',
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  segTab: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
  },
  segFill: {
    borderRadius: Radii.pill,
  },
  /** Above the absolutely-positioned pill, which is a sibling drawn first. */
  segLabel: {
    zIndex: 1,
  },

  underlineTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Space.xxl,
    borderBottomWidth: Rule.hair,
  },
  underlineTab: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
  },
  underline: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    flex: 1,
    borderBottomWidth: Rule.major,
    // Pulled down so the 2px accent covers the track's hairline instead of
    // stacking on top of it and reading as a 3px line.
    marginBottom: -Rule.hair,
  },
});
