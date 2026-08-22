/**
 * Who is in the Session, and where each of them actually is.
 *
 * Two views of the same fact, both exported from here because both are the
 * roster drawn against the drift ladder:
 *
 *   `ParticipantStrip` — the drift chart. One 44px row per listener: avatar,
 *   first name, a ±400ms deviation plot against a centre axis, the drift
 *   readout, the rung. This is the thing that makes the sync engine visible.
 *
 *   `SyncOrbit` — the same people plotted as distance from a centre. Rings at
 *   ±40 (2px accent) and ±220 (dashed). The LEGEND IS A NORMAL-FLOW SIBLING of
 *   the dial, never absolutely positioned inside it: a listener who lands in
 *   the bottom slot sits exactly where an inset legend would be.
 *
 * Both are FlatLists that take the rest of the screen as `header`/`footer`, so
 * the Session has exactly one scroller and the roster stays virtualised.
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

import { Image } from 'expo-image';
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

import { BLURHASH_SURFACE, Skeleton } from '@/components/ui';
import { PointerEvents, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
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

const GUTTER = Space.md;
const TILE = 28;
const ORBIT_TILE = 30;
const NAME_WIDTH = 46;
const PLOT_HEIGHT = 22;
const MARK_WIDTH = 3;
const MARK_HEIGHT = 12;
const SKELETON_ROWS = 3;
const TICK_MS = 250;

/** The dial and its rings, straight off the artboard. All squares — radius 0. */
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

export type ParticipantStripProps = {
  roomId: string | null;
  hostId: string | null;
  currentUserId: string | null;
  /** Everything above the chart. The Session hands it the whole player. */
  header?: ReactNode;
  /** Everything below it. */
  footer?: ReactNode;
  /** Tapping a row opens that person's voice controls. Not wired this pass. */
  onSelectPerson?: (userId: string) => void;
  contentBottomInset?: number;
};

export function ParticipantStrip({
  roomId,
  hostId,
  currentUserId,
  header,
  footer,
  onSelectPerson,
  contentBottomInset = 0,
}: ParticipantStripProps) {
  const C = useColors();
  const { data, isLoading } = useRoomParticipants(roomId);
  // Read straight from the store rather than through a prop: this is the one
  // real measurement on the screen and it changes every 3s, so keeping it local
  // means a drift tick re-renders this list and nothing else.
  const driftMs = usePlayback((state) => state.driftMs);

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
          onSelect={onSelectPerson}
        />
      );
    },
    [hostId, currentUserId, driftMs, onSelectPerson]
  );

  const participants = data ?? [];

  return (
    <FlatList
      data={participants}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: contentBottomInset }}
      ListHeaderComponent={
        <>
          {header}
          <View style={[styles.sectionHead, { borderTopColor: C.rule }]}>
            <Text style={[styles.sectionKicker, { color: C.ink3 }]}>
              Drift — every listener, live
            </Text>
            <Text style={[styles.sectionScale, { color: C.ink3 }]}>±400ms</Text>
          </View>
          {isLoading && !data ? <ChartSkeleton /> : null}
        </>
      }
      ListFooterComponent={
        <>
          <Text style={[styles.ladderNote, { color: C.ink3 }]}>
            Under 40ms we leave it alone. Under 220ms the playback rate nudges ±2% — inaudible.
            Past that it&apos;s a hard seek, and you hear it.
          </Text>
          {footer}
        </>
      }
    />
  );
}

const keyExtractor = (item: ParticipantView) => item.userId;

type DriftRowProps = {
  participant: ParticipantView;
  isOnAux: boolean;
  isMe: boolean;
  /** The viewer's own measured drift. Only applied to the viewer's own row. */
  driftMs: number;
  onSelect?: (userId: string) => void;
};

const DriftRow = memo(function DriftRow({
  participant,
  isOnAux,
  isMe,
  driftMs,
  onSelect,
}: DriftRowProps) {
  const C = useColors();

  const reading = useMemo(
    () => readingFor(isMe, participant.isSynced, driftMs, C),
    [isMe, participant.isSynced, driftMs, C]
  );

  const name = isMe ? 'You' : firstNameOf(participant.displayName);
  const label = `${isMe ? 'You' : participant.displayName}${isOnAux ? ', on aux' : ''}, ${
    reading.measured ? `off by ${reading.value}, ${reading.rung}` : reading.rung
  }`;

  const body = (
    <>
      <InitialTile
        name={participant.displayName}
        avatarUrl={participant.avatarUrl}
        size={TILE}
        onAux={isOnAux}
        live={reading.color === C.liveText}
      />

      <Text numberOfLines={1} style={[styles.rowName, { color: reading.color }]}>
        {name}
      </Text>

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

      <Text numberOfLines={1} style={[styles.rowRung, { color: C.ink3 }]}>
        {reading.rung}
      </Text>
    </>
  );

  if (!onSelect) {
    return (
      <View accessible accessibilityLabel={label} style={[styles.row, { borderTopColor: C.ruleSoft }]}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens voice controls for this person"
      onPress={() => onSelect(participant.userId)}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: C.ruleSoft },
        pressed ? { backgroundColor: C.surface } : null,
      ]}>
      {body}
    </Pressable>
  );
});

