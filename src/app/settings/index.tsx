import { Redirect, router } from 'expo-router';
import { ArrowLeft, ChevronRight, Mic, Monitor, Moon, Sun } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import type { ThemeChoice } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/** Settings rows are full-bleed; only their contents are inset. */
const GUTTER = 12;
const CELL = 52;

const APPEARANCE: { key: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { key: 'dark', label: 'DARK', icon: Moon },
  { key: 'light', label: 'LIGHT', icon: Sun },
  { key: 'system', label: 'SYSTEM', icon: Monitor },
];

export default function SettingsScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const toast = useToast();
  const { session, profile, loading } = useAuth();
  // The control surface for the whole theming system. Everything that calls
  // `useColors()` is downstream of this one setter.
  const { choice, setChoice } = useTheme();

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  const spotifyDetail = !profile?.spotify_linked
    ? 'Not linked — playing via YouTube'
    : profile.is_premium
      ? 'Linked · Premium — playing via Spotify'
      : 'Linked · free — playing via YouTube';

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
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <BackChip
            label="YOU"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/profile');
            }}
          />
          <Text style={[styles.screenTitle, { color: C.ink, borderBottomColor: C.rule }]}>
            Settings
          </Text>

          {/* ------------------------------------------------------ appearance */}
          <Kicker>APPEARANCE</Kicker>
          <View
            accessibilityRole="radiogroup"
            style={[styles.appearance, { borderColor: C.rule3 }]}>
            {APPEARANCE.map((option, index) => {
              const selected = choice === option.key;
              const Icon = option.icon;

              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label} appearance`}
                  onPress={() => setChoice(option.key)}
                  style={({ pressed }) => [
                    styles.appearanceCell,
                    index > 0 && { borderLeftWidth: Rule.hair, borderLeftColor: C.rule3 },
                    {
                      backgroundColor: selected
                        ? C.live
                        : pressed
                          ? C.surface
                          : 'transparent',
                    },
                  ]}>
                  <Icon size={17} strokeWidth={2} color={selected ? C.onLive : C.ink2} />
                  <Text
                    style={[styles.appearanceLabel, { color: selected ? C.onLive : C.ink2 }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Caption>
            System follows your phone. Aux was built for the dark one, but the grid holds either
            way.
          </Caption>

          {/* --------------------------------------------------- music accounts */}
          <Kicker>MUSIC ACCOUNTS</Kicker>
          <Row
            leading={<Tile>SP</Tile>}
            title="Spotify"
            detail={spotifyDetail}
            capped
            onPress={() => router.push('/settings/connections')}
          />
          {/*
            There is no YouTube account model in this build — Sessions already
            play through YouTube without one. The signed-out state is the honest
            one to show until the link exists.
          */}
          <Row
            leading={<Tile>YT</Tile>}
            title="YouTube"
            detail="Not signed in — tap to sign in"
            trailing={<AccentChip>SIGN IN</AccentChip>}
            onPress={() =>
              toast.show(
                'YouTube sign-in is not wired up yet. Sessions already play through YouTube without an account.',
                'info'
              )
            }
          />
          <Caption>
            Signing in to YouTube removes ads mid-session if you have Premium there. Aux never
            streams audio itself — both accounts stay yours.
          </Caption>

          {/* -------------------------------------------------- voice and video */}
          <Kicker>VOICE &amp; VIDEO</Kicker>
          <Row
            leading={<Mic size={19} strokeWidth={2} color={C.ink2} />}
            title="Microphone & audio"
            detail="Push to talk · medium · system default"
            capped
            onPress={() =>
              toast.show('Voice settings arrive with voice chat. Nothing to set yet.', 'info')
            }
          />

          {/* ------------------------------------------------------- account */}
          <Kicker>ACCOUNT</Kicker>
          <Row
            title="Edit your profile"
            detail="Handle, display name, avatar"
            capped
            onPress={() => router.push('/(auth)/claim-username')}
          />
          <Row
            title="About the developer"
            detail="Build info, sync internals, credits"
            closing
            onPress={() => router.push('/settings/about')}
          />
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

function BackChip({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label.toLowerCase()}`}
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
      <ArrowLeft size={15} strokeWidth={2} color={C.ink2} />
      <Text style={[styles.backLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  const C = useColors();
  return <Text style={[styles.kicker, { color: C.ink3 }]}>{children}</Text>;
}

function Caption({ children }: { children: ReactNode }) {
  const C = useColors();
  return <Text style={[styles.caption, { color: C.ink3 }]}>{children}</Text>;
}

function Tile({ children }: { children: ReactNode }) {
  const C = useColors();
  return (
    <View style={[styles.tile, { borderColor: C.rule2 }]}>
      <Text style={[styles.tileLabel, { color: C.ink2 }]}>{children}</Text>
    </View>
  );
}

function AccentChip({ children }: { children: ReactNode }) {
  const C = useColors();
  return (
    <View style={[styles.accentChip, { backgroundColor: C.live }]}>
      <Text style={[styles.accentChipLabel, { color: C.onLive }]}>{children}</Text>
    </View>
  );
}

/**
 * One tappable settings row.
 *
 * `capped` adds the top hairline for the first row of a group; `closing` swaps
 * the bottom hairline for the 2px rule that ends a major section.
 */
function Row({
  leading,
  title,
  detail,
  trailing,
  capped = false,
  closing = false,
  onPress,
}: {
  leading?: ReactNode;
  title: string;
  detail: string;
  trailing?: ReactNode;
  capped?: boolean;
  closing?: boolean;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        capped && { borderTopWidth: Rule.hair, borderTopColor: C.rule },
        {
          borderBottomWidth: closing ? Rule.major : Rule.hair,
          borderBottomColor: C.rule,
          backgroundColor: pressed ? C.surface : 'transparent',
        },
      ]}>
      {leading}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: C.ink }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.rowDetail, { color: C.ink2 }]}>
          {detail}
        </Text>
      </View>
      {trailing ?? <ChevronRight size={18} strokeWidth={2} color={C.ink3} />}
    </Pressable>
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
    paddingBottom: 14,
    borderBottomWidth: Rule.major,
  },
  kicker: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
    paddingHorizontal: GUTTER,
    paddingTop: Space.xl,
    paddingBottom: Space.sm,
  },
  caption: {
    ...Type.body(14),
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
  },
  appearance: {
    flexDirection: 'row',
    marginHorizontal: GUTTER,
    borderWidth: Rule.hair,
  },
  appearanceCell: {
    flex: 1,
    minHeight: CELL,
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: Space.xs,
    paddingHorizontal: 10,
    paddingVertical: Space.sm,
  },
  appearanceLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.08),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...Type.label(14),
    letterSpacing: 0,
    textTransform: 'none',
  },
  rowDetail: {
    ...Type.body(14),
    letterSpacing: tracking(14, 0.02),
  },
  tile: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  tileLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.04),
  },
  accentChip: {
    paddingHorizontal: Space.sm,
    paddingVertical: 5,
  },
  accentChipLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.08),
  },
});
