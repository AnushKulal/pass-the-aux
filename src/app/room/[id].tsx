/**
 * The Session. This is the party.
 *
 * Structural rule that must not be broken: `<YouTubePlayerHost />` is mounted
 * exactly once, here, and stays mounted for as long as the room is open — even
 * when the active provider is Spotify. A listener whose Spotify device dies
 * mid-Session falls back to YouTube by re-pointing the adapter, and a remount
 * at that moment would mean a black WebView booting from scratch instead of
 * audio resuming in the next second.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Radio, Users } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AddTrackSheet } from '@/components/room/add-track-sheet';
import { NowPlaying } from '@/components/room/now-playing';
import { ParticipantStrip } from '@/components/room/participant-strip';
import { QueueList } from '@/components/room/queue-list';
import { TransportControls } from '@/components/room/transport-controls';
import { EmptyState, Screen, SheetTabs, Skeleton, useToast, type SheetTab } from '@/components/ui';
import { RoomChat } from '@/features/chat';
import {
  useLounge,
  useQueue,
  useRequestAux,
  useRoomParticipants,
  useTransport,
} from '@/features/rooms/queries';
import { useRoomSync } from '@/features/rooms/use-room-sync';
import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { usePlayback } from '@/playback/store';
import { YouTubePlayerHost } from '@/playback/youtube-player-host';

const TABS: SheetTab[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'chat', label: 'Chat' },
];

/** How long the "Requested" latch holds before the guest may ask again. */
const REQUEST_COOLDOWN_MS = 60_000;

