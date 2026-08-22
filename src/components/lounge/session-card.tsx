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
          <View style={styles.badge}>
            <Radio size={20} color={Colors.accent} />
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
            <Headphones size={16} color={Colors.muted} />
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
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
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
    ...Type.caption,
    color: Colors.muted,
  },
  listeners: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  listenerCount: {
    ...Type.label,
    color: Colors.muted,
  },
});
