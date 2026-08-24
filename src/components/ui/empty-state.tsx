/**
 * The one card a screen shows where its content would be — empty, failed, or
 * filtered to nothing.
 *
 * THIS IS THE SHARED ONE. It exists because three screens had each grown their
 * own private `QuietCard` with the same body and slightly different numbers
 * (icon 30 vs 24, title 21 vs 19), and a fourth surface was still drawing the
 * abandoned direction's flush-left bordered block. An empty state is the part
 * of an app a user meets when something has already gone wrong; three dialects
 * of it is three chances to look broken.
 *
 * Two sizes, because the card has two jobs:
 *   `hero` — stands in for the tallest thing on a screen (the Feed's now-playing
 *            card). Bigger tile, bigger title, so the screen does not visibly
 *            deflate when there is nothing to show.
 *   `row`  — stands in for a list. Sized to the list's own row tile.
 *
 * Say what is true, then offer exactly one way forward — two only when they are
 * genuinely different routes (create one, or join with a code).
 */

import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AuxButton } from '@/components/ui/aux-button';
import { useColors } from '@/lib/theme-context';
import { Radii, Space, Type, raisedLarge, tracking } from '@/lib/theme';

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
};

export type EmptyStateSize = 'hero' | 'row';

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  /** One line. If it needs two, the title is doing too little. */
  description?: string;
  size?: EmptyStateSize;
  primary?: EmptyStateAction;
  /** A genuinely different route, not a second phrasing of the first. */
  secondary?: EmptyStateAction;
  /**
   * Escape hatch for a caller that has already composed its own action row.
   * Wins over `primary`/`secondary`. Prefer the props — they are what keep the
   * buttons the same size on every screen.
   */
  action?: ReactNode;
  /** Placement only — margins and width. The card's own skin is not overridable. */
  style?: StyleProp<ViewStyle>;
};

const TILE = { hero: 78, row: 56 } as const;
const GLYPH = { hero: 30, row: 24 } as const;
const TITLE = { hero: 21, row: 19 } as const;

export function EmptyState({
  icon: Icon,
  title,
  description,
  size = 'row',
  primary,
  secondary,
  action,
  style,
}: EmptyStateProps) {
  const C = useColors();

  const tile = TILE[size];
  const titleSize = TITLE[size];

  return (
    <View style={[styles.root, { backgroundColor: C.surface }, raisedLarge(C), style]}>
      <View
        style={[
          styles.tile,
          { width: tile, height: tile, backgroundColor: C.surface3 },
        ]}>
        <Icon size={GLYPH[size]} strokeWidth={1.75} color={C.ink3} />
      </View>

      <Text
        style={[
          styles.title,
          { color: C.ink, fontSize: titleSize, letterSpacing: tracking(titleSize, -0.025) },
        ]}>
        {title}
      </Text>

      {description ? (
        <Text style={[styles.description, { color: C.ink2 }]}>{description}</Text>
      ) : null}

      {/*
        The gap above the actions belongs to the card, not to the caller, so a
        hand-composed `action` row sits exactly where the built-in buttons
        would. Getting that wrong is how the Session's error card ended up with
        its buttons touching the line above them.
      */}
      {action ? (
        <View style={styles.actionSlot}>{action}</View>
      ) : primary ? (
        <View style={[styles.actionSlot, styles.actionRow]}>
          <AuxButton
            label={primary.label}
            onPress={primary.onPress}
            variant="cream"
            size="sm"
            align="center"
          />
          {secondary ? (
            <AuxButton
              label={secondary.label}
              onPress={secondary.onPress}
              variant="ghost"
              size="sm"
              align="center"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: Space.xl,
    borderRadius: Radii.xl,
    alignItems: 'flex-start',
  },
  tile: {
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Type.display(21),
    marginTop: Space.lg,
  },
  description: {
    ...Type.body(13.5),
    marginTop: Space.xs,
  },
  actionSlot: {
    marginTop: Space.xl,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    /* Over the 8px floor for adjacent targets. */
    gap: 10,
  },
});
