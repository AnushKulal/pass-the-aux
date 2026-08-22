/**
 * One message in a lounge or Session log, and the sheet its long-press opens.
 *
 * README §8 (Chat): 30px avatar carried inside its own 44px target, the name a
 * 44px target too, a timestamp in tabular figures, the body with @mentions in
 * accent at 600, then reaction chips at 44px and a dashed `+`.
 *
 * Both targets are grown with negative margins rather than by making the row
 * taller: a chat log is read as a column of text, and 44px of padding per line
 * would turn it into a list of cards.
 */

import * as Haptics from 'expo-haptics';
import { Plus, Trash2 } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui';
import type { ChatMessage } from '@/features/chat/queries';
import {
  Duration,
  Fonts,
  PointerEvents,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const AVATAR = 30;
/** Half the difference between the avatar and its 44px target. */
const AVATAR_SLOP = (TOUCH_TARGET - AVATAR) / 2;
/** Pulls a 44px name target back to the height of the text inside it. */
const NAME_INSET = 13;

/** Content, not iconography — the lucide-only rule governs UI affordances. */
const QUICK_REACTIONS = ['❤️', '🔥', '😂', '🎵', '👍', '😭'] as const;

/** `@mira`, `@sol_r`. Split, not replace, so the surrounding text survives. */
const MENTION = /(@[A-Za-z0-9_]{1,32})/g;

/**
 * `Type.readout` carries its `fontVariant` as a readonly tuple; RN's TextStyle
 * wants a mutable array. Restating it here is the whole fix.
 */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

export type MessageRowProps = {
  message: ChatMessage;
  /** First message of a run: shows avatar, name and time. */
  showHeader: boolean;
  /** Day label to print above this row, or null. */
  daySeparator: string | null;
  onLongPress: (message: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Avatar and name become targets onto the author's profile when supplied. */
  onOpenProfile?: (userId: string) => void;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The body, with handles lifted into accent at 600.
 *
 * Nested `<Text>` rather than a row of views, so a mention still wraps mid-line
 * with the words around it instead of becoming an unbreakable block.
 */
function Body({ text, color, mention }: { text: string; color: string; mention: string }) {
  const parts = useMemo(() => text.split(MENTION), [text]);

  return (
    <Text selectable style={[styles.body, { color }]}>
      {parts.map((part, index) =>
        // split() with one capture group puts the matches on the odd indices.
        index % 2 === 1 ? (
          <Text key={`${index}-${part}`} style={[styles.mention, { color: mention }]}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function MessageRowBase({
  message,
  showHeader,
  daySeparator,
  onLongPress,
  onToggleReaction,
  onOpenProfile,
}: MessageRowProps) {
  const C = useColors();
  const name = message.author?.display_name ?? message.author?.username ?? 'Someone';

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

  return (
    <View>
      {daySeparator ? (
        <View accessibilityRole="header" style={styles.daySeparator}>
          <View style={[styles.dayRule, { backgroundColor: C.rule }]} />
          <Text style={[styles.dayLabel, { color: C.ink3 }]}>{daySeparator}</Text>
          <View style={[styles.dayRule, { backgroundColor: C.rule }]} />
        </View>
      ) : null}

      <Pressable
        accessibilityLabel={`${name}, ${formatTime(message.createdAt)}. ${message.body}`}
        // Long press is the only way into the actions sheet, so it has to be an
        // announced action too — a screen reader cannot discover a gesture.
        accessibilityActions={
          message.pending ? undefined : [{ name: 'longpress', label: 'Message actions' }]
        }
        onAccessibilityAction={openActions}
        onLongPress={openActions}
        delayLongPress={350}
        style={({ pressed }) => [
          styles.row,
          showHeader && styles.rowLeading,
          pressed ? { backgroundColor: C.bgRecessed } : null,
          // Pending is carried by weight, not by a spinner: the text is already
          // readable and in place, it simply has not landed yet.
          message.pending && styles.rowPending,
        ]}>
        <View style={styles.gutter}>
          {showHeader ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${name}'s profile`}
              disabled={!onOpenProfile}
              onPress={openProfile}
              style={({ pressed }) => [styles.avatarTarget, pressed && styles.dim]}>
              <Avatar uri={message.author?.avatar_url} name={name} size={AVATAR} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.content}>
          {showHeader ? (
            <View style={styles.headerLine}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${name}'s profile`}
                disabled={!onOpenProfile}
                onPress={openProfile}
                style={({ pressed }) => [styles.nameTarget, pressed && styles.dim]}>
                <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
                  {name}
                </Text>
              </Pressable>

              <Text style={[styles.time, { color: C.ink3 }]}>{formatTime(message.createdAt)}</Text>
            </View>
          ) : null}

          <Body text={message.body} color={C.ink} mention={C.liveText} />

          <View style={styles.reactions}>
            {message.reactions.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                accessibilityRole="button"
                accessibilityState={{ selected: reaction.mine }}
                accessibilityLabel={`${reaction.emoji} ${reaction.count}${
                  reaction.mine ? ', including you' : ''
                }`}
                onPress={() => onToggleReaction(message.id, reaction.emoji)}
                style={[
                  styles.chip,
                  {
                    borderColor: reaction.mine ? C.live : C.rule2,
                    backgroundColor: reaction.mine ? C.liveWash : 'transparent',
                  },
                ]}>
                <Text style={styles.chipEmoji}>{reaction.emoji}</Text>
                <Text style={[styles.chipCount, { color: C.liveText }]}>{reaction.count}</Text>
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
                  { borderColor: pressed ? C.live : C.rule2 },
                ]}>
                <Plus size={18} color={C.ink3} strokeWidth={2} />
              </Pressable>
            )}
          </View>
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
            { backgroundColor: C.bg, borderTopColor: C.live, paddingBottom: insets.bottom },
            sheetStyle,
          ]}>
          <View style={[styles.sheetHead, { borderBottomColor: C.rule }]}>
            <View style={styles.sheetHeadText}>
              <Text style={[styles.sheetTitle, { color: C.ink }]}>MESSAGE</Text>
              <Text numberOfLines={1} style={[styles.sheetQuote, { color: C.ink3 }]}>
                {message?.body ?? ''}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.sheetClose, pressed && styles.dim]}>
              <Text style={[styles.sheetCloseLabel, { color: C.ink2 }]}>CLOSE</Text>
            </Pressable>
          </View>

          <View style={styles.sheetBody}>
            <Text style={[styles.kicker, { color: C.ink3 }]}>REACT</Text>

            <View style={styles.picker}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                  accessibilityState={{ selected: mine.has(emoji) }}
                  onPress={() => {
                    if (!message) return;
                    onReact(message.id, emoji);
                    onClose();
                  }}
                  style={[
                    styles.pickerButton,
                    {
                      borderColor: mine.has(emoji) ? C.live : C.rule2,
                      backgroundColor: mine.has(emoji) ? C.liveWash : 'transparent',
                    },
                  ]}>
                  <Text style={styles.pickerEmoji}>{emoji}</Text>
                </Pressable>
              ))}
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
                    borderColor: C.dangerBorder,
                    backgroundColor: pressed ? C.dangerWash : 'transparent',
                  },
                ]}>
                <Trash2 size={18} color={C.danger} strokeWidth={2} />
                <Text style={[styles.destructiveLabel, { color: C.danger }]}>DELETE MESSAGE</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.md,
  },
  dayRule: {
    flex: 1,
    height: Rule.hair,
  },
  dayLabel: {
    ...Type.label(11),
  },
  row: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  rowLeading: {
    marginTop: Space.xs,
  },
  rowPending: {
    opacity: 0.6,
  },
  dim: {
    opacity: 0.6,
  },
  gutter: {
    width: AVATAR,
    flexShrink: 0,
  },
  /** 30px of avatar inside 44px of target, without costing 14px of layout. */
  avatarTarget: {
    padding: AVATAR_SLOP,
    margin: -AVATAR_SLOP,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  nameTarget: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    justifyContent: 'center',
    marginVertical: -NAME_INSET,
    flexShrink: 1,
  },
  name: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.02),
  },
  time: {
    // A timestamp measures. Tabular figures, so a log of them holds its column.
    ...readout(11),
  },
  body: {
    ...Type.body(16),
  },
  mention: {
    fontFamily: Fonts.semibold,
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 8px minimum between adjacent tappables, on both axes.
    gap: Space.sm,
    marginTop: Space.xs,
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
    borderWidth: Rule.hair,
  },
  chipEmoji: {
    fontSize: 15,
    lineHeight: 20,
  },
  chipCount: {
    ...readout(13),
  },
  addChip: {
    height: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
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
    // The one 2px accent rule on a sheet: it says the surface arrived, and it
    // is the only elevation cue in a design with no shadows.
    borderTopWidth: Rule.major,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingLeft: Space.md,
    paddingRight: Space.xs,
    paddingTop: Space.md,
    paddingBottom: Space.sm + 2,
    borderBottomWidth: Rule.major,
  },
  sheetHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
  },
  sheetQuote: {
    ...Type.body(11),
  },
  sheetClose: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  sheetCloseLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
  sheetBody: {
    padding: Space.md,
    gap: Space.md,
  },
  kicker: {
    ...Type.label(10),
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
    borderWidth: Rule.hair,
  },
  pickerEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  destructive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  destructiveLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
});
