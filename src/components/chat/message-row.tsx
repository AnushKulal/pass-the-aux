/**
 * One message in a lounge or Session log, and the sheet its long-press opens.
 *
 * This log used to be a flat Discord-style row while the DM thread was a bubble
 * column — two chat surfaces in one app that did not look like each other. It
 * now renders through `./bubble-kit`, the same drawing the DM thread uses: your
 * words on the accent against the right edge, everyone else's on a raised
 * `surface` bubble against the left, with the identity line above the first of
 * each run.
 *
 * What is NOT shared is what only a lounge has: reaction chips under the
 * bubble, and the actions sheet the long press opens.
 */

import * as Haptics from 'expo-haptics';
import { Plus, Trash2 } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { BackHandler, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Bubble,
  BubbleBody,
  BubbleIdentity,
  BubbleStamp,
  DaySeparator,
  readout,
  styles as kit,
  type BubbleTone,
} from '@/components/chat/bubble-kit';
import type { ChatMessage } from '@/features/chat/queries';
import {
  Duration,
  Fonts,
  PointerEvents,
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

/** Content, not iconography — the lucide-only rule governs UI affordances. */
const QUICK_REACTIONS = ['❤️', '🔥', '😂', '🎵', '👍', '😭'] as const;

export type MessageRowProps = {
  message: ChatMessage;
  /** The viewer wrote it: the accent fill and the right edge. */
  mine: boolean;
  /** First message of a run: draws the identity line. */
  showHeader: boolean;
  /** Last message of a run: draws the stamp. */
  showStamp?: boolean;
  /** Day label to print above this row, or null. */
  daySeparator: string | null;
  onLongPress: (message: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Avatar and name become targets onto the author's profile when supplied. */
  onOpenProfile?: (userId: string) => void;
};

function MessageRowBase({
  message,
  mine,
  showHeader,
  showStamp = true,
  daySeparator,
  onLongPress,
  onToggleReaction,
  onOpenProfile,
}: MessageRowProps) {
  const C = useColors();
  const name = message.author?.display_name ?? message.author?.username ?? 'Someone';
  const tone: BubbleTone = mine ? 'fill' : 'surface';

  const openActions = useCallback(() => {
    // A pending message has no server id yet, so neither reacting nor deleting
    // could succeed — the sheet would only offer actions that fail.
    if (message.pending) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress(message);
  }, [message, onLongPress]);

  const openProfile = useCallback(() => {
    onOpenProfile?.(message.userId);
  }, [onOpenProfile, message.userId]);

  const align = mine ? kit.alignEnd : kit.alignStart;

  return (
    <View>
      {daySeparator ? <DaySeparator label={daySeparator} /> : null}

      {showHeader && !mine ? (
        <BubbleIdentity
          name={name}
          avatarUrl={message.author?.avatar_url}
          onPress={onOpenProfile ? openProfile : undefined}
        />
      ) : null}

      <Pressable
        accessible={false}
        // Long press is the only way into the actions sheet, so it has to be an
        // announced action too — a screen reader cannot discover a gesture.
        accessibilityActions={
          message.pending ? undefined : [{ name: 'longpress', label: 'Message actions' }]
        }
        onAccessibilityAction={openActions}
        onLongPress={openActions}
        delayLongPress={350}
        style={[
          kit.row,
          align,
          showHeader && kit.rowLeading,
          // Pending is carried by weight, not by a spinner: the text is already
          // readable and in place, it simply has not landed yet.
          message.pending && kit.pending,
        ]}>
        <View style={[kit.column, align]}>
          <Bubble mine={mine} tone={tone}>
            <BubbleBody text={message.body} tone={tone} />
          </Bubble>

          {/*
            Only drawn once there is something to draw. A 44px add-chip under
            every single message doubles the height of a log to offer an action
            almost nobody takes on almost every line; the FIRST reaction comes
            from the long press, which is already the only way to the sheet.
          */}
          {message.reactions.length > 0 ? (
            <View style={[styles.reactions, align]}>
              {message.reactions.map((reaction) => (
                <Pressable
                  key={reaction.emoji}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reaction.mine }}
                  accessibilityLabel={`${reaction.emoji} ${reaction.count}${
                    reaction.mine ? ', including you' : ''
                  }`}
                  onPress={() => onToggleReaction(message.id, reaction.emoji)}
                  style={({ pressed }) => [
                    styles.chip,
                    reaction.mine
                      ? { backgroundColor: pressed ? C.liveText : C.live }
                      : {
                          backgroundColor: pressed ? C.surface : C.chip,
                          borderWidth: Rule.hair,
                          borderColor: C.rule,
                        },
                  ]}>
                  <Text style={styles.chipEmoji}>{reaction.emoji}</Text>
                  <Text style={[styles.chipCount, { color: reaction.mine ? C.onLive : C.ink2 }]}>
                    {reaction.count}
                  </Text>
                </Pressable>
              ))}

              {/* Dashed, because it is an opening rather than a value: the only
                  control in the log that is not yet a reaction. */}
              {message.pending ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a reaction"
                  onPress={openActions}
                  style={({ pressed }) => [
                    styles.addChip,
                    { borderColor: pressed ? C.rule3 : C.rule2 },
                  ]}>
                  <Plus size={17} color={C.ink3} strokeWidth={2} />
                </Pressable>
              )}
            </View>
          ) : null}

          {showStamp || message.pending ? (
            <BubbleStamp iso={message.createdAt} pending={message.pending} />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/**
 * Rows re-render only when their own message object is replaced — a send being
 * confirmed or a reaction toggling — never because a sibling arrived.
 */
export const MessageRow = memo(MessageRowBase);

export type MessageActionsSheetProps = {
  /** The message under action, or null when the sheet is closed. */
  message: ChatMessage | null;
  canDelete: boolean;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
};

/**
 * React, or delete.
 *
 * DELETE is a `live` OUTLINE, not a fill. There is one alarm colour in this
 * palette and the fill is spoken for; an outline says "destructive" without
 * claiming "live".
 */
export function MessageActionsSheet({
  message,
  canDelete,
  onClose,
  onReact,
  onDelete,
}: MessageActionsSheetProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const open = message !== null;

  const reduced = useReducedMotion();
  const rise = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      rise.value = open ? 1 : 0;
      return;
    }
    rise.value = withTiming(open ? 1 : 0, { duration: open ? Duration.sheet : Duration.scrim });
  }, [open, reduced, rise]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  useEffect(() => {
    if (!open || Platform.OS !== 'android') return;
    /*
      Modal's onRequestClose already answers the hardware back button, but this
      sheet is often mounted inside the room's bottom sheet, which installs its
      own BackHandler. Subscribing here registers later and therefore runs
      first, so back closes the actions sheet instead of the whole Session.
    */
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const mine = useMemo(
    () =>
      new Set((message?.reactions ?? []).filter((entry) => entry.mine).map((entry) => entry.emoji)),
    [message],
  );

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close message actions"
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: C.scrim }]}
      />

      <View style={[styles.sheetDock, PointerEvents.boxNone]}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: C.bg, paddingBottom: insets.bottom + Space.md },
            dropped(C, 'lg'),
            sheetStyle,
          ]}>
          <View style={styles.grabberSlot}>
            <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
          </View>

          <View style={styles.sheetHead}>
            <View style={styles.sheetHeadText}>
              <Text style={[styles.sheetTitle, { color: C.ink }]}>Message</Text>
              <Text numberOfLines={1} style={[styles.sheetQuote, { color: C.ink3 }]}>
                {message?.body ?? ''}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeTile,
                { backgroundColor: pressed ? C.surface2 : C.surface },
                raised(C),
              ]}>
              <Text style={[styles.closeLabel, { color: C.ink2 }]}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <Text style={[styles.kicker, { color: C.ink3 }]}>React</Text>

            <View style={styles.picker}>
              {QUICK_REACTIONS.map((emoji) => {
                const selected = mine.has(emoji);
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${emoji}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      if (!message) return;
                      onReact(message.id, emoji);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.pickerButton,
                      selected
                        ? { backgroundColor: C.live }
                        : { backgroundColor: pressed ? C.surface2 : C.surface },
                      selected ? null : raised(C),
                    ]}>
                    <Text style={styles.pickerEmoji}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>

            {canDelete ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete message"
                onPress={() => {
                  if (!message) return;
                  onDelete(message.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.destructive,
                  {
                    borderColor: C.live,
                    backgroundColor: pressed ? C.liveWash : 'transparent',
                  },
                ]}>
                <Trash2 size={17} color={C.liveText} strokeWidth={2} />
                <Text style={[styles.destructiveLabel, { color: C.liveText }]}>Delete message</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 8px minimum between adjacent tappables, on both axes.
    gap: Space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs + 1,
    /*
      A real 44px target, not a 32px chip grown by a 6px hitSlop. Slop wider
      than half the 8px gap made neighbouring chips' touch rects overlap, and
      the topmost sibling won — so a tap in the gap fired the wrong reaction.
    */
    height: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    paddingHorizontal: 11,
    borderRadius: Radii.md,
  },
  chipEmoji: {
    fontSize: 15,
    lineHeight: 20,
  },
  chipCount: {
    ...readout(12),
  },
  addChip: {
    height: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
    borderStyle: 'dashed',
  },

  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheetDock: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: SheetMetrics.radius,
    borderTopRightRadius: SheetMetrics.radius,
  },
  grabberSlot: {
    paddingTop: Space.md + 2,
    alignItems: 'center',
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: SheetMetrics.grabberH / 2,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  sheetHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetTitle: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.025),
  },
  sheetQuote: {
    ...Type.body(12),
  },
  closeTile: {
    minHeight: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radii.md,
  },
  closeLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 16,
  },
  sheetBody: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.md,
    gap: Space.md,
  },
  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flexWrap: 'wrap',
  },
  pickerButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
  },
  pickerEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  destructive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
    minHeight: 52,
    marginTop: Space.xs,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.button,
    borderWidth: Rule.hair,
  },
  destructiveLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
  },
});
