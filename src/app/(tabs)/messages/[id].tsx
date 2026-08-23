/**
 * A direct-message thread. README §13, the "Thread" paragraph.
 *
 * Header: avatar, presence and status (tap → profile), then
 * search-this-conversation, call and video. The log below it is an `inverted`
 * FlatList of memoised bubbles with day separators and 5-minute run grouping —
 * the same machinery the lounge chat uses, because a DM is a chat log with two
 * people in it and a private bucket behind it, not a different idea.
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
 *     the cache rather than querying, and says so when it finds nothing, so it
 *     never claims a thread does not contain a word that is simply further up.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, MessageCircle, Phone, Search, Video, X } from 'lucide-react-native';
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

import { DmAttachSheet, type AttachOption } from '@/components/dm/attach-sheet';
import { DmComposer } from '@/components/dm/composer';
import { MessageBubble } from '@/components/dm/message-bubble';
import { type MentionCandidate } from '@/components/dm/mention-picker';
import { DmRecordSheet, type VoiceNoteDraft } from '@/components/dm/record-sheet';
import { Avatar, AuxButton, EmptyState, Skeleton, useToast } from '@/components/ui';
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
  Radius,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
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

const HEADER_AVATAR = 30;
const PRESENCE_DOT = 9;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

type Decorated = {
  message: DmMessage;
  showHeader: boolean;
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
 * is the NEXT index, not the previous one.
 */
function decorate(messages: DmMessage[]): Decorated[] {
  return messages.map((message, index) => {
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
      daySeparator: newDay ? dayLabel(message.createdAt) : null,
    };
  });
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
 * There is no presence table (README, Schema gaps) and no room join on this
 * screen, so this deliberately never claims LISTENING — the prototype's fourth
 * state is not something this screen can know. `show_activity` off means the
 * user asked not to be reported on, and the answer is silence, not OFFLINE.
 */
