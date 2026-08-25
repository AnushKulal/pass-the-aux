/**
 * The @-mention picker.
 *
 * Typing `@` opens a scoped list above the composer: a kicker naming the scope,
 * a count of the FULL filtered set, and the matches. The count and the scroll
 * are the point — §13 is explicit that the list must never truncate silently,
 * so this renders every match and lets the list scroll rather than slicing to a
 * "top 5" and lying about it in the header.
 *
 * IT FLOATS, IT NO LONGER DOCKS. It used to be a full-width panel welded to the
 * top of the composer bar: square outer corners, a hairline along its top edge,
 * `dropped()` for depth. Nocturne has no bars left to dock onto — the composer
 * below it is a floating capsule — so this is an object too: inset to the same
 * 14px gutter, rounded on all four corners, edged in `chromeBorder` the whole
 * way around, and lifted on `dropped()`.
 *
 * `chromeBorder` rather than `rule` is the load-bearing half of that. It is
 * roughly twice as bright, and that delta is precisely what separates a piece
 * of glass hovering over the page from a card sitting on it; with `rule` this
 * reads as another surface in the stack.
 *
 * The gap between this and the capsule is the composer frame's own top padding
 * — the picker is a layout sibling of the bar rather than an overlay, so the
 * thread gives up the room instead of having a panel land on top of it.
 *
 * Filtering is prefix-based on the handle OR the display name, from the first
 * character, matching the prototype's `startsWith` on both fields.
 *
 * ON THE ACCENT: THERE ISN'T ONE, AND THAT IS DELIBERATE. §13's "mentions
 * render in accent" is about a mention already sitting in a message body, where
 * coral says "this one concerns you" — a state. Nothing in this list is a
 * mention yet; it is a menu of people, and painting the handle column coral
 * would spend the state accent on a decoration. The whole panel is ink.
 * (An earlier header here claimed the opposite while the code did this. The
 * code was right.)
 *
 * The three exported helpers are pure and independently testable; the composer
 * uses them to find and complete the token, and nothing else in the file has
 * state.
 */

