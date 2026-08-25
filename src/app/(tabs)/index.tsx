/**
 * The Feed — the screen the app opens on, and the first thing anyone judges.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` L231-L320 (`isFeed`): a
 * pinned masthead of identity + greeting + settings, then a scroll body of
 * search, the LOUNGE RAIL, the live list, and a "Start a Session" promo that
 * closes the screen.
 *
 * FOUR DELIBERATE DEVIATIONS FROM THAT ARTBOARD, ALL FOR THE SAME REASON —
 * the mock is a static picture of a full app and this screen has real states:
 *
 * 1. THE NOW-PLAYING HERO SURVIVES. The artboard has no hero card; it opens
 *    straight onto search. But the hero is how you get BACK into a Session you
 *    are already in, and it is the only surface that reports sync. Deleting it
 *    to match a picture would delete a feature. It sits directly under the
 *    search pill, where the artboard's eye lands first anyway.
 * 2. The waveform is gone. It belonged to design/v2; nocturne has no waveform
 *    anywhere (zero matches for `wave` in the artboard file) and draws playback
 *    as the 4-6px coral gradient bar that `ProgressBar` now is. 64 hand-laid
 *    bars and a measured clip box went with it.
 * 3. The header's messages icon is gone. The nav capsule owns Messages and its
 *    unread badge now, and the artboard's header carries a settings gear
 *    instead — which is load-bearing, because settings has no nav slot.
 * 4. "See all" points at `/lounges`, not Explore. The artboard sends it to
 *    Explore, but in this app `/lounges` is "the lounges I am in" and it lost
 *    its nav cell when Messages took the slot. This link is now the only way
 *    to that screen, which makes the rail below it load-bearing rather than
 *    decoration.
 *
 * Everything here is still push-driven: the rows arrive over Realtime presence,
 * and the only queries are the two slow-moving lists behind them (my lounges,
 * my Sessions). Rows are filtered to lounges I am actually a member of, which
 * falls out of `useMyLounges` driving both the subscription and the list.
 */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ChevronRight, Play, Plus, Search, Settings, Users, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  NowPlayingCard,
  glyphFor,
  timecode,
  useFeedClock,
} from '@/components/feed/now-playing-card';
import {
  Avatar,
  AuxButton,
  CircleIconButton,
  EmptyState,
  GlassCard,
  ProgressBar,
  Screen,
  Skeleton,
  StatusPill,
} from '@/components/ui';
import { livePositionMs } from '@/features/presence/presence-client';
import {
  useBroadcastPresence,
  type LocalNowPlaying,
  type PresenceIdentity,
} from '@/features/presence/use-broadcast-presence';
import {
  MY_LOUNGES_KEY,
  useLoungePresence,
  useMyLounges,
  type FeedEntry,
  type LoungeRef,
} from '@/features/presence/use-lounge-presence';
import { useAuth } from '@/lib/auth';
import { syncClock } from '@/lib/clock';
import { useDockReserve } from '@/lib/dock';
import { supabase } from '@/lib/supabase';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  raisedLarge,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback } from '@/playback/store';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';

const MY_SESSIONS_KEY = 'my-sessions';
const SKELETON_ROWS = [0, 1, 2];
const SKELETON_RAIL = [0, 1];

/**
 * The screen gutter, and it is 18 on every nocturne artboard — the header at
 * L232 and the scroll body at L244 both say so. `Screen` holds the same number
 * for the same reason; this copy exists because this screen renders unpadded
 * and pays the gutter itself, so the rail can bleed past it.
 */
const GUTTER = 18;

/*
  WHAT THE LIST LEAVES CLEAR AT THE BOTTOM IS NO LONGER A CONSTANT, AND CANNOT BE.

  This used to be `const LIST_TAIL = Dock.reserve`, a static 126 that every
  caller was asked to add `insets.bottom` to by hand. This screen — the Feed,
  the first thing anyone sees — was one of the nine that forgot, so the tail was
  short by the whole bottom inset and the last row of the busiest list in the
  app sat under the floating nav capsule. The reservation now comes from
  `useDockReserve()`, which does that addition itself and so cannot be short;
  because it is a hook it is read in the component and applied inline, and
  `styles.content` no longer carries a `paddingBottom` at all.
*/

/** The hero's artwork well. The artboard's largest art tile is 54; a hero earns 78. */
const ART = 78;

/** L256/L268: a 172px lounge card and a 108px dashed NEW tile, 12 apart. */
const RAIL_CARD = 172;
const RAIL_NEW = 108;
const RAIL_GAP = 12;

/**
 * Clearance under the rail.
 *
 * `raised()` throws its shadow 16 down with a 34 blur, so it reaches ~19px
 * below the card — and a horizontal ScrollView clips to its own frame, which
 * would slice every rail card's lift clean off. The artboard's `padding-bottom:4`
 * gets away with it because CSS overflow does not clip a shadow the same way.
 */
const RAIL_TAIL = 20;

/**
 * The rail card's floor: 16 padding, a 34 stripe or two 17px lines of name, 14,
 * the 13.5px meta line, 16 padding. See the note on `styles.railCard` for why
 * this is a number and not `flex: 1`.
 */
const RAIL_HEIGHT = 100;

/** The rail's own corner. `GlassCard` owns 24 internally; the dashed tile has no card to inherit it from. */
const CARD_RADIUS = 24;

