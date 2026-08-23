/**
 * Start a Session.
 *
 * A Session always belongs to a lounge — that is what scopes who can hear it,
 * who can queue, and who can chat. So the lounge is a required choice, not a
 * setting buried behind "advanced".
 *
 * Flat throughout: bordered cells, hard rules, one accent fill on the single
 * control that actually starts something live. Selecting a lounge is a passive
 * form choice, so it is marked with an accent BORDER and a word, never an
 * accent fill — the fill has to keep meaning "live".
 */

import { router, useLocalSearchParams } from 'expo-router';
import { Check, Users } from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { EmptyState, Screen, Skeleton, TextField, useToast } from '@/components/ui';
import { useCreateRoom, useMyLounges } from '@/features/rooms/queries';
import type { LoungeRow } from '@/lib/database.types';
import { Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const MAX_NAME_LENGTH = 50;
const SKELETON_ROWS = 3;
const OPTION_HEIGHT = 58;

export default function CreateRoomScreen() {
  const C = useColors();

  // See room/[id].tsx: the generic must be a required-property shape.
  const params = useLocalSearchParams<{ loungeId: string }>();
  const toast = useToast();

  const lounges = useMyLounges();
  const createRoom = useCreateRoom();

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(
    typeof params.loungeId === 'string' ? params.loungeId : null
  );

  /*
    Derived, not synchronised. Coming from a lounge preselects it, and landing
    here from the tab bar with exactly one lounge should not make the user tap a
    list of one — but writing that default into state from an effect means a
    cascading render, and a default that would fight the user's own choice the
    moment the query refetched.
  */
  const all = lounges.data;
  const loungeId = picked ?? (all && all.length === 1 ? all[0].id : null);

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
      <LoungeOption lounge={item} selected={item.id === loungeId} onSelect={setPicked} />
    ),
    [loungeId]
  );

  const canStart = Boolean(loungeId) && !createRoom.isPending;

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

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: C.ink3 }]}>Which lounge?</Text>
              <View style={[styles.sectionRule, { backgroundColor: C.rule }]} />
            </View>
          </View>
        }
        ListEmptyComponent={
          lounges.isLoading && !lounges.data ? (
            <View style={styles.skeletons}>
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton key={index} width="100%" height={OPTION_HEIGHT} radius={0} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={Users}
              title="No lounges yet"
              description="A Session lives inside a lounge. Join one with an invite code, or start your own."
              action={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Find a lounge"
                  onPress={() => router.replace('/lounges')}
                  style={({ pressed }) => [
                    styles.ghost,
                    { borderColor: C.rule2 },
                    pressed ? { borderColor: C.ink } : null,
                  ]}>
                  <Text style={[styles.ghostLabel, { color: C.ink }]}>Find a lounge</Text>
                </Pressable>
              }
            />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go on aux"
              accessibilityState={{ disabled: !canStart, busy: createRoom.isPending }}
              disabled={!canStart}
              onPress={handleCreate}
              style={({ pressed }) => [
                styles.start,
                { backgroundColor: C.live },
                pressed ? { backgroundColor: C.liveText } : null,
                canStart ? null : styles.inert,
              ]}>
              {createRoom.isPending ? (
                <ActivityIndicator size="small" color={C.onLive} />
              ) : (
                <Text style={[styles.startLabel, { color: C.onLive }]}>Go on aux</Text>
              )}
            </Pressable>

            <Text style={[styles.footnote, { color: C.ink2 }]}>
              You go on aux. Anyone in the lounge can join and add to the queue.
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

const LoungeOption = memo(function LoungeOption({
  lounge,
  selected,
  onSelect,
}: LoungeOptionProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={lounge.name}
      onPress={() => onSelect(lounge.id)}
      style={({ pressed }) => [
        styles.option,
        { borderColor: selected ? C.live : C.rule2 },
        pressed ? { backgroundColor: C.surface } : null,
      ]}>
      <View style={styles.optionMeta}>
        <Text numberOfLines={1} style={[styles.optionName, { color: C.ink }]}>
          {lounge.name}
        </Text>
        {lounge.description ? (
          <Text numberOfLines={1} style={[styles.optionDescription, { color: C.ink2 }]}>
            {lounge.description}
          </Text>
        ) : null}
      </View>

      {/* A word and a glyph, not just the border tint — selection has to survive
          being seen by someone who cannot separate the red from the ground. */}
      {selected ? (
        <>
          <Text style={[styles.optionSelected, { color: C.liveText }]}>Selected</Text>
          <Check size={18} color={C.liveText} strokeWidth={2} />
        </>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
    gap: Space.lg,
    paddingTop: Space.xl,
  },
  optionGap: {
    height: Space.sm,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  sectionTitle: {
    // A kicker with a hairline running out of it: the same figure the chat log
    // uses for day breaks and the lounge uses for its sections.
    ...Type.label(10),
  },
  sectionRule: {
    flex: 1,
    height: Rule.hair,
  },
  skeletons: {
    gap: Space.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: OPTION_HEIGHT,
    paddingHorizontal: Space.md - 1,
    paddingVertical: Space.md,
    borderWidth: Rule.hair,
  },
  optionMeta: {
    flex: 1,
    minWidth: 0,
  },
  optionName: {
    ...Type.heading(14),
    letterSpacing: tracking(14, 0.01),
  },
  optionDescription: {
    ...Type.body(13),
  },
  optionSelected: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },
  start: {
    minHeight: 52,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  startLabel: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.1),
    textTransform: 'uppercase',
  },
  inert: {
    opacity: 0.55,
  },
  ghost: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  ghostLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
    textTransform: 'uppercase',
  },
  footnote: {
    ...Type.body(16),
  },
});
