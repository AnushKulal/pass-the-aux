/**
 * Settings. Design: `design/nocturne/aux-nocturne.dc.html`, the `sc-if
 * isSettings` block at L600–L643.
 *
 * NOCTURNE REPLACES THE STACK OF FREE-STANDING ROW CARDS WITH GROUPED CARDS,
 * and that single change is what lets the rows carry a second line again.
 *
 * The previous version of this file banned a `detail` prop on `Row`, with the
 * note that "a required explanation under every row is what made this screen a
 * wall of text". That was true of the shape it had: every setting was its own
 * radius-18 card floating on the ground with a sentence under it, so twelve
 * sentences read as twelve paragraphs. The artboard groups related rows inside
 * ONE radius-24 card separated by a hairline, and gives every row a title at
 * 600/15 and a subtitle at 400/11 — the subtitle is the second line of a row,
 * not a paragraph under a card, and it stops the values ("Linked · free") from
 * having to double as explanations. So the ban is lifted deliberately, and the
 * thing that made it necessary is gone rather than merely tolerated.
 *
 * WHAT THE ARTBOARD DOES NOT SHOW, AND WHERE IT WENT:
 *   SOFTWARE UPDATE  — the artboard has no update section at all, and this app
 *                      ships two independent updaters (over-the-air JavaScript
 *                      via `@/lib/updates`, and the whole APK via
 *                      `@/lib/apk-updates`). It gets its own kicker between
 *                      MUSIC ACCOUNTS and ACCOUNT, built from the same card and
 *                      row vocabulary as everything around it.
 *   VOICE & VIDEO    — the artboard's "Microphone & audio" row opens a voice
 *                      sheet that does not exist here. Mic, deafen and
 *                      per-person mute are Session-scoped UI state in
 *                      `app/room/[id].tsx`, not stored preferences, so there is
 *                      nothing for a settings row to read or write. Omitted
 *                      rather than faked; see the report.
 *
 * FOUR STATES, scoped to the block that actually has data behind it. Appearance
 * and Software update answer instantly and are never blanked; ACCOUNTS is the
 * only block waiting on a network read, so it carries the states:
 *   loading   two row-shaped skeletons inside the real card
 *   error     one row that names the failure and retries on press
 *   empty     signed in with no profile row — the one action that makes one
 *   ready     Spotify and YouTube with their real values
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { ArrowLeft, ChevronRight, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuxButton, GlassCard, Skeleton, StatusPill, useToast } from '@/components/ui';
import { useProfile } from '@/features/profile/queries';
import {
  checkForNewApk,
  downloadAndInstallApk,
  formatBytes,
  installedVersionCode,
  type ApkCheck,
} from '@/lib/apk-updates';
import { useAuth } from '@/lib/auth';
import { useDockReserve } from '@/lib/dock';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import type { ThemeChoice } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';
import { useUpdates } from '@/lib/updates';

/**
 * The screen gutter, and `Space` has no step for it — `lg` is 16 and `xl` is 20.
 * The artboard's scroll body is `padding:14px 18px 130px`. Held locally for the
 * same reason `ui/screen.tsx` and `(tabs)/profile.tsx` hold their own copies;
 * all three disappear the day the token layer grows a `Space.gutter = 18`.
 */
const GUTTER = 18;

/**
 * `GlassCard` keeps its 24px corner private (it is the design's card radius and
 * `Radii` has no step for it). This mirror exists only so a grouped card's clip
 * can sit exactly inside the card's own hairline; it goes away with the same
 * `Radii.card = 24` that retires the constant in `glass-card.tsx`.
 */
const CARD_RADIUS = 24;

/** The artboard's theme tiles: 88 tall at radius 20, which `Radii` has no step for. */
const THEME_TILE = 88;
const THEME_RADIUS = 20;
const THEME_ICON = 19;

/** The provider monogram tile: 38 at radius 13, same as the lounge rows on You. */
const TAG_TILE = 38;
const TAG_RADIUS = 13;

const CHEVRON = 18;
const BACK_ICON = 16;

const SEGMENTS: { key: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'system', label: 'System', icon: Monitor },
];

