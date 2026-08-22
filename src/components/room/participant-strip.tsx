/**
 * Who is in the room right now.
 *
 * The host wears the live ring — "on aux" is a status, and seeing whose it is
 * without opening a menu is most of what makes the Session feel like a place
 * rather than a player.
 */

import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import { Avatar, Skeleton } from '@/components/ui';
import { useRoomParticipants, type ParticipantView } from '@/features/rooms/queries';
import { Colors, Radius, Space, Type } from '@/lib/theme';

const AVATAR_SIZE = 44;
const SKELETON_COUNT = 5;
/** Sized so the longest status, "catching up", still fits on one 13px line. */
const CHIP_WIDTH = 76;

export type ParticipantStripProps = {
  roomId: string | null;
  hostId: string | null;
  currentUserId: string | null;
};

export function ParticipantStrip({ roomId, hostId, currentUserId }: ParticipantStripProps) {
  const { data, isLoading } = useRoomParticipants(roomId);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ParticipantView>) => (
      <ParticipantChip
        participant={item}
        isHost={item.userId === hostId}
        isMe={item.userId === currentUserId}
      />
    ),
    [hostId, currentUserId]
  );

  if (isLoading && !data) {
    return (
      <View style={styles.row}>
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <View key={index} style={styles.chip}>
            <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius={Radius.pill} />
            <Skeleton width={40} height={12} />
          </View>
        ))}
      </View>
    );
  }

  const participants = data ?? [];

  return (
    <FlatList
      horizontal
      data={participants}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      accessibilityLabel={`${participants.length} ${
        participants.length === 1 ? 'person' : 'people'
      } in this Session`}
    />
  );
}

const keyExtractor = (item: ParticipantView) => item.userId;

type ParticipantChipProps = {
  participant: ParticipantView;
  isHost: boolean;
  isMe: boolean;
};

const ParticipantChip = memo(function ParticipantChip({
  participant,
  isHost,
  isMe,
}: ParticipantChipProps) {
  const name = isMe ? 'You' : participant.displayName;

  return (
    <View style={styles.chip}>
      <Avatar
        uri={participant.avatarUrl}
        name={participant.displayName}
        size={AVATAR_SIZE}
        live={isHost}
      />

      <Text numberOfLines={1} style={styles.name}>
        {name}
      </Text>

      {/*
        Text, not just the ring: the accent ring alone is a colour-only signal,
        and "on aux" is the single most important fact on this strip.
      */}
      <Text numberOfLines={1} style={[styles.status, isHost && styles.statusHost]}>
        {isHost ? 'on aux' : participant.isSynced ? 'in sync' : 'catching up'}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    gap: Space.lg,
    paddingVertical: Space.sm,
    paddingRight: Space.lg,
  },
  row: {
    flexDirection: 'row',
    gap: Space.lg,
    paddingVertical: Space.sm,
  },
  chip: {
    alignItems: 'center',
    gap: Space.xs,
    width: CHIP_WIDTH,
  },
  name: {
    ...Type.caption,
    color: Colors.text,
    maxWidth: CHIP_WIDTH,
  },
  status: {
    // Plain Type.caption (13px): this line carries the strip's whole point, so
    // it cannot sit under the legibility floor. The chip widened to suit.
    ...Type.caption,
    color: Colors.muted,
    maxWidth: CHIP_WIDTH,
  },
  statusHost: {
    color: Colors.accent,
  },
});
