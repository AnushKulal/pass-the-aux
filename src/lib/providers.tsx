/**
 * The app-wide provider stack, in dependency order.
 *
 * Order matters and is not arbitrary:
 *   GestureHandlerRootView  must be the outermost native view or sheets/swipes
 *                           silently no-op on Android.
 *   SafeAreaProvider        insets are read by the lounge rail, the tab bar and
 *                           every Screen.
 *   QueryClientProvider     AuthProvider's profile fetch runs through it.
 *   AuthProvider            everything below is scoped to the signed-in id.
 *   LocalProfileProvider    the profile gate. Sits inside AuthProvider because
 *                           it keys its storage by user id.
 *   ToastProvider           must be innermost so its overlay paints above the
 *                           navigator without needing a portal.
 *
 * `ThemeProvider` is NOT here — it is mounted above this stack in
 * `src/app/_layout.tsx` so the React Navigation theme can read the active
 * palette. Everything in here may therefore call `useColors()`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { useColors } from '@/lib/theme-context';

/* ------------------------------------------------------------ profile gate */

/**
 * The half of a profile that has nowhere to live yet.
 *
 * TODO(schema): `profiles` currently has only
 * `id / username / display_name / avatar_url / spotify_linked / is_premium`.
 * The design needs four more columns and one bucket — see the handoff's
 * "Schema gaps" table:
 *
 *   supabase/migrations/XXXX_profile_presentation.sql
 *     alter table profiles
 *       add column bio             text    not null default '',
 *       add column photo_url       text,
 *       add column profile_video_url text,
 *       add column show_activity   boolean not null default true,
 *       add column profile_done    boolean not null default false;
 *     -- plus a public `avatars` storage bucket for the photo and the 2–6s loop.
 *
 * Until that lands, this is persisted per-user in AsyncStorage. It is the only
 * store for the gate, so the gate is per-device: a user who completes setup on
 * one phone is asked again on another. That is a known, deliberate limitation
 * of the interim state, not a bug to work around elsewhere.
 */
export type LocalProfileDraft = {
  /**
   * Whether a photo has been chosen. Separate from `photoUri` because
   * `expo-image-picker` is not a dependency yet: the slot can be filled (which
   * is what the gate reads) before there is any file behind it.
   */
  hasPhoto: boolean;
  /** Local file URI, once a picker exists to produce one. */
  photoUri: string | null;
  /** Whether a 2–6s loop has been chosen. Not part of the gate. */
  hasVideo: boolean;
  /** Local file URI for the loop, once a picker exists to produce one. */
  videoUri: string | null;
  bio: string;
  /** Governs the live dot and Feed presence. */
  showActivity: boolean;
  /** Set once the gate has been passed and the profile saved. */
  profileDone: boolean;
};

export type LocalProfileValue = LocalProfileDraft & {
  /** True until the stored draft has been read; render nothing rather than a wrong gate. */
  hydrating: boolean;
  hasBio: boolean;
  /** Both checklist items satisfied — what un-disables SAVE PROFILE & ENTER AUX. */
  complete: boolean;
  update: (patch: Partial<LocalProfileDraft>) => void;
  /** Marks the gate passed. Ignored unless `complete`, so it cannot be forced. */
  markDone: () => void;
};

const EMPTY_DRAFT: LocalProfileDraft = {
  hasPhoto: false,
  photoUri: null,
  hasVideo: false,
  videoUri: null,
  bio: '',
  showActivity: true,
  profileDone: false,
};

const storageKey = (userId: string | null) => `aux:profile-local:${userId ?? 'anonymous'}`;

/** Narrow an unknown parse result without trusting any single field. */
function readDraft(raw: string | null): LocalProfileDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_DRAFT;
    const value = parsed as Partial<Record<keyof LocalProfileDraft, unknown>>;
    return {
      hasPhoto: value.hasPhoto === true,
      photoUri: typeof value.photoUri === 'string' ? value.photoUri : null,
      hasVideo: value.hasVideo === true,
      videoUri: typeof value.videoUri === 'string' ? value.videoUri : null,
      bio: typeof value.bio === 'string' ? value.bio : '',
      showActivity: value.showActivity !== false,
      profileDone: value.profileDone === true,
    };
  } catch {
    // A corrupt blob is indistinguishable from a fresh install, and treating it
    // as fresh sends the user back through setup rather than to a crash.
    return EMPTY_DRAFT;
  }
}

const LocalProfileContext = createContext<LocalProfileValue | null>(null);

function LocalProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const key = storageKey(userId);

  /**
   * The loaded draft is stamped with the key it came from, so "hydrating" is
   * derived rather than a second piece of state. Signing in as someone else
   * changes the key, which makes the previous account's draft stale in the same
   * render it arrives — no effect has to set a flag, and no frame can show one
   * user the other's gate.
   */
  const [store, setStore] = useState<{ key: string; draft: LocalProfileDraft }>({
    key: '',
    draft: EMPTY_DRAFT,
  });

  const hydrating = store.key !== key;
  const draft = hydrating ? EMPTY_DRAFT : store.draft;

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(key)
      .then((raw) => {
        if (!cancelled) setStore({ key, draft: readDraft(raw) });
      })
      .catch(() => {
        if (!cancelled) setStore({ key, draft: EMPTY_DRAFT });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  /**
   * Applies and persists in one step. The write is fire-and-forget: a text
   * field that waits on disk between keystrokes drops characters, and the
   * worst case of a lost write is one re-typed bio.
   */
  const update = useCallback(
    (patch: Partial<LocalProfileDraft>) => {
      setStore((current) => {
        // A write that lands mid-switch belongs to the account that has gone.
        if (current.key !== key) return current;
        const next = { ...current.draft, ...patch };
        void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
        return { key, draft: next };
      });
    },
    [key]
  );

  const hasBio = draft.bio.trim().length > 0;
  const complete = draft.hasPhoto && hasBio;

  const markDone = useCallback(() => {
    setStore((current) => {
      if (current.key !== key) return current;
      if (!current.draft.hasPhoto || current.draft.bio.trim().length === 0) return current;
      const next = { ...current.draft, profileDone: true };
      void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
      return { key, draft: next };
    });
  }, [key]);

  const value = useMemo<LocalProfileValue>(
    () => ({
      ...draft,
      hydrating,
      hasBio,
      complete,
      update,
      markDone,
    }),
    [draft, hydrating, hasBio, complete, update, markDone]
  );

  return <LocalProfileContext.Provider value={value}>{children}</LocalProfileContext.Provider>;
}

/**
 * The profile gate and the locally-held half of the profile.
 *
 * Read by `(auth)/profile-setup` (the form), `(tabs)/_layout` (whether the
 * lounge rail and tab bar render at all) and anything that needs the activity
 * flag.
 */
export function useLocalProfile(): LocalProfileValue {
  const value = useContext(LocalProfileContext);
  if (!value) {
    throw new Error('useLocalProfile() requires <Providers> above it — see @/lib/providers.');
  }
  return value;
}

/* --------------------------------------------------------------- the stack */

export function Providers({ children }: { children: ReactNode }) {
  const C = useColors();

  return (
    <GestureHandlerRootView style={styles.root}>
      {/*
        Painting a plain View rather than relying on the navigator kills the
        white flash Android shows between the splash and the first screen, and
        it has to follow the theme or a light-mode launch flashes black.
      */}
      <View style={[styles.root, { backgroundColor: C.bg }]}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <LocalProfileProvider>
                <ToastProvider>{children}</ToastProvider>
              </LocalProfileProvider>
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
