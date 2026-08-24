/**
 * The lounge `···` sheet, plus its one destructive confirmation.
 *
 * README §8: **Invite people**, then **LEAVE THIS LOUNGE** for members and
 * mods — or, if you own it, a warned **DELETE THIS LOUNGE** block naming the
 * member count, *with no leave option at all*. An owner is not offered a door
 * they cannot walk through.
 *
 * The confirm step is a second view of this same sheet rather than
 * `Alert.alert`: RN Web has no Alert implementation, so on web the confirm
 * would silently never appear and the action would either fire unguarded or not
 * at all. One Modal behaves identically on all three platforms.
 */

import { UserPlus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuxButton } from '@/components/ui';
import type { MemberRole } from '@/lib/database.types';
import {
  Duration,
  PointerEvents,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type LoungeMenuModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Owners get the delete block instead of a leave action. */
  isOwner: boolean;
  isLeaving: boolean;
  onLeave: () => void;
  /** Named in the sheet header. */
  loungeName?: string;
  /** Printed as `128 MEMBERS`, and again inside the owner's warning. */
  memberCount?: number | null;
  role?: MemberRole | null;
  /** Opens the invite-code sheet. Omit and the row is not rendered. */
  onInvite?: () => void;
  /** Owner-only. Omit and the owner sees the warning without the action. */
  onDelete?: () => void;
  isDeleting?: boolean;
};

type Confirm = 'leave' | 'delete' | null;

