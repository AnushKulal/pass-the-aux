/**
 * The over-the-air update sheet.
 *
 * Rises from the bottom edge when an update has been fetched and is waiting.
 * Applying it restarts the app, which would throw someone out of a Session
 * mid-track, so the reload is always the user's choice.
 *
 * Three ways out, deliberately:
 *   Update now  — apply and restart
 *   Not now     — hides the sheet, and NOTHING else
 *   X           — same as Not now, for anyone who reads a dismiss glyph first
 *
 * "Not now" no longer loses the update: the state lives in `@/lib/updates`, so
 * Settings → Software update still offers it. That was the whole reason this
 * component stopped owning its own state.
 *
 * All this renders is the sheet. Which notes to show — and how far behind the
 * user is — is decided in `@/lib/release-notes`.
 */

import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useUpdates } from '@/lib/updates';

/**
 * How far below its resting place the sheet starts.
 *
 * A fixed value rather than a measured height: the card is absolutely
 * positioned against the bottom edge, so anything larger than the card puts it
 * fully off-screen, and measuring first would cost a frame in which the sheet
 * is visible but un-animated. 480 clears the tallest form this card takes.
 */
const SHEET_TRAVEL = 480;

export function UpdatePrompt() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const { promptVisible, pending, status, apply, dismissPrompt } = useUpdates();

  /**
   * Kept separate from `promptVisible` so the card survives its own exit —
   * unmounting the instant the flag flips would cut the slide-down off at the
   * first frame.
   */
  const [mounted, setMounted] = useState(false);

  const y = useSharedValue(SHEET_TRAVEL);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (promptVisible) {
      setMounted(true);
      // Sheet duration, not the shorter entrance one — this travels a full card
      // height rather than nudging a module into place.
      const ms = reduced ? 0 : Duration.sheet;
      y.value = withTiming(0, { duration: ms });
      opacity.value = withTiming(1, { duration: ms });
      return;
    }

    if (!mounted) return;

    // Back down the way it came, so dismissing is the entrance reversed.
    const ms = reduced ? 0 : Duration.press;
    y.value = withTiming(SHEET_TRAVEL, { duration: ms });
    opacity.value = withTiming(0, { duration: ms });

    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [promptVisible, mounted, reduced, y, opacity]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  if (!mounted) return null;

  const applying = status === 'applying';

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
            onPress={dismissPrompt}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
            style={styles.close}>
            <X size={20} strokeWidth={2} color={C.ink2} />
          </Pressable>
        </View>

        {/*
          What actually changed, across every patch this user skipped. Omitted
          entirely rather than shown empty when the incoming manifest predates
          the changelog — an empty heading is worse than no heading.
        */}
        {pending.notes.length > 0 ? (
          <View style={[styles.notes, { borderTopColor: C.rule }]}>
            <Text style={[styles.notesKicker, { color: C.ink3 }]}>
              {pending.patchCount > 1
                ? `IN THE LAST ${pending.patchCount} PATCHES`
                : 'IN THIS PATCH'}
            </Text>

            {pending.notes.map((note) => (
              <View key={note} style={styles.note}>
                {/* A rule, not a bullet glyph — separation is the rule here. */}
                <View style={[styles.noteMark, { backgroundColor: C.ink3 }]} />
                <Text style={[styles.noteText, { color: C.ink2 }]}>{note}</Text>
              </View>
            ))}

            {pending.hidden > 0 ? (
              <Text style={[styles.more, { color: C.ink3 }]}>
                {`+${pending.hidden} more ${pending.hidden === 1 ? 'fix' : 'fixes'}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.body, { color: C.ink2 }]}>
          It installs instantly. The app restarts, so finish what you are listening to first — you
          can always apply it later from Settings.
        </Text>

        <View style={[styles.actions, { borderTopColor: C.rule }]}>
          <Pressable
            onPress={dismissPrompt}
            disabled={applying}
            accessibilityRole="button"
            style={[styles.action, { borderRightWidth: Rule.hair, borderRightColor: C.rule }]}>
            <Text style={[styles.actionLabel, { color: C.ink2 }]}>NOT NOW</Text>
          </Pressable>

          <Pressable
            onPress={() => void apply()}
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
  more: {
    ...Type.label(10),
    // Aligns with the note text, past the 8px mark and its gap.
    marginLeft: 8 + Space.sm,
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
