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
 * from: a Spotify hit will be cross-linked to YouTube by the resolver, so
 * everyone can play it; a YouTube hit may have no Spotify equivalent at all.
 *
 * Drawn as the Session's other sheets are drawn (design/v2/aux-v2.dc.html):
 * 28px top corners, a grabber, a raised close tile, and one raised card per
 * result. The search field is a RECESSED FILL with a hairline rather than an
 * inset shadow pair — at 50px the light half of that pair sits at 3.2% alpha on
 * a dark ground and only the dark half survives, which reads as dirt on the
 * field rather than as depth. This was already fixed once on the auth fields.
 *
 * Four states, all present: skeleton cards while a query is in flight, an idle
 * prompt before anyone types, "nothing matched" for a query with no hits, and
 * an error card carrying the retry.
 */

import { Image } from 'expo-image';
import { Music, Plus, RotateCw, Search, X } from 'lucide-react-native';
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

import { BLURHASH_SURFACE, Skeleton, useToast } from '@/components/ui';
import { useAddToQueue } from '@/features/rooms/queries';
import {
  confirmMatch,
  resolveTrack,
  type TrackMatchCandidate,
  type TrackResolution,
} from '@/features/tracks/resolve';
import { useTrackSearch, type TrackSearchResult } from '@/features/tracks/search';
import {
  Fonts,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

import { TABULAR, formatClock, initialFor, readout } from './drift';

const GUTTER = Space.lg - 2;
const WELL = 44;
const WELL_RADIUS = 13;
const SKELETON_ROWS = 5;
/** More than three alternatives is a research task, not a choice. */
const MAX_CANDIDATES = 3;
const FIELD_HEIGHT = 50;
/** Drawn at 36 like every other sheet's close tile; hit slop makes it 44. */
const CLOSE_TILE = 36;

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

  // `refetch` is a fresh closure each render, so the row is captured by value
  // rather than depended on — the notice is not memoised on it either way.
  const { refetch: refetchSearch } = search;
  const handleRetry = useCallback(() => {
    refetchSearch();
  }, [refetchSearch]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TrackSearchResult>) => (
      <SearchRow result={item} busy={busyId === item.providerId} onPick={handlePick} />
    ),
    [busyId, handlePick]
  );

  const subtitle = pending
    ? 'Two uploads share this title. Pick the recording.'
    : 'Anything you add plays for the whole Session.';

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
              { backgroundColor: C.bg, paddingBottom: insets.bottom },
              dropped(C, 'lg'),
            ]}>
            <View style={styles.grabberSlot}>
              <View style={[styles.grabber, { backgroundColor: C.ink3 }]} />
            </View>

            <View style={styles.head}>
              <View style={styles.headMeta}>
                <Text numberOfLines={1} style={[styles.headTitle, { color: C.ink }]}>
                  {pending ? 'Confirm the match' : 'Add a track'}
                </Text>
                <Text numberOfLines={1} style={[styles.headSubtitle, { color: C.ink2 }]}>
                  {subtitle}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={handleRequestClose}
                hitSlop={(TOUCH_TARGET - CLOSE_TILE) / 2}
                style={({ pressed }) => [
                  styles.closeTile,
                  { backgroundColor: C.surface },
                  raised(C),
                  pressed ? styles.dim : null,
                ]}>
                <X size={16} strokeWidth={2.2} color={C.ink2} />
              </Pressable>
            </View>

            {pending ? null : (
              <View style={styles.fieldSlot}>
                <View
                  style={[styles.field, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
                  <Search size={17} strokeWidth={2} color={C.ink3} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Song, artist, anything"
                    placeholderTextColor={C.ink3}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Search for a track"
                    style={[styles.fieldInput, { color: C.ink }]}
                  />
                </View>
              </View>
            )}

            {pending ? (
              <CandidatePicker
                resolution={pending}
                onConfirm={handleConfirm}
                onSkip={handleSkipConfirmation}
              />
            ) : search.isSearching && search.results.length === 0 ? (
              <View style={styles.list}>
                {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <ResultSkeleton key={index} />
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
                    <SearchNotice
                      icon={Search}
                      title="Search is having a moment"
                      body={search.error.message}
                      actionIcon={RotateCw}
                      actionLabel="Try again"
                      onPress={handleRetry}
                    />
                  ) : search.isIdle ? (
                    <SearchNotice
                      icon={Music}
                      title="What are we listening to?"
                      body={`Searching ${
                        search.provider === 'spotify' ? 'Spotify' : 'YouTube'
                      }. Type a song or an artist.`}
                    />
                  ) : search.isEmpty ? (
                    <SearchNotice
                      icon={Search}
                      title="Nothing matched"
                      body="Try the artist name, or fewer words."
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
        { backgroundColor: pressed ? C.surface2 : C.surface },
        raised(C),
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

      <View style={[styles.addWell, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        {busy ? (
          <ActivityIndicator size="small" color={C.ink2} />
        ) : (
          <Plus size={17} strokeWidth={2.4} color={C.ink2} />
        )}
      </View>
    </Pressable>
  );
});

const ResultSkeleton = memo(function ResultSkeleton() {
  const C = useColors();

  return (
    <View style={[styles.row, { backgroundColor: C.surface }, raised(C)]}>
      <Skeleton width={WELL} height={WELL} style={styles.wellSkeleton} />
      <View style={styles.meta}>
        <Skeleton width="70%" height={14} style={styles.lineSkeleton} />
        <Skeleton width="45%" height={11} style={styles.lineSkeleton} />
      </View>
    </View>
  );
});

// ------------------------------------------------------------- notices

type SearchNoticeProps = {
  icon: typeof Music;
  title: string;
  body: string;
  actionIcon?: typeof RotateCw;
  actionLabel?: string;
  onPress?: () => void;
};

const SearchNotice = memo(function SearchNotice({
  icon: Icon,
  title,
  body,
  actionIcon: ActionIcon,
  actionLabel,
  onPress,
}: SearchNoticeProps) {
  const C = useColors();

  return (
    <View style={[styles.notice, { backgroundColor: C.surface }, raised(C)]}>
      <Icon size={20} strokeWidth={2} color={C.ink3} />
      <Text style={[styles.noticeTitle, { color: C.ink }]}>{title}</Text>
      <Text style={[styles.noticeBody, { color: C.ink2 }]}>{body}</Text>

      {onPress && actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onPress}
          style={({ pressed }) => [
            styles.noticeAction,
            { backgroundColor: C.pill },
            pressed ? styles.dim : null,
          ]}>
          {ActionIcon ? <ActionIcon size={15} strokeWidth={2.4} color={C.pillInk} /> : null}
          <Text style={[styles.noticeActionLabel, { color: C.pillInk }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
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
    <View style={styles.picker}>
      <Text style={[styles.pickerKicker, { color: C.liveText }]}>Low-confidence match</Text>
      <Text style={[styles.pickerBody, { color: C.ink2 }]}>
        {`Pick the right recording so Spotify and YouTube listeners hear the same "${resolution.track.title}".`}
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
              { backgroundColor: pressed ? C.surface2 : C.surface },
              raised(C),
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
            styles.candidateQuiet,
            { backgroundColor: C.bgRecessed, borderColor: pressed ? C.rule3 : C.rule },
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
    // 82% rather than full height: the strip of scrim above is the affordance
    // that says "this is a sheet you can dismiss".
    maxHeight: '82%',
  },
  sheet: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderTopLeftRadius: SheetMetrics.radius,
    borderTopRightRadius: SheetMetrics.radius,
  },
  dim: {
    opacity: 0.7,
  },

  // ----------------------------------------------------------------- head
  grabberSlot: {
    paddingTop: Space.md + 2,
    alignItems: 'center',
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: SheetMetrics.grabberH / 2,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xxl - 2,
    paddingTop: Space.lg + 2,
    paddingBottom: Space.md,
  },
  headMeta: {
    flex: 1,
    minWidth: 0,
  },
  headTitle: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.025),
  },
  headSubtitle: {
    ...Type.body(12.5),
    marginTop: 3,
  },
  closeTile: {
    width: CLOSE_TILE,
    height: CLOSE_TILE,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },

  // ---------------------------------------------------------------- field
  fieldSlot: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm + 2,
    height: FIELD_HEIGHT,
    paddingHorizontal: Space.md + 2,
    borderRadius: Radii.md + 1,
    borderWidth: Rule.hair,
  },
  fieldInput: {
    ...Type.body(15),
    flex: 1,
    minWidth: 0,
    padding: 0,
  },

  // ------------------------------------------------------------- results
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.xxl,
    gap: Space.sm + 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md + 2,
    minHeight: TOUCH_TARGET + Space.md,
    padding: Space.md - 1,
    borderRadius: Radii.button,
  },
  well: {
    width: WELL,
    height: WELL,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: WELL_RADIUS,
    borderWidth: Rule.hair,
  },
  wellSkeleton: {
    borderRadius: WELL_RADIUS,
  },
  lineSkeleton: {
    borderRadius: Radii.xs,
  },
  wellInitial: {
    ...readout(15),
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, -0.01),
  },
  artist: {
    ...Type.body(12),
  },
  provider: {
    ...Type.label(9.5),
    letterSpacing: tracking(9.5, 0.11),
    marginTop: 1,
  },
  addWell: {
    width: 36,
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
  },

  // ------------------------------------------------------------- notices
  notice: {
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.lg,
    borderRadius: Radii.lg,
  },
  noticeTitle: {
    ...Type.heading(15),
  },
  noticeBody: {
    ...Type.body(13),
    maxWidth: 380,
  },
  noticeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
    marginTop: Space.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.sm,
  },
  noticeActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    letterSpacing: tracking(13, 0.02),
  },

  // ----------------------------------------------------------- candidates
  picker: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.xxl,
  },
  pickerKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.13),
    marginBottom: Space.xs + 2,
  },
  pickerBody: {
    ...Type.body(13),
  },
  candidates: {
    marginTop: Space.md,
    gap: Space.sm + 1,
  },
  candidate: {
    minHeight: TOUCH_TARGET + Space.sm,
    justifyContent: 'center',
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.md - 2,
    borderRadius: Radii.button,
  },
  candidateQuiet: {
    borderWidth: Rule.hair,
  },
  candidateLabel: {
    ...Type.body(13),
  },
  candidateScore: {
    ...TABULAR,
  },
});