const ChartSkeleton = memo(function ChartSkeleton() {
  const C = useColors();

  return (
    <View>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View key={index} style={[styles.row, { borderTopColor: C.ruleSoft }]}>
          <Skeleton width={TILE} height={TILE} radius={0} />
          <Skeleton width={NAME_WIDTH} height={12} radius={0} />
          <View style={styles.plot}>
            <View style={[styles.axis, { backgroundColor: C.rule3 }]} />
          </View>
        </View>
      ))}
    </View>
  );
});

// ------------------------------------------------------------- sync orbit

export type SyncOrbitProps = {
  roomId: string | null;
  hostId: string | null;
  currentUserId: string | null;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  header?: ReactNode;
  footer?: ReactNode;
  onSelectPerson?: (userId: string) => void;
  contentBottomInset?: number;
};

export function SyncOrbit({
  roomId,
  hostId,
  currentUserId,
  track,
  timeline,
  header,
  footer,
  onSelectPerson,
  contentBottomInset = 0,
}: SyncOrbitProps) {
  const C = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const { data } = useRoomParticipants(roomId);
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
  const dialWidth = Math.min(windowWidth, 720);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ParticipantView>) => {
      const isMe = item.userId === currentUserId;
      return (
        <OrbitRow
          participant={item}
          isOnAux={item.userId === hostId}
          isMe={isMe}
          driftMs={isMe ? driftMs : 0}
          onSelect={onSelectPerson}
        />
      );
    },
    [hostId, currentUserId, driftMs, onSelectPerson]
  );

  return (
    <FlatList
      data={participants}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: contentBottomInset }}
      ListHeaderComponent={
        <>
          {header}

          <View style={[styles.orbitHead, { borderBottomColor: C.rule }]}>
            <Text style={[styles.sectionKicker, { color: C.ink3 }]}>
              Distance from centre = drift
            </Text>
            <Text style={[styles.orbitScale, { color: C.ink2 }]}>±400ms</Text>
          </View>

          <View
            accessible
            accessibilityLabel={`Sync orbit. ${participants.length} ${
              participants.length === 1 ? 'listener' : 'listeners'
            } plotted by how far they are from the Session's position.`}
            style={[
              styles.dial,
              { backgroundColor: C.bgRecessed, borderBottomColor: C.rule },
            ]}>
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
                  backgroundColor: C.bg,
                  left: dialWidth / 2 - DIAL_CORE / 2,
                  top: DIAL_CENTRE_Y - DIAL_CORE / 2,
                },
              ]}>
              <Text style={[styles.dialInitial, { color: C.artwork }]}>
                {initialFor(track?.title)}
              </Text>
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
          <View style={[styles.legend, { borderBottomColor: C.rule }]}>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: C.live }]} />
              <Text style={[styles.legendLabel, { color: C.liveText }]}>±40 locked</Text>
            </View>
            <View style={styles.legendItem}>
              <HatchSwatch />
              <Text style={[styles.legendLabel, { color: C.ink2 }]}>±220 nudge</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { borderWidth: Rule.hair, borderColor: C.ink2 }]} />
              <Text style={[styles.legendLabel, { color: C.ink2 }]}>Seek</Text>
            </View>
          </View>

          <View style={styles.orbitTitleBlock}>
            <Text numberOfLines={2} style={[styles.orbitTitle, { color: C.ink }]}>
              {track?.title ?? 'Nothing playing'}
            </Text>
            <Text numberOfLines={1} style={[styles.orbitArtist, { color: C.ink2 }]}>
              {track?.artist ?? 'Queue something to get started'}
            </Text>
          </View>
        </>
      }
      ListFooterComponent={
        <>
          <Text style={[styles.ladderNote, { color: C.ink3 }]}>
            Every reading here was written to sync_metrics. &ldquo;It feels synced&rdquo; is a
            measurement.
          </Text>
          {footer}
        </>
      }
    />
  );
}

/** One concentric square. Zero radius — the dial is a grid, not a gauge face. */
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
  driftMs: number;
  dialWidth: number;
};

const OrbitMarker = memo(function OrbitMarker({
  participant,
  index,
  total,
  isMe,
  isOnAux,
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
      <InitialTile
        name={participant.displayName}
        avatarUrl={participant.avatarUrl}
        size={ORBIT_TILE}
        onAux={isOnAux}
        live={reading.color === C.liveText}
      />
      <Text numberOfLines={1} style={[styles.markerLabel, { color: reading.color }]}>
        {reading.value}
      </Text>
    </View>
  );
});

type OrbitRowProps = {
  participant: ParticipantView;
  isOnAux: boolean;
  isMe: boolean;
  driftMs: number;
  onSelect?: (userId: string) => void;
};

