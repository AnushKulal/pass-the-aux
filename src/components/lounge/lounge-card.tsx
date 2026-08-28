/**
 * One lounge, as a row — and it has to hold at two sizes on two grounds.
 *
 * design/nocturne/aux-nocturne.dc.html draws this object twice with the same
 * parts and different metrics: L268 (Explore — radius 24 with `--sh`, a 46px
 * tag tile, a description under the name) and L399 (the profile's "Your
 * lounges" — radius 18, no shadow, a 38px tile, one line of counts). The
 * artboard is exact about which corner means what: all 43 of its radius-24
 * surfaces carry a shadow and none of its 54 radius-18 surfaces do. So
 * `variant` is not a taste knob — `card` is a row STANDING on the page, `row`
 * is a row sitting inside something else.
 *
 * THE TRANSLUCENCY TRAP, WHICH IS THIS FILE'S REAL HAZARD. `surface` is 5.5%
 * white, so two of them stacked composite to ~11% and the inner one stops
 * reading as a separate object; the same fill laid over album art goes
 * see-through. A row dropped inside a section card must therefore be handed
 * `solid`, which swaps in the opaque composite. `GlassCard` owns that switch,
 * and that is most of why the skin is no longer hand-rolled here — the previous
 * version painted `C.surface` + `raised()` directly and had no way to say
 * "nested".
 *
 * THE ACCENT. A live lounge is a STATE, so it is coral, in three registers: a
 * wash pill when there is a NUMBER to report, a bare dot when a Session is
 * PLAYING to an empty room, and the `badge` word beside the name for a
 * membership you already hold. All of them mean "this is true of the world
 * right now".
 *
 * WHICH IS ONLY WORTH SAYING IF `isLive` IS TRUE OF THE WORLD, AND IT WAS NOT.
 * Callers used to pass `activeSessions > 0` — a room ROW EXISTING — so a lounge
 * where somebody had pressed "Start a Session" and immediately backed out wore
 * the live dot forever. `isLive` is a verdict now, not a row count, and
 * `isLoungeLive` in `@/features/lounges/live` is the only thing allowed to
 * reach it. See the note on the prop.
 *
 * The one blue thing is `cta`, and it is blue because it is the only thing on
 * the row that names an ACTION — "Join". It is drawn as an affordance INSIDE
 * the row's own Pressable rather than as a second button: a 44px cell inside a
 * 90px card that does exactly what the card does is two targets for one intent,
 * so screen readers get one node and the cell borrows the card's pressed state
 * for its edge. A row never carries `cta` and a coral pill in the same trailing
 * slot — no element and no slot takes two accents.
 *
 * THIS COMPONENT WAS ORPHANED AND IS NOT ANY MORE. Explore and the Lounges tab
 * both carried comments claiming this file "still draws the previous
 * direction's row (radius 22, no border)" and hand-rolled a duplicate on the
 * strength of it. It was false — the file was rebuilt for nocturne — and the
 * app shipped three lounge rows with three different tile radii. `badge` and
 * `cta` are the two props those forks actually needed; both screens now render
 * this.
 *
 * THE ARRIVAL IS `useEntrance` AND IS NO LONGER BUILT HERE. This file used to
 * hand-roll `auxRow`: its own shared value, its own reduced-motion branch, its
 * own `useRef(index * Stagger.feed)` and a 280ms `Duration.enter` on a curve one
 * control point off the design's. Three files had grown their own copy of that
 * animation. The shared hook keeps the one thing this copy was right about — the
 * delay is read ONCE and held, so a realtime refetch reordering the list cannot
 * restart the entrance of a row already sitting still — and fixes two things it
 * could not fix from in here: it keys off FOCUS rather than mount, so the
 * cascade replays every time a screen is entered instead of once per app launch
 * (a tab navigator never unmounts its screens), and it runs at `Duration.row`
 * (240ms) with the 8px lift the design actually specifies for a row, where this
 * copy had borrowed a module's 280ms.
 *
 * This row is rendered by three screens, so it is also the single place where
 * fixing that reaches the most of the app.
 */

