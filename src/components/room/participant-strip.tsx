/**
 * Who is in the Session, and where each of them actually is.
 *
 * From `design/nocturne/aux-nocturne.dc.html` — the roster card at L996–L1004
 * (round avatar, name over metadata, right-aligned drift readout, a mic glyph
 * at the thumb end) and the per-member audio sheet at L1360–L1375.
 *
 * THIS FILE IS THE MEMBERS TAB AND IT DRAWS PEOPLE. NOTHING ELSE. Two things
 * that were not people have been taken out of it in this pass, and both were
 * put here for reasons that were true at the time:
 *
 *   `VoiceControls` — YOUR mic and YOUR deafen, as two tiles at the top of
 *   both lists. Its own docstring argued the case: the controls "used to live
 *   one tap deep inside a lobby sheet that had to be found first, and a
 *   control nobody finds is a control that does not exist". That argument was
 *   correct and it has been ANSWERED rather than overturned — mic is now the
 *   first cell of the session dock, permanently on screen and zero taps deep,
 *   and deafen is a tile in the panel one swipe above it. The user asked for
 *   the card to go ("i dont need your voice card here"); what they were
 *   objecting to was a control panel sitting on top of a list of people. Both
 *   controls are closer to hand now than the card ever put them.
 *
 *   The ORBIT'S TITLE BLOCK — `track.title` over `track.artist`, with the
 *   player's own empty state underneath. See the note where it used to be, in
 *   `SyncOrbit`'s header.
 *
 * What is left is the two rosters, and they are the same people twice:
 *
 *   `ParticipantStrip` — the drift chart. One raised card per listener: avatar,
 *   name over rung, a ±400ms deviation plot against a centre axis, the drift
 *   readout, and the mute button that says whether you are hearing them.
 *   This is the thing that makes the sync engine visible.
 *
 *   `SyncOrbit` — the same people plotted as distance from a centre. Rings at
 *   ±40 (accent) and ±220 (dashed). The LEGEND IS A NORMAL-FLOW SIBLING of the
 *   dial, never absolutely positioned inside it: a listener who lands in the
 *   bottom slot sits exactly where an inset legend would be.
 *
 * Both lists are FlatLists that take the rest of the screen as `header`/
 * `footer`, so the Session has exactly one scroller and the roster stays
 * virtualised. Both carry all four states — skeleton cards, an empty notice, an
 * error with a retry, and the roster itself.
 *
 * EVERY CARD FILL IN HERE IS `surfaceSolid`, AND THAT IS A CORRECTION. (The
 * one `surface` left is the dial core at :977, which is not a card: it sits
 * in an opaque `bgRecessed` well and takes a `rule` edge for its shape.) The
 * roster row, the skeleton row and the voice card all shipped on `surface`,
 * which is 5.5% white. `ParticipantStrip` is mounted inside the Session's sync
 * `<Sheet>` (src/app/room/[id].tsx:678), and that sheet is a `BlurView` — a
 * 5.5%-white card laid over a blur has nothing to sit on and loses its edge
 * completely. `SyncOrbit` sits on the plain Session ground rather than in a
 * sheet, but its rows take the same fill for a reason that is not laziness:
 * the roster row is ONE object drawn in two lists, and a row that changes fill
 * depending on which list rendered it is the drift this pass exists to remove.
 * `surfaceSolid` is the resolved composite of `surface` over `bg`, so the
 * plain-ground case looks the same either way and the swap costs nothing.
 *
 * The dial core keeps `surface`: it is a disc inside an opaque `bgRecessed`
 * well, not a card over glass, and its `rule` edge is already what gives it
 * shape there.
 *
 * WHICH ACCENT MEANS WHAT HERE. Two of the states this file used to paint
 * left with the voice card; the rule that governed all of them has not
 * changed, and the dock is written against the same one:
 *
 *   CORAL is audio FLOWING — someone is on aux, someone is speaking, someone
 *   is in sync. It is the direction's "this is happening right now" and
 *   nothing else may take it.
 *   `danger` is audio CUT — you have muted someone. It is subtractive, it is a
 *   state a person needs to notice and undo, and it is not "happening".
 *   Neutral (`surface2` + `ink2`) is the resting state.
 *
 * BLUE APPEARS EXACTLY ONCE in this file — the retry button on the error
 * notice, which is the only genuine call to action here. Every other control is
 * a state being toggled.
 *
 * MUTE IS A BUTTON, NOT A GESTURE. Tapping the round speaker at the thumb end
 * mutes that person for you and nobody else. The row body is still pressable
 * (it opens per-person controls where a screen provides them), but the mute
 * affordance is its own 36px control with its own label, because a whole-row
 * tap is invisible until someone happens to try it.
 *
 * HONESTY RULES, because the backend does not publish per-person milliseconds:
 *
 *   - The viewer's OWN row is the only one with a real measurement: `driftMs`
 *     from the playback store, plotted to scale, labelled with its real rung.
 *   - Everyone else has `room_participants.is_synced`, a boolean written every
 *     ~15s. A synced listener is drawn ON the axis and reads `IN SYNC` — not
 *     `LOCKED`, because `LOCKED` is a claim about 40ms and the boolean is a
 *     claim about the controller's much wider ignore band. An unsynced one gets
 *     `BUFFERING`, no number and NO MARK, because we know they are off but not
 *     by how much, and inventing a number here would be lying in the most
 *     convincing possible typeface.
 *
 * When the backend starts publishing per-participant drift, only `readingFor`
 * needs to change.
 */

