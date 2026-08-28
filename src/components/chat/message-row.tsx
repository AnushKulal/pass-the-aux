/**
 * One message in a lounge or Session log, and the sheet its long-press opens.
 *
 * From `design/nocturne/aux-nocturne.dc.html` L465–L476 (lounge) and
 * L1253–L1264 (Session). The two are the same drawing at two paddings.
 *
 * THIS ROW IS A CARD AGAIN, NOT A BUBBLE.
 *
 * It rendered through `./bubble-kit` as a bubble column, unified with the DM
 * thread, because the previous direction drew both surfaces the same way.
 * Nocturne does not: it keeps the bubble column for the thread, where two
 * people are talking and the edge a bubble hugs names the speaker outright, and
 * draws a lounge as a list of glass cards, each one carrying its own avatar,
 * name and time. Six speakers is where a bubble column stops being readable,
 * and a lounge routinely has six.
 *
 * WHAT MARKS YOUR OWN MESSAGE, AND WHY IT IS BLUE.
 *
 * The artboards mark nothing — every card is identical and you find yourself by
 * reading names. That is one speaker too few for a log you scroll fast, so this
 * adds two marks, both from the blue family and neither from the coral:
 *
 *   a 3px `pill` rail down the leading edge of the card, the same rounded rail
 *   the design uses as a leading marker at L73;
 *   and the name printed as "You" in `priTint`.
 *
 * Coral is not available for this and the temptation is real, because coral is
 * the loudest thing in the palette. Coral means a state of the world — live,
 * playing, in sync, unread. Being the author of a message is not a state of the
 * world; it is a thing you did, and things you did are blue. A log where every
 * second card carried a coral edge would also drown the one coral thing on the
 * screen that has to win: the LIVE badge on the session above it.
 *
 * EVERY CARD CARRIES ITS OWN HEAD. Run-grouping used to drop the avatar and
 * name from the second message of a run; a card with no head is just an
 * orphaned paragraph, so runs are now expressed as SPACING (`showHeader` adds a
 * step of margin above the first card of a run) and every card stays able to
 * say who wrote it.
 */

import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { Plus, Trash2, X } from 'lucide-react-native';
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
  BubbleBody,
  DaySeparator,
  formatBubbleTime,
  readout,
  styles as kit,
  type ChatGround,
} from '@/components/chat/bubble-kit';
import { Avatar, AuxButton, CircleIconButton, GlassCard } from '@/components/ui';
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
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/** Content, not iconography — the lucide-only rule governs UI affordances. */
const QUICK_REACTIONS = ['❤️', '🔥', '😂', '🎵', '👍', '😭'] as const;

/**
 * L466 draws 34 in the lounge and L1254 draws 32 in the Session. One size for
 * both: the cards are otherwise identical and a 2px step is not a decision,
 * it is two artboards drawn a week apart.
 */
const AVATAR = 34;
/** 34px of avatar inside a 44px target, without costing 10px of layout. */
const AVATAR_SLOP = (TOUCH_TARGET - AVATAR) / 2;
/** Pulls the 44px name target back to the height of its own 18px line. */
const NAME_INSET = (TOUCH_TARGET - 18) / 2;

/** The gutter either side of the log: 18 on the screen (L463), 16 in the sheet (L1251). */
const GUTTER: Record<ChatGround, number> = { screen: 18, sheet: Space.lg };
/** And the gap between cards: 12 (L463) / 10 (L1251), applied as half above and below. */
const GAP: Record<ChatGround, number> = { screen: Space.md, sheet: 10 };

/**
 * The own-message rail: 3px wide, and inset from both ends by exactly the card's
 * own corner radius.
 *
 * Not a taste number. The card's left EDGE only exists between y = radius and
 * y = height − radius; above and below that the corner has curved away. A rail
 * inset by any less than the radius has its ends hanging in space beside the
 * corner, which reads as a rendering fault rather than a marker.
 */
const RAIL_WIDTH = 3;
const RAIL_INSET = Radii.lg;

