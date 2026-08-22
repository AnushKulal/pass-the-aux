import { router } from 'expo-router';
import { Compass, KeyRound, SearchX, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItem } from 'react-native';

import { LoungeCard, LoungeListSkeleton } from '@/components/lounge/lounge-card';
import { AuxButton, EmptyState, GlassCard, Screen, TextField, useToast } from '@/components/ui';
import {
  loungeErrorMessage,
  useJoinByCode,
  usePublicLounges,
  type PublicLoungeSummary,
} from '@/features/lounges/queries';
import { Colors, Space, Type } from '@/lib/theme';

/**
 * Long enough that a fast typist sends one request per word rather than per
 * keystroke — the same figure track search uses, so the app feels consistent.
 */
const SEARCH_DEBOUNCE_MS = 400;
const CODE_LENGTH = 8;

export default function ExploreScreen() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isPending, isError, error, refetch } = usePublicLounges(debounced);

  const handleJoined = useCallback(
    (loungeId: string) => {
      toast.show('Joined the lounge', 'success');
      router.push(`/lounge/${loungeId}`);
    },
    [toast],
  );

  const renderItem = useCallback<ListRenderItem<PublicLoungeSummary>>(
    ({ item }) => (
      <LoungeCard
        name={item.lounge.name}
        description={item.lounge.description || undefined}
        iconUrl={item.lounge.icon_url}
        isPublic={item.lounge.is_public}
        showJoined={item.isMember}
        onPress={() => router.push(`/lounge/${item.lounge.id}`)}
      />
    ),
    [],
  );

  return (
    <Screen title="Explore">
      {/*
        The code field and the search field sit OUTSIDE the FlatList on purpose.
        As a ListHeaderComponent they would remount whenever the list re-renders,
        which drops the keyboard mid-word.
      */}
      <View style={styles.header}>
        <JoinByCodeCard onJoined={handleJoined} />

        <TextField
          label="Search public lounges"
          value={search}
          onChangeText={setSearch}
          placeholder="Name or description"
          autoCapitalize="none"
          autoComplete="off"
        />
      </View>

      {isPending ? (
        <LoungeListSkeleton count={3} />
      ) : isError ? (
        <EmptyState
          icon={WifiOff}
          title="Could not reach Explore"
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
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            debounced.trim().length > 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nothing matched"
                description={`No public lounge mentions "${debounced.trim()}".`}
              />
            ) : (
              <EmptyState
                icon={Compass}
                title="No public lounges yet"
                description="Be the first — create one and make it public."
              />
            )
          }
        />
      )}
    </Screen>
  );
}

/** Redeeming an invite code is the only way into a private lounge. */
function JoinByCodeCard({ onJoined }: { onJoined: (loungeId: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const join = useJoinByCode();

  const handleChange = useCallback((value: string) => {
    setCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, CODE_LENGTH));
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    setError(null);
    join.mutate(code, {
      onSuccess: (loungeId) => {
        setCode('');
        onJoined(loungeId);
      },
      onError: (err) => setError(loungeErrorMessage(err, 'Could not join. Try again.')),
    });
  }, [code, join, onJoined]);

  return (
    <GlassCard>
      <View style={styles.codeCard}>
        <Text style={styles.codeTitle}>Have an invite code?</Text>

        <TextField
          value={code}
          onChangeText={handleChange}
          placeholder="A1B2C3D4"
          autoCapitalize="none"
          autoComplete="off"
          maxLength={CODE_LENGTH}
          error={error ?? undefined}
        />

        <AuxButton
          label="Join"
          icon={KeyRound}
          size="sm"
          onPress={handleSubmit}
          loading={join.isPending}
          disabled={code.length < CODE_LENGTH}
        />
      </View>
    </GlassCard>
  );
}

function keyExtractor(item: PublicLoungeSummary): string {
  return item.lounge.id;
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  header: {
    gap: Space.lg,
    paddingBottom: Space.lg,
  },
  codeCard: {
    gap: Space.md,
    alignItems: 'stretch',
  },
  codeTitle: {
    ...Type.heading,
    color: Colors.text,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    // Clears the floating tab bar.
    paddingBottom: 96,
  },
  separator: {
    height: Space.md,
  },
});
