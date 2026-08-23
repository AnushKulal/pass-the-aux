import { Redirect, router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
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
import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback, type SourcePreference } from '@/playback/store';

const GUTTER = 12;
const CELL = 46;

/** Resolved link state. "free" is a normal, supported way to use Aux. */
type LinkState = 'unlinked' | 'free' | 'premium';

const SOURCE_OPTIONS: { value: SourcePreference; label: string; detail: string }[] = [
  {
    value: 'auto',
    label: 'AUTO',
    detail:
      'Plays through Spotify when your account is linked and Premium, YouTube for everyone else.',
  },
  {
    value: 'youtube',
    label: 'ALWAYS YOUTUBE',
    detail:
      'Ignores Spotify even on Premium. Useful if Spotify keeps handing playback to another device.',
  },
];

const BADGE: Record<LinkState, string> = {
  unlinked: 'NOT CONNECTED',
  free: 'CONNECTED · FREE',
  premium: 'CONNECTED · PREMIUM',
};

const EXPLANATION: Record<LinkState, string> = {
  unlinked:
    'Aux does not need Spotify. Everything plays through YouTube unless you link a Spotify Premium account here.',
  free: 'Your Spotify account is linked, but Spotify only lets apps control playback on Premium accounts. Aux will play your Sessions through YouTube instead.',
  premium:
    'Sessions play through the Spotify app on this device. Keep Spotify installed and signed in, and leave it open when you take the aux.',
};

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

  const state: LinkState = !profile?.spotify_linked
    ? 'unlinked'
    : profile.is_premium
      ? 'premium'
      : 'free';

  const overridden = state === 'premium' && source === 'youtube';
  const sourceDetail = SOURCE_OPTIONS.find((option) => option.value === source)?.detail ?? '';

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out. Without this it would render "Not connected" to a stranger.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View
        style={styles.flex}
        entering={
          reduced
            ? undefined
            : FadeInDown.duration(Duration.enter).withInitialValues({
                opacity: 0,
                transform: [{ translateY: 8 }],
              })
        }>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to you"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/profile');
            }}
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
            <ArrowLeft size={15} strokeWidth={2} color={C.ink2} />
            <Text style={[styles.backLabel, { color: C.ink2 }]}>YOU</Text>
          </Pressable>

          <Text style={[styles.screenTitle, { color: C.ink }]}>Connections</Text>

          {/* --------------------------------------------------- spotify card */}
          <View style={[styles.card, { borderColor: C.rule2 }]}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardTitle, { color: C.ink }]}>Spotify</Text>
              {loading ? (
                <View style={[styles.chip, { borderColor: C.rule3 }]}>
                  <Text style={[styles.chipLabel, { color: C.ink3 }]}>CHECKING…</Text>
                </View>
              ) : state === 'premium' ? (
                /* The one accent on this screen: Premium is the state in which
                   Aux can actually drive Spotify. */
                <View style={[styles.chipFilled, { backgroundColor: C.live }]}>
                  <Text style={[styles.chipLabel, { color: C.onLive }]}>{BADGE.premium}</Text>
                </View>
              ) : (
                /* Free is a bordered, mono chip — deliberately NOT danger. A
                   linked free account is a supported configuration, and paint-
                   ing it red would tell the user to go fix something that is
                   not broken. */
                <View style={[styles.chip, { borderColor: C.rule3 }]}>
                  <Text style={[styles.chipLabel, { color: C.ink2 }]}>{BADGE[state]}</Text>
                </View>
              )}
            </View>

            {loading ? (
              <Text style={[styles.cardBody, { color: C.ink2 }]}>
                Checking your Spotify connection…
              </Text>
            ) : (
              <>
                <Text style={[styles.cardBody, { color: C.ink2 }]}>{EXPLANATION[state]}</Text>

                {state === 'free' ? (
                  <View style={[styles.inset, { borderColor: C.rule }]}>
                    <Text style={[styles.insetText, { color: C.ink2 }]}>
                      <Text style={{ color: C.ink }}>
                        Nothing is broken and nothing is missing.
                      </Text>{' '}
                      Search, queueing, chat and sync all work exactly the same — only the audio
                      comes from YouTube.
                    </Text>
                  </View>
                ) : null}

                {overridden ? (
                  <View style={[styles.inset, { borderColor: C.rule }]}>
                    <Text style={[styles.insetText, { color: C.ink2 }]}>
                      Playback source is set to Always YouTube below, so Sessions are not using
                      Spotify right now.
                    </Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  {state === 'unlinked' ? (
                    <Action
                      label="CONNECT SPOTIFY"
                      accent
                      disabled={linking}
                      onPress={() => {
                        void link();
                      }}
                    />
                  ) : (
                    <>
                      {state === 'free' ? (
                        <Action
                          label="RECHECK PREMIUM"
                          accent
                          disabled={linking}
                          onPress={() => {
                            void link();
                          }}
                        />
                      ) : null}
                      <Action
                        label="UNLINK"
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

          {/* ------------------------------------------------- playback source */}
          <Text style={[styles.kicker, { color: C.ink3 }]}>PLAYBACK SOURCE</Text>
          <View accessibilityRole="radiogroup" style={[styles.segment, { borderColor: C.rule3 }]}>
            {SOURCE_OPTIONS.map((option, index) => {
              const selected = source === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                  onPress={() => usePlayback.getState().setSourcePreference(option.value)}
                  style={({ pressed }) => [
                    styles.segmentCell,
                    index > 0 && { borderLeftWidth: Rule.hair, borderLeftColor: C.rule3 },
                    {
                      backgroundColor: selected ? C.live : pressed ? C.surface : 'transparent',
                    },
                  ]}>
                  <Text
                    numberOfLines={1}
                    style={[
                      selected ? styles.segmentLabelOn : styles.segmentLabelOff,
                      { color: selected ? C.onLive : C.ink2 },
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.caption, { color: C.ink3 }]}>{sourceDetail}</Text>

          {/* ------------------------------------------------------ handshake */}
          {linking ? <Handshake reduced={reduced} /> : null}

          <View style={[styles.footnoteRule, { backgroundColor: C.rule }]} />
          <Text style={[styles.footnote, { color: C.ink3 }]}>
            Your choice is stored on this device only, so each phone you sign in on can play from a
            different source.
          </Text>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

function Action({
  label,
  accent = false,
  disabled = false,
  onPress,
}: {
  label: string;
  accent?: boolean;
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
        {
          borderColor: accent ? C.live : C.rule2,
          backgroundColor: pressed ? (accent ? C.liveWash : C.surface) : 'transparent',
          opacity: disabled ? 0.55 : 1,
        },
      ]}>
      <Text
        style={[accent ? styles.actionLabelAccent : styles.actionLabel, { color: accent ? C.liveText : C.ink2 }]}>
        {label}
      </Text>
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
      true
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
    <View style={styles.handshake}>
      <View style={[styles.handshakeRule, { backgroundColor: C.rule }]} />
      <Text style={[styles.kicker, styles.handshakeKicker, { color: C.ink3 }]}>CONNECTING…</Text>
      <View style={[styles.handshakeRow, { borderColor: C.rule }]}>
        <Animated.View style={[styles.mark, { backgroundColor: C.live }, animated]} />
        <Text style={[styles.handshakeText, { color: C.ink2 }]}>Returning from Spotify…</Text>
        <Text style={[styles.readout, { color: C.ink3 }]}>
          {minutes}:{String(seconds).padStart(2, '0')}
        </Text>
      </View>
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
    paddingBottom: Space.xxxl,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: GUTTER,
  },
  backLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.1),
  },
  screenTitle: {
    ...Type.display(26),
    letterSpacing: tracking(26, -0.025),
    paddingHorizontal: GUTTER,
    marginBottom: Space.lg,
  },
  card: {
    marginHorizontal: GUTTER,
    padding: 14,
    borderWidth: Rule.hair,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  cardTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.01),
    flex: 1,
  },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: Rule.hair,
  },
  chipFilled: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  chipLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
  cardBody: {
    ...Type.body(16),
    marginTop: 10,
  },
  /** A quieter nested note. Bordered, never washed in danger. */
  inset: {
    marginTop: Space.md,
    padding: Space.md,
    borderWidth: Rule.hair,
  },
  insetText: {
    ...Type.body(14),
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    marginTop: 14,
  },
  action: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: Rule.hair,
  },
  actionLabelAccent: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.09),
  },
  actionLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.09),
  },
  kicker: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
    paddingHorizontal: GUTTER,
    marginTop: Space.xl,
    marginBottom: Space.sm,
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: GUTTER,
    borderWidth: Rule.hair,
  },
  segmentCell: {
    flex: 1,
    minHeight: CELL,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  segmentLabelOn: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.08),
  },
  segmentLabelOff: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.08),
  },
  caption: {
    ...Type.body(14),
    paddingHorizontal: GUTTER,
    marginTop: Space.sm,
  },
  handshake: {
    marginTop: 22,
  },
  handshakeRule: {
    height: Rule.major,
    marginHorizontal: GUTTER,
  },
  handshakeKicker: {
    marginTop: 14,
  },
  handshakeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: GUTTER,
    padding: Space.md,
    borderWidth: Rule.hair,
  },
  mark: {
    width: 8,
    height: 8,
  },
  handshakeText: {
    ...Type.body(14),
    flex: 1,
  },
  readout: {
    ...Type.readout(12),
    fontVariant: ['tabular-nums' as const],
  },
  footnoteRule: {
    height: Rule.major,
    marginHorizontal: GUTTER,
    marginTop: 22,
  },
  footnote: {
    ...Type.body(14),
    paddingHorizontal: GUTTER,
    marginTop: 14,
  },
});
