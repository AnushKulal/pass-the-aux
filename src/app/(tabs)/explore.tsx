/**
 * Explore — the two ways into a lounge you are not in yet: a code somebody sent
 * you, or the public list.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` `isExplore` L321–356. The
 * screen is four objects stacked in the gutter: a 26px masthead (L322-324), the
 * invite-code card (L327-333), a glass search pill (L335) and then radius-24
 * lounge cards (L338-354), each carrying a tag tile, the name, the description
 * and one pill CTA on the right.
 *
 * THE ROW IS `LoungeCard`, AND THAT IS A CORRECTION. This file used to carry a
 * local `ExploreCard` above a comment claiming `LoungeCard` "draws the previous
 * direction's row — radius 22, no border, no CTA slot and no footer". That was
 * false: the component was rebuilt for nocturne (its own header cites L268 and
 * L399, it uses `GlassCard`, and it gets the accent split right). The fork that
 * comment licensed left the app shipping three lounge rows whose tag tiles
 * disagreed about their corner. The two things Explore genuinely needed and the
 * shared row lacked — a coral `badge` beside the name and a blue `cta` cell on
 * the right — are props on `LoungeCard` now.
 *
 * THE ACCENT SPLIT IS STILL THE POINT OF THIS SCREEN. Every join is an ACTION,
 * so every CTA here is blue — the gradient pill beside the code well, and the
 * `priTint` label in each row's cell. The only coral on the screen is the
 * JOINED badge, which reports a STATE. That pairing (blue button, coral badge,
 * never one element in both) is the direction's rule stated in miniature.
 *
 * The row is still the join target. `LoungeCard` renders the design's per-row
 * cell (L349) as a non-interactive affordance inside the card's own Pressable,
 * so a 44px cell that does exactly what the 90px card does is one accessible
 * node rather than two identical ones.
 *
 * DELIBERATE OMISSION: the design's per-card footer (L351-353, `memberTxt` +
 * `liveTxt`) is not drawn. `PublicLoungeSummary` is `{ lounge, isMember }` and
 * nothing else — RLS hides the roster and the sessions of a lounge you are not
 * in, so both of those lines would be fabricated. The state the screen can
 * actually prove goes in the JOINED badge and the CTA's own label.
 *
 * An unmatched code says "No lounge with that code" and nothing else — no
 * colour change on the field, no shake. The sentence is the error.
 */

import { router } from 'expo-router';
import { Compass, Search, SearchX, WifiOff, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { AuxButton, EmptyState, GlassCard, Screen, useToast } from '@/components/ui';
import {
  loungeErrorMessage,
  useJoinByCode,
  useJoinLounge,
  usePublicLounges,
  type PublicLoungeSummary,
} from '@/features/lounges/queries';
import { useDockReserve } from '@/lib/dock';
import { Duration, Fonts, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Long enough that a fast typist sends one request per word rather than per
 * keystroke — the same figure track search uses, so the app feels consistent.
 */
const SEARCH_DEBOUNCE_MS = 400;
const CODE_LENGTH = 8;

/**
 * The screen gutter. 18 in every nocturne artboard, and `Space` has no step for
 * it — `lg` is 16 and `xl` is 20. `Screen` holds the same constant privately for
 * its own padded mode; both disappear the day the token layer grows a
 * `Space.gutter`. Was 24 here, which visibly narrowed the cards against the
 * design.
 */
const GUTTER = 18;

/**
 * The 12px the design puts between stacked objects (L338). It spaces the code
 * card from the search pill; the card COLUMN's own 12 now comes from
 * `LoungeCard`'s bottom margin, so the list container adds no `gap` of its own
 * — the two would sum to 24 and pull the column apart.
 */
const ROW_GAP = 12;

/**
 * The code well, and it is 46 rather than the artboard's 48 (L329).
 *
 * The Join beside it is `AuxButton size="sm"`, whose height comes from the
 * design's own 46/50/54 ladder; a 48px field beside a 46px button is a visible
 * 1px step on each edge of a pair the eye reads as one control. 46 for both is
 * closer to the drawing than 48-and-a-notch.
 */
const CODE_FIELD = 46;

/** Design L335: `min-height:50px` on the search pill. */
const SEARCH_FIELD = 50;

/** Any other wording for an unmatched code is a bug. */
const NO_MATCH = 'No lounge with that code';

function useModuleEnter() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

  /*
    An effect, never `entering={FadeIn}`. Reanimated marks an entering view
    `visibility: hidden` until its animation runs, and on react-native-web that
    animation never fires — leaving a screen that reports the correct colour,
    size and layout while being completely invisible.
  */
  useEffect(() => {
    if (reduced) {
      t.value = 1;
      return;
    }
    t.value = withTiming(1, { duration: Duration.enter, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }, [reduced, t]);

  return useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 8 }],
  }));
}

/**
 * The list with nothing in it: a card standing where the first row would,
 * saying what happened and offering the one move that fixes it. Drawn by
 * `@/components/ui/empty-state`, shared with the Feed and Lounges.
 */
