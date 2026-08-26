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
 * Drawn from design/nocturne/aux-nocturne.dc.html L1163-L1243, and the shape
 * changed: nocturne's sheet FLOATS. It is inset from both sides, lifted clear
 * of the bottom edge, rounded on all four corners, blurred, and bordered the
 * whole way around — an object resting on the app rather than a panel welded to
 * the frame. That is the same argument the nav capsule won; a surface pinned to
 * three edges reads as part of the window.
 *
 * Two things follow from the float and both are load-bearing:
 *
 *   `sheetShadow()`, NOT `dropped()`. A sheet is lit by the page it covers, so
 *   its shadow falls upward onto that page. `dropped()` would throw the shadow
 *   down past the bottom of the screen and the sheet would lose its edge.
 *
 *   EVERY SURFACE INSIDE IT IS OPAQUE. `surface` is 5.5% white; laid over a
 *   BlurView it has nothing solid to sit on and the row dissolves into the
 *   blur. `surfaceSolid` is the resolved composite of the same colour, so the
 *   rows look identical and survive the glass.
 *
 * The search field is a RECESSED PILL with a hairline rather than an inset
 * shadow pair — at 50px the light half of that pair sits at 3.2% alpha on a
 * dark ground and only the dark half survives, which reads as dirt on the field
 * rather than as depth. This was already fixed once on the auth fields.
 *
 * Four states, all present: skeleton cards while a query is in flight, an idle
 * prompt before anyone types, "nothing matched" for a query with no hits, and
 * an error card carrying the retry.
 */

