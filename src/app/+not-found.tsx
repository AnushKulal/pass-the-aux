import { router } from 'expo-router';
import { House } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Defs,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { AuxButton, Screen } from '@/components/ui';
import { Bloom, Colors, Fonts, PointerEvents, Space, Type } from '@/lib/theme';

/**
 * The line vocabulary of the illustration. Hairline whites between the two
 * border tokens, stepped down as the cable falls away from the viewer.
 */
const CABLE_NEAR = 'rgba(255, 255, 255, 0.30)';
const CABLE_FRAY = 'rgba(255, 255, 255, 0.26)';
const CABLE_FAR = 'rgba(255, 255, 255, 0.20)';
const CABLE_FARTHEST = 'rgba(255, 255, 255, 0.16)';
const JACK_EDGE = 'rgba(255, 255, 255, 0.22)';
const PLAYHEAD_TICK = 'rgba(255, 255, 255, 0.14)';
const PLAYHEAD_LINE = 'rgba(255, 255, 255, 0.12)';

/**
 * Reached by a bad deep link — a shared room URL for a Session that ended, or a
 * lounge invite that was revoked. `replace` rather than `back` because the
 * history entry that got us here is itself the broken one.
 */
export default function NotFoundScreen() {
  return (
    <Screen title="Off the map">
      {/* Colder and further away than the rest of the app: the bloom here is
          the violet and the blue, with the pink almost gone. */}
      <View style={[styles.bloom, PointerEvents.none]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="notFoundBloom" cx="50%" cy="52%" rx="64%" ry="48%">
              <Stop offset="0" stopColor={Bloom.b} stopOpacity={0.18} />
              <Stop offset="0.46" stopColor={Bloom.c} stopOpacity={0.1} />
              <Stop offset="0.78" stopColor={Colors.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#notFoundBloom)" />
        </Svg>
      </View>

      <View style={styles.center}>
        {/*
          The one idea this screen gets: the line that runs through everyone has
          been cut, and the playhead standing in the gap is dead — no glow, no
          live colour, a timecode that never resolves.
        */}
        <View
          style={[styles.art, PointerEvents.none]}
          accessible
          accessibilityRole="image"
          accessibilityLabel="A cut aux cable, with a stopped playhead in the gap between its two ends.">
          <Svg width="100%" height="100%" viewBox="0 0 375 168">
            <G>
              <Path
                d="M -6 60 C 46 60, 100 74, 152 88"
                stroke={CABLE_NEAR}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
              <Path
                d="M 152 88 c 8 -2, 12 -5, 19 -6"
                stroke={CABLE_FRAY}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
              <Path
                d="M 152 88 c 9 1, 15 3, 21 3"
                stroke={CABLE_FRAY}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
              <Path
                d="M 152 88 c 7 4, 11 8, 16 12"
                stroke={CABLE_FRAY}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
            </G>

            {/* The dead playhead. */}
            <Line x1={188} y1={26} x2={196} y2={26} stroke={PLAYHEAD_TICK} strokeWidth={1} />
            <Line x1={192} y1={26} x2={192} y2={146} stroke={PLAYHEAD_LINE} strokeWidth={1} />
            <Line x1={188} y1={146} x2={196} y2={146} stroke={PLAYHEAD_TICK} strokeWidth={1} />
            <SvgText
              x={192}
              y={162}
              textAnchor="middle"
              fill={Colors.faint}
              fontFamily={Fonts.mono}
              fontSize={11.5}
              letterSpacing={0.5}>
              --:--
            </SvgText>

            <G>
              <Path
                d="M 226 100 c -8 -3, -13 -5, -20 -6"
                stroke={CABLE_FAR}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
              <Path
                d="M 226 100 c -9 1, -15 2, -21 2"
                stroke={CABLE_FAR}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
              <Path
                d="M 226 100 c -7 4, -11 7, -17 10"
                stroke={CABLE_FAR}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
              <Path
                d="M 226 100 C 256 109, 284 116, 308 118"
                stroke={CABLE_FARTHEST}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
              <Rect
                x={306}
                y={110}
                width={15}
                height={16}
                rx={4}
                fill={Colors.surface}
                stroke={JACK_EDGE}
                strokeWidth={1.2}
              />
              <Rect
                x={321}
                y={113.5}
                width={32}
                height={9}
                rx={4.5}
                fill={Colors.surface}
                stroke={CABLE_NEAR}
                strokeWidth={1.2}
              />
              <Line x1={334} y1={114} x2={334} y2={122} stroke={CABLE_NEAR} strokeWidth={1.2} />
              <Line x1={342} y1={114} x2={342} y2={122} stroke={CABLE_NEAR} strokeWidth={1.2} />
              <Rect
                x={353}
                y={114.5}
                width={9}
                height={7}
                rx={3.5}
                fill={Colors.surface}
                stroke={CABLE_NEAR}
                strokeWidth={1.2}
              />
            </G>
          </Svg>
        </View>

        <View style={styles.copy}>
          <Text style={styles.title}>This link went nowhere</Text>
          <Text style={styles.body}>
            The lounge or Session you followed may have ended, or the invite was revoked.
          </Text>
        </View>

        <AuxButton label="Back to Home" icon={House} onPress={() => router.replace('/')} />
      </View>

      {/* Signature 4, at its smallest: the stamp on the dead end. */}
      <Text style={styles.stamp}>404</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloom: {
    position: 'absolute',
    // Out past the screen gutter so the glow reaches the edges rather than
    // stopping on the same line the content does.
    left: -Space.lg,
    right: -Space.lg,
    top: 0,
    bottom: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xxl,
  },
  art: {
    alignSelf: 'stretch',
    height: 168,
  },
  copy: {
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: 300,
  },
  title: {
    ...Type.heading,
    color: Colors.text,
    textAlign: 'center',
  },
  body: {
    ...Type.body,
    color: Colors.muted,
    textAlign: 'center',
  },
  stamp: {
    ...Type.mono,
    color: Colors.muted,
    textAlign: 'center',
    paddingBottom: Space.xxl,
  },
});