import { Users, Volume2, VolumeX } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type DimensionValue,
  type ListRenderItemInfo,
} from 'react-native';

import { Avatar, CircleIconButton, EmptyState, Skeleton } from '@/components/ui';
import {
  Fonts,
  PointerEvents,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  pressed as pressedDepth,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import type { Palette } from '@/lib/theme';
import { useRoomParticipants, type ParticipantView } from '@/features/rooms/queries';
import { usePlayback } from '@/playback/store';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';
import type { ResolvedTrack } from '@/playback/types';

import { ModularGrid } from './now-playing';
import {
  DRIFT_PLOT_MS,
  RUNG_LABEL,
  driftRung,
  firstNameOf,
  formatClock,
  formatDrift,
  initialFor,
  readout,
  rungColor,
} from './drift';

const GUTTER = Space.lg - 2;
const TILE = 34;
const ORBIT_TILE = 32;
const NAME_WIDTH = 62;
const PLOT_HEIGHT = 22;
const MARK_WIDTH = 3;
const MARK_HEIGHT = 14;
const SKELETON_ROWS = 3;
const TICK_MS = 250;
/**
 * The per-member mute button. 36 rather than 44 so it does not out-shout the
 * 34px avatar at the other end of the row — `CircleIconButton` grows the touch
 * target back to 44 with hitSlop, which costs no layout.
 */
const MUTE_BUTTON = 36;

/** The dial and its rings. */
const DIAL_HEIGHT = 340;
const DIAL_CENTRE_Y = 170;
const RING_OUTER = 284;
const RING_NUDGE = 192;
const RING_LOCK = 96;
const DIAL_CORE = 76;
/** Where a listener sits: the lock ring's edge, pushed out by their drift. */
const ORBIT_BASE_RADIUS = 96;
const ORBIT_MAX_PUSH = 46;

// --------------------------------------------------------------- readings

type Reading = {
  /** Right-hand readout. `—` when we have no number for this person. */
  value: string;
  /** Rung column. LOCKED / NUDGING / SEEKING, or IN SYNC / BUFFERING. */
  rung: string;
  color: string;
  /** 0..1 across the ±400ms plot, or null when we cannot place them. */
  plot: number | null;
  /** Distance from the dial's centre, in px. */
  radius: number;
  measured: boolean;
};

/**
 * The one place a person becomes a reading. Everything downstream — the chart,
 * the orbit, the accessibility labels — reads from this, so there is exactly
 * one definition of what we do and do not know about someone.
 */
function readingFor(isMe: boolean, isSynced: boolean, driftMs: number, C: Palette): Reading {
  if (isMe) {
    const rung = driftRung(driftMs);
    const color = rungColor(rung, C);
    const clamped = Math.max(-DRIFT_PLOT_MS, Math.min(DRIFT_PLOT_MS, driftMs));

    return {
      value: formatDrift(driftMs),
      rung: RUNG_LABEL[rung],
      color,
      plot: 0.5 + (clamped / DRIFT_PLOT_MS) * 0.5,
      radius: ORBIT_BASE_RADIUS + Math.min(ORBIT_MAX_PUSH, Math.abs(driftMs) / 8),
      measured: true,
    };
  }

  if (isSynced) {
    // Red is allowed here: `in sync` is exactly what the colour is reserved for.
    return {
      value: '—',
      rung: 'In sync',
      color: C.liveText,
      plot: 0.5,
      radius: ORBIT_BASE_RADIUS,
      measured: false,
    };
  }

  // Losing sync is losing the red. No number, no mark — we do not know where.
  return {
    value: '—',
    rung: 'Buffering',
    color: C.ink2,
    plot: null,
    radius: ORBIT_BASE_RADIUS + ORBIT_MAX_PUSH,
    measured: false,
  };
}

// ------------------------------------------------------------ drift chart

/**
 * The props both lists share. Every one of the new ones is OPTIONAL and every
 * one of them draws nothing when it is absent, so the Session screen keeps
 * compiling and rendering exactly as it did while the wiring lands.
 */
type RosterProps = {
  /** Ids this listener has muted locally. Never published, never announced. */
  mutedIds?: ReadonlySet<string>;
  /**
   * Ids whose mic is open right now, for the coral ring on their avatar.
   *
   * Nothing supplies this yet — there is no voice transport in this build — and
   * an empty set draws no rings, which is the honest default. It exists so the
   * ring lands with the transport rather than after it.
   */
  speakingIds?: ReadonlySet<string>;
  /** Tapping the speaker button mutes that person, for this listener only. */
  onSelectPerson?: (userId: string) => void;
  /**
   * Per-person controls — their volume for you, pass them the aux, message
   * them (design L1360). Given one, the ROW BODY opens it and the speaker
   * button keeps mute; without one the row body is the mute toggle, which is
   * what it has always been.
   */
  onOpenPerson?: (userId: string) => void;
  contentBottomInset?: number;
};

export type ParticipantStripProps = RosterProps & {
  roomId: string | null;
  hostId: string | null;
  currentUserId: string | null;
  /** Everything above the chart. The Session hands it the whole player. */
  header?: ReactNode;
  /** Everything below it. */
  footer?: ReactNode;
};

export function ParticipantStrip({
  roomId,
  hostId,
  currentUserId,
  header,
  footer,
  onSelectPerson,
  onOpenPerson,
  mutedIds,
  speakingIds,
  contentBottomInset = 0,
}: ParticipantStripProps) {
  const C = useColors();
  const { data, isLoading, error, refetch } = useRoomParticipants(roomId);
  // Read straight from the store rather than through a prop: this is the one
  // real measurement on the screen and it changes every 3s, so keeping it local
  // means a drift tick re-renders this list and nothing else.
  const driftMs = usePlayback((state) => state.driftMs);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ParticipantView>) => {
      const isMe = item.userId === currentUserId;
      return (
        <DriftRow
          participant={item}
          isOnAux={item.userId === hostId}
          isMe={isMe}
          // Only the viewer's own row consumes this. Handing everyone else a
          // constant keeps their props stable, so a 3s drift tick re-renders
          // exactly one row instead of the whole list.
          driftMs={isMe ? driftMs : 0}
          muted={mutedIds?.has(item.userId) ?? false}
          speaking={speakingIds?.has(item.userId) ?? false}
          onSelect={onSelectPerson}
          onOpen={onOpenPerson}
        />
      );
    },
    [hostId, currentUserId, driftMs, mutedIds, speakingIds, onSelectPerson, onOpenPerson]
  );

  const participants = data ?? [];

  return (
    <FlatList
      data={participants}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingBottom: contentBottomInset + Space.xxl }]}
      ListHeaderComponent={
        <>
          {header}
          <View style={styles.hintRow}>
            {/*
              The sentence tracks what a tap actually does, because the row has
              two possible jobs and a hint that describes the other one is worse
              than none at all.
            */}
            <Text style={[styles.hint, { color: C.ink3 }]}>
              {onOpenPerson
                ? 'Tap a name for their controls'
                : onSelectPerson
                  ? 'Mute anyone — for you only'
                  : 'Who is in the Session'}
            </Text>
            <Text style={[styles.scale, { color: C.ink3 }]}>±400ms</Text>
          </View>
          {isLoading && !data ? <ChartSkeleton /> : null}
        </>
      }
      ListEmptyComponent={
        isLoading && !data ? null : error ? (
          <RosterNotice
            title="Could not load who is here"
            body={error instanceof Error ? error.message : 'The connection dropped.'}
            onPress={handleRetry}
          />
        ) : (
          <RosterNotice
            title="The roster is empty"
            body="You are in the Session — this list is still catching up."
            onPress={handleRetry}
          />
        )
      }
      ListFooterComponent={
        <>
          {participants.length > 0 ? <LadderKey /> : null}
          {footer}
        </>
      }
    />
  );
}

