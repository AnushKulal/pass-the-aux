import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { AudioLines, TvMinimalPlay } from 'lucide-react-native';
import { memo, useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar, AuxButton, BLURHASH_SURFACE, GlassCard, ProgressBar } from '@/components/ui';
import { livePositionMs } from '@/features/presence/presence-client';
import type { FeedEntry } from '@/features/presence/use-lounge-presence';
import { serverNow } from '@/lib/clock';
import { Colors, Duration, Radius, Space, Type } from '@/lib/theme';

const AVATAR_SIZE = 40;
const ARTWORK_SIZE = 56;
const PROVIDER_BADGE = 18;

/**
 * ProgressBar rounds its fill to whole percent, so on a three-minute track the
 * bar only has about two seconds of resolution. Ticking faster than this would
 * re-render the whole Feed for a width that cannot change.
 */
const TICK_MS = 1_000;

// ------------------------------------------------------------- the shared clock

/**
 * One timer for the entire Feed.
 *
 * Every card advances its own bar between presence beats, but N cards with N
 * intervals is N wakeups a second on a phone. They all want the same answer to
 * the same question — what time is it — so they share one timer, and it stops
 * completely when the last card unmounts.
 */
const tickListeners = new Set<(nowMs: number) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribeTick(listener: (nowMs: number) => void): () => void {
  tickListeners.add(listener);

  if (ticker === null) {
    ticker = setInterval(() => {
      const now = serverNow();
      for (const notify of tickListeners) notify(now);
    }, TICK_MS);
  }

  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

function useServerNow(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => subscribeTick(setNow), []);
  return now;
}

// -------------------------------------------------------------------- the card

export type NowPlayingCardProps = {
  entry: FeedEntry;
};

function NowPlayingCardBase({ entry }: NowPlayingCardProps) {
  const router = useRouter();
  const nowMs = useServerNow();

  const isLive = entry.roomId !== null;
  const title = entry.trackTitle ?? 'Getting the aux ready';
  const subtitle = [entry.artist, entry.loungeName].filter(Boolean).join(' · ');

  const progress =
    entry.durationMs > 0 ? livePositionMs(entry, nowMs) / entry.durationMs : 0;

  /*
    Provider is signalled by shape, not colour. Spotify green sits a hair off
    Colors.accent and YouTube red a hair off Colors.danger, and both of those
    tokens already mean something specific in this app — reusing them for a
    brand would make "live" and "leave" ambiguous. The waveform reads as
    streaming audio, the screen-with-a-play-head reads as video.
  */
  const ProviderIcon = entry.provider === 'youtube' ? TvMinimalPlay : AudioLines;
  const providerName =
    entry.provider === 'youtube' ? 'YouTube' : entry.provider === 'spotify' ? 'Spotify' : null;

  const summary = [
    entry.trackTitle
      ? `${entry.displayName} is playing ${entry.trackTitle}`
      : `${entry.displayName} is in a Session`,
    entry.artist ? `by ${entry.artist}` : null,
    `in ${entry.loungeName}`,
    providerName ? `on ${providerName}` : null,
    isLive ? 'live now' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const openRoom = useCallback(() => {
    if (entry.roomId === null) return;
    // Object form rather than a template literal: it stays valid under typed
    // routes regardless of whether the route types have been generated yet.
    router.push({ pathname: '/room/[id]', params: { id: entry.roomId } });
  }, [entry.roomId, router]);

  return (
    <GlassCard padded={false}>
      <View style={styles.row}>
        <Avatar
          uri={entry.avatarUrl}
          name={entry.displayName}
          size={AVATAR_SIZE}
          live={isLive}
        />

        <View style={styles.artwork}>
          <Image
            source={entry.artworkUrl ? { uri: entry.artworkUrl } : null}
            style={styles.art}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_SURFACE }}
            // FlatList recycles rows; without this the previous listener's
            // artwork stays on screen until the new one has decoded.
            recyclingKey={entry.userId}
            transition={Duration.base}
            accessible={false}
          />

          <View style={styles.providerBadge}>
            <ProviderIcon size={11} color={Colors.muted} />
          </View>
        </View>

        {/* Grouped for screen readers, but not `accessible` on the whole card —
            that would swallow the Join button on iOS. */}
        <View accessible accessibilityLabel={summary} style={styles.info}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
          <ProgressBar progress={progress} height={3} style={styles.progress} />
        </View>

        {/* Wrapped because AuxButton sets `alignSelf: 'flex-start'` on itself,
            which would otherwise beat this row's `alignItems: 'center'` and
            pin the button to the top of the card. */}
        {isLive ? (
          <View>
            <AuxButton label="Join" onPress={openRoom} variant="accent" size="sm" />
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}

/**
 * Memoised because presence re-emits the whole lounge roster on every sync:
 * one person changing song must not re-render every other row in the Feed.
 */
export const NowPlayingCard = memo(NowPlayingCardBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Space.md, not Space.sm: the live Avatar's halo expands 6px past its frame
    // and GlassCard clips its overflow, so it needs room to breathe.
    padding: Space.md,
    gap: Space.sm,
  },
  artwork: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
  },
  art: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
  },
  providerBadge: {
    position: 'absolute',
    right: -Space.xs,
    bottom: -Space.xs,
    width: PROVIDER_BADGE,
    height: PROVIDER_BADGE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  info: {
    flex: 1,
    flexShrink: 1,
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
  progress: {
    marginTop: Space.xs,
  },
});