import { Image } from 'expo-image';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { LiveDot } from '@/components/feed/live-dot';
import { GlassCard, Skeleton, StatusPill } from '@/components/ui';
import { useEntrance } from '@/lib/entrance';
import { Duration, Fonts, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** `card` is Explore's row (L268); `row` is the profile's (L399). */
export type LoungeCardVariant = 'card' | 'row';

type Metrics = {
  tile: number;
  /** The artboard's own corners: 15 on the 46px tile, 13 on the 38px one. */
  tileRadius: number;
  tag: number;
  padding: number;
  gap: number;
  /** The face the name is set in — extrabold on the card, semibold in the row. */
  nameFont: string;
  marginBottom: number;
};

const SIZES: Record<LoungeCardVariant, Metrics> = {
  card: {
    tile: 46,
    tileRadius: 15,
    tag: 12,
    padding: 14,
    gap: 11,
    nameFont: Fonts.extrabold,
    marginBottom: Space.md,
  },
  row: {
    tile: 38,
    tileRadius: 13,
    tag: 10,
    padding: 13,
    gap: Space.md,
    nameFont: Fonts.semibold,
    marginBottom: 10,
  },
};

/**
 * The action cell's floor. 44 is the touch-target minimum even though the cell
 * takes no press itself — it is the visual promise of one, and a 30px pill
 * beside a 46px tile reads as an afterthought. Shared with the skeleton so the
 * row cannot resize when the data lands.
 */
const CTA_HEIGHT = 44;
const CTA_WIDTH = 62;

export type LoungeCardProps = {
  name: string;
  /** Prose under the name. Explore only — the Lounges tab carries counts here. */
  description?: string | null;
  /** One line of state: the counts, or what a tap is about to do. */
  meta?: string;
  iconUrl?: string | null;
  /** Stand-in in the tile. Derived from the name when absent. */
  tag?: string;
  /**
   * A LIVE Session is running in this lounge — playing, or with somebody in it.
   *
   * NOT "a room row exists", which is what every caller used to pass and what
   * lit this dot on empty lounges. `isLoungeLive(summary)` from
   * `@/features/lounges/live` is the one correct source; anything else is a
   * screen inventing its own definition of the word, which is the bug.
   */
  isLive?: boolean;
  /** People inside those Sessions. Above zero, the pill reports the number. */
  listeners?: number;
  /**
   * A coral word beside the name — a STATE you already hold, not a count.
   * Explore's "Joined". It sits in the name row rather than the trailing slot
   * because on a joined lounge that slot is holding the "Open" cell.
   */
  badge?: string;
  /**
   * The trailing action cell (design L349): a blue label in a `surface2` pill,
   * NOT a Pressable — see the header. Only the verb; the row does the work.
   */
  cta?: string;
  /** A join is in flight: the row stops taking taps and steps back. */
  busy?: boolean;
  /** Position in the list. Drives `useEntrance`'s 55ms-per-row stagger. */
  index?: number;
  /**
   * `card` (the default) stands on the page: radius 24, a shadow, and the
   * translucent fill the ambient blobs bleed through. `row` sits inside
   * something else: radius 18, flat.
   */
  variant?: LoungeCardVariant;
  /**
   * OPAQUE FILL. Required whenever this row is nested inside another `surface`
   * card, laid over artwork, or mounted inside a `BlurView` — see the header.
   */
  solid?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
};

/** `Bass Face` → `BF`; `Dub` → `DUB`. Never longer than four characters. */
export function tagFor(name: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().toUpperCase().slice(0, 4);

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 4)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase();
  }
  return (words[0] ?? '').slice(0, 4).toUpperCase() || '·';
}