const keyExtractor = (item: ParticipantView) => item.userId;

type RowControlProps = {
  /** Muted for THIS listener only. Never published, never announced. */
  muted?: boolean;
  /** Their mic is open right now. Draws the coral ring, nothing else. */
  speaking?: boolean;
  onSelect?: (userId: string) => void;
  onOpen?: (userId: string) => void;
};

type DriftRowProps = RowControlProps & {
  participant: ParticipantView;
  isOnAux: boolean;
  isMe: boolean;
  /** The viewer's own measured drift. Only applied to the viewer's own row. */
  driftMs: number;
};

const DriftRow = memo(function DriftRow({
  participant,
  isOnAux,
  isMe,
  driftMs,
  muted = false,
  speaking = false,
  onSelect,
  onOpen,
}: DriftRowProps) {
  const C = useColors();

  const reading = useMemo(
    () => readingFor(isMe, participant.isSynced, driftMs, C),
    [isMe, participant.isSynced, driftMs, C]
  );

  const name = isMe ? 'You' : firstNameOf(participant.displayName);
  const label = `${isMe ? 'You' : participant.displayName}${isOnAux ? ', on aux' : ''}, ${
    reading.measured ? `off by ${reading.value}, ${reading.rung}` : reading.rung
  }${muted ? ', muted for you' : ''}`;

  const press = rowPress(participant.userId, isMe, onSelect, onOpen);

  const body = (
    <>
      {/*
        The ring is the VOICE state — on aux, or talking right now. It is
        deliberately not wired to `reading`: in-sync already has two readouts on
        this row (the rung word and the mark in the plot), and a third one in
        the avatar would leave nothing to say that someone is speaking.
        `identity` is the signed-in user's own gradient, so you can find your
        row in a list of six without reading a single name.
      */}
      <Avatar
        name={participant.displayName}
        uri={participant.avatarUrl}
        size={TILE}
        live={isOnAux}
        speaking={speaking}
        identity={isMe}
      />

      <View style={styles.rowMeta}>
        <Text numberOfLines={1} style={[styles.rowName, { color: C.ink }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowRung, { color: reading.color }]}>
          {reading.rung}
        </Text>
      </View>

      <View style={styles.plot}>
        {/* The zero point: where the Session says everyone should be. */}
        <View style={[styles.axis, { backgroundColor: C.rule3 }, PointerEvents.none]} />
        {/* The ±40ms band, drawn as the only accent mark in the plot. */}
        <View style={[styles.lockBand, { backgroundColor: C.liveMid }, PointerEvents.none]} />
        {reading.plot == null ? null : (
          <View
            style={[
              styles.mark,
              { left: `${(reading.plot * 100).toFixed(2)}%` as DimensionValue },
              { backgroundColor: reading.color },
              PointerEvents.none,
            ]}
          />
        )}
      </View>

      <Text numberOfLines={1} style={[styles.rowValue, { color: reading.color }]}>
        {reading.value}
      </Text>
    </>
  );

  return (
    <View style={[styles.row, { backgroundColor: C.surfaceSolid, borderColor: C.rule }, raised(C)]}>
      {press ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: muted }}
          accessibilityHint={press.hint}
          onPress={press.onPress}
          style={({ pressed }) => [styles.rowBody, pressed ? styles.dim : null]}>
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} style={styles.rowBody}>
          {body}
        </View>
      )}

      <MemberMuteButton
        name={participant.displayName}
        muted={muted}
        isMe={isMe}
        onSelect={onSelect}
        userId={participant.userId}
      />
    </View>
  );
});

