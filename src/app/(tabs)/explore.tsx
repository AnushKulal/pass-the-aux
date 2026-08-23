/**
 * Explore — the two ways into a lounge you are not in yet: a code somebody sent
 * you, or the public list.
 *
 * design/v2 "Explore": a recessed code well with the one filled JOIN cell
 * beside it, then PUBLIC LOUNGES as raised rows — a tag tile, the name, the
 * description, and one line of state.
 *
 * The row IS the join. Tapping a lounge you are not in writes the membership
 * and walks straight in; tapping one you are already in just opens it. That is
 * the design's single target per row, and it is the same mutation the old
 * per-row button ran.
 *
 * An unmatched code says "No lounge with that code" and nothing else — no
 * colour change on the field, no shake. The sentence is the error.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
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

import { AuxButton, Screen, Skeleton, useToast } from '@/components/ui';
import {
  loungeErrorMessage,
  useJoinByCode,
  useJoinLounge,
  usePublicLounges,
  type PublicLoungeSummary,
} from '@/features/lounges/queries';
import {
  Duration,
  Fonts,
  Radii,
  Space,
  Type,
  dropped,
  pressed as pressedShadow,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Long enough that a fast typist sends one request per word rather than per
 * keystroke — the same figure track search uses, so the app feels consistent.
 */
const SEARCH_DEBOUNCE_MS = 400;
const CODE_LENGTH = 8;

const GUTTER = 24;
const FIELD_GUTTER = 20;
const ROW_GUTTER = 14;
const LIST_TAIL = 48;

/** design/v2: the code well and the JOIN cell are both 52 tall. */
const FIELD = 52;
const JOIN_CELL = 84;
const TILE = 54;

const SKELETON_ROWS = [0, 1, 2];

/** Any other wording for an unmatched code is a bug. */
const NO_MATCH = 'No lounge with that code';

/** The tag on a lounge's tile: initials for a phrase, the first letters if not. */
function tagFor(name: string): string {
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

function useModuleEnter() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);

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

/** A raised card carrying one line and one action. Every non-happy path. */
function QuietCard({
  line,
  action,
}: {
  line: string;
  action?: { label: string; onPress: () => void };
}) {
  const C = useColors();

  return (
    <View style={[styles.quiet, { backgroundColor: C.surface }, raised(C)]}>
      <Text style={[styles.quietLine, { color: C.ink2 }]}>{line}</Text>
      {action ? (
        <AuxButton
          label={action.label}
          onPress={action.onPress}
          variant="cream"
          size="sm"
          align="center"
        />
      ) : null}
    </View>
  );
}

/** One public lounge. The whole row is the target — see the file header. */
function LoungeRow({
  item,
  busy,
  onPress,
}: {
  item: PublicLoungeSummary;
  busy: boolean;
  onPress: () => void;
}) {
  const C = useColors();
  const state = busy ? 'Joining' : item.isMember ? 'Joined' : 'Tap to join';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.lounge.name}
      accessibilityHint={item.isMember ? 'Opens this lounge' : 'Joins this lounge'}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: C.surface },
        raised(C),
        pressed && styles.pressedRow,
      ]}>
      <View style={[styles.tile, { backgroundColor: C.artwork }]}>
        <Text numberOfLines={1} style={[styles.tag, { color: C.artInk }]}>
          {tagFor(item.lounge.name)}
        </Text>
      </View>

      <View style={styles.rowInfo}>
        <Text numberOfLines={1} style={[styles.rowName, { color: C.ink }]}>
          {item.lounge.name}
        </Text>
        {item.lounge.description ? (
          <Text numberOfLines={2} style={[styles.rowDesc, { color: C.ink2 }]}>
            {item.lounge.description}
          </Text>
        ) : null}
        <Text style={[styles.rowMeta, { color: C.ink3 }]}>{state}</Text>
      </View>
    </Pressable>
  );
}

