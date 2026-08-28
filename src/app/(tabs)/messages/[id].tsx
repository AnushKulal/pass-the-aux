/**
 * A direct-message thread. Design: `design/nocturne/aux-nocturne.dc.html`
 * L720-793 (`isDm`).
 *
 * Header: a glass back circle, the person (avatar with its punched presence
 * dot, name, and a tracked status word under it), and the search toggle. The
 * log below is an `inverted` FlatList of memoised bubbles with day separators
 * and 5-minute run grouping — the same machinery the lounge chat uses, because
 * a DM is a chat log with two people in it.
 *
 * THE COMPOSER VERSUS THE NAV CAPSULE, WHICH IS THE ONE REAL LAYOUT PROBLEM ON
 * THIS SCREEN.
 *
 * The artboard sits its composer flush against the bottom of the frame and
 * shows no navigation at all — its thread hides the dock. Ours cannot: the nav
 * capsule belongs to the `(tabs)` navigator, it is rendered ABOVE every scene
 * in the group, and this route is a sibling of the four destinations rather
 * than a screen in its own stack. Nothing a screen can draw goes over it, and
 * the custom `NavBar` reads neither `tabBarStyle` nor the descriptors, so there
 * is no per-screen switch to throw from here either.
 *
 * So THE COMPOSER CLEARS IT, exactly as the lounge's chat segment does — the
 * same problem, and two screens in the group answering it two different ways
 * would be worse than either answer. The bar is lifted by `useDockReserveLess`,
 * which puts its content 16px clear of the capsule's top edge and leaves the
 * capsule floating over live ground it can actually blur. The lift collapses the
 * moment the keyboard opens, because the keyboard covers the capsule anyway and
 * a composer still holding that clearance would float in the middle of the
 * screen.
 *
 * (The alternative — hiding the capsule on this route — is the better end state
 * and it is a one-line change, but it lives in `nav-bar.tsx`, which this screen
 * does not own. It is written up in the report.)
 *
 * Three other things worth knowing before changing this:
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
 *  4. **The entrance is per-bubble, not per-screen.** The header lifts in as a
 *     module and the log staggers up from the newest message; because the list
 *     is inverted, index 0 is the bottom one. Same `useEntrance` call the
 *     lounge and Session logs make, so the two chat surfaces still cannot be
 *     told apart by how they arrive.
 *
 * The bubbles and the composer are `@/components/dm` components and are styled
 * there, not here. The artboard's call and video buttons are deliberately not
 * drawn: there is no call feature behind them, and chrome for a feature that
 * does not exist is worse than an incomplete header.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Search, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
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
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatNotice, LogStart, styles as kit } from '@/components/chat/bubble-kit';
import { DmAttachSheet, type AttachOption } from '@/components/dm/attach-sheet';
import { DmComposer } from '@/components/dm/composer';
import { MessageBubble } from '@/components/dm/message-bubble';
import { type MentionCandidate } from '@/components/dm/mention-picker';
import { DmRecordSheet, type VoiceNoteDraft } from '@/components/dm/record-sheet';
import { Avatar, CircleIconButton, Skeleton, useToast } from '@/components/ui';
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
import { useDockReserveLess } from '@/lib/dock';
import { useEntrance } from '@/lib/entrance';
import {
  Fonts,
  Radii,
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

/** The body gutter, shared with the inbox and with the bubble rows. */
const GUTTER = 18;

/** L725: the header avatar is one step down from the inbox's. */
const HEADER_AVATAR = 36;
/** L722 / L730: every circle in this header is the 44px glass chip. */
const CHIP = 44;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/**
 * The badge voice — 800, uppercase, widely tracked (L728). `Type.label` has the
 * case and the tracking at 600, which goes soft under a 15px name.
 */