/**
 * What a tap on the row body does, and what a screen reader is told it does.
 *
 * Two rules, and the second is the one that matters: your OWN row never mutes,
 * because muting yourself locally would silence audio you were never hearing in
 * the first place. Your mic is the first cell of the session dock, which is the
 * control that actually exists for you.
 */
function rowPress(
  userId: string,
  isMe: boolean,
  onSelect?: (userId: string) => void,
  onOpen?: (userId: string) => void
): { onPress: () => void; hint: string } | null {
  if (onOpen) {
    return { onPress: () => onOpen(userId), hint: 'Opens their volume, mute and aux controls' };
  }
  if (onSelect && !isMe) {
    return { onPress: () => onSelect(userId), hint: 'Mutes this person, for you only' };
  }
  return null;
}

type MemberMuteButtonProps = {
  userId: string;
  name: string;
  muted: boolean;
  isMe: boolean;
  onSelect?: (userId: string) => void;
};

/**
 * Mute one person, for you only — the control the roster is really for.
 *
 * `danger` WHEN MUTED, and this is the one place in the file that colour is
 * right: you have cut someone's audio, which is subtractive and undoable and
 * needs to be visible from across the row. Coral would claim the opposite —
 * that something is live — and the previous ink-in-a-well treatment made the
 * single most important control on this screen look like a disabled icon.
 *
 * Its own control rather than the whole row, and a SIBLING of the row body
 * rather than a child of it: nested pressables trade taps on react-native-web,
 * where a tap on the inner one also fires the outer, which here would mute and
 * immediately unmute.
 */