export default function SettingsScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const dockReserve = useDockReserve();
  const toast = useToast();
  const { session, profile, loading, refreshProfile } = useAuth();
  // The control surface for the whole theming system. Everything that calls
  // `useColors()` is downstream of this one setter.
  const { choice, setChoice } = useTheme();

  /*
    The same cache entry AuthProvider already holds — identical key, identical
    options, so no second request. The context hands over the row and a coarse
    `loading`; the FAILURE only exists here, and without it the Accounts block
    would report "Not linked" to someone whose profile simply did not arrive.
  */
  const profileQuery = useProfile(session?.user.id);

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

  const retryProfile = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

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

  /*
    On a failed check the meta line is the only place that can say WHY, so it
    stops reporting the installed patch and names the fault instead. The button
    below it is the fix, which is why this stays one clause.
  */
  const updateMeta = update.isAvailable
    ? `${update.pending.patchCount} ${update.pending.patchCount === 1 ? 'patch' : 'patches'} · ${fixes} ${fixes === 1 ? 'fix' : 'fixes'}`
    : update.status === 'error'
      ? 'Could not reach the update server.'
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

  /*
    Every branch the row used to answer in two words, reworded as the row's
    SUBTITLE — which is the one line on this screen that has room to name the
    action as well as the state. "Build 42 · 51 MB" told you a build existed and
    left you to guess that tapping downloads it.
  */
  const apkLine =
    apkBusy === 'downloading'
      ? 'Downloading the build…'
      : apkBusy === 'checking'
        ? 'Checking for a newer build…'
        : apk?.kind === 'available'
          ? `Build ${apk.latest.versionCode} · ${formatBytes(apk.latest.sizeBytes)} · tap to install`
          : apk?.kind === 'current'
            ? 'Up to date'
            : apk?.kind === 'error'
              ? 'Check failed — tap to try again'
              : apk?.kind === 'unsupported'
                ? 'Android only'
                : installedBuild > 0
                  ? `Build ${installedBuild} · tap to check`
                  : 'Tap to check for a new build';

  /*
    The artboard's own three-part line — link, tier, and which source is
    actually playing. The tier alone ("Free · linked") is the fact people
    misread as a fault, so the clause that follows it is the whole point.
  */
  const spotifyLine = !profile?.spotify_linked
    ? 'Not linked — playing through YouTube'
    : profile.is_premium
      ? 'Linked · Premium — playing through Spotify'
      : 'Linked · free — playing through YouTube';

  const accounts: 'loading' | 'error' | 'empty' | 'ready' = profile
    ? 'ready'
    : loading
      ? 'loading'
      : profileQuery.isError
        ? 'error'
        : 'empty';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            /*
              The nav capsule floats and takes no layout space, so the body has
              to leave room for it or its last row sits under the glass. Inline
              rather than a StyleSheet entry because `useDockReserve()` includes
              the device's bottom inset, which a static object cannot carry —
              the old `Dock.reserve` here left NEGATIVE clearance on every phone
              with a home indicator.
            */
            { paddingBottom: dockReserve },
          ]}
          showsVerticalScrollIndicator={false}>
          <BackLink
            label="You"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/profile');
            }}
          />
          <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
            Settings
          </Text>

          {/* ------------------------------------------------------ appearance */}
          <Kicker first>Appearance</Kicker>
          <View accessibilityRole="radiogroup" style={styles.themeRow}>
            {SEGMENTS.map((segment) => (
              <ThemeTile
                key={segment.key}
                segment={segment}
                selected={choice === segment.key}
                onPress={() => setChoice(segment.key)}
              />
            ))}
          </View>
          <Text style={[styles.helper, { color: C.ink3 }]}>
            System follows your phone. Aux was built for the dark one.
          </Text>

          {/* -------------------------------------------------- music accounts */}
          <Kicker>Music accounts</Kicker>
          <GlassCard padded={false}>
            {/*
              The clip is an INNER view, not `overflow: 'hidden'` on the card.
              A row's press wash is a full-bleed rectangle and would square off
              the card's corners without it — but Android clips a view's own
              boxShadow away along with its children, so putting the clip on the
              card would silently cost it `raised()` on one platform only.
              Inset by the hairline the card draws, so the two corners nest.
            */}
            <View style={styles.clip}>
              {accounts === 'ready' ? (
                <>
                  <SettingRow
                    tag="SP"
                    title="Spotify"
                    subtitle={spotifyLine}
                    trailing={<ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />}
                    onPress={() => router.push('/settings/connections')}
                    divider
                  />
                  {/*
                    A NEUTRAL badge where the artboard draws a blue gradient
                    "SIGN IN" pill. Blue means "you do this" in this direction,
                    and YouTube sign-in is not built — a gradient badge would be
                    a promise the tap cannot keep, which is exactly the kind of
                    thing the accent rule exists to prevent. The row still
                    presses, and the toast is what explains why nothing happens.
                  */}
                  <SettingRow
                    tag="YT"
                    title="YouTube"
                    subtitle="Not signed in — Aux plays public audio"
                    trailing={<StatusPill label="Not linked" tone="outline" />}
                    onPress={() => toast.show('YouTube sign-in is not built yet.', 'info')}
                  />
                </>
              ) : accounts === 'loading' ? (
                /*
                  Two rows' worth of placeholder, built the way the rows are:
                  a 38px block inside 14px of padding, with the same hairline
                  between them. Sizing the placeholder as one 66px block per
                  row instead would be 35px taller than the card it stands in
                  for, and the card would visibly shrink when the profile lands.
                */
                <View accessibilityRole="progressbar" accessibilityLabel="Loading your accounts">
                  <View
                    style={[
                      styles.skeletonRow,
                      { borderBottomWidth: Rule.hair, borderBottomColor: C.ruleSoft },
                    ]}>
                    <Skeleton width="100%" height={TAG_TILE} radius={TAG_RADIUS} />
                  </View>
                  <View style={styles.skeletonRow}>
                    <Skeleton width="100%" height={TAG_TILE} radius={TAG_RADIUS} />
                  </View>
                </View>
              ) : accounts === 'error' ? (
                <SettingRow
                  title="Accounts did not load"
                  subtitle="Tap to try again."
                  onPress={retryProfile}
                />
              ) : (
                <SettingRow
                  title="Finish setting up"
                  subtitle="Pick a handle and these rows fill in."
                  trailing={<ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />}
                  onPress={() => router.push('/(auth)/claim-username')}
                />
              )}
            </View>
          </GlassCard>
          <Text style={[styles.helper, { color: C.ink3 }]}>
            Aux never streams audio itself — both accounts stay yours.
          </Text>

          {/* -------------------------------------------------- software update */}
          <Kicker>Software update</Kicker>
          <GlassCard>
            <View style={styles.updateHead}>
              <View style={styles.updateHeadText}>
                <Text style={[styles.rowTitle, { color: C.ink }]}>{updateTitle}</Text>
                <Text style={[styles.updateMeta, { color: C.ink2 }]}>{updateMeta}</Text>
              </View>
              {/*
                Ink, and it stays ink now that there are two accents rather than
                one. Coral reports a state of the world (live, playing, in sync,
                unread) and blue is an action you take; this dot is neither —
                the button below it is the action, and a blue dot over a blue
                button would put the same signal on one card twice.

                All three surfaces that report this event agree: this dot,
                `update-banner.tsx`'s mark, and `update-prompt.tsx`'s kicker.
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

            {/*
              The kit's gradient pill rather than the hand-rolled `pill` fill
              this used to draw. Applying an update is unambiguously an ACTION,
              which is what blue means here, and `sm` is the artboard's 46px
              in-card control height.
            */}
            <View style={styles.updateAction}>
              <AuxButton
                label={updateAction}
                variant="pri"
                size="sm"
                fullWidth
                loading={update.status === 'checking'}
                onPress={
                  update.isAvailable ? () => void update.apply() : () => void update.check(true)
                }
              />
            </View>
          </GlassCard>

          {/*
            The other kind of update. Over-the-air ships JavaScript; this
            ships the whole app, and is the only way native changes can reach
            a phone. It hands off to Android's own installer.

            A standalone radius-18 row with NO shadow, which is the design's
            other card size — all 43 of its radius-24 surfaces carry a shadow
            and none of its 54 radius-18 rows do. Hand-rolled rather than
            `GlassCard variant="row"` because it presses and `GlassCard` is not
            a Pressable.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Android build. ${apkLine}`}
            accessibilityState={{ busy: apkBusy !== 'idle', disabled: apkBusy !== 'idle' }}
            disabled={apkBusy !== 'idle'}
            onPress={
              apk?.kind === 'available' ? () => void runApkInstall() : () => void runApkCheck()
            }
            style={({ pressed }) => [
              styles.loneRow,
              { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
            ]}>
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: C.ink }]}>
                Android build
              </Text>
              <Text numberOfLines={2} style={[styles.rowSub, { color: C.ink3 }]}>
                {apkLine}
              </Text>
            </View>
            {apkBusy !== 'idle' ? <ActivityIndicator size="small" color={C.ink2} /> : null}
          </Pressable>

          {/* -------------------------------------------------------- account */}
          <Kicker>Account</Kicker>
          <GlassCard padded={false}>
            <View style={styles.clip}>
              <SettingRow
                title="Edit your profile"
                subtitle="Photo, bio, activity visibility"
                trailing={<ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />}
                onPress={() => router.push('/(auth)/claim-username')}
                divider
              />
              <SettingRow
                title="About the developer"
                subtitle="Build info, sync internals, credits"
                trailing={<ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />}
                onPress={() => router.push('/settings/about')}
              />
            </View>
          </GlassCard>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

