/**
 * Which motion system the app is running, and the switch to change it.
 *
 * WHY THIS EXISTS: the app's entrances were rebuilt from duration curves onto
 * springs, and that is a whole-app change reaching 26 files through one hook.
 * A change that broad should not be a one-way door — so this is the way back,
 * and it is a RUNTIME toggle rather than a constant to edit, because "revert
 * whenever I want" should not mean "rebuild the APK and reinstall it".
 *
 * Flip it in Settings > Appearance and every animation in the app changes on
 * the spot. Both systems stay in the codebase and stay compiled, which is the
 * cost of the arrangement and is deliberate: a revert path that has to be
 * un-deleted first is not a revert path.
 *
 *   spring  the current system. Physics: things settle rather than finish, and
 *           arrive by growing into place rather than sliding up.
 *   classic the previous one. A fixed duration on cubic-bezier(.2,.85,.2,1),
 *           opacity plus an upward translate. Kept intact, not approximated.
 *
 * Modelled on `theme-context.tsx` — same AsyncStorage-backed provider shape,
 * same hydrating flag — so there is one pattern for "a preference that has to
 * survive a restart" rather than two.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'aux:motion-mode';

export type MotionMode = 'spring' | 'classic';

/**
 * The default, and the thing a fresh install gets.
 *
 * Spring, because it is the current system and the one the app is designed
 * around. If it ever needs to be reverted for everyone rather than for one
 * device, change this line and ship — no other file needs to know.
 */
const DEFAULT_MODE: MotionMode = 'spring';

type MotionContextValue = {
  mode: MotionMode;
  setMode: (next: MotionMode) => void;
  /** True until the stored choice has been read. */
  hydrating: boolean;
};

const MotionContext = createContext<MotionContextValue | null>(null);

const isMode = (v: unknown): v is MotionMode => v === 'spring' || v === 'classic';

export function MotionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<MotionMode>(DEFAULT_MODE);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isMode(stored)) setModeState(stored);
      })
      .catch(() => {
        // A failed read is not worth blocking on: the default is a working
        // system, and the only cost is that a saved preference is ignored once.
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: MotionMode) => {
    // Applied immediately and persisted in the background. The toggle's whole
    // point is seeing the difference at once; waiting on a disk write to redraw
    // would make the comparison harder than doing nothing.
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ mode, setMode, hydrating }), [mode, setMode, hydrating]);

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

/**
 * The current motion system.
 *
 * Falls back to the default rather than throwing when there is no provider.
 * `useColors` throws in that case and should, because a screen with no palette
 * is broken — but a screen with no motion preference is merely a screen that
 * animates the default way, and taking the app down over an animation setting
 * would be a worse bug than any animation.
 */
export function useMotionMode(): MotionMode {
  return useContext(MotionContext)?.mode ?? DEFAULT_MODE;
}

/** The toggle itself, for Settings. */
export function useMotion(): MotionContextValue {
  const value = useContext(MotionContext);
  if (!value) {
    return { mode: DEFAULT_MODE, setMode: () => undefined, hydrating: false };
  }
  return value;
}
