/**
 * THE MINIMISED SESSION — the strip that says you are still in a room, and the
 * way back into it.
 *
 * WHY THIS COMPONENT COULD NOT HAVE EXISTED A WEEK AGO. Membership used to be a
 * side effect of the Session screen being mounted: `use-room-sync` upserted a
 * `room_participants` row in an effect and deleted it in the cleanup, so
 * unmounting the screen LEFT the room. Back and Leave were the same operation —
 * not by UI convention but by mechanism — and a bar offering "return to your
 * Session" would have been advertising something that no longer existed. The
 * lifecycle now lives in `@/lib/session`, above the navigator, and is torn down
 * by `leave()` alone. This bar is what that buys.
 *
 * ─── The rules it is built to, from the provider's contract ──────────────────
 *
 * IT RENDERS ON `minimized`, NOT ON `active`. `active` is still true while the
 * Session screen is up — a bar showing then would be a duplicate of the screen
 * behind it.
 *
 * IT DOES NOT CALL `useSessionPresentation()`. A bar advertising a Session is
 * not rendering one. Claiming presentation would flip `minimized` to false and
 * the bar would hide itself with its own existence — a component that vanishes
 * the instant it appears.
 *
 * TAPPING IS `router.push` AND NOTHING ELSE. `useRoomSync` calls `enter()` for
 * itself on mount, so re-entry is purely a navigation. Nothing here touches
 * membership in either direction.
 *
 * ─── There is no Leave button on it, and that is the design ─────────────────
 *
 * The obvious version of this bar has an ✕ on the right. It is wrong twice
 * over. Leaving is destructive — PINK, `C.danger` — and putting a destructive
 * control on a surface whose entire purpose is "tap me to navigate" is how
 * somebody ends a party with a mis-aimed thumb. And leaving is a decision that
 * needs its consequences visible: who is in the room, what is playing, whether
 * you are the host holding the aux. None of that is on a 62px strip. Leave
 * lives on the Session screen, where the answers are.
 *
 * The right-hand glyph is therefore a chevron, decorative and hidden from
 * assistive tech: it says "this opens back up", which is the only thing the bar
 * does.
 *
 * ─── What it shows, and what it deliberately does not ───────────────────────
 *
 * Artwork or a monogram, the track title (or that there isn't one), the
 * Session's name, and a coral pulse when something is genuinely playing. CORAL
 * because playing is a STATE of the world — the same reading the lounge Session
 * card gives the same fact. Nothing here is blue: the bar creates nothing and
 * controls nothing, it reports and it returns.
 *
 * NO SCRUBBER, NO PROGRESS LINE, and the contract hands over
 * `expectedPositionMs(timeline)` which would make one easy. A progress bar has
 * to tick, and this component is mounted above every screen in `(tabs)` for as
 * long as a Session stays minimised — hours, by design. A 1Hz re-render of app
 * chrome to animate a hairline nobody is looking at is a cost with no reader.
 * The pulse answers the only question the bar is being asked, which is whether
 * the room is still alive.
 *
 * ─── It is glass, like the nav ──────────────────────────────────────────────
 *
 * Same material, same per-platform tuning, and the same Android caveat:
 * expo-blur 57 blurs a `BlurTargetView` handed to it by ref and paints a flat
 * tint given none. The target belongs to the tabs shell — it has to WRAP the
 * content being blurred — so it arrives as a prop exactly as `NavBar` takes it.
 *
 * THE GLASS NUMBERS ARE DUPLICATED FROM 'nav-bar.tsx' RATHER THAN IMPORTED, and
 * that is a deliberate cost rather than an oversight: they are private to that
 * file, this pass does not own it, and inventing a second set of numbers for
 * the surface sitting 10px above the capsule would be visibly worse than
 * repeating the measured ones. 'nav-bar.tsx' carries the derivation and the
 * icon-contrast floor they were measured against; if these ever need to move,
 * they move there first and this follows. The day a third piece of bottom glass
 * appears, this belongs in the token layer.
 */