const MemberMuteButton = memo(function MemberMuteButton({
  userId,
  name,
  muted,
  isMe,
  onSelect,
}: MemberMuteButtonProps) {
  const handlePress = useCallback(() => onSelect?.(userId), [onSelect, userId]);

  /* No mute at all on this list: every row is short by the same amount. */
  if (!onSelect) return null;

  /*
    Your own row keeps the SPACE but loses the control. Muting yourself locally
    would silence audio you were never hearing, and your mic is the first cell
    of the session dock — but drop the 36px and your drift
    readout stops lining up with everyone else's, which on the one screen whose
    job is comparing numbers is worse than a blank.
  */
  if (isMe) return <View style={styles.mutePlaceholder} />;

  return (
    <CircleIconButton
      icon={muted ? VolumeX : Volume2}
      size={MUTE_BUTTON}
      tone={muted ? 'danger' : 'chip'}
      accessibilityLabel={muted ? `Unmute ${name}` : `Mute ${name}, for you only`}
      onPress={handlePress}
    />
  );
});

const ChartSkeleton = memo(function ChartSkeleton() {
  const C = useColors();

  return (
    <View style={styles.skeletonStack}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View
          key={index}
          style={[styles.row, { backgroundColor: C.surfaceSolid, borderColor: C.rule }, raised(C)]}>
          <View style={styles.rowBody}>
            {/* Round, because the avatar it stands in for is round now. */}
            <Skeleton width={TILE} height={TILE} style={styles.tileSkeleton} />
            <View style={styles.rowMeta}>
              <Skeleton width={NAME_WIDTH} height={12} style={styles.lineSkeleton} />
              <Skeleton width={NAME_WIDTH - 14} height={9} style={styles.lineSkeleton} />
            </View>
            <View style={styles.plot}>
              <View style={[styles.axis, { backgroundColor: C.rule3 }]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
});

/**
 * The ladder as a key, not a paragraph. The thresholds are the only part a
 * reader needs; the sentence explaining rate correction was three lines of
 * theory in a sheet people open to find out whether their friend is behind.
 */
const LadderKey = memo(function LadderKey() {
  const C = useColors();

  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: C.live }, dotGlow(C.live)]} />
        <Text style={[styles.legendLabel, { color: C.liveText }]}>Locked ≤40ms</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: C.ink }]} />
        <Text style={[styles.legendLabel, { color: C.ink2 }]}>Nudging ≤220ms</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { borderWidth: Rule.hair, borderColor: C.ink2 }]} />
        <Text style={[styles.legendLabel, { color: C.ink2 }]}>Seeking</Text>
      </View>
    </View>
  );
});

/**
 * The 8px halo the artboards put under the locked dot (L991, L623).
 *
 * Written out rather than routed through `bloom()`, for the same reason
 * `GlassCard`'s bleed is: every recipe in the theme offsets its shadow
 * downward, and on a 9px dot a 16px drop is a smear under the legend rather
 * than light coming off the swatch.
 */
function dotGlow(color: string): object {
  return { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 8, color }] };
}

// -------------------------------------------------------------- notices

type RosterNoticeProps = {
  title: string;
  body: string;
  onPress: () => void;
};

/**
 * Empty and error, one shape: where you are, and the button out of it.
 *
 * `EmptyState` rather than the hand-rolled card this used to be. The card it
 * replaced was a `surface` fill with a shadow and NO border, which was legible
 * when `surface` was opaque grey and reads as flat now that it is 5.5% white —
 * and its retry pill was the app's CTA rebuilt from scratch, one size off.
 */
const RosterNotice = memo(function RosterNotice({ title, body, onPress }: RosterNoticeProps) {
  return (
    <EmptyState
      icon={Users}
      title={title}
      description={body}
      primary={{ label: 'Try again', onPress }}
    />
  );
});

// ------------------------------------------------------------- sync orbit

export type SyncOrbitProps = RosterProps & {
  roomId: string | null;
  hostId: string | null;
  currentUserId: string | null;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  header?: ReactNode;
  footer?: ReactNode;
};

