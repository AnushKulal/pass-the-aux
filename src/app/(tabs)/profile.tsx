/**
 * You — the profile tab. Design: `design/nocturne/aux-nocturne.dc.html`, the
 * `sc-if isYou` block at L357–L413.
 *
 * NOCTURNE REPLACES THE CENTRED HERO WITH A CARD, AND THAT IS THE WHOLE SCREEN.
 * The previous direction opened with a 132px photo tile on the centre line, a
 * name under it and three stat cards below that. This one opens with an
 * identity CARD — a 76px gradient tile on the left, the name, handle and Edit
 * pill beside it, then chips, bio and a meta line — and spends the space the
 * stats used to occupy on the thing the stats were counting: the lounge list.
 *
 * WHERE THE OLD SCREEN'S PARTS WENT, because nothing here was dropped:
 *   MEMBER SINCE stat  → the identity card's meta line, which is where the
 *                        artboard puts it ("MEMBER SINCE JUN 2025 · …").
 *   LOUNGES / HOSTING  → the "Your lounges" heading carries both counts, and
 *                        each owned or moderated row carries its own badge.
 *   Spotify row        → the Connections menu row, whose subtitle now states
 *                        the link, the tier AND which source is actually
 *                        playing — three facts the old two-word value could
 *                        not hold.
 *   YouTube row        → the provider chips, where it belongs: YouTube needs no
 *                        link, so a permanently "Not linked" row was a row that
 *                        could never do anything.
 *
 * FOUR STATES, and they are now scoped to the block that owns the data rather
 * than to the whole screen:
 *   the IDENTITY slot follows the profile read (loading / error / empty / ready)
 *   the LOUNGES slot follows the memberships read, independently
 *   the MENU CARD and Sign out are always drawn — they are navigation, they
 *   need no row to work, and hiding them because a profile fetch failed strands
 *   the user on a dead screen with no route to Settings.
 */

import { router } from 'expo-router';
import {
  ChevronRight,
  Mic,
  Pencil,
  SlidersHorizontal,
  UserRound,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo } from 'react';
import {
  Alert,
  Platform,
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
  Avatar,
  AuxButton,
  EmptyState,
  GlassCard,
  Skeleton,
  StatusPill,
  useToast,
} from '@/components/ui';
import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { useMyLounges, useProfile, type MyLounge } from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import type { ProfileRow } from '@/lib/database.types';
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
import { useColors } from '@/lib/theme-context';
import { usePlayback, type SourcePreference } from '@/playback/store';

/**
 * The screen gutter, and `Space` has no step for it — `lg` is 16 and `xl` is 20.
 * The artboard's scroll body is `padding:14px 18px 130px`. Held locally for the
 * same reason `ui/screen.tsx` holds its own copy; both disappear the day the
 * token layer grows a `Space.gutter = 18`.
 */
const GUTTER = 18;

/**
 * THREE DIFFERENT AVATAR SIZES LIVE IN THIS DESIGN AND THEY ARE NOT A MISTAKE:
 * 76 at radius 26 here, 82 at radius 28 on another user's profile, 82 at radius
 * 22 on the edit form. Unifying them flattens three deliberately different
 * registers — your own face in a list of your own things, someone else's face
 * as the subject of a screen, and a photo you are currently editing.
 */
const AVATAR = 76;
const AVATAR_RADIUS = 26;

/**
 * `GlassCard` keeps its 24px corner private (it is the design's card radius and
 * `Radii` has no step for it). This mirror exists only so the menu card's clip
 * can sit exactly inside the card's own hairline; it goes away with the same
 * `Radii.card = 24` that retires the constant in `glass-card.tsx`.
 */
const CARD_RADIUS = 24;

/** The artboard's identity card is 18, not the kit's default 16. */
const IDENTITY_PAD = 18;

const MENU_ICON = 19;
const CHEVRON = 18;

/** The artboard's Sign out is 50 tall, one step under the 54px primary CTA. */
const SIGN_OUT_HEIGHT = 50;

