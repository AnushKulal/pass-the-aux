import { Headphones, Radio } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard, LivePulse } from '@/components/ui';
import { Colors, Radius, Space, Type } from '@/lib/theme';

export type SessionCardProps = {
  name: string;
  hostName: string;
  listeners: number;
  isPlaying: boolean;
  nowPlaying: { title: string; artist: string } | null;
  onPress: () => void;
};

const ICON_STROKE = 1.6;
const BADGE = 44;

/*
  SYSTEM.md's `--live-dim`. theme.ts exports `accentDim` as a solid tone, which
  would paint a hard teal block; this badge needs the wash so the card's own
  glass still reads through it. Derived from Colors.accent, and the only reason
  it is spelled out here is that the token set has no translucent form of it.
*/
const LIVE_WASH = 'rgba(87, 226, 213, 0.14)';
const LIVE_EDGE = 'rgba(87, 226, 213, 0.30)';

function SessionCardBase({
  name,
  hostName,
  listeners,
  isPlaying,
  nowPlaying,
  onPress,
}: SessionCardProps) {
  const subtitle = nowPlaying
    ? `${nowPlaying.title} — ${nowPlaying.artist}`
    : `${hostName} is on aux`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${subtitle}. ${listeners} listening.`}
      accessibilityHint="Opens this Session"
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <GlassCard>
        <View style={styles.row}>
          {/*
            One of the few places outside the Feed where accent is earned: a
            Session card only exists for a room you can walk into right now.
          */}
          <View style={styles.badge}>
            <Radio size={20} color={Colors.accent} strokeWidth={ICON_STROKE} />
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              {isPlaying ? <LivePulse size={7} /> : null}
              <Text numberOfLines={1} style={styles.name}>
                {name}
              </Text>
            </View>

            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>

            {nowPlaying ? (
              <Text numberOfLines={1} style={styles.host}>
                {hostName} is on aux
              </Text>
            ) : null}
          </View>

          <View style={styles.listeners}>
            <Headphones size={16} color={Colors.muted} strokeWidth={ICON_STROKE} />
            <Text style={styles.listenerCount}>{listeners}</Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

export const SessionCard = memo(SessionCardBase);

const styles = StyleSheet.create({
  pressable: {
    width: '100%',
  },
  pressed: {
    opacity: 0.72,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIVE_WASH,
    borderWidth: 1,
    borderColor: LIVE_EDGE,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  name: {
    ...Type.bodyStrong,
    color: Colors.text,
    flexShrink: 1,
  },
  subtitle: {
    ...Type.body,
    color: Colors.muted,
  },
  /*
    Colors.muted, not Colors.faint: faint measures ~2.7:1 against the glass
    surface, which is under the 4.5:1 floor for anything that is real copy.
  */
  host: {
    ...Type.monoLabel,
    color: Colors.muted,
    marginTop: 2,
  },
  listeners: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  /** A head count measures. Mono. */
  listenerCount: {
    ...Type.mono,
    color: Colors.muted,
  },
});
