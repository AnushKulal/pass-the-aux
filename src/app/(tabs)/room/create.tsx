/**
 * Start a Session.
 *
 * The design never drew this screen, so it is built from the parts that are
 * drawn elsewhere: the "New lounge" header and field, the "Lounge detail" card
 * row, and one accent cell at the bottom.
 *
 * A Session always belongs to a lounge — that is what scopes who can hear it,
 * who can queue, and who can chat. So the lounge is a required choice, not a
 * setting buried behind "advanced". Choosing one is a passive form choice, so
 * it is marked with an accent BORDER and a word; the FILL is spent once, on the
 * control that actually puts you on aux, because that is the one live thing on
 * the screen.
 *
 * Four states, all present: a skeleton of the real card while the lounges load,
 * a failure that offers the retry, an empty roster that says where to get one,
 * and the list itself.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronLeft } from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatNotice } from '@/components/chat/bubble-kit';
import { Skeleton, useToast } from '@/components/ui';
import { useCreateRoom, useMyLounges } from '@/features/rooms/queries';
import type { LoungeRow } from '@/lib/database.types';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  Type,
  dropped,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const MAX_NAME_LENGTH = 50;
const SKELETON_ROWS = 3;
const OPTION_HEIGHT = 70;

const BACK_TILE = 38;
const BACK_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };

export default function CreateRoomScreen() {
  const C = useColors();

  // See room/[id].tsx: the generic must be a required-property shape.
  const params = useLocalSearchParams<{ loungeId: string }>();
  const toast = useToast();

  const lounges = useMyLounges();
  const createRoom = useCreateRoom();

  const [name, setName] = useState('');
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<string | null>(
    typeof params.loungeId === 'string' ? params.loungeId : null,
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
            'error',
          );
        },
      },
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
    [loungeId],
  );

  const canStart = Boolean(loungeId) && !createRoom.isPending;

  return (
    /*
      No ScrollView: membership is unbounded, so the options need a virtualised
      list — and a FlatList nested in a ScrollView would warn, lose
      virtualisation and fight it for the gesture. The FlatList owns the
      scrolling instead, with the form around it as header and footer.
    */
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
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
            <View style={styles.head}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={BACK_SLOP}
                onPress={handleBack}
                style={({ pressed }) => [
                  styles.backTile,
                  { backgroundColor: pressed ? C.surface2 : C.surface },
                  raised(C),
                ]}>
                <ChevronLeft size={20} strokeWidth={2.4} color={C.ink} />
              </Pressable>
              <Text style={[styles.title, { color: C.ink }]}>Start a Session</Text>
            </View>

            <Text style={[styles.kicker, { color: C.ink3 }]}>Name it — optional</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Friday night"
              placeholderTextColor={C.ink3}
              maxLength={MAX_NAME_LENGTH}
              autoCapitalize="sentences"
              selectionColor={C.live}
              accessibilityLabel="Name it, optional"
              // A surface with a hairline, never the inset pair: at 52px only
              // the dark half of that pair lands and it reads as dirt.
              style={[
                styles.field,
                { color: C.ink, backgroundColor: C.surface, borderColor: focused ? C.rule3 : C.rule },
              ]}
            />

            <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>
              Which lounge?
            </Text>
          </View>
        }
        ListEmptyComponent={
          lounges.isPending ? (
            <View style={styles.skeletons}>
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <Skeleton key={index} width="100%" height={OPTION_HEIGHT} radius={Radii.lg} />
              ))}
            </View>
          ) : lounges.isError ? (
            <ChatNotice
              label="Your lounges didn't load."
              action={{ label: 'Retry', onPress: () => void lounges.refetch() }}
            />
          ) : (
            <ChatNotice
              label="A Session lives inside a lounge. Join one first."
              action={{ label: 'Find a lounge', onPress: () => router.replace('/lounges') }}
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
                { backgroundColor: pressed ? C.liveText : C.live },
                dropped(C, 'lg'),
                canStart ? null : styles.inert,
              ]}>
              {createRoom.isPending ? <ActivityIndicator size="small" color={C.onLive} /> : null}
              <Text style={[styles.startLabel, { color: C.onLive }]}>Go on aux</Text>
            </Pressable>

            <Text style={[styles.footnote, { color: C.ink3 }]}>
              Anyone in the lounge can join and add to the queue.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
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
        {
          backgroundColor: pressed ? C.surface2 : C.surface,
          borderColor: selected ? C.live : 'transparent',
        },
        raised(C),
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
          <Check size={18} color={C.liveText} strokeWidth={2.2} />
        </>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    paddingBottom: Space.xxxl,
  },
  header: {
    paddingBottom: Space.md,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: Space.xl,
  },
  backTile: {
    width: BACK_TILE,
    height: BACK_TILE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    ...Type.display(24),
    letterSpacing: tracking(24, -0.03),
  },

  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    marginBottom: Space.sm,
  },
  kickerSpaced: {
    marginTop: Space.xl,
  },
  field: {
    ...Type.body(15),
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: 0,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },

  skeletons: {
    gap: Space.sm,
  },
  optionGap: {
    height: Space.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: OPTION_HEIGHT,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Rule.thick,
  },
  optionMeta: {
    flex: 1,
    minWidth: 0,
  },
  optionName: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tracking(15, -0.01),
  },
  optionDescription: {
    ...Type.body(12.5),
    marginTop: 2,
  },
  optionSelected: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.13),
    flexShrink: 0,
  },

  footer: {
    gap: Space.md,
    paddingTop: Space.xxl,
  },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm + 2,
    minHeight: 56,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.button,
  },
  startLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  inert: {
    opacity: 0.45,
  },
  footnote: {
    ...Type.body(12.5),
  },
});
