/**
 * Lounges — the communities I belong to.
 *
 * The handoff reaches these through the lounge rail rather than a tab, so this
 * screen borrows the rail's vocabulary instead of inventing one: the same ruled
 * rows Explore uses, the same tag wells, and the same reservation of red for
 * the live count. Neither action in the header is filled — you either have a
 * code or you do not, and a filled button here would compete with the one
 * colour that means a Session is running.
 */

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
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

import { JoinCodeModal } from '@/components/lounge/join-code-modal';
import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { Screen, useToast } from '@/components/ui';
import { loungeErrorMessage, useMyLounges, type LoungeSummary } from '@/features/lounges/queries';
import { Duration, Rule, Space, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 12;
const LIST_TAIL = 32;

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

/** A bordered, unfilled control. The non-accent action shape in this direction. */
function RuleButton({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ruleButton,
        { borderColor: C.rule2, backgroundColor: pressed ? C.surface : 'transparent' },
      ]}>
      <Text style={[styles.ruleButtonLabel, { color: C.ink }]}>{label}</Text>
    </Pressable>
  );
}

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

export default function LoungesScreen() {
  const C = useColors();
  const toast = useToast();
  const moduleStyle = useModuleEnter();

  const [joinOpen, setJoinOpen] = useState(false);
  const { data, isPending, isError, error, refetch, isRefetching } = useMyLounges();

  const openCreate = useCallback(() => router.push('/lounge/create'), []);
  const openJoin = useCallback(() => setJoinOpen(true), []);
  const closeJoin = useCallback(() => setJoinOpen(false), []);

  const handleJoined = useCallback(
    (loungeId: string) => {
      setJoinOpen(false);
      toast.show('Joined the lounge', 'success');
      router.push({ pathname: '/lounge/[id]', params: { id: loungeId } });
    },
    [toast]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<LoungeSummary>) => (
      <LoungeCard
        name={item.lounge.name}
        description={item.lounge.description || undefined}
        iconUrl={item.lounge.icon_url}
        memberCount={item.memberCount}
        listeners={item.listeners}
        activeSessions={item.activeSessions}
        isPublic={item.lounge.is_public}
        showJoined
        index={index}
        onPress={() =>
          router.push({ pathname: '/lounge/[id]', params: { id: item.lounge.id } })
        }
      />
    ),
    []
  );

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.flex, moduleStyle]}>
        <View style={[styles.head, { borderBottomColor: C.rule }]}>
          <Text style={[styles.headTitle, { color: C.ink }]}>Lounges</Text>

          <View style={styles.actions}>
            <RuleButton label="CREATE" onPress={openCreate} />
            <RuleButton label="JOIN WITH CODE" onPress={openJoin} />
          </View>
        </View>

        {isError ? (
          <Notice
            kicker="COULD NOT LOAD YOUR LOUNGES"
            body={loungeErrorMessage(error, 'Check your connection and try again.')}
            action={{ label: 'TRY AGAIN', onPress: () => void refetch() }}
          />
        ) : isPending ? (
          <LoungeListSkeleton />
        ) : (
          <FlatList
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={C.ink2}
                colors={[C.live]}
                progressBackgroundColor={C.surface}
              />
            }
            ListEmptyComponent={
              <Notice
                kicker="NO LOUNGES YET"
                body="Create one or join with a code."
                action={{ label: 'CREATE A LOUNGE', onPress: openCreate }}
              />
            }
          />
        )}
      </Animated.View>

      <JoinCodeModal visible={joinOpen} onClose={closeJoin} onJoined={handleJoined} />
    </Screen>
  );
}

function keyExtractor(item: LoungeSummary): string {
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 8px is the floor between adjacent targets; these two sit at 10.
    gap: 10,
  },
  ruleButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: Rule.hair,
  },
  ruleButtonLabel: {
    ...Type.heading(10),
    letterSpacing: 10 * 0.09,
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