/** What the screen is showing in its identity slot. Derived once, read everywhere. */
type Status = 'loading' | 'error' | 'empty' | 'ready';

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export default function ProfileScreen() {
  const C = useColors();
  const reduced = useReducedMotion();
  const dockReserve = useDockReserve();
  const toast = useToast();
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  /*
    Same query key and options as the one AuthProvider runs, so React Query
    hands back the SAME cache entry rather than firing a second request. The
    context exposes only the row and a coarse `loading`; the failure lives
    here, and a screen that cannot tell "still fetching" from "the fetch threw"
    has no error state to draw.
  */
  const profileQuery = useProfile(user?.id);
  const lounges = useMyLounges(user?.id);

  /*
    A selector, not the whole store: this screen re-renders only when the
    playback SOURCE changes, never on a position tick. It is here because the
    artboard's Connections row states where audio is actually coming from
    ("Spotify linked · free — playing via YouTube"), and being linked is not the
    same fact as being played from.
  */
  const sourcePreference = usePlayback((s) => s.sourcePreference);

  /*
    Driven from a shared value in an effect, never `entering={FadeIn…}`: a
    Reanimated layout animation marks the view hidden until it runs, and on
    react-native-web it never runs.
  */
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const confirmSignOut = useCallback(() => {
    confirmDestructive('Sign out?', 'Any Session you are hosting ends.', 'Sign out', () => {
      void signOut().catch((caught: unknown) => {
        toast.show(caught instanceof Error ? caught.message : 'Could not sign out.', 'error');
      });
    });
  }, [signOut, toast]);

  const retry = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const editProfile = useCallback(() => router.push('/(auth)/claim-username'), []);
  const openCreate = useCallback(() => router.push('/lounge/create'), []);

  /* `refetch` is stable across renders in React Query v5; the query object is not. */
  const refetchLounges = lounges.refetch;
  const retryLounges = useCallback(() => {
    void refetchLounges();
  }, [refetchLounges]);

  const memberships = lounges.data;
  const stats = useMemo(() => {
    const rows = memberships ?? [];
    return {
      lounges: rows.length,
      hosting: rows.filter((row) => row.role === 'owner').length,
    };
  }, [memberships]);

  /*
    A row already in hand beats every other signal: a background refetch
    failing is no reason to replace a profile the user can see.
  */
  const status: Status = profile
    ? 'ready'
    : loading || !user
      ? 'loading'
      : profileQuery.isError
        ? 'error'
        : 'empty';

  /*
    Both stats the old three-card strip carried, in the artboard's own meta
    voice and attached to the list they describe. Suppressed at zero, where the
    empty card below already says it better than "0 LOUNGES" does.
  */
  const countLine =
    stats.lounges > 0
      ? `${stats.lounges} LOUNGES${stats.hosting > 0 ? ` · ${stats.hosting} HOSTING` : ''}`
      : null;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            /*
              The nav capsule floats and takes no layout space, so the body has
              to leave room for it or its last row — the Sign out button — sits
              under the glass. Inline rather than a StyleSheet entry because
              `useDockReserve()` includes the device's bottom inset, which a
              static object cannot carry; the old `Dock.reserve` here left
              NEGATIVE clearance on every phone with a home indicator.
            */
            { paddingBottom: dockReserve },
          ]}
          showsVerticalScrollIndicator={false}>
          {status === 'ready' && profile ? (
            <IdentityCard profile={profile} onEdit={editProfile} />
          ) : status === 'loading' ? (
            <IdentitySkeleton />
          ) : status === 'error' ? (
            /*
              The shared card, where this screen used to keep a bespoke twin.
              That twin existed because the identity slot was a 132px centred
              photo tile and no shared card could stand in its place without the
              layout jumping when the row landed. The slot is a radius-24 card
              now, which is exactly what `EmptyState` is, so the twin has no
              reason to exist and the four states finally share one shape.
            */
            <EmptyState
              icon={WifiOff}
              title="Profile did not load"
              description={messageOf(profileQuery.error)}
              primary={{ label: 'Try again', onPress: retry }}
            />
          ) : (
            <EmptyState
              icon={UserRound}
              title="No profile yet"
              description="Pick a handle and this screen fills in."
              primary={{ label: 'Choose a handle', onPress: editProfile }}
            />
          )}

          <GlassCard padded={false} style={styles.menu}>
            {/*
              The clip is an INNER view, not `overflow: 'hidden'` on the card.
              A row's press wash is a full-bleed rectangle and would square off
              the card's corners without it — but Android clips a view's own
              boxShadow away along with its children, so putting the clip on the
              card would silently cost it `raised()` on one platform only.
              Inset by the hairline the card draws, so the two corners nest.
            */}
            <View style={styles.menuClip}>
              <MenuRow
                icon={SlidersHorizontal}
                title="Settings"
                subtitle="Appearance, accounts, about the developer"
                onPress={() => router.push('/settings')}
                divider
              />
              <MenuRow
                icon={Mic}
                title="Connections"
                subtitle={connectionsLine(profile, sourcePreference)}
                onPress={() => router.push('/settings/connections')}
              />
            </View>
          </GlassCard>

          <View style={styles.sectionHead}>
            <Text accessibilityRole="header" style={[styles.section, { color: C.ink }]}>
              Your lounges
            </Text>
            {countLine ? (
              <Text style={[styles.sectionCount, { color: C.ink3 }]}>{countLine}</Text>
            ) : null}
          </View>

          {lounges.isPending ? (
            <LoungeListSkeleton />
          ) : lounges.isError ? (
            /*
              New: the memberships read had no failure state of its own before,
              only a "—" in a stat card. A list that silently renders empty when
              the network drops tells the user they have left every lounge.
            */
            <EmptyState
              icon={WifiOff}
              title="Could not load your lounges"
              description={messageOf(lounges.error)}
              primary={{ label: 'Try again', onPress: retryLounges }}
            />
          ) : stats.lounges === 0 ? (
            <EmptyState
              icon={Users}
              title="No lounges yet"
              description="Create one, or join with a code."
              primary={{ label: 'Create a lounge', onPress: openCreate }}
            />
          ) : (
            <View style={styles.loungeList}>
              {(memberships ?? []).map((item, index) => (
                <LoungeRow key={item.lounge.id} item={item} index={index} />
              ))}
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={confirmSignOut}
            style={({ pressed }) => [
              styles.signOut,
              {
                borderColor: C.dangerBorder,
                backgroundColor: pressed ? C.dangerWash : 'transparent',
              },
            ]}>
            {/*
              Destruction has its own hue again in this direction. This used to
              be drawn in `live` because the old palette had one alarm colour
              for both "happening now" and "this deletes something"; painting a
              sign-out coral now would claim the state accent for an action.
            */}
            <Text style={[styles.signOutLabel, { color: C.danger }]}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------- identity */

function IdentityCard({ profile, onEdit }: { profile: ProfileRow; onEdit: () => void }) {
  const C = useColors();
  const name = profile.display_name || profile.username;
  const photo = profile.photo_url ?? profile.avatar_url;

  return (
    <GlassCard padded={false} style={styles.identity}>
      <View style={styles.identityTop}>
        {/*
          The artboard's avatar is not pressable — it has the Edit pill beside
          it. Keeping the tap is deliberate: it is the affordance people who
          have used any other profile screen reach for first, and it costs
          nothing to honour. `Avatar` sets `accessible` on its own root, so the
          wrapper hides its subtree rather than letting a screen reader announce
          an image inside a button.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your photo"
          onPress={onEdit}
          style={styles.avatarHit}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Avatar
              uri={photo}
              name={name}
              size={AVATAR}
              radius={AVATAR_RADIUS}
              identity
              presence={profile.show_activity}
            />
          </View>
        </Pressable>

        <View style={styles.identityBody}>
          <View style={styles.nameRow}>
            <View style={styles.nameBlock}>
              <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                {name}
              </Text>
              <Text numberOfLines={1} style={[styles.handle, { color: C.ink2 }]}>
                @{profile.username}
              </Text>
            </View>

            <AuxButton
              label="Edit"
              icon={Pencil}
              variant="bordered"
              size="sm"
              onPress={onEdit}
            />
          </View>

          {/*
            Providers, then tier. The coral one is PREMIUM and only PREMIUM —
            the accent rule lists it explicitly as a state of the world, and it
            is the single piece of coral this screen is allowed.
          */}
          <View style={styles.chips}>
            <StatusPill label="YouTube" tone="outline" />
            {profile.spotify_linked ? <StatusPill label="Spotify" tone="outline" /> : null}
            {profile.is_premium ? <StatusPill label="Premium" tone="accent" /> : null}
          </View>
        </View>
      </View>

      {profile.bio ? (
        <Text numberOfLines={4} style={[styles.bio, { color: C.ink2 }]}>
          {profile.bio}
        </Text>
      ) : null}

      <Text style={[styles.meta, { color: C.ink3 }]}>{metaLine(profile)}</Text>
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * A row in the menu card. Hand-rolled rather than a `GlassCard variant="row"`
 * because these rows have no skin of their own — they are separated by a
 * hairline inside one card, which is what the artboard draws and what keeps the
 * two of them reading as a single object.
 */
function MenuRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
  divider = false,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onPress: () => void;
  divider?: boolean;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        divider ? { borderBottomWidth: Rule.hair, borderBottomColor: C.ruleSoft } : null,
        pressed ? { backgroundColor: C.surface2 } : null,
      ]}>
      <Icon size={MENU_ICON} strokeWidth={2} color={C.ink2} />
      <View style={styles.menuBody}>
        <Text style={[styles.menuTitle, { color: C.ink }]}>{title}</Text>
        <Text numberOfLines={2} style={[styles.menuSub, { color: C.ink3 }]}>
          {subtitle}
        </Text>
      </View>
      <ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />
    </Pressable>
  );
}