/**
 * The back control on every screen in the settings family.
 *
 * A LINK above the title, not the 44px circle `ui/screen.tsx` draws. The
 * artboard is consistent about the difference: a screen you pushed onto a tab
 * (Settings, About, Connections) gets a named text link — "You", "Settings" —
 * that says where back GOES, while a full-bleed screen with chrome on both ends
 * gets the circle. The name is the whole value; a bare arrow here would cost
 * the one word that makes the hierarchy legible.
 */
function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.backHeld]}>
      {/*
        The press dims the WHOLE link — arrow and word together — via opacity on
        the row, rather than recolouring the two independently. `Pressable`'s
        style callback cannot reach a child's `color` prop, and threading press
        state through React state to tint an icon is a re-render per touch for a
        16px glyph.
      */}
      <ArrowLeft size={BACK_ICON} strokeWidth={2} color={C.ink2} />
      <Text style={[styles.backLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

function Kicker({ children, first = false }: { children: ReactNode; first?: boolean }) {
  const C = useColors();
  return (
    <Text style={[styles.kicker, first && styles.kickerFirst, { color: C.ink3 }]}>{children}</Text>
  );
}

/**
 * One appearance option: an 88px tile with its icon and label bottom-left.
 *
 * The selected tile is the BLUE GRADIENT, which is the accent rule applied
 * literally — a selected segment is listed alongside the CTA and the FAB as
 * something you do, and coral is reserved for states of the world. The gradient
 * is an absolutely-positioned child bleeding one pixel past every edge rather
 * than the view's own background, exactly as `AuxButton` does it: absolute
 * insets are measured from the padding box, so at zero it would leave a 1px
 * transparent ring inside the border and read as a gap between the fill and its
 * own glow.
 */
function ThemeTile({
  segment,
  selected,
  onPress,
}: {
  segment: { key: ThemeChoice; label: string; icon: LucideIcon };
  selected: boolean;
  onPress: () => void;
}) {
  const C = useColors();
  const Icon = segment.icon;
  const fg = selected ? C.pillInk : C.ink;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${segment.label} appearance`}
      onPress={onPress}
      style={({ pressed: held }) => [
        styles.themeTile,
        {
          borderColor: C.rule,
          backgroundColor: selected ? 'transparent' : held ? C.surface2 : C.surface,
        },
        // Keyed to the tile's height the way the artboard keys every blue glow:
        // 0 6px 16px under a control this size, not the CTA's 0 10px 26px.
        selected
          ? { boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 16, color: C.glow }] }
          : null,
        selected && held ? styles.themeHeld : null,
      ]}>
      {selected ? (
        <LinearGradient
          colors={[C.priTint, C.pill]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.themeFill}
        />
      ) : null}
      <Icon size={THEME_ICON} strokeWidth={2} color={fg} />
      <Text style={[styles.themeLabel, { color: fg }]}>{segment.label}</Text>
    </Pressable>
  );
}

/**
 * A row inside a grouped card.
 *
 * No skin of its own: the rows are separated by a hairline inside one card,
 * which is what the artboard draws and what keeps a group reading as a single
 * object. `tag` is the 38px provider monogram; rows without a provider (the
 * ACCOUNT group) simply omit it and the text starts at the gutter.
 */
function SettingRow({
  tag,
  title,
  subtitle,
  trailing,
  onPress,
  divider = false,
}: {
  tag?: string;
  title: string;
  subtitle: string;
  trailing?: ReactNode;
  onPress: () => void;
  divider?: boolean;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed: held }) => [
        styles.row,
        divider ? { borderBottomWidth: Rule.hair, borderBottomColor: C.ruleSoft } : null,
        held ? { backgroundColor: C.surface2 } : null,
      ]}>
      {/*
        A WELL, so `bgRecessed` behind a hairline — the same tile the lounge
        rows on You use. `surfaceSolid` is the other candidate and is wrong
        here: this is a hole punched in the row, not a card sitting on it.
      */}
      {tag ? (
        <View style={[styles.tag, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
          <Text style={[styles.tagText, { color: C.ink2 }]}>{tag}</Text>
        </View>
      ) : null}

      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: C.ink }]}>
          {title}
        </Text>
        <Text numberOfLines={2} style={[styles.rowSub, { color: C.ink3 }]}>
          {subtitle}
        </Text>
      </View>

      {trailing}
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
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    // The bottom padding is inline on the ScrollView — see the note there.
  },

  /* -------------------------------------------------------------- header */

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Space.sm,
    minHeight: TOUCH_TARGET,
    // The link starts at the gutter, so the arrow's own box is the only thing
    // that may hang: `paddingRight` widens the target to the right instead.
    paddingRight: Space.md,
  },
  backHeld: {
    opacity: 0.6,
  },
  backLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },
  title: {
    ...Type.display(28),
    letterSpacing: tracking(28, -0.025),
    marginTop: Space.sm,
  },

  /* -------------------------------------------------------------- rhythm */

  /*
    The artboard's kicker rhythm is exact and repeated: the first kicker on a
    screen has a bottom margin only, every later one is `22px 0 10px`. Getting
    this wrong is what makes a settings screen read as one long list instead of
    four groups.
  */
  kicker: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.13),
    marginTop: 22,
    marginBottom: 10,
  },
  /** The artboard's title carries `margin:8px 0 18px`; `Space` has no 18. */
  kickerFirst: {
    marginTop: 18,
  },
  helper: {
    ...Type.body(12),
    lineHeight: 18,
    marginTop: 10,
  },

  /* ---------------------------------------------------------- appearance */

  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeTile: {
    flex: 1,
    minHeight: THEME_TILE,
    // A column container defaults to stretch, which would blow the 19px icon
    // out to the full tile width. The artboard sets both children flush left.
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: 14,
    borderRadius: THEME_RADIUS,
    borderWidth: Rule.hair,
    // The gradient is an absolutely-positioned CHILD, so the tile has to be a
    // containing block or the fill would find the nearest positioned ancestor.
    position: 'relative',
  },
  themeFill: {
    position: 'absolute',
    top: -Rule.hair,
    left: -Rule.hair,
    right: -Rule.hair,
    bottom: -Rule.hair,
    borderRadius: THEME_RADIUS,
  },
  /** The gradient tile dims under the finger; there is no second blue to ease to. */
  themeHeld: {
    opacity: 0.9,
  },
  themeLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: tracking(11, 0.04),
  },

  /* ---------------------------------------------------------------- rows */

  clip: {
    borderRadius: CARD_RADIUS - Rule.hair,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    padding: 14,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  rowSub: {
    ...Type.body(11),
    lineHeight: 15,
    marginTop: 2,
  },
  tag: {
    width: TAG_TILE,
    height: TAG_TILE,
    borderRadius: TAG_RADIUS,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: {
    fontFamily: Fonts.extrabold,
    fontSize: 11,
    lineHeight: 14,
  },
  skeletonRow: {
    padding: 14,
  },
  /** A row that stands alone on the ground rather than inside a group. */
  loneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    marginTop: 10,
    padding: 14,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
  },

  /* -------------------------------------------------------------- update */

  updateHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  updateHeadText: {
    flex: 1,
    minWidth: 0,
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
  updateAction: {
    marginTop: Space.lg,
  },
});