const OrbitRow = memo(function OrbitRow({
  participant,
  isOnAux,
  isMe,
  driftMs,
  onSelect,
}: OrbitRowProps) {
  const C = useColors();
  const reading = readingFor(isMe, participant.isSynced, driftMs, C);

  const content = (
    <>
      <InitialTile
        name={participant.displayName}
        avatarUrl={participant.avatarUrl}
        size={ORBIT_TILE}
        onAux={isOnAux}
        live={reading.color === C.liveText}
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
  }`;

  if (!onSelect) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={[styles.orbitRow, { borderBottomColor: C.ruleSoft }]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onSelect(participant.userId)}
      style={({ pressed }) => [
        styles.orbitRow,
        { borderBottomColor: C.ruleSoft },
        pressed ? { backgroundColor: C.surface } : null,
      ]}>
      {content}
    </Pressable>
  );
});

// ------------------------------------------------------------------ parts

type InitialTileProps = {
  name: string;
  avatarUrl: string | null;
  size: number;
  onAux: boolean;
  live: boolean;
};

/**
 * A square letter tile, with a real photo dropping straight over it. Accent
 * fill is reserved for the person on aux — they are the timeline everyone else
 * is measured against, which is the literal meaning of the colour here.
 */
const InitialTile = memo(function InitialTile({
  name,
  avatarUrl,
  size,
  onAux,
  live,
}: InitialTileProps) {
  const C = useColors();
  const box = { width: size, height: size };

  return (
    <View
      style={[
        styles.tile,
        box,
        {
          backgroundColor: onAux ? C.live : live ? C.avatar : C.surface3,
          borderWidth: live && !onAux ? Rule.major : Rule.hair,
          borderColor: live && !onAux ? C.live : C.rule2,
        },
      ]}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.tileInitial, { color: onAux ? C.onLive : live ? C.ink : C.ink2 }]}>
          {initialFor(name)}
        </Text>
      )}
    </View>
  );
});

/**
 * The 45° hatch that means "nudging" in the legend. React Native has no
 * repeating gradient, so it is three rotated bars in a clipped 9px box.
 */
const HatchSwatch = memo(function HatchSwatch() {
  const C = useColors();

  return (
    <View style={[styles.swatch, styles.hatch]}>
      {[-3, 1, 5].map((left) => (
        <View key={left} style={[styles.hatchBar, { left, backgroundColor: C.ink }]} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  // ------------------------------------------------------------- sections
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: Space.lg + 2,
    paddingHorizontal: GUTTER,
    paddingTop: Space.md - 2,
    paddingBottom: Space.sm,
    borderTopWidth: Rule.major,
  },
  sectionKicker: {
    ...Type.label(10),
    flexShrink: 1,
  },
  sectionScale: {
    ...readout(10),
    letterSpacing: tracking(10, 0.09),
  },
  ladderNote: {
    ...Type.body(16),
    paddingHorizontal: GUTTER,
    paddingTop: Space.md - 2,
    paddingBottom: Space.xl - 2,
  },

  // ---------------------------------------------------------- drift chart
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm + 1,
    borderTopWidth: Rule.hair,
  },
  rowName: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.02),
    width: NAME_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  plot: {
    flex: 1,
    minWidth: 56,
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
  },
  mark: {
    position: 'absolute',
    top: (PLOT_HEIGHT - MARK_HEIGHT) / 2,
    width: MARK_WIDTH,
    height: MARK_HEIGHT,
    marginLeft: -MARK_WIDTH / 2,
  },
  rowValue: {
    ...readout(12),
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'right',
  },
  rowRung: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.05),
    textTransform: 'uppercase',
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'right',
  },

  // ----------------------------------------------------------- sync orbit
  orbitHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md - 2,
    borderBottomWidth: Rule.hair,
  },
  orbitScale: {
    ...readout(10),
    letterSpacing: tracking(10, 0.09),
  },
  dial: {
    position: 'relative',
    height: DIAL_HEIGHT,
    overflow: 'hidden',
    borderBottomWidth: Rule.hair,
  },
  ring: {
    position: 'absolute',
    borderWidth: Rule.hair,
  },
  dialCore: {
    position: 'absolute',
    width: DIAL_CORE,
    height: DIAL_CORE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialInitial: {
    ...Type.display(30),
    lineHeight: 30,
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
    paddingHorizontal: GUTTER,
    paddingVertical: Space.md - 2,
    borderBottomWidth: Rule.major,
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
  swatch: {
    width: 9,
    height: 9,
    flexGrow: 0,
    flexShrink: 0,
  },
  hatch: {
    overflow: 'hidden',
  },
  hatchBar: {
    position: 'absolute',
    top: -5,
    width: 2,
    height: 19,
    transform: [{ rotate: '45deg' }],
  },

  orbitTitleBlock: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
  },
  orbitTitle: {
    ...Type.display(20),
    lineHeight: 22,
  },
  orbitArtist: {
    ...Type.body(16),
    marginTop: 2,
  },
  orbitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 1,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm + 1,
    borderBottomWidth: Rule.hair,
  },
  orbitRowMeta: {
    flex: 1,
    minWidth: 0,
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

  // ----------------------------------------------------------------- tile
  tile: {
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileInitial: {
    ...readout(12),
  },
});