/**
 * One lounge you belong to.
 *
 * ADOPTS the shared `LoungeCard` rather than drawing its own row, which is what
 * this used to do. Explore and Lounges were forked the same way and were fixed
 * first; this one survived that pass because nobody was assigned it, and the
 * result was three implementations of one row across three screens.
 *
 * `variant="row"` because this list sits under a section head inside the
 * profile column rather than standing alone on the page — and that variant had
 * no caller at all until now, which is precisely how the previous fork started.
 *
 * THE ROLE BADGE IS CORAL, and this file previously argued at length that it
 * should not be: "being the owner of a lounge is a permission, not something
 * happening right now". That reasoning is reasonable and it is wrong, because
 * the design settles it — L508 and L511 draw OWNER and PREMIUM as a solid
 * `--aux-live` fill with `--aux-on-live` on top. `member-row.tsx` already
 * rendered them that way, so the app was showing your role in two different
 * colours on two screens, each defending itself in a comment.
 */
function LoungeRow({ item, index }: { item: MyLounge; index: number }) {
  const { lounge, role, joinedAt } = item;

  return (
    <LoungeCard
      variant="row"
      name={lounge.name}
      meta={`${lounge.is_public ? 'PUBLIC' : 'INVITE ONLY'} · JOINED ${shortDate(joinedAt)}`}
      iconUrl={lounge.icon_url}
      badge={role === 'owner' ? 'Host' : role === 'mod' ? 'Mod' : undefined}
      index={index}
      onPress={() => router.push({ pathname: '/lounge/[id]', params: { id: lounge.id } })}
      accessibilityHint="Opens this lounge"
    />
  );
}

