/**
 * The Feed — the screen the app opens on, and the first thing anyone judges.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` L231-L320 (`isFeed`) and,
 * this pass, from the user's own capture of that prototype running. Top to
 * bottom it is exactly what that screenshot shows:
 *
 *   the masthead   — gradient identity avatar with its presence dot, a small
 *                    grey greeting over the bold name, a quiet settings gear
 *   the search     — one full-width recessed pill with a magnifier
 *   Your lounges   — a heading with a BLUE "See all", then a rail of cards that
 *                    bleeds off the right edge; each card a coral bar down its
 *                    left side, the name in bold caps, "128 MEMBERS" in grey
 *                    beside "4 LISTENING" in coral
 *   Live now       — a heading with "4 PEOPLE LISTENING RIGHT NOW" in coral,
 *                    then the column of glass cards `NowPlayingCard` draws
 *
 * === THE ACCENT RULE ON THIS SCREEN, WITH THE CORRECTION IT NOW CARRIES ===
 *
 * An earlier pass ruled that every button was blue because "blue is action",
 * and pushed Join to blue. That ruling is reversed. Coral owns state AND
 * live-entry, because entering something that is live is the one action whose
 * subject is the state itself. On this screen:
 *
 *   BLUE  — the "See all" link and the create FAB in the nav capsule, plus the
 *           "You're on aux" button on the closing card, which is a CREATE.
 *   CORAL — the live dots, the rail stripes, every LISTENING count, the
 *           progress fills, JOIN / SOLO, and the resume card's own CTA.
 *
 * === FOUR DELIBERATE DEVIATIONS, ALL FOR THE SAME REASON — the screenshot is
 * a picture of one state and this screen has several ===
 *
 * 1. THE HERO CARD IS NOW A RESUME CARD, AND ONLY APPEARS WHEN THE SESSION IS
 *    MINE. It used to also render somebody ELSE'S live Session as a full-width
 *    hero, and then filter that person out of the list below — so the busiest
 *    row on the Feed was promoted out of the Feed. That is why the screenshot
 *    has no hero: nothing there is yours. What the hero was actually load
 *    bearing for is getting BACK into a Session you are already in and reading
 *    your own sync, and neither of those has anywhere else to live, so that
 *    half stays. Somebody else's Session is now just a row with a coral JOIN
 *    on it, which is what the design draws. `useMySessions` is unchanged.
 * 2. THE SEARCH FIELD IS A REAL INPUT AND IT SITS OUTSIDE THE SCROLLER. The
 *    artboard scrolls it away with the body; as a `ListHeaderComponent` a
 *    controlled `TextInput` drops the keyboard mid-word every time the list
 *    re-renders, which is the lesson `(tabs)/explore.tsx` already paid for. So
 *    it is pinned under the masthead. What it searches is documented on
 *    `SearchField` — read that before assuming it reaches a backend.
 * 3. The waveform is gone. It belonged to design/v2; nocturne has no waveform
 *    anywhere and draws playback as the coral gradient bar `ProgressBar` is.
 * 4. "See all" points at `/lounges`, not Explore. The artboard sends it to
 *    Explore, but in this app `/lounges` is "the lounges I am in" and it lost
 *    its nav cell when Messages took the slot. This link is the only way to
 *    that screen, which makes the rail below it load-bearing rather than
 *    decoration.
 *
 * Everything here is still push-driven: the rows arrive over Realtime presence,
 * and the queries are the three slow-moving lists behind them (my lounges, the
 * member counts on them, my Sessions). Rows are filtered to lounges I am
 * actually a member of, which falls out of `useMyLounges` driving both the
 * subscription and the list.
 */

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ChevronRight,
  Play,
  Plus,
  Search,
  Settings,
  Users,
  WifiOff,
  X,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

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
import { loungeKeys, useMyLounges as useMyLoungeSummaries } from '@/features/lounges/queries';
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
import { useEntrance } from '@/lib/entrance';
import { supabase } from '@/lib/supabase';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  pressedSoft,
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

/** The resume card's artwork well. The artboard's largest art tile is 54; a hero earns 78. */
const ART = 78;

/** L245: `min-height:50px` on the search pill. */
const SEARCH_HEIGHT = 50;