function presenceOf(author: DmAuthor | null): Presence {
  if (!author || !author.show_activity) return { label: null, live: false };

  const seen = new Date(author.last_seen_at).getTime();
  if (Number.isNaN(seen)) return { label: null, live: false };

  const age = Date.now() - seen;
  if (age <= ONLINE_MS) return { label: 'ONLINE', live: true };
  if (age <= IDLE_MS) return { label: 'IDLE', live: false };
  return { label: 'OFFLINE', live: false };
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
    // TODO(profiles): route to /profile/[id] once README §15 is built.
    toast.show('That profile screen is not built yet.', 'info');
  }, [other, toast, viewerId]);

  /*
    §14 has no backend. The controls still render, because a header missing two
    of its four cells reads as a broken build rather than as an unfinished
    feature — and a tap that explains itself is better than a tap that does
    nothing at all.
  */
  const onCall = useCallback(() => {
    toast.show('Voice calls are not built yet.', 'info');
  }, [toast]);

  const onVideo = useCallback(() => {
    toast.show('Video calls are not built yet.', 'info');
  }, [toast]);

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
    // Only `voice` can reach here — the other three are disabled below, with
    // their reasons, rather than being offered and then failing.
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
   * §13's picker is scoped to a lounge or a Session. A thread has neither — it
   * has exactly two people in it — so the scope is the conversation, and the
   * pool is the person you are talking to. Never pre-filtered: the picker's
   * count depends on getting the whole set.
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
        daySeparator={item.daySeparator}
        onOpenProfile={openProfile}
      />
    ),
    [openProfile],
  );

  // ---------------------------------------------------------------- entrance

  const enter = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = withTiming(1, { duration: Duration.enter });
  }, [enter, reduced]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  // ---------------------------------------------------------------- render

  if (!conversationId) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
        <View style={styles.emptyDock}>
          <EmptyState
            icon={MessageCircle}
            title="No conversation"
            description="That thread could not be opened."
            action={<AuxButton label="Go back" onPress={router.back} variant="ghost" size="sm" />}
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
              accessibilityLabel="Go back"
              onPress={router.back}
              style={({ pressed }) => [
                styles.headerCell,
                { borderRightWidth: Rule.hair, borderRightColor: C.rule },
                pressed && styles.dim,
              ]}>
              <ArrowLeft size={20} strokeWidth={2} color={C.ink2} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}${presence.label ? `, ${presence.label}` : ''}. Open profile`}
              onPress={openProfile}
              style={({ pressed }) => [
                styles.identity,
                pressed ? { backgroundColor: C.surface } : null,
              ]}>
              <View style={styles.avatarWell}>
                <Avatar uri={other?.avatar_url} name={name} size={HEADER_AVATAR} />
                {presence.live ? (
                  /* Square, like everything else. The 2px ring in the ground
                     colour separates the dot from the avatar without a shadow. */
                  <View style={[styles.dot, { backgroundColor: C.live, borderColor: C.bg }]} />
                ) : null}
              </View>

              <View style={styles.identityText}>
                <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                  {name}
                </Text>
                {presence.label ? (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.status,
                      { color: presence.live ? C.liveText : C.ink3 },
                    ]}>
                    {presence.label}
                  </Text>
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
              onPress={toggleSearch}
              style={({ pressed }) => [styles.headerCell, pressed && styles.dim]}>
              <Search size={18} strokeWidth={2} color={searchOpen ? C.ink : C.ink2} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call ${name}`}
              accessibilityHint="Not built yet"
              onPress={onCall}
              style={({ pressed }) => [styles.headerCell, pressed && styles.dim]}>
              <Phone size={18} strokeWidth={2} color={C.ink2} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Video call ${name}`}
              accessibilityHint="Not built yet"
              onPress={onVideo}
              style={({ pressed }) => [
                styles.headerCell,
                { borderLeftWidth: Rule.hair, borderLeftColor: C.rule },
                pressed && styles.dim,
              ]}>
              <Video size={19} strokeWidth={2} color={C.ink2} />
            </Pressable>
          </View>

          {searchOpen ? (
            <View
              style={[
                styles.searchBar,
                { backgroundColor: C.bgRecessed, borderBottomColor: C.rule },
              ]}>
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search this conversation"
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

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close search"
                onPress={toggleSearch}
                style={({ pressed }) => [styles.searchClose, pressed && styles.dim]}>
                <X size={17} strokeWidth={2} color={C.ink2} />
              </Pressable>
            </View>
          ) : null}
        </View>

        {isPending ? (
          <ThreadSkeleton />
        ) : isError && messages.length === 0 ? (
          <View style={styles.emptyDock}>
            <EmptyState
              icon={MessageCircle}
              title="This thread didn't load"
              description="Check your connection and try again."
              action={<AuxButton label="Retry" onPress={refetch} variant="ghost" size="sm" />}
            />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.emptyDock}>
            <EmptyState
              icon={MessageCircle}
              title={trimmedQuery ? 'Nothing found' : 'Say something'}
              description={
                trimmedQuery
                  ? 'No loaded message matches that. Scroll further back and search again.'
                  : `This is the beginning of your conversation with ${name}.`
              }
            />
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
                <View style={styles.logStartBlock}>
                  <View style={[styles.logStartRule, { backgroundColor: C.rule }]} />
                  <Text style={[styles.logStart, { color: C.ink3 }]}>
                    This is the beginning of your conversation with {name}.
                  </Text>
                </View>
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
            placeholder={handle ? `Message ${handle}` : 'Message'}
            sending={send.isPending}
            mentionPeople={mentionPeople}
            mentionScopeLabel="IN THIS CONVERSATION"
          />
        </View>
      </Animated.View>

      {/*
        Photo, file and track are switched off here rather than in the sheet:
        the sheet only knows which *packages* this build has, and this screen is
        what would have to service the pick. Offering a row that dead-ends on
        tap is worse than a row that says why it is off.
      */}
      <DmAttachSheet
        visible={attachOpen}
        onClose={closeAttach}
        onSelect={onAttachSelect}
        available={{ track: false }}
        unavailableReason={{ track: 'Sharing a track from a thread is not built yet' }}
      />

      <DmRecordSheet visible={recordOpen} onCancel={closeRecord} onSend={onVoiceNote} />
    </SafeAreaView>
  );
}

/**
 * First-load placeholder. Alternating widths and sides read as "messages are
 * coming" rather than as a broken layout. Square, like every other block here.
 */
function ThreadSkeleton() {
  return (
    <View accessibilityLabel="Loading messages" style={styles.skeleton}>
      {[62, 44, 74, 38, 56, 68].map((width, index) => (
        <View
          key={width}
          style={[styles.skeletonRow, index % 2 === 0 ? styles.alignStart : styles.alignEnd]}>
          <Skeleton width={`${width}%`} height={38} radius={Radius} />
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
    // 2px, because this is a boundary between two major regions of the screen.
    borderBottomWidth: Rule.major,
  },
  headerCell: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
    gap: 9,
    paddingHorizontal: 10,
  },
  avatarWell: {
    flexShrink: 0,
  },
  dot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: PRESENCE_DOT,
    height: PRESENCE_DOT,
    borderWidth: Rule.major,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.01),
  },
  status: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.08),
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: Rule.hair,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 46,
    paddingHorizontal: Space.md,
    ...Type.body(16),
  },
  matchCount: {
    // A match count measures. Tabular figures.
    ...readout(12),
    paddingHorizontal: Space.sm,
  },
  searchClose: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingVertical: Space.md,
  },
  emptyDock: {
    flex: 1,
    justifyContent: 'center',
  },
  olderLoader: {
    paddingVertical: Space.lg,
    alignItems: 'center',
  },
  logStartBlock: {
    paddingVertical: Space.lg,
    gap: Space.md,
  },
  logStartRule: {
    height: Rule.hair,
    marginHorizontal: Space.md,
  },
  logStart: {
    ...Type.body(12),
    textAlign: 'center',
    paddingHorizontal: Space.xl,
  },
  skeleton: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Space.md,
    paddingBottom: Space.lg,
    gap: Space.md,
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