function LoungeCardBase({
  name,
  description,
  meta,
  iconUrl,
  tag,
  isLive = false,
  listeners = 0,
  badge,
  cta,
  busy = false,
  index = 0,
  variant = 'card',
  solid = false,
  onPress,
  accessibilityHint,
}: LoungeCardProps) {
  const C = useColors();
  const s = SIZES[variant];

  const count = Math.max(0, listeners);
  /*
    The pill carries a number; the dot carries none. A pill reading "0" would
    look like a bug rather than an opening, so the numberless case gets the dot.

    WHAT THE DOT MEANS CHANGED WITH `isLive`. It used to read "an active Session
    with nobody in it yet is still worth surfacing — it is an invitation", and
    on the old predicate that fired for any room row that had ever been created:
    the invitation was to an empty room with no track in it. Now `isLive` is
    already a verdict, so `isLive && count === 0` is the narrow real case it was
    always meant to be — a Session still PLAYING after the last person walked
    out. The timeline is running; whoever opens it lands mid-track. That is
    worth a dot and has no number to put in a pill.
  */
  const showPill = isLive && count > 0;
  const showDot = isLive && count === 0;

  const label = [
    name,
    badge,
    showPill ? `${count} listening` : showDot ? 'live now' : null,
    busy ? 'joining' : meta,
  ]
    .filter(Boolean)
    .join(', ');

  /* `auxRow` — an 8px lift on a 55ms step. See the header for what this replaced. */
  const entering = useEntrance({ index, kind: 'row' });

  return (
    <Animated.View style={entering}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onPress}
        /*
          The artboard's press on a whole card is `transform:scale(.985)`
          (L256, L438), not a fill change — and it has to be, because the fill
          belongs to `GlassCard`, whose skin is deliberately not overridable
          from a caller's `style`. Busy fades on top of it: a row that has
          stopped taking taps should look spent, not merely pressed.
        */
        style={({ pressed }) => [pressed && styles.held, busy && styles.spent]}>
        {/*
          Children as a FUNCTION, so the `cta` cell can light its own edge from
          the card's pressed state — the artboard's
          `style-active="border-color:var(--aux-pri)"` on L349. There is no
          second Pressable to read it from, and there must not be.
        */}
        {({ pressed }) => (
          <GlassCard
            variant={variant}
            solid={solid}
            padded={false}
            style={{ marginBottom: s.marginBottom }}>
            <View style={[styles.body, { padding: s.padding, gap: s.gap }]}>
              {/*
                A WELL, not a plate. `artwork` inverted in this direction — it is
                now darker than the ground with a faint monogram on it — so a tile
                carrying dark ink or a light edge is reading the old palette.

                The tag itself is `ink2` rather than `artInk`: the artboard spends
                `--aux-art` (22% white) on a Session's now-playing monogram, which
                is decoration behind a title that already says the track, but a
                lounge tag is the only identity an icon-less lounge has and has to
                be legible on its own.
              */}
              <View
                style={[
                  styles.tile,
                  {
                    width: s.tile,
                    height: s.tile,
                    borderRadius: s.tileRadius,
                    backgroundColor: C.artwork,
                    borderColor: C.rule,
                  },
                ]}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.tag,
                    { fontSize: s.tag, letterSpacing: tracking(s.tag, 0.06), color: C.ink2 },
                  ]}>
                  {tagFor(name, tag)}
                </Text>

                {/* Over the tag, so the letters double as the error fallback. */}
                {iconUrl ? (
                  <Image
                    source={{ uri: iconUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    // FlatList recycles rows; without this the previous lounge's icon
                    // stays on screen until the new one has decoded.
                    recyclingKey={name}
                    transition={Duration.press}
                    accessible={false}
                  />
                ) : null}
              </View>

              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.name, { fontFamily: s.nameFont, color: C.ink }]}>
                    {name}
                  </Text>

                  {/*
                    STATE beside the name — coral, at wash volume. It cannot go
                    in the trailing slot: on a lounge you have already joined
                    that slot is holding the "Open" cell, and a coral badge and
                    a blue cell stacked in one corner is two accents in one
                    place.
                  */}
                  {badge ? <StatusPill tone="liveWash" label={badge} /> : null}

                  {/* The dot beats at the artboard's 2s LIVE-in-a-list tempo —
                      ambient, not the 1s urgency of a recording light. */}
                  {showDot ? <LiveDot size={7} tempo="badge" /> : null}
                </View>

                {description ? (
                  <Text numberOfLines={2} style={[styles.description, { color: C.ink2 }]}>
                    {description}
                  </Text>
                ) : null}

                {meta ? (
                  <Text numberOfLines={1} style={[styles.meta, { color: C.ink3 }]}>
                    {meta}
                  </Text>
                ) : null}
              </View>

              {/*
                STATE, so coral — and the wash tone rather than the solid fill,
                because this pill sits inside a card whose own title it must not
                out-shout. The accessible label spells out what the numeral means;
                "3 LIVE" read aloud on its own is a measurement of nothing.
              */}
              {showPill ? (
                <StatusPill
                  tone="liveWash"
                  dot
                  live
                  label={`${count} live`}
                  accessibilityLabel={`${count} listening`}
                />
              ) : null}

              {/*
                The ACTION cell (L349) — blue, and hidden from assistive tech
                because the Pressable around it already announces the same verb
                through `accessibilityHint`. `surface2` over the card's
                `surface` composites to ~14% white, which is the one place the
                translucency hazard works FOR us: a cell inside a card should
                sit slightly proud of it. On a `solid` card it lands on the
                opaque composite instead and reads the same.
              */}
              {cta ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    styles.cta,
                    { backgroundColor: C.surface2, borderColor: pressed ? C.pill : C.rule },
                  ]}>
                  {busy ? (
                    <ActivityIndicator size="small" color={C.priTint} />
                  ) : (
                    <Text style={[styles.ctaLabel, { color: C.priTint }]}>{cta}</Text>
                  )}
                </View>
              ) : null}
            </View>
          </GlassCard>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Memoised: these render inside FlatLists that re-render on every realtime
 * lounge update, and the whole row is pure props.
 */
