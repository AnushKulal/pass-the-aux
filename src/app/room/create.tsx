/**
 * Start a Session.
 *
 * A Session always belongs to a lounge — that is what scopes who can hear it,
 * who can queue, and who can chat. So the lounge is a required choice, not a
 * setting buried behind "advanced".
 */

import { router, useLocalSearchParams } from 'expo-router';
import { Check, Radio, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { AuxButton, EmptyState, Screen, Skeleton, TextField, useToast } from '@/components/ui';
import { useCreateRoom, useMyLounges } from '@/features/rooms/queries';
import type { LoungeRow } from '@/lib/database.types';
import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

const MAX_NAME_LENGTH = 50;
const SKELETON_ROWS = 3;

export default function CreateRoomScreen() {
  // See room/[id].tsx: the generic must be a required-property shape.
  const params = useLocalSearchParams<{ loungeId: string }>();
  const toast = useToast();

  const lounges = useMyLounges();
  const createRoom = useCreateRoom();

  const [name, setName] = useState('');
  const [loungeId, setLoungeId] = useState<string | null>(
    typeof params.loungeId === 'string' ? params.loungeId : null
  );

  // Coming from a lounge preselects it; landing here from the tab bar with
  // exactly one lounge should not make the user tap a list of one.
  useEffect(() => {
    if (loungeId) return;

    const all = lounges.data;
    if (!all || all.length !== 1) return;

    setLoungeId(all[0].id);
  }, [loungeId, lounges.data]);

  const handleCreate = useCallback(() => {
    if (!loungeId) {
      toast.show('Pick a lounge for this Session.', 'error');
      return;
    }

    createRoom.mutate(
      { loungeId, name },
      {
        onSuccess: (room) => {
          // replace, not push: backing out of a Session should land on the
          // lounge, not on the form that created it.
          router.replace({ pathname: '/room/[id]', params: { id: room.id } });
        },
        onError: (error) => {
          toast.show(
            error instanceof Error ? error.message : 'Could not start the Session.',
            'error'
          );
        },
      }
    );
  }, [createRoom, loungeId, name, toast]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LoungeRow>) => (
      <LoungeOption lounge={item} selected={item.id === loungeId} onSelect={setLoungeId} />
    ),
    [loungeId]
  );

  return (
    /*
      No `scroll` on Screen: membership is unbounded, so the options need a
      virtualised list — and a FlatList nested in Screen's ScrollView would
      warn, lose virtualisation and fight it for the gesture. The FlatList owns
      the scrolling instead, with the form around it as header and footer.
    */
    <Screen title="Start a Session" onBack={handleBack}>
      <FlatList
        style={styles.flex}
        data={lounges.data ?? []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={OptionGap}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <TextField
              label="Name it"
              value={name}
              onChangeText={setName}
              placeholder="Friday night"
              maxLength={MAX_NAME_LENGTH}
              autoCapitalize="sentences"
            />

            <Text style={styles.sectionTitle}>Which lounge?</Text>
          </View>
        }
        ListEmptyComponent={
          lounges.isLoading && !lounges.data ? (
            <View style={styles.list}>
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton
                  key={index}
                  width="100%"
                  height={TOUCH_TARGET + Space.md}
                  radius={Radius.md}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={Users}
              title="No lounges yet"
              description="A Session lives inside a lounge. Join one with an invite code, or start your own."
              action={
                <AuxButton
                  label="Find a lounge"
                  onPress={() => router.replace('/lounges')}
                  variant="ghost"
                  size="sm"
                />
              }
            />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <AuxButton
              label="Go on aux"
              onPress={handleCreate}
              variant="accent"
              size="lg"
              icon={Radio}
              fullWidth
              loading={createRoom.isPending}
              disabled={!loungeId || createRoom.isPending}
            />

            <Text style={styles.footnote}>
              You start as host. Anyone in the lounge can join and add to the queue.
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const keyExtractor = (item: LoungeRow) => item.id;

/** Keeps the 8px minimum between adjacent radio targets. */
const OptionGap = () => <View style={styles.optionGap} />;

type LoungeOptionProps = {
  lounge: LoungeRow;
  selected: boolean;
  onSelect: (loungeId: string) => void;
};

function LoungeOption({ lounge, selected, onSelect }: LoungeOptionProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={lounge.name}
      onPress={() => onSelect(lounge.id)}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}>
      <View style={styles.optionMeta}>
        <Text numberOfLines={1} style={styles.optionName}>
          {lounge.name}
        </Text>
        {lounge.description ? (
          <Text numberOfLines={1} style={styles.optionDescription}>
            {lounge.description}
          </Text>
        ) : null}
      </View>

      {/* A check glyph, not just the border tint — selection must survive being
          seen by someone who cannot separate indigo from the surface. */}
      {selected ? <Check size={20} color={Colors.text} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  /* The three blocks below reproduce what `body`'s 24px gap and the section's
     12px gap used to space, now that header, items and footer are siblings of
     the virtualised list rather than children of one column. */
  content: {
    flexGrow: 1,
    paddingTop: Space.md,
    paddingBottom: Space.xxl,
  },
  header: {
    gap: Space.xl,
    paddingBottom: Space.md,
  },
  footer: {
    gap: Space.xl,
    paddingTop: Space.xl,
  },
  optionGap: {
    height: Space.sm,
  },
  sectionTitle: {
    ...Type.heading,
    color: Colors.text,
  },
  list: {
    gap: Space.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  optionSelected: {
    // Indigo, not the accent: picking a lounge is a passive form choice, and
    // the green has to keep meaning live/play/join.
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceRaised,
  },
  optionPressed: {
    opacity: 0.75,
  },
  optionMeta: {
    flex: 1,
    gap: 2,
  },
  optionName: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  optionDescription: {
    ...Type.caption,
    color: Colors.muted,
  },
  footnote: {
    ...Type.body,
    color: Colors.muted,
  },
});
