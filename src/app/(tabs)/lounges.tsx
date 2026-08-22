import { router } from 'expo-router';
import { KeyRound, Plus, Users, WifiOff } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, type ListRenderItem } from 'react-native';

import { JoinCodeModal } from '@/components/lounge/join-code-modal';
import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { AuxButton, EmptyState, Screen, useToast } from '@/components/ui';
import { loungeErrorMessage, useMyLounges, type LoungeSummary } from '@/features/lounges/queries';
import { Colors, Space } from '@/lib/theme';

export default function LoungesScreen() {
  const toast = useToast();
  const [joinOpen, setJoinOpen] = useState(false);
  const { data, isPending, isError, error, refetch, isRefetching } = useMyLounges();

  const openCreate = useCallback(() => router.push('/lounge/create'), []);
  const openJoin = useCallback(() => setJoinOpen(true), []);
  const closeJoin = useCallback(() => setJoinOpen(false), []);

  const handleJoined = useCallback(
    (loungeId: string) => {
      setJoinOpen(false);
      toast.show('Joined the lounge', 'success');
      router.push(`/lounge/${loungeId}`);
    },
    [toast],
  );

  const renderItem = useCallback<ListRenderItem<LoungeSummary>>(
    ({ item }) => (
      <LoungeCard
        name={item.lounge.name}
        description={item.lounge.description || undefined}
        iconUrl={item.lounge.icon_url}
        memberCount={item.memberCount}
        listeners={item.listeners}
        activeSessions={item.activeSessions}
        isPublic={item.lounge.is_public}
        onPress={() => router.push(`/lounge/${item.lounge.id}`)}
      />
    ),
    [],
  );

  return (
    <Screen title="Lounges">
      <View style={styles.actions}>
        <AuxButton label="Create" icon={Plus} size="sm" onPress={openCreate} />
        <AuxButton
          label="Join with code"
          icon={KeyRound}
          variant="ghost"
          size="sm"
          onPress={openJoin}
        />
      </View>

      {isPending ? (
        <LoungeListSkeleton />
      ) : isError ? (
        <EmptyState
          icon={WifiOff}
          title="Could not load your lounges"
          description={loungeErrorMessage(error, 'Check your connection and try again.')}
          action={<AuxButton label="Try again" variant="ghost" onPress={() => void refetch()} />}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={Colors.muted}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon={Users}
              title="No lounges yet"
              description="Create one or join with a code."
              action={<AuxButton label="Create a lounge" icon={Plus} onPress={openCreate} />}
            />
          }
        />
      )}

      <JoinCodeModal visible={joinOpen} onClose={closeJoin} onJoined={handleJoined} />
    </Screen>
  );
}

function keyExtractor(item: LoungeSummary): string {
  return item.lounge.id;
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
    paddingBottom: Space.lg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    // Clears the tab bar, which floats above this screen's content.
    paddingBottom: 96,
  },
  separator: {
    height: Space.md,
  },
});