export default function RoomScreen() {
  // Required-property shape, not optional: expo-router constrains the generic to
  // Record<string, string | string[]>, which an optional field does not satisfy.
  // The runtime guard still stands — a malformed deep link has no id.
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

  const toast = useToast();
  const { room, track, userId, isHost, isLoading, error, resync } = useRoomSync(roomId);

  const lounge = useLounge(room?.lounge_id ?? null);
  const queue = useQueue(roomId);
  const participants = useRoomParticipants(roomId);
  const transport = useTransport(roomId);
  const requestAux = useRequestAux(roomId, room?.lounge_id ?? null);

  const timeline = usePlayback((state) => state.timeline);
  const driftMs = usePlayback((state) => state.driftMs);
  const playbackError = usePlayback((state) => state.error);
  const provider = usePlayback((state) => state.adapter?.provider ?? null);

  const [tab, setTab] = useState<string>('queue');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (requestTimer.current) clearTimeout(requestTimer.current);
    },
    []
  );

  /**
   * Android hardware back. The expanded sheet is a layer the user opened, so it
   * is what back should close — falling straight out of the Session would be a
   * surprise, and it would stop the music for them.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // The add-track modal owns its own back handling via onRequestClose.
      if (addVisible) return false;
      if (sheetExpanded) {
        setSheetExpanded(false);
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [addVisible, sheetExpanded]);

  const queueLength = queue.data?.length ?? 0;
  const participantCount = participants.data?.length ?? 0;
  const hostName =
    participants.data?.find((person) => person.userId === room?.host_id)?.displayName ?? null;

  const handlePlayPause = useCallback(() => {
    if (!room) return;

    if (room.is_playing) {
      transport.pause.mutate();
      return;
    }
    // Paused mid-track: resume slides `started_at_ms` forward by the pause
    // duration, so everyone lands back on the same second.
    if (room.track_id && room.paused_at_ms != null) {
      transport.resume.mutate();
      return;
    }
    // Nothing loaded yet — pull the head of the queue.
    transport.advance.mutate();
  }, [room, transport]);

  const handleSkip = useCallback(() => {
    transport.advance.mutate();
  }, [transport]);

  const handleSeek = useCallback(
    (positionMs: number) => {
      transport.seek.mutate(positionMs);
    },
    [transport]
  );

  const handleRequestAux = useCallback(() => {
    requestAux.mutate(undefined, {
      onSuccess: () => {
        setRequestSent(true);
        toast.show('Asked for the aux in chat', 'success');
        requestTimer.current = setTimeout(() => setRequestSent(false), REQUEST_COOLDOWN_MS);
      },
      onError: (mutationError) => {
        toast.show(
          mutationError instanceof Error ? mutationError.message : 'Could not send that.',
          'error'
        );
      },
    });
  }, [requestAux, toast]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const openAdd = useCallback(() => setAddVisible(true), []);
  const closeAdd = useCallback(() => setAddVisible(false), []);

  /**
   * Created once per render but always at the same position in the tree, in
   * both the expanded and compact layouts, so React reconciles rather than
   * remounts it. See the file header.
   */
  const media = useMemo(
    () => <YouTubePlayerHost visible={provider === 'youtube' && !sheetExpanded} />,
    [provider, sheetExpanded]
  );

  if (error && !room) {
    return (
      <Screen title="Session" onBack={handleBack}>
        <EmptyState
          icon={Radio}
          title="This Session is not open to you"
          description="It may have ended, or it lives in a lounge you have not joined."
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={lounge.data?.name ?? room?.name ?? 'Session'}
      onBack={handleBack}
      right={<CountPill count={participantCount} />}>
      <View style={styles.body}>
        <NowPlaying
          media={media}
          showMedia={provider === 'youtube' && !sheetExpanded}
          compact={sheetExpanded}
          track={track}
          timeline={timeline}
          isLoading={isLoading}
          driftMs={driftMs}
          onResync={resync}
          onSeek={isHost ? handleSeek : undefined}
          errorMessage={playbackError?.message ?? null}
        />

        <TransportControls
          isHost={isHost}
          isPlaying={room?.is_playing === true}
          canPlay={Boolean(room?.track_id) || queueLength > 0}
          canSkip={Boolean(room?.track_id) || queueLength > 0}
          isBusy={transport.isBusy}
          onPlayPause={handlePlayPause}
          onSkip={handleSkip}
          onRequestAux={handleRequestAux}
          requestSent={requestSent}
          hostName={hostName}
        />

        {sheetExpanded ? null : (
          <ParticipantStrip roomId={roomId} hostId={room?.host_id ?? null} currentUserId={userId} />
        )}

        <View style={[styles.sheet, sheetExpanded && styles.sheetExpanded]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sheetExpanded ? 'Collapse the queue and chat' : 'Expand the queue and chat'}
            accessibilityState={{ expanded: sheetExpanded }}
            onPress={() => setSheetExpanded((value) => !value)}
            style={styles.grabberTarget}>
            <View style={styles.grabber} />
          </Pressable>

          <View style={styles.sheetHeader}>
            <View style={styles.tabs}>
              <SheetTabs tabs={TABS} active={tab} onChange={setTab} />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a track to the queue"
              onPress={openAdd}
              style={({ pressed }) => [styles.add, pressed && styles.addPressed]}>
              <Plus size={22} color={Colors.bg} />
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            {tab === 'queue' ? (
              <QueueList
                roomId={roomId}
                isHost={isHost}
                currentUserId={userId}
                onAddTrack={openAdd}
              />
            ) : room ? (
              <RoomChat roomId={room.id} loungeId={room.lounge_id} />
            ) : (
              <View style={styles.chatSkeleton}>
                <Skeleton width="80%" height={44} radius={Radius.md} />
                <Skeleton width="60%" height={44} radius={Radius.md} />
                <Skeleton width="72%" height={44} radius={Radius.md} />
              </View>
            )}
          </View>
        </View>
      </View>

      <AddTrackSheet roomId={roomId} visible={addVisible} onClose={closeAdd} />
    </Screen>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`${count} ${count === 1 ? 'person' : 'people'} in this Session`}
      style={styles.pill}>
      <Users size={16} color={Colors.muted} />
      <Text style={styles.pillText}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: Space.md,
    paddingTop: Space.sm,
  },
  sheet: {
    flex: 1,
    minHeight: 180,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Space.md,
    paddingBottom: Space.sm,
    gap: Space.sm,
  },
  /** Expanded is just "take the space the artwork gave up". */
  sheetExpanded: {
    flex: 1,
  },
  grabberTarget: {
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  tabs: {
    flex: 1,
  },
  add: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Accent means "go" — adding to the queue is the one action every guest has.
    backgroundColor: Colors.accent,
  },
  addPressed: {
    opacity: 0.75,
  },
  sheetBody: {
    flex: 1,
  },
  chatSkeleton: {
    gap: Space.md,
    paddingTop: Space.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillText: {
    ...Type.label,
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
});
