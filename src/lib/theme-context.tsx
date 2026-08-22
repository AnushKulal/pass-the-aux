/**
 * Dark / Light / System theming.
 *
 * The choice is persisted; "system" follows the OS live rather than sampling
 * once at launch, so flipping the phone's appearance changes the app underneath
 * the user without a restart.
 *
 * Components that must follow the choice call `useColors()`. Its return type is
 * the same `Palette` shape a direct `import { Colors }` gives, so migrating a
 * component is a one-line change at the top and nothing else.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { Palettes, type Palette, type ThemeChoice, type ThemeName } from './theme';

const STORAGE_KEY = 'aux:theme-choice';

type ThemeContextValue = {
  /** What the user picked: dark, light, or follow the system. */
  choice: ThemeChoice;
  /** What that resolves to right now. */
  scheme: ThemeName;
  colors: Palette;
  setChoice: (next: ThemeChoice) => void;
  /** True until the stored choice has been read, so nothing flashes the wrong theme. */
  hydrating: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isChoice = (v: unknown): v is ThemeChoice =>
  v === 'dark' || v === 'light' || v === 'system';

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Subscribes to OS appearance changes; updates while the app is open.
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('dark');
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isChoice(stored)) setChoiceState(stored);
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    // Apply immediately and persist in the background — a theme switch that
    // waits on disk feels broken.
    setChoiceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme: ThemeName = choice === 'system' ? (system === 'light' ? 'light' : 'dark') : choice;
    return { choice, scheme, colors: Palettes[scheme], setChoice, hydrating };
  }, [choice, system, setChoice, hydrating]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useColors/useTheme used outside ThemeProvider — check src/lib/providers.tsx');
  }
  return ctx;
}

/** The active palette. Same shape as the statically imported `Colors`. */
export function useColors(): Palette {
  return useThemeContext().colors;
}

/** The full control surface, for the Appearance setting. */
export function useTheme(): ThemeContextValue {
  return useThemeContext();
}
