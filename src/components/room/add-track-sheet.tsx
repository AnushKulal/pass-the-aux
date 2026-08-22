/**
 * Search, resolve, queue.
 *
 * "Resolve" is the step that makes this app work: whatever the user found on
 * their own provider becomes one catalog track with links to both, so the
 * Premium listener and the free listener hear the same recording. When the
 * resolver is not confident enough to write a link, it returns candidates
 * instead of guessing — a wrong `track_links` row is permanent and every future
 * listener would inherit it — and this sheet is where a human settles it, with
 * the scorer's own percentage next to each option.
 *
 * The provider line under each result is derived from where the result came
 * from, exactly as the design does it: a Spotify hit will be cross-linked to
 * YouTube by the resolver, so everyone can play it; a YouTube hit may have no
 * Spotify equivalent at all. Search itself is single-provider — the edge
 * function takes one — so "one search across providers" is honest about the
 * outcome rather than the mechanism.
 */

import { Image } from 'expo-image';
import { Music, Search } from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLURHASH_SURFACE, EmptyState, Skeleton, useToast } from '@/components/ui';
import { useAddToQueue } from '@/features/rooms/queries';
import {
  confirmMatch,
  resolveTrack,
  type TrackMatchCandidate,
  type TrackResolution,
} from '@/features/tracks/resolve';
import { useTrackSearch, type TrackSearchResult } from '@/features/tracks/search';
import { Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

import { TABULAR, formatClock, initialFor, readout } from './drift';

const GUTTER = Space.md;
const WELL = 36;
const SKELETON_ROWS = 5;
/** More than three alternatives is a research task, not a choice. */
const MAX_CANDIDATES = 3;

export type AddTrackSheetProps = {
  roomId: string | null;
  visible: boolean;
  onClose: () => void;
};

/** What the user can actually do with this result once it is in the queue. */
function providerLine(provider: TrackSearchResult['provider']): string {
  return provider === 'spotify' ? 'Spotify + YouTube' : 'YouTube only';
}

export function AddTrackSheet({ roomId, visible, onClose }: AddTrackSheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const addToQueue = useAddToQueue(roomId);

  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<TrackResolution | null>(null);

  // Passing '' while hidden keeps a closed sheet from spending YouTube quota on
  // whatever text was left in the field.
  const search = useTrackSearch(visible ? query : '');

  const queueTrack = useCallback(
    async (trackId: string, title: string) => {
      try {
        await addToQueue.mutateAsync(trackId);
        toast.show(`Added "${title}" to the queue`, 'success');
      } catch (error) {
        toast.show(error instanceof Error ? error.message : 'Could not add that track.', 'error');
      }
    },
    [addToQueue, toast]
  );

  const handlePick = useCallback(
    async (result: TrackSearchResult) => {
      if (!roomId || busyId) return;
      setBusyId(result.providerId);

      try {
        const resolution = await resolveTrack(result.provider, result.providerId);

        if (resolution.needsConfirmation && resolution.candidates.length > 0) {
          setPending(resolution);
          return;
        }

        await queueTrack(resolution.track.id, resolution.track.title);
      } catch (error) {
        toast.show(
          error instanceof Error ? error.message : 'Could not resolve that track.',
          'error'
        );
      } finally {
        setBusyId(null);
      }
    },
    [roomId, busyId, queueTrack, toast]
  );

  const handleConfirm = useCallback(
    async (candidate: TrackMatchCandidate) => {
      if (!pending) return;
      const resolution = pending;
      setPending(null);
      setBusyId(candidate.providerId);

      try {
        await confirmMatch(resolution.track.id, candidate.provider, candidate.providerId);
        await queueTrack(resolution.track.id, resolution.track.title);
      } catch (error) {
        toast.show(error instanceof Error ? error.message : 'Could not save that match.', 'error');
      } finally {
        setBusyId(null);
      }
    },
    [pending, queueTrack, toast]
  );

  /** The track already plays on the provider it came from; the cross-link is optional. */
  const handleSkipConfirmation = useCallback(async () => {
    if (!pending) return;
    const resolution = pending;
    setPending(null);
    await queueTrack(resolution.track.id, resolution.track.title);
  }, [pending, queueTrack]);

  const handleClose = useCallback(() => {
    setPending(null);
    setQuery('');
    onClose();
  }, [onClose]);

  /** Android hardware back: back out of the picker first, then out of the sheet. */
  const handleRequestClose = useCallback(() => {
    if (pending) {
      setPending(null);
      return;
    }
    handleClose();
  }, [pending, handleClose]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TrackSearchResult>) => (
      <SearchRow result={item} busy={busyId === item.providerId} onPick={handlePick} />
    ),
    [busyId, handlePick]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={handleRequestClose}>
      <View style={[styles.scrim, { backgroundColor: C.scrim }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
          style={StyleSheet.absoluteFill}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: C.bg, borderTopColor: C.live, marginBottom: insets.bottom },
            ]}>
            <View style={[styles.head, { borderBottomColor: C.rule }]}>
              <View style={styles.headRow}>
                <Text style={[styles.headTitle, { color: C.ink }]}>
                  {pending ? 'Confirm the match' : 'Add a track'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={handleRequestClose}
                  style={styles.close}>
                  <Text style={[styles.closeLabel, { color: C.ink2 }]}>Close</Text>
                </Pressable>
              </View>

              {pending ? null : (
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search every provider at once"
                  placeholderTextColor={C.ink3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search for a track"
                  style={[
                    styles.field,
                    { backgroundColor: C.surface, borderColor: C.rule2, color: C.ink },
                  ]}
                />
              )}
            </View>

            {pending ? (
              <CandidatePicker
                resolution={pending}
                onConfirm={handleConfirm}
                onSkip={handleSkipConfirmation}
              />
            ) : search.isSearching && search.results.length === 0 ? (
              <View>
                {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <View key={index} style={[styles.row, { borderBottomColor: C.ruleSoft }]}>
                    <Skeleton width={WELL} height={WELL} radius={0} />
                    <View style={styles.meta}>
                      <Skeleton width="70%" height={14} radius={0} />
                      <Skeleton width="45%" height={11} radius={0} />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <FlatList
                data={search.results}
                renderItem={renderItem}
                keyExtractor={searchKeyExtractor}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  search.error ? (
                    <EmptyState
                      icon={Search}
                      title="Search is having a moment"
                      description={search.error.message}
                    />
                  ) : search.isIdle ? (
                    <EmptyState
                      icon={Music}
                      title="What are we listening to?"
                      description={`Searching ${
                        search.provider === 'spotify' ? 'Spotify' : 'YouTube'
                      }. Anything you add plays for the whole Session.`}
                    />
                  ) : search.isEmpty ? (
                    <EmptyState
                      icon={Search}
                      title="Nothing matched"
                      description="Try the artist name, or fewer words."
                    />
                  ) : null
                }
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const searchKeyExtractor = (item: TrackSearchResult) => `${item.provider}:${item.providerId}`;

// ------------------------------------------------------------- search row

type SearchRowProps = {
  result: TrackSearchResult;
  busy: boolean;
  onPick: (result: TrackSearchResult) => void;
};

const SearchRow = memo(function SearchRow({ result, busy, onPick }: SearchRowProps) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Queue ${result.title} by ${result.artist}`}
      accessibilityHint={providerLine(result.provider)}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={() => onPick(result)}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: C.ruleSoft },
        pressed ? { backgroundColor: C.surface } : null,
      ]}>
      <View style={[styles.well, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        {result.artworkUrl ? (
          <Image
            source={{ uri: result.artworkUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_SURFACE }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.wellInitial, { color: C.ink3 }]}>{initialFor(result.title)}</Text>
        )}
      </View>

      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
          {result.title}
        </Text>
        <Text numberOfLines={1} style={[styles.artist, { color: C.ink2 }]}>
          {result.artist}
        </Text>
        <Text numberOfLines={1} style={[styles.provider, { color: C.ink3 }]}>
          {providerLine(result.provider)}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={C.ink2} />
      ) : (
        <Text style={[styles.action, { color: C.liveText }]}>Add</Text>
      )}
    </Pressable>
  );
});

// -------------------------------------------------------- candidate picker

type CandidatePickerProps = {
  resolution: TrackResolution;
  onConfirm: (candidate: TrackMatchCandidate) => void;
  onSkip: () => void;
};

function CandidatePicker({ resolution, onConfirm, onSkip }: CandidatePickerProps) {
  const C = useColors();
  const candidates = resolution.candidates.slice(0, MAX_CANDIDATES);

  return (
    <View style={[styles.picker, { borderColor: C.rule2 }]}>
      <Text style={[styles.pickerKicker, { color: C.ink3 }]}>Low-confidence match</Text>
      <Text style={[styles.pickerBody, { color: C.ink2 }]}>
        {`More than one upload shares this title. Pick the right one so Spotify and YouTube listeners hear the same recording as "${resolution.track.title}".`}
      </Text>

      <View style={styles.candidates}>
        {candidates.map((candidate) => (
          <Pressable
            key={`${candidate.provider}:${candidate.providerId}`}
            accessibilityRole="button"
            accessibilityLabel={`Use ${candidate.title} by ${candidate.artist}, ${Math.round(
              candidate.score * 100
            )} percent match`}
            onPress={() => onConfirm(candidate)}
            style={({ pressed }) => [
              styles.candidate,
              { borderColor: C.rule2 },
              pressed ? { borderColor: C.live } : null,
            ]}>
            <Text numberOfLines={2} style={[styles.candidateLabel, { color: C.ink }]}>
              {`${candidate.title} · ${formatClock(candidate.durationMs)} · `}
              <Text style={[styles.candidateScore, { color: C.ink3 }]}>
                {`${Math.round(candidate.score * 100)}% match`}
              </Text>
            </Text>
          </Pressable>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="None of these — queue it anyway"
          onPress={onSkip}
          style={({ pressed }) => [
            styles.candidate,
            { borderColor: C.rule2 },
            pressed ? { borderColor: C.ink } : null,
          ]}>
          <Text style={[styles.candidateLabel, { color: C.ink2 }]}>
            None of these — queue it anyway
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  keyboard: {
    // 80% rather than full height: the strip of scrim above is the affordance
    // that says "this is a sheet you can dismiss".
    maxHeight: '80%',
  },
  sheet: {
    flex: 1,
    // Outside any 720 cap, so it carries its own — otherwise the sheet spans
    // the full width of a desktop browser window.
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopWidth: Rule.major,
  },
  head: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: GUTTER,
    paddingTop: Space.md,
    paddingBottom: Space.md - 2,
    borderBottomWidth: Rule.major,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  headTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
    textTransform: 'uppercase',
    flex: 1,
    minWidth: 0,
  },
  close: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  closeLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
    textTransform: 'uppercase',
  },
  field: {
    ...Type.body(16),
    height: 46,
    marginTop: Space.md - 2,
    paddingHorizontal: GUTTER,
    borderWidth: Rule.hair,
  },

  // ------------------------------------------------------------- results
  list: {
    flexGrow: 1,
    paddingBottom: Space.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    minHeight: TOUCH_TARGET + Space.md,
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm + 2,
    borderBottomWidth: Rule.hair,
  },
  well: {
    width: WELL,
    height: WELL,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: Rule.hair,
  },
  wellInitial: {
    ...readout(15),
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...Type.heading(14),
    letterSpacing: tracking(14, 0.01),
  },
  artist: {
    ...Type.body(13),
  },
  provider: {
    ...Type.label(10),
    marginTop: 3,
  },
  action: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
    flexGrow: 0,
    flexShrink: 0,
  },

  // ----------------------------------------------------------- candidates
  picker: {
    margin: Space.lg - 2,
    padding: Space.md,
    borderWidth: Rule.hair,
  },
  pickerKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.11),
    marginBottom: Space.sm - 2,
  },
  pickerBody: {
    ...Type.body(16),
  },
  candidates: {
    marginTop: Space.md - 2,
    gap: Space.sm,
  },
  candidate: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: GUTTER,
    paddingVertical: Space.sm,
    borderWidth: Rule.hair,
  },
  candidateLabel: {
    ...Type.body(13),
  },
  candidateScore: {
    ...TABULAR,
  },
});