export function SyncOrbit({
  roomId,
  hostId,
  currentUserId,
  track,
  timeline,
  header,
  footer,
  mutedIds,
  speakingIds,
  onSelectPerson,
  onOpenPerson,
  contentBottomInset = 0,
}: SyncOrbitProps) {
  const C = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const { data, isLoading, error, refetch } = useRoomParticipants(roomId);
  const driftMs = usePlayback((state) => state.driftMs);

  /* Read at render, not mirrored into state — see the note in now-playing.tsx. */
  const [, requestFrame] = useState(0);

  useEffect(() => {
    if (!timeline?.isPlaying) return;

    const timer = setInterval(() => requestFrame((frame) => frame + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [timeline]);

  const positionMs = timeline ? expectedPositionMs(timeline) : 0;

  const participants = data ?? [];
  const dialWidth = Math.min(windowWidth, 480);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ParticipantView>) => {
      const isMe = item.userId === currentUserId;
      return (
        <OrbitRow
          participant={item}
          isOnAux={item.userId === hostId}
          isMe={isMe}
          driftMs={isMe ? driftMs : 0}
          muted={mutedIds?.has(item.userId) ?? false}
          speaking={speakingIds?.has(item.userId) ?? false}
          onSelect={onSelectPerson}
          onOpen={onOpenPerson}
        />
      );
    },
    [hostId, currentUserId, driftMs, mutedIds, speakingIds, onSelectPerson, onOpenPerson]
  );

  return (
    <FlatList
      data={participants}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingBottom: contentBottomInset + Space.xxl }]}
      ListHeaderComponent={
        <>
          {header}

          <View style={styles.hintRow}>
            <Text style={[styles.hint, { color: C.ink3 }]}>Distance from centre is drift</Text>
            <Text style={[styles.scale, { color: C.ink3 }]}>±400ms</Text>
          </View>

          <View
            accessible
            accessibilityLabel={`Sync orbit. ${participants.length} ${
              participants.length === 1 ? 'listener' : 'listeners'
            } plotted by how far they are from the Session's position.`}
            style={[styles.dial, { backgroundColor: C.bgRecessed }, pressedDepth(C)]}>
            <ModularGrid />

            <Ring size={RING_OUTER} width={dialWidth} style={{ borderColor: C.rule }} />
            <Ring
              size={RING_NUDGE}
              width={dialWidth}
              style={{ borderColor: C.rule2, borderStyle: 'dashed' }}
            />
            <Ring
              size={RING_LOCK}
              width={dialWidth}
              style={{ borderColor: C.live, borderWidth: Rule.major }}
            />

            <View
              style={[
                styles.dialCore,
                {
                  backgroundColor: C.surface,
                  // The edge is not decoration: a 5.5%-white disc inside a dark
                  // well has no shape of its own, shadow or no shadow.
                  borderColor: C.rule,
                  left: dialWidth / 2 - DIAL_CORE / 2,
                  top: DIAL_CENTRE_Y - DIAL_CORE / 2,
                },
                raised(C),
              ]}>
              <Text style={[styles.dialInitial, { color: C.ink }]}>{initialFor(track?.title)}</Text>
              <Text style={[styles.dialClock, { color: C.liveText }]}>
                {formatClock(positionMs)}
              </Text>
            </View>

            {participants.map((person, index) => (
              <OrbitMarker
                key={person.userId}
                participant={person}
                index={index}
                total={participants.length}
                isMe={person.userId === currentUserId}
                isOnAux={person.userId === hostId}
                speaking={speakingIds?.has(person.userId) ?? false}
                driftMs={person.userId === currentUserId ? driftMs : 0}
                dialWidth={dialWidth}
              />
            ))}
          </View>

          {/*
            NORMAL-FLOW SIBLING, not an overlay. A listener plotted into the
            bottom slot of the dial sits exactly where an inset legend would be,
            and the two would collide.
          */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: C.live }, dotGlow(C.live)]} />
              <Text style={[styles.legendLabel, { color: C.liveText }]}>±40 locked</Text>
            </View>
            <View style={styles.legendItem}>
              {/*
                A plain `ink2` dot (design L992). The 45° `HatchSwatch` that
                stood here — three rotated bars in a clipped 9px box, because
                React Native has no repeating gradient — was inventing a texture
                the artboards never used, at 9px where it read as a smudge.
              */}
              <View style={[styles.swatch, { backgroundColor: C.ink2 }]} />
              <Text style={[styles.legendLabel, { color: C.ink2 }]}>±220 nudge</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { borderWidth: Rule.hair, borderColor: C.ink2 }]} />
              <Text style={[styles.legendLabel, { color: C.ink2 }]}>Seek</Text>
            </View>
          </View>

          {/*
            THE TITLE BLOCK THAT USED TO SIT HERE IS GONE. It drew
            `track.title` over `track.artist`, falling back to "Nothing
            playing" / "Queue a track to start the Session" — the player's
            empty state, rendered underneath the roster, on the tab whose whole
            job is WHO IS HERE. Three things were wrong with it and only the
            third is about taste:

              · It was a second now-playing readout on a screen that already
                has one. `NowPlaying` is a FIXED band above the stage switch
                (see the Session's file header, deviation 1) and does not swap
                out when this tab is selected, so the title was on screen twice
                whenever anything was playing.
              · Its empty face made the Listeners tab announce that the queue
                was empty. A person tapping "Listeners · 6" is asking about six
                people; answering with "Queue a track" is answering a question
                nobody asked, in the space where the answer should have been.
              · It pushed the roster — the actual content — a further 60px down
                a list that already opens with a 340px dial.

            `track` is still a prop and still used: the dial's core carries its
            initial and the Session's clock, which is not a now-playing readout
            but the REFERENCE POINT every listener on the dial is plotted
            against. Remove that and the orbit is measuring nothing.
          */}
        </>
      }
      ListEmptyComponent={
        isLoading && !data ? (
          <ChartSkeleton />
        ) : error ? (
          <RosterNotice
            title="Could not load who is here"
            body={error instanceof Error ? error.message : 'The connection dropped.'}
            onPress={handleRetry}
          />
        ) : (
          <RosterNotice
            title="The roster is empty"
            body="You are in the Session — this list is still catching up."
            onPress={handleRetry}
          />
        )
      }
      ListFooterComponent={footer ? <>{footer}</> : null}
    />
  );
}