export const LoungeCard = memo(LoungeCardBase);

export type LoungeCardSkeletonProps = {
  /** Adds the description line Explore's rows carry and the profile's do not. */
  wide?: boolean;
  variant?: LoungeCardVariant;
  solid?: boolean;
  /** Reserves the trailing action cell, for the lists whose rows carry a `cta`. */
  cta?: boolean;
};

/**
 * The row's loading twin. Lives here so its geometry cannot drift from the real
 * row's — a skeleton that resizes on load is worse than no skeleton, and the
 * tile corner is passed through for the same reason.
 */
export function LoungeCardSkeleton({
  wide = false,
  variant = 'card',
  solid = false,
  cta = false,
}: LoungeCardSkeletonProps) {
  const s = SIZES[variant];

  return (
    <GlassCard variant={variant} solid={solid} padded={false} style={{ marginBottom: s.marginBottom }}>
      <View style={[styles.body, { padding: s.padding, gap: s.gap }]}>
        <Skeleton width={s.tile} height={s.tile} radius={s.tileRadius} />
        <View style={styles.skeletonInfo}>
          <Skeleton width="54%" height={14} />
          {wide ? <Skeleton width="86%" height={11} /> : null}
          <Skeleton width="32%" height={11} />
        </View>
        {cta ? <Skeleton width={CTA_WIDTH} height={CTA_HEIGHT} radius={Radii.pill} /> : null}
      </View>
    </GlassCard>
  );
}

export type LoungeListSkeletonProps = LoungeCardSkeletonProps & { count?: number };

export function LoungeListSkeleton({ count = 4, ...rest }: LoungeListSkeletonProps) {
  return (
    <View>
      {Array.from({ length: count }, (_, index) => (
        <LoungeCardSkeleton key={index} {...rest} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  held: {
    transform: [{ scale: 0.985 }],
  },
  spent: {
    opacity: 0.6,
  },

  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
    borderWidth: Rule.hair,
    overflow: 'hidden',
  },
  tag: {
    fontFamily: Fonts.extrabold,
  },

  info: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tracking(15, -0.01),
  },
  description: {
    ...Type.body(12.5),
    lineHeight: 18,
    marginTop: 3,
  },
  /*
    The artboard sets this line at 10px. Held at 11 instead, for the same reason
    `ink3` was lightened in the token layer: it is the row's only statement of
    how many people are in there, and at 10px regular it stops being read at
    arm's length. The tracking is the artboard's.
  */
  meta: {
    ...Type.body(11),
    lineHeight: 16,
    letterSpacing: tracking(11, 0.07),
    marginTop: 3,
  },

  cta: {
    flexShrink: 0,
    minHeight: CTA_HEIGHT,
    minWidth: CTA_WIDTH,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: tracking(11, 0.04),
  },

  skeletonInfo: {
    flex: 1,
    gap: Space.sm,
  },
});
