/**
 * One person in a lounge's MEMBERS tab.
 *
 * design/nocturne/aux-nocturne.dc.html L502-L515: a 40px round avatar with a
 * punched presence dot, the name with a PREMIUM chip beside it, `@handle ·
 * since`, and an OWNER or MOD badge on the right. Rows open profiles.
 *
 * EVERY BADGE HERE IS CORAL, AND THAT IS THE ACCENT RULE RATHER THAN A BREACH
 * OF IT. Nocturne runs two accents: coral is a STATE of the world, blue is an
 * ACTION you take. OWNER, MOD and PREMIUM are all states a person is IN — none
 * of them is something you press — so coral is their native register, and the
 * design spends it on exactly these three (L508, L511, L513). The version this
 * replaces painted OWNER with `pill`, the blue that means "you do this": a rank
 * drawn in the action colour, which reads as a button you cannot press.
 *
 * OWNER takes the solid `live` fill with `onLive` on it — a warm near-black,
 * NOT white, which fails on coral. MOD and PREMIUM take the `liveMid` outline,
 * because a fill on all three would flatten the rank back out again.
 *
 * YOU is the one neutral chip. It is not a rank and it appears on exactly one
 * row in the list, so giving it the accent would make the accent mean "you" as
 * well as "live".
 *
 * THE ROW HAS NO FILL OF ITS OWN, and that is the translucency hazard handled
 * rather than ignored. `surface` is 5.5% white and the design nests this roster
 * inside a `surface` card (L500); a second translucent fill in there composites
 * to ~11% and the row stops reading as a row. So it is transparent at rest and
 * only borrows `surface2` on press, which is the press the artboard draws (L502
 * `style-active`) — the card-in-card hazard is about a second RESTING surface,
 * not about a press.
 *
 * THE ONLY MEMBER ROW IN THE APP, as of this pass, and it was not before.
 * `src/app/(tabs)/lounge/[id].tsx` carried a private `MemberCell` copy of this
 * component and rendered that instead, on the strength of a header comment
 * claiming this file was "Patchbay-era — square, radius-free" with "a blue
 * OWNER fill". That claim was already false when it was written: the badges
 * below are round, and the blue OWNER fill is the very bug the paragraph above
 * records fixing. The duplicate is deleted and the lounge screen imports this;
 * the note that used to sit here asking the two to stay in step is gone with
 * it, because there is no longer a second one to stay in step with.
 *
 * The one thing the copy did differently was hand-roll the presence dot as an
 * absolutely-positioned disc pinned to an avatar wrapper. `Avatar presence`
 * shipped here instead, and that is an upgrade rather than a loss — see the
 * note at the avatar for why the ring has to come from the theme.
 *
 * DELIBERATE OMISSION: the design's footnote under this list promises that
 * "owners and mods can remove members", but the artboard's row carries no
 * remove control and this component has never had one. Adding it would be a new
 * feature with no mutation behind it, not a restyle. When it lands it is
 * `danger` — the pink-red that is now distinct from both accents — and never
 * `live`, which would say the removal is something happening rather than
 * something you are about to do.
 *
 * THE ROSTER CASCADES IN, ONE ROW AT A TIME. This is the design's `auxRow` and
 * it is the reason the roster reads as a list of PEOPLE rather than as a block
 * of text: the whole segment used to cross-fade in as one, so fifty rows landed
 * at the same instant with the same treatment. `index` drives `useEntrance`,
 * which caps the stagger at eight steps — a roster of two hundred finishes
 * arriving instead of trickling, and row 40 is off-screen anyway.
 */

import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Avatar } from '@/components/ui';
import type { MemberRole } from '@/lib/database.types';
import { useEntrance } from '@/lib/entrance';
import { Fonts, Radii, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
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
  /**
   * Position in the roster. Drives the 55ms-per-row entrance stagger, and it is
   * the `index` `renderItem` already hands over — threading it costs the row
   * nothing, because a number is as cheap to compare as the props beside it.
   */
  index?: number;
  /** Opens this person's profile. Without it the row is inert, not fake-tappable. */
  onPress?: () => void;
};