/** One concentric ring. Circles here: the dial is an orbit, not a grid. */
const Ring = memo(function Ring({
  size,
  width,
  style,
}: {
  size: number;
  width: number;
  style: { borderColor: string; borderStyle?: 'dashed'; borderWidth?: number };
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.ring,
        { width: size, height: size, left: width / 2 - size / 2, top: DIAL_CENTRE_Y - size / 2 },
        style,
        PointerEvents.none,
      ]}
    />
  );
});

type OrbitMarkerProps = {
  participant: ParticipantView;
  index: number;
  total: number;
  isMe: boolean;
  isOnAux: boolean;
  speaking: boolean;
  driftMs: number;
  dialWidth: number;
};

const OrbitMarker = memo(function OrbitMarker({
  participant,
  index,
  total,
  isMe,
  isOnAux,
  speaking,
  driftMs,
  dialWidth,
}: OrbitMarkerProps) {
  const C = useColors();
  const reading = readingFor(isMe, participant.isSynced, driftMs, C);

  // Evenly spaced around the dial, then pushed out by how far off they are.
  // The angle is presentation only; the RADIUS is the measurement.
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  const left = dialWidth / 2 + Math.cos(angle) * reading.radius;
  const top = DIAL_CENTRE_Y + Math.sin(angle) * reading.radius;

  return (
    <View
      accessible
      accessibilityLabel={`${isMe ? 'You' : participant.displayName}, ${
        reading.measured ? `off by ${reading.value}` : reading.rung
      }`}
      style={[styles.marker, { left: left - ORBIT_TILE / 2, top: top - ORBIT_TILE / 2 - 2 }]}>
      <Avatar
        name={participant.displayName}
        uri={participant.avatarUrl}
        size={ORBIT_TILE}
        live={isOnAux}
        speaking={speaking}
        identity={isMe}
      />
      <Text numberOfLines={1} style={[styles.markerLabel, { color: reading.color }]}>
        {reading.value}
      </Text>
    </View>
  );
});

type OrbitRowProps = RowControlProps & {
  participant: ParticipantView;
  isOnAux: boolean;
  isMe: boolean;
  driftMs: number;
};

const OrbitRow = memo(function OrbitRow({
  participant,
  isOnAux,
  isMe,
  driftMs,
  muted = false,
  speaking = false,
  onSelect,
  onOpen,
}: OrbitRowProps) {
  const C = useColors();
  const reading = readingFor(isMe, participant.isSynced, driftMs, C);
  const press = rowPress(participant.userId, isMe, onSelect, onOpen);

  const content = (
    <>
      <Avatar
        name={participant.displayName}
        uri={participant.avatarUrl}
        size={ORBIT_TILE}
        live={isOnAux}
        speaking={speaking}
        identity={isMe}
      />

      <View style={styles.orbitRowMeta}>
        <Text numberOfLines={1} style={[styles.orbitRowName, { color: C.ink }]}>
          {isMe ? 'You' : participant.displayName}
          {isOnAux ? <Text style={[styles.onAuxChip, { color: C.liveText }]}> on aux</Text> : null}
        </Text>
        <Text numberOfLines={1} style={[styles.orbitRowHandle, { color: C.ink3 }]}>
          {`@${participant.username}`}
        </Text>
      </View>

      <View style={styles.orbitRowRight}>
        <Text style={[styles.orbitRowValue, { color: reading.color }]}>{reading.value}</Text>
        <Text style={[styles.orbitRowRung, { color: C.ink3 }]}>{reading.rung}</Text>
      </View>
    </>
  );

  const label = `${isMe ? 'You' : participant.displayName}, ${
    reading.measured ? `off by ${reading.value}, ${reading.rung}` : reading.rung
  }${muted ? ', muted for you' : ''}`;

  return (
    <View style={[styles.row, { backgroundColor: C.surfaceSolid, borderColor: C.rule }, raised(C)]}>
      {press ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: muted }}
          accessibilityHint={press.hint}
          onPress={press.onPress}
          style={({ pressed }) => [styles.rowBody, pressed ? styles.dim : null]}>
          {content}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} style={styles.rowBody}>
          {content}
        </View>
      )}

      <MemberMuteButton
        name={participant.displayName}
        muted={muted}
        isMe={isMe}
        onSelect={onSelect}
        userId={participant.userId}
      />
    </View>
  );
});