/** `Type.readout` hands back a readonly tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/**
 * The artboard says "Good evening" because it was drawn in the evening. The
 * hour decides which one is actually true — a greeting that is wrong is worse
 * than no greeting, and this is the first line on the first screen.
 */
function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A live Session I am already a participant in. */
type ActiveSession = {
  roomId: string;
  name: string;
  loungeId: string;
  timeline: RoomTimeline;
  track: { title: string; artist: string; artworkUrl: string | null; durationMs: number } | null;
};

/**
 * The Sessions I am in, with enough of the room row to reconstruct its
 * playback timeline.
 *
 * Three queries rather than one embedded select, for the same reason as
 * `useMyLounges`: the hand-authored `Database` type declares no relationships,
 * so PostgREST embeds will not typecheck against it.
 */
function useMySessions(userId: string | null | undefined): UseQueryResult<ActiveSession[]> {
  return useQuery({
    queryKey: [MY_SESSIONS_KEY, userId ?? null],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ActiveSession[]> => {
      if (!userId) return [];

      const participation = await supabase
        .from('room_participants')
        .select('room_id')
        .eq('user_id', userId);
      if (participation.error) throw participation.error;

      const roomIds = (participation.data ?? []).map((row) => row.room_id);
      if (roomIds.length === 0) return [];

      const rooms = await supabase
        .from('rooms')
        .select('id, name, lounge_id, track_id, started_at_ms, paused_at_ms, is_playing')
        .in('id', roomIds)
        .eq('is_active', true);
      if (rooms.error) throw rooms.error;

      const rows = rooms.data ?? [];
      const trackIds = rows.map((row) => row.track_id).filter((id): id is string => id !== null);

      const tracks = trackIds.length
        ? await supabase
            .from('tracks')
            .select('id, title, artist, artwork_url, duration_ms')
            .in('id', trackIds)
        : null;
      if (tracks?.error) throw tracks.error;

      const trackById = new Map((tracks?.data ?? []).map((track) => [track.id, track]));

      return rows.map((row) => {
        const track = row.track_id === null ? undefined : trackById.get(row.track_id);
        return {
          roomId: row.id,
          name: row.name,
          loungeId: row.lounge_id,
          timeline: {
            trackId: row.track_id,
            startedAtMs: row.started_at_ms,
            pausedAtMs: row.paused_at_ms,
            isPlaying: row.is_playing,
          },
          track: track
            ? {
                title: track.title,
                artist: track.artist,
                artworkUrl: track.artwork_url,
                durationMs: track.duration_ms,
              }
            : null,
        };
      });
    },
  });
}

// ------------------------------------------------------------------- masthead

/**
 * The pinned header (L232-242).
 *
 * Outside the scroller on purpose: the artboard has it `flex:none`, and the
 * two things it carries — who you are, and settings — are the two the rest of
 * the shell cannot reach. Settings has no cell in the nav capsule at all.
 */
function Masthead({
  name,
  avatarUrl,
  greeting,
  broadcasting,
  onProfile,
  onSettings,
}: {
  name: string;
  avatarUrl: string | null;
  greeting: string;
  /** Draws the punched-hole activity dot. See the call site for what it means. */
  broadcasting: boolean;
  onProfile: () => void;
  onSettings: () => void;
}) {
  const C = useColors();

  return (
    <View style={styles.masthead}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your profile"
        onPress={onProfile}
        style={({ pressed }) => [pressed && styles.pressed]}>
        {/*
          `identity` is the coral-to-magenta gradient, and the kit reserves it
          for the signed-in user's own face — this is the one avatar on the
          screen that is allowed to carry it.
        */}
        <Avatar uri={avatarUrl} name={name} size={48} identity presence={broadcasting} />
      </Pressable>

      <View style={styles.mastheadText}>
        <Text style={[styles.greeting, { color: C.ink3 }]}>{greeting}</Text>
        <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
          {name}
        </Text>
      </View>

      <CircleIconButton
        icon={Settings}
        size={44}
        tone="surface"
        accessibilityLabel="Settings"
        onPress={onSettings}
      />
    </View>
  );
}

/**
 * The search pill (L245-248) — as a BUTTON, not an input.
 *
 * The artboard binds this to the same `{{ search }}` state Explore uses, and
 * Explore is where the real query, the real results and the invite-code field
 * already live. So this keeps the artboard's shape and hands the tap to the
 * screen that can answer it, rather than growing a second search implementation
 * on the Feed. It is announced as a button, so nothing about it is a pretence.
 */
function SearchLink({ onPress }: { onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search lounges, people and tracks"
      onPress={onPress}
      style={({ pressed }) => [
        styles.search,
        { backgroundColor: pressed ? C.surface2 : C.surface, borderColor: C.rule },
      ]}>
      <Search size={18} strokeWidth={2} color={C.ink3} />
      <Text numberOfLines={1} style={[styles.searchLabel, { color: C.ink3 }]}>
        Search lounges, people, tracks
      </Text>
    </Pressable>
  );
}

/**
 * A section rule (L250-253, L275-278): a title with either a link or a live
 * count on the right.
 *
 * The two trailing slots are different registers and never both appear: a link
 * is an ACTION and takes `priTint`, a count is a STATE of the world and takes
 * coral. That is the whole accent rule in one row.
 */
