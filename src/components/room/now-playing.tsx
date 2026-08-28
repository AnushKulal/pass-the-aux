/**
 * The Session's track card: the artwork, the title, the source chip and the
 * scrubber. Plus the sync line that lives underneath it.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isSession`: the hero
 * card at L918-L935 (82px art well, 21px title, provider chip, the 6px coral
 * scrubber with its thumb over the two clocks) and the sync row at L952-L961
 * (the pulsing dot, the rung word, the drift figure, a (?) affordance and the
 * "Hard seek" pill).
 *
 * ------------------------------------------------------- what moved, and why
 *
 * TWO THINGS LEFT THIS FILE IN THIS PASS, both because the user's own session
 * screenshot puts them somewhere this component cannot reach.
 *
 * 1. THE VIDEO MODULE, and with it the `media` slot. This component used to
 *    mount the YouTube player host as the first child of its own root, which
 *    made `NowPlaying` un-unmountable: the Session had to keep the whole card
 *    on screen at all times or the music stopped, and that is exactly why the
 *    stage/switch order was upside down — the card ABOVE the toggle instead of
 *    inside it. The host now has a permanent address on the Session screen
 *    itself, one fixed position in that tree for the life of the route, and
 *    this card is free to be ordinary tab content that mounts and unmounts.
 *    `videoOnStage` is all that survives of the arrangement: when the video
 *    module is up there, the 82px artwork tile is a second, smaller copy of the
 *    same picture, so the card drops it.
 *
 * 2. THE SYNC ROW, now exported as `SessionSyncRow`. The artboard draws it as a
 *    SIBLING of the card — L952 opens a new block after the card closes at
 *    L950 — and the screenshot puts it below the transport and below the aux
 *    hand-off, neither of which this component draws. Rendering it from inside
 *    `NowPlaying` forced it to sit directly under the scrubber, which is the
 *    one place it must not be. The screen composes the order now.
 *
 * THE CARD NO LONGER CARRIES ITS OWN GUTTER. It used to set
 * `paddingHorizontal: Space.lg` while the Session screen wrapped it in a band
 * that set the same 16 again — 32px of inset on a 16px screen, which showed as
 * a card noticeably narrower than the transport row beneath it. The screen owns
 * the gutter; this file owns the card.
 *
 * -------------------------------------------------------------- the accents
 *
 *   CORAL is STATE and LIVE-ENTRY — the scrubber's fill, the sync dot, the rung
 *   word, the drift figure, and climbing back onto the live position.
 *   BLUE is CREATE and TRANSPORT — "Add a track" on the empty face, "Retry" on
 *   the failure card, and the play circle in 'transport-controls.tsx'.
 *   PINK-RED (`danger`) is FAILURE, which is the playback-error card and
 *   nothing else here.
 *
 * `Hard seek` USED TO BE BLUE, AND A LONG COMMENT HERE DEFENDED THAT. It read:
 * "re-anchoring is a thing you DO, not a thing that is true... on a live object
 * the badge is coral and the button is blue". That ruling is reversed. Entering
 * something that is live is the one action the state colour owns — the same
 * correction that made JOIN and SOLO coral on the home feed — and hard-seeking
 * is nothing but climbing back into the live position everyone else is already
 * at. The artboard agrees and always did: L961 draws the pill `--aux-live-w`
 * behind `--aux-live-m` with `--aux-live-t` on top, which is
 * `variant="liveOutline"` exactly. `Add a track` and `Retry` stay blue, because
 * neither is entering anything; one creates and one recovers.
 *
 * The card's corner bleed is `glow="live"` for the same reason, and it is gated
 * on a track EXISTING rather than on `isPlaying`: `GlassCard` changes its own
 * tree shape when `glow` toggles, so a bleed that followed play/pause would
 * remount the artwork `Image` on every tap.
 *
 * ------------------------------------------- NOTHING IN HERE ANIMATES ITSELF
 *
 * Deliberate, and worth saying out loud because the obvious next edit to this
 * file is to give the card its own fade-and-lift.
 *
 * The player is ONE OBJECT and it arrives as one, but the arrival belongs to
 * the stage that holds it: 'src/app/room/[id].tsx' wraps the whole now-playing
 * stage in a single `useEntrance({ kind: 'module' })` and everything in this
 * file rides it. Adding a second entrance here would compound with that one —
 * the card would fade inside a fading column, at a different duration — and it
 * would split one module into two, which is how a screen starts looking like it
 * is assembling itself rather than arriving.
 *
 * THE SCRUBBER AND THE SYNC ROW ARE HARD NOs SPECIFICALLY. Both report live
 * state, and a readout that fades up on a delay of its own is indistinguishable
 * from a number still being computed. Riding the module is fine — the value is
 * final on its first frame and only the column's opacity moves — but neither
 * may ever be handed an `index`, a `step` or a style of its own. Same for
 * `PlaybackError`: nobody staggers the thing the user is stuck waiting on.
 *
 * --------------------------------------------------------- still load-bearing
 *
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
 * scrubber, no clocks, and the screen withholds the sync row to match.
 */

import { Image } from 'expo-image';
import { Disc3, HelpCircle, MoreHorizontal, Plus, RotateCw } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
  TOUCH_TARGET,
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
  /**
   * The video module is on stage above this card, so the artwork tile would be
   * a second copy of the same picture at a tenth the size. The player host
   * itself is no longer this component's to mount — see the file header.
   */
  videoOnStage: boolean;
  track: ResolvedTrack | null;
  timeline: RoomTimeline | null;
  isLoading: boolean;
  /** Recovers from a playback failure. The sync row has its own copy. */
  onResync: () => void;
  /** Opens the lobby controls. */
  onMore: () => void;
  /** Whoever is on aux. Absent for passengers, who get no scrubber at all. */
  onSeek?: (positionMs: number) => void;
  /**
   * Opens the add-track flow from the EMPTY face. Optional so the screen keeps
   * compiling untouched — without it the empty card still reads as empty, it
   * just cannot offer the way out from here.
   */
  onAddTrack?: () => void;
  errorMessage?: string | null;
};

