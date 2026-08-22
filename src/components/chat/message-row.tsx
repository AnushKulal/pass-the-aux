import * as Haptics from 'expo-haptics';
import { SmilePlus, Trash2, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { BackHandler, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, GlassCard } from '@/components/ui';
import type { ChatMessage } from '@/features/chat/queries';
import { Colors, PointerEvents, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';

const AVATAR = 36;
/** Gutter that keeps grouped continuation lines flush with the author's name. */
const GUTTER = AVATAR + Space.md;

/** Content, not iconography — the lucide-only rule governs UI affordances. */
const QUICK_REACTIONS = ['❤️', '🔥', '😂', '🎵', '👍', '😭'] as const;

export type MessageRowProps = {
  message: ChatMessage;
  /** First message of a run: shows avatar, name and time. */
  showHeader: boolean;
  /** Day label to print above this row, or null. */
  daySeparator: string | null;
  onLongPress: (message: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function MessageRowBase({
  message,
  showHeader,
  daySeparator,
  onLongPress,
  onToggleReaction,
}: MessageRowProps) {
  const name = message.author?.display_name ?? message.author?.username ?? 'Someone';

  const openActions = useCallback(() => {
    // A pending message has no server id yet, so neither reacting nor deleting
    // could succeed — the sheet would only offer actions that fail.
    if (message.pending) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress(message);
  }, [message, onLongPress]);

  return (
    <View style={styles.cell}>
      {daySeparator ? (
        <View accessibilityRole="header" style={styles.daySeparator}>
          <View style={styles.dayRule} />
          <Text style={styles.dayLabel}>{daySeparator}</Text>
          <View style={styles.dayRule} />
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
          pressed && styles.rowPressed,
          // Pending is carried by weight, not by a spinner: the text is already
          // readable and in place, it simply has not landed yet.
          message.pending && styles.rowPending,
        ]}>
        <View style={styles.gutter}>
          {showHeader ? <Avatar uri={message.author?.avatar_url} name={name} size={AVATAR} /> : null}
        </View>

        <View style={styles.content}>
          {showHeader ? (
            <View style={styles.headerLine}>
              <Text numberOfLines={1} style={styles.name}>
                {name}
              </Text>
              <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
            </View>
          ) : null}

          <Text selectable style={styles.body}>
            {message.body}
          </Text>

          {message.reactions.length > 0 ? (
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
                  style={[styles.chip, reaction.mine && styles.chipMine]}>
                  <Text style={styles.chipEmoji}>{reaction.emoji}</Text>
                  <Text style={styles.chipCount}>{reaction.count}</Text>
                </Pressable>
              ))}
            </View>
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

export function MessageActionsSheet({
  message,
  canDelete,
  onClose,
  onReact,
  onDelete,
}: MessageActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const open = message !== null;

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
      new Set(
        (message?.reactions ?? []).filter((entry) => entry.mine).map((entry) => entry.emoji),
      ),
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
        style={styles.scrim}
      />

      <View
        style={[styles.sheetDock, { paddingBottom: insets.bottom + Space.lg }, PointerEvents.boxNone]}>
        <GlassCard style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text numberOfLines={2} style={styles.sheetQuote}>
              {message?.body ?? ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.sheetClose}>
              <X size={20} color={Colors.muted} strokeWidth={1.6} />
            </Pressable>
          </View>

          <View style={styles.picker}>
            <SmilePlus size={18} color={Colors.muted} strokeWidth={1.6} />
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
                style={[styles.pickerButton, mine.has(emoji) && styles.pickerButtonActive]}>
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
              style={styles.destructive}>
              <Trash2 size={18} color={Colors.danger} strokeWidth={1.6} />
              <Text style={styles.destructiveLabel}>Delete message</Text>
            </Pressable>
          ) : null}
        </GlassCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cell: {
    paddingHorizontal: Space.lg,
  },
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.lg,
  },
  dayRule: {
    flex: 1,
    // A true hairline, so the rule reads as a measurement mark rather than a
    // divider bar — the day label is what the eye should land on.
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  dayLabel: {
    // The date is a coordinate on the log, not prose: mono, uppercase, tracked.
    ...Type.monoLabel,
    color: Colors.muted,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: Space.xs,
    borderRadius: Radius.md,
  },
  rowLeading: {
    marginTop: Space.md,
  },
  rowPressed: {
    // Glass rather than a solid step, so the press wash tints with whatever
    // bloom is behind the log instead of punching a grey hole in it.
    backgroundColor: Colors.glass,
  },
  rowPending: {
    opacity: 0.6,
  },
  gutter: {
    width: GUTTER,
    paddingRight: Space.md,
  },
  content: {
    flex: 1,
    gap: Space.xs,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.sm,
  },
  name: {
    ...Type.label,
    color: Colors.text,
    flexShrink: 1,
  },
  time: {
    // Every number that MEASURES is mono. A timestamp measures.
    ...Type.mono,
    color: Colors.muted,
  },
  body: {
    ...Type.body,
    color: Colors.text,
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
    gap: Space.xs,
    /*
      A real 44px target, not a 32px chip grown by a 6px hitSlop. Slop wider
      than half the 8px gap made neighbouring chips' touch rects overlap, and
      the topmost sibling won — so a tap in the gap fired the wrong reaction.
    */
    height: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipMine: {
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.primary,
  },
  chipEmoji: {
    fontSize: 14,
    lineHeight: 18,
  },
  chipCount: {
    // A tally. Mono, like every other count in the app.
    ...Type.mono,
    color: Colors.text,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.scrim,
  },
  sheetDock: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Space.lg,
  },
  sheet: {
    gap: Space.lg,
    // Sheet radius, not card radius.
    borderRadius: Radius.xl,
    // Capped like the lounge menu's card: a full-window action sheet on
    // desktop web strands the buttons at the edges of the screen.
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
  },
  sheetQuote: {
    ...Type.body,
    color: Colors.muted,
    flex: 1,
  },
  sheetClose: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    marginTop: -Space.md,
    marginRight: -Space.md,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceRaised,
  },
  pickerEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  destructive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    // A 12%-alpha wash of Colors.danger keeps its text at 4.5:1 on glass, which
    // a solid Colors.danger fill could not. No token exists for the wash.
    backgroundColor: 'rgba(242, 101, 126, 0.12)',
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  destructiveLabel: {
    ...Type.bodyStrong,
    color: Colors.danger,
  },
});
