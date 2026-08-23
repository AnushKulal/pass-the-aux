/**
 * The over-the-air update prompt.
 *
 * expo-updates fetches a new JavaScript bundle in the background; applying it
 * restarts the app. Restarting without asking would throw someone out of a
 * Session mid-track, so the reload is always the user's choice.
 *
 * Three ways out, deliberately:
 *   Update now  — apply and restart
 *   Not now     — dismissed for this launch; offered again next cold start
 *   X           — same as Not now, for anyone who reads a dismiss glyph first
 *
 * Nothing here is destructive, so none of the three needs a confirmation.
 *
 * WHERE THE NOTES COME FROM, AND WHY IT HAS TO WORK THIS WAY:
 * this component is running on the OLD bundle, so it cannot import the new
 * version's changelog — that code does not exist on the device yet. What it CAN
 * read is the incoming update's manifest, which carries that update's whole app
 * config. So the notes live in `expo.extra.releaseNotes` in app.json: they ship
 * inside the update that they describe, and are readable before it is applied.
 * Editing that array is how you change what this prompt says.
 */

import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { Duration, PointerEvents, Rule, Space, TOUCH_TARGET, Type, ZIndex } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** How long after launch to look, so the check never competes with first paint. */
const FIRST_CHECK_DELAY_MS = 4_000;

/**
 * How far below its resting place the sheet starts.
 *
 * A fixed value rather than a measured height: the card is absolutely
 * positioned against the bottom edge, so anything larger than the card puts it
 * fully off-screen, and measuring first would cost a frame in which the sheet
 * is visible but un-animated. 480 clears the tallest form this card takes (a
 * title, four notes and the action row) on every phone size.
 */
const SHEET_TRAVEL = 480;

/** Past this the sheet stops being a prompt and starts being a changelog. */
const MAX_NOTES = 4;

type Phase = 'idle' | 'available' | 'applying';

/**
 * Digs `expo.extra.releaseNotes` out of an update manifest.
 *
 * Every level is checked rather than cast through, because this reads a
 * document fetched over the network: a manifest from an older publish simply
 * will not have the key, and that has to degrade to "no notes" rather than
 * throw inside the update check and silently disable updating altogether.
 */
function readReleaseNotes(manifest: unknown): string[] {
  const at = (value: unknown, key: string): unknown =>
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;

  const notes = at(at(at(manifest, 'extra'), 'expoClient'), 'extra');
  const list = at(notes, 'releaseNotes');

  if (!Array.isArray(list)) return [];

  return list
    .filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
    .slice(0, MAX_NOTES);
}