/* ------------------------------------------------------------- skeletons */

/**
 * The identity card with its content removed, not a spinner.
 *
 * Every block is the size of the thing it stands in for and sits inside a REAL
 * `GlassCard`, so the card itself never pops into existence — only its contents
 * resolve. That is the only reason to prefer a skeleton over a spinner.
 */
function IdentitySkeleton() {
  return (
    /*
      The role sits on a wrapper rather than the card: `GlassCard` takes only
      `style` for placement and forwards no accessibility props, and a
      progressbar has to be announced by SOMETHING or the loading state is
      silent to a screen reader.
    */
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your profile">
      <GlassCard padded={false} style={styles.identity}>
        <View style={styles.identityTop}>
          <Skeleton width={AVATAR} height={AVATAR} radius={AVATAR_RADIUS} />
          <View style={styles.identityBody}>
            <Skeleton width="70%" height={24} radius={Radii.sm} />
            <Skeleton width={92} height={14} radius={Radii.sm} style={styles.skeletonHandle} />
            <View style={styles.chips}>
              <Skeleton width={76} height={24} radius={Radii.pill} />
              <Skeleton width={64} height={24} radius={Radii.pill} />
            </View>
          </View>
        </View>
        <Skeleton width="100%" height={16} radius={Radii.sm} style={styles.skeletonBio} />
        <Skeleton width="52%" height={12} radius={Radii.sm} style={styles.skeletonMeta} />
      </GlassCard>
    </View>
  );
}