const badge = (size: number, em: number): TextStyle => ({
  ...Type.heading(size),
  letterSpacing: tracking(size, em),
  textTransform: 'uppercase',
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

/**
 * Is the soft keyboard up?
 *
 * The composer's clearance over the floating nav capsule has to collapse while
 * the keyboard covers that capsule — see the note at the top of the file. This
 * is that condition.
 *
 * `will*` on iOS so the lift collapses in step with the keyboard's own
 * animation rather than a frame behind it; Android only emits `did*`. On
 * react-native-web neither fires, which is correct — there is no overlay
 * keyboard there and the lift should simply stay.
 *
 * A near-copy of the same hook in `lounge/[id].tsx`. Two chat surfaces in the
 * tab group now need it; the third one that does should promote it to a shared
 * module rather than making a third copy.
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setUp(true),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setUp(false),
    );

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return up;
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
    ({ item, index }: ListRenderItemInfo<Decorated>) => (
      <MessageBubble
        message={item.message}
        showHeader={item.showHeader}
        showStamp={item.showStamp}
        daySeparator={item.daySeparator}
        // Straight through from the list. The bubble is memoised and `index` is
        // stable for a given position, so threading it costs no re-renders that
        // the reordering itself would not already have caused.
        index={index}
        onOpenProfile={openProfile}
      />
    ),
    [openProfile],
  );

  // ---------------------------------------------------------------- entrance

  /*
    THE SCREEN NO LONGER ARRIVES AS ONE BLOCK.

    This was `useEnterStyle()` spread over an `Animated.View` wrapping the
    header, the log and the composer together — one opacity ramp for the whole
    scene, which is the "easy fade" the user asked to be rid of, and it was
    mount-driven besides. Now the header lifts in as a module and the bubbles
    stagger up out of the bottom of the log (see `renderItem`), so the thread
    ASSEMBLES instead of dissolving into view.

    Only the header takes this. The composer is left alone on purpose: it is an
    input the user may already be reaching for, and the skeleton and the
    notices below are things the user is WAITING on — none of those should be
    made to perform before they can be used.
  */
  const headerEnter = useEntrance({ kind: 'module' });

  /*
    `DmComposer` adds `Space.md` of its own under whatever it is handed, so the
    reservation goes in minus that step — the bar's content then ends exactly
    one dock reserve off the bottom, 16px clear of the capsule's top edge. Zero
    while the keyboard is up, which is when the capsule is behind it.

    This was `insets.bottom + Dock.reserve - Space.md`, which was arithmetically
    RIGHT and is only being rewritten because it was the lone caller that
    remembered the inset. `useDockReserveLess` is that same sum with no way to
    forget the addition, so the nine screens that got it wrong and this one that
    got it right now share a single definition.
  */
  const keyboardUp = useKeyboardUp();
  const dockLift = useDockReserveLess(Space.md);
  const composerLift = keyboardUp ? 0 : dockLift;

  // ---------------------------------------------------------------- render

  if (!conversationId) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
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
    /*
      No ground colour on the root. The ambient blobs are painted once behind
      the whole tab group and an opaque scene would cover them, leaving every
      translucent surface on this screen with nothing to show through it.
    */
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.flex}>
        <View style={styles.constrain}>
          {/*
            No hairline under this header, which is a change. Nocturne separates
            with light and glass rather than with rules, and the artboard's
            header (L721) carries no border — the log cannot scroll under it
            anyway, because the header is a flex sibling and not an overlay.

            `Animated.View` because it carries the module entrance. The search
            bar underneath is deliberately OUTSIDE it: that one is toggled by a
            press, and a control that lifted 10px every time it opened would be
            answering the tap with the screen's arrival animation.
          */}
          <Animated.View style={[styles.header, headerEnter]}>
            <CircleIconButton
              icon={ChevronLeft}
              size={CHIP}
              tone="surface"
              accessibilityLabel="Back to messages"
              onPress={router.back}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}${presence.label ? `, ${presence.label}` : ''}. Open profile`}
              onPress={openProfile}
              style={({ pressed }) => [
                styles.identity,
                pressed && { backgroundColor: C.surface },
              ]}>
              {/* The dot is the avatar's own punched hole (L726), not a second
                  mark beside the status word. */}
              <Avatar
                uri={other?.avatar_url}
                name={name}
                size={HEADER_AVATAR}
                presence={presence.live}
              />

              <View style={styles.identityText}>
                <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                  {name}
                </Text>
                {presence.label ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.status, { color: presence.live ? C.liveText : C.ink3 }]}>
                    {presence.label}
                  </Text>
                ) : handle ? (
                  <Text numberOfLines={1} style={[styles.handle, { color: C.ink3 }]}>
                    {handle}
                  </Text>
                ) : null}
              </View>
            </Pressable>

            <CircleIconButton
              icon={Search}
              size={CHIP}
              tone="surface"
              accessibilityLabel="Search this conversation"
              onPress={toggleSearch}
            />
          </Animated.View>

          {searchOpen ? (
            <View style={styles.searchBar}>
              {/*
                L738 makes this the glass pill — `surface` behind a `rule`
                hairline at a full radius — where it used to be a recessed well.
                Either way it is NOT `pressed()`: at 48px only the dark half of
                the inset pair lands on a dark ground and it reads as dirt. That
                was fixed once on the auth fields and must not come back.
              */}
              <View style={[styles.searchPill, { backgroundColor: C.surface, borderColor: C.rule }]}>
                <Search size={17} strokeWidth={2} color={C.ink3} />

                <TextInput
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search this conversation"
                  placeholderTextColor={C.ink3}
                  // The caret and the selection band are UI, not a live state —
                  // blue, matching the rebuilt chat composer.
                  selectionColor={C.pill}
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

                {/*
                  Inside the pill, as the artboard has it. A 44px target on a
                  36px-tall glyph box, pulled 6px into the pill's own padding so
                  the circle it makes stays centred in the cap.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close search"
                  onPress={toggleSearch}
                  style={({ pressed }) => [styles.searchClose, pressed && styles.dim]}>
                  <X size={16} strokeWidth={2} color={C.ink2} />
                </Pressable>
              </View>
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
            placeholder={handle ? `Message ${handle}` : 'Message'}
            sending={send.isPending}
            mentionPeople={mentionPeople}
            mentionScopeLabel="In this conversation"
            bottomInset={composerLift}
          />
        </View>
      </View>

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
          <Skeleton width={`${width}%`} height={44} radius={Radii.xl} />
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
    // L721: the header runs tighter than the body gutter, because four 44px
    // circles across a phone have no width to spare.
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: Space.md,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // L723: a pill-shaped target that fills with `surface` under the finger,
    // rather than the whole block dimming.
    paddingHorizontal: 6,
    borderRadius: Radii.pill,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tracking(15, -0.01),
  },
  status: {
    ...badge(9, 0.08),
    marginTop: 2,
  },
  handle: {
    ...Type.body(11.5),
    lineHeight: 15,
    marginTop: 1,
  },
  dim: {
    opacity: 0.6,
  },

  searchBar: {
    paddingHorizontal: GUTTER,
    paddingBottom: 10,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingLeft: 16,
    // The close target hangs off the right end, so the pill's own padding
    // stops early and the 44px box supplies the rest.
    paddingRight: 2,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  searchInput: {
    ...Type.body(15),
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    // Vertical padding rather than a fixed height: the pill's `minHeight` sets
    // the shape and a stretched field keeps the caret centred inside it.
    paddingVertical: Space.sm,
  },
  matchCount: {
    // A match count measures. Tabular figures.
    ...readout(12),
  },
  searchClose: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
