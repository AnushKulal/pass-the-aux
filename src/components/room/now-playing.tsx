/**
 * The Session stage: the artwork, the title, the scrubber and the sync readout.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSession`: the hero
 * card at L918-L950 (82px art well, 21px title, provider chip, the 6px coral
 * scrubber with its thumb) and the sync row at L952-L961 (the pulsing dot, the
 * rung word, the drift figure and the "Hard seek" pill).
 *
 * THE ACCENT SPLIT, DRAWN HERE, AND THIS FILE USED TO SHIP BOTH ANSWERS AT ONCE:
 *   CORAL is STATE — the scrubber's fill, the sync dot, the rung word and the
 *   drift figure, because playing and being in sync are true of the world right
 *   now;
 *   BLUE is every ACTION on this screen without exception — "Add a track" on
 *   the empty face, "Hard seek" in the sync row, "Retry" on the failure card,
 *   and the 66px play circle in 'transport-controls.tsx';
 *   PINK-RED (`danger`) is FAILURE, which is the playback-error card and
 *   nothing else here.
 * The sync row used to draw a CORAL button while the error card forty lines
 * below it drew a BLUE one, so one component argued both sides. The rule is
 * that on a live object the BADGE is coral and the BUTTON is blue: the sync row
 * kept its coral readout and lost its coral button.
 * The card's corner bleed is `glow="live"` for the same reason, and it is gated
 * on a track EXISTING rather than on `isPlaying`: `GlassCard` changes its own
 * tree shape when `glow` toggles, so a bleed that followed play/pause would
 * remount the artwork `Image` on every tap.
 *
 * Four things are load-bearing:
 *
 *  - The `media` slot is rendered unconditionally, in a FIXED tree position, as
 *    the first child of the root in EVERY branch. It holds the YouTube player
 *    host, and unmounting that mid-song stops the audio for this listener. It
 *    lives OUTSIDE the card on purpose — the card is the one thing here whose
 *    structure changes between states, and the WebView must not be downstream
 *    of that. When YouTube is the active provider the slot becomes a 16:9 stage
 *    (the design's own video layout, L1010); otherwise it parks at 1x1 and
 *    keeps playing.
 *  - The playhead is driven by a local 250ms ticker over
 *    `expectedPositionMs(timeline)`, never by asking the adapter. On Spotify,
 *    `getPosition()` is a rate-limited HTTP call.
 *  - The sync readout loses the coral as drift grows; it never turns amber,
 *    because there is no amber. See './drift'.
 *  - The artwork tile is a dark WELL (`artwork` + `artInk`), not a bright plate.
 *    It used to carry `bloom(C.glow, 'lg')`; `glow` is the BLUE primary glow in
 *    this direction, so that would have haloed the album art in the action
 *    colour. The card's coral corner bleed does that job now.
 *
 * FOUR states, all drawn here rather than swapped in by the screen:
 *
 *   loading    skeletons in the real layout
 *   empty      loaded, nothing on the deck — and the action that fixes it
 *   error      what failed, and the button that fixes it
 *   populated  the artboard
 *
 * THE EMPTY STATE IS A BUG FIX. This component used to key everything off
 * `waiting = isLoading && !track`, so a Session that had FINISHED loading with
 * nothing on the deck fell through to the populated branch and drew a full
 * scrubber reading `0:00 / 0:00` plus a `LOCKED +0ms` sync readout — a hero
 * that looked like it was playing silence. `empty` is now its own face: no
 * scrubber, no clocks, no sync row, and a CTA where the transport readout was.
 */

