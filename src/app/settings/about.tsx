import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 12;

const REPOSITORY = 'https://github.com/AnushKulal/pass-the-aux';

/** Falls back to the manifest value the store build was stamped with. */
const VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function AboutScreen() {
  const C = useColors();
  const reduced = useReducedMotion();

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View
        style={styles.flex}
        entering={
          reduced
            ? undefined
            : FadeInDown.duration(Duration.enter).withInitialValues({
                opacity: 0,
                transform: [{ translateY: 8 }],
              })
        }>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/settings');
            }}
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
            <ArrowLeft size={15} strokeWidth={2} color={C.ink2} />
            <Text style={[styles.backLabel, { color: C.ink2 }]}>SETTINGS</Text>
          </Pressable>

          {/* The thesis, and the 2px rule that closes the masthead. */}
          <View style={[styles.masthead, { borderBottomColor: C.rule }]}>
            <Text style={[styles.screenTitle, { color: C.ink }]}>About</Text>
            <Text style={[styles.thesis, { color: C.ink2 }]}>
              Aux is built and maintained by one person. No audio passes through the backend — every
              listener plays from their own account, and the server only says{' '}
              <Text style={{ color: C.ink }}>this track, starting at this instant.</Text>
            </Text>
          </View>

          {/* ------------------------------------------------------- developer */}
          <View style={[styles.developer, { borderBottomColor: C.rule }]}>
            <View style={[styles.mark, { borderColor: C.live }]}>
              <Text style={[styles.markLabel, { color: C.liveText }]}>AUX</Text>
            </View>
            <View style={styles.developerText}>
              <Text style={[styles.developerName, { color: C.ink }]}>Anush Kulal</Text>
              <Text style={[styles.developerRole, { color: C.ink2 }]}>
                DEVELOPER · @ANUSHKULAL
              </Text>
            </View>
          </View>

          {/* ---------------------------------------------------- version cells */}
          <View style={[styles.cells, { borderBottomColor: C.rule }]}>
            <View style={[styles.cell, { borderRightWidth: Rule.hair, borderRightColor: C.rule }]}>
              <Text style={[styles.cellLabel, { color: C.ink3 }]}>VERSION</Text>
              {/* A version is a measurement, so it takes the readout voice. */}
              <Text style={[styles.cellReadout, { color: C.ink }]}>{VERSION}</Text>
            </View>
            <View style={styles.cell}>
              <Text style={[styles.cellLabel, { color: C.ink3 }]}>STACK</Text>
              <Text style={[styles.cellValue, { color: C.ink }]}>Expo · Supabase</Text>
            </View>
          </View>

          {/* ------------------------------------------------------- how sync */}
          <View style={[styles.note, { borderBottomColor: C.rule }]}>
            <Text style={[styles.noteKicker, { color: C.ink3 }]}>HOW SYNC WORKS</Text>
            <Text style={[styles.noteBody, { color: C.ink2 }]}>
              Clock offset is sampled NTP-style, five times, lowest round-trip wins. Drift is
              corrected on a three-rung ladder — ignore, nudge the playback rate ±2%, or hard-seek.
              Every reading is written to sync_metrics.
            </Text>
          </View>

          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open source repository"
            onPress={() => {
              void WebBrowser.openBrowserAsync(REPOSITORY).catch(() => undefined);
            }}
            style={({ pressed }) => [
              styles.repository,
              {
                borderColor: pressed ? C.live : C.rule2,
                backgroundColor: pressed ? C.surface : 'transparent',
              },
            ]}>
            <Text style={[styles.repositoryLabel, { color: C.ink }]}>Open source repository</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingBottom: Space.xxxl,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: GUTTER,
  },
  backLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.1),
  },
  masthead: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.lg,
    borderBottomWidth: Rule.major,
  },
  screenTitle: {
    ...Type.display(26),
    letterSpacing: tracking(26, -0.025),
  },
  thesis: {
    ...Type.body(16),
    marginTop: 6,
  },
  developer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: 14,
    borderBottomWidth: Rule.hair,
  },
  /** The mark, drawn in type: a 2px accent frame around the wordmark. */
  mark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.major,
  },
  markLabel: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.02),
  },
  developerText: {
    flex: 1,
    minWidth: 0,
  },
  developerName: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.01),
  },
  developerRole: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.09),
    marginTop: 2,
  },
  cells: {
    flexDirection: 'row',
    borderBottomWidth: Rule.hair,
  },
  cell: {
    flex: 1,
    padding: Space.md,
  },
  cellLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.11),
  },
  cellReadout: {
    ...Type.readout(16),
    fontVariant: ['tabular-nums' as const],
    marginTop: 3,
  },
  cellValue: {
    ...Type.heading(16),
    letterSpacing: tracking(16, 0.01),
    marginTop: 3,
  },
  note: {
    paddingHorizontal: GUTTER,
    paddingVertical: 14,
    borderBottomWidth: Rule.hair,
  },
  noteKicker: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.12),
    marginBottom: 6,
  },
  noteBody: {
    ...Type.body(14),
  },
  repository: {
    marginHorizontal: GUTTER,
    marginTop: Space.lg,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  repositoryLabel: {
    ...Type.label(14),
    letterSpacing: tracking(14, 0.06),
    textTransform: 'none',
  },
});