export function NowPlaying({
  videoOnStage,
  track,
  timeline,
  isLoading,
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

  /*
    A FRAGMENT, NOT A WRAPPER VIEW. The card and the failure notice are two
    siblings in the Session's scroller, and that scroller already spaces its
    children with `gap` — a wrapper here would collapse them into one item and
    the failure card would have to reinvent the spacing as a margin.
  */
  return (
    <>
      <GlassCard glow={track ? 'live' : undefined}>
        <View style={styles.meta}>
          {videoOnStage ? null : (
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
            draw, and the drawer holds the game table and change-lobby — a door
            worth having twice.
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

      {errorMessage ? <PlaybackError message={errorMessage} onRetry={onResync} /> : null}
    </>
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
      style={[styles.art, { backgroundColor: C.artwork, borderColor: C.rule }, pressedSoft(C)]}>
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

export type SessionSyncRowProps = {
  /** Nothing measured yet: the dot slows down and the figure is withheld. */
  waiting: boolean;
  driftMs: number;
  /** Re-measures the clock offset and seeks back onto the room's position. */
  onResync: () => void;
  /**
   * L958: the (?) beside the reading. Opens the full sync diagnostics — the
   * ladder that says what the app will DO at each distance. Optional, and the
   * glyph is simply not drawn without it, because a help affordance that opens
   * nothing is worse than none at all.
   */
  onExplain?: () => void;
};

/**
 * L952-L961: the pulsing dot, the rung word, the drift figure, the (?), and the
 * one control that fixes a drifting listener.
 *
 * EXPORTED AND FREE-STANDING, WHICH IT WAS NOT. It used to be drawn from inside
 * `NowPlaying`, welded directly under the scrubber. The artboard and the user's
 * screenshot both put it at the BOTTOM of the now-playing tab — under the
 * transport and under the aux hand-off — so the screen has to be the thing that
 * places it. See the file header.
 *
 * The reading is coral because being in sync is a state of the world, and the
 * dot and the figure step DOWN the neutral ramp as drift grows (see
 * `rungColor`) — losing the coral is the whole signal. `Hard seek` is coral
 * too, and that reverses this file's previous ruling; the argument is in the
 * file header.
 */
export const SessionSyncRow = memo(function SessionSyncRow({
  waiting,
  driftMs,
  onResync,
  onExplain,
}: SessionSyncRowProps) {
  const C = useColors();

  const rung = driftRung(driftMs);
  const tint = waiting ? C.ink3 : rungColor(rung, C);

  return (
    <View style={styles.sync}>
      {/* `synced` IS this dot's tempo in the artboards (L955). It slows while
          there is nothing measured yet, so a blink never reads as a reading. */}
      <LivePulse size={8} color={tint} tempo={waiting ? 'session' : 'synced'} />

      <Text numberOfLines={1} style={[styles.syncLabel, { color: waiting ? C.ink3 : C.ink }]}>
        {waiting ? 'Finding the beat' : `You are ${RUNG_LABEL[rung]}`}
      </Text>

      {waiting ? null : (
        <Text style={[styles.syncDrift, { color: tint }]}>{formatDrift(driftMs)}</Text>
      )}

      {onExplain ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What this sync reading means"
          onPress={onExplain}
          style={({ pressed }) => [styles.syncHelp, pressed ? styles.dim : null]}>
          <HelpCircle size={16} strokeWidth={2} color={C.ink3} />
        </Pressable>
      ) : null}

      <View style={styles.syncSpacer} />

      <AuxButton
        label="Hard seek"
        variant="liveOutline"
        size="sm"
        icon={RotateCw}
        onPress={onResync}
      />
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
 * The button stays BLUE while `Hard seek` next door goes coral, and the two are
 * not in conflict: hard-seeking is entering the live position, which is what
 * coral now owns, whereas Retry is recovering from a stop. Nothing is live to
 * enter at the moment this card is on screen.
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
  dim: {
    opacity: 0.6,
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

  // -------------------------------------------------------------- the well
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

  // ---------------------------------------------------------- the scrubber
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

  // -------------------------------------------------------- the empty face
  emptyBody: {
    marginTop: Space.lg,
    gap: Space.md,
  },
  emptyLine: {
    ...Type.body(12.5),
    lineHeight: 18,
  },

  // ----------------------------------------------------------- the sync row
  /**
   * NO VERTICAL MARGIN ANY MORE. This row is a sibling in the Session's
   * scroller and that scroller spaces its children with `gap`; the old
   * `marginTop` would stack on top of it. L953's `padding:0 4px` survives — the
   * row sits a hair inside the card edge above it, which is what lines the dot
   * up with the card's own padding rather than with the screen gutter.
   */
  sync: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
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
  /**
   * L958: a full 44px target around a 16px glyph, pulled back over the row's
   * own gap so the (?) still reads as attached to the figure it explains
   * instead of floating in the middle of the row.
   */
  syncHelp: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(Space.sm + 2) - 2,
  },
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
   * fill and the edge moved to the danger family. The old `marginTop` is gone
   * for the same reason the sync row's is: the scroller's `gap` owns it.
   */
  errorCard: {
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

  // ---------------------------------------------------------- modular grid
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
