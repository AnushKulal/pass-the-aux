/**
 * A direct-message thread. Design canvas: `data-screen-label="Thread"`.
 *
 * Header: back tile, avatar, name, and a live dot with the status under it.
 * The log below is an `inverted` FlatList of memoised bubbles with day
 * separators and 5-minute run grouping — the same machinery the lounge chat
 * uses, because a DM is a chat log with two people in it.
 *
 * Three things worth knowing before changing this:
 *
 *  1. **Inverted means "older is the NEXT index."** Runs and day boundaries are
 *     measured against `messages[index + 1]`. Getting it backwards is the
 *     classic inverted-chat bug: the avatar lands on the last message of a run.
 *
 *  2. **Read is a cursor, not a flag.** `useMarkRead` fires on mount and again
 *     whenever the viewer is sitting at the bottom — including when a message
 *     arrives while they are already there, which is the case a scroll handler
 *     alone never catches.
 *
 *  3. **Search is local to what is loaded.** It filters the pages already in
 *     the cache rather than querying.
 *
 * The bubbles and the composer are `@/components/dm` components and are styled
 * there, not here.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Search, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatNotice, LogStart, styles as kit } from '@/components/chat/bubble-kit';
import { DmAttachSheet, type AttachOption } from '@/components/dm/attach-sheet';
import { DmComposer } from '@/components/dm/composer';
import { MessageBubble } from '@/components/dm/message-bubble';
import { type MentionCandidate } from '@/components/dm/mention-picker';
import { DmRecordSheet, type VoiceNoteDraft } from '@/components/dm/record-sheet';
import { Avatar, Skeleton, useToast } from '@/components/ui';
import {
  useDmSubscription,
  useInbox,
  useMarkRead,
  useSendMessage,
  useThread,
  useViewerId,
  type DmAuthor,
  type DmMessage,
} from '@/features/dm';
import {
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Messages closer together than this from one sender render as one run. */
const GROUP_WINDOW_MS = 5 * 60_000;

/** Within this of `last_seen_at`, someone is here. */
const ONLINE_MS = 2 * 60_000;
/** Beyond ONLINE and within this, they are idle rather than gone. */
const IDLE_MS = 15 * 60_000;

/** Inverted: offset 0 is the newest message. This much slack still counts. */
const AT_BOTTOM_PX = 24;

const HEADER_AVATAR = 40;
const TILE = 38;
const TILE_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

type Decorated = {
  message: DmMessage;
  showHeader: boolean;
  /** Last of its run: the one bubble of the run that carries a timestamp. */
  showStamp: boolean;
  daySeparator: string | null;
};

/** Module scope so the reference never changes between renders. */
const keyExtractor = (item: Decorated) => item.message.id;

