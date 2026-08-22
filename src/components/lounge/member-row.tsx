import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import type { MemberRole } from '@/lib/database.types';
import { Colors, Fonts, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type MemberRowProps = {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  role: MemberRole;
  /** Marks the signed-in user's own row. */
  isYou?: boolean;
};

const AVATAR_SIZE = 40;

/** Plain members get no chip — a badge on everyone is a badge on no one. */
const ROLE_LABEL: Record<MemberRole, string | null> = {
  owner: 'Owner',
  mod: 'Mod',
  member: null,
};

function MemberRowBase({ displayName, username, avatarUrl, role, isYou = false }: MemberRowProps) {
  const roleLabel = ROLE_LABEL[role];
  const name = displayName.trim() || username;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={[name, `at ${username}`, roleLabel, isYou ? 'You' : null]
        .filter(Boolean)
        .join(', ')}
      style={styles.row}>
      <Avatar name={name} uri={avatarUrl} size={AVATAR_SIZE} />

      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text numberOfLines={1} style={styles.username}>
          @{username}
        </Text>
      </View>

      {isYou ? (
        <View style={[styles.chip, styles.chipYou]}>
          <Text style={styles.chipLabel}>You</Text>
        </View>
      ) : null}

      {/*
        Colors.primary, deliberately. Accent is reserved for "playing / live /
        join" — a moderator badge in that green would read as "in a Session".
        Owner takes the filled chip and mod the outlined one, so the two ranks
        separate without either of them reaching for a second hue.
      */}
      {roleLabel ? (
        <View style={[styles.chip, role === 'owner' ? styles.chipOwner : styles.chipMod]}>
          <Text style={styles.chipLabel}>{roleLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const MemberRow = memo(MemberRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    // Not tappable, but held at the same rhythm as everything that is.
    minHeight: TOUCH_TARGET,
    paddingVertical: Space.sm,
  },
  identity: {
    flex: 1,
    gap: 1,
  },
  name: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  username: {
    ...Type.label,
    color: Colors.muted,
  },
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipOwner: {
    backgroundColor: Colors.primary,
    borderColor: 'transparent',
  },
  chipMod: {
    backgroundColor: Colors.glass,
    borderColor: Colors.primary,
  },
  chipYou: {
    backgroundColor: Colors.glass,
    borderColor: Colors.borderBright,
  },
  chipLabel: {
    // 12.5 is the readable floor; the old 12px override sat under it.
    ...Type.caption,
    fontFamily: Fonts.bodyMedium,
    color: Colors.text,
  },
});
