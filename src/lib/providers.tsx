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
 *                           it keys its storage by user id AND because the gate
 *                           itself — which music service this account plays
 *                           from — is partly answered by the session's identity
 *                           provider, which only AuthProvider knows.
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

import { UpdatePrompt } from '@/components/shell/update-prompt';
import { ToastProvider } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { useColors } from '@/lib/theme-context';
import { UpdateProvider } from '@/lib/updates';
import { usePlayback, type MusicService } from '@/playback/store';

/* ------------------------------------------------------------ profile gate */

/**
 * The half of a profile that has nowhere to live yet.
 *
 * TODO(schema): `profiles` currently has only
 * `id / username / display_name / avatar_url / spotify_linked / is_premium`.
 * The design needs five more columns and one bucket — see the handoff's
 * "Schema gaps" table:
 *
 *   supabase/migrations/XXXX_profile_presentation.sql
 *     create type music_service as enum ('youtube','spotify','apple_music');
 *     alter table profiles
 *       add column music_service   music_service,
 *       add column bio             text    not null default '',
 *       add column photo_url       text,
 *       add column profile_video_url text,
 *       add column show_activity   boolean not null default true,
 *       add column profile_done    boolean not null default false;
 *     -- plus a public `avatars` storage bucket for the photo and the 2–6s loop.
 *
 * `music_service` is the one of those that is NOT presentation: it is the gate.
 * Note it is nullable — an account signed in with Google or Spotify never
 * writes it, because the provider on the session already answers the question
 * (see `musicServiceForUser` in `@/lib/auth`), and a copy that can disagree with
 * the session is worse than no copy at all.
 *
 * Until that lands, this is persisted per-user in AsyncStorage. It is the only
 * store for the gate, so the gate is per-device: a user who completes setup on
 * one phone is asked again on another. That is a known, deliberate limitation
 * of the interim state, not a bug to work around elsewhere.
 */
export type LocalProfileDraft = {
  /**
   * The music service this account plays from — THE ONE REQUIRED ANSWER, and
   * the only field here that gates anything.
   *
   * Null on an email/password account until profile setup asks. Stays null on a
   * Google or Spotify account even after setup: those are answered by the
   * session, and `LocalProfileValue.musicService` below is what merges the two
   * so no reader has to know which one spoke.
   */
  musicService: MusicService | null;
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
  /**
   * The service that actually answers the requirement: the sign-in provider's
   * when it settled one, otherwise whatever was picked on the setup screen.
   *
   * Shadows the draft's own field on purpose. No caller should have to know
   * which of the two spoke — only whether the question is answered.
   */
  musicService: MusicService | null;
  /**
   * True when the sign-in provider settled it, so the setup screen must SHOW it
   * rather than ask again.
   */
  serviceFromProvider: boolean;
  /**
   * The gate: a music service is chosen.
   *
   * THIS USED TO BE `hasPhoto && hasBio`, AND THAT WAS THE WRONG REQUIREMENT.
   * A photo and a bio are how people present themselves; neither is needed to
   * hear a song, and blocking the app on them stopped a new account at a
   * decorating task. What Aux genuinely cannot proceed without is somewhere for
   * the audio to come from. Photo and bio are still on the screen — they are
   * just optional now, which is what they always were in the design.
   */
  complete: boolean;
  update: (patch: Partial<LocalProfileDraft>) => void;
  /** Marks the gate passed. Ignored unless `complete`, so it cannot be forced. */
  markDone: () => void;
};

const EMPTY_DRAFT: LocalProfileDraft = {
  musicService: null,
  hasPhoto: false,
  photoUri: null,
  hasVideo: false,
  videoUri: null,
  bio: '',
  showActivity: true,
  profileDone: false,
};

const storageKey = (userId: string | null) => `aux:profile-local:${userId ?? 'anonymous'}`;

/**
 * The three services, as a runtime guard.
 *
 * Written out rather than derived from a list so that adding a fourth is a
 * compile error at the type, not a value that silently fails to parse back off
 * disk months later.
 */
function isMusicService(value: unknown): value is MusicService {
  return value === 'youtube' || value === 'spotify' || value === 'apple-music';
}

/** Narrow an unknown parse result without trusting any single field. */
function readDraft(raw: string | null): LocalProfileDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_DRAFT;
    const value = parsed as Partial<Record<keyof LocalProfileDraft, unknown>>;
    return {
      // Absent in every draft written before the gate moved to the service.
      // Those drafts also carry `profileDone: true`, and the shell's gate reads
      // THAT rather than `complete` — so an existing install is not sent back
      // through setup to answer a question it was never asked.
      musicService: isMusicService(value.musicService) ? value.musicService : null,
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
  const { user, providerMusicService } = useAuth();
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

  /*
    The provider wins over the stored pick, and it is not a close call: the
    session is the live fact and the draft is a per-device cache of an answer to
    a question this account was never asked. They can only disagree if someone
    linked Spotify to an email account after picking YouTube here, and in that
    case the link is the newer, stronger statement.
  */
  const musicService = providerMusicService ?? draft.musicService;
  const serviceFromProvider = providerMusicService !== null;
  const complete = musicService !== null;

  /*
    Teach the playback store what this account listens on.

    `adoptServiceDefault` will not overwrite a preference already on disk, so
    this is safe to run on every launch and safe to run against a choice the
    user made in Settings -> Connections. An explicit pick on the setup screen
    goes through `setSourcePreference` instead, which does overwrite — there the
    person is answering rather than being read.
  */
  useEffect(() => {
    if (hydrating || !musicService) return;
    void usePlayback.getState().adoptServiceDefault(musicService);
  }, [hydrating, musicService]);

  const markDone = useCallback(() => {
    // The gate, checked here as well as on the screen, so it cannot be forced by
    // a caller that skipped the button.
    if (!complete) return;
    setStore((current) => {
      if (current.key !== key) return current;
      if (current.draft.profileDone) return current;
      const next = { ...current.draft, profileDone: true };
      void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
      return { key, draft: next };
    });
  }, [complete, key]);

  const value = useMemo<LocalProfileValue>(
    () => ({
      ...draft,
      // After the spread: this is the merged answer, not the stored half.
      musicService,
      serviceFromProvider,
      hydrating,
      hasBio,
      complete,
      update,
      markDone,
    }),
    [draft, musicService, serviceFromProvider, hydrating, hasBio, complete, update, markDone]
  );

  return <LocalProfileContext.Provider value={value}>{children}</LocalProfileContext.Provider>;
}

/**
 * The profile gate and the locally-held half of the profile.
 *
 * Read by `(auth)/profile-setup` (the form), `(tabs)/_layout` (which redirects
 * to that form until `profileDone`) and anything that needs the activity flag.
 *
 * THE GATE IS THE MUSIC SERVICE. `complete` is `musicService !== null` and
 * nothing else — a photo and a bio are optional, and were only ever required
 * because an earlier pass read the design's checklist as a gate. See the
 * `complete` doc above.
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
                {/*
                  Above ToastProvider so that BOTH the sheet below and the
                  Settings screen inside `children` read the same update state.
                  That shared state is what lets Settings still offer an update
                  the user has already waved away.
                */}
                <UpdateProvider>
                  <ToastProvider>
                    {children}
                    {/*
                      Last sibling, so it paints above everything including the
                      tab bar. Inside ToastProvider because it is chrome, not a
                      screen — it has to survive navigation rather than unmount
                      with it.
                    */}
                    <UpdatePrompt />
                  </ToastProvider>
                </UpdateProvider>
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