const startOfDay = (value: string | Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

function dayLabel(iso: string): string {
  const now = new Date();
  const day = startOfDay(iso);

  if (day === startOfDay(now)) return 'Today';

  /*
    Stepping the date field rather than subtracting 24h: on the two DST
    changeovers a day is 23 or 25 hours long, and fixed-millisecond arithmetic
    labels one of them wrong.
  */
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === startOfDay(yesterday)) return 'Yesterday';

  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    // Only disambiguate the year once the log is old enough to need it.
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/**
 * Annotate each message with what it needs to draw itself.
 *
 * The list is newest-first because it is rendered `inverted`, so the visually
 * *preceding* message — the one a run or a day boundary is measured against —
 * is the NEXT index, not the previous one. `showStamp` is the mirror: the
 * visually LAST bubble of a run is the one whose NEWER neighbour starts a
 * fresh one.
 */
function decorate(messages: DmMessage[]): Decorated[] {
  const rows = messages.map((message, index) => {
    const older = messages[index + 1];

    const newDay = !older || startOfDay(older.createdAt) !== startOfDay(message.createdAt);
    const newSender = !older || older.senderId !== message.senderId;
    const gap =
      !older ||
      new Date(message.createdAt).getTime() - new Date(older.createdAt).getTime() >
        GROUP_WINDOW_MS;

    return {
      message,
      // A day break always starts a fresh run, whoever spoke last.
      showHeader: newDay || newSender || gap,
      showStamp: false,
      daySeparator: newDay ? dayLabel(message.createdAt) : null,
    };
  });

  for (let index = 0; index < rows.length; index += 1) {
    rows[index].showStamp = index === 0 || rows[index - 1].showHeader;
  }

  return rows;
}

type Presence = {
  /** Null when there is nothing honest to say — no profile, or activity hidden. */
  label: string | null;
  /** Drives the accent dot. Only true for genuinely-here. */
  live: boolean;
};

/**
 * Presence from `last_seen_at`, and only when the person allows it.
 *
 * There is no presence table and no room join on this screen, so this
 * deliberately never claims LISTENING — the artboard's state is not something
 * this screen can know. `show_activity` off means the user asked not to be
 * reported on, and the answer is silence, not "Offline".
 */
function presenceOf(author: DmAuthor | null): Presence {
  if (!author || !author.show_activity) return { label: null, live: false };

  const seen = new Date(author.last_seen_at).getTime();
  if (Number.isNaN(seen)) return { label: null, live: false };

  const age = Date.now() - seen;
  if (age <= ONLINE_MS) return { label: 'Online', live: true };
  if (age <= IDLE_MS) return { label: 'Idle', live: false };
  return { label: 'Offline', live: false };
}

/** Everything in a message a conversation search should look at. */
function haystack(message: DmMessage): string {
  return [
    message.body,
    message.track?.title,
    message.track?.artist,
    message.attachment?.storage_path?.split('/').pop(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function DmThreadScreen() {
  const C = useColors();
  const toast = useToast();
  const reduced = useReducedMotion();

  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof params.id === 'string' && params.id ? params.id : null;

  const viewerId = useViewerId();
  const { messages, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useThread(conversationId);

  useDmSubscription(conversationId);
  const markRead = useMarkRead(conversationId);

  /*
    Who this thread is with. The inbox already knows — it resolved the other
    participant server-side — and sharing that cache means opening a thread
    paints a name immediately instead of after its own round trip. A thread
    reached without the inbox warm (a deep link) falls back to the first message
    that is not the viewer's.
  */
  const { rows } = useInbox();
  const other = useMemo<DmAuthor | null>(() => {
    const row = rows.find((entry) => entry.conversationId === conversationId);
    if (row?.other) return row.other;
    return messages.find((message) => !message.mine)?.author ?? null;
  }, [rows, conversationId, messages]);

  const name = other?.display_name?.trim() || other?.username || 'Conversation';
  const handle = other?.username ? `@${other.username}` : '';
  const presence = useMemo(() => presenceOf(other), [other]);

  // ---------------------------------------------------------------- read cursor

  /** Ref, not state: nothing renders off it, and a scroll must not re-render. */
  const atBottom = useRef(true);

  useEffect(() => {
    markRead();
  }, [markRead]);

  const newestId = messages[0]?.id ?? null;
  useEffect(() => {
    // A message landing while the viewer is already parked at the bottom is
    // read the moment it arrives; the scroll handler never fires for it.
    if (newestId && atBottom.current) markRead();
  }, [newestId, markRead]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const bottom = event.nativeEvent.contentOffset.y <= AT_BOTTOM_PX;
      if (bottom && !atBottom.current) markRead();
      atBottom.current = bottom;
    },
    [markRead],
  );

  // ---------------------------------------------------------------- search

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) setQuery('');
      return !open;
    });
  }, []);

  const trimmedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!trimmedQuery) return messages;
    return messages.filter((message) => haystack(message).includes(trimmedQuery));
  }, [messages, trimmedQuery]);

  const data = useMemo(() => decorate(visible), [visible]);

  // ---------------------------------------------------------------- actions

  const openProfile = useCallback(() => {
    if (other && viewerId && other.id === viewerId) {
      router.push('/profile');
      return;
    }
    // TODO(profiles): route to /profile/[id] once that screen is built.
    toast.show('No profile page yet.', 'info');
  }, [other, toast, viewerId]);

  // ---------------------------------------------------------------- composing

  const send = useSendMessage(conversationId ?? '');
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const onSend = useCallback(
    (body: string) => {
      /*
        Clear first, send second. The mutation is optimistic, so the message is
        already on screen by the time this returns; leaving the text in the
        field until the server answers is what makes a thread feel laggy.
      */
      setDraft('');
      send.mutate({ kind: 'text', body });
    },
    [send],
  );

  const openAttach = useCallback(() => setAttachOpen(true), []);
  const closeAttach = useCallback(() => setAttachOpen(false), []);
  const openRecord = useCallback(() => setRecordOpen(true), []);
  const closeRecord = useCallback(() => setRecordOpen(false), []);

  const onAttachSelect = useCallback((option: AttachOption) => {
    setAttachOpen(false);
    // Only `voice` can reach here — the others are disabled below rather than
    // being offered and then failing.
    if (option === 'voice') setRecordOpen(true);
  }, []);

  /**
   * A voice note cannot actually be produced in this build (no recorder), so
   * this is the seam and not the path: it exists so the sheet has somewhere to
   * hand a take the moment `expo-audio` is installed.
   */
  const onVoiceNote = useCallback(
    (_draft: VoiceNoteDraft) => {
      setRecordOpen(false);
      toast.show('Voice notes are not built yet.', 'info');
    },
    [toast],
  );

  /**
   * The mention pool is the person you are talking to. Never pre-filtered: the
   * picker's count depends on getting the whole set.
   */
  const mentionPeople = useMemo<MentionCandidate[]>(() => {
    if (!other?.username) return [];
    return [
      {
        id: other.id,
        handle: other.username,
        displayName: other.display_name?.trim() || other.username,
        avatarUrl: other.avatar_url,
        sub: presence.label,
      },
    ];
  }, [other, presence.label]);

  const onEndReached = useCallback(() => {
    // Fires at the top of an inverted list, which is where older pages go.
    // Suspended while searching: paging in on a filtered view would make the
    // list jump under a query the user is still typing.
    if (trimmedQuery) return;
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [trimmedQuery, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Decorated>) => (
      <MessageBubble
        message={item.message}
        showHeader={item.showHeader}
        showStamp={item.showStamp}
        daySeparator={item.daySeparator}
        onOpenProfile={openProfile}
      />
    ),
    [openProfile],
  );

  // ---------------------------------------------------------------- entrance

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);
  const enterStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  // ---------------------------------------------------------------- render

  if (!conversationId) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right']}
        style={[styles.root, { backgroundColor: C.bg }]}>
        <View style={kit.noticeDock}>
          <ChatNotice
            label="That conversation is gone."
            action={{ label: 'Go back', onPress: router.back }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View style={[styles.flex, enterStyle]}>
        <View style={styles.constrain}>
          <View style={[styles.header, { borderBottomColor: C.rule }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to messages"
              hitSlop={TILE_SLOP}
              onPress={router.back}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: pressed ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <ChevronLeft size={20} strokeWidth={2.4} color={C.ink} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}${presence.label ? `, ${presence.label}` : ''}. Open profile`}
              onPress={openProfile}
              style={({ pressed }) => [styles.identity, pressed && styles.dim]}>
              <Avatar uri={other?.avatar_url} name={name} size={HEADER_AVATAR} />

              <View style={styles.identityText}>
                <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                  {name}
                </Text>
                {presence.label ? (
                  <View style={styles.statusLine}>
                    {presence.live ? (
                      <View style={[styles.statusDot, { backgroundColor: C.live }]} />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      style={[styles.status, { color: presence.live ? C.liveText : C.ink3 }]}>
                      {presence.label}
                    </Text>
                  </View>
                ) : handle ? (
                  <Text numberOfLines={1} style={[styles.status, { color: C.ink3 }]}>
                    {handle}
                  </Text>
                ) : null}
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search this conversation"
              accessibilityState={{ expanded: searchOpen }}
              hitSlop={TILE_SLOP}
              onPress={toggleSearch}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: pressed || searchOpen ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <Search size={18} strokeWidth={2.2} color={searchOpen ? C.ink : C.ink2} />
            </Pressable>
          </View>

          {searchOpen ? (
            <View style={styles.searchBar}>
              {/*
                A 44px field gets `bgRecessed` and a hairline, NOT `pressed()`.
                On a dark ground the light half of the inset pair is 3.2% alpha,
                so at this size only the dark half lands and it reads as dirt.
                This was already fixed once on the auth fields.
              */}
              <View
                style={[
                  styles.searchWell,
                  { backgroundColor: C.bgRecessed, borderColor: C.rule },
                ]}>
                <TextInput
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={C.ink3}
                  selectionColor={C.live}
                  accessibilityLabel="Search this conversation"
                  returnKeyType="search"
                  style={[styles.searchInput, { color: C.ink }]}
                />

                {trimmedQuery ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.matchCount, { color: C.ink3 }]}>
                    {visible.length}
                  </Text>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close search"
                hitSlop={TILE_SLOP}
                onPress={toggleSearch}
                style={({ pressed }) => [
                  styles.tile,
                  { backgroundColor: pressed ? C.surface2 : C.surface },
                  raised(C),
                ]}>
                <X size={17} strokeWidth={2.2} color={C.ink2} />
              </Pressable>
            </View>
          ) : null}
        </View>

        {isPending ? (
          <ThreadSkeleton />
        ) : isError && messages.length === 0 ? (
          <View style={kit.noticeDock}>
            <ChatNotice
              label="This thread didn't load."
              action={{ label: 'Retry', onPress: refetch }}
            />
          </View>
        ) : visible.length === 0 ? (
          <View style={kit.noticeDock}>
            {trimmedQuery ? (
              <ChatNotice
                label={`Nothing here matches "${query.trim()}".`}
                action={{ label: 'Clear', onPress: toggleSearch }}
              />
            ) : (
              <ChatNotice label={`Say something to ${name}.`} />
            )}
          </View>
        ) : (
          <FlatList
            data={data}
            inverted
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            onScroll={onScroll}
            scrollEventThrottle={64}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.olderLoader}>
                  <ActivityIndicator size="small" color={C.ink3} />
                </View>
              ) : !hasNextPage && !trimmedQuery ? (
                /*
                  The top of the log terminates in the same rule-plus-label
                  figure the day separators use, so "the log ends here" and "a
                  new day starts here" read as one system rather than two.
                */
                <LogStart />
              ) : null
            }
            contentContainerStyle={[styles.listContent, styles.constrain]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            /*
              removeClippedSubviews is deliberately off: combined with
              `inverted` it is a known source of rows rendering blank on
              Android, and a thread with holes in it is a worse trade than the
              memory it would save.
            */
            removeClippedSubviews={false}
            initialNumToRender={15}
            maxToRenderPerBatch={12}
            windowSize={11}
          />
        )}

        <View style={styles.constrain}>
          <DmComposer
            value={draft}
            onChangeText={setDraft}
            onSend={onSend}
            onAttach={openAttach}
            onRecord={openRecord}
            placeholder="Message"
            sending={send.isPending}
            mentionPeople={mentionPeople}
            mentionScopeLabel="In this conversation"
          />
        </View>
      </Animated.View>

      {/*
        Photo, file and track are switched off here rather than in the sheet:
        the sheet only knows which *packages* this build has, and this screen is
        what would have to service the pick.
      */}
      <DmAttachSheet
        visible={attachOpen}
        onClose={closeAttach}
        onSelect={onAttachSelect}
        available={{ track: false }}
        unavailableReason={{ track: 'Not built yet' }}
      />

      <DmRecordSheet visible={recordOpen} onCancel={closeRecord} onSend={onVoiceNote} />
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------- parts */

/**
 * First-load placeholder. Alternating widths and sides read as "messages are
 * coming" rather than as a broken layout.
 */
function ThreadSkeleton() {
  return (
    <View accessibilityLabel="Loading messages" style={styles.skeleton}>
      {[62, 44, 74, 38, 56, 68].map((width, index) => (
        <View
          key={width}
          style={[styles.skeletonRow, index % 2 === 0 ? styles.alignStart : styles.alignEnd]}>
          <Skeleton width={`${width}%`} height={44} radius={Radii.lg} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  /**
   * react-native-web has no phone to constrain it, so an unbounded column
   * stretches to the full window and the line length becomes unreadable.
   */
  constrain: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    paddingBottom: 14,
    borderBottomWidth: Rule.hair,
  },
  tile: {
    width: TILE,
    height: TILE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  dim: {
    opacity: 0.6,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.semibold,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: tracking(15.5, -0.01),
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: Radii.pill,
  },
  status: {
    fontFamily: Fonts.semibold,
    fontSize: 11.5,
    lineHeight: 15,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  searchWell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: TOUCH_TARGET,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: TOUCH_TARGET,
    paddingHorizontal: 15,
    fontFamily: Fonts.regular,
    fontSize: 14.5,
  },
  matchCount: {
    // A match count measures. Tabular figures.
    ...readout(12),
    paddingRight: Space.md,
  },

  listContent: {
    // The bubble row carries its own 12px gutter (see `bubble-kit`), so the
    // list adds only the vertical air. Both chat surfaces then measure the same.
    paddingVertical: Space.md,
  },
  olderLoader: {
    paddingVertical: Space.lg,
    alignItems: 'center',
  },
  skeleton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Space.md,
    paddingBottom: Space.lg,
    gap: 10,
  },
  skeletonRow: {
    flexDirection: 'row',
  },
  alignStart: {
    justifyContent: 'flex-start',
  },
  alignEnd: {
    justifyContent: 'flex-end',
  },
});