import { Image } from 'expo-image';
import { Disc3, MoreHorizontal, Plus, RotateCw } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import {
  AuxButton,
  BLURHASH_SURFACE,
  CircleIconButton,
  GlassCard,
  LivePulse,
  ProgressBar,
  Skeleton,
  StatusPill,
} from '@/components/ui';
import {
  Duration,
  Fonts,
  GRID,
  PointerEvents,
  Radii,
  Rule,
  Space,
  Type,
  pressedSoft,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { expectedPositionMs, type RoomTimeline } from '@/playback/sync-controller';
import { usePlaybackProviderName } from '@/playback/store';
import type { ResolvedTrack } from '@/playback/types';

import {
  RUNG_LABEL,
  driftRung,
  formatClock,
  formatDrift,
  formatRemaining,
  initialFor,
  readout,
  rungColor,
} from './drift';

/** 4Hz: smooth enough that the bar never visibly steps, cheap enough to ignore. */
const TICK_MS = 250;
/** Screen-reader adjust step on the scrubber. */
const NUDGE_MS = 10_000;

/** L922: the art well is 82 square on a 22 corner. */
const ART = 82;
const ART_RADIUS = 22;

/** L930: the transport bar. The 14px thumb overhangs it by 4px top and bottom. */
const BAR = 6;

/**
 * Takes the 6px bar the rest of the way to the 44px floor. Asymmetric on
 * purpose: there is a 14px thumb hanging off the top and bottom already, and
 * the slop only has to cover what the thumb does not.
 */
const SCRUB_SLOP = { top: 15, bottom: 15, left: 0, right: 0 } as const;

export type NowPlayingProps = {
  /** The YouTube player host. Always mounted, never conditionally rendered. */
  media: ReactNode;
  /** True when the active provider is YouTube and the stage should show video. */
  showMedia: boolean;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  isLoading: boolean;
  driftMs: number;
  /** Re-measures the clock offset and seeks back onto the room's position. */
  onResync: () => void;
  /** Opens the lobby controls. */
  onMore: () => void;
  /** Whoever is on aux. Absent for passengers, who get no scrubber at all. */
  onSeek?: (positionMs: number) => void;
  /**
   * Opens the add-track flow from the EMPTY face. Optional so the screen keeps
   * compiling untouched — without it the empty card still reads as empty, it
   * just cannot offer the way out from here. Wire it and the separate
   * `QueuePrompt` on the Session screen becomes redundant.
   */
  onAddTrack?: () => void;
  errorMessage?: string | null;
};

export function NowPlaying({
  media,
  showMedia,
  track,
  timeline,
  isLoading,
  driftMs,
  onResync,
  onMore,
  onSeek,
  onAddTrack,
  errorMessage,
}: NowPlayingProps) {
  const C = useColors();

  /*
    Read straight from the playback store rather than taken as a prop: the
    adapter is the only thing that knows which service is actually producing
    sound, and threading it through the screen would mean editing a file this
    pass does not own. One primitive, so this re-renders only when the provider
    genuinely changes.
  */
  const provider = usePlaybackProviderName();

  const durationMs = track?.duration_ms ?? 0;
  const trackWidth = useRef(0);

  /*
    The playhead is a clock, so it is READ at render rather than mirrored into
    state: `expectedPositionMs` is pure arithmetic over the room row and the
    corrected server time, and the only thing the timer has to do is ask for
    another frame.
  */
  const [, requestFrame] = useState(0);

  useEffect(() => {
    // A paused Session's position is a constant; there is nothing to animate.
    if (!timeline?.isPlaying) return;

    const timer = setInterval(() => requestFrame((frame) => frame + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [timeline]);

  const rawPosition = timeline ? expectedPositionMs(timeline) : 0;
  const positionMs = durationMs > 0 ? Math.min(rawPosition, durationMs) : rawPosition;
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;

  const rung = driftRung(driftMs);
  const rungTint = rungColor(rung, C);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    trackWidth.current = event.nativeEvent.layout.width;
  }, []);

  const handleScrub = useCallback(
    (event: GestureResponderEvent) => {
      if (!onSeek || durationMs <= 0 || trackWidth.current <= 0) return;
      const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth.current));
      onSeek(ratio * durationMs);
    },
    [onSeek, durationMs]
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (!onSeek || durationMs <= 0) return;
      const delta = event.nativeEvent.actionName === 'increment' ? NUDGE_MS : -NUDGE_MS;
      onSeek(Math.min(durationMs, Math.max(0, positionMs + delta)));
    },
    [onSeek, durationMs, positionMs]
  );

  /*
    THE THREE FACES, AND THEY ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION.

    `empty` is what the old code was missing: loaded, and genuinely nothing on
    the deck. Deriving it as `!waiting && !track` rather than `!isLoading &&
    !track` means the two can never both be true even if `isLoading` flickers.
  */
  const waiting = isLoading && !track;
  const empty = !waiting && !track;

  const subtitle = track ? (track.album ? `${track.artist} · ${track.album}` : track.artist) : null;

  return (
    <View style={styles.root}>
      {/*
        ONE position in the tree, in every branch, and deliberately not inside
        the card — see the file header. Parking it (1x1, transparent) rather
        than unmounting keeps the WebView alive and the music playing.
      */}
      <View
        style={[
          showMedia ? styles.stage : styles.stageParked,
          showMedia ? { borderColor: C.rule } : null,
          showMedia ? PointerEvents.auto : PointerEvents.none,
        ]}>
        {media}
      </View>

      <GlassCard glow={track ? 'live' : undefined}>
        <View style={styles.meta}>
          {showMedia ? null : (
            <ArtSlot
              waiting={waiting}
              title={track?.title ?? null}
              artworkUrl={track?.artwork_url ?? null}
            />
          )}

          <View style={styles.metaText}>
            {waiting ? (
              <View style={styles.metaSkeleton}>
                <Skeleton width={164} height={21} radius={Radii.xs} />
                <Skeleton width={104} height={13} radius={Radii.xs} />
              </View>
            ) : (
              <>
                <Text numberOfLines={2} style={[styles.title, { color: C.ink }]}>
                  {track?.title ?? 'Nothing on the deck'}
                </Text>
                <Text numberOfLines={1} style={[styles.artist, { color: C.ink2 }]}>
                  {subtitle ?? 'The Session is waiting for its first track'}
                </Text>
                {/*
                  L923: the source badge. `outline` is `surface2` behind a
                  hairline — the register for everything the accent may not
                  claim, and a provider name is not a state of the Session.
                */}
                {track && provider ? (
                  <View style={styles.provider}>
                    <StatusPill label={provider} tone="outline" size="sm" />
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/*
            The lobby controls. The artboard hangs these off the Session header
            rather than the card, but that header is not this component's to
            draw, and dropping the control would make the game, the mic and the
            change-lobby sheet unreachable from the player.
          */}
          <CircleIconButton
            icon={MoreHorizontal}
            size={36}
            tone="ghost"
            accessibilityLabel="Session controls"
            onPress={onMore}
          />
        </View>

        {empty ? (
          <View style={styles.emptyBody}>
            <Text style={[styles.emptyLine, { color: C.ink2 }]}>
              Anyone in the Session can queue the first track. Nothing plays until someone does.
            </Text>
            {onAddTrack ? (
              <AuxButton
                label="Add a track"
                variant="pri"
                size="md"
                icon={Plus}
                align="center"
                onPress={onAddTrack}
                fullWidth
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.scrubWrap}>
            <Pressable
              disabled={!onSeek || waiting}
              onLayout={handleLayout}
              onPress={handleScrub}
              accessible
              accessibilityRole={onSeek ? 'adjustable' : 'progressbar'}
              accessibilityLabel="Playback position"
              accessibilityHint={onSeek ? 'Tap anywhere on the bar to seek' : undefined}
              accessibilityValue={{
                min: 0,
                max: Math.max(1, Math.round(durationMs / 1000)),
                now: Math.round(positionMs / 1000),
                text: `${formatClock(positionMs)} of ${formatClock(durationMs)}`,
              }}
              accessibilityActions={
                onSeek ? [{ name: 'increment' }, { name: 'decrement' }] : undefined
              }
              onAccessibilityAction={handleAccessibilityAction}
              hitSlop={SCRUB_SLOP}
              style={styles.scrubHit}>
              {/*
                The thumb is drawn only for whoever can actually move it — a
                draggable-looking head on a passenger's bar is a control that
                does nothing. The glow is the design's `0 0 12px` under the
                fill (L931), and it is coral because a filling bar is a thing
                PLAYING, not a thing you are being asked to do.
              */}
              <ProgressBar
                progress={waiting ? 0 : progress}
                height={BAR}
                glow={!waiting}
                thumb={Boolean(onSeek) && !waiting}
              />
            </Pressable>

            <View style={styles.times}>
              <Text style={[styles.time, { color: C.ink3 }]}>
                {waiting ? '—' : formatClock(positionMs)}
              </Text>
              <Text style={[styles.time, { color: C.ink3 }]}>
                {waiting || durationMs <= 0 ? '—' : formatRemaining(durationMs - positionMs)}
              </Text>
            </View>
          </View>
        )}
      </GlassCard>

      {/*
        L952-L961. Hidden on the empty face: "LOCKED +0ms" against nothing is
        the same lie the 0:00 scrubber was telling.
      */}
      {empty ? null : (
        <SyncRow
          waiting={waiting}
          label={waiting ? 'Finding the beat' : `You are ${RUNG_LABEL[rung]}`}
          drift={waiting ? null : formatDrift(driftMs)}
          tint={waiting ? C.ink3 : rungTint}
          onResync={onResync}
        />
      )}

      {errorMessage ? <PlaybackError message={errorMessage} onRetry={onResync} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- art slot

type ArtSlotProps = {
  waiting: boolean;
  title: string | null;
  artworkUrl: string | null;
};

/**
 * Four faces of one 82px square (L922).
 *
 * The tile is a dark WELL in this direction — `artwork` behind a `rule`
 * hairline, with the monogram in `artInk` at 22% white. Code carried over from
 * the previous direction assumed a BRIGHT plate and drew dark ink on it; that
 * is now invisible. `pressedSoft` rather than `pressed`: at 82px the deep
 * recess eats the letter.
 */
const ArtSlot = memo(function ArtSlot({ waiting, title, artworkUrl }: ArtSlotProps) {
  const C = useColors();

  if (waiting) {
    return <Skeleton width={ART} height={ART} radius={ART_RADIUS} />;
  }

  return (
    <View
      accessible={title === null}
      accessibilityLabel={title === null ? 'Nothing playing' : undefined}
      style={[
        styles.art,
        { backgroundColor: C.artwork, borderColor: C.rule },
        pressedSoft(C),
      ]}>
      {title === null ? (
        <Disc3 size={30} strokeWidth={1.6} color={C.ink3} />
      ) : artworkUrl ? (
        <Image
          source={{ uri: artworkUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.press}
          accessibilityIgnoresInvertColors
          accessibilityLabel={`Artwork for ${title}`}
        />
      ) : (
        <Text style={[styles.artInitial, { color: C.artInk }]}>{initialFor(title)}</Text>
      )}
    </View>
  );
});

// ----------------------------------------------------------------- sync row

type SyncRowProps = {
  waiting: boolean;
  label: string;
  /** Null while there is nothing measured yet. */
  drift: string | null;
  tint: string;
  onResync: () => void;
};

/**
 * L952-L961: the pulsing dot, the rung word, the drift figure, and the one
 * control that fixes a drifting listener.
 *
 * CORAL READOUT, BLUE BUTTON, AND THE ROW USED TO ARGUE OTHERWISE.
 *
 * The reading is coral: being in sync is a state of the world, and the dot and
 * the figure step DOWN the neutral ramp as drift grows (see `rungColor`) —
 * losing the coral is the whole signal.
 *
 * The button is not part of that reading. `Hard seek` used to be
 * `variant="liveOutline"`, defended here by a paragraph that read "ALL CORAL,
 * AND THAT IS THE POINT... this row takes the state accent even though it ends
 * in a button". That was the inversion the accent rule exists to prevent:
 * re-anchoring is a thing you DO, not a thing that is true, and the rule is
 * explicit that on a live object the badge is coral and the button is blue.
 * `PlaybackError` forty lines below already drew the correct answer, so the
 * file shipped both. It is `pri` now, matching that button and matching
 * `ResyncFooter` in 'app/room/[id].tsx', which offers the identical re-measure.
 *
 * `Hard seek` is `onResync`, which used to be a bare rotate glyph tucked beside
 * the track title where nothing said what it did.
 */
const SyncRow = memo(function SyncRow({ waiting, label, drift, tint, onResync }: SyncRowProps) {
  const C = useColors();

  return (
    <View style={styles.sync}>
      {/* `synced` IS this dot's tempo in the artboards (L955). It slows while
          there is nothing measured yet, so a blink never reads as a reading. */}
      <LivePulse size={8} color={tint} tempo={waiting ? 'session' : 'synced'} />

      <Text numberOfLines={1} style={[styles.syncLabel, { color: waiting ? C.ink3 : C.ink }]}>
        {label}
      </Text>

      {drift ? <Text style={[styles.syncDrift, { color: tint }]}>{drift}</Text> : null}

      <View style={styles.syncSpacer} />

      <AuxButton label="Hard seek" variant="pri" size="sm" icon={RotateCw} onPress={onResync} />
    </View>
  );
});

// -------------------------------------------------------------- error card

/**
 * What broke, and the one control that fixes it.
 *
 * Almost every playback failure on this screen is a clock or a device problem,
 * and re-anchoring is the answer to both — so the card carries that action
 * rather than a bare apology.
 *
 * IT IS `danger` NOW, AND IT USED TO BE `live`. This shipped as
 * `GlassCard tone="live"` with a `liveText` kicker, argued for right here in a
 * comment that read "THE CARD IS CORAL AND THE BUTTON IS BLUE... it is not
 * `danger`, that hue is reserved for destruction, and a stalled track destroys
 * nothing". Both halves of that were wrong. 'glass-card.tsx' documents
 * `tone="live"` as "`liveWash` fill behind a `liveMid` edge: this card is
 * happening right now", so wrapping a STOP failure in it inverted the app's
 * most-used state signal on its busiest screen — the one card saying playback
 * has ended wore the badge that means playback is under way. And `danger` is
 * the hue for destruction AND FAILURE: 'ui/text-field.tsx' has always painted a
 * rejected field with it and 'ui/toast.tsx' has always painted a failed action
 * with it. An error is not a live state.
 *
 * A plain `View` rather than a `GlassCard`, because `GlassCardTone` offers
 * `default` and `live` only and forcing the fill through `style` would fight
 * that component's documented "the card's own skin is not overridable"
 * contract. This is the same `dangerWash` fill behind a `dangerBorder` edge
 * that the app's other two failure surfaces already draw as plain Views — see
 * the refusal card in 'app/(tabs)/lounge/create.tsx' and the bad-code notice in
 * 'components/lounge/join-code-modal.tsx'.
 *
 * The button stays BLUE, which is the half the old comment had right: the card
 * reports what happened, the button is the thing you do about it.
 */
const PlaybackError = memo(function PlaybackError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const C = useColors();

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.errorCard, { backgroundColor: C.dangerWash, borderColor: C.dangerBorder }]}>
      <View style={styles.errorMeta}>
        <Text style={[styles.errorKicker, { color: C.danger }]}>Playback stopped</Text>
        <Text style={[styles.errorBody, { color: C.ink2 }]}>{message}</Text>
      </View>

      {/*
        `AuxButton` sizes itself with `alignSelf: 'flex-start'`, so on a message
        long enough to wrap the Retry cell would ride up against the kicker. The
        wrapper is what centres it against a growing message.
      */}
      <View style={styles.errorAction}>
        <AuxButton label="Retry" variant="pri" size="sm" onPress={onRetry} />
      </View>
    </View>
  );
});

// ------------------------------------------------------------ modular grid

/**
 * The 25px modular grid, kept here because the sync orbit's dial draws it too.
 * It only ever appears inside a well, never across a whole screen.
 */
export const ModularGrid = memo(function ModularGrid({ step = GRID }: { step?: number }) {
  const C = useColors();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    );
  }, []);

  const columns = size.width > 0 ? Math.ceil(size.width / step) : 0;
  const rows = size.height > 0 ? Math.ceil(size.height / step) : 0;

  return (
    <View
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, PointerEvents.none]}>
      {Array.from({ length: columns }, (_, index) => index * step).map((left) => (
        <View key={`c${left}`} style={[styles.gridColumn, { left, backgroundColor: C.grid }]} />
      ))}
      {Array.from({ length: rows }, (_, index) => index * step).map((top) => (
        <View key={`r${top}`} style={[styles.gridRow, { top, backgroundColor: C.grid }]} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },

  // ------------------------------------------------------- the video stage
  /**
   * L1010: the design's video surface is 16:9 inside the card's own corner.
   *
   * The fill stays a literal black rather than a token — this is a letterbox
   * behind a WebView, and a theme-aware "surface" behind video reads as a
   * rendering fault the instant the frame is narrower than the box.
   *
   * NO SHADOW ON PURPOSE, matching the artboard, where the stage is a clipped
   * child and the CARD does the lifting. Android drops a view's own boxShadow
   * when that view also clips, so a `raised()` here would lift on iOS and web
   * and silently do nothing on Android — a divergence for a decoration.
   */
  stage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 24,
    borderWidth: Rule.hair,
    backgroundColor: '#000000',
    overflow: 'hidden',
    marginBottom: Space.md,
  },
  /** Mounted and audible, out of the layout, effectively invisible. */
  stageParked: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },

  // -------------------------------------------------------------- the head
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 2,
  },
  metaText: {
    flex: 1,
    minWidth: 0,
  },
  metaSkeleton: {
    gap: Space.sm,
    paddingVertical: Space.xs,
  },
  title: {
    ...Type.display(21),
    lineHeight: 24,
    letterSpacing: tracking(21, -0.02),
  },
  artist: {
    ...Type.body(13),
    lineHeight: 17,
    marginTop: 3,
  },
  provider: {
    flexDirection: 'row',
    marginTop: Space.sm,
  },

  // ------------------------------------------------------------- the well
  art: {
    width: ART,
    height: ART,
    borderRadius: ART_RADIUS,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artInitial: {
    fontFamily: Fonts.extrabold,
    fontSize: 34,
    letterSpacing: tracking(34, -0.02),
  },

  // --------------------------------------------------------- the scrubber
  scrubWrap: {
    marginTop: Space.lg,
  },
  /**
   * 4px of air above and below the 6px bar, which is exactly the overhang of
   * the 14px thumb. Without it the head is clipped by the card's own padding
   * on the first and last frame of a track.
   */
  scrubHit: {
    paddingVertical: 4,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  time: {
    fontFamily: Fonts.semibold,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },

  // ------------------------------------------------------- the empty face
  emptyBody: {
    marginTop: Space.lg,
    gap: Space.md,
  },
  emptyLine: {
    ...Type.body(12.5),
    lineHeight: 18,
  },

  // ---------------------------------------------------------- the sync row
  sync: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    marginTop: Space.md + 2,
    paddingHorizontal: Space.xs,
  },
  syncLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, -0.005),
    flexShrink: 1,
  },
  /**
   * `readout()` from './drift' rather than `Type.readout` directly: the token
   * freezes its `fontVariant` tuple with `as const`, and one readonly tuple
   * inside `StyleSheet.create` collapses the inferred type of EVERY entry in
   * this sheet.
   */
  syncDrift: readout(13),
  syncSpacer: {
    flex: 1,
    minWidth: Space.sm,
  },

  // ------------------------------------------------------------ error card
  /**
   * `GlassCard variant="row"`'s geometry, written out because the card is no
   * longer a `GlassCard` — see `PlaybackError`. Radius 18 and `Space.md` of
   * padding are exactly what that variant applies, so the failure card still
   * sits in the same grammar as every other row-card on the screen; only the
   * fill and the edge moved to the danger family.
   */
  errorCard: {
    marginTop: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
  },
  errorMeta: {
    flex: 1,
    minWidth: 0,
  },
  errorAction: {
    flexShrink: 0,
    alignSelf: 'center',
  },
  errorKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.14),
  },
  errorBody: {
    ...Type.body(13),
    marginTop: 2,
  },

  // --------------------------------------------------------- modular grid
  gridColumn: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
});
