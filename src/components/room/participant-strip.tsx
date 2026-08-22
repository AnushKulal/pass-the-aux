/**
 * Who is in the room right now, and where each of them actually is.
 *
 * This is the screen's whole argument. One accent line runs down the list — the
 * playhead, the zero point of "now" — and every listener is a dot placed at
 * their own offset from it. The sync engine stops being a claim in a badge and
 * becomes something you can look at.
 *
 * HONESTY RULES, because the backend does not give us per-person milliseconds:
 *
 *   - The host is `on aux`. Their dot is the line, by definition.
 *   - The viewer's OWN row is the only one with a real measurement: `driftMs`
 *     from the playback store, in milliseconds, positioned to scale.
 *   - Everyone else has `room_participants.is_synced`, a boolean written every
 *     ~15s. A synced listener is drawn ON the line. An unsynced one is drawn as
 *     a hollow warn ring, still on the line, labelled `buffering` — because we
 *     know they are off but NOT by how much, and inventing a number here would
 *     be lying in the most convincing possible typeface.
 *
 * When the backend starts publishing per-participant drift, only `syncFor`
 * needs to change.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from 'react-native';

import { Avatar, Skeleton } from '@/components/ui';
import { useRoomParticipants, type ParticipantView } from '@/features/rooms/queries';
import { Colors, PointerEvents, Radius, Space, Type } from '@/lib/theme';
import { usePlayback } from '@/playback/store';
import { Drift } from '@/playback/types';

const AVATAR_SIZE = 30;
const ROW_HEIGHT = 34;
const ROW_GAP = Space.md - 1;
const SKELETON_COUNT = 3;

/**
 * Four rows, as the artboard — but the artboard is an 812px frame with no
 * status bar and no home indicator to give back. On a real phone that budget is
 * ~60px shorter, and the rows the queue would lose are worth more than a fourth
 * face. The list scrolls in place either way.
 */
function visibleRows(windowHeight: number): number {
  if (windowHeight >= 860) return 4;
  if (windowHeight >= 720) return 3;
  return 2;
}

const NAME_WIDTH = 56;
const READOUT_WIDTH = 56;
const DOT_SIZE = 7;

/**
 * Where "now" sits across the row, as a fraction of the section width. Constant
 * rather than tied to song progress: this line is the ZERO POINT for drift, not
 * an elapsed-time marker, and a moving zero would drag every dot off screen. It
 * coincides with the waveform's playhead at 43% through a track, which is the
 * moment the artboard captures.
 */
const PLAYHEAD_RATIO = 0.43;

/**
 * Pixels of dot travel per unit of drift, on a square-root scale: ±12ms has to
 * be visible at all while ±2s still has to stay on the screen. Clamped to
 * PLAYHEAD_RATIO of the row so a dot never escapes to the left of the avatar.
 */
const DRIFT_SCALE = 0.8;
const DRIFT_MAX_PX = 34;

export type ParticipantStripProps = {
  roomId: string | null;
  hostId: string | null;
  currentUserId: string | null;
};

type SyncState = {
  /** Mono readout on the right of the row. */
  label: string;
  color: string;
  /** Signed pixels from the playhead. Null when we have no measurement. */
  offsetPx: number | null;
  /** True when we know someone is off but not by how much. */
  unknown: boolean;
};

/** Signed, mono-friendly drift. Under a second stays in ms; past that, seconds. */
function formatDrift(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const magnitude = Math.abs(ms);
  if (magnitude < 1000) return `${sign}${Math.round(magnitude)}ms`;
  return `${sign}${(magnitude / 1000).toFixed(1)}s`;
}

function driftToPixels(ms: number): number {
  const magnitude = Math.min(DRIFT_MAX_PX, DRIFT_SCALE * Math.sqrt(Math.abs(ms)));
  return ms < 0 ? -magnitude : magnitude;
}

/**
 * Thresholds mirror `Drift` exactly, so a row never claims a state the sync
 * controller is not in: under IGNORE it is doing nothing, up to SEEK it is
 * nudging the rate, past SEEK the correction is an audible skip.
 */
function syncFor(isOnAux: boolean, isMe: boolean, isSynced: boolean, driftMs: number): SyncState {
  if (isOnAux) {
    return { label: 'on aux', color: Colors.accent, offsetPx: 0, unknown: false };
  }

  if (isMe) {
    const magnitude = Math.abs(driftMs);
    const color =
      magnitude <= Drift.IGNORE
        ? Colors.accent
        : magnitude <= Drift.SEEK
          ? Colors.warn
          : Colors.danger;

    return {
      label: magnitude <= Drift.IGNORE && magnitude < 1 ? 'in sync' : formatDrift(driftMs),
      color,
      offsetPx: driftToPixels(driftMs),
      unknown: false,
    };
  }

  // Boolean only. Say what we know, draw no number we did not measure.
  if (isSynced) {
    return { label: 'in sync', color: Colors.accent, offsetPx: 0, unknown: false };
  }
  return { label: 'buffering', color: Colors.warn, offsetPx: null, unknown: true };
}

