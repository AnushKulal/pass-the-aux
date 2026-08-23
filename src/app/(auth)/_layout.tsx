import { Redirect, Stack, usePathname } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme-context';

/**
 * The signed-out group, plus two exceptions.
 *
 * `claim-username` and `profile-setup` live here because they belong to the
 * signup flow, but both are signed-IN screens: they run right after signup and
 * again whenever the user edits their profile. Bouncing every session-holder to
 * the tabs would make them unreachable, so the guard is inverted for these.
 *
 * `profile-setup` in particular MUST be exempt. The tabs group redirects here
 * when the profile gate is unmet, so without this exemption the two layouts
 * redirect at each other forever.
 */
const SIGNED_IN_ROUTES = ['claim-username', 'profile-setup'];

export default function AuthLayout() {
  const { session, loading, pendingUsernameClaim } = useAuth();
  const C = useColors();
  const pathname = usePathname();

  const signedInScreen = SIGNED_IN_ROUTES.some((r) => pathname.endsWith(r));

  // Render nothing rather than a spinner: the root layout is still holding the
  // splash on a cold start, so this frame is never actually seen.
  if (loading) return null;

  if (session && !signedInScreen && !pendingUsernameClaim) return <Redirect href="/(tabs)" />;
  if (!session && signedInScreen) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
