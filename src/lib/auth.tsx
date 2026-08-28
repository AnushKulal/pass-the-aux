/**
 * The single source of truth for "who is using this app right now".
 *
 * Mounted inside QueryClientProvider (see `@/lib/providers`) because the
 * profile row is fetched through React Query — that way `useSpotifyLink`'s
 * `invalidateQueries(['profile'])` refreshes the context too, and there is no
 * second copy of the profile to fall out of sync.
 *
 * It also owns the OAuth round trip (`signInWithProvider` at the bottom) and
 * the one thing this app derives from it: WHICH MUSIC SERVICE THE ACCOUNT
 * PLAYS FROM. Signing in is the only moment that question can answer itself,
 * so the answer is computed here from the session rather than asked for again
 * on a form. See `musicServiceForUser`.
 */

import type { Session, User } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { fetchProfile, profileKeys } from '@/features/profile/queries';
import type { ProfileRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
// Type-only, deliberately: `@/playback/store` pulls both playback adapters in
// with it, and this module sits at the root of the provider tree. The type
// costs nothing at runtime; a value import would cost a cold start.
import type { MusicService } from '@/playback/store';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** Null while loading, and also for the brief window before the signup trigger's row is readable. */
  profile: ProfileRow | null;
  /** True until BOTH the session check and the first profile load have settled. */
  loading: boolean;
  /**
   * The music service the sign-in provider already settled, or null when
   * nothing has answered yet (an email/password account).
   *
   * A profile needs a music service and does NOT need a photo or a bio, so this
   * is the field the setup gate turns on: non-null means the required question
   * is already answered and must not be asked a second time.
   */
  providerMusicService: MusicService | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * Set between "sign up" and "username claimed". The `(auth)` layout reads it
   * so a brand-new account is not bounced into the tabs before it has had a
   * chance to pick a handle. Additive to the documented contract.
   */
  pendingUsernameClaim: boolean;
  beginUsernameClaim: () => void;
  finishUsernameClaim: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth() requires <AuthProvider> above it — it is mounted in @/lib/providers.');
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [pendingUsernameClaim, setPendingUsernameClaim] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The stored session is read from AsyncStorage, so this resolves a tick or
    // two after mount even when the user is signed in.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setSessionChecked(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setSessionChecked(true);

      // Almost every cached query is scoped to one account — lounges, rooms,
      // chat. Dropping the cache on the way out means the next person to sign
      // in on this device cannot see a frame of the previous person's data.
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id;

  // Derived during render, not stored: it is a pure function of the session, and
  // pushing it through state would give us one frame where a Google account has
  // no source and the setup screen asks a question it already knows the answer
  // to. Returns a string or null, so the memo below is not fooled by identity.
  const providerMusicService = musicServiceForUser(session?.user ?? null);

  const profileQuery = useQuery({
    queryKey: profileKeys.detail(userId ?? 'anonymous'),
    queryFn: () => fetchProfile(userId as string),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  /**
   * `isPending` is also true for a query that never runs, so the userId guard
   * is what lets a signed-out cold start finish loading. `fetchStatus` is
   * checked too: an offline device parks the query in 'paused' forever, and a
   * permanently-loading root layout is a blank screen with no way out.
   */
  const profilePending =
    Boolean(userId) && profileQuery.isPending && profileQuery.fetchStatus !== 'paused';

  const loading = !sessionChecked || profilePending;

  const refreshProfile = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: profileKeys.all });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    // Clear regardless of the result: a network failure here still leaves the
    // local session gone, and stale cached rows would outlive it.
    queryClient.clear();
    if (error) throw new Error(error.message);
  }, [queryClient]);

  const beginUsernameClaim = useCallback(() => setPendingUsernameClaim(true), []);
  const finishUsernameClaim = useCallback(() => setPendingUsernameClaim(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile: profileQuery.data ?? null,
      loading,
      providerMusicService,
      signOut,
      refreshProfile,
      pendingUsernameClaim,
      beginUsernameClaim,
      finishUsernameClaim,
    }),
    [
      session,
      profileQuery.data,
      loading,
      providerMusicService,
      signOut,
      refreshProfile,
      pendingUsernameClaim,
      beginUsernameClaim,
      finishUsernameClaim,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ------------------------------------------------------- identity providers */

/**
 * The identity providers Aux offers, beside email and password.
 *
 * Apple Music is NOT here and cannot be: Supabase has no apple-music auth
 * provider, MusicKit is iOS/web only and there is no Expo module for it. See
 * `MUSIC_SERVICE_SUPPORTED` in `@/playback/store` — the service is modelled so
 * the picker can name it as unavailable, but there is nothing to sign in to.
 */
export type OAuthProvider = 'google' | 'spotify';

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: 'Google',
  spotify: 'Spotify',
};

/**
 * Which of them settles which music service.
 *
 * GOOGLE -> YOUTUBE IS A UI TRUTH, NOT AN AUTH ONE, and that distinction is
 * worth stating rather than implying. YouTube playback here is the IFrame
 * player: it needs no token, no scope and no account, so there is no YouTube
 * link to make and signing in with Google does not make one. What it does is
 * remove the question — a Google user already has a source that works, so
 * profile setup shows it as settled instead of asking.
 *
 * SPOTIFY -> SPOTIFY is a real identity link, but it is only half the story:
 * driving playback needs the PKCE link in `features/spotify/use-spotify-link`,
 * because Supabase does not persist or refresh `provider_token`. See the
 * `MusicService` doc in `@/playback/store`.
 */