function QuietCard({
  icon,
  title,
  line,
  action,
}: {
  icon: LucideIcon;
  title: string;
  line?: string;
  action: { label: string; onPress: () => void };
}) {
  return <EmptyState icon={icon} title={title} description={line} primary={action} />;
}

export default function ExploreScreen() {
  const C = useColors();
  const toast = useToast();
  const moduleStyle = useModuleEnter();
  const dockReserve = useDockReserve();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isPending, isError, error, refetch } = usePublicLounges(debounced);
  const joinLounge = useJoinLounge();

  const openLounge = useCallback((loungeId: string) => {
    router.push({ pathname: '/lounge/[id]', params: { id: loungeId } });
  }, []);

  const handleJoined = useCallback(
    (loungeId: string) => {
      toast.show('Joined the lounge', 'success');
      openLounge(loungeId);
    },
    [openLounge, toast]
  );

  /**
   * Joining writes a real membership row and then walks in, which is what makes
   * the lounge appear in the Feed's filter and in the Lounges tab — every one of
   * those reads the same query, so none of them needs telling.
   */
  const join = useCallback(
    (item: PublicLoungeSummary) => {
      if (item.isMember) {
        openLounge(item.lounge.id);
        return;
      }
      joinLounge.mutate(item.lounge.id, {
        onSuccess: () => handleJoined(item.lounge.id),
        onError: (err) => toast.show(loungeErrorMessage(err, 'Could not join. Try again.'), 'error'),
      });
    },
    [handleJoined, joinLounge, openLounge, toast]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<PublicLoungeSummary>) => (
      <LoungeCard
        name={item.lounge.name}
        description={item.lounge.description.trim()}
        iconUrl={item.lounge.icon_url}
        /* Coral says what is true (you are in); blue says what you can do. */
        badge={item.isMember ? 'Joined' : undefined}
        cta={item.isMember ? 'Open' : 'Join'}
        busy={joinLounge.isPending && joinLounge.variables === item.lounge.id}
        index={index}
        onPress={() => join(item)}
        accessibilityHint={item.isMember ? 'Opens this lounge' : 'Joins this lounge'}
      />
    ),
    [join, joinLounge.isPending, joinLounge.variables]
  );

  const query = debounced.trim();

  const clearSearch = useCallback(() => {
    setSearch('');
    setDebounced('');
  }, []);

  const empty = useMemo(
    () =>
      query.length > 0 ? (
        <QuietCard
          icon={SearchX}
          title={`Nothing matched "${query}"`}
          action={{ label: 'Clear search', onPress: clearSearch }}
        />
      ) : (
        <QuietCard
          icon={Compass}
          title="No public lounges yet"
          action={{ label: 'Create a lounge', onPress: () => router.push('/lounge/create') }}
        />
      ),
    [clearSearch, query]
  );

  return (
    /*
      `ground={false}`, and it is not cosmetic. The ambient blobs are mounted
      ONCE behind the tab navigator; every card on this screen is 5.5% white and
      has nothing to show through it unless that ground is visible. Painting an
      opaque `bg` here would cover the blobs and flatten the whole direction.
    */
    <Screen padded={false} ground={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
            Explore
          </Text>
        </View>

        {/*
          The code and search fields sit OUTSIDE the FlatList on purpose. As a
          ListHeaderComponent they would remount whenever the list re-renders,
          which drops the keyboard mid-word.
        */}
        <View style={styles.controls}>
          <JoinByCode onJoined={handleJoined} />

          {/*
            The search pill is `surface`, not `bgRecessed` — the one input on
            the screen that is NOT a well. That is the design's own split
            (L335 uses `--g`, L329 uses `--bg2`): the code entry is something
            you fill in, the search pill is a piece of chrome you type into.
            No shadow: the artboard gives `--sh` to its radius-24 cards and to
            nothing else.
          */}
          <View style={[styles.searchPill, { backgroundColor: C.surface, borderColor: C.rule }]}>
            <Search size={18} strokeWidth={2} color={C.ink3} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search public lounges"
              placeholderTextColor={C.ink3}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              accessibilityLabel="Search public lounges"
              // Blue, per the kit: a caret marks something you are DOING, so the
              // action accent is the one allowed to claim it. Coral here would
              // announce a live state and spend the accent that means it.
              selectionColor={C.pill}
              style={[styles.searchInput, { color: C.ink }]}
            />
          </View>
        </View>

        {isError ? (
          <View style={styles.list}>
            <QuietCard
              icon={WifiOff}
              title="Could not reach Explore"
              line={loungeErrorMessage(error, 'Check your connection.')}
              action={{ label: 'Try again', onPress: () => void refetch() }}
            />
          </View>
        ) : isPending ? (
          <View style={styles.list}>
            {/*
              `wide` and `cta` because the real row carries a description and an
              action cell — the skeleton lives beside the row it stands in for
              so its geometry cannot drift, and one that resizes on load is
              worse than none.
            */}
            <LoungeListSkeleton count={3} wide cta />
          </View>
        ) : (
          <FlatList
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            style={styles.flex}
            /*
              The dock reservation is applied INLINE because it depends on the
              device's bottom inset, which a StyleSheet object cannot carry.
              This was `Dock.reserve`, a static number that left the last card
              under the floating nav capsule on every device with a home
              indicator; `useDockReserve()` does the addition itself.
            */
            contentContainerStyle={[styles.listContent, { paddingBottom: dockReserve }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={empty}
          />
        )}
      </Animated.View>
    </Screen>
  );
}

/* ------------------------------------------------------- the invite code */

/** Redeeming an invite code is the only way into a private lounge. */
function JoinByCode({ onJoined }: { onJoined: (loungeId: string) => void }) {
  const C = useColors();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useJoinByCode();

  const handleChange = useCallback((value: string) => {
    setCode(
      value
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, CODE_LENGTH)
    );
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (code.length < CODE_LENGTH) {
      setError(NO_MATCH);
      return;
    }
    setError(null);
    join.mutate(code, {
      onSuccess: (loungeId) => {
        setCode('');
        onJoined(loungeId);
      },
      /*
        The query layer's message for a miss is a longer sentence; this string is
        pinned, so an unmatched code always reports exactly that and only a
        genuinely different failure (offline, RLS) gets its own wording.
      */
      onError: (err) => {
        const message = loungeErrorMessage(err, NO_MATCH);
        setError(message.includes('does not match any lounge') ? NO_MATCH : message);
      },
    });
  }, [code, join, onJoined]);

  return (
    <GlassCard>
      <Text style={[styles.kicker, { color: C.ink3 }]}>Got an invite code?</Text>

      <View style={styles.codeRow}>
        {/*
          A WELL — `bgRecessed`, which is darker than the ground — behind a
          hairline. Not `surface`: two translucent layers inside this card would
          composite to ~11% and the field would read as another card rather than
          as something cut into one.

          Hand-rolled rather than `TextField` because the design sets a code in
          the loudest voice it has (L329: `800 14px` at `.12em`), and the kit's
          field is 15px regular with no way to ask for the readout register.
        */}
        <TextInput
          value={code}
          onChangeText={handleChange}
          placeholder="XXXX-XXXX"
          placeholderTextColor={C.ink3}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          accessibilityLabel="Invite code"
          selectionColor={C.pill}
          onSubmitEditing={handleSubmit}
          returnKeyType="go"
          style={[
            styles.codeField,
            { backgroundColor: C.bgRecessed, borderColor: C.rule, color: C.ink },
          ]}
        />

        {/*
          The gradient pill, and it is the only one on the screen. `pri` carries
          the blue glow and the loading spinner the hand-rolled cell this
          replaced faked with a '···' string.
        */}
        <AuxButton
          label="Join"
          variant="pri"
          size="sm"
          onPress={handleSubmit}
          loading={join.isPending}
        />
      </View>

      {error ? (
        /*
          `danger`, not `liveText`. AN ERROR IS NOT A LIVE STATE: coral means
          "this is happening right now", and a rejected code is a failure.
          `TextField` already spends `danger` on exactly this, so the two inline
          validation messages in the app speak with one voice.
        */
        <Text accessibilityLiveRegion="polite" style={[styles.codeError, { color: C.danger }]}>
          {error}
        </Text>
      ) : null}
    </GlassCard>
  );
}

function keyExtractor(item: PublicLoungeSummary): string {
  return item.lounge.id;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },

  /* ------------------------------------------------------------- masthead */

  /** Design L322: `padding:14px 18px 12px`. */
  head: {
    paddingTop: 14,
    paddingBottom: Space.md,
    paddingHorizontal: GUTTER,
  },
  title: {
    ...Type.display(26),
    // The artboard's `-.025em`, which sits between `display`'s own steps.
    letterSpacing: tracking(26, -0.025),
  },

  /* --------------------------------------------------------- the controls */

  controls: {
    paddingHorizontal: GUTTER,
    gap: ROW_GAP,
  },
  /** L328: `font:800 9px;letter-spacing:.13em` — a kicker, not a caption. */
  kicker: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.13),
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: 9,
  },
  codeField: {
    flex: 1,
    minWidth: 0,
    height: CODE_FIELD,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.lg + 2,
    /*
      No lineHeight, and no vertical padding: a fixed line height inside a
      fixed-height TextInput mis-centres the caret on Android.
    */
    paddingVertical: 0,
    fontFamily: Fonts.extrabold,
    fontSize: 14,
    letterSpacing: tracking(14, 0.12),
  },
  codeError: {
    ...Type.body(13),
    marginTop: Space.sm,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: SEARCH_FIELD,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...Type.body(15),
    lineHeight: undefined,
    paddingVertical: 0,
  },

  /* ------------------------------------------------------------ the list */

  list: {
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg + 2,
  },
  /** `paddingBottom` is applied at the call site — see the note at the FlatList. */
  listContent: {
    flexGrow: 1,
    paddingHorizontal: GUTTER,
    paddingTop: Space.lg + 2,
  },
});
