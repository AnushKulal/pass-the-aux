/**
 * The app-wide provider stack, in dependency order.
 *
 * Order matters and is not arbitrary:
 *   GestureHandlerRootView  must be the outermost native view or sheets/swipes
 *                           silently no-op on Android.
 *   SafeAreaProvider        insets are read by the tab bar and every Screen.
 *   QueryClientProvider     AuthProvider's profile fetch runs through it.
 *   AuthProvider            ToastProvider is mounted inside so auth errors can
 *                           surface as toasts.
 *   ToastProvider           must be innermost so its overlay paints above the
 *                           navigator without needing a portal.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { Colors } from '@/lib/theme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  /**
   * Painting the root view rather than relying on the navigator kills the
   * white flash Android shows between the splash and the first screen.
   */
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
});
