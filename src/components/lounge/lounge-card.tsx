import { Check, ChevronRight, Globe, Lock, Users } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, GlassCard, LivePulse, Skeleton } from '@/components/ui';
import { Colors, Radius, Space, Type } from '@/lib/theme';

export type LoungeCardProps = {
  name: string;
  description?: string;
  iconUrl?: string | null;
  /** Omitted on Explore: RLS hides the roster of a lounge you have not joined. */
  memberCount?: number;
  /** People currently inside this lounge's Sessions. */
  listeners?: number;
  /** Drives the live treatment even when a Session is empty. */
  activeSessions?: number;
  isPublic?: boolean;
  /** Shows the "Joined" badge — Explore only; the Lounges tab is all joined. */
  showJoined?: boolean;
  onPress: () => void;
};

const ICON_SIZE = 52;
const META_ICON = 14;

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function LoungeCardBase({
  name,
  description,
  iconUrl,
  memberCount,
  listeners = 0,
  activeSessions = 0,
  isPublic = true,
  showJoined = false,
  onPress,
}: LoungeCardProps) {
  const isLive = activeSessions > 0;
  // An active Session with nobody in it yet is still worth surfacing — it is an
  // invitation. Only the wording changes.
  const liveLabel = listeners > 0 ? `${listeners} listening` : 'Live now';

  const a11yParts = [
    name,
    isLive ? liveLabel : null,
    memberCount !== undefined ? pluralize(memberCount, 'member', 'members') : null,
    showJoined ? 'Joined' : null,
    isPublic ? null : 'Private',
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yParts.join(', ')}
      accessibilityHint="Opens this lounge"
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <GlassCard>
        <View style={styles.row}>
          <Avatar name={name} uri={iconUrl} size={ICON_SIZE} live={isLive} />

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={styles.name}>
                {name}
              </Text>

              {showJoined ? (
                <View style={styles.joined}>
                  <Check size={12} color={Colors.text} strokeWidth={3} />
                  <Text style={styles.joinedLabel}>Joined</Text>
                </View>
              ) : null}
            </View>

            {description ? (
              <Text numberOfLines={2} style={styles.description}>
                {description}
              </Text>
            ) : null}

            <View style={styles.meta}>
              {isLive ? (
                <View style={styles.metaItem}>
                  <LivePulse size={7} />
                  <Text style={styles.live}>{liveLabel}</Text>
                </View>
              ) : null}

              {memberCount !== undefined ? (
                <View style={styles.metaItem}>
                  <Users size={META_ICON} color={Colors.muted} />
                  <Text style={styles.metaLabel}>
                    {pluralize(memberCount, 'member', 'members')}
                  </Text>
                </View>
              ) : null}

              <View style={styles.metaItem}>
                {isPublic ? (
                  <Globe size={META_ICON} color={Colors.muted} />
                ) : (
                  <Lock size={META_ICON} color={Colors.muted} />
                )}
                <Text style={styles.metaLabel}>{isPublic ? 'Public' : 'Private'}</Text>
              </View>
            </View>
          </View>

          {/* Muted rather than faint: faint sits under 3:1 on glass, which is
              the floor for a graphic that carries meaning. */}
          <ChevronRight size={20} color={Colors.muted} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

/**
 * Memoized: these render inside FlatLists that re-render on every realtime
 * lounge update, and the whole card is pure props.
 */
export const LoungeCard = memo(LoungeCardBase);

/**
 * The card's loading twin. Lives here so its geometry cannot drift from the
 * real card's — a skeleton that resizes on load is worse than no skeleton.
 */
export function LoungeCardSkeleton() {
  return (
    <GlassCard>
      <View style={styles.row}>
        <Skeleton width={ICON_SIZE} height={ICON_SIZE} radius={ICON_SIZE / 2} />
        <View style={styles.skeletonBody}>
          <Skeleton width="55%" height={18} />
          <Skeleton width="85%" height={14} />
          <Skeleton width="35%" height={14} />
        </View>
      </View>
    </GlassCard>
  );
}

export function LoungeListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }, (_, index) => (
        <LoungeCardSkeleton key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: {
    // The card is the touch target and is far taller than 44pt already.
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
  body: {
    flex: 1,
    gap: Space.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    ...Type.heading,
    color: Colors.text,
    flexShrink: 1,
  },
  /*
    Primary, never accent: "Joined" is a state, not a live signal. Green in this
    app means something is playing right now.
  */
  joined: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  joinedLabel: {
    ...Type.caption,
    fontSize: 12,
    color: Colors.text,
  },
  description: {
    ...Type.body,
    color: Colors.muted,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  metaLabel: {
    ...Type.label,
    color: Colors.muted,
  },
  live: {
    ...Type.label,
    color: Colors.accent,
  },
  skeletonBody: {
    flex: 1,
    gap: Space.sm,
  },
  skeletonList: {
    gap: Space.md,
  },
});
