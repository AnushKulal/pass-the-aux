/**
 * One source of truth for "is there an update, and what is in it".
 *
 * The prompt, the Settings row and the stale-version banner all read this. That
 * is the whole point: when the prompt owned the state, dismissing it destroyed
 * the only record that an update existed, so "Not now" was really "not ever"
 * until the next cold start. Here, dismissing hides the sheet and nothing else —
 * `isAvailable` stays true, and Settings can still offer it.
 *
 * The update is fetched BEFORE it is offered anywhere, so every "Update now" in
 * the app restarts immediately instead of sitting on a spinner over an unknown
 * download on a phone network.
 */

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { at, NOTHING_PENDING, readPendingNotes, type Pending } from '@/lib/release-notes';

/** How long after launch to look, so the check never competes with first paint. */
const FIRST_CHECK_DELAY_MS = 4_000;

/**
 * Ignore a foreground check this soon after the last one.
 *
 * Android fires `active` on things that are not really returns to the app — a
 * permission dialog closing, the notification shade — and each one would
 * otherwise be a network round trip.
 */
const MIN_CHECK_INTERVAL_MS = 60_000;

export type UpdateStatus =
  | 'idle'
  /** A check is in flight. Only ever shown for checks the user asked for. */
  | 'checking'
  /** Fetched and ready to apply. */
  | 'ready'
  /** reloadAsync has been called; the app is on its way out. */
  | 'applying'
  /** The last check failed — offline, or the update server was unreachable. */
  | 'error';

export type UpdateValue = {
  status: UpdateStatus;
  /** Which patch this bundle is on. 0 for builds predating the changelog. */
  currentPatch: number;
  /** What the pending update contains, relative to `currentPatch`. */
  pending: Pending;
  /** True once an update has been fetched and is waiting to be applied. */
  isAvailable: boolean;
  /** Whether the sheet should be on screen. Dismissing clears this alone. */
  promptVisible: boolean;
  /** When the last completed check finished. Null until one has. */
  lastCheckedAt: number | null;
  /** True after a user-initiated check that found nothing — drives "up to date". */
  confirmedCurrent: boolean;
  /** Look for an update. `manual` surfaces progress and bypasses throttling. */
  check: (manual?: boolean) => Promise<void>;
  /** Apply the fetched update and restart. */
  apply: () => Promise<void>;
  /** Hide the sheet. Deliberately does NOT clear `isAvailable`. */
  dismissPrompt: () => void;
};

const UpdateContext = createContext<UpdateValue | null>(null);

/**
 * Which patch this running bundle is on.
 *
 * `Constants.expoConfig` is the config of the bundle actually executing, which
 * is what we need — `Updates.manifest` is empty in development and reports the
 * embedded manifest on a freshly installed build.
 */
function readCurrentPatch(): number {
  const patch = at(Constants.expoConfig?.extra, 'patch');
  return typeof patch === 'number' && Number.isFinite(patch) ? patch : 0;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [pending, setPending] = useState<Pending>(NOTHING_PENDING);
  const [isAvailable, setAvailable] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [confirmedCurrent, setConfirmedCurrent] = useState(false);

  /** Guards against two checks overlapping, which would double-fetch. */
  const inFlight = useRef(false);
  /** Set once the sheet has been dismissed, so it is not re-shown this launch. */
  const dismissed = useRef(false);

  // Wrapped rather than passed by reference: the compiler's memo rule needs to
  // see an inline function expression to know what the dependency array covers.
  const currentPatch = useMemo(() => readCurrentPatch(), []);

  const check = useCallback(
    async (manual = false) => {
      // Updates never apply in development — the bundle comes from Metro and
      // expo-updates is inert. A manual check still resolves, so the Settings
      // row says something rather than hanging.
      if (__DEV__) {
        if (manual) {
          setLastCheckedAt(Date.now());
          setConfirmedCurrent(true);
        }
        return;
      }

      if (inFlight.current) return;

      // An update already fetched does not need looking for again; it needs
      // applying. Re-checking would just re-download it.
      if (isAvailable && !manual) return;

      if (!manual && lastCheckedAt !== null && Date.now() - lastCheckedAt < MIN_CHECK_INTERVAL_MS) {
        return;
      }

      inFlight.current = true;
      if (manual) setStatus('checking');

      try {
        const result = await Updates.checkForUpdateAsync();

        if (!result.isAvailable) {
          setLastCheckedAt(Date.now());
          setConfirmedCurrent(true);
          setStatus('idle');
          return;
        }

        // Read the notes off the manifest BEFORE fetching: this is the only
        // description of the new version available to the bundle in hand.
        setPending(readPendingNotes(result.manifest, currentPatch));

        await Updates.fetchUpdateAsync();

        setAvailable(true);
        setConfirmedCurrent(false);
        setLastCheckedAt(Date.now());
        setStatus('ready');

        // A manual check means the user is already looking at Settings; putting
        // a sheet over it would be answering a question they just asked.
        if (!manual && !dismissed.current) setPromptVisible(true);
      } catch {
        // Offline, or the update server is unreachable. Silent unless the user
        // asked — an update nobody requested is not worth an error message.
        setStatus(manual ? 'error' : 'idle');
        if (manual) setLastCheckedAt(Date.now());
      } finally {
        inFlight.current = false;
      }
    },
    [currentPatch, isAvailable, lastCheckedAt]
  );

  const apply = useCallback(async () => {
    setStatus('applying');
    try {
      await Updates.reloadAsync();
    } catch {
      // If the reload is refused there is nothing useful left to try; put the
      // state back so the user can dismiss rather than stare at a dead button.
      setStatus('ready');
    }
  }, []);

  const dismissPrompt = useCallback(() => {
    dismissed.current = true;
    setPromptVisible(false);
  }, []);

  /**
   * The listeners below must mount exactly once, but `check` takes a new
   * identity every time its state moves. Reading it through a ref keeps the
   * effect's dependency list empty without ever calling a stale copy.
   */
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  useEffect(() => {
    const first = setTimeout(() => void checkRef.current(), FIRST_CHECK_DELAY_MS);

    // Also look on return to the foreground, so a long-running install picks up
    // an update without ever being force-quit. Throttled inside `check`.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkRef.current();
    });

    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);

  const value = useMemo<UpdateValue>(
    () => ({
      status,
      currentPatch,
      pending,
      isAvailable,
      promptVisible,
      lastCheckedAt,
      confirmedCurrent,
      check,
      apply,
      dismissPrompt,
    }),
    [
      status,
      currentPatch,
      pending,
      isAvailable,
      promptVisible,
      lastCheckedAt,
      confirmedCurrent,
      check,
      apply,
      dismissPrompt,
    ]
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

/**
 * The pending update, if any.
 *
 * Read by the sheet, the Settings row and the stale-version banner. All three
 * see the same state, which is what lets Settings still offer an update the
 * user waved away.
 */
export function useUpdates(): UpdateValue {
  const value = useContext(UpdateContext);
  if (!value) {
    throw new Error('useUpdates() requires <UpdateProvider> above it — see @/lib/updates.');
  }
  return value;
}