export type MessageRowProps = {
  message: ChatMessage;
  /** The viewer wrote it: the blue rail and the "You" byline. */
  mine: boolean;
  /** First message of a run: adds the step of margin that groups the run. */
  showHeader: boolean;
  /** Day label to print above this row, or null. */
  daySeparator: string | null;
  /** Screen or Session sheet. See `ChatGround` — it decides the card's fill. */
  ground?: ChatGround;
  onLongPress: (message: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Avatar and name become targets onto the author's profile when supplied. */
  onOpenProfile?: (userId: string) => void;
};

function MessageRowBase({
  message,
  mine,
  showHeader,
  daySeparator,
  ground = 'screen',
  onLongPress,
  onToggleReaction,
  onOpenProfile,
}: MessageRowProps) {
  const C = useColors();
  const authored = message.author?.display_name ?? message.author?.username ?? 'Someone';
  const name = mine ? 'You' : authored;

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
      {daySeparator ? <DaySeparator label={daySeparator} /> : null}

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
          { paddingHorizontal: GUTTER[ground], paddingVertical: GAP[ground] / 2 },
          showHeader && styles.runLeading,
          // Pending is carried by weight, not by a spinner: the text is already
          // readable and in place, it simply has not landed yet.
          message.pending && kit.pending,
        ]}>
        {/*
          `row`, not `card`: radius 18 and no shadow. The design is exact about
          this — a message is a row inside a scrolling log, not a card standing
          on the page, and 43 of its 43 radius-24 surfaces carry a shadow while
          none of its 54 radius-18 ones do.
        */}
        <GlassCard variant="row" solid={ground === 'sheet'} padded={false}>
          {mine ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.rail, PointerEvents.none, { backgroundColor: C.pill }]}
            />
          ) : null}

          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${authored}'s profile`}
              disabled={!onOpenProfile}
              onPress={openProfile}
              style={({ pressed }) => [styles.avatarTarget, pressed && kit.dim]}>
              <Avatar uri={message.author?.avatar_url} name={authored} size={AVATAR} />
            </Pressable>

            <View style={styles.column}>
              <View style={styles.head}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${authored}'s profile`}
                  disabled={!onOpenProfile}
                  onPress={openProfile}
                  style={({ pressed }) => [styles.nameTarget, pressed && kit.dim]}>
                  <Text
                    numberOfLines={1}
                    // `priTint` on "You" — the second half of the own-message
                    // mark, and the reason the rail can stay 3px wide.
                    style={[styles.name, { color: mine ? C.priTint : C.ink }]}>
                    {name}
                  </Text>
                </Pressable>

                <Text style={[styles.stamp, { color: C.ink3 }]}>
                  {formatBubbleTime(message.createdAt)}
                  {message.pending ? ' · Sending' : ''}
                </Text>
              </View>

              <BubbleBody text={message.body} tone="surface" compact />

              {/*
                Only drawn once there is something to draw. A 44px add-chip under
                every single message doubles the height of a log to offer an
                action almost nobody takes on almost every line; the FIRST
                reaction comes from the long press, which is already the only way
                to the sheet.
              */}
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
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: pressed ? C.surface3 : C.chip,
                          /*
                            THE TWO ACCENTS DO DIFFERENT JOBS IN ONE CHIP, and
                            this is the clearest place in the app to see the
                            split. The COUNT is coral (L471): it is a live tally
                            of who is reacting right now. The EDGE going blue is
                            "you are one of them" — a thing you did. Painting
                            both in one colour would collapse the distinction the
                            whole palette rests on.
                          */
                          borderColor: reaction.mine ? C.glow : C.rule,
                        },
                      ]}>
                      <Text style={styles.chipEmoji}>{reaction.emoji}</Text>
                      <Text style={[styles.chipCount, { color: C.liveText }]}>
                        {reaction.count}
                      </Text>
                    </Pressable>
                  ))}

                  {/* Dashed, because it is an opening rather than a value: the
                      only control in the log that is not yet a reaction. */}
                  {message.pending ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add a reaction"
                      onPress={openActions}
                      style={({ pressed }) => [
                        styles.addChip,
                        { borderColor: pressed ? C.pill : C.rule2 },
                      ]}>
                      {/*
                        Children as a function, not a plain element: the glyph
                        has to change with the press and `pressed` only exists
                        inside these two callbacks. L474 lights the whole
                        control on press — border and glyph together.
                      */}
                      {({ pressed }) => (
                        <Plus size={17} color={pressed ? C.priTint : C.ink3} strokeWidth={2} />
                      )}
                    </Pressable>
                  )}
                </View>
              ) : null}
            </View>
          </View>
        </GlassCard>
      </Pressable>
    </View>
  );
}

/**
 * Rows re-render only when their own message object is replaced — a send being
 * confirmed or a reaction toggling — never because a sibling arrived.
 *
 * WHICH IS WHY THE ROW'S ENTRANCE IS NOT IN THIS FILE. Every card lifts and
 * fades in as it arrives, and that needs the row's position in the list — a
 * value that shifts by one for EVERY row each time a message lands, and would
 * therefore redraw the whole visible log once per incoming message to feed a
 * number that is read once at mount. So it lives one level up, in `MessageCell`
 * (see `./chat-list`), where re-rendering is free and this promise stays true.
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
 * THE SHEET IS GLASS AND ITS SHADOW POINTS UP. Both are Nocturne, and both were
 * wrong here before: it was an opaque slab flush to the bottom edge carrying
 * `dropped()`, whose shadow falls DOWNWARD — straight off the bottom of the
 * screen, where nobody can see it. `sheetShadow()` exists because a sheet is
 * lit by the page it covers. The panel now floats with a margin all round, as
 * every sheet in this design does (L1166).
 *
 * EVERY FILL INSIDE IT IS THE OPAQUE ONE. A `surface` control inside a BlurView
 * is 5.5% white over a blur and has no shape at all; the close button keeps its
 * `rule` edge for the same reason.
 *
 * DELETE IS `danger`, AND THAT IS THE OTHER CHANGE. It used to be a `live`
 * outline, on the reasoning that the palette had exactly one alarm colour and
 * the fill was spoken for. Nocturne gives destruction its own hue back
 * (`#ff5f7e`, distinct from both coral and blue) precisely so that a delete
 * button can never be mistaken for something that is live.
 */
