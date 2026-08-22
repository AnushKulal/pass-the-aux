/**
 * Explore — the two ways into a lounge you are not in yet: a code somebody sent
 * you, or a search.
 *
 * No grid here and only a trace of bloom: the grid belongs to Session and Feed,
 * and there is no artwork on this screen for the glow to come off. What carries
 * the direction instead are the mono readouts — the invite code itself, its
 * character count, and the result count on the section rule.
 */

import { router } from 'expo-router';
import { Compass, KeyRound, SearchX, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type ListRenderItem } from 'react-native';

import { BloomBackdrop } from '@/components/atmosphere';
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

/** No artwork on this screen, so the bloom is dialled well back. */
const BLOOM_INTENSITY = 0.22;

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

  const resultCount = data?.length ?? 0;

  return (
    <Screen title="Explore">
      <BloomBackdrop intensity={BLOOM_INTENSITY} rise={120} />

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
        <>
          <View style={styles.rule}>
            <Text style={styles.eyebrow}>Public lounges</Text>
            <Text style={styles.ruleCount}>
              {`${resultCount} ${resultCount === 1 ? 'result' : 'results'}`}
            </Text>
          </View>

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
        </>
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

        <View style={styles.codeRow}>
          <View style={styles.codeField}>
            <TextField
              value={code}
              onChangeText={handleChange}
              placeholder="A1B2C3D4"
              autoCapitalize="none"
              autoComplete="off"
              maxLength={CODE_LENGTH}
              error={error ?? undefined}
            />
          </View>

          {/* Wrapped: AuxButton pins itself with `alignSelf`, which would
              otherwise fight this row. */}
          <View>
            <AuxButton
              label="Join"
              icon={KeyRound}
              variant="ghost"
              size="sm"
              onPress={handleSubmit}
              loading={join.isPending}
              disabled={code.length < CODE_LENGTH}
            />
          </View>
        </View>

        {/* A code is eight characters and you are counting them out. Mono. */}
        <Text style={styles.codeCounter}>{`${code.length}/${CODE_LENGTH}`}</Text>
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
  codeRow: {
    flexDirection: 'row',
    // Top, not centre: an error message grows the field downwards and the
    // button must stay level with the input it belongs to.
    alignItems: 'flex-start',
    gap: Space.md,
  },
  codeField: {
    flex: 1,
    minWidth: 0,
  },
  codeCounter: {
    ...Type.mono,
    color: Colors.muted,
    textAlign: 'right',
  },
  /*
    Colors.muted, not Colors.faint. The artboards set these eyebrows in the
    faint ink, but faint is a divider colour here and these are words people
    have to read; muted is the nearest tone that clears 4.5:1.
  */
  eyebrow: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Space.md,
  },
  ruleCount: {
    ...Type.monoLabel,
    color: Colors.muted,
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
