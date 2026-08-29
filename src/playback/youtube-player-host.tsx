/**
 * The mounted half of the YouTube adapter (native).
 *
 * `youtube-adapter.ts` is a plain object; the thing that actually makes sound is
 * this WebView. It registers an imperative `YouTubeControls` object with the
 * adapter's registry once the player reports ready, and tears the registration
 * down on unmount. Everything above it only ever talks to the adapter.
 *
 * Mount this ONCE, near the root of the room screen.
 *
 * On visibility: YouTube's terms of service expect the embedded player to be
 * visible to the listener, which is why the room screen renders this component
 * as its artwork surface rather than hiding it. `visible={false}` exists only
 * for the moments the artwork is off screen (chat sheet expanded, queue open) —
 * and even then the component stays MOUNTED at 1x1 with zero opacity, because
 * unmounting the WebView would stop the audio mid-song for everyone listening
 * through it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import YoutubePlayer, { PLAYER_STATES, type YoutubeIframeRef } from 'react-native-youtube-iframe';

import { PointerEvents, Radius } from '@/lib/theme';

import { registerYouTubeControls, type YouTubeControls, type YouTubeHostBridge } from './youtube-adapter';

/**
 * The library answers `getCurrentTime()` with a one-shot event from inside the
 * WebView. If the WebView is wedged or backgrounded that event never arrives
 * and the promise never settles — which would stall the SyncController's drift
 * loop permanently. So every read races a timeout and falls back to the last
 * known position.
 */
const POSITION_READ_TIMEOUT_MS = 1_200;

/**
 * How long to wait before forcing the transport again.
 *
 * `forceTransport` below fixes a disagreement between what the room wants and
 * what the player is doing. If the forced command is ALSO ignored, retrying on
 * every state event would be a loop against a player that is not listening, so
 * each attempt is given time to land and be reported before another is made.
 */
const FORCE_COOLDOWN_MS = 1_500;

/**
 * How often to check that a paused player is actually silent.
 *
 * `handleChangeState` catches a player that CHANGES into playing, and it is not
 * enough: the failure this exists for produces no event at all. A `pauseVideo`
 * the player ignores leaves it in PLAYING, which it was already in, so nothing
 * is reported and the listener never fires. Verified on the device — the room
 * paused, `dumpsys audio` reporting `state:started` indefinitely, and not one
 * state change to react to.
 *
 * So while the room wants silence, ASK. Two seconds is frequent enough that
 * nobody sits through a chorus they stopped, and rare enough to be nothing next
 * to the 3s drift loop that runs the whole time a Session is playing.
 */
const PAUSE_WATCHDOG_MS = 2_000;

/**
 * How far the position may move between two checks and still count as paused.
 *
 * `getCurrentTime` is answered from inside the WebView and the two samples are
 * not exactly `PAUSE_WATCHDOG_MS` apart, so a paused player can report a few
 * tens of milliseconds of movement. This is well under a real second of
 * playback and well over that noise.
 */
const PAUSED_POSITION_TOLERANCE_S = 0.4;

/**
 * THE REASON PAUSE NEVER WORKED ON ANDROID. Four lines, and everything above
 * this point was built to survive the damage they were doing.
 *
 * react-native-youtube-iframe sends every transport command as a WebView
 * message: `playVideo`, `pauseVideo`, `muteVideo`, `setVolume`,
 * `setPlaybackRate`. Its page listens for them on WINDOW
 * (PlayerScripts.js — `window.addEventListener('message', …)`).
 *
 * react-native-webview's Android implementation delivers them like this
 * (RNCWebViewManagerImpl.kt, the `postMessage` command):
 *
 *     event = new MessageEvent('message', data);
 *     document.dispatchEvent(event);
 *
 * `new MessageEvent(...)` defaults `bubbles` to FALSE, and the event is
 * dispatched on DOCUMENT. A non-bubbling event on `document` never reaches a
 * listener on `window`. So every one of those commands has been silently
 * dropped — not failing, not erroring, simply never arriving.
 *
 * Only two things ever reached the player: `seekTo` and video loading, because
 * those go through `injectJavaScript` instead. That is also why PLAY looked
 * fine while pause did nothing — `applyTimeline` seeks before it plays, and
 * `seekTo(s, true)` starts playback from any state that is not paused. Playback
 * was starting as a side effect of the seek, never because `playVideo` landed.
 *
 * This forwards the event the WebView really sends to the place the page really
 * listens. It is idempotent, it runs after the page's own listener is installed
 * (`injectedJavaScript` fires on load), and iOS is unaffected: an event
 * dispatched straight to `window` there is not seen by a `document` listener,
 * so nothing is delivered twice.
 *
 * It also repairs two things nobody had reported yet: VOLUME and
 * `setPlaybackRate` — which is how `SyncController` absorbs small drift without
 * an audible seek. That correction has never once been applied on Android.
 */