/** L504: the design's roster avatar. The square row this replaces drew 34. */
const AVATAR_SIZE = 40;

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
  index = 0,
  onPress,
}: MemberRowProps) {
  const C = useColors();
  /* `auxRow` — 8px up, fading, 55ms behind the row above. See the header. */
  const entering = useEntrance({ index, kind: 'row' });
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
    /*
      `Animated.View` around the row rather than an animated `Pressable`: the
      press already writes `backgroundColor` through this element's own style
      callback, and the hairline that separates rows belongs on the pressable
      surface so the highlight lands inside it.
    */
    <Animated.View style={entering}>
      <Pressable
        accessible
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={label}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          // `ruleSoft`, not `rule`: these separate rows WITHIN one card and the
          // card already owns the heavier edge. L502 draws `--aux-rule-s`.
          { borderBottomColor: C.ruleSoft },
          pressed && onPress ? { backgroundColor: C.surface2 } : null,
        ]}>
        {/*
          The presence dot is the kit's now, not a hand-rolled square pinned to a
          wrapper. `Avatar presence` draws it as a HOLE — a coral disc ringed in
          the screen colour, so it reads as punched through the face — and that
          ring has to follow the theme; the pinned value the old row used leaves a
          dark notch on a light ground. The absolutely-positioned wrapper went
          with it, which is why there is no `avatarWell` here any more.

          `identity` is the coral-to-magenta gradient, and it is reserved for the
          signed-in user: the point of a gradient only you carry is that you can
          find yourself in a roster of two hundred.
        */}
        <Avatar
          name={name}
          uri={avatarUrl}
          size={AVATAR_SIZE}
          presence={isOnline}
          identity={isYou}
        />

        <View style={styles.identity}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
              {name}
            </Text>

            {/*
              L508. Premium is a STATE — this person's plays route through Spotify
              right now — so it is coral, in the outline register the design gives
              it here. The profile header at L372 shouts the same word in the solid
              fill; a roster of fifty would be unreadable at that volume, which is
              why the artboard itself splits the two.
            */}
            {isPremium ? (
              <View style={[styles.badgeOutline, { borderColor: C.liveMid }]}>
                <Text style={[styles.badgeLabel, { color: C.liveText }]}>PREMIUM</Text>
              </View>
            ) : null}
          </View>

          <Text numberOfLines={1} style={[styles.handle, { color: C.ink3 }]}>
            @{username}
            {since ? ` · since ${since}` : ''}
          </Text>
        </View>

        {isYou ? (
          <View style={[styles.badgeOutline, { borderColor: C.rule2 }]}>
            <Text style={[styles.badgeLabel, { color: C.ink2 }]}>YOU</Text>
          </View>
        ) : null}

        {/*
          NOT `StatusPill`, and this is the one place in the file where the kit is
          deliberately passed over. `StatusPill` is `accessible` with
          `accessibilityRole="text"`, so up to three of them inside a row that is
          itself one accessible unit would split a single announcement into four.
          The row's own label above already spells out the rank in words.
        */}
        {roleLabel ? (
          role === 'owner' ? (
            <View style={[styles.badgeFill, { backgroundColor: C.live }]}>
              <Text style={[styles.badgeLabel, { color: C.onLive }]}>{roleLabel}</Text>
            </View>
          ) : (
            <View style={[styles.badgeOutline, { borderColor: C.liveMid }]}>
              <Text style={[styles.badgeLabel, { color: C.liveText }]}>{roleLabel}</Text>
            </View>
          )
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export const MemberRow = memo(MemberRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.md,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.md,
    borderBottomWidth: Rule.hair,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  name: {
    // A name is a label, not prose — the semibold face at the body's own size.
    ...Type.body(15),
    fontFamily: Fonts.semibold,
    flexShrink: 1,
  },
  handle: {
    // Tightened from the body role's 1.5 ratio: this line sits 2px under the
    // name, and the default leading pushes the pair off the avatar's centre.
    ...Type.body(11),
    lineHeight: 14,
  },
  /*
    ROUND, not square. Every badge in this direction is a full pill (L508, L511,
    L513); the zero-radius chips this file used to draw belonged to Patchbay,
    and a square chip beside a round avatar reads as a rendering fault rather
    than as a style.
  */
  badgeOutline: {
    borderWidth: Rule.hair,
    borderRadius: Radii.pill,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    justifyContent: 'center',
  },
  badgeFill: {
    borderRadius: Radii.pill,
    paddingHorizontal: 9,
    paddingVertical: Space.xs,
    justifyContent: 'center',
  },
  badgeLabel: {
    // The floor is 10px for anything readable; the artboard's 9px sits under it.
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
  },
});