/*
  TWO LOCAL PARTS USED TO LIVE HERE AND BOTH ARE GONE ON PURPOSE.

  `InitialTile` was a hand-rolled square avatar with its own photo loader.
  `Avatar` from the kit is the same object done once: round as every avatar in
  the artboards is, with the coral speaking ring, the identity gradient for your
  own row and the blurhash placeholder already inside it. The one thing lost is
  the coral FILL for the person on aux, which the ring now says instead — a
  filled coral disc under a photograph is invisible anyway.

  `HatchSwatch` drew a 45° hatch for the nudge legend out of three rotated bars
  in a clipped 9px box. The artboards use a plain dot there; see the note at the
  orbit legend.
*/

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: GUTTER,
    gap: Space.sm + 1,
  },
  skeletonStack: {
    gap: Space.sm + 1,
  },
  dim: {
    opacity: 0.7,
  },

  // ------------------------------------------------------------- sections
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    /** The list's own 9px gap follows this row; only a hair is needed here. */
    paddingBottom: Space.xs,
  },
  hint: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.1),
    flexShrink: 1,
  },
  scale: {
    ...readout(10),
    letterSpacing: tracking(10, 0.09),
  },

  // ---------------------------------------------------------- drift chart
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: TOUCH_TARGET + Space.md,
    paddingVertical: Space.sm + 1,
    paddingHorizontal: Space.md - 1,
    borderWidth: Rule.hair,
    borderRadius: Radii.button,
  },
  /**
   * The pressable half. A SIBLING of the mute button, never its parent — see
   * the note on `MemberMuteButton`.
   */
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
  },
  rowMeta: {
    width: NAME_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
    gap: 1,
  },
  rowName: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, -0.005),
  },
  rowRung: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.09),
  },
  plot: {
    flex: 1,
    minWidth: 48,
    height: PLOT_HEIGHT,
    position: 'relative',
  },
  axis: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
  },
  lockBand: {
    position: 'absolute',
    left: '44%',
    right: '44%',
    top: (PLOT_HEIGHT - Rule.major) / 2,
    height: Rule.major,
    borderRadius: 1,
  },
  mark: {
    position: 'absolute',
    top: (PLOT_HEIGHT - MARK_HEIGHT) / 2,
    width: MARK_WIDTH,
    height: MARK_HEIGHT,
    marginLeft: -MARK_WIDTH / 2,
    borderRadius: 1.5,
  },
  rowValue: {
    ...readout(12),
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'right',
  },
  mutePlaceholder: {
    width: MUTE_BUTTON,
    flexGrow: 0,
    flexShrink: 0,
  },
  tileSkeleton: {
    borderRadius: TILE / 2,
  },
  lineSkeleton: {
    borderRadius: Radii.xs,
  },

  // ----------------------------------------------------------- sync orbit
  dial: {
    position: 'relative',
    height: DIAL_HEIGHT,
    overflow: 'hidden',
    borderRadius: Radii.xl,
  },
  ring: {
    position: 'absolute',
    borderWidth: Rule.hair,
    borderRadius: Radii.pill,
  },
  dialCore: {
    position: 'absolute',
    width: DIAL_CORE,
    height: DIAL_CORE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
    borderRadius: Radii.pill,
  },
  dialInitial: {
    ...Type.display(28),
    lineHeight: 28,
  },
  dialClock: {
    ...readout(10),
    letterSpacing: tracking(10, 0.06),
    marginTop: 3,
  },
  marker: {
    position: 'absolute',
    width: ORBIT_TILE,
    alignItems: 'center',
    gap: 3,
  },
  markerLabel: {
    ...readout(10),
    letterSpacing: tracking(10, 0.04),
  },

  // --------------------------------------------------------------- legend
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
  },
  legendLabel: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.09),
  },
  /** Round, as every legend dot in the artboards is. 4.5, not `Radii.pill`. */
  swatch: {
    width: 9,
    height: 9,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 4.5,
  },

  orbitRowMeta: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  orbitRowName: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.02),
  },
  onAuxChip: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.08),
    textTransform: 'uppercase',
  },
  orbitRowHandle: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'none',
  },
  orbitRowRight: {
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  orbitRowValue: {
    ...readout(13),
  },
  orbitRowRung: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
    textTransform: 'uppercase',
  },
});
