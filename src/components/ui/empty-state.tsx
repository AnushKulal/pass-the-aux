/**
 * The one card a screen shows where its content would be — empty, failed, or
 * filtered to nothing.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` L272 and L395, which are the
 * same card twice: the house `--g` recipe at radius 24, a sentence of `ink2`
 * prose, and a pill CTA that HUGS ITS LABEL rather than spanning the card.
 *
 * THIS IS THE SHARED ONE. It exists because three screens had each grown their
 * own private `QuietCard` with the same body and slightly different numbers
 * (icon 30 vs 24, title 21 vs 19), and a fourth surface was still drawing the
 * abandoned direction's flush-left bordered block. An empty state is the part
 * of an app a user meets when something has already gone wrong; three dialects
 * of it is three chances to look broken.
 *
 * The skin is now `GlassCard` rather than a hand-rolled surface. That is the
 * point of the change, not a tidy-up: this card used to be a `surface` fill
 * plus `raisedLarge()` and NO BORDER, which was legible when `surface` was an
 * opaque grey. `surface` is 5.5% white now, and a translucent fill with a
 * shadow but no edge reads as flat — the empty state would have been the one
 * card on the screen that looked broken.
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
import { GlassCard } from '@/components/ui/glass-card';
import { useColors } from '@/lib/theme-context';
import { Radii, Rule, Space, Type, tracking } from '@/lib/theme';

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
    <GlassCard style={[styles.root, style]}>
      {/*
        A WELL, not a plate.

        Artwork inverted in this direction — it is a dark recess with a faint
        monogram rather than a bright tile — and this stands in for artwork, so
        it inverts with it. The old `surface3` fill would also have stacked 13%
        white inside the card's own 5.5% and come out brighter than the title
        sitting under it, which is the wrong thing to look at first.
      */}
      <View
        style={[
          styles.tile,
          { width: tile, height: tile, backgroundColor: C.bgRecessed, borderColor: C.rule },
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
          {/*
            `cream` is the blue primary in this direction — the two tokens
            resolve to the same value — and `pill` is the shape every CTA in the
            design takes. Both buttons hug their labels rather than stretching:
            `AuxButton` already defaults to `alignSelf: 'flex-start'`, which is
            the design's `inline-flex`, and a full-width button inside a card
            this small reads as the card's own footer instead of as a choice.
          */}
          <AuxButton
            label={primary.label}
            onPress={primary.onPress}
            variant="cream"
            size="sm"
            shape="pill"
            align="center"
          />
          {secondary ? (
            <AuxButton
              label={secondary.label}
              onPress={secondary.onPress}
              variant="ghost"
              size="sm"
              shape="pill"
              align="center"
            />
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
  },
  tile: {
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Type.display(21),
    marginTop: Space.lg,
  },
  description: {
    ...Type.body(14),
    marginTop: Space.xs,
  },
  actionSlot: {
    marginTop: Space.lg,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    /* Over the 8px floor for adjacent targets. */
    gap: 10,
  },
});
