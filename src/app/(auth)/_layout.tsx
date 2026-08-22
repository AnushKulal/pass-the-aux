import { Redirect, Stack, usePathname } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme-context';

/**
 * The signed-out group, plus one exception.
 *
 * `claim-username` lives here because it belongs to the signup flow, but it is
 * a signed-IN screen: it runs once right after signup and again whenever the
 * user edits their profile. Bouncing every session-holder to the tabs would
 * make it unreachable, so the guard is inverted for that one route.
 */
export default function AuthLayout() {
  const { session, loading, pendingUsernameClaim } = useAuth();
  const C = useColors();
  const pathname = usePathname();

  const claiming = pathname.endsWith('claim-username');

  // Render nothing rather than a spinner: the root layout is still holding the
  // splash on a cold start, so this frame is never actually seen.
  if (loading) return null;

  if (session && !claiming && !pendingUsernameClaim) return <Redirect href="/(tabs)" />;
  if (!session && claiming) return <Redirect href="/(auth)/sign-in" />;

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
