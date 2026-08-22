import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.'
  );
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // On web, supabase-js uses localStorage by default; AsyncStorage is only
    // meaningful (and only importable without warnings) on native.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native has no URL bar to read the OAuth fragment from; we hand the
    // callback to supabase ourselves in the auth screen.
    detectSessionInUrl: Platform.OS === 'web',
  },
  realtime: {
    // Presence heartbeats and room broadcasts are small and frequent; the
    // default of 10/sec is more than enough and keeps us inside the free tier.
    params: { eventsPerSecond: 10 },
  },
});

/**
 * Supabase refreshes tokens on a timer, and iOS suspends timers in the
 * background. Without this, a phone that has been backgrounded for a while
 * wakes up with an expired token and every realtime channel silently fails.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