const PROVIDER_SERVICE: Record<OAuthProvider, MusicService> = {
  google: 'youtube',
  spotify: 'spotify',
};

/**
 * The music service a session already answers for, or null when nothing does.
 *
 * Reads every provider the account carries, not just `app_metadata.provider`:
 * that field is only the FIRST provider signed up with, so an email account
 * that later linked Spotify would report 'email' forever and be asked a
 * question it has already answered.
 *
 * Spotify outranks Google when both are present. It is the only one of the two
 * that is a genuine music account, so it is the stronger statement about what
 * this person listens on.
 */
export function musicServiceForUser(user: User | null): MusicService | null {
  if (!user) return null;

  const providers = new Set<string>();
  if (user.app_metadata.provider) providers.add(user.app_metadata.provider);
  for (const name of user.app_metadata.providers ?? []) providers.add(name);
  for (const identity of user.identities ?? []) providers.add(identity.provider);

  if (providers.has('spotify')) return PROVIDER_SERVICE.spotify;
  if (providers.has('google')) return PROVIDER_SERVICE.google;
  // Email and password. Nothing has answered the question, so profile setup has
  // to ask it — that is the one required step on that screen.
  return null;
}

/**
 * Where the provider sends the browser back.
 *
 * On web this is the ORIGIN rather than a dedicated callback route: the web
 * client runs with `detectSessionInUrl`, so whatever renders at `/` finishes the
 * handshake. Add each origin you serve from to Supabase Auth's redirect
 * allow-list.
 *
 * Note what is NOT here: `/spotify-callback`. That route belongs to the PKCE
 * account-LINK flow and posts its URL back to the tab that opened it — see the
 * header of `src/app/spotify-callback.tsx`. Spotify SIGN-IN is a Supabase OAuth
 * round trip and never touches it; the URL Spotify itself must have registered
 * for sign-in is Supabase's own `/auth/v1/callback`, not one of ours.
 */
function oauthRedirectUri(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return makeRedirectUri({ scheme: 'aux', path: 'auth-callback' });
}

/**
 * The whole OAuth round trip for one provider. Resolves when the session has
 * landed, or when the user backed out — which is a choice, not a failure, and
 * so is silent rather than thrown.
 *
 * A plain function rather than a hook so the sign-in screen can call it from a
 * press handler without a second copy of the redirect rules. `google` and
 * `spotify` differ in exactly one line (scopes) and nothing else, which is the
 * argument for one function over two.
 *
 * The CALLER must have run `WebBrowser.maybeCompleteAuthSession()` at module
 * scope — that is what closes the popup on web. `(auth)/sign-in.tsx` does.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const redirectTo = oauthRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      // Native has no page to navigate away from; we open the browser ourselves
      // so we can read the callback URL back out of it.
      skipBrowserRedirect: Platform.OS !== 'web',
      /*
        IDENTITY ONLY, AND NO PLAYBACK SCOPES. It is tempting to ask for
        `user-modify-playback-state` here and skip the second consent screen,
        but Supabase neither persists nor refreshes `provider_token`, so the
        token that grant buys is gone by the next cold start. Aux would then
        claim Spotify playback it cannot deliver. The durable token comes from
        the PKCE link in `features/spotify/use-spotify-link`, which hands the
        code to an Edge Function that stores a refresh token server-side.
        Asking twice is the honest price of keeping that token off the device.
      */
      ...(provider === 'spotify' ? { scopes: 'user-read-email' } : {}),
    },
  });
  if (error) throw new Error(error.message);

  // On web the tab is already navigating away; `detectSessionInUrl` picks the
  // session up when it comes back.
  if (Platform.OS === 'web') return;
  if (!data.url) throw new Error(`${PROVIDER_LABEL[provider]} sign-in could not be started.`);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  // Anything but 'success' means the user dismissed the browser.
  if (result.type !== 'success') return;

  await completeOAuthCallback(result.url, provider);
}

/**
 * Finishes the native leg of the round trip.
 *
 * Handles both flows on purpose: `flowType` is not pinned in `@/lib/supabase`,
 * so the callback may carry a PKCE `code` in the query or implicit tokens in the
 * fragment depending on which client default is in play.
 */
async function completeOAuthCallback(url: string, provider: OAuthProvider): Promise<void> {
  const [beforeHash = '', hash = ''] = url.split('#');
  const query = new URLSearchParams(beforeHash.split('?')[1] ?? '');
  const fragment = new URLSearchParams(hash);

  const code = query.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return;
  }

  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw new Error(error.message);
    return;
  }

  const returned =
    query.get('error_description') ??
    fragment.get('error_description') ??
    query.get('error') ??
    fragment.get('error');

  throw new Error(
    returned ?? `${PROVIDER_LABEL[provider]} did not return a session. Please try again.`
  );
}
