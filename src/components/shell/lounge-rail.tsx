/**
 * The lounge rail — the app's fixed left edge.
 *
 * 58px wide with a 2px right rule, it is the only navigation that survives
 * every screen: the AUX mark home, direct messages, then one tile per lounge
 * you belong to, then the dashed tile that makes a new one.
 *
 * It renders only once the profile gate has been passed; the gate lives in
 * `(tabs)/_layout`, which simply does not mount this component before then.
 */

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { MessageCircle, Plus } from 'lucide-react-native';
import { memo, useCallback, useEffect } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTotalUnread } from '@/features/dm';
import { useMyLounges, type LoungeSummary } from '@/features/lounges/queries';
import { Rule, Space, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Exported so the shell can reserve the same column width it paints. */
export const LOUNGE_RAIL_WIDTH = 58;

/** The 44pt floor rounded up to the rail's own grid. */
const TILE_TARGET = 46;
/** The visual inside the target. The 4px ring around it is the spacing rule. */
const TILE_VISUAL = 38;
/** The rail's own top/bottom padding, inside the safe area. */
const RAIL_PAD = 10;
const ICON_SIZE = 19;
const LOGO_SIZE = 34;

/** Half of the prototype's 2.4s `auxpulse`, reversed — full to .28 and back. */
const PULSE_MS = 1200;
const PULSE_MIN = 0.28;

const AUX_LOGO = require('../../../assets/images/aux-logo.png') as number;

/**
 * `Type.readout()` freezes its `fontVariant` as a readonly tuple, which RN's
 * `TextStyle.fontVariant` (a mutable `FontVariant[]`) will not take. Re-stating
 * it is the whole fix, and keeps the tabular figures the readout role exists
 * for.
 */
const TABULAR = { fontVariant: ['tabular-nums'] as NonNullable<TextStyle['fontVariant']> };
const readout = (size: number): TextStyle => ({ ...Type.readout(size), ...TABULAR });

export type LoungeRailProps = {
  /**
   * Unread direct messages, summed across conversations. `0` hides the badge.
   *
   * Optional, and normally left unset: the tile reads `useTotalUnread()` for
   * itself, which shares the inbox query key so the badge and the Messages
   * screen cost one fetch between them and can never disagree. Pass a number
   * only to override it (a screenshot, a test).
   */
  unreadCount?: number;
  /**
   * Overrides where the DM tile goes. Unset, it routes to the inbox — the tile
   * is the only way into Messages, so it cannot depend on a caller wiring it.
   */
  onOpenMessages?: () => void;
};

/**
 * A short mark for a lounge: the initials of up to three words, or the first
 * three letters of a single-word name. Never longer than three characters —
 * the tile is 38px and the type is 11px.
 */
export function loungeTag(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/* ------------------------------------------------------------------- pulse */

/**
 * The 3px accent bar on a live lounge's left edge.
 *
 * The pulse is the one piece of motion in this direction that loops, because
 * it reports a continuously-true fact rather than a transition. Under reduced
 * motion it holds at full opacity — the signal stays, the movement goes.
 */
function LivePulse({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(PULSE_MIN, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [opacity, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.liveBar, { backgroundColor: color }, style]} />;
}

/* -------------------------------------------------------------------- tile */

type LoungeTileProps = {
  id: string;
  name: string;
  live: boolean;
  onOpen: (id: string) => void;
};

const LoungeTile = memo(function LoungeTile({ id, name, live, onOpen }: LoungeTileProps) {
  const C = useColors();
  const open = useCallback(() => onOpen(id), [id, onOpen]);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={live ? `${name}, live` : name}
      style={styles.target}>
      {({ pressed }) => (
        <View
          style={[
            styles.visual,
            {
              borderColor: pressed ? C.ink : C.rule2,
              backgroundColor: pressed ? C.surface : 'transparent',
            },
          ]}>
          <Text style={[styles.tag, { color: pressed ? C.ink : C.ink2 }]} numberOfLines={1}>
            {loungeTag(name)}
          </Text>
          {live ? <LivePulse color={C.live} /> : null}
        </View>
      )}
    </Pressable>
  );
});

/* -------------------------------------------------------------------- rail */

function keyExtractor(item: LoungeSummary) {
  return item.lounge.id;
}

export function LoungeRail({ unreadCount, onOpenMessages }: LoungeRailProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: lounges } = useMyLounges();

  /*
    The rail is mounted for the whole session, so this doubles as the app's
    inbox warm-up: by the time the tile is tapped, Messages has rows to paint.
    An explicit `unreadCount` still wins, for callers that want to drive it.
  */
  const totalUnread = useTotalUnread();
  const unread = unreadCount ?? totalUnread;

  const openMessages = useCallback(() => {
    if (onOpenMessages) {
      onOpenMessages();
      return;
    }
    // `navigate`, not `push`: Messages is a screen of the tabs navigator, and
    // tapping the tile twice should land on it, not stack a second copy.
    router.navigate('/messages');
  }, [onOpenMessages, router]);

  const openLounge = useCallback(
    (id: string) => router.push({ pathname: '/lounge/[id]', params: { id } }),
    [router]
  );

  const renderLounge = useCallback(
    ({ item }: ListRenderItemInfo<LoungeSummary>) => (
      <LoungeTile
        id={item.lounge.id}
        name={item.lounge.name}
        live={item.activeSessions > 0}
        onOpen={openLounge}
      />
    ),
    [openLounge]
  );

  const empty = <Text style={[styles.emptyMark, { color: C.ink3 }]}>{'NO\nLOUNGES'}</Text>;

  const createTile = (
    <Pressable
      onPress={() => router.push('/lounge/create')}
      accessibilityRole="button"
      accessibilityLabel="Start a lounge"
      style={styles.target}>
      {({ pressed }) => (
        <View
          style={[styles.visual, styles.dashed, { borderColor: pressed ? C.liveText : C.rule3 }]}>
          <Plus size={18} color={pressed ? C.liveText : C.ink3} strokeWidth={2} />
        </View>
      )}
    </Pressable>
  );

  return (
    <View
      style={[
        styles.rail,
        {
          borderRightColor: C.rule,
          backgroundColor: C.bg,
          paddingTop: insets.top + RAIL_PAD,
          paddingBottom: insets.bottom + RAIL_PAD,
        },
      ]}>
      {/* Home. The mark sits on a literal black tile — the asset has a baked-in
          black ground, so any other colour behind it shows as a square. */}
      <Pressable
        onPress={() => router.navigate('/(tabs)')}
        accessibilityRole="button"
        accessibilityLabel="The Feed"
        style={styles.target}>
        <View style={[styles.visual, styles.mark, { borderColor: C.live }]}>
          <Image
            source={AUX_LOGO}
            style={styles.logo}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        </View>
      </Pressable>

      <Pressable
        onPress={openMessages}
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
        style={styles.target}>
        {({ pressed }) => (
          <View style={[styles.visual, { borderColor: pressed ? C.ink : C.rule2 }]}>
            <MessageCircle size={ICON_SIZE} color={pressed ? C.ink : C.ink2} strokeWidth={2} />
            {/* Inset at the tile's top-right corner, per §5. The accent is
                earned: an unread badge is one of the few things in DMs the
                reserved colour is actually for. */}
            {unread > 0 ? (
              <View style={[styles.badge, { backgroundColor: C.live }]}>
                <Text style={[styles.badgeText, { color: C.onLive }]} numberOfLines={1}>
                  {unread > 99 ? '99+' : unread}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </Pressable>

      <View style={[styles.divider, { backgroundColor: C.rule2 }]} />

      <FlatList
        data={lounges ?? []}
        keyExtractor={keyExtractor}
        renderItem={renderLounge}
        ListEmptyComponent={empty}
        ListFooterComponent={createTile}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        style={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: LOUNGE_RAIL_WIDTH,
    flexShrink: 0,
    // 2px: the rail is a major boundary, and separation in this direction is
    // made of rules rather than shadows.
    borderRightWidth: Rule.major,
    alignItems: 'center',
    gap: Space.sm,
  },
  /** 46 square clears the 44pt floor; the 8px gaps are the separation rule. */
  target: {
    width: TILE_TARGET,
    height: TILE_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visual: {
    width: TILE_VISUAL,
    height: TILE_VISUAL,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    borderWidth: Rule.major,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  dashed: {
    borderStyle: 'dashed',
  },
  tag: {
    ...Type.heading(11),
    letterSpacing: 0.22,
  },
  liveBar: {
    position: 'absolute',
    left: -Rule.hair,
    top: -Rule.hair,
    bottom: -Rule.hair,
    width: 3,
  },
  badge: {
    position: 'absolute',
    right: -Rule.hair,
    top: -Rule.hair,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...readout(10),
    lineHeight: 15,
  },
  divider: {
    width: 24,
    height: Rule.major,
  },
  list: {
    flex: 1,
    alignSelf: 'stretch',
  },
  listContent: {
    alignItems: 'center',
    gap: Space.sm,
    paddingBottom: Space.sm,
  },
  emptyMark: {
    ...Type.heading(10),
    lineHeight: 13,
    letterSpacing: 0.4,
    textAlign: 'center',
    paddingHorizontal: 2,
    paddingVertical: Space.xs,
  },
});
