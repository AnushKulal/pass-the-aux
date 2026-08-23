/**
 * Settings. Design canvas: `data-screen-label="Settings"`.
 *
 * Kicker, then cards. The theme switcher is a recessed well with three raised
 * segments; the update card carries its own notes and its own button; every
 * other setting is a raised row of TITLE + VALUE.
 *
 * `Row` has no `detail` prop, deliberately. It used to require one, which is
 * how every setting on this screen ended up with a sentence under it.
 */

import { Redirect, router } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui';
import {
  checkForNewApk,
  downloadAndInstallApk,
  formatBytes,
  installedVersionCode,
  type ApkCheck,
} from '@/lib/apk-updates';
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
  raised,
  tracking,
} from '@/lib/theme';
import type { ThemeChoice } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';
import { useUpdates } from '@/lib/updates';

const CARD_GUTTER = 20;
const TEXT_GUTTER = 24;

const BACK_TILE = 38;
const BACK_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };

const SEGMENTS: { key: ThemeChoice; label: string }[] = [
  { key: 'dark', label: 'DARK' },
  { key: 'light', label: 'LIGHT' },
  { key: 'system', label: 'SYSTEM' },
];

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function SettingsScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const toast = useToast();
  const { session, profile, loading } = useAuth();
  // The control surface for the whole theming system. Everything that calls
  // `useColors()` is downstream of this one setter.
  const { choice, setChoice } = useTheme();

  /**
   * The same update state the sheet reads. This screen is the recovery path:
   * dismissing the sheet hides it without discarding the update.
   */
  const update = useUpdates();

  /**
   * The APK half, checked on demand rather than on mount: it is a network call
   * for a 50MB artefact, and doing it automatically would spend someone's
   * mobile data to answer a question they did not ask.
   */
  const [apk, setApk] = useState<ApkCheck | null>(null);
  const [apkBusy, setApkBusy] = useState<'idle' | 'checking' | 'downloading'>('idle');

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const runApkCheck = useCallback(async () => {
    setApkBusy('checking');
    setApk(await checkForNewApk());
    setApkBusy('idle');
  }, []);

  const runApkInstall = useCallback(async () => {
    if (apk?.kind !== 'available') return;
    setApkBusy('downloading');
    try {
      await downloadAndInstallApk(apk.latest);
      // Android's installer has taken over. Nothing to report.
    } catch {
      toast.show('Could not download the build.', 'error');
    } finally {
      setApkBusy('idle');
    }
  }, [apk, toast]);

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  const fixes = update.pending.notes.length + update.pending.hidden;

  const updateTitle = update.isAvailable
    ? update.status === 'applying'
      ? 'Restarting…'
      : 'Update ready'
    : update.status === 'checking'
      ? 'Checking…'
      : update.status === 'error'
        ? 'Check failed'
        : update.confirmedCurrent
          ? 'Up to date'
          : 'Check for updates';

  const updateMeta = update.isAvailable
    ? `${update.pending.patchCount} ${update.pending.patchCount === 1 ? 'patch' : 'patches'} · ${fixes} ${fixes === 1 ? 'fix' : 'fixes'}`
    : update.currentPatch > 0
      ? `Patch ${update.currentPatch}`
      : 'Untracked build';

  const updateAction = update.isAvailable
    ? update.status === 'applying'
      ? 'Restarting…'
      : 'Update now'
    : update.status === 'checking'
      ? 'Checking…'
      : 'Check now';

  const installedBuild = installedVersionCode();
  const apkValue =
    apkBusy === 'downloading'
      ? 'Downloading…'
      : apkBusy === 'checking'
        ? 'Checking…'
        : apk?.kind === 'available'
          ? `Build ${apk.latest.versionCode} · ${formatBytes(apk.latest.sizeBytes)}`
          : apk?.kind === 'current'
            ? 'Up to date'
            : apk?.kind === 'error'
              ? 'Check failed'
              : apk?.kind === 'unsupported'
                ? 'Android only'
                : installedBuild > 0
                  ? `Build ${installedBuild}`
                  : 'Check';

  const spotifyValue = !profile?.spotify_linked
    ? 'Not linked'
    : profile.is_premium
      ? 'Premium · linked'
      : 'Free · linked';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to you"
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
            <Text style={[styles.title, { color: C.ink }]}>Settings</Text>
          </View>

          {/* ------------------------------------------------------ appearance */}
          <Kicker>Appearance</Kicker>
          <View style={styles.block}>
            <View
              accessibilityRole="radiogroup"
              style={[styles.well, { backgroundColor: C.bgRecessed }, pressedWell(C)]}>
              {SEGMENTS.map((segment) => {
                const selected = choice === segment.key;
                return (
                  <Pressable
                    key={segment.key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${segment.label} appearance`}
                    onPress={() => setChoice(segment.key)}
                    style={({ pressed }) => [
                      styles.segment,
                      selected
                        ? [{ backgroundColor: C.surface }, raised(C)]
                        : pressed
                          ? { backgroundColor: C.surface2 }
                          : null,
                    ]}>
                    <Text
                      style={[styles.segmentLabel, { color: selected ? C.ink : C.ink2 }]}>
                      {segment.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.caption, { color: C.ink3 }]}>
              Light reverses the palette. Red stays reserved for live.
            </Text>
          </View>

          {/* -------------------------------------------------- software update */}
          <Kicker>Software update</Kicker>
          <View style={styles.block}>
            <View style={[styles.updateCard, { backgroundColor: C.surface }, raised(C)]}>
              <View style={styles.updateHead}>
                <View style={styles.updateHeadText}>
                  <Text style={[styles.updateTitle, { color: C.ink }]}>{updateTitle}</Text>
                  <Text style={[styles.updateMeta, { color: C.ink2 }]}>{updateMeta}</Text>
                </View>
                {/*
                  Ink, NOT the accent. Red means live / playing / joinable / in
                  sync / on aux / unread in this design, and a pending update is
                  none of those — `update-banner.tsx` states the same rule and
                  keeps its own mark on `ink2`. The two surfaces describe one
                  event and must not disagree about how loud it is.
                */}
                {update.isAvailable ? (
                  <View style={[styles.updateDot, { backgroundColor: C.ink }]} />
                ) : null}
              </View>

              {/*
                The same notes the sheet shows, for the user who dismissed it
                and came here to find out what they turned down.
              */}
              {update.isAvailable && update.pending.notes.length > 0 ? (
                <View style={styles.notes}>
                  {update.pending.notes.map((note) => (
                    <View key={note} style={styles.note}>
                      <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                      <Text style={[styles.noteText, { color: C.ink2 }]}>{note}</Text>
                    </View>
                  ))}
                  {update.pending.hidden > 0 ? (
                    <View style={styles.note}>
                      <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                      <Text style={[styles.noteText, { color: C.ink3 }]}>
                        {`+${update.pending.hidden} more`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={updateAction}
                accessibilityState={{ busy: update.status === 'applying' }}
                onPress={
                  update.isAvailable ? () => void update.apply() : () => void update.check(true)
                }
                style={({ pressed }) => [
                  styles.updateButton,
                  { backgroundColor: pressed ? C.cream : C.pill },
                  dropped(C, 'md'),
                ]}>
                {update.status === 'checking' ? (
                  <ActivityIndicator size="small" color={C.pillInk} />
                ) : (
                  <Text style={[styles.updateButtonLabel, { color: C.pillInk }]}>
                    {updateAction}
                  </Text>
                )}
              </Pressable>
            </View>

            {/*
              The other kind of update. Over-the-air ships JavaScript; this
              ships the whole app, and is the only way native changes can reach
              a phone. It hands off to Android's own installer.
            */}
            <Row
              title="Android build"
              value={apkValue}
              trailing={
                apkBusy !== 'idle' ? <ActivityIndicator size="small" color={C.ink2} /> : undefined
              }
              onPress={
                apkBusy !== 'idle'
                  ? undefined
                  : apk?.kind === 'available'
                    ? () => void runApkInstall()
                    : () => void runApkCheck()
              }
            />
          </View>

          {/* ------------------------------------------------------- accounts */}
          <Kicker>Accounts</Kicker>
          <View style={styles.block}>
            <Row
              title="Spotify"
              value={spotifyValue}
              chevron
              onPress={() => router.push('/settings/connections')}
            />
            <Row
              title="YouTube"
              value="Not linked"
              onPress={() => toast.show('YouTube sign-in is not built yet.', 'info')}
            />
          </View>

          {/* -------------------------------------------------------- account */}
          <Kicker>Account</Kicker>
          <View style={styles.block}>
            <Row title="Edit profile" chevron onPress={() => router.push('/(auth)/claim-username')} />
            <Row title="About" chevron onPress={() => router.push('/settings/about')} />
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

/**
 * One settings row: a raised card with a title and, at most, a VALUE.
 *
 * There is no `detail` prop and there should not be one — a required
 * explanation under every row is what made this screen a wall of text.
 */
function Row({
  title,
  value,
  trailing,
  chevron = false,
  onPress,
}: {
  title: string;
  value?: string;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
}) {
  const C = useColors();

  const body = (
    <>
      <Text numberOfLines={1} style={[styles.rowTitle, { color: C.ink }]}>
        {title}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={[styles.rowValue, { color: C.ink2 }]}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? <ChevronRight size={17} strokeWidth={2} color={C.ink3} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}. ${value}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? C.surface2 : C.surface },
        raised(C),
      ]}>
      {body}
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

  updateCard: {
    padding: 17,
    borderRadius: Radii.xl,
  },
  updateHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  updateHeadText: {
    flex: 1,
    minWidth: 0,
  },
  updateTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tracking(15, -0.01),
  },
  updateMeta: {
    ...Type.body(12.5),
    marginTop: 3,
  },
  updateDot: {
    width: 9,
    height: 9,
    borderRadius: Radii.pill,
  },
  notes: {
    marginTop: 14,
    gap: Space.sm,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  noteMark: {
    width: 9,
    height: 2,
    borderRadius: 1,
    // Sits on the text's first-line baseline rather than its box top.
    marginTop: 8,
  },
  noteText: {
    ...Type.body(13),
    flex: 1,
  },
  updateButton: {
    marginTop: Space.lg,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm + 1,
  },
  updateButtonLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
    lineHeight: 18,
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
  rowValue: {
    ...readout(13),
    fontFamily: Fonts.semibold,
  },
});