/* ------------------------------------------------------------------ utils */

/**
 * The artboard's meta line, `MEMBER SINCE JUN 2025 · SPOTIFY LINKED (FREE)`,
 * built from the row instead of hardcoded. It carries what the MEMBER SINCE
 * stat card used to and what `spotifyValue()` used to, in one line.
 */
function metaLine(profile: ProfileRow): string {
  const spotify = profile.spotify_linked
    ? `SPOTIFY LINKED (${profile.is_premium ? 'PREMIUM' : 'FREE'})`
    : 'SPOTIFY NOT LINKED';
  return `${memberSince(profile.created_at)} · ${spotify}`;
}

/**
 * The Connections subtitle. Linked and PLAYED FROM are two different facts —
 * a free Spotify account cannot be controlled remotely, so audio comes out of
 * YouTube whether or not the account is attached. Saying only "linked" is how
 * the old row managed to be true and useless at the same time.
 */
function connectionsLine(profile: ProfileRow | null, source: SourcePreference): string {
  if (!profile) return 'Spotify, YouTube and the playback source';

  const via = source === 'youtube' || !profile.is_premium ? 'YouTube' : 'Spotify';
  if (!profile.spotify_linked) return `Spotify not linked — playing via ${via}`;
  return `Spotify linked · ${profile.is_premium ? 'premium' : 'free'} — playing via ${via}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Check your connection.';
}

function memberSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'MEMBER';
  const month = date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  return `MEMBER SINCE ${month} ${date.getFullYear()}`;
}

/** `MAR '25` — the same short form the meta line uses, one size down. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const month = date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  return `${month} '${String(date.getFullYear()).slice(-2)}`;
}

/**
 * `Alert` on react-native-web renders without its buttons, so a destructive
 * confirmation there would be a dialog you cannot say no to. Fall back to the
 * browser's own confirm, which is the honest equivalent.
 */
function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/* ----------------------------------------------------------------- styles */

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

  /* ------------------------------------------------------------ identity */

  identity: {
    padding: IDENTITY_PAD,
  },
  identityTop: {
    flexDirection: 'row',
    gap: 14,
  },
  /*
    The tile is 76 square and the Pressable must not grow past it, or the hit
    area swallows the gap and the name row's first tap lands on the photo.
  */
  avatarHit: {
    alignSelf: 'flex-start',
  },
  identityBody: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    // Top-aligned, so a wrapped two-line name pushes down and leaves the Edit
    // pill where the eye already found it.
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  nameBlock: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...Type.display(24),
    letterSpacing: tracking(24, -0.02),
  },
  handle: {
    ...Type.body(13),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  bio: {
    ...Type.body(14),
    marginTop: 14,
  },
  /*
    400 at 10px, uppercase — NOT `Type.label`, which is the same case and
    tracking at 600. The design sets this one line light on purpose so it reads
    as a footnote under the bio rather than competing with the section heading
    below it.
  */
  meta: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: tracking(10, 0.08),
    marginTop: 10,
  },

  /* ---------------------------------------------------------------- menu */

  menu: {
    marginTop: Space.md,
  },
  menuClip: {
    borderRadius: CARD_RADIUS - Rule.hair,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: 14,
    paddingHorizontal: Space.lg,
  },
  menuBody: {
    flex: 1,
    minWidth: 0,
  },
  menuTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 19,
  },
  menuSub: {
    ...Type.body(11),
    lineHeight: 15,
    marginTop: 2,
  },

  /* ------------------------------------------------------------- lounges */

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: 22,
    marginBottom: Space.md,
  },
  section: {
    ...Type.display(17),
    letterSpacing: tracking(17, -0.01),
    flexShrink: 1,
  },
  sectionCount: {
    ...readout(10),
    letterSpacing: tracking(10, 0.08),
  },
  loungeList: {
    gap: 10,
  },

  /* ----------------------------------------------------------- skeletons */

  skeletonHandle: {
    marginTop: 6,
  },
  skeletonBio: {
    marginTop: 14,
  },
  skeletonMeta: {
    marginTop: 10,
  },

  /* ------------------------------------------------------------ sign out */

  signOut: {
    marginTop: Space.lg,
    minHeight: SIGN_OUT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  signOutLabel: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.04),
  },
});
