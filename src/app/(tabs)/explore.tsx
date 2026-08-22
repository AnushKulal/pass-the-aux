/**
 * Explore — the two ways into a lounge you are not in yet: a code somebody sent
 * you, or a search.
 *
 * README §7. The code field is one ruled control split into two cells: a 44px
 * input carrying the code at 800/13 with .14em of tracking, and a 60px accent
 * JOIN cell. That is the only filled accent on the screen, because redeeming a
 * code is the only thing here that puts you in a room.
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

import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { Screen, useToast } from '@/components/ui';
import {
  loungeErrorMessage,
  useJoinByCode,
  useJoinLounge,
  usePublicLounges,
  type PublicLoungeSummary,
} from '@/features/lounges/queries';
import { Duration, Fonts, Rule, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Long enough that a fast typist sends one request per word rather than per
 * keystroke — the same figure track search uses, so the app feels consistent.
 */
const SEARCH_DEBOUNCE_MS = 400;
const CODE_LENGTH = 8;

const GUTTER = 12;
const JOIN_CELL = 60;
const LIST_TAIL = 32;

/** README §7, verbatim. Any other wording for this case is a bug. */
const NO_MATCH = 'No lounge with that code';

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

/** A ruled prose block: kicker, sentence, optional accent-outlined action. */
function Notice({
  kicker,
  body,
  action,
}: {
  kicker: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const C = useColors();

  return (
    <View style={[styles.notice, { borderBottomColor: C.rule }]}>
      <Text style={[styles.noticeKicker, { color: C.ink3 }]}>{kicker}</Text>
      <Text style={[styles.noticeBody, { color: C.ink2 }]}>{body}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.action,
            { borderColor: C.live, backgroundColor: pressed ? C.liveWash : 'transparent' },
          ]}>
          <Text style={[styles.actionLabel, { color: C.liveText }]}>{action.label}</Text>
        </Pressable>
      ) : null}
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
    ({ item, index }: ListRenderItemInfo<PublicLoungeSummary>) => (
      <LoungeCard
        name={item.lounge.name}
        description={item.lounge.description || undefined}
        iconUrl={item.lounge.icon_url}
        isPublic={item.lounge.is_public}
        showJoined={item.isMember}
        index={index}
        onPress={() => openLounge(item.lounge.id)}
        onJoin={() => join(item)}
        joining={joinLounge.isPending && joinLounge.variables === item.lounge.id}
      />
    ),
    [join, joinLounge.isPending, joinLounge.variables, openLounge]
  );

  const resultCount = data?.length ?? 0;
  const query = debounced.trim();

  const empty = useMemo(
    () =>
      query.length > 0 ? (
        <Notice kicker="NOTHING MATCHED" body={`No public lounge mentions "${query}".`} />
      ) : (
        <Notice
          kicker="NO PUBLIC LOUNGES YET"
          body="Be the first — create one and make it public."
          action={{ label: 'CREATE A LOUNGE', onPress: () => router.push('/lounge/create') }}
        />
      ),
    [query]
  );

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        {/*
          The code field and the search field sit OUTSIDE the FlatList on
          purpose. As a ListHeaderComponent they would remount whenever the list
          re-renders, which drops the keyboard mid-word.
        */}
        <View style={[styles.head, { borderBottomColor: C.rule }]}>
          <Text style={[styles.headTitle, { color: C.ink }]}>Explore</Text>

          <JoinByCode onJoined={handleJoined} />

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search public lounges"
            placeholderTextColor={C.ink3}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            accessibilityLabel="Search public lounges"
            selectionColor={C.live}
            style={[
              styles.search,
              { backgroundColor: C.bgRecessed, borderColor: C.rule, color: C.ink },
            ]}
          />
        </View>

        {isError ? (
          <Notice
            kicker="COULD NOT REACH EXPLORE"
            body={loungeErrorMessage(error, 'Check your connection and try again.')}
            action={{ label: 'TRY AGAIN', onPress: () => void refetch() }}
          />
        ) : isPending ? (
          <LoungeListSkeleton count={3} />
        ) : (
          <>
            <View style={[styles.rule, { borderBottomColor: C.rule }]}>
              <Text style={[styles.ruleKicker, { color: C.ink3 }]}>PUBLIC LOUNGES</Text>
              <Text style={[styles.ruleCount, { color: C.ink3 }]}>
                {`${resultCount} ${resultCount === 1 ? 'RESULT' : 'RESULTS'}`}
              </Text>
            </View>

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
        The query layer's message for a miss is a longer sentence; §7 pins this
        one string, so an unmatched code always reports exactly that and only a
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
      <View style={[styles.codeRow, { borderColor: C.rule2 }]}>
        <TextInput
          value={code}
          onChangeText={handleChange}
          placeholder="8-CHARACTER INVITE CODE"
          placeholderTextColor={C.ink3}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          accessibilityLabel="Invite code"
          selectionColor={C.live}
          onSubmitEditing={handleSubmit}
          returnKeyType="go"
          style={[styles.codeInput, { backgroundColor: C.surface, color: C.ink }]}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join with this code"
          disabled={join.isPending}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.joinCell,
            { backgroundColor: pressed ? C.liveText : C.live },
            join.isPending && styles.joinBusy,
          ]}>
          <Text style={[styles.joinLabel, { color: C.onLive }]}>
            {join.isPending ? '···' : 'JOIN'}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.codeError, { color: C.danger }]}>
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

  head: {
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: Rule.major,
  },
  headTitle: {
    ...Type.display(22),
    marginBottom: 10,
  },

  codeBlock: {
    gap: 6,
  },
  codeRow: {
    flexDirection: 'row',
    borderWidth: Rule.hair,
  },
  /*
    Explicit font parts rather than a spread of Type.heading: a lineHeight on a
    RN TextInput mis-centres the caret on Android, and this control's height is
    fixed by the 44px floor anyway.
  */
  codeInput: {
    flex: 1,
    minWidth: 0,
    height: TOUCH_TARGET,
    paddingHorizontal: 10,
    fontFamily: Fonts.extrabold,
    fontSize: 13,
    letterSpacing: 13 * 0.14,
  },
  joinCell: {
    width: JOIN_CELL,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBusy: {
    opacity: 0.6,
  },
  joinLabel: {
    ...Type.heading(11),
    letterSpacing: 11 * 0.08,
  },
  codeError: {
    ...Type.body(13),
    lineHeight: 18,
  },
  /*
    The prototype draws this at 40px/14px. Raised to the 44px target and 16px
    body floors — both are non-negotiable and the block has the room.
  */
  search: {
    height: TOUCH_TARGET,
    marginTop: Space.sm,
    paddingHorizontal: 10,
    borderWidth: Rule.hair,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },

  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    paddingVertical: 10,
    borderBottomWidth: Rule.hair,
  },
  ruleKicker: {
    ...Type.label(10),
  },
  ruleCount: {
    ...Type.label(10),
  },

  listContent: {
    flexGrow: 1,
    paddingBottom: LIST_TAIL,
  },

  notice: {
    paddingVertical: 26,
    paddingHorizontal: 14,
    borderBottomWidth: Rule.hair,
  },
  noticeKicker: {
    ...Type.label(10),
    marginBottom: 8,
  },
  noticeBody: {
    ...Type.body(14),
    lineHeight: 21,
  },
  action: {
    marginTop: 14,
    alignSelf: 'flex-start',
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(11),
    letterSpacing: 11 * 0.1,
  },
});
