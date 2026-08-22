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

  const controls = useMemo<YouTubeControls>(
    () => ({
      load(nextVideoId, startSeconds, autoplay) {
        lastSecondsRef.current = startSeconds;
        setPlaying(autoplay);

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
        setPlaying(true);
      },

      pause() {
        setPlaying(false);
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
        setPlaying(false);
        loadedIdRef.current = null;
        pendingSeekRef.current = null;
        lastSecondsRef.current = 0;
      },
    }),
    []
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
    }
  }, []);

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
    borderRadius: Radius.lg,
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