const MESSAGE_BRIDGE = `
  (function () {
    if (window.__auxMessageBridge) { return; }
    window.__auxMessageBridge = true;

    document.addEventListener('message', function (event) {
      console.log('[aux] document-message ' + event.data);
      window.dispatchEvent(new MessageEvent('message', { data: event.data }));
    });

    // Logged AFTER the forward above and after the page's own handler, so this
    // reports what actually reached the place the player is driven from.
    window.addEventListener('message', function (event) {
      console.log('[aux] window-message ' + event.data);
    });

    console.log('[aux] bridge installed, player=' + (typeof window.player));
  })();
  true;
`;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

export type YouTubePlayerHostProps = {
  /** False parks the player at 1x1/opacity 0. It keeps playing. */
  visible?: boolean;
};

export function YouTubePlayerHost({ visible = true }: YouTubePlayerHostProps) {
  const playerRef = useRef<YoutubeIframeRef | null>(null);
  const bridgeRef = useRef<YouTubeHostBridge | null>(null);

  // Ready is both state (to drive the registration effect) and a ref (so the
  // imperative controls can check it synchronously without a stale closure).
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  const [videoId, setVideoId] = useState<string | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  /**
   * WHAT THE ROOM WANTS, in a ref as well as in state — and the fix for a bug
   * that made the pause button look broken.
   *
   * THE LIBRARY TREATS TRANSPORT AS AN EDGE, NOT A COMMAND. It posts
   * `playVideo`/`pauseVideo` from an effect keyed on the `play` PROP CHANGING
   * (react-native-youtube-iframe/src/YoutubeIframe.js L128-134), and its ref
   * exposes only getters and `seekTo` — there is no imperative pause to call.
   * So `setPlaying(false)` when the state already reads false is a React
   * bail-out: no re-render, no prop change, no message, nothing reaches the
   * player. Pause becomes unrepeatable.
   *
   * That matters because the player can start playing WITHOUT US ASKING, and
   * then the two disagree forever. Two ways in, both real:
   *
   *   - `pauseVideo` arriving while the player is BUFFERING is dropped, and the
   *     player resumes when the buffer fills. `applyTimeline` pauses and then
   *     seeks (sync-controller.ts), and the seek re-buffers — so the pause is
   *     issued into exactly the window that swallows it.
   *   - `seekTo(s, true)` from any state that is not PAUSED starts playback,
   *     which is what the pending-seek below does out of VIDEO_CUED.
   *
   * Measured on the device: room paused, transport showing the play glyph,
   * `dumpsys audio` reporting the app's player `state:started` for as long as
   * you care to watch, and pressing pause again doing nothing at all.
   *
   * `playing` alone cannot fix this — a callback closes over a stale copy and
   * React collapses a no-change write. So the desired state lives here, is
   * readable synchronously, and `handleChangeState` compares it against what
   * the player REPORTS and corrects the difference.
   */
  const playingRef = useRef(false);
  /** When the last correction was issued, so a deaf player is not hammered. */
  const lastForceRef = useRef(0);
  const [volume, setVolume] = useState(100);
  const [rate, setRate] = useState(1);
  const [boxWidth, setBoxWidth] = useState(0);

  const loadedIdRef = useRef<string | null>(null);
  const lastSecondsRef = useRef(0);
  /**
   * The library's `loadVideoById` takes no start offset, so a freshly loaded
   * video always begins at 0. We stash where we actually want to be and apply
   * it on the first state event the new video reports — seeking any earlier is
   * dropped by the player because the video is not cued yet.
   */
  const pendingSeekRef = useRef<number | null>(null);

  /**
   * Set the transport we want, in both places, always together.
   *
   * Every write to `playing` goes through here. The ref is what callbacks read
   * and what the reconciler compares against, so a `setPlaying` that skipped it
   * would put the two out of step — which is the class of bug this exists to
   * end, reintroduced one line lower down.
   */
  const applyPlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  /**
   * Make the player do `want` even though it has already been asked.
   *
   * The library only sends a transport command when the `play` prop CHANGES, so
   * re-issuing the same value is a no-op and there is no imperative escape
   * hatch on its ref. The only lever left is to produce an edge: flip the prop
   * to the opposite value for one commit and back.
   *
   * The two writes must land in SEPARATE commits — batched into one, React sees
   * `false -> false` and the effect never runs, which is the original bug with
   * extra steps. Hence the timeout.
   *
   * It is inaudible in the case it exists for: correcting a player that is
   * PLAYING when the room is paused sends `playVideo` (already playing, no
   * effect) and then `pauseVideo` from a settled PLAYING state, which is
   * precisely the state the API honours.
   */
  const forceTransport = useCallback((want: boolean) => {
    const now = Date.now();
    if (now - lastForceRef.current < FORCE_COOLDOWN_MS) return;
    lastForceRef.current = now;

    playingRef.current = want;
    setPlaying(!want);
    setTimeout(() => setPlaying(want), 0);
  }, []);

  const controls = useMemo<YouTubeControls>(
    () => ({
      load(nextVideoId, startSeconds, autoplay) {
        lastSecondsRef.current = startSeconds;
        applyPlaying(autoplay);

        if (loadedIdRef.current === nextVideoId) {
          // Same video re-cued (a replay, or a listener rejoining mid-track):
          // the library only reacts to a *changed* videoId prop, so there is no
          // load to wait for and we seek immediately.
          pendingSeekRef.current = null;
          playerRef.current?.seekTo(startSeconds, true);
          return;
        }

        loadedIdRef.current = nextVideoId;
        pendingSeekRef.current = startSeconds > 0 ? startSeconds : null;
        setVideoId(nextVideoId);
      },

      play() {
        applyPlaying(true);
      },

      pause() {
        applyPlaying(false);
      },

      seek(seconds) {
        lastSecondsRef.current = seconds;
        pendingSeekRef.current = null;
        playerRef.current?.seekTo(seconds, true);
      },

      async getCurrentTime() {
        const player = playerRef.current;
        if (!player || !readyRef.current) return lastSecondsRef.current;

        const seconds = await withTimeout(
          player.getCurrentTime(),
          POSITION_READ_TIMEOUT_MS,
          lastSecondsRef.current
        );

        if (Number.isFinite(seconds) && seconds >= 0) lastSecondsRef.current = seconds;
        return lastSecondsRef.current;
      },

      setVolume(next) {
        setVolume(Math.round(next));
      },

      setPlaybackRate(next) {
        setRate(next);
      },

      unload() {
        applyPlaying(false);
        loadedIdRef.current = null;
        pendingSeekRef.current = null;
        lastSecondsRef.current = 0;
      },
    }),
    [applyPlaying]
  );

  // Registration is an effect rather than a call inside onReady so that a
  // StrictMode double-mount (or a fast-refresh) re-registers cleanly instead of
  // leaving the adapter pointing at a dead player.
  useEffect(() => {
    if (!ready) return;

    const bridge = registerYouTubeControls(controls);
    bridgeRef.current = bridge;

    return () => {
      bridge.unregister();
      bridgeRef.current = null;
    };
  }, [ready, controls]);

  /**
   * THE WATCHDOG, and it is the half that actually fixes the pause button.
   *
   * `handleChangeState` can only correct a disagreement the player ANNOUNCES.
   * The failure mode here announces nothing: a `pauseVideo` that is ignored
   * leaves the player in PLAYING, the state it was already in, so no event is
   * emitted and no listener runs. Measured — room paused, transport showing the
   * play glyph, `dumpsys audio` reporting `state:started` for as long as anyone
   * watched, and total silence from `onChangeState`.
   *
   * The only way to know is to ask. While the room wants silence, sample the
   * position: if it moved, the player is playing whatever it was told, and the
   * pause is re-issued as a prop edge.
   *
   * It runs ONLY while paused, which is exactly when the drift loop in
   * `SyncController` is stopped — so the two never overlap and the player is
   * never being polled by both.
   *
   * An advert is deliberately invisible to this: `getCurrentTime` reports the
   * VIDEO's position, which does not advance while a pre-roll plays, so the
   * watchdog stays quiet rather than firing commands at a player that is not
   * listening yet. When the advert ends and the track starts, the position
   * moves and the pause lands.
   */
  useEffect(() => {
    if (playing || !ready) return;

    let cancelled = false;
    let last: number | null = null;

    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      void withTimeout(player.getCurrentTime(), POSITION_READ_TIMEOUT_MS, -1).then((seconds) => {
        if (cancelled || !Number.isFinite(seconds) || seconds < 0) return;

        // Only a FORWARD move counts. A seek can jump the position backwards
        // while the player is genuinely paused, and treating that as playback
        // would fire a correction at a player already doing what was asked.
        if (last !== null && seconds > last + PAUSED_POSITION_TOLERANCE_S) {
          forceTransport(false);
        }
        last = seconds;
      });
    }, PAUSE_WATCHDOG_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [playing, ready, forceTransport]);

  const handleReady = useCallback(() => {
    readyRef.current = true;
    setReady(true);
  }, []);

  const handleChangeState = useCallback((state: PLAYER_STATES) => {
    if (state === PLAYER_STATES.ENDED) {
      bridgeRef.current?.emitEnded();
      return;
    }

    const pending = pendingSeekRef.current;
    if (
      pending !== null &&
      (state === PLAYER_STATES.PLAYING ||
        state === PLAYER_STATES.BUFFERING ||
        state === PLAYER_STATES.VIDEO_CUED)
    ) {
      pendingSeekRef.current = null;
      lastSecondsRef.current = pending;
      playerRef.current?.seekTo(pending, true);
      // That seek can itself start playback — `seekTo(s, true)` only leaves the
      // player alone when it was already PAUSED. Whatever it did will be
      // reported as another state change, and the reconciler below will be
      // looking. Return rather than judging mid-transition.
      return;
    }

    /*
      THE RECONCILER, AND THE REASON THE PAUSE BUTTON WORKS.

      Everything above this line asks the player to do things. Nothing until now
      ever checked whether it did them, and the player has its own opinions: a
      `pauseVideo` posted while it is BUFFERING is dropped, and a `seekTo` can
      start playback that nobody asked for. Once the two disagree, the app
      cannot recover on its own — `setPlaying(false)` against a state that is
      already false is a React no-op, so pause stops being pressable.

      This is the only place the real state is read back, so it is the only
      place the disagreement can be seen. `PLAYER_STATES` here is the player's
      own report, `playingRef` is what the room asked for, and a difference
      between them is corrected rather than logged.

      BUFFERING and VIDEO_CUED are deliberately not judged: both are transitions
      on the way to an answer, and correcting during one would fight a command
      that has not finished arriving.
    */
    if (state === PLAYER_STATES.PLAYING && !playingRef.current) {
      forceTransport(false);
      return;
    }

    /*
      The mirror case, and it is not symmetric in importance: a room that is
      playing while this device sits paused is silent for one listener while
      everyone else hears the track. The drift loop cannot fix it — it seeks and
      nudges, but it never re-issues play — so without this the only cure is
      leaving and rejoining.
    */
    if (state === PLAYER_STATES.PAUSED && playingRef.current) {
      forceTransport(true);
    }
  }, [forceTransport]);

  // The library hands us a string ('embed_not_allowed', 'video_not_found', …);
  // the adapter maps both that and the web player's numeric codes.
  const handleError = useCallback((error: string) => {
    bridgeRef.current?.emitError(error);
  }, []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setBoxWidth(event.nativeEvent.layout.width);
  }, []);

  const { width: windowWidth } = useWindowDimensions();

  // Measured width wins; window width is the first-frame fallback so the player
  // never mounts at 0 (a 0-height WebView never boots the iframe API).
  const playerWidth = Math.round(boxWidth > 1 ? boxWidth : windowWidth);
  const playerHeight = Math.round((playerWidth * 9) / 16);

  return (
    <View
      onLayout={visible ? handleLayout : undefined}
      style={[
        visible ? styles.visible : styles.parked,
        visible ? PointerEvents.auto : PointerEvents.none,
      ]}
    >
      <YoutubePlayer
        ref={playerRef}
        height={visible ? playerHeight : 1}
        width={visible ? playerWidth : 1}
        videoId={videoId}
        play={playing}
        volume={volume}
        playbackRate={rate}
        onReady={handleReady}
        onError={handleError}
        onChangeState={handleChangeState}
        // Some Android builds refuse programmatic autoplay under the stock
        // WebView user agent; this flag swaps in one they accept.
        forceAndroidAutoplay={Platform.OS === 'android'}
        // Playback is driven by the room, not by the individual listener, so
        // YouTube's own transport controls would let a guest desync themselves.
        initialPlayerParams={{ controls: false, rel: false, preventFullScreen: true }}
        /*
          `webViewProps` is spread onto the underlying WebView BEFORE the
          library's own `source`/`ref`/`onMessage`, so this is a supported seam
          rather than a way to break it — and the library sets no
          `injectedJavaScript` of its own, so nothing is being overridden.
          See MESSAGE_BRIDGE: it is what makes play, pause, volume and the
          drift rate-nudge reach the player at all on Android.
        */
        webViewProps={{ injectedJavaScript: MESSAGE_BRIDGE }}
        webViewStyle={styles.webView}
      />
    </View>
  );
}

export default YouTubePlayerHost;

const styles = StyleSheet.create({
  visible: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: Radius,
    // Letterbox bars read as part of the artwork instead of the app background.
    backgroundColor: '#000000',
  },
  /** Mounted, audible, effectively invisible, and out of the layout flow. */
  parked: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  webView: {
    backgroundColor: 'transparent',
  },
});
