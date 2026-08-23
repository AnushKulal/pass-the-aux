import { Redirect, router } from 'expo-router';
import { ArrowLeft, ChevronRight, Mic, Monitor, Moon, Sun } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
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
import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import type { ThemeChoice } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';
import { useUpdates } from '@/lib/updates';

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

  /**
   * The same update state the sheet reads. This screen is the recovery path:
   * dismissing the sheet hides it without discarding the update, so an "Update
   * now" waved away at a bad moment is still here afterwards.
   */
  const update = useUpdates();

  /**
   * The APK half, kept local because this screen is the only place it appears.
   *
   * Checked on demand rather than on mount: it is a network call for a 50MB
   * artefact most people will not want, and doing it automatically would spend
   * someone's mobile data to answer a question they did not ask.
   */
  const [apk, setApk] = useState<ApkCheck | null>(null);
  const [apkBusy, setApkBusy] = useState<'idle' | 'checking' | 'downloading'>('idle');

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
      // Android's installer has taken over. Nothing to report — if the user
      // accepts, this process is replaced; if they decline, they are simply
      // back here with the build still available.
    } catch {
      toast.show('Could not download the build. Check your connection and try again.', 'error');
    } finally {
      setApkBusy('idle');
    }
  }, [apk, toast]);

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  /* ---------------------------------------------------------- update copy */

  const fixesPending = update.pending.notes.length + update.pending.hidden;

  const updateTitle = update.isAvailable
    ? update.status === 'applying'
      ? 'Restarting…'
      : 'Update ready to install'
    : update.status === 'checking'
      ? 'Checking…'
      : update.status === 'error'
        ? 'Could not reach the update server'
        : update.confirmedCurrent
          ? 'You are up to date'
          : 'Check for updates';

  /**
   * Patch 0 means a build made before patches were numbered, so there is no
   * honest version to report — saying "on patch 0" would invent one.
   */
  const onPatch =
    update.currentPatch > 0
      ? `On patch ${update.currentPatch}`
      : 'Version not tracked on this build';

  const updateDetail = update.isAvailable
    ? `${update.pending.patchCount} ${update.pending.patchCount === 1 ? 'patch' : 'patches'} waiting · ${fixesPending} ${fixesPending === 1 ? 'fix' : 'fixes'}`
    : onPatch;

  /* ------------------------------------------------------------- apk copy */

  const installedBuild = installedVersionCode();

  const apkTitle =
    apkBusy === 'downloading'
      ? 'Downloading the new build…'
      : apkBusy === 'checking'
        ? 'Checking…'
        : apk?.kind === 'available'
          ? 'A new build is ready to install'
          : apk?.kind === 'current'
            ? 'You have the newest build'
            : apk?.kind === 'error'
              ? apk.message
              : apk?.kind === 'unsupported'
                ? 'Installing builds is Android only'
                : 'Check for a new build';

  const apkDetail =
    apk?.kind === 'available'
      ? `Build ${apk.latest.versionCode} · ${formatBytes(apk.latest.sizeBytes)} · replaces this one`
      : installedBuild > 0
        ? `Build ${installedBuild} installed`
        : 'Build number unavailable';

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

          {/* ------------------------------------------------- software update */}
          <Kicker>SOFTWARE UPDATE</Kicker>
          <Row
            leading={
              <Tile>{update.currentPatch > 0 ? `P${update.currentPatch}` : '—'}</Tile>
            }
            title={updateTitle}
            detail={updateDetail}
            capped
            trailing={
              update.isAvailable ? (
                <AccentChip>{update.status === 'applying' ? 'WAIT' : 'UPDATE NOW'}</AccentChip>
              ) : update.status === 'checking' ? (
                <ActivityIndicator size="small" color={C.ink2} />
              ) : (
                <Text style={[styles.checkLabel, { color: C.ink2 }]}>CHECK</Text>
              )
            }
            onPress={
              update.isAvailable ? () => void update.apply() : () => void update.check(true)
            }
          />

          {/*
            The same notes the sheet shows, for the user who dismissed it and
            came here to find out what they turned down.
          */}
          {update.isAvailable && update.pending.notes.length > 0 ? (
            <View style={[styles.updateNotes, { borderBottomColor: C.rule }]}>
              <Text style={[styles.updateNotesKicker, { color: C.ink3 }]}>
                {update.pending.patchCount > 1
                  ? `IN THE LAST ${update.pending.patchCount} PATCHES`
                  : 'IN THIS PATCH'}
              </Text>
              {update.pending.notes.map((note) => (
                <View key={note} style={styles.updateNote}>
                  <View style={[styles.updateNoteMark, { backgroundColor: C.ink3 }]} />
                  <Text style={[styles.updateNoteText, { color: C.ink2 }]}>{note}</Text>
                </View>
              ))}
              {update.pending.hidden > 0 ? (
                <Text style={[styles.updateMore, { color: C.ink3 }]}>
                  {`+${update.pending.hidden} more ${update.pending.hidden === 1 ? 'fix' : 'fixes'}`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/*
            The other kind of update. Over-the-air ships JavaScript in seconds;
            this ships the whole app, and is the only way native changes — a new
            permission, a new native module, an SDK bump — can ever reach a
            phone. It hands off to Android's installer, which asks for its own
            confirmation.
          */}
          <Row
            leading={<Tile>APK</Tile>}
            title={apkTitle}
            detail={apkDetail}
            closing
            trailing={
              apkBusy !== 'idle' ? (
                <ActivityIndicator size="small" color={C.ink2} />
              ) : apk?.kind === 'available' ? (
                <AccentChip>INSTALL</AccentChip>
              ) : (
                <Text style={[styles.checkLabel, { color: C.ink2 }]}>CHECK</Text>
              )
            }
            onPress={
              apkBusy !== 'idle'
                ? () => undefined
                : apk?.kind === 'available'
                  ? () => void runApkInstall()
                  : () => void runApkCheck()
            }
          />

          <Caption>
            Over-the-air updates arrive on their own and install in seconds; turning one down never
            loses it. A new build is the bigger kind — it carries native changes, downloads about
            50 MB, and Android will ask you to confirm the install.
          </Caption>

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
  checkLabel: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.1),
  },
  updateNotes: {
    // Hangs off the row above it, so it reads as that row's detail rather than
    // a section of its own.
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.md,
    // Hairline, not the section rule: the APK row follows and the 2px closing
    // rule belongs at the end of the whole section, not in the middle of it.
    borderBottomWidth: Rule.hair,
    gap: Space.sm,
  },
  updateNotesKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.1),
  },
  updateNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  updateNoteMark: {
    width: 8,
    height: Rule.major,
    // Sits on the text's first-line baseline rather than its box top.
    marginTop: 8,
  },
  updateNoteText: {
    ...Type.body(13),
    flex: 1,
  },
  updateMore: {
    ...Type.label(10),
    // Aligns with the note text, past the 8px mark and its gap.
    marginLeft: 8 + Space.sm,
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