export function UpdatePrompt() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('idle');
  const [notes, setNotes] = useState<string[]>([]);
  const dismissed = useRef(false);

  const y = useSharedValue(SHEET_TRAVEL);
  const opacity = useSharedValue(0);

  const show = useCallback(() => {
    setPhase('available');
    // Sheet duration, not the shorter entrance one — this travels the full
    // height of the card rather than nudging a module into place.
    const ms = reduced ? 0 : Duration.sheet;
    y.value = withTiming(0, { duration: ms });
    opacity.value = withTiming(1, { duration: ms });
  }, [opacity, reduced, y]);

  const hide = useCallback(() => {
    dismissed.current = true;
    const ms = reduced ? 0 : Duration.press;
    // Back down the way it came, so dismissing is the entrance reversed.
    y.value = withTiming(SHEET_TRAVEL, { duration: ms });
    opacity.value = withTiming(0, { duration: ms });
    setTimeout(() => setPhase('idle'), ms);
  }, [opacity, reduced, y]);

  const check = useCallback(async () => {
    // Updates never apply in development — the bundle comes from Metro, and
    // expo-updates is inert. Checking would only produce noise in the log.
    if (__DEV__ || dismissed.current) return;

    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;

      // Read the notes off the manifest BEFORE fetching: this is the only
      // description of the new version available to the old bundle.
      setNotes(readReleaseNotes(result.manifest));

      // Fetch BEFORE offering. "Update now" should restart immediately rather
      // than sit on a spinner over an unknown download on a phone network.
      await Updates.fetchUpdateAsync();
      show();
    } catch {
      // Offline, or the update server is unreachable. Silent by design: an
      // update the user never asked for is not worth an error message.
    }
  }, [show]);

  useEffect(() => {
    const first = setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);

    // Also look when the app comes back to the foreground, so a long-running
    // install picks up an update without ever being force-quit.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });

    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, [check]);

  const apply = useCallback(async () => {
    setPhase('applying');
    try {
      await Updates.reloadAsync();
    } catch {
      // If the reload is refused there is nothing useful left to try; put the
      // prompt back so the user can dismiss it rather than stare at a dead
      // button.
      setPhase('available');
    }
  }, []);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  if (phase === 'idle') return null;

  const applying = phase === 'applying';

  return (
    <View
      style={[styles.layer, { paddingBottom: insets.bottom + Space.lg }, PointerEvents.boxNone]}>
      <Animated.View
        style={[styles.card, animated, { backgroundColor: C.surface, borderColor: C.rule2 }]}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={[styles.kicker, { color: C.liveText }]}>UPDATE READY</Text>
            <Text style={[styles.title, { color: C.ink }]}>A new version of aux is ready</Text>
          </View>

          <Pressable
            onPress={hide}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
            style={styles.close}>
            <X size={20} strokeWidth={2} color={C.ink2} />
          </Pressable>
        </View>

        {/*
          What actually changed. Omitted entirely rather than shown empty when
          the incoming manifest predates `extra.releaseNotes` — an empty
          "What's new" heading is worse than no heading.
        */}
        {notes.length > 0 ? (
          <View style={[styles.notes, { borderTopColor: C.rule }]}>
            <Text style={[styles.notesKicker, { color: C.ink3 }]}>IN THIS PATCH</Text>
            {notes.map((note) => (
              <View key={note} style={styles.note}>
                {/* A rule, not a bullet glyph — separation is the rule here. */}
                <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                <Text style={[styles.noteText, { color: C.ink2 }]}>{note}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={[styles.body, { color: C.ink2 }]}>
          It installs instantly. The app restarts, so finish what you are listening to first if you
          would rather wait.
        </Text>

        <View style={[styles.actions, { borderTopColor: C.rule }]}>
          <Pressable
            onPress={hide}
            disabled={applying}
            accessibilityRole="button"
            style={[styles.action, { borderRightWidth: Rule.hair, borderRightColor: C.rule }]}>
            <Text style={[styles.actionLabel, { color: C.ink2 }]}>NOT NOW</Text>
          </Pressable>

          <Pressable
            onPress={apply}
            disabled={applying}
            accessibilityRole="button"
            style={[styles.action, { backgroundColor: C.live }]}>
            <Text style={[styles.actionLabel, { color: C.onLive }]}>
              {applying ? 'RESTARTING' : 'UPDATE NOW'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Space.lg,
    zIndex: ZIndex.toast,
    ...Platform.select({ android: { elevation: ZIndex.toast }, default: {} }),
  },
  card: {
    // Radius 0 and a hard border: no shadow, no glass. Separation is the rule.
    borderWidth: Rule.major,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Space.lg,
    paddingBottom: Space.sm,
    gap: Space.sm,
  },
  headText: { flex: 1, gap: 6 },
  kicker: Type.label(10),
  title: Type.display(20),
  close: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pull the glyph back to the card's edge without shrinking its hit area.
    marginTop: -Space.sm,
    marginRight: -Space.sm,
  },
  notes: {
    borderTopWidth: Rule.hair,
    marginHorizontal: Space.lg,
    paddingTop: Space.md,
    gap: Space.sm,
  },
  notesKicker: {
    ...Type.label(10),
    marginBottom: 2,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  noteMark: {
    width: 8,
    height: Rule.major,
    // Sits on the text's first-line baseline rather than its box top.
    marginTop: 8,
  },
  noteText: {
    ...Type.body(13),
    flex: 1,
  },
  body: {
    ...Type.body(14),
    padding: Space.lg,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: Rule.hair,
  },
  action: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: Type.heading(12),
});
