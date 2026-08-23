/**
 * About. Built from the Settings vocabulary — back tile, kicker, raised cards.
 *
 * Facts only: who made it, what it is on, where the source lives.
 */

import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ChevronLeft, ExternalLink } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  pressedSoft,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const CARD_GUTTER = 20;
const TEXT_GUTTER = 24;

const BACK_TILE = 38;
const BACK_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };
const MARK = 46;

const REPOSITORY = 'https://github.com/AnushKulal/pass-the-aux';

/** Falls back to the manifest value the store build was stamped with. */
const VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function AboutScreen() {
  const C = useColors();
  const reduced = useReducedMotion();

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to settings"
              hitSlop={BACK_SLOP}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/settings');
              }}
              style={({ pressed }) => [
                styles.backTile,
                { backgroundColor: pressed ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <ChevronLeft size={20} strokeWidth={2.4} color={C.ink} />
            </Pressable>
            <Text style={[styles.title, { color: C.ink }]}>About</Text>
          </View>

          <Kicker>Developer</Kicker>
          <View style={styles.block}>
            <View style={[styles.card, { backgroundColor: C.surface }, raised(C)]}>
              <View style={[styles.mark, { backgroundColor: C.bgRecessed }, pressedSoft(C)]}>
                <Text style={[styles.markLabel, { color: C.liveText }]}>AUX</Text>
              </View>
              <View style={styles.cardText}>
                <Text numberOfLines={1} style={[styles.cardTitle, { color: C.ink }]}>
                  Anush Kulal
                </Text>
                <Text numberOfLines={1} style={[styles.cardValue, { color: C.ink2 }]}>
                  @anushkulal
                </Text>
              </View>
            </View>
          </View>

          <Kicker>Build</Kicker>
          <View style={styles.stats}>
            <Stat value={VERSION} label="Version" />
            <Stat value="Expo" label="Runtime" />
            <Stat value="Supabase" label="Backend" />
          </View>

          <Kicker>Source</Kicker>
          <View style={styles.block}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open the source repository"
              onPress={() => {
                void WebBrowser.openBrowserAsync(REPOSITORY).catch(() => undefined);
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: C.ink }]}>
                Repository
              </Text>
              <ExternalLink size={17} strokeWidth={2} color={C.ink3} />
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

function Kicker({ children }: { children: ReactNode }) {
  const C = useColors();
  return <Text style={[styles.kicker, { color: C.ink3 }]}>{children}</Text>;
}

function Stat({ value, label }: { value: string; label: string }) {
  const C = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: C.surface }, raised(C)]}>
      <Text numberOfLines={1} style={[styles.statValue, { color: C.ink }]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={[styles.statLabel, { color: C.ink3 }]}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingTop: Space.md,
    paddingBottom: Space.huge,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: TEXT_GUTTER,
  },
  backTile: {
    width: BACK_TILE,
    height: BACK_TILE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  title: {
    ...Type.display(24),
    letterSpacing: tracking(24, -0.03),
  },

  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    paddingHorizontal: TEXT_GUTTER,
    paddingTop: Space.xxxl,
    paddingBottom: Space.md,
  },
  block: {
    paddingHorizontal: CARD_GUTTER,
    gap: 10,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 15,
    borderRadius: Radii.lg,
  },
  mark: {
    width: MARK,
    height: MARK,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
  },
  markLabel: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.06),
  },
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 14.5,
    lineHeight: 19,
  },
  cardValue: {
    ...Type.body(12.5),
    marginTop: 2,
  },

  stats: {
    flexDirection: 'row',
    gap: 11,
    paddingHorizontal: CARD_GUTTER,
  },
  stat: {
    flex: 1,
    padding: Space.lg,
    borderRadius: Radii.lg,
  },
  statValue: {
    ...readout(17),
    letterSpacing: tracking(17, -0.02),
  },
  statLabel: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.13),
    marginTop: 5,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.xs,
    padding: 15,
    borderRadius: Radii.lg,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.semibold,
    fontSize: 14.5,
    lineHeight: 19,
  },
});