export function LoungeMenuModal({
  visible,
  onClose,
  isOwner,
  isLeaving,
  onLeave,
  loungeName,
  memberCount,
  role,
  onInvite,
  onDelete,
  isDeleting = false,
}: LoungeMenuModalProps) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState<Confirm>(null);

  const reduced = useReducedMotion();
  const rise = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      rise.value = visible ? 1 : 0;
      return;
    }
    rise.value = withTiming(visible ? 1 : 0, {
      duration: visible ? Duration.sheet : Duration.scrim,
    });
  }, [visible, reduced, rise]);

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 16 }],
  }));

  /*
    Every open starts on the menu, never mid-confirmation. Adjusted during
    render rather than in an effect: an effect would flash the previous
    confirmation for a frame before clearing it.
  */
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setConfirming(null);
  }

  const membersLabel = typeof memberCount === 'number' ? `${memberCount} MEMBERS` : null;
  const subtitle = [membersLabel, role ? `YOU ARE ${role.toUpperCase()}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android hardware back closes the sheet instead of the whole screen.
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss menu"
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: C.scrim }]}
      />

      <View style={[styles.dock, PointerEvents.boxNone]}>
        <Animated.View
          style={[
            styles.sheet,
            // Neutral, matching JoinCodeModal. The accent top border belonged
            // to the abandoned direction; a sheet is not live.
            { backgroundColor: C.bg, borderTopColor: C.rule2, paddingBottom: insets.bottom },
            sheetStyle,
          ]}>
          <View style={[styles.head, { borderBottomColor: C.rule }]}>
            <View style={styles.headText}>
              <Text numberOfLines={1} style={[styles.headTitle, { color: C.ink }]}>
                {loungeName ?? 'LOUNGE'}
              </Text>
              {subtitle ? (
                <Text style={[styles.headSub, { color: C.ink3 }]}>{subtitle}</Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.dim]}>
              <Text style={[styles.closeLabel, { color: C.ink2 }]}>CLOSE</Text>
            </Pressable>
          </View>

          {confirming ? (
            <View style={styles.body}>
              <Text style={[styles.confirmTitle, { color: C.ink }]}>
                {confirming === 'delete' ? 'Delete this lounge?' : 'Leave this lounge?'}
              </Text>
              <Text style={[styles.note, { color: C.ink2 }]}>
                {confirming === 'delete'
                  ? 'This cannot be undone and the invite code is retired.'
                  : 'You will lose access to its Sessions and chat. You can rejoin later with an invite code.'}
              </Text>

              <AuxButton
                label={confirming === 'delete' ? 'DELETE THIS LOUNGE' : 'LEAVE THIS LOUNGE'}
                variant="danger"
                fullWidth
                loading={confirming === 'delete' ? isDeleting : isLeaving}
                onPress={confirming === 'delete' ? (onDelete ?? onClose) : onLeave}
              />
              <AuxButton
                label="CANCEL"
                variant="ghost"
                fullWidth
                onPress={() => setConfirming(null)}
              />
            </View>
          ) : (
            <>
              {onInvite ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Invite people"
                  onPress={onInvite}
                  style={({ pressed }) => [
                    styles.item,
                    { borderBottomColor: C.rule },
                    pressed ? { backgroundColor: C.surface } : null,
                  ]}>
                  <UserPlus size={19} color={C.ink2} strokeWidth={2} />
                  <View style={styles.itemText}>
                    <Text style={[styles.itemLabel, { color: C.ink }]}>Invite people</Text>
                    <Text style={[styles.itemSub, { color: C.ink3 }]}>
                      Copy the 8-character code
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {isOwner ? (
                /* No leave action anywhere in this branch — an owner walking
                   out would leave the lounge running with nobody who can
                   moderate it. Deleting is the only exit, and it is warned. */
                <View style={styles.body}>
                  <View style={[styles.warnBlock, { borderColor: C.dangerBorder }]}>
                    <Text style={[styles.warnTitle, { color: C.danger }]}>
                      YOU OWN THIS LOUNGE
                    </Text>
                    <Text style={[styles.note, { color: C.ink2 }]}>
                      An owner cannot walk away and leave it running. Deleting removes the lounge,
                      its chat history and every live Session
                      {membersLabel ? ` for all ${membersLabel}` : ''}.
                    </Text>

                    {onDelete ? (
                      <AuxButton
                        label="DELETE THIS LOUNGE"
                        variant="danger"
                        fullWidth
                        loading={isDeleting}
                        onPress={() => setConfirming('delete')}
                      />
                    ) : null}
                  </View>

                  <Text style={[styles.footnote, { color: C.ink3 }]}>
                    This cannot be undone and the invite code is retired.
                  </Text>
                </View>
              ) : (
                <View style={styles.body}>
                  <LeaveCell
                    border={C.dangerBorder}
                    wash={C.dangerWash}
                    ink={C.danger}
                    busy={isLeaving}
                    onPress={() => setConfirming('leave')}
                  />
                  <Text style={[styles.footnote, { color: C.ink3 }]}>
                    Leaving removes you from the members list and the chat, and drops the lounge
                    from your rail. You can rejoin with the invite code if it is private.
                  </Text>
                </View>
              )}
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Bordered danger, not filled: leaving is reversible with a code, and a solid
 * block here would out-shout the owner's genuinely irreversible DELETE.
 */
function LeaveCell({
  border,
  wash,
  ink,
  busy,
  onPress,
}: {
  border: string;
  wash: string;
  ink: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Leave this lounge"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.leave,
        { borderColor: border, backgroundColor: pressed ? wash : 'transparent' },
        busy && styles.dim,
      ]}>
      <Text style={[styles.leaveLabel, { color: ink }]}>LEAVE THIS LOUNGE</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dim: {
    opacity: 0.6,
  },
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: ZIndex.sheet,
  },
  sheet: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopWidth: Rule.major,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Space.md,
    paddingRight: Space.xs,
    paddingTop: Space.md,
    paddingBottom: Space.sm + 2,
    borderBottomWidth: Rule.major,
  },
  headText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headTitle: {
    ...Type.heading(15),
    letterSpacing: tracking(15, 0.03),
  },
  headSub: {
    ...Type.label(10),
  },
  close: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.xs,
  },
  closeLabel: {
    ...Type.heading(10),
    letterSpacing: tracking(10, 0.1),
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 58,
    paddingHorizontal: Space.md,
    borderBottomWidth: Rule.hair,
  },
  itemText: {
    flex: 1,
    gap: 1,
  },
  itemLabel: {
    ...Type.body(15),
  },
  itemSub: {
    ...Type.body(11),
  },
  body: {
    padding: Space.md,
    paddingTop: Space.lg,
    paddingBottom: Space.xl,
    gap: Space.md,
  },
  confirmTitle: {
    ...Type.display(22),
  },
  note: {
    ...Type.body(12),
  },
  footnote: {
    ...Type.body(11),
  },
  warnBlock: {
    borderWidth: Rule.hair,
    padding: Space.md,
    gap: Space.md,
  },
  warnTitle: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
  leave: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  leaveLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
});
