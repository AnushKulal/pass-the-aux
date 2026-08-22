/**
 * Search, resolve, queue.
 *
 * "Resolve" is the step that makes this app work: whatever the user found on
 * their own provider becomes one catalog track with links to both, so the
 * Premium listener and the free listener hear the same recording. When the
 * resolver is not confident enough to write a link, it returns candidates
 * instead of guessing — a wrong `track_links` row is permanent and every future
 * listener would inherit it — and this sheet is where a human settles it.
 */

import { Image } from 'expo-image';
import { Music, Search, X } from 'lucide-react-native';
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
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AuxButton,
  BLURHASH_SURFACE,
  EmptyState,
  Skeleton,
  TextField,
  useToast,
} from '@/components/ui';
import { useAddToQueue } from '@/features/rooms/queries';
import {
  confirmMatch,
  resolveTrack,
  type TrackMatchCandidate,
  type TrackResolution,
} from '@/features/tracks/resolve';
import { useTrackSearch, type TrackSearchResult } from '@/features/tracks/search';
import { Colors, Duration, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

const ART_SIZE = 48;
const SKELETON_ROWS = 5;
/** More than three alternatives is a research task, not a choice. */
const MAX_CANDIDATES = 3;

export type AddTrackSheetProps = {
  roomId: string | null;
  visible: boolean;
  onClose: () => void;
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export function AddTrackSheet({ roomId, visible, onClose }: AddTrackSheetProps) {
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
      <View style={styles.scrim}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Space.lg }]}>
            <View style={styles.header}>
              <Text style={styles.heading}>Add to the queue</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={handleClose}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                <X size={22} color={Colors.text} />
              </Pressable>
            </View>

            {pending ? (
              <CandidatePicker
                resolution={pending}
                onConfirm={handleConfirm}
                onSkip={handleSkipConfirmation}
              />
            ) : (
              <>
                <TextField
                  label="Search"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Song or artist"
                  autoCapitalize="none"
                />

                {search.isSearching && search.results.length === 0 ? (
                  <View style={styles.skeletonWrap}>
                    {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                      <View key={index} style={styles.row}>
                        <Skeleton width={ART_SIZE} height={ART_SIZE} radius={Radius.sm} />
                        <View style={styles.meta}>
                          <Skeleton width="70%" height={16} />
                          <Skeleton width="45%" height={13} />
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
                          action={
                            <AuxButton
                              label="Try again"
                              onPress={search.refetch}
                              variant="ghost"
                              size="sm"
                            />
                          }
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
              </>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Queue ${result.title} by ${result.artist}`}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={() => onPick(result)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {result.artworkUrl ? (
        <Image
          source={{ uri: result.artworkUrl }}
          style={styles.art}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.fast}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.art, styles.artFallback]} />
      )}

      <View style={styles.meta}>
        <Text numberOfLines={1} style={styles.title}>
          {result.title}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          {result.artist} · {formatDuration(result.durationMs)}
        </Text>
      </View>

      {busy ? <ActivityIndicator size="small" color={Colors.muted} /> : null}
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
  const candidates = resolution.candidates.slice(0, MAX_CANDIDATES);

  return (
    <View style={styles.picker}>
      <Text style={styles.pickerTitle}>Which one is it?</Text>
      <Text style={styles.pickerBody}>
        {`We could not confidently match "${resolution.track.title}" on the other provider. Pick the right one so everyone hears the same recording.`}
      </Text>

      {candidates.map((candidate) => (
        <Pressable
          key={`${candidate.provider}:${candidate.providerId}`}
          accessibilityRole="button"
          accessibilityLabel={`Use ${candidate.title} by ${candidate.artist}`}
          onPress={() => onConfirm(candidate)}
          style={({ pressed }) => [styles.row, styles.candidate, pressed && styles.pressed]}>
          {candidate.artworkUrl ? (
            <Image
              source={{ uri: candidate.artworkUrl }}
              style={styles.art}
              contentFit="cover"
              cachePolicy="memory-disk"
              placeholder={{ blurhash: BLURHASH_SURFACE }}
              transition={Duration.fast}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.art, styles.artFallback]} />
          )}

          <View style={styles.meta}>
            <Text numberOfLines={2} style={styles.title}>
              {candidate.title}
            </Text>
            <Text numberOfLines={1} style={styles.subtitle}>
              {candidate.artist} · {formatDuration(candidate.durationMs)}
            </Text>
          </View>
        </Pressable>
      ))}

      <AuxButton
        label="None of these — queue it anyway"
        onPress={onSkip}
        variant="ghost"
        size="sm"
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: Colors.scrim,
    justifyContent: 'flex-end',
  },
  keyboard: {
    // 88% rather than full height: the strip of scrim above is the affordance
    // that says "this is a sheet you can dismiss".
    height: '88%',
  },
  sheet: {
    flex: 1,
    // Outside `Screen`'s 720 cap, so it carries its own — otherwise the sheet
    // spans the full width of a desktop browser window.
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: Colors.bg,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    gap: Space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  heading: {
    ...Type.title,
    color: Colors.text,
    flex: 1,
  },
  close: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Space.md,
  },
  list: {
    paddingBottom: Space.xxl,
    // Whole rows are the tappable, so this gap IS the spacing between adjacent
    // touch targets — 8px minimum, not the 4px the visual padding disguised.
    gap: Space.sm,
  },
  skeletonWrap: {
    gap: Space.sm,
    paddingTop: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    minHeight: TOUCH_TARGET + Space.sm,
  },
  candidate: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Space.md,
  },
  pressed: {
    opacity: 0.6,
  },
  art: {
    width: ART_SIZE,
    height: ART_SIZE,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
  },
  artFallback: {
    backgroundColor: Colors.surfaceRaised,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  subtitle: {
    ...Type.caption,
    color: Colors.muted,
  },
  picker: {
    flex: 1,
    gap: Space.md,
  },
  pickerTitle: {
    ...Type.heading,
    color: Colors.text,
  },
  pickerBody: {
    ...Type.body,
    color: Colors.muted,
  },
});
