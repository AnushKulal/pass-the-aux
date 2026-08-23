/**
 * One person in a lounge's MEMBERS tab.
 *
 * README §8: avatar with presence dot, name + PREMIUM chip, `@handle · since`,
 * and an OWNER (accent fill) / MOD (accent outline) role chip. Rows open
 * profiles.
 *
 * Accent on a role chip looks like a violation of "red is reserved" until you
 * read §8 — the spec names these two chips and the PREMIUM chip explicitly, and
 * they are the only ranks in the app. Nothing else here reaches for it.
 */

import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import type { MemberRole } from '@/lib/database.types';
import { Fonts, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type MemberRowProps = {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  role: MemberRole;
  /** Marks the signed-in user's own row. */
  isYou?: boolean;
  /** ISO join date, printed as `since Mar 2025`. */
  joinedAt?: string | null;
  /** Drives the PREMIUM chip — `profiles.is_premium`. */
  isPremium?: boolean;
  /**
   * Presence dot. There is no presence table yet (README "Schema gaps"), so
   * callers pass this only where the answer is actually known.
   */
  isOnline?: boolean;
  /** Opens this person's profile. Without it the row is inert, not fake-tappable. */
  onPress?: () => void;
};

const AVATAR_SIZE = 34;
const DOT = 10;

/** Plain members get no chip — a badge on everyone is a badge on no one. */
const ROLE_LABEL: Record<MemberRole, string | null> = {
  owner: 'OWNER',
  mod: 'MOD',
  member: null,
};

/** `since Mar 2025`. Month + year: the day someone joined is never the point. */
function sinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function MemberRowBase({
  displayName,
  username,
  avatarUrl,
  role,
  isYou = false,
  joinedAt,
  isPremium = false,
  isOnline = false,
  onPress,
}: MemberRowProps) {
  const C = useColors();
  const roleLabel = ROLE_LABEL[role];
  const name = displayName.trim() || username;
  const since = useMemo(() => sinceLabel(joinedAt), [joinedAt]);

  const label = [
    name,
    `at ${username}`,
    isPremium ? 'Premium' : null,
    roleLabel,
    isYou ? 'You' : null,
    since ? `member since ${since}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: C.rule },
        pressed && onPress ? { backgroundColor: C.surface } : null,
      ]}>
      <View style={styles.avatarWell}>
        <Avatar name={name} uri={avatarUrl} size={AVATAR_SIZE} />
        {isOnline ? (
          /* Square, like everything else. The 2px ring in the ground colour is
             what separates the dot from the avatar behind it without a shadow. */
          <View style={[styles.dot, { backgroundColor: C.live, borderColor: C.bg }]} />
        ) : null}
      </View>

      <View style={styles.identity}>
        <View style={styles.nameLine}>
          <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
            {name}
          </Text>

          {isPremium ? (
            /* Neutral, like YOU below: a plan tier is not live, not playing and
               not an alarm, so it has no claim on the accent. */
            <View style={[styles.premium, { borderColor: C.rule2 }]}>
              <Text style={[styles.premiumLabel, { color: C.ink2 }]}>PREMIUM</Text>
            </View>
          ) : null}
        </View>

        <Text numberOfLines={1} style={[styles.handle, { color: C.ink3 }]}>
          @{username}
          {since ? ` · since ${since}` : ''}
        </Text>
      </View>

      {isYou ? (
        /* Neutral, not accent: "you" is not a rank. */
        <View style={[styles.chip, styles.chipOutline, { borderColor: C.rule2 }]}>
          <Text style={[styles.chipLabel, { color: C.ink2 }]}>YOU</Text>
        </View>
      ) : null}

      {/*
        Ranks, in ink — the same call the YOU chip above already makes and
        states. Owner outranks admin, so owner takes the inverted fill and
        admin the outline: that is emphasis drawn with weight rather than with
        the accent, which belongs to what is live, not to who is in charge.
      */}
      {roleLabel ? (
        role === 'owner' ? (
          <View style={[styles.chip, styles.chipFill, { backgroundColor: C.pill }]}>
            <Text style={[styles.chipLabel, { color: C.pillInk }]}>{roleLabel}</Text>
          </View>
        ) : (
          <View style={[styles.chip, styles.chipOutline, { borderColor: C.rule2 }]}>
            <Text style={[styles.chipLabel, { color: C.ink2 }]}>{roleLabel}</Text>
          </View>
        )
      ) : null}
    </Pressable>
  );
}

export const MemberRow = memo(MemberRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    minHeight: TOUCH_TARGET + Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: 11,
    borderBottomWidth: Rule.hair,
  },
  avatarWell: {
    flexShrink: 0,
  },
  dot: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: DOT,
    height: DOT,
    borderWidth: Rule.major,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs + 2,
  },
  name: {
    // A name is a label, not prose — the semibold face at the body's own size.
    ...Type.body(15),
    fontFamily: Fonts.semibold,
    flexShrink: 1,
  },
  handle: {
    ...Type.body(11),
    letterSpacing: tracking(11, 0.02),
  },
  premium: {
    borderWidth: Rule.hair,
    paddingHorizontal: Space.xs,
    paddingVertical: 1,
  },
  premiumLabel: {
    // The floor is 10px for anything readable; the artboard's 9px sits under it.
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
  },
  chip: {
    justifyContent: 'center',
  },
  chipFill: {
    paddingHorizontal: 7,
    paddingVertical: Space.xs,
  },
  chipOutline: {
    borderWidth: Rule.hair,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  chipLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
});