export function MessageActionsSheet({
  message,
  canDelete,
  onClose,
  onReact,
  onDelete,
}: MessageActionsSheetProps) {
  const C = useColors();
  const { scheme } = useTheme();
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

  const remove = useCallback(() => {
    if (!message) return;
    onDelete(message.id);
    onClose();
  }, [message, onDelete, onClose]);

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
        {/*
          Shadow outside, clip inside. The BlurView needs `overflow: 'hidden'`
          to take the corner, and Android clips a view's own boxShadow away with
          it — the sheet would silently lose its edge on one platform only.
        */}
        <Animated.View
          style={[
            styles.sheetShell,
            { marginBottom: insets.bottom + Space.md },
            sheetShadow(C),
            sheetStyle,
          ]}>
          <BlurView
            intensity={scheme === 'dark' ? 40 : 60}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            // Android does not blur at all without this; the tint alone would
            // leave a flat translucent slab with nothing happening behind it.
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={[styles.sheet, { borderColor: C.chromeBorder }]}>
            {/*
              The tint rides ON TOP of the blur rather than being handed to
              BlurView as a background: underneath, the tint becomes the thing
              being blurred and the whole panel reads as fog.
            */}
            <View
              style={[StyleSheet.absoluteFill, PointerEvents.none, { backgroundColor: C.nav }]}
            />

            <View style={styles.sheetHead}>
              <View style={styles.sheetHeadText}>
                <Text style={[styles.sheetTitle, { color: C.ink }]}>Message</Text>
                <Text numberOfLines={1} style={[styles.sheetQuote, { color: C.ink3 }]}>
                  {message?.body ?? ''}
                </Text>
              </View>

              <CircleIconButton
                icon={X}
                size={44}
                tone="surface"
                accessibilityLabel="Close message actions"
                onPress={onClose}
              />
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
                        {
                          // Selected is BLUE, the same claim a selected chip
                          // makes everywhere else: you chose this. The resting
                          // tile is the opaque surface — it is inside a blur.
                          backgroundColor: selected
                            ? C.pill
                            : pressed
                              ? C.surface3
                              : C.surfaceSolid,
                          borderColor: selected ? 'transparent' : C.rule,
                        },
                      ]}>
                      <Text style={styles.pickerEmoji}>{emoji}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {canDelete ? (
                <AuxButton
                  label="Delete message"
                  icon={Trash2}
                  variant="danger"
                  align="center"
                  fullWidth
                  onPress={remove}
                />
              ) : null}
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /* ------------------------------------------------------------- the card */
  runLeading: {
    marginTop: Space.sm,
  },
  card: {
    flexDirection: 'row',
    gap: 11,
    padding: 13,
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: RAIL_INSET,
    bottom: RAIL_INSET,
    width: RAIL_WIDTH,
    borderRadius: Radii.pill,
  },
  avatarTarget: {
    flexShrink: 0,
    padding: AVATAR_SLOP,
    margin: -AVATAR_SLOP,
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  nameTarget: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    // The 44px target without the 44px of layout it would otherwise cost.
    marginVertical: -NAME_INSET,
    flexShrink: 1,
  },
  name: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tracking(13, 0.01),
  },
  stamp: {
    ...readout(10),
    fontFamily: Fonts.regular,
    letterSpacing: tracking(10, 0.05),
    flexShrink: 0,
  },

  /* -------------------------------------------------------------- reactions */
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // 8px minimum between adjacent tappables, on both axes.
    gap: Space.sm,
    marginTop: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs + 1,
    /*
      A real 44px target, not a 28px chip grown by a hitSlop. Slop wider than
      half the 8px gap made neighbouring chips' touch rects overlap, and the
      topmost sibling won — so a tap in the gap fired the wrong reaction. The
      design draws these at 28; the floor wins.
    */
    height: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    paddingHorizontal: 11,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
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
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    borderStyle: 'dashed',
  },

  /* ------------------------------------------------------------- the sheet */
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
  sheetShell: {
    // L1166: the sheet floats clear of the frame rather than sitting on the
    // bottom edge, which is what makes it read as a panel over the page.
    marginHorizontal: 10,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    borderRadius: SheetMetrics.radius + 2,
  },
  sheet: {
    borderRadius: SheetMetrics.radius + 2,
    borderWidth: Rule.hair,
    overflow: 'hidden',
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
    gap: 3,
  },
  sheetTitle: {
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  sheetQuote: {
    ...Type.body(11.5),
  },
  sheetBody: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xl,
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
    borderWidth: Rule.hair,
  },
  pickerEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
});