export function ParticipantStrip({ roomId, hostId, currentUserId }: ParticipantStripProps) {
  const { data, isLoading } = useRoomParticipants(roomId);
  // Read straight from the store rather than through a prop: this is the one
  // real measurement on the screen and it changes every 3s, so keeping it local
  // means a drift tick re-renders this list and nothing else.
  const driftMs = usePlayback((state) => state.driftMs);

  const { height: windowHeight } = useWindowDimensions();
  const rows = visibleRows(windowHeight);
  const maxHeight = rows * ROW_HEIGHT + (rows - 1) * ROW_GAP;

  const [width, setWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const playheadX = width * PLAYHEAD_RATIO;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ParticipantView>) => {
      const isMe = item.userId === currentUserId;
      return (
        <ParticipantRow
          participant={item}
          isOnAux={item.userId === hostId}
          isMe={isMe}
          // Only the viewer's own row consumes this. Handing everyone else a
          // constant keeps their props stable, so a 3s drift tick re-renders
          // exactly one row instead of the whole list.
          driftMs={isMe ? driftMs : 0}
          playheadX={playheadX}
          rowWidth={width}
        />
      );
    },
    [hostId, currentUserId, driftMs, playheadX, width]
  );

  const participants = data ?? [];

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>On the line</Text>

      <View onLayout={handleLayout} style={styles.rows}>
        {isLoading && !data ? (
          <View style={styles.skeletonWrap}>
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <View key={index} style={styles.row}>
                <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius={Radius.pill} />
                <Skeleton width={NAME_WIDTH} height={13} />
                <View style={styles.hairlineWrap}>
                  <View style={styles.hairline} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            data={participants}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={[styles.list, { maxHeight }]}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            accessibilityLabel={`${participants.length} ${
              participants.length === 1 ? 'person' : 'people'
            } in this Session`}
          />
        )}

        {/*
          THE line. Drawn over the rows, never between them — a 1px accent rule
          with two wider, fainter siblings standing in for a glow, since no
          box-shadow renders the same way on iOS, Android and web.
        */}
        {width > 0 ? (
          <>
            <View
              style={[styles.playheadGlow, { left: playheadX - 5 }, PointerEvents.none]}
            />
            <View style={[styles.playhead, { left: playheadX }, PointerEvents.none]} />
          </>
        ) : null}
      </View>
    </View>
  );
}

const keyExtractor = (item: ParticipantView) => item.userId;

type ParticipantRowProps = {
  participant: ParticipantView;
  isOnAux: boolean;
  isMe: boolean;
  /** The viewer's own measured drift. Only applied to the viewer's own row. */
  driftMs: number;
  playheadX: number;
  rowWidth: number;
};

const ParticipantRow = memo(function ParticipantRow({
  participant,
  isOnAux,
  isMe,
  driftMs,
  playheadX,
  rowWidth,
}: ParticipantRowProps) {
  const name = isMe ? 'You' : participant.displayName;

  const sync = useMemo(
    () => syncFor(isOnAux, isMe, participant.isSynced, driftMs),
    [isOnAux, isMe, participant.isSynced, driftMs]
  );

  // Clamped to the hairline's own span so a badly desynced dot pins to the end
  // of the track instead of floating over the avatar or the readout.
  const trackStart = AVATAR_SIZE + Space.md - 1 + NAME_WIDTH + Space.md - 1;
  const trackEnd = Math.max(trackStart, rowWidth - READOUT_WIDTH - (Space.md - 1) - DOT_SIZE);
  const dotLeft = Math.min(
    trackEnd,
    Math.max(trackStart, playheadX + (sync.offsetPx ?? 0) - DOT_SIZE / 2)
  );

  return (
    <View
      accessible
      accessibilityLabel={`${name}, ${sync.unknown ? 'buffering, amount unknown' : sync.label}`}
      style={styles.row}>
      <Avatar
        uri={participant.avatarUrl}
        name={participant.displayName}
        size={AVATAR_SIZE}
        live={isOnAux}
      />

      <Text numberOfLines={1} style={[styles.name, isOnAux ? styles.nameOnAux : null]}>
        {name}
      </Text>

      <View style={styles.hairlineWrap}>
        <View style={styles.hairline} />
      </View>

      {/*
        Text, not just the dot: a coloured dot alone is a colour-only signal, and
        where each listener sits is the single most important fact on this list.
      */}
      <Text numberOfLines={1} style={[styles.readout, { color: sync.color }]}>
        {sync.label}
      </Text>

      {playheadX > 0 ? (
        <View
          style={[
            styles.dot,
            { left: dotLeft },
            sync.unknown
              ? { borderColor: sync.color, borderWidth: 1.5 }
              : { backgroundColor: sync.color },
            PointerEvents.none,
          ]}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    gap: Space.md,
  },
  eyebrow: {
    ...Type.monoLabel,
    // Not Colors.faint: this is a label people read, not a divider.
    color: Colors.muted,
  },
  rows: {
    position: 'relative',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: ROW_GAP,
  },
  skeletonWrap: {
    gap: ROW_GAP,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md - 1,
    height: ROW_HEIGHT,
  },
  name: {
    ...Type.label,
    color: Colors.muted,
    width: NAME_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  nameOnAux: {
    color: Colors.text,
  },
  hairlineWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  hairline: {
    height: 1,
    backgroundColor: Colors.border,
  },
  readout: {
    ...Type.mono,
    width: READOUT_WIDTH,
    textAlign: 'right',
    flexGrow: 0,
    flexShrink: 0,
  },
  dot: {
    position: 'absolute',
    top: (ROW_HEIGHT - DOT_SIZE) / 2,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: Radius.pill,
  },
  playhead: {
    position: 'absolute',
    top: -Space.xs,
    bottom: -Space.xs,
    width: 1,
    backgroundColor: Colors.accent,
    opacity: 0.55,
  },
  playheadGlow: {
    position: 'absolute',
    top: -Space.xs,
    bottom: -Space.xs,
    width: 11,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    opacity: 0.1,
  },
});