/**
 * L256/L268: a 108px dashed NEW tile, 12 apart from cards the artboard sets at
 * 172. The card is WIDER here — 200 — because its meta line now carries the two
 * readouts the user's screenshot asks for side by side ("128 MEMBERS" beside
 * "4 LISTENING"), and at 172 the second one wraps or truncates on the first
 * lounge with a three-digit membership. The rail bleeds off the frame either
 * way, so the only thing 172 was buying was a sliver more of the next card.
 */
const RAIL_CARD = 200;
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
 * The rail card's floor: 16 padding, two 16px lines of name, 14, the 13px meta
 * line, 16 padding. See the note on `styles.railCard` for why this is a number
 * and not `flex: 1`.
 */
const RAIL_HEIGHT = 96;

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

// --------------------------------------------------------------------- search

/**
 * The search pill (L245-248) — a REAL input, and it is worth being precise
 * about what it can and cannot reach.
 *
 * WHAT IT SEARCHES: everything the Feed already holds — the names of the
 * lounges on the rail, and the people, tracks, artists and lounges on the live
 * rows. That is a genuine filter over real data, applied locally with no round
 * trip, and it is instant because presence has already pushed all of it.
 *
 * WHAT IT DOES NOT SEARCH, AND THIS IS THE REPORTED GAP: there is no server-
 * side search endpoint for people or tracks in this app at all, and the one
 * search that does exist — `usePublicLounges` behind `(tabs)/explore.tsx` —
 * takes its query from its own local state and reads no route param. So the
 * "Search every lounge" action below a no-results state opens Explore but
 * CANNOT carry the typed text with it; the field there starts empty. Giving
 * Explore a `q` param is a one-line change in a file this pass does not own.
 * Nothing here fabricates a result to cover that.
 *
 * A WELL, NOT GLASS. The user's screenshot draws this recessed, and the kit's
 * doctrine agrees: an input is cut INTO the page (`bgRecessed`, darker than the
 * ground) while a card sits ON it. That contrast is also what lets the glass
 * cards below read as glass — a screen of nothing but translucent surfaces has
 * nothing to be translucent against. `(tabs)/explore.tsx` deliberately makes
 * the opposite call for its own pill, where the field is chrome in a column of
 * chrome rather than the one input on a page of cards.
 */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const clear = useCallback(() => onChange(''), [onChange]);

  return (
    <View
      style={[
        styles.search,
        pressedSoft(C),
        { backgroundColor: C.bgRecessed, borderColor: focused ? C.rule3 : C.rule },
      ]}>
      <Search size={18} strokeWidth={2} color={C.ink3} />

      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search lounges, people, tracks"
        // Explicit: RN's platform default is a mid grey that measures under 3:1
        // on this ground, and `ink3` is the token that was raised to clear AA.
        placeholderTextColor={C.ink3}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search lounges, people and tracks"
        // Blue, matching Explore's field: a caret marks something you are
        // DOING. Coral here would announce a live state and spend the accent
        // that means it.
        selectionColor={C.pill}
        style={[styles.searchInput, { color: C.ink }]}
      />

      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={clear}
          hitSlop={12}
          style={({ pressed }) => [pressed && styles.pressed]}>
          <X size={17} strokeWidth={2.4} color={C.ink3} />
        </Pressable>
      ) : null}
    </View>
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
        <Text numberOfLines={1} style={[styles.sectionCount, { color: C.liveText }]}>
          {count}
        </Text>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- lounge rail

/** A lounge, plus what the roster and presence currently say about it. */
type RailLounge = {
  id: string;
  name: string;
  /** From the membership query. Null while it is still in flight — never guessed. */
  members: number | null;
  /** People from this lounge audible on the Feed right now. */
  online: number;
  /** How many of them are in a Session you could walk into. */
  live: number;
};