import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Music, Plus, Search, SearchX, WifiOff, X } from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AuxButton,
  BLURHASH_SURFACE,
  CircleIconButton,
  EmptyState,
  GlassCard,
  Skeleton,
  useToast,
} from '@/components/ui';
import { useAddToQueue } from '@/features/rooms/queries';
import {
  TrackResolveError,
  confirmMatch,
  resolveTrack,
  type TrackMatchCandidate,
  type TrackResolution,
} from '@/features/tracks/resolve';
import { useTrackSearch, type TrackSearchResult } from '@/features/tracks/search';
import {
  Fonts,
  PointerEvents,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  TOUCH_TARGET,
  Type,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

import { TABULAR, formatClock, initialFor, readout } from './drift';

const GUTTER = Space.lg - 2;
/** L1229's art well, and the largest thing in a result row. */
const WELL = 42;
const WELL_RADIUS = 14;
const SKELETON_ROWS = 5;
/** More than three alternatives is a research task, not a choice. */
const MAX_CANDIDATES = 3;
/** L1225: `min-height:50px`, fully rounded. */
const FIELD_HEIGHT = 50;
/** L1231's add affordance. Not a control — the whole row is the button. */
const ADD_DISC = 36;
/** The clear tile inside the field. Hit slop takes its target to 44. */
const CLEAR_TILE = 28;

export type AddTrackSheetProps = {
  roomId: string | null;
  visible: boolean;
  onClose: () => void;
};

/** What the user can actually do with this result once it is in the queue. */
function providerLine(provider: TrackSearchResult['provider']): string {
  return provider === 'spotify' ? 'Spotify + YouTube' : 'YouTube only';
}

/**
 * What went wrong, and what the person reading it can do about it.
 *
 * SEARCH RUNS ENTIRELY ON THE SERVER — the `search-tracks` Edge Function holds
 * the Spotify token and the YouTube key, because neither may ship inside the
 * app — so every way this fails is invisible from the device unless the failure
 * is spelled out. The one that keeps happening is a function deployed without
 * its secrets: it answers, it answers with an error, and a card reading "Search
 * is having a moment" over the raw message is indistinguishable from a flaky
 * connection. So the generic branch names the actual suspect. A bug report that
 * says "it says the search function is missing its provider keys" is
 * actionable; "the add track button does nothing" is not, and that is the
 * report this screen has been generating.
 *
 * `error.message` is already the server's own words where there are any —
 * `edgeFunctionError` unwraps the function's JSON body precisely so this can be
 * "the YouTube quota ran out" rather than "non-2xx status code" — so it is used
 * as the TITLE and the line under it is the instruction.
 */
function searchFailure(error: Error): { title: string; description: string } {
  const code = error instanceof TrackResolveError ? error.code : 'internal';

  if (code === 'network') {
    return {
      title: 'No connection to the Aux server',
      description: 'Search runs on the server. Check your connection, then try again.',
    };
  }
  if (code === 'unauthorized') {
    return {
      title: 'Search would not authorise',
      description: 'Your session may have expired. Sign out and back in, then try again.',
    };
  }
  if (code === 'quota_exceeded') {
    return {
      title: "YouTube's search quota is spent for today",
      description: 'It resets tomorrow. Linking Spotify Premium searches Spotify instead.',
    };
  }

  return {
    title: error.message,
    description: 'Retry — and if it keeps failing, the search function is missing its API keys.',
  };
}

export function AddTrackSheet({ roomId, visible, onClose }: AddTrackSheetProps) {
  const C = useColors();
  const { scheme } = useTheme();
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

  /**
   * Clearing is its own affordance rather than "select all and delete". The
   * search is debounced and cached, so an empty field costs nothing and returns
   * the sheet to its idle prompt — which is the fastest way to start over.
   */
  const handleClearQuery = useCallback(() => setQuery(''), []);

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

  const kicker = pending
    ? 'Pick the recording everyone will hear'
    : 'One search across every provider';

  /*
    The design floats the sheet 40px clear of the frame (L1166). On a device
    with a home indicator the inset already supplies most of that, so the float
    is the inset plus a constant rather than a flat 40 stacked on top of it.
  */
  const lift = Math.max(insets.bottom, Space.md) + Space.md;

  /*
    `keepPreviousData` holds the last results on screen while the next query
    flies, so a spinner in the field is the only honest way to say "still
    looking" without flashing the list back to skeletons on every keystroke.
  */
  const searchingOverResults = search.isSearching && search.results.length > 0;

  /*
    A FAILED SEARCH IS ITS OWN STATE, NOT A DECORATION ON AN EMPTY LIST.

    This used to be the first branch of `ListEmptyComponent`, which made it a
    property of "the list happens to have no rows" — so the message survived
    only for as long as that stayed true, and any path that left a stale row on
    screen (or any future `keepPreviousData` behaviour that holds data through
    an error) would have hidden the one thing the user needed to read. An error
    is a fact about the request, so it is rendered from the request.

    Withheld while a retry is in flight: `error` stays set across a refetch, and
    a card offering "Try again" underneath a search that is already running
    again says the retry did not take. The skeleton branch below takes over.
  */
  const failure = search.error && !search.isSearching ? searchFailure(search.error) : null;

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

        {/*
          `boxNone` because this slot now claims 82% of the window (see
          `keyboard` below). It is a spacer, not a surface: without it the 10px
          gutters either side of the sheet and the band under it would swallow
          the taps the scrim `Pressable` behind is there to catch, and
          tap-outside-to-dismiss would stop working over most of the screen.
        */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.keyboard, PointerEvents.boxNone]}>
          {/*
            THE SHADOW HAS TO LIVE ON AN OUTER VIEW. The glass below clips its
            children to the rounded corner, and Android throws away a view's own
            boxShadow along with whatever `overflow: 'hidden'` clips — the sheet
            would silently lose its lift on one platform only.
          */}
          <View style={[styles.shell, { marginBottom: lift }, sheetShadow(C)]}>
            <BlurView
              intensity={scheme === 'dark' ? 40 : 60}
              tint={scheme === 'dark' ? 'dark' : 'light'}
              // Android does not blur at all without this; the tint alone would
              // leave a flat translucent slab with nothing happening behind it.
              experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={[styles.glass, { borderColor: C.chromeBorder }]}>
              {/*
                The tint rides ON TOP of the blur rather than being handed to
                BlurView as a background: underneath, the tint becomes the thing
                being blurred and the whole sheet reads as fog. It is also the
                sheet's safety net — a Modal is its own window, so if a platform
                declines to blur what is behind it, this layer is still a
                near-opaque `nav` fill and the sheet stays a legible panel.
              */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

              <View style={styles.grabberSlot}>
                <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
              </View>

              <View style={styles.head}>
                <View style={styles.headMeta}>
                  <Text numberOfLines={1} style={[styles.headTitle, { color: C.ink }]}>
                    {pending ? 'Confirm the match' : 'Add a track'}
                  </Text>
                  <Text numberOfLines={1} style={[styles.headKicker, { color: C.ink3 }]}>
                    {kicker}
                  </Text>
                </View>

                <CircleIconButton
                  icon={X}
                  onPress={handleRequestClose}
                  accessibilityLabel="Close"
                  size={TOUCH_TARGET}
                  tone="surface"
                />
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

                    {searchingOverResults ? (
                      <ActivityIndicator size="small" color={C.ink3} />
                    ) : query.length > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear the search"
                        hitSlop={(TOUCH_TARGET - CLEAR_TILE) / 2}
                        onPress={handleClearQuery}
                        style={({ pressed }) => [
                          styles.clear,
                          { backgroundColor: pressed ? C.surface3 : C.surface2 },
                        ]}>
                        <X size={14} strokeWidth={2.4} color={C.ink2} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )}

              {pending ? (
                <CandidatePicker
                  resolution={pending}
                  onConfirm={handleConfirm}
                  onSkip={handleSkipConfirmation}
                />
              ) : failure ? (
                <View style={styles.failure}>
                  <EmptyState
                    icon={WifiOff}
                    title={failure.title}
                    description={failure.description}
                    primary={{ label: 'Try again', onPress: handleRetry }}
                  />
                </View>
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
                    search.isIdle ? (
                      <EmptyState
                        icon={Music}
                        title="What are we listening to?"
                        description={`Searching ${
                          search.provider === 'spotify' ? 'Spotify' : 'YouTube'
                        }. Type a song or an artist.`}
                      />
                    ) : search.isEmpty ? (
                      <EmptyState
                        icon={SearchX}
                        title="Nothing matched"
                        description="Try the artist name, or fewer words."
                      />
                    ) : null
                  }
                />
              )}
            </BlurView>
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

  const handlePress = useCallback(() => onPick(result), [onPick, result]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Queue ${result.title} by ${result.artist}`}
      accessibilityHint={providerLine(result.provider)}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={handlePress}>
      {({ pressed }) => (
        // `solid` because this row is inside the sheet's BlurView — see the
        // header. `row` is the design's radius-18, shadowless list card.
        <GlassCard variant="row" solid style={[styles.row, pressed && styles.rowHeld]}>
          {/*
            A dark WELL with a faint monogram. Artwork inverted in this
            direction, so nothing here may assume a bright tile: the monogram is
            `artInk` on `artwork`, not dark ink on a light plate.
          */}
          <View style={[styles.well, { backgroundColor: C.artwork, borderColor: C.rule }]}>
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
              <Text style={[styles.wellInitial, { color: C.artInk }]}>
                {initialFor(result.title)}
              </Text>
            )}
          </View>

          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
              {result.title}
            </Text>
            <Text numberOfLines={1} style={[styles.artist, { color: C.ink2 }]}>
              {result.artist}
            </Text>
            {/*
              The duration joins the provider line rather than getting a column
              of its own: it is what catches the hour-long upload of a
              three-minute song before it lands in someone else's Session.
            */}
            <Text numberOfLines={1} style={[styles.provider, { color: C.ink3 }]}>
              {`${providerLine(result.provider)} · ${formatClock(result.durationMs)}`}
            </Text>
          </View>

          {/*
            BLUE, because adding is an ACTION — the artboard's coral wash here
            (L1231) predates the two-accent split and would have said "this
            result is live", which is not a thing a search result can be.

            Not a `CircleIconButton`: the whole row is the button, and a second
            pressable inside it would split one 64px target into two.
          */}
          <View style={[styles.addDisc, { backgroundColor: C.pill }]}>
            {busy ? (
              <ActivityIndicator size="small" color={C.pillInk} />
            ) : (
              <Plus size={17} strokeWidth={2.4} color={C.pillInk} />
            )}
          </View>
        </GlassCard>
      )}
    </Pressable>
  );
});

const ResultSkeleton = memo(function ResultSkeleton() {
  return (
    <GlassCard variant="row" solid style={styles.row}>
      <Skeleton width={WELL} height={WELL} radius={WELL_RADIUS} />
      <View style={styles.metaSkeleton}>
        <Skeleton width="70%" height={14} radius={Radii.xs} />
        <Skeleton width="45%" height={11} radius={Radii.xs} />
      </View>
    </GlassCard>
  );
});

// -------------------------------------------------------- candidate picker

type CandidatePickerProps = {
  resolution: TrackResolution;
  onConfirm: (candidate: TrackMatchCandidate) => void;
  onSkip: () => void;
};

/**
 * The one screen in the app where a human is asked to do the resolver's job.
 *
 * The kicker is `ink3`, not coral (L1234 agrees). Coral in this direction means
 * live, playing, in sync — a state of the world, not a warning — and there is
 * no warn colour in the palette on purpose. A low-confidence match is a
 * measurement, and it is printed as one: the scorer's own percentage, tabular,
 * beside each option.
 */
function CandidatePicker({ resolution, onConfirm, onSkip }: CandidatePickerProps) {
  const C = useColors();
  const candidates = resolution.candidates.slice(0, MAX_CANDIDATES);

  return (
    /*
      A ScrollView rather than a plain View, and rather than a FlatList: three
      candidates is not a feed, but a long track title wrapping to two lines
      inside a short sheet used to push the escape hatch under the bottom edge
      where nothing could reach it.
    */
    <ScrollView
      style={styles.pickerScroll}
      contentContainerStyle={styles.picker}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <GlassCard solid>
        <Text style={[styles.pickerKicker, { color: C.ink3 }]}>Low-confidence match</Text>
        <Text style={[styles.pickerBody, { color: C.ink2 }]}>
          {`Pick the right recording so Spotify and YouTube listeners hear the same "${resolution.track.title}".`}
        </Text>

        <View style={styles.candidates}>
          {candidates.map((candidate) => (
            <CandidateRow
              key={`${candidate.provider}:${candidate.providerId}`}
              candidate={candidate}
              onConfirm={onConfirm}
            />
          ))}
        </View>
      </GlassCard>

      {/*
        The escape hatch sits OUTSIDE the card, because it is not one more
        candidate — it declines the whole question and queues the track on the
        provider it already plays on. It used to be a fourth row in the same
        stack wearing the same shape as the three real options, which is how a
        decline ends up being read as a choice.
      */}
      <View style={styles.skipSlot}>
        <AuxButton
          label="None of these — queue it anyway"
          onPress={onSkip}
          variant="bordered"
          size="md"
          align="center"
          fullWidth
        />
      </View>
    </ScrollView>
  );
}

type CandidateRowProps = {
  candidate: TrackMatchCandidate;
  onConfirm: (candidate: TrackMatchCandidate) => void;
};

const CandidateRow = memo(function CandidateRow({ candidate, onConfirm }: CandidateRowProps) {
  const C = useColors();
  const percent = Math.round(candidate.score * 100);

  const handlePress = useCallback(() => onConfirm(candidate), [onConfirm, candidate]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use ${candidate.title} by ${candidate.artist}, ${percent} percent match`}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.candidate,
        {
          backgroundColor: pressed ? C.surface2 : C.bgRecessed,
          // Choosing one is an action, so the edge that answers the finger is
          // the action colour. The artboard lights it coral (L1238), which
          // would say "this candidate is playing".
          borderColor: pressed ? C.pill : C.rule,
        },
      ]}>
      <Text numberOfLines={2} style={[styles.candidateLabel, { color: C.ink }]}>
        {`${candidate.title} · ${formatClock(candidate.durationMs)} · `}
        <Text style={[styles.candidateScore, { color: C.ink3 }]}>{`${percent}% match`}</Text>
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  keyboard: {
    /*
      `flex: 1` IS WHY "ADD A TRACK" OPENED ONTO NOTHING.

      This slot carried `maxHeight` and padding and no height of its own, while
      `shell` and `glass` below are both `flex: 1`. React Native's `flex: 1`
      resolves in Yoga to `flexBasis: 0pt`, so a flex child inside an
      auto-height parent contributes ZERO to that parent's content height — the
      parent measures itself at 0 and hands the child 0 back. `maxHeight` caps
      a height; it never supplies one. The sheet was 0px tall on device: the
      Modal opened, the scrim painted, and the field, the results and the error
      card all rendered inside a box with no height. Identical fault, identical
      fix, in the Session's own `Sheet` — see 'src/app/room/[id].tsx'.

      IT LOOKS FINE ON WEB, which is how it shipped: CSS sizes an auto-height
      flex column by its content and then lets the growing child fill that,
      where Yoga measures the column at zero. The browser cannot show this
      fault, so nothing found in a browser will ever find it — see the longer
      note in 'src/app/room/[id].tsx', which was measured.

      `flex: 1` gives the slot the scrim's height and `maxHeight` trims it to
      82% — which is still the original intent: the strip of scrim above is the
      affordance that says "this is a sheet you can dismiss".
    */
    flex: 1,
    maxHeight: '82%',
    /* L1166's `margin:0 10px`. It lives on the PARENT rather than as a margin
       on the sheet, because the sheet is `width:'100%'` and a margin would put
       it 20px wider than the screen. */
    paddingHorizontal: Space.sm + 2,
  },
  /** Carries the shadow and the placement. The glass below carries the skin. */
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderRadius: SheetMetrics.radius,
  },
  glass: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    borderRadius: SheetMetrics.radius,
    borderWidth: Rule.hair,
  },

  // ----------------------------------------------------------------- head
  grabberSlot: {
    paddingTop: Space.md - 2,
    paddingBottom: Space.sm,
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
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
    paddingBottom: Space.md,
  },
  headMeta: {
    flex: 1,
    minWidth: 0,
  },
  headTitle: {
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  /** L1220: the kicker under a sheet title is uppercase, not a sentence. */
  headKicker: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.08),
    marginTop: 3,
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
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  fieldInput: {
    ...Type.body(15),
    flex: 1,
    minWidth: 0,
    padding: 0,
  },
  clear: {
    width: CLEAR_TILE,
    height: CLEAR_TILE,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
  },

  // ------------------------------------------------------------- results
  list: {
    paddingHorizontal: GUTTER,
    paddingBottom: Space.xxl,
    gap: Space.sm + 1,
  },
  /**
   * The failure card takes the whole results area and centres in it, rather
   * than sitting at the top of an empty list where it reads as the first row of
   * something. Same gutter as the list so the card's edges line up with the
   * results it replaces.
   */
  failure: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: GUTTER,
    paddingBottom: Space.xxl,
  },
  /**
   * Layout only — fill, edge and corner belong to `GlassCard`. `minHeight` is
   * the row's touch target: the whole card is one press.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.md,
  },
  /**
   * `GlassCard` owns its own fill, so a press cannot step the surface up the
   * way the hand-rolled row this replaced did. Dimming is the feedback the
   * kit's gradient buttons already give, and it keeps the skin in one place.
   * A touch deeper than their 0.9 — a full-width card barely reads at that.
   */
  rowHeld: {
    opacity: 0.85,
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
  wellInitial: {
    ...readout(17),
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  /**
   * A `Skeleton` is exactly as tall as its `height`, where the text it stands
   * in for carries a line box. At the row's own 1px gap the two blocks touch
   * and read as one bar, so the placeholder takes the optical gap instead.
   */
  metaSkeleton: {
    flex: 1,
    minWidth: 0,
    gap: Space.sm,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    letterSpacing: tracking(15, -0.01),
  },
  artist: {
    ...Type.body(11.5),
  },
  provider: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.09),
    marginTop: 3,
  },
  addDisc: {
    width: ADD_DISC,
    height: ADD_DISC,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Computed rather than `Radii.pill`: Android clips a 999 radius unevenly on
    // some diameters, which shows as a flat spot on a small circle.
    borderRadius: ADD_DISC / 2,
  },

  // ----------------------------------------------------------- candidates
  pickerScroll: {
    flex: 1,
    minHeight: 0,
  },
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
    gap: Space.sm,
  },
  candidate: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm + 2,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  candidateLabel: {
    ...Type.body(12.5),
  },
  candidateScore: {
    ...TABULAR,
  },
  skipSlot: {
    marginTop: Space.md,
  },
});