function SectionHeader({
  title,
  action,
  count,
  style,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  count?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useColors();

  return (
    <View style={[styles.section, style]}>
      <Text style={[styles.sectionTitle, { color: C.ink }]}>{title}</Text>

      {action ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.sectionLink, pressed && styles.pressed]}>
          <Text style={[styles.sectionLinkLabel, { color: C.priTint }]}>{action.label}</Text>
        </Pressable>
      ) : count ? (
        <Text style={[styles.sectionCount, { color: C.liveText }]}>{count}</Text>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- lounge rail

/** A lounge, plus what presence currently says about it. */
type RailLounge = {
  id: string;
  name: string;
  /** People from this lounge on the Feed right now. */
  online: number;
  /** How many of them are in a Session you could walk into. */
  live: number;
};

/**
 * One rail card (L256-267).
 *
 * The 4px stripe is the card's whole live signal, so it only goes coral when
 * the lounge actually has a Session running — a quiet lounge painted in the
 * accent is the exact lie the two-colour system exists to prevent. Quiet gets
 * `rule3`, which is an edge, not a state.
 */
function LoungeRailCard({ lounge, onOpen }: { lounge: RailLounge; onOpen: () => void }) {
  const C = useColors();
  const live = lounge.live > 0;

  const label = live
    ? `${lounge.name}, ${lounge.live} live`
    : `${lounge.name}, ${lounge.online} listening`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <GlassCard style={styles.railCard}>
        <View style={styles.railTop}>
          <View
            style={[
              styles.railBar,
              live
                ? {
                    backgroundColor: C.live,
                    /*
                      `0 0 12px var(--aux-live-m)` (L257). Centred, so `bloom()`
                      cannot stand in — every recipe in the theme offsets its
                      shadow downward and this has to sit around the stripe.
                    */
                    boxShadow: [
                      { offsetX: 0, offsetY: 0, blurRadius: 12, color: C.liveMid },
                    ],
                  }
                : { backgroundColor: C.rule3 },
            ]}
          />
          {/*
            Two lines, and that is what `RAIL_HEIGHT` is sized for. A third line
            would make one card taller than its neighbours, and a horizontal row
            of cards that disagree about height reads as a rendering fault.
          */}
          <Text numberOfLines={2} style={[styles.railName, { color: C.ink }]}>
            {lounge.name}
          </Text>
        </View>

        <View style={styles.railMeta}>
          <Text numberOfLines={1} style={[styles.railMembers, { color: C.ink3 }]}>
            {lounge.online > 0 ? `${lounge.online} on` : 'quiet'}
          </Text>
          {live ? (
            <Text style={[styles.railLive, { color: C.liveText }]}>{`${lounge.live} live`}</Text>
          ) : null}
        </View>
      </GlassCard>
    </Pressable>
  );
}

/**
 * The dashed NEW tile that closes the rail (L268).
 *
 * Hand-rolled rather than a `GlassCard`, because the whole point of it is that
 * it has NO fill and NO shadow — it is the outline of a card that does not
 * exist yet. (`borderStyle: 'dashed'` degrades to a solid hairline on some
 * Android builds when a radius is present; the outline still reads.)
 */
function NewLoungeTile({ onPress }: { onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create a lounge"
      onPress={onPress}
      style={({ pressed }) => [
        styles.railNew,
        { borderColor: pressed ? C.pill : C.rule3 },
        pressed && styles.pressed,
      ]}>
      <Plus size={20} strokeWidth={2} color={C.ink3} />
      <Text style={[styles.railNewLabel, { color: C.ink3 }]}>New</Text>
    </Pressable>
  );
}

/**
 * The rail itself (L255-269).
 *
 * `margin: 0 -18` in the artboard: it bleeds to the frame edge so the cards
 * run off the side rather than stopping short of it, which is what tells you
 * there is more to drag to. The negative margin plus matching content padding
 * is that, in React Native.
 */
function LoungeRail({
  lounges,
  onOpen,
  onCreate,
}: {
  lounges: RailLounge[];
  onOpen: (loungeId: string) => void;
  onCreate: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.railContent}>
      {lounges.map((lounge) => (
        <LoungeRailCard key={lounge.id} lounge={lounge} onOpen={() => onOpen(lounge.id)} />
      ))}
      <NewLoungeTile onPress={onCreate} />
    </ScrollView>
  );
}

// ------------------------------------------------------------------- the hero

/**
 * What the hero card is showing.
 *
 * `mine` is a Session I am already inside — the card becomes the way back into
 * it, and the readout reports my own sync rather than a head count. `join` is
 * somebody else's, reconstructed entirely from their presence beat.
 */
type Hero =
  | {
      kind: 'mine';
      roomId: string;
      loungeId: string;
      loungeName: string;
      who: string;
      title: string;
      artist: string;
      artworkUrl: string | null;
      durationMs: number;
      timeline: RoomTimeline;
    }
  | {
      kind: 'join';
      roomId: string;
      loungeId: string;
      loungeName: string;
      who: string;
      title: string;
      artist: string;
      artworkUrl: string | null;
      durationMs: number;
      entry: FeedEntry;
    };