import { memo, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native';

import { Avatar } from '@/components/ui';
import { Fonts, Radii, Rule, Space, TOUCH_TARGET, Type, dropped, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * A person the picker can insert. Deliberately not `ProfileRow` — the lounge
 * scope carries a role in `sub` and the session scope carries a provider, so
 * the picker takes a flattened shape and the caller decides what `sub` means.
 */
export type MentionCandidate = {
  id: string;
  /** Without the leading `@`. */
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  /** The small uppercase line under the name — a role, a provider, anything. */
  sub?: string | null;
};

/** Where the caret's `@token` sits in the draft. */
export type MentionQuery = {
  /** Characters typed after the `@`, lowercased. Empty immediately after `@`. */
  token: string;
  /** Index of the `@` itself. */
  start: number;
  /** Index one past the last token character — i.e. the caret. */
  end: number;
};

/**
 * A mention starts at the beginning of the draft or after whitespace, so an
 * email address does not open the picker mid-word. Handles are the same
 * `[A-Za-z0-9_]` set the username claim allows.
 */
const MENTION_PATTERN = /(?:^|\s)@([A-Za-z0-9_]*)$/;

/** Four 48px rows, then it scrolls. */
const MAX_HEIGHT = 196;
const ROW_HEIGHT = 48;
const AVATAR = 28;

/** The composer capsule's gutter (L788, `margin:0 14px`). Kept in step by hand. */
const GUTTER = 14;
/**
 * Under the capsule's 28. That radius is half of a 56px pill and reads as a
 * pill; on a panel four times as tall the same corner reads as a lozenge, so
 * this takes the house card corner instead.
 */
const PANEL_RADIUS = Radii.xl;

/**
 * Finds the mention token the caret is currently sitting inside, or null.
 * Only the text BEFORE the caret is considered, so completing a mention in the
 * middle of an already-written sentence works.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const clamped = Math.max(0, Math.min(caret, text.length));
  const head = text.slice(0, clamped);
  const match = MENTION_PATTERN.exec(head);
  if (!match) return null;

  const token = match[1] ?? '';
  return { token: token.toLowerCase(), start: clamped - token.length - 1, end: clamped };
}

/**
 * Prefix match on handle or display name, from the first character. Returns the
 * FULL set — the caller must not slice it before handing it to the picker, or
 * the count in the header stops being true.
 */
export function filterMentions(
  people: readonly MentionCandidate[],
  token: string,
): MentionCandidate[] {
  if (!token) return [...people];
  return people.filter(
    (p) =>
      p.handle.toLowerCase().startsWith(token) || p.displayName.toLowerCase().startsWith(token),
  );
}

/**
 * Replaces the token with the completed handle and a single trailing space,
 * and reports where the caret should land.
 *
 * If the caret already sits in front of a space, that space is reused rather
 * than doubled — completing `@al| more` must not produce `@alice  more`.
 */
export function applyMention(
  text: string,
  query: MentionQuery,
  handle: string,
): { value: string; caret: number } {
  const before = text.slice(0, query.start);
  const after = text.slice(query.end);
  const gap = after.startsWith(' ') ? '' : ' ';

  return {
    value: `${before}@${handle}${gap}${after}`,
    // Past the handle and past the one space, whether it was inserted or reused.
    caret: before.length + 1 + handle.length + 1,
  };
}

export type MentionPickerProps = {
  /** The FULL pool for this scope. The picker filters; do not pre-filter. */
  people: readonly MentionCandidate[];
  /** The token from `findMentionQuery`. */
  token: string;
  onPick: (person: MentionCandidate) => void;
  /** The kicker, e.g. `In this lounge`, `In this Session`. */
  scopeLabel?: string;
  /** Overrides the four-row cap where a screen has more or less room. */
  maxHeight?: number;
};

type RowProps = {
  person: MentionCandidate;
  onPick: (person: MentionCandidate) => void;
};

function MentionRowBase({ person, onPick }: RowProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Mention ${person.displayName}, @${person.handle}`}
      onPress={() => onPick(person)}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: C.ruleSoft, backgroundColor: pressed ? C.surface2 : 'transparent' },
      ]}>
      <Avatar uri={person.avatarUrl} name={person.displayName} size={AVATAR} />

      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
          {person.displayName}
        </Text>
        {person.sub ? (
          <Text numberOfLines={1} style={[styles.sub, { color: C.ink3 }]}>
            {person.sub}
          </Text>
        ) : null}
      </View>

      <Text numberOfLines={1} style={[styles.handle, { color: C.ink2 }]}>
        @{person.handle}
      </Text>
    </Pressable>
  );
}

const MentionRow = memo(MentionRowBase);

export function MentionPicker({
  people,
  token,
  onPick,
  scopeLabel = 'In this conversation',
  maxHeight = MAX_HEIGHT,
}: MentionPickerProps) {
  const C = useColors();
  const matches = useMemo(() => filterMentions(people, token), [people, token]);

  // No matches is not an empty state — it is the picker getting out of the way
  // so you can keep typing an ordinary `@`.
  if (matches.length === 0) return null;

  const renderItem = ({ item }: ListRenderItemInfo<MentionCandidate>) => (
    <MentionRow person={item} onPick={onPick} />
  );

  return (
    /*
      THE SHADOW HAS TO LIVE ON AN OUTER VIEW. The panel below clips its rows to
      the rounded corner, and Android throws away a view's own boxShadow along
      with whatever `overflow: 'hidden'` clips — the picker would silently lose
      its lift on one platform only. Same split `GlassCard` makes for its bleed.
    */
    <View style={[styles.shell, dropped(C)]}>
      <View style={[styles.panel, { backgroundColor: C.surface, borderColor: C.chromeBorder }]}>
        <View style={styles.head}>
          <Text style={[styles.scope, { color: C.ink3 }]}>{scopeLabel}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.count, { color: C.ink3 }]}>
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </Text>
        </View>

        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ maxHeight }}
          // The keyboard is open by definition here; without this the first tap
          // is eaten dismissing it and the pick needs a second tap.
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Carries the placement and the lift. The panel below carries the skin. */
  shell: {
    flexGrow: 0,
    flexShrink: 0,
    // The composer's own gutter, so the two edges line up as one column.
    marginHorizontal: GUTTER,
    borderRadius: PANEL_RADIUS,
  },
  panel: {
    borderRadius: PANEL_RADIUS,
    borderWidth: Rule.hair,
    // Clips the row press-fill to the corner; the shell above holds the shadow.
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.sm,
  },
  scope: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
  },
  count: {
    /*
      A count measures, but at 10px the readout weight (800) would out-shout
      the accent kicker beside it. The prototype draws it at 400; tabular
      figures are kept so the number does not jitter as it changes while typing.
    */
    ...Type.label(10),
    fontFamily: Fonts.regular,
    letterSpacing: tracking(10, 0.09),
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: Space.lg,
    height: ROW_HEIGHT,
    // Over the 44px floor, and `getItemLayout` above depends on it being fixed.
    minHeight: TOUCH_TARGET,
    borderTopWidth: Rule.hair,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 17,
  },
  sub: {
    ...Type.label(10),
    fontFamily: Fonts.regular,
    letterSpacing: tracking(10, 0.09),
  },
  handle: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 0,
  },
});
