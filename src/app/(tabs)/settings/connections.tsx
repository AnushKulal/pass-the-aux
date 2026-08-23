/**
 * Connections — the Spotify link and the playback source.
 *
 * The canvas has no artboard for this screen, so it is built entirely out of
 * the Settings vocabulary: back tile, kicker, raised card, recessed well with
 * raised segments. One state line per state, no paragraphs.
 */

import { Redirect, router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui';
import { useSpotifyLink } from '@/features/spotify/use-spotify-link';
import { useAuth } from '@/lib/auth';
import {
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  pressed as pressedWell,
  pressedSoft,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback, type SourcePreference } from '@/playback/store';

const CARD_GUTTER = 20;
const TEXT_GUTTER = 24;

const BACK_TILE = 38;
const BACK_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };

/** Resolved link state. "free" is a normal, supported way to use Aux. */
type LinkState = 'unlinked' | 'free' | 'premium';

const SOURCES: { value: SourcePreference; label: string; caption: string }[] = [
  { value: 'auto', label: 'AUTO', caption: 'Spotify on Premium, YouTube otherwise.' },
  { value: 'youtube', label: 'YOUTUBE', caption: 'Ignores Spotify on every account.' },
];

const VALUE: Record<LinkState, string> = {
  unlinked: 'Not linked',
  free: 'Free · linked',
  premium: 'Premium · linked',
};

const STATE_LINE: Record<LinkState, string> = {
  unlinked: 'Playing through YouTube.',
  free: 'Premium required — playing through YouTube.',
  premium: 'Playing through Spotify on this device.',
};

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function ConnectionsScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const toast = useToast();
  const { session, profile, loading } = useAuth();
  const { link, unlink, linking, error } = useSpotifyLink();
  // The playback store is the only reader of this preference, so this screen
  // has to write into that store — a settings copy of it would be a switch
  // wired to nothing.
  const source = usePlayback((state) => state.sourcePreference);

  // The hook keeps its own error string; the toast layer is where the user
  // actually looks, so mirror it there instead of adding a second banner.
  useEffect(() => {
    if (error) toast.show(error, 'error');
  }, [error, toast]);

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const state: LinkState = !profile?.spotify_linked
    ? 'unlinked'
    : profile.is_premium
      ? 'premium'
      : 'free';

  const overridden = state === 'premium' && source === 'youtube';
  const caption = SOURCES.find((option) => option.value === source)?.caption ?? '';

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out. Without this it would render "Not linked" to a stranger.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={BACK_SLOP}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)/profile');
              }}
              style={({ pressed }) => [
                styles.backTile,
                { backgroundColor: pressed ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <ChevronLeft size={20} strokeWidth={2.4} color={C.ink} />
            </Pressable>
            <Text style={[styles.title, { color: C.ink }]}>Connections</Text>
          </View>

          {/* ---------------------------------------------------- spotify card */}
          <Kicker>Spotify</Kicker>
          <View style={styles.block}>
            <View style={[styles.card, { backgroundColor: C.surface }, raised(C)]}>
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, { color: C.ink }]}>Spotify</Text>
                {loading ? (
                  <ActivityIndicator size="small" color={C.ink2} />
                ) : (
                  <Text
                    style={[
                      styles.cardValue,
                      { color: state === 'premium' ? C.liveText : C.ink2 },
                    ]}>
                    {VALUE[state]}
                  </Text>
                )}
              </View>

              {loading ? null : (
                <>
                  <Text style={[styles.cardLine, { color: C.ink2 }]}>
                    {overridden ? 'Overridden by the YouTube source below.' : STATE_LINE[state]}
                  </Text>

                  <View style={styles.actions}>
                    {state === 'unlinked' ? (
                      <Action
                        label="Connect Spotify"
                        primary
                        disabled={linking}
                        onPress={() => {
                          void link();
                        }}
                      />
                    ) : (
                      <>
                        {state === 'free' ? (
                          <Action
                            label="Recheck Premium"
                            primary
                            disabled={linking}
                            onPress={() => {
                              void link();
                            }}
                          />
                        ) : null}
                        <Action
                          label="Unlink"
                          disabled={linking}
                          onPress={() => {
                            void unlink();
                          }}
                        />
                      </>
                    )}
                  </View>
                </>
              )}
            </View>

            {linking ? <Handshake reduced={reduced} /> : null}
          </View>

          {/* ------------------------------------------------- playback source */}
          <Kicker>Playback source</Kicker>
          <View style={styles.block}>
            <View
              accessibilityRole="radiogroup"
              style={[styles.well, { backgroundColor: C.bgRecessed }, pressedWell(C)]}>
              {SOURCES.map((option) => {
                const selected = source === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    onPress={() => usePlayback.getState().setSourcePreference(option.value)}
                    style={({ pressed }) => [
                      styles.segment,
                      selected
                        ? [{ backgroundColor: C.surface }, raised(C)]
                        : pressed
                          ? { backgroundColor: C.surface2 }
                          : null,
                    ]}>
                    <Text style={[styles.segmentLabel, { color: selected ? C.ink : C.ink2 }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.caption, { color: C.ink3 }]}>{caption}</Text>
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

function Action({
  label,
  primary = false,
  disabled = false,
  onPress,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary
          ? [{ backgroundColor: pressed ? C.cream : C.pill }, dropped(C, 'md')]
          : [{ backgroundColor: C.bgRecessed }, pressedSoft(C)],
        disabled && styles.blocked,
      ]}>
      <Text style={[styles.actionLabel, { color: primary ? C.pillInk : C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

/** The OAuth round trip, while the browser is away. */
function Handshake({ reduced }: { reduced: boolean }) {
  const C = useColors();
  const pulse = useSharedValue(1);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.25, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduced]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.handshake, { backgroundColor: C.surface }, raised(C)]}>
      <Animated.View style={[styles.dot, { backgroundColor: C.live }, animated]} />
      <Text style={[styles.handshakeText, { color: C.ink2 }]}>Connecting…</Text>
      <Text style={[styles.readout, { color: C.ink3 }]}>
        {minutes}:{String(seconds).padStart(2, '0')}
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
    flex: 1,
    minWidth: 0,
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
    padding: 17,
    borderRadius: Radii.xl,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tracking(15, -0.01),
  },
  cardValue: {
    ...readout(13),
    fontFamily: Fonts.semibold,
  },
  cardLine: {
    ...Type.body(12.5),
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Space.lg,
  },
  action: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radii.sm + 1,
  },
  actionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  blocked: {
    opacity: 0.55,
  },

  well: {
    flexDirection: 'row',
    gap: 6,
    padding: 6,
    borderRadius: Radii.lg,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm + 1,
  },
  segmentLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: tracking(12.5, 0.06),
  },
  caption: {
    ...Type.body(12.5),
    marginTop: 1,
  },

  handshake: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.xs,
    padding: 15,
    borderRadius: Radii.lg,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: Radii.pill,
  },
  handshakeText: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.semibold,
    fontSize: 14.5,
    lineHeight: 19,
  },
  readout: {
    ...readout(13),
    fontFamily: Fonts.semibold,
  },
});