function ExploreSkeleton() {
  const C = useColors();

  return (
    <View style={styles.list}>
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>
          <Skeleton width={TILE} height={TILE} />
          <View style={styles.skeletonInfo}>
            <Skeleton width="52%" height={13} />
            <Skeleton width="86%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function ExploreScreen() {
  const C = useColors();
  const toast = useToast();
  const moduleStyle = useModuleEnter();

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
   * the lounge appear in the Feed's filter and in the Lounges tab — every one
   * of those reads the same query, so none of them needs telling.
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
    ({ item }: ListRenderItemInfo<PublicLoungeSummary>) => (
      <LoungeRow
        item={item}
        busy={joinLounge.isPending && joinLounge.variables === item.lounge.id}
        onPress={() => join(item)}
      />
    ),
    [join, joinLounge.isPending, joinLounge.variables]
  );

  const query = debounced.trim();

  const empty = useMemo(
    () =>
      query.length > 0 ? (
        <QuietCard line={`Nothing matched "${query}".`} />
      ) : (
        <QuietCard
          line="No public lounges yet."
          action={{ label: 'Create one', onPress: () => router.push('/lounge/create') }}
        />
      ),
    [query]
  );

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        {/*
          The code and search fields sit OUTSIDE the FlatList on purpose. As a
          ListHeaderComponent they would remount whenever the list re-renders,
          which drops the keyboard mid-word.
        */}
        <View style={styles.head}>
          <View style={styles.masthead}>
            <Text style={[styles.title, { color: C.ink }]}>Explore</Text>
            <Text style={[styles.summary, { color: C.ink2 }]}>
              Public lounges, or drop in a code.
            </Text>
          </View>

          <JoinByCode onJoined={handleJoined} />

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={C.ink3}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            accessibilityLabel="Search public lounges"
            selectionColor={C.live}
            style={[styles.well, styles.search, { backgroundColor: C.bgRecessed, color: C.ink }, pressedShadow(C)]}
          />
        </View>

        {isError ? (
          <View style={styles.list}>
            <QuietCard
              line={loungeErrorMessage(error, 'Could not reach Explore.')}
              action={{ label: 'Try again', onPress: () => void refetch() }}
            />
          </View>
        ) : isPending ? (
          <ExploreSkeleton />
        ) : (
          <>
            <Text style={[styles.sectionKicker, { color: C.ink3 }]}>Public lounges</Text>

            <FlatList
              data={data}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              style={styles.flex}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={empty}
            />
          </>
        )}
      </Animated.View>
    </Screen>
  );
}

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
    <View style={styles.codeBlock}>
      <View style={styles.codeRow}>
        <TextInput
          value={code}
          onChangeText={handleChange}
          placeholder="INVITE CODE"
          placeholderTextColor={C.ink3}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          accessibilityLabel="Invite code"
          selectionColor={C.live}
          onSubmitEditing={handleSubmit}
          returnKeyType="go"
          style={[styles.well, styles.code, { backgroundColor: C.bgRecessed, color: C.ink }, pressedShadow(C)]}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join with this code"
          accessibilityState={{ busy: join.isPending }}
          disabled={join.isPending}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.joinCell,
            { backgroundColor: C.pill },
            dropped(C, 'md'),
            (pressed || join.isPending) && styles.pressedRow,
          ]}>
          <Text style={[styles.joinLabel, { color: C.pillInk }]}>
            {join.isPending ? '···' : 'Join'}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.codeError, { color: C.liveText }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function keyExtractor(item: PublicLoungeSummary): string {
  return item.lounge.id;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  pressedRow: {
    opacity: 0.7,
  },

  head: {
    paddingTop: 14,
    paddingHorizontal: FIELD_GUTTER,
  },
  masthead: {
    paddingHorizontal: GUTTER - FIELD_GUTTER,
  },
  title: {
    ...Type.display(30),
    letterSpacing: tracking(30, -0.03),
  },
  summary: {
    ...Type.body(13.5),
    marginTop: 5,
  },

  /* ------------------------------------------------------- the two wells */

  /** The recessed control: 52 tall, house corner, sunk into the ground. */
  well: {
    height: FIELD,
    borderRadius: Radii.md,
    paddingHorizontal: Space.lg,
    /*
      A fixed line height inside a fixed-height TextInput mis-centres the caret
      on Android, so these set the family and size only.
    */
    paddingVertical: 0,
  },
  codeBlock: {
    marginTop: 22,
    gap: Space.sm,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 11,
  },
  code: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.semibold,
    fontSize: 15,
    letterSpacing: tracking(15, 0.08),
  },
  search: {
    marginTop: 11,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  joinCell: {
    width: JOIN_CELL,
    height: FIELD,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
  codeError: {
    ...Type.body(13),
  },

  /* ---------------------------------------------------------- the rows */

  sectionKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    paddingHorizontal: GUTTER,
    paddingTop: 28,
    paddingBottom: 10,
  },
  list: {
    paddingHorizontal: ROW_GUTTER,
    paddingTop: 28,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: ROW_GUTTER,
    paddingBottom: LIST_TAIL,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GUTTER,
    padding: 13,
    borderRadius: Radii.xl,
    marginBottom: 10,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  tag: {
    fontFamily: Fonts.extrabold,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: tracking(14, -0.02),
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 19,
  },
  rowDesc: {
    ...Type.body(12.5),
    lineHeight: 17,
    marginTop: 3,
  },
  rowMeta: {
    ...Type.label(11),
    marginTop: 5,
  },
  skeletonInfo: {
    flex: 1,
    gap: Space.sm,
  },

  quiet: {
    marginTop: Space.sm,
    padding: Space.xl,
    borderRadius: Radii.xl,
    alignItems: 'flex-start',
    gap: Space.lg,
  },
  quietLine: {
    ...Type.body(14),
  },
});