/**
 * One rail card (L256-267), as the user's screenshot draws it: a coral bar down
 * the left edge, the name in bold caps, and under it the membership in grey
 * beside the live count in coral.
 *
 * THE BAR IS CORAL ON EVERY CARD, AND THAT REVERSES A RULING HERE. It used to
 * go `rule3` on a quiet lounge, on the argument that "a quiet lounge painted in
 * the accent is the exact lie the two-colour system exists to prevent". Both
 * the artboard (L257 hardcodes `--aux-live`) and the screenshot paint every
 * stripe coral, and they are right for a reason the old note missed: the stripe
 * is the lounge's own mark, not a claim about it. What carries the live signal
 * is the GLOW — `0 0 12px var(--aux-live-m)` only when there is actually a
 * Session running — so a live card's stripe is LIT and a quiet one's is not,
 * and the coral count beside it appears only when someone is really listening.
 * Nothing is painted in an accent it has not earned; the accent just stopped
 * being the only thing carrying the message.
 */
function LoungeRailCard({ lounge, onOpen }: { lounge: RailLounge; onOpen: () => void }) {
  const C = useColors();
  const live = lounge.live > 0;

  const label = [
    lounge.name,
    lounge.members === null ? null : `${lounge.members} members`,
    lounge.online > 0 ? `${lounge.online} listening` : null,
    live ? 'live session' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <GlassCard style={styles.railCard}>
        {/*
          A full-height stripe rather than the artboard's 34px stub — the
          screenshot runs it the whole way down the card's left edge, which is
          what makes a row of cards read as a shelf of spines. `alignSelf:
          'stretch'` keeps it inside the card's padding rather than against the
          radius, where `GlassCard`'s unclipped corner would let it poke out.
        */}
        <View
          style={[
            styles.railBar,
            { backgroundColor: C.live },
            live
              ? {
                  /*
                    Centred, so `bloom()` cannot stand in — every recipe in the
                    theme offsets its shadow downward and this has to sit
                    around the stripe.
                  */
                  boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 12, color: C.liveMid }],
                }
              : null,
          ]}
        />

        <View style={styles.railBody}>
          {/*
            Two lines, and that is what `RAIL_HEIGHT` is sized for. A third line
            would make one card taller than its neighbours, and a horizontal row
            of cards that disagree about height reads as a rendering fault.
          */}
          <Text numberOfLines={2} style={[styles.railName, { color: C.ink }]}>
            {lounge.name}
          </Text>

          <View style={styles.railMeta}>
            {lounge.members === null ? null : (
              <Text numberOfLines={1} style={[styles.railMembers, { color: C.ink3 }]}>
                {`${lounge.members} ${lounge.members === 1 ? 'member' : 'members'}`}
              </Text>
            )}
            {lounge.online > 0 ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.railLive,
                  { color: C.liveText },
                ]}>{`${lounge.online} listening`}</Text>
            ) : null}
          </View>
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
  /** Null while a search is filtering the rail — an outline of a card that does
   * not exist yet is not a search result. */
  onCreate: (() => void) | null;
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
      {onCreate ? <NewLoungeTile onPress={onCreate} /> : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------- the resume card

/**
 * A Session I am already inside.
 *
 * Only this shape survives. The card used to have a second one — somebody
 * else's Session, reconstructed from their presence beat — and rendering it
 * meant pulling that person out of the list below, so the single most
 * interesting row on the Feed was the one row the Feed did not show. It is a
 * row again, with a coral JOIN on it. See the file header.
 */
type Resume = {
  roomId: string;
  loungeId: string;
  loungeName: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  durationMs: number;
  timeline: RoomTimeline;
};

/**
 * The way back into the Session you are in, and the only surface that reports
 * your sync.
 *
 * CORAL, TOP TO BOTTOM, and that is the corrected rule doing its work: the LIVE
 * badge, the progress fill, the IN SYNC readout and the CTA all describe or
 * enter the same live thing. The lounge link is the one thing that is neither,
 * so it takes no accent at all — it used to be `priTint`, and blue on this
 * screen now belongs to "See all" and the create FAB alone.
 */
function ResumeCard({ resume, onOpenRoom, onOpenLounge }: {
  resume: Resume;
  onOpenRoom: (roomId: string) => void;
  onOpenLounge: (loungeId: string) => void;
}) {
  const C = useColors();
  const nowMs = useFeedClock();
  const driftMs = usePlayback((state) => state.driftMs);
  const isSynced = usePlayback((state) => state.isSynced);

  /*
    `expectedPositionMs` measures from the room's start stamp and keeps counting
    past the end of the track — the room row simply has not been advanced yet —
    so the readout is clamped to the duration rather than reporting 9:31 of a
    3:12 song.
  */
  const raw = expectedPositionMs(resume.timeline, nowMs);
  const positionMs = resume.durationMs > 0 ? Math.min(resume.durationMs, Math.max(0, raw)) : 0;
  const progress = resume.durationMs > 0 ? positionMs / resume.durationMs : 0;

  const centre = isSynced ? 'IN SYNC' : `${driftMs > 0 ? '+' : ''}${Math.round(driftMs)}MS`;

  return (
    <GlassCard style={[styles.resume, raisedLarge(C)]}>
      <View style={styles.resumeHead}>
        <StatusPill label="live" tone="liveWash" dot live />

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${resume.loungeName}`}
          onPress={() => onOpenLounge(resume.loungeId)}
          style={({ pressed }) => [styles.loungeLink, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={[styles.loungeLinkLabel, { color: C.ink2 }]}>
            {resume.loungeName}
          </Text>
          <ChevronRight size={14} strokeWidth={2.5} color={C.ink3} />
        </Pressable>
      </View>

      <View style={styles.resumeTop}>
        {/*
          A WELL, not a plate. Artwork inverted in this direction: a dark recess
          carrying a faint `artInk` monogram. Any code assuming a bright tile —
          dark ink on it, a light border — is now wrong.
        */}
        <View style={[styles.art, { backgroundColor: C.artwork, borderColor: C.rule }]}>
          <Text style={[styles.artGlyph, { color: C.artInk }]}>{glyphFor(resume.title)}</Text>

          {/* Over the glyph, so the letter doubles as the error fallback. */}
          {resume.artworkUrl ? (
            <Image
              source={{ uri: resume.artworkUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={Duration.press}
              accessible={false}
            />
          ) : null}
        </View>

        <View style={styles.resumeInfo}>
          <Text numberOfLines={1} style={[styles.resumeKicker, { color: C.ink3 }]}>
            you&apos;re on aux
          </Text>
          <Text numberOfLines={1} style={[styles.resumeTitle, { color: C.ink }]}>
            {resume.title}
          </Text>
          {resume.artist ? (
            <Text numberOfLines={1} style={[styles.resumeArtist, { color: C.ink2 }]}>
              {resume.artist}
            </Text>
          ) : null}
        </View>
      </View>

      {/*
        6px rather than the list's 4: this is the one bar on the screen anyone
        reads a position off, and the coral bleed under it is what makes it
        register as running rather than drawn. No thumb — nobody scrubs a room's
        playhead from the Feed.
      */}
      <ProgressBar progress={progress} height={6} glow style={styles.resumeBar} />

      <View style={styles.readout}>
        <Text style={[styles.readoutSide, { color: C.ink2 }]}>{timecode(positionMs)}</Text>
        <Text style={[styles.readoutCentre, { color: isSynced ? C.liveText : C.ink2 }]}>
          {centre}
        </Text>
        <Text style={[styles.readoutSide, { color: C.ink2 }]}>
          {timecode(resume.durationMs)}
        </Text>
      </View>

      <View style={styles.resumeAction}>
        {/*
          CORAL, not blue, and this is the correction the file header records:
          walking back into a Session is live-entry, which is the one action the
          state colour owns. `live` gives the coral fill under `onLive` — a warm
          near-black, because white on coral fails.
        */}
        <AuxButton
          label="Back to session"
          onPress={() => onOpenRoom(resume.roomId)}
          variant="live"
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
 * The blue corner bleed is `GlassCard glow="pri"`, and the button is blue too —
 * both correct under the corrected rule, which gives blue to CREATE. Starting a
 * Session is the one thing on this screen that makes something new rather than
 * entering something that already exists.
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
              <View key={person.userId} style={[styles.stackRing, { borderColor: C.bg }]}>
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

/** Everything the Feed already knows about a person, lowercased once per test. */
function matchesQuery(entry: FeedEntry, q: string): boolean {
  return (
    entry.username.toLowerCase().includes(q) ||
    entry.displayName.toLowerCase().includes(q) ||
    entry.loungeName.toLowerCase().includes(q) ||
    (entry.trackTitle?.toLowerCase().includes(q) ?? false) ||
    (entry.artist?.toLowerCase().includes(q) ?? false)
  );
}

/*
  ===================== HOW THIS SCREEN ARRIVES =====================

  There used to be a local `useModuleEnter` here — a shared value, an effect, a
  hardcoded 8px lift and a curve one control point off the design's — and two
  more copies of it in `explore.tsx` and `lounges.tsx`. It is `useEntrance` now.
  Two things that copy got wrong, neither fixable from inside this file:

    - it ran on MOUNT, and a tab navigator never unmounts its screens. So the
      Feed animated in exactly once per app launch and was dead silent on every
      return to the tab afterwards, which is precisely when the user was looking
      for it. `useEntrance` keys off focus and so replays.
    - it fell back to the navigator's cross-fade for everything else, so the
      whole screen dissolved in as one block.

  WHAT ANIMATES, AND WHAT DELIBERATELY DOES NOT.

  The design's grammar is one module arriving whole (`auxIn`), and then the rows
  INSIDE it arriving one after another (`auxRow`). This screen has four bands —
  the masthead, the search pill, the lounge rail, the live list — and animating
  four bands independently is how a screen ends up looking like it is assembling
  itself rather than arriving. So there is exactly one module and exactly one
  list:

    MODULE  the whole column: masthead, search field, list and all. One 10px
            lift, once, on entering the tab.
    ROWS    `NowPlayingCard`, staggered by its `index` at 55ms a step. This is
            the only genuine list on the screen and the thing the Feed is for —
            several cards landing in sequence with their timecodes already
            ticking is the screen explaining itself.

  Everything else rides the module. The rail is a second list, but it is
  horizontal and half of it is off the frame, so a cascade running sideways
  underneath the one running down would be two competing sequences; it arrives
  as one strip. The resume card is a single card and the one thing a user in a
  Session is actively waiting on — it gets no delay of its own. The skeletons
  never stagger for the same reason: nobody should wait longer for a placeholder.
*/

/*
  THERE IS NO SKELETON FOR THE RESUME CARD ANY MORE, AND THAT IS DELIBERATE.

  There used to be one, on the reasoning that the hero was the tallest thing on
  the screen and leaving it out of the skeleton made the Feed jump when data
  landed. That held while the card rendered for anybody's live Session. Now it
  renders only when the Session is MINE, which is the minority case by a long
  way — so a full-height placeholder on every cold start would be a phantom
  promising a card that usually never arrives, which is a worse lie than a
  reflow. The rail and the rows still have theirs.
*/

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
        <GlassCard key={row} style={styles.skeletonRow}>
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
  /* One arrival for the whole column — see the note above the skeletons. */
  const moduleStyle = useEntrance({ kind: 'module' });
  const dockReserve = useDockReserve();

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

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

  /*
    THE MEMBERSHIP COUNTS, AND WHY THIS IS NOT A NEW QUERY.

    The rail's grey readout is "128 MEMBERS", which presence cannot produce:
    `entries` is deduplicated by PERSON, so it counts people showing on the
    Feed, never a roster. The Lounges tab already fetches the real rosters
    through `useMyLounges` in '@/features/lounges/queries' — same cache key, so
    opening either screen warms the other and this costs nothing the second
    time. Aliased on import because the presence module exports a hook of the
    same name; the presence one still drives the subscriptions and the order.
  */
  const summaries = useMyLoungeSummaries();

  const loungeList = useMemo<LoungeRef[]>(() => lounges.data ?? [], [lounges.data]);
  const sessionList = useMemo<ActiveSession[]>(() => sessions.data ?? [], [sessions.data]);
  const loungeIds = useMemo(() => loungeList.map((lounge) => lounge.id), [loungeList]);
  const loungeNames = useMemo(
    () => new Map(loungeList.map((lounge) => [lounge.id, lounge.name])),
    [loungeList]
  );
  const memberCounts = useMemo(
    () => new Map((summaries.data ?? []).map((row) => [row.lounge.id, row.memberCount])),
    [summaries.data]
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

  // My own row is redundant: the resume card already says where I am, and a
  // Feed that leads with yourself is a mirror, not a party.
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
      // go stale is the lounge lists behind it — the subscription set, the
      // rosters the rail counts, and my Sessions — plus the clock offset every
      // progress bar is measured against.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_LOUNGES_KEY }),
        queryClient.invalidateQueries({ queryKey: loungeKeys.mine(profile?.id ?? null) }),
        queryClient.invalidateQueries({ queryKey: [MY_SESSIONS_KEY] }),
        syncClock(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, profile?.id]);

  const showSkeleton = lounges.isPending || (!ready && !lounges.isError);

  /** Trimmed and lowercased once, and the only thing the search branches on. */
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  /**
   * The rail's live counts, folded out of the same presence stream the list
   * uses rather than fetched.
   *
   * `entries` is deduplicated by PERSON — somebody in three of my lounges is
   * tagged with one of them — so `online` is "people showing on the Feed under
   * this lounge", which is exactly what the coral "N LISTENING" claims.
   * `members` is the real roster and comes from the query above.
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
        return {
          id: lounge.id,
          name: lounge.name,
          members: memberCounts.get(lounge.id) ?? null,
          online,
          live,
        };
      }),
    [entries, loungeList, memberCounts]
  );

  const visibleRail = useMemo(
    () => (q ? railLounges.filter((lounge) => lounge.name.toLowerCase().includes(q)) : railLounges),
    [q, railLounges]
  );

  const resume = useMemo<Resume | null>(() => {
    const mine =
      (playbackRoomId ? sessionList.find((s) => s.roomId === playbackRoomId) : undefined) ??
      sessionList.find((s) => s.timeline.isPlaying) ??
      sessionList[0];

    if (!mine) return null;

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
      roomId: mine.roomId,
      loungeId: mine.loungeId,
      loungeName: loungeNames.get(mine.loungeId) ?? mine.name,
      title: track?.title ?? mine.name,
      artist: track?.artist ?? '',
      artworkUrl: track?.artworkUrl ?? null,
      durationMs: track?.durationMs ?? 0,
      timeline: attached && playbackTimeline ? playbackTimeline : mine.timeline,
    };
  }, [loungeNames, playbackRoomId, playbackTimeline, playbackTrack, sessionList]);

  /**
   * Live rows first, then the rest.
   *
   * `useLoungePresence` already sorts this way; the partition is repeated here
   * so the Feed's order is a property of the Feed rather than of a hook three
   * files away — and so a filtered list cannot come back interleaved.
   */
  const rows = useMemo(() => {
    const visible = q ? entries.filter((entry) => matchesQuery(entry, q)) : entries;
    return [
      ...visible.filter((entry) => entry.roomId !== null),
      ...visible.filter((entry) => entry.roomId === null),
    ];
  }, [entries, q]);

  /*
    `index` is what makes the rows arrive one after another rather than all at
    once, and it comes from `renderItem` because that is the one place that
    already knows it. Deriving it any other way — an `indexOf` in the card, a
    map built alongside `rows` — would put a value that changes on every
    presence beat into the card's props and break the memo that keeps one person
    changing song from re-rendering the whole Feed.
  */
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<FeedEntry>) => (
      <NowPlayingCard entry={item} index={index} />
    ),
    []
  );

  /**
   * The count beside "Live now" — coral, because it reports the world, not a
   * control, and it reports the WHOLE world even while a search is narrowing
   * what is on screen. A count that shrank as you typed would be describing the
   * filter rather than the party.
   */
  const liveCount = useMemo(() => {
    const live = entries.filter((entry) => entry.roomId !== null).length;
    if (live > 0) return `${live} ${live === 1 ? 'person' : 'people'} listening right now`;
    if (entries.length > 0) return `${entries.length} online`;
    return undefined;
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
    What the two sections do while a search is running.

    A heading over nothing is worse than no heading, so each one appears only if
    it has something under it — and when neither does, the whole header
    collapses to one empty state rather than two labelled voids.
  */
  const railRendered = !showSkeleton && !lounges.isError && visibleRail.length > 0;
  const showLounges = !searching || visibleRail.length > 0;
  const showLive = showSkeleton || rows.length > 0;
  const nothingFound = searching && visibleRail.length === 0 && rows.length === 0;

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
      {/* Hidden while searching: the Session you are in is not a search result. */}
      {resume && !searching ? (
        <ResumeCard resume={resume} onOpenRoom={openRoom} onOpenLounge={openLounge} />
      ) : null}

      {nothingFound ? (
        <EmptyState
          icon={Search}
          title={`Nothing matching "${query.trim()}"`}
          description="This looks through your lounges and whoever is on right now. Explore searches every public lounge."
          primary={{ label: 'Search every lounge', onPress: openExplore }}
        />
      ) : null}

      {showLounges ? (
        <>
          <SectionHeader title="Your lounges" action={{ label: 'See all', onPress: openMyLounges }} />

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
            <LoungeRail
              lounges={visibleRail}
              onOpen={openLounge}
              onCreate={searching ? null : createLounge}
            />
          )}
        </>
      ) : null}

      {showLive ? (
        <SectionHeader
          title="Live now"
          count={showSkeleton ? undefined : liveCount}
          // The rail already paid 20px of clearance for its own shadow, so this
          // header takes the remainder of the artboard's 24 rather than all of
          // it — but only when a rail is actually what is above it.
          style={railRendered || showSkeleton ? styles.sectionAfterRail : undefined}
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

        {/*
          PINNED, not scrolled. The artboard has the field inside the scroll
          body; as a `ListHeaderComponent` a controlled TextInput remounts
          whenever the list re-renders and drops the keyboard mid-word, which is
          the bug `(tabs)/explore.tsx` documents having already hit. Presence
          re-renders this list constantly, so the Feed would hit it harder than
          any other screen.
        */}
        <View style={styles.searchWrap}>
          <SearchField value={query} onChange={setQuery} />
        </View>

        <FlatList
          data={showSkeleton ? [] : rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={showSkeleton ? <RowsSkeleton /> : null}
          ListFooterComponent={
            showSkeleton || searching ? null : (
              <StartSessionCard
                roster={entries.slice(0, 4)}
                quiet={rows.length === 0 && resume === null}
                onStart={startSession}
              />
            )
          }
          // The masthead and the search field are siblings now rather than part
          // of the header, so the list is one of three children in a column and
          // has to claim the rest of it explicitly — without this it sizes to
          // its content and stops scrolling once the Feed is longer than the
          // screen.
          style={styles.flex}
          /*
            The dock reservation is inline because it depends on the device's
            bottom inset, which a StyleSheet object cannot carry — that is
            exactly how the old static `Dock.reserve` came to under-reserve here.
          */
          contentContainerStyle={[styles.content, { paddingBottom: dockReserve }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
    paddingTop: Space.md,
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

  /** Pays the gutter itself: the field sits outside the list's content padding. */
  searchWrap: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
  },
  /** L245: a 50px pill, cut INTO the page rather than raised off it. */
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: SEARCH_HEIGHT,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...Type.body(15),
    // RN centres a single-line input on its own line box; a 1.5 line height
    // then pushes the text off the pill's optical centre on Android.
    lineHeight: undefined,
    paddingVertical: 0,
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
    flexShrink: 0,
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
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 11,
  },
  railBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: Radii.pill,
  },
  railBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
  },
  railName: {
    fontFamily: Fonts.extrabold,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: tracking(13, 0.05),
    textTransform: 'uppercase',
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
    flexShrink: 0,
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

  /* ---------------------------------------------------------- resume card */

  resume: {
    marginTop: Space.md,
  },
  resumeHead: {
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
  resumeTop: {
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
  resumeInfo: {
    flex: 1,
    minWidth: 0,
  },
  resumeKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.14),
  },
  resumeTitle: {
    ...Type.display(21),
    letterSpacing: tracking(21, -0.025),
    marginTop: 5,
  },
  resumeArtist: {
    ...Type.body(13),
    marginTop: 2,
  },
  resumeBar: {
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
  resumeAction: {
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

  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: Space.md,
  },
  skeletonRowInfo: {
    flex: 1,
    gap: Space.sm,
  },
});
