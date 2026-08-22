/**
 * The mounted half of the YouTube adapter (web).
 *
 * Same contract as the native host — register a `YouTubeControls` object with
 * the adapter registry once the player is ready — but driving the YouTube
 * IFrame Player API directly instead of through a WebView wrapper.
 *
 * Mount this ONCE, near the root of the room screen.
 *
 * On visibility: YouTube's terms of service expect the embedded player to be
 * visible to the listener, which is why the room screen renders this component
 * as its artwork surface. `visible={false}` parks it at 1x1 with zero opacity
 * and never unmounts it — destroying the iframe would cut the audio mid-song.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PointerEvents, Radius } from '@/lib/theme';

import { registerYouTubeControls, type YouTubeControls, type YouTubeHostBridge } from './youtube-adapter';

// ------------------------------------------------- minimal IFrame API typings

/** Only the slice of the IFrame API this host uses. No @types/youtube dependency. */
type YTPlayer = {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  destroy(): void;
};

type YTPlayerOptions = {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YTPlayer }) => void;
    onStateChange?: (event: { target: YTPlayer; data: number }) => void;
    onError?: (event: { target: YTPlayer; data: number }) => void;
  };
};

type YTNamespace = {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';
const SCRIPT_ID = 'aux-youtube-iframe-api';

/** Module-level so the script tag is injected once per document, not per mount. */
let apiPromise: Promise<YTNamespace> | null = null;

function loadIframeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    // Expo web prerenders to static HTML, where there is no document at all.
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('The YouTube IFrame API needs a browser document.'));
      return;
    }

    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    // The API signals readiness by calling exactly one global hook, so chain
    // any existing one rather than stomping on it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();

      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('The YouTube IFrame API loaded without a Player constructor.'));
    };

    // Another mount may have injected the tag already; the hook above covers us.
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Could not load the YouTube IFrame API.'));
    document.head.appendChild(script);
  });

  return apiPromise.catch((error: unknown) => {
    // A rejected promise cached forever would make every later mount fail too,
    // so a failed load is retried by the next host that asks for it.
    apiPromise = null;
    throw error;
  });
}

// ------------------------------------------------------------------ component

export type YouTubePlayerHostProps = {
  /** False parks the player at 1x1/opacity 0. It keeps playing. */
  visible?: boolean;
};

export function YouTubePlayerHost({ visible = true }: YouTubePlayerHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const bridgeRef = useRef<YouTubeHostBridge | null>(null);

  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  const loadedIdRef = useRef<string | null>(null);
  const lastSecondsRef = useRef(0);
  const bufferingRef = useRef(false);

  const controls = useMemo<YouTubeControls>(
    () => ({
      load(videoId, startSeconds, autoplay) {
        const player = playerRef.current;
        if (!player) return;

        if (loadedIdRef.current === videoId) {
          // Re-cueing the video that is already loaded would restart it from
          // the top; a replay or a rejoin is just a seek.
          lastSecondsRef.current = startSeconds;
          player.seekTo(startSeconds, true);
          if (autoplay) player.playVideo();
          else player.pauseVideo();
          return;
        }

        loadedIdRef.current = videoId;
        lastSecondsRef.current = startSeconds;
        bufferingRef.current = true;

        // Unlike the native wrapper, the raw API takes the start offset with
        // the load, so a late joiner never hears the opening bars first.
        if (autoplay) player.loadVideoById({ videoId, startSeconds });
        else player.cueVideoById({ videoId, startSeconds });
      },

      play() {
        playerRef.current?.playVideo();
      },

      pause() {
        playerRef.current?.pauseVideo();
      },

      seek(seconds) {
        lastSecondsRef.current = seconds;
        playerRef.current?.seekTo(seconds, true);
      },

      async getCurrentTime() {
        const player = playerRef.current;
        if (!player || !readyRef.current) return lastSecondsRef.current;

        // Mid-buffer the player still reports the pre-seek position. Handing
        // that to the drift loop would trigger a second, needless seek.
        if (bufferingRef.current) return lastSecondsRef.current;

        const seconds = player.getCurrentTime();
        if (Number.isFinite(seconds) && seconds >= 0) lastSecondsRef.current = seconds;

        return lastSecondsRef.current;
      },

      setVolume(volume) {
        playerRef.current?.setVolume(Math.round(volume));
      },

      setPlaybackRate(rate) {
        playerRef.current?.setPlaybackRate(rate);
      },

      unload() {
        loadedIdRef.current = null;
        lastSecondsRef.current = 0;
        bufferingRef.current = false;
        playerRef.current?.stopVideo();
      },
    }),
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    // The API *replaces* the element it is handed with an <iframe>, so hand it
    // a child of our own making — React has to keep owning `container` itself.
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    container.appendChild(mount);

    void loadIframeApi()
      .then((YT) => {
        if (cancelled) return;

        playerRef.current = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            // Playback belongs to the room, not the individual listener, so
            // YouTube's own transport would only let a guest desync themselves.
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              setReady(true);
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.ENDED) {
                bufferingRef.current = false;
                bridgeRef.current?.emitEnded();
                return;
              }

              // -1 (unstarted) and 3 (buffering) are the two states where the
              // player is not yet producing audio at a trustworthy position.
              bufferingRef.current =
                event.data === YT.PlayerState.UNSTARTED || event.data === YT.PlayerState.BUFFERING;
            },
            onError: (event) => {
              bridgeRef.current?.emitError(event.data);
            },
          },
        });
      })
      .catch(() => {
        // Nothing to report to yet — no controls are registered, so the adapter
        // surfaces this as its own "player never became ready" error.
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      setReady(false);

      playerRef.current?.destroy();
      playerRef.current = null;

      // Refs survive a StrictMode remount even though the player does not, so
      // clear what was "loaded" or the next load would seek an empty player.
      loadedIdRef.current = null;
      bufferingRef.current = false;

      // destroy() removes the iframe it swapped in; clear whatever is left so a
      // remount does not stack orphaned nodes inside the container.
      while (container.firstChild) container.removeChild(container.firstChild);
    };
  }, []);

  // Registration is its own effect so a StrictMode double-mount re-registers
  // cleanly instead of leaving the adapter pointing at a destroyed player.
  useEffect(() => {
    if (!ready) return;

    const bridge = registerYouTubeControls(controls);
    bridgeRef.current = bridge;

    return () => {
      bridge.unregister();
      bridgeRef.current = null;
    };
  }, [ready, controls]);

  return (
    <View
      style={[
        visible ? styles.visible : styles.parked,
        visible ? PointerEvents.auto : PointerEvents.none,
      ]}>
      {/* Plain DOM node: the IFrame API needs a real element to attach to, and
          it sizes itself to this box rather than to a measured pixel width. */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
});
