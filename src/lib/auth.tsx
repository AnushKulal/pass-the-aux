/**
 * The single source of truth for "who is using this app right now".
 *
 * Mounted inside QueryClientProvider (see `@/lib/providers`) because the
 * profile row is fetched through React Query — that way `useSpotifyLink`'s
 * `invalidateQueries(['profile'])` refreshes the context too, and there is no
 * second copy of the profile to fall out of sync.
 */

import type { Session, User } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { fetchProfile, profileKeys } from '@/features/profile/queries';
import type { ProfileRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** Null while loading, and also for the brief window before the signup trigger's row is readable. */
  profile: ProfileRow | null;
  /** True until BOTH the session check and the first profile load have settled. */
  loading: boolean;
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
      signOut,
      refreshProfile,
      pendingUsernameClaim,
      beginUsernameClaim,
      finishUsernameClaim,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