/**
 * The hook: what is playing right now that you can walk into.
 *
 * THE ACCENT RULE, DRAWN OUT, because this one card carries every register:
 *   the LIVE badge is coral        — a state of the world
 *   the progress bar is coral      — something is playing, which is also state
 *   the lounge link is `priTint`   — an action, at link volume
 *   the Join CTA is the blue pill  — the action this card is asking for
 * No element is painted in both. Repainting the CTA coral because the session
 * is live is the mistake this comment exists to prevent.
 */
function HeroCard({
  hero,
  listeners,
  onOpenRoom,
  onOpenLounge,
}: {
  hero: Hero;
  listeners: number;
  onOpenRoom: (roomId: string) => void;
  onOpenLounge: (loungeId: string) => void;
}) {
  const C = useColors();
  const nowMs = useFeedClock();
  const driftMs = usePlayback((state) => state.driftMs);
  const isSynced = usePlayback((state) => state.isSynced);

  const mine = hero.kind === 'mine';

  /*
    `expectedPositionMs` measures from the room's start stamp and keeps counting
    past the end of the track — the room row simply has not been advanced yet —
    so the readout is clamped to the duration rather than reporting 9:31 of a
    3:12 song. `livePositionMs` already clamps itself.
  */
  const raw = mine ? expectedPositionMs(hero.timeline, nowMs) : livePositionMs(hero.entry, nowMs);

  const positionMs = hero.durationMs > 0 ? Math.min(hero.durationMs, Math.max(0, raw)) : 0;
  const progress = hero.durationMs > 0 ? positionMs / hero.durationMs : 0;

  /*
    The centre readout is the only place the two kinds diverge in meaning: my
    own Session can report the sync the controller is actually measuring, while
    somebody else's can only honestly report how many of my lounge-mates are in
    it. IN SYNC is a state, so it — and only it — takes the coral.
  */
  const synced = mine && isSynced;
  const centre = mine
    ? isSynced
      ? 'IN SYNC'
      : `${driftMs > 0 ? '+' : ''}${Math.round(driftMs)}MS`
    : `${listeners} LISTENING`;

  return (
    <GlassCard style={[styles.hero, raisedLarge(C)]}>
      <View style={styles.heroHead}>
        <StatusPill label="live" tone="liveWash" dot live />

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${hero.loungeName}`}
          onPress={() => onOpenLounge(hero.loungeId)}
          style={({ pressed }) => [styles.loungeLink, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={[styles.loungeLinkLabel, { color: C.priTint }]}>
            {hero.loungeName}
          </Text>
          <ChevronRight size={14} strokeWidth={2.5} color={C.priTint} />
        </Pressable>
      </View>

      <View style={styles.heroTop}>
        {/*
          A WELL, not a plate. Artwork inverted in this direction: a dark recess
          carrying a faint `artInk` monogram. Any code assuming a bright tile —
          dark ink on it, a light border — is now wrong.
        */}
        <View style={[styles.art, { backgroundColor: C.artwork, borderColor: C.rule }]}>
          <Text style={[styles.artGlyph, { color: C.artInk }]}>{glyphFor(hero.title)}</Text>

          {/* Over the glyph, so the letter doubles as the error fallback. */}
          {hero.artworkUrl ? (
            <Image
              source={{ uri: hero.artworkUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={Duration.press}
              accessible={false}
            />
          ) : null}
        </View>

        <View style={styles.heroInfo}>
          <Text numberOfLines={1} style={[styles.heroKicker, { color: C.ink3 }]}>
            {mine ? "you're on aux" : `@${hero.who} is on aux`}
          </Text>
          <Text numberOfLines={1} style={[styles.heroTitle, { color: C.ink }]}>
            {hero.title}
          </Text>
          {hero.artist ? (
            <Text numberOfLines={1} style={[styles.heroArtist, { color: C.ink2 }]}>
              {hero.artist}
            </Text>
          ) : null}
        </View>
      </View>

      {/*
        6px rather than the list's 4: this is the one bar on the screen anyone
        reads a position off, and the coral bleed under it is what makes it
        register as running rather than drawn. No thumb — nobody scrubs another
        room's playhead from the Feed.
      */}
      <ProgressBar progress={progress} height={6} glow style={styles.heroBar} />

      <View style={styles.readout}>
        <Text style={[styles.readoutSide, { color: C.ink2 }]}>{timecode(positionMs)}</Text>
        <Text style={[styles.readoutCentre, { color: synced ? C.liveText : C.ink2 }]}>
          {centre}
        </Text>
        <Text style={[styles.readoutSide, { color: C.ink2 }]}>{timecode(hero.durationMs)}</Text>
      </View>

      <View style={styles.heroAction}>
        <AuxButton
          label={mine ? 'Back to session' : 'Join session'}
          onPress={() => onOpenRoom(hero.roomId)}
          variant="pri"
          size="lg"
          shape="pill"
          align="center"
          icon={Play}
          fullWidth
        />
      </View>
    </GlassCard>
  );
}

// -------------------------------------------------------------- the end card

/**
 * The card that closes the Feed (L302-317).
 *
 * It is always here, exactly as the artboard has it, and that is what retires
 * the old "Nobody is on right now" empty state: the answer to an empty Feed and
 * the answer to a busy one are the same verb, so the screen offers it once,
 * in one place, and only changes what it says above the button.
 *
 * The blue corner bleed is `GlassCard glow="pri"` — blue because this card is
 * something you DO. A coral bleed here would claim the room is already live.
 */
function StartSessionCard({
  roster,
  quiet,
  onStart,
}: {
  /** Real faces from presence, not decoration — these are the people who would hear it. */
  roster: FeedEntry[];
  /** Nobody is on. Changes the pitch, not the offer. */
  quiet: boolean;
  onStart: () => void;
}) {
  const C = useColors();

  return (
    <GlassCard glow="pri" style={styles.promo}>
      <Text style={[styles.promoKicker, { color: C.ink3 }]}>
        {quiet ? 'nobody is on right now' : 'the aux is open'}
      </Text>
      <Text style={[styles.promoTitle, { color: C.ink }]}>Start a Session</Text>
      <Text style={[styles.promoBody, { color: C.ink2 }]}>
        {quiet
          ? 'Put something on and your lounges will see it the moment it goes live.'
          : 'Pick a track and everyone who joins hears it at the same millisecond.'}
      </Text>

      <View style={styles.promoRow}>
        <AuxButton
          label="You're on aux"
          onPress={onStart}
          variant="pri"
          size="sm"
          shape="pill"
          align="center"
        />

        {roster.length > 0 ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.stack}>
            {roster.map((person) => (
              /*
                The ring is the GROUND colour, per the artboard — it reads as
                each face punched out of the one behind it. Over a translucent
                card it is a shade darker than the fill, which is what separates
                them; a `surface` ring would composite twice and go pale.
              */
              <View
                key={person.userId}
                style={[styles.stackRing, { borderColor: C.bg }]}>
                <Avatar uri={person.avatarUrl} name={person.displayName} size={26} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}

// ------------------------------------------------------------------ list parts

const keyExtractor = (entry: FeedEntry) => entry.userId;

/**
 * Every module enters the same way: translateY(8) → 0 over 280ms on the
 * design's curve, and nothing at all when the OS asks for reduced motion.
 *
 * A shared value driven from an effect, NOT a Reanimated layout animation:
 * `entering=` marks the view `visibility: hidden` until the animation runs, and
 * on react-native-web it never runs — leaving the whole Feed permanently
 * invisible while reporting perfectly correct colour, size and layout.
 */
function useModuleEnter() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return;
    }
    t.value = withTiming(1, {
      duration: Duration.enter,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
    });
  }, [reduced, t]);

  return useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 8 }],
  }));
}

/**
 * The hero's own loading twin — badge row, artwork well, two lines, the bar,
 * the readout, the CTA. The hero is the tallest thing on the screen, so
 * leaving it out of the skeleton is what makes the Feed jump when data lands.
 */
function HeroSkeleton() {
  return (
    <GlassCard style={styles.hero}>
      <View style={styles.heroHead}>
        <Skeleton width={62} height={24} radius={Radii.pill} />
        <Skeleton width={84} height={14} />
      </View>

      <View style={styles.heroTop}>
        <Skeleton width={ART} height={ART} />
        <View style={styles.skeletonInfo}>
          <Skeleton width="46%" height={10} />
          <Skeleton width="82%" height={20} />
          <Skeleton width="60%" height={12} />
        </View>
      </View>

      <Skeleton width="100%" height={6} style={styles.heroBar} />

      <View style={styles.readout}>
        <Skeleton width={34} height={11} />
        <Skeleton width={62} height={11} />
        <Skeleton width={34} height={11} />
      </View>

      <Skeleton width="100%" height={54} radius={Radii.pill} style={styles.heroAction} />
    </GlassCard>
  );
}

/** The rail at the geometry it will have once it arrives. */
function RailSkeleton() {
  return (
    <View style={styles.railSkeleton}>
      {SKELETON_RAIL.map((card) => (
        <Skeleton key={card} width={RAIL_CARD} height={RAIL_HEIGHT} radius={CARD_RADIUS} />
      ))}
    </View>
  );
}

/** The live list, same. */
function RowsSkeleton() {
  return (
    <View>
      {SKELETON_ROWS.map((row) => (
        <GlassCard key={row} variant="row" style={styles.skeletonRow}>
          <Skeleton width={52} height={52} />
          <View style={styles.skeletonRowInfo}>
            <Skeleton width="58%" height={13} />
            <Skeleton width="80%" height={11} />
          </View>
        </GlassCard>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ the screen

export default function FeedScreen() {
  const C = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const moduleStyle = useModuleEnter();
  const dockReserve = useDockReserve();

  const [refreshing, setRefreshing] = useState(false);

  // Read once at mount. Re-reading the clock every render would flip the
  // greeting mid-scroll at 11:59, which is the one moment anyone would notice.
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);

  const identity = useMemo<PresenceIdentity | null>(
    () =>
      profile
        ? {
            userId: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
            spotifyLinked: profile.spotify_linked,
          }
        : null,
    [profile]
  );

  const lounges = useMyLounges(profile?.id);
  const sessions = useMySessions(profile?.id);

  const loungeList = useMemo<LoungeRef[]>(() => lounges.data ?? [], [lounges.data]);
  const sessionList = useMemo<ActiveSession[]>(() => sessions.data ?? [], [sessions.data]);
  const loungeIds = useMemo(() => loungeList.map((lounge) => lounge.id), [loungeList]);
  const loungeNames = useMemo(
    () => new Map(loungeList.map((lounge) => [lounge.id, lounge.name])),
    [loungeList]
  );

  /**
   * What Aux is playing for me, read from the live playback store rather than
   * the Sessions query.
   *
   * The query is a snapshot taken when this screen mounted; the store is the
   * thing actually driving the speaker, so it flips the instant I join or leave
   * a Session instead of leaving my friends looking at a room I walked out of.
   */
  const playbackRoomId = usePlayback((state) => state.roomId);
  const playbackTrack = usePlayback((state) => state.track);
  const playbackTimeline = usePlayback((state) => state.timeline);
  const playbackProvider = usePlayback((state) => state.adapter?.provider ?? null);

  const localNowPlaying = useMemo<LocalNowPlaying | null>(() => {
    if (!playbackTrack || !playbackTimeline) return null;

    return {
      trackTitle: playbackTrack.title,
      artist: playbackTrack.artist,
      artworkUrl: playbackTrack.artwork_url,
      // The adapter that is actually producing sound, not what the profile says
      // it could be: a linked *free* account still routes to YouTube, and a
      // Spotify badge over YouTube audio is a lie the Feed cannot back up.
      provider: playbackProvider ?? 'youtube',
      durationMs: playbackTrack.duration_ms,
      roomId: playbackRoomId,
      timeline: playbackTimeline,
    };
  }, [playbackTrack, playbackTimeline, playbackProvider, playbackRoomId]);

  useBroadcastPresence(identity, loungeIds, localNowPlaying);

  // My own row is redundant: the hero card already says where I am, and a Feed
  // that leads with yourself is a mirror, not a party.
  const { entries, ready } = useLoungePresence(loungeList, profile?.id);

  const openRoom = useCallback(
    (roomId: string) => router.push({ pathname: '/room/[id]', params: { id: roomId } }),
    [router]
  );

  const openLounge = useCallback(
    (loungeId: string) => router.push({ pathname: '/lounge/[id]', params: { id: loungeId } }),
    [router]
  );

  const openProfile = useCallback(() => router.push('/profile'), [router]);
  const openSettings = useCallback(() => router.push('/settings'), [router]);
  const openExplore = useCallback(() => router.push('/explore'), [router]);
  /** The only route to `/lounges` left in the shell — the nav capsule dropped its cell. */
  const openMyLounges = useCallback(() => router.push('/lounges'), [router]);
  const createLounge = useCallback(() => router.push('/lounge/create'), [router]);
  const startSession = useCallback(() => router.push('/room/create'), [router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // The Feed itself is pushed over the socket and needs nothing. What can
      // go stale is the lounge and Session lists behind it, and the clock
      // offset every progress bar is measured against.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_LOUNGES_KEY }),
        queryClient.invalidateQueries({ queryKey: [MY_SESSIONS_KEY] }),
        syncClock(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const showSkeleton = lounges.isPending || (!ready && !lounges.isError);

  /**
   * The head count on the hero is "people from your lounges who are in that
   * Session", which is the only one presence can honestly produce — the room's
   * own participant list is not on the socket.
   */
  const listenersByRoom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.roomId === null) continue;
      counts.set(entry.roomId, (counts.get(entry.roomId) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  /**
   * The rail's counts, folded out of the same presence stream the list uses
   * rather than fetched.
   *
   * `entries` is deduplicated by PERSON — somebody in three of my lounges is
   * tagged with one of them — so these are "people showing on the Feed under
   * this lounge", not its membership. That is what the labels say: "3 on", not
   * "3 members". A member count would need its own query per lounge.
   */
  const railLounges = useMemo<RailLounge[]>(
    () =>
      loungeList.map((lounge) => {
        let online = 0;
        let live = 0;
        for (const entry of entries) {
          if (entry.loungeId !== lounge.id) continue;
          online += 1;
          if (entry.roomId !== null) live += 1;
        }
        return { id: lounge.id, name: lounge.name, online, live };
      }),
    [entries, loungeList]
  );

  const hero = useMemo<Hero | null>(() => {
    // A Session I am already inside wins the card: it becomes the way back in.
    const mine =
      (playbackRoomId ? sessionList.find((s) => s.roomId === playbackRoomId) : undefined) ??
      sessionList.find((s) => s.timeline.isPlaying) ??
      sessionList[0];

    if (mine) {
      const attached = playbackRoomId === mine.roomId;
      const track =
        attached && playbackTrack
          ? {
              title: playbackTrack.title,
              artist: playbackTrack.artist,
              artworkUrl: playbackTrack.artwork_url,
              durationMs: playbackTrack.duration_ms,
            }
          : mine.track;

      return {
        kind: 'mine',
        roomId: mine.roomId,
        loungeId: mine.loungeId,
        loungeName: loungeNames.get(mine.loungeId) ?? mine.name,
        who: 'you',
        title: track?.title ?? mine.name,
        artist: track?.artist ?? '',
        artworkUrl: track?.artworkUrl ?? null,
        durationMs: track?.durationMs ?? 0,
        timeline: attached && playbackTimeline ? playbackTimeline : mine.timeline,
      };
    }

    const joinable = entries.find((e) => e.roomId !== null && e.trackTitle !== null);
    if (!joinable || joinable.roomId === null) return null;

    return {
      kind: 'join',
      roomId: joinable.roomId,
      loungeId: joinable.loungeId,
      loungeName: joinable.loungeName,
      who: joinable.username,
      title: joinable.trackTitle ?? joinable.loungeName,
      artist: joinable.artist ?? '',
      artworkUrl: joinable.artworkUrl,
      durationMs: joinable.durationMs,
      entry: joinable,
    };
  }, [entries, loungeNames, playbackRoomId, playbackTimeline, playbackTrack, sessionList]);

  /**
   * Live cards first, then the flat rows — the design's two loops. The hero's
   * own person is dropped so the same beat is not drawn twice.
   */
  const rows = useMemo(() => {
    const heroUser = hero && hero.kind === 'join' ? hero.entry.userId : null;
    const visible = entries.filter((entry) => entry.userId !== heroUser);
    return [
      ...visible.filter((entry) => entry.roomId !== null),
      ...visible.filter((entry) => entry.roomId === null),
    ];
  }, [entries, hero]);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<FeedEntry>) => (
      <NowPlayingCard entry={item} index={index} />
    ),
    []
  );

  /** The count beside "Live now" — coral, because it reports the world, not a control. */
  const liveCount = useMemo(() => {
    const live = entries.filter((entry) => entry.roomId !== null).length;
    return live > 0 ? `${live} on aux` : `${entries.length} online`;
  }, [entries]);

  const name = profile?.display_name || profile?.username || 'You';

  /*
    The activity dot means "your lounges can see what you are playing right
    now" — the profile toggle AND something actually coming out of the speaker.
    The artboard binds it to the toggle alone, which would leave it permanently
    lit for almost everybody and stop meaning anything.
  */
  const broadcasting = Boolean(profile?.show_activity) && localNowPlaying !== null;

  /*
    Composed inline rather than behind a `useMemo`.

    A FlatList reconciles its header by element TYPE, so a fresh element each
    render costs a re-render of the header and nothing else — and the header
    depends on nearly every value on this screen, so hoisting it meant a
    fourteen-entry dependency list that had to be right or the live counts went
    stale. The compiler memoises what is worth memoising underneath.
  */
  const header = (
    <View>
      <SearchLink onPress={openExplore} />

      {hero ? (
        <HeroCard
          hero={hero}
          listeners={listenersByRoom.get(hero.roomId) ?? 1}
          onOpenRoom={openRoom}
          onOpenLounge={openLounge}
        />
      ) : showSkeleton ? (
        <HeroSkeleton />
      ) : null}

      <SectionHeader
        title="Your lounges"
        action={{ label: 'See all', onPress: openMyLounges }}
      />

      {showSkeleton ? (
        <RailSkeleton />
      ) : lounges.isError ? (
        <EmptyState
          icon={WifiOff}
          title="Could not load your lounges"
          description="Check your connection."
          primary={{ label: 'Try again', onPress: () => void onRefresh() }}
        />
      ) : loungeList.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No lounges yet"
          description="Create one, or join with a code."
          primary={{ label: 'Find a lounge', onPress: openExplore }}
          secondary={{ label: 'Create one', onPress: createLounge }}
        />
      ) : (
        <LoungeRail lounges={railLounges} onOpen={openLounge} onCreate={createLounge} />
      )}

      {showSkeleton || rows.length > 0 ? (
        <SectionHeader
          title="Live now"
          count={showSkeleton ? undefined : liveCount}
          // The rail already paid 20px of clearance for its own shadow, so this
          // header takes the remainder of the artboard's 24 rather than all of it.
          style={styles.sectionAfterRail}
        />
      ) : null}
    </View>
  );

  return (
    /*
      `ground={false}`: the ambient blobs are mounted ONCE behind the tab
      navigator, and every card on this screen is 5.5% white composited over
      them. An opaque screen background would cover the blobs and collapse the
      whole surface stack to one flat grey.
    */
    <Screen padded={false} ground={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <Masthead
          name={name}
          avatarUrl={profile?.avatar_url ?? null}
          greeting={greeting}
          broadcasting={broadcasting}
          onProfile={openProfile}
          onSettings={openSettings}
        />

        <FlatList
          data={showSkeleton ? [] : rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={showSkeleton ? <RowsSkeleton /> : null}
          ListFooterComponent={
            showSkeleton ? null : (
              <StartSessionCard
                roster={entries.slice(0, 4)}
                quiet={rows.length === 0 && hero === null}
                onStart={startSession}
              />
            )
          }
          // The masthead is a sibling now rather than part of the header, so the
          // list is one of two children in a column and has to claim the rest of
          // it explicitly — without this it sizes to its content and stops
          // scrolling once the Feed is longer than the screen.
          style={styles.flex}
          /*
            The dock reservation is inline because it depends on the device's
            bottom inset, which a StyleSheet object cannot carry — that is
            exactly how the old static `Dock.reserve` came to under-reserve here.
          */
          contentContainerStyle={[styles.content, { paddingBottom: dockReserve }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={C.ink2}
              colors={[C.live]}
              progressBackgroundColor={C.surfaceSolid}
            />
          }
        />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  /* `paddingBottom` is applied at the call site — see the note at the FlatList. */
  content: {
    paddingTop: Space.xs,
    paddingHorizontal: GUTTER,
    flexGrow: 1,
  },
  pressed: {
    opacity: 0.7,
  },

  /* ------------------------------------------------------------- masthead */

  /** L232: `padding:12px 18px 10px`, row, gap 12. */
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingTop: Space.md,
    paddingBottom: 10,
    paddingHorizontal: GUTTER,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  greeting: {
    ...Type.body(12),
  },
  name: {
    ...Type.display(22),
    letterSpacing: tracking(22, -0.02),
  },

  /* --------------------------------------------------------------- search */

  /** L245: a 50px pill of glass. The edge is what makes it an object at 5.5% fill. */
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  searchLabel: {
    ...Type.body(15),
    flex: 1,
  },

  /* -------------------------------------------------------------- section */

  section: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: 22,
    marginBottom: Space.md,
  },
  sectionAfterRail: {
    marginTop: Space.xs,
  },
  sectionTitle: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: tracking(17, -0.01),
    flexShrink: 1,
  },
  /** 44 tall and 60 wide even though the label is 12px — it is still a target. */
  sectionLink: {
    minHeight: TOUCH_TARGET,
    minWidth: 60,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sectionLinkLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 15,
  },
  sectionCount: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },

  /* ----------------------------------------------------------- lounge rail */

  /** The bleed: out past the gutter, then back in via the content padding. */
  rail: {
    marginHorizontal: -GUTTER,
  },
  railContent: {
    paddingHorizontal: GUTTER,
    paddingTop: 2,
    paddingBottom: RAIL_TAIL,
    gap: RAIL_GAP,
  },
  railSkeleton: {
    flexDirection: 'row',
    gap: RAIL_GAP,
    paddingBottom: RAIL_TAIL,
  },
  /*
    A FIXED floor, not `flex: 1`.

    The obvious way to make rail cards agree on height is to stretch them, and
    it silently collapses the whole rail: a `flex: 1` child inside an
    auto-height parent measures its hypothetical size as ZERO, so the row's
    cross size comes out as the height of the dashed tile and every card is
    clipped to ~40px. A floor tall enough for the two-line name is definite at
    measure time, so the cards match and the tile stretches to them.
  */
  railCard: {
    width: RAIL_CARD,
    minHeight: RAIL_HEIGHT,
    /* Pins the meta row to the bottom edge when the name only takes one line. */
    justifyContent: 'space-between',
  },
  railTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  railBar: {
    width: 4,
    height: 34,
    borderRadius: Radii.pill,
  },
  railName: {
    fontFamily: Fonts.extrabold,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: tracking(14, -0.01),
    flex: 1,
    minWidth: 0,
  },
  railMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginTop: 14,
  },
  railMembers: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.07),
    flexShrink: 1,
  },
  railLive: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.07),
    textTransform: 'uppercase',
  },
  railNew: {
    width: RAIL_NEW,
    borderRadius: CARD_RADIUS,
    borderWidth: Rule.hair,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  railNewLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.08),
    textTransform: 'uppercase',
  },

  /* ----------------------------------------------------------- hero card */

  hero: {
    marginTop: Space.md,
  },
  heroHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginBottom: Space.md,
  },
  loungeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: TOUCH_TARGET,
    /* Grows the target upward and downward without adding row height. */
    marginVertical: -10,
    flexShrink: 1,
  },
  loungeLinkLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.04),
    flexShrink: 1,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: Radii.xl,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artGlyph: {
    fontFamily: Fonts.extrabold,
    fontSize: 30,
    lineHeight: 34,
  },
  heroInfo: {
    flex: 1,
    minWidth: 0,
  },
  heroKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.14),
  },
  heroTitle: {
    ...Type.display(21),
    letterSpacing: tracking(21, -0.025),
    marginTop: 5,
  },
  heroArtist: {
    ...Type.body(13),
    marginTop: 2,
  },
  heroBar: {
    /* The bar's own bleed needs air; at Space.md the coral touches the artist line. */
    marginTop: Space.lg,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  readoutSide: {
    ...readout(11.5),
    fontFamily: Fonts.semibold,
  },
  readoutCentre: {
    ...readout(11.5),
  },
  heroAction: {
    marginTop: Space.lg,
  },

  /* ------------------------------------------------------------ end card */

  promo: {
    marginTop: Space.lg,
  },
  promoKicker: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.12),
    textTransform: 'uppercase',
  },
  promoTitle: {
    ...Type.display(22),
    lineHeight: 25,
    letterSpacing: tracking(22, -0.02),
    marginVertical: Space.sm,
  },
  promoBody: {
    ...Type.body(14),
    lineHeight: 22,
  },
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Space.lg,
    flexWrap: 'wrap',
  },
  stack: {
    flexDirection: 'row',
    /*
      Cancels the FIRST ring's overlap. The artboard puts `margin-left:-8` on
      every face including the leading one, which eats 8 of the row's 10px gap
      and leaves the stack all but touching the button.
    */
    paddingLeft: 8,
  },
  stackRing: {
    borderRadius: Radii.pill,
    borderWidth: 2,
    marginLeft: -8,
  },

  /* ---------------------------------------------------------- skeletons */

  skeletonInfo: {
    flex: 1,
    gap: Space.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 9,
  },
  skeletonRowInfo: {
    flex: 1,
    gap: Space.sm,
  },
});