import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ChevronUp } from 'lucide-react-native';
import { memo, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLURHASH_SURFACE, LivePulse } from '@/components/ui';
import { MiniDock } from '@/lib/dock';
import { useActiveSource } from '@/features/tracks/active-source';
import { useEntrance, usePressFeedback } from '@/lib/entrance';
import { useMotionMode } from '@/lib/motion';
import { useSession } from '@/lib/session';
import {
  Dock,
  Duration,
  Fonts,
  PointerEvents,
  Rule,
  Space,
  Type,
  ZIndex,
  floating,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';
import { usePlaybackTimeline, usePlaybackTrack } from '@/playback/store';

/** The artwork well: a square tile, the tallest thing in the row. */
const TILE = 42;
const TILE_RADIUS = 12;

/** The chevron on the right, and the pulse beside the Session's name. */
const CHEVRON = 18;
const PULSE = 6;

type GlassSpec = {
  /** Blur strength per scheme, in whatever `intensity` means on this platform. */
  readonly dark: number;
  readonly light: number;
  /** How much of `C.nav` to actually paint over the blurred image, 0-1. */
  readonly tint: number;
};

/** See the header: these are 'nav-bar.tsx''s numbers, and it owns the argument. */
const GLASS: GlassSpec = Platform.select({
  ios: { dark: 70, light: 82, tint: 0.72 },
  android: { dark: 55, light: 65, tint: 0.6 },
  default: { dark: 70, light: 70, tint: 0.35 },
});

/** What to ask for when the blur is going to be refused (Android, no target). */
const NO_BLUR: GlassSpec = { dark: 40, light: 60, tint: 1 };

export type MiniSessionProps = {
  /**
   * The `BlurTargetView` Android should blur as this bar's backdrop. Optional
   * for the same reason `NavBar`'s is: only the tabs shell can supply one.
   */
  blurTarget?: RefObject<View | null>;
};

/**
 * The gate, and it is a separate component on purpose.
 *
 * Everything below subscribes to the playback store. Reading `minimized` first
 * and returning null keeps those subscriptions from existing at all while
 * nothing is minimised — which is most of the time — rather than mounting a
 * bar's worth of selectors above every screen in the app and hiding the output.
 */
export function MiniSession({ blurTarget }: MiniSessionProps) {
  const { minimized, roomId, name } = useSession();

  // `roomId` is non-null whenever `minimized` is true — the provider defines it
  // that way — but the type does not say so and the tap needs a real id.
  if (!minimized || roomId === null) return null;

  return <MiniSessionBar roomId={roomId} name={name} blurTarget={blurTarget} />;
}

type BarProps = {
  roomId: string;
  name: string | null;
  blurTarget?: RefObject<View | null>;
};

const MiniSessionBar = memo(function MiniSessionBar({ roomId, name, blurTarget }: BarProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const classic = useMotionMode() === 'classic';

  const track = usePlaybackTrack();
  const timeline = usePlaybackTimeline();

  /*
    IT ARRIVES RATHER THAN APPEARS, and `useEntrance` is the right half of the
    pair for a reason worth writing down. `useSheetSlide` is the more literal
    reading — the bar rising out from behind the capsule — but the travel it
    needs is its own height plus the gap, which parks it exactly ON TOP of the
    nav, and the two are siblings on one plane with nothing clipping either. The
    slide would be performed across the navigation. Clipping it would take the
    floating shadow with it (`overflow: hidden` clips what children draw outside
    it), and that shadow is most of what makes this read as an object resting
    over the app rather than a panel welded to it.

    `module` rather than `row`: this is one surface arriving alone, not the
    fourth item in a list, and the larger of the hook's two arrivals is what a
    lone element wants. It keys off FOCUS, which lands exactly right here — the
    `(tabs)` group regains focus at the same moment the Session screen unmounts
    and hands this bar its reason to exist, so the arrival IS the return.

    Never a Reanimated `entering=`: those render invisible on react-native-web,
    and this app has shipped that bug twice.
  */
  const entering = useEntrance({ kind: 'module' });
  // Shallow, like a card rather than a cell: the same scale factor reads as far
  // more movement across a full-width bar than across a 48px nav slot.
  const press = usePressFeedback(0.985);

  const dark = scheme === 'dark';
  /*
    Is there going to be a real blur behind this glass? iOS and web always blur;
    Android only with a target. When there is none the bar keeps the FULL
    `C.nav` — a thin tint over sharp, unblurred content is not glass, it is a
    strip you can read the feed through.
  */
  const blurred = Platform.OS !== 'android' || blurTarget != null;
  const glass = blurred ? GLASS : NO_BLUR;

  /*
    PLAYING, not merely entered. The pulse is the only accent on this bar and it
    has to be true: a Session sitting paused between tracks is somewhere you
    still are, but it is not something happening, and a dot beating over a
    silent room is the same lie the "0 listening" count used to tell on the
    lounge card.
  */
  /*
    THE ROOM PLAYING IS NOT THE SAME AS THIS PHONE PLAYING, and conflating them
    is the one lie this bar can tell.

    `timeline.isPlaying` is the state of the ROOM. On Spotify that is also the
    state of the listener's speakers, because the adapter drives a real device
    somewhere else and minimising Aux does not touch it. On YouTube the player
    is a WebView mounted by the Session screen, so minimising unmounts it and
    the audio stops dead — while the room carries on and this flag stays true.

    A coral pulse over a silent phone is exactly the "0 listening" lie the
    lounge card used to tell, so the dot reports what THIS DEVICE is doing and
    the label carries the rest.
  */
  const source = useActiveSource();
  const roomPlaying = timeline?.isPlaying === true && track !== null;
  const audibleHere = source.provider === 'spotify';
  const playing = roomPlaying && audibleHere;

  const title = track ? track.title : 'Nothing playing yet';
  /*
    Only shown when the room is playing and this device is not: without it a
    YouTube listener sees a still bar and reasonably concludes the Session
    stopped, when it is running fine and simply is not coming out of their
    phone. Saying which it is costs one line and prevents a support question
    nobody could answer from the screen.
  */
  const silentHere = roomPlaying && !audibleHere;
  /*
    The SESSION's name under the track, not the lounge's, even though
    `useSession()` also carries a `loungeId`. An id is not a name — turning one
    into the other means a query, and a piece of always-on chrome that fires a
    fetch to label itself is a network request per app launch for one line of
    11px text. The Session name is already best-known: the caller's hint fills
    it instantly and the `rooms` row overwrites it the moment it lands.
  */
  const label = name ?? 'Your Session';

  /*
    The coral pulse says "playing" to everybody except a screen reader, so it is
    spoken. Two sentences rather than three when there is no track at all —
    "Paused. Nothing playing yet." is one state described twice, and the second
    half of it is not a pause.
  */
  const spoken = track ? `${playing ? 'Playing' : 'Paused'}. ${title}` : title;

  const goBack = () => router.push({ pathname: '/room/[id]', params: { id: roomId } });

  return (
    /*
      The entrance is on the OUTER view and the press on an inner one, because
      both write `transform` — put them on one element and a bar pressed
      mid-arrival snaps to its resting position.
    */
    <Animated.View
      /*
        Directly above the capsule and moving with it: the nav sits at
        `Dock.bottom + insets.bottom` and stands `Dock.height` tall, so this
        clears both plus the air between them. `useDockReserve()` in
        '@/lib/dock' adds the matching room at the bottom of every scroll
        container in the group, off the same two numbers.
      */
      style={[
        styles.layer,
        { bottom: Dock.bottom + insets.bottom + Dock.height + MiniDock.gap },
        entering,
      ]}>
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${spoken}.`}
          accessibilityHint="Returns to the Session you minimised"
          onPress={goBack}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          /*
            Classic motion mode turns `usePressFeedback` into a no-op — it is
            the OLD system, and the old system dimmed rather than pushed. The
            nav's 48px cells go without; a bar this size cannot, so the dim is
            restored for that mode alone. Running both would be two answers to
            one touch.
          */
          style={({ pressed }) => (classic && pressed ? styles.held : null)}>
          <BlurView
            intensity={dark ? glass.dark : glass.light}
            // `blurMethod`, not `experimentalBlurMethod`: the latter is
            // deprecated in expo-blur 57 and warns on every mount. Asked for
            // only when a target exists, because requesting it without one
            // warns as well and then falls back to what 'none' already does.
            blurMethod={blurred && Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
            blurTarget={blurTarget}
            tint={dark ? 'dark' : 'light'}
            style={[styles.bar, { borderColor: C.chromeBorder }, floating(C)]}>
            {/*
              The tint rides ON TOP of the blur rather than being handed to
              BlurView as a background — underneath, the tint becomes the thing
              being blurred and the whole surface reads as fog. `opacity`
              multiplies `C.nav` down without inventing a second token, so light
              mode still resolves its own near-white.
            */}
            <View
              style={[
                styles.tint,
                PointerEvents.none,
                { backgroundColor: C.nav, opacity: glass.tint },
              ]}
            />

            <View style={[styles.tile, { backgroundColor: C.artwork, borderColor: C.rule }]}>
              {track?.artwork_url ? (
                <Image
                  source={{ uri: track.artwork_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  placeholder={{ blurhash: BLURHASH_SURFACE }}
                  transition={Duration.press}
                  accessibilityIgnoresInvertColors
                  // The Pressable above already names the track; a label here
                  // would read the same fact out twice.
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              ) : (
                /*
                  A dark WELL with a faint monogram — `artwork` is the inverted
                  plate in this direction and `artInk` is a 22% white, so code
                  written against a bright tile puts dark ink on dark and loses
                  the letter.
                */
                <Text style={[styles.glyph, { color: C.artInk }]}>
                  {glyphFor(track?.title ?? label)}
                </Text>
              )}
            </View>

            <View style={styles.text}>
              <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
                {title}
              </Text>

              <View style={styles.meta}>
                {/*
                  `session` is the 1.8s beat — ambient, "there is a room here" —
                  not the 1s urgency of a recording light. The same tempo the
                  lounge Session card runs, because it is the same claim.
                */}
                {playing ? <LivePulse size={PULSE} tempo="session" /> : null}
                <Text
                  numberOfLines={1}
                  style={[styles.label, { color: playing ? C.liveText : C.ink3 }]}>
                  {/*
                    A YouTube listener who minimised sees a still bar, and
                    without this would reasonably read it as the Session having
                    stopped — when it is running fine and simply is not coming
                    out of their phone. Neutral ink, not coral: the room is
                    live, this device is not, and coral would claim otherwise.
                  */}
                  {silentHere ? 'Playing in the room · tap to hear it' : label}
                </Text>
              </View>
            </View>

            {/*
              DECORATIVE. It is not a second control — the whole bar is the
              control — and a glyph that read out as a button would offer a
              screen reader two ways to do one thing.
            */}
            <ChevronUp
              size={CHEVRON}
              strokeWidth={2.2}
              color={C.ink3}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </BlurView>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});

function glyphFor(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '·';
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: Dock.inset,
    right: Dock.inset,
    /*
      The nav's own plane. The two never overlap — this bar rests `MiniDock.gap`
      clear of the capsule and its entrance travels 6px — so there is no order
      to get wrong between them, only against the scenes underneath.
    */
    zIndex: ZIndex.tabBar,
  },
  bar: {
    height: MiniDock.height,
    /*
      A capsule above a capsule. The nav is fully rounded at half its height, and
      a squared-off strip resting on it would read as two different kinds of
      object rather than one stack of floating glass.
    */
    borderRadius: MiniDock.height / 2,
    borderWidth: Rule.hair,
    flexDirection: 'row',
    alignItems: 'center',
    // Tighter on the left than the right: the tile is a filled shape and can
    // sit closer to the curve than a bare glyph can.
    paddingLeft: 10,
    paddingRight: 18,
    gap: Space.md,
    /*
      Without this the blur paints square corners behind the rounded border, and
      the artwork tile would overrun them. Nothing in here lifts, so there is
      nothing for the clip to eat — if anything is ever given a lift inside this
      bar, this is the line that will take it.
    */
    overflow: 'hidden',
  },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  held: {
    opacity: 0.6,
  },

  tile: {
    width: TILE,
    height: TILE,
    borderRadius: TILE_RADIUS,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: tracking(17, -0.02),
  },

  text: {
    flex: 1,
    // Without this a long track title refuses to shrink and pushes the chevron
    // off the end of the bar instead of ellipsing.
    minWidth: 0,
  },
  title: {
    ...Type.body(14),
    fontFamily: Fonts.semibold,
    lineHeight: 18,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs + 2,
    marginTop: 2,
  },
  label: {
    ...Type.body(11),
    lineHeight: 15,
    letterSpacing: tracking(11, 0.06),
    flexShrink: 1,
  },
});
