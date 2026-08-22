import { Crown, LogOut } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AuxButton, GlassCard } from '@/components/ui';
import { Colors, PointerEvents, Radius, Space, TOUCH_TARGET, Type, ZIndex } from '@/lib/theme';

export type LoungeMenuModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Owners cannot leave: the lounge would be left with no one who can moderate it. */
  isOwner: boolean;
  isLeaving: boolean;
  onLeave: () => void;
};

/**
 * The lounge overflow menu, plus its one destructive confirmation.
 *
 * The confirm step is a second view of this same modal rather than
 * `Alert.alert`: RN Web has no Alert implementation, so on web the confirm
 * would silently never appear and the leave would either fire unguarded or not
 * at all. One Modal behaves identically on all three platforms.
 */
export function LoungeMenuModal({
  visible,
  onClose,
  isOwner,
  isLeaving,
  onLeave,
}: LoungeMenuModalProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (visible) setConfirming(false);
  }, [visible]);

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
        style={styles.scrim}
      />

      <View style={[styles.dock, PointerEvents.boxNone]}>
        <GlassCard style={styles.card}>
          {confirming ? (
            <View style={styles.content}>
              <Text style={styles.title}>Leave this lounge?</Text>
              <Text style={styles.body}>
                You will lose access to its Sessions and chat. You can rejoin later with an
                invite code.
              </Text>

              <View style={styles.actions}>
                <AuxButton
                  label="Cancel"
                  variant="ghost"
                  size="sm"
                  onPress={() => setConfirming(false)}
                />
                <AuxButton
                  label="Leave"
                  variant="danger"
                  size="sm"
                  icon={LogOut}
                  loading={isLeaving}
                  onPress={onLeave}
                />
              </View>
            </View>
          ) : (
            <View style={styles.content}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave lounge"
                accessibilityState={{ disabled: isOwner }}
                disabled={isOwner}
                onPress={() => setConfirming(true)}
                style={({ pressed }) => [
                  styles.item,
                  pressed && styles.itemPressed,
                  isOwner && styles.itemDisabled,
                ]}>
                <LogOut size={20} color={isOwner ? Colors.muted : Colors.danger} strokeWidth={1.6} />
                <Text style={[styles.itemLabel, isOwner ? styles.itemLabelMuted : styles.itemLabelDanger]}>
                  Leave lounge
                </Text>
              </Pressable>

              {/* An owner tapping a dead button deserves to know why it is dead. */}
              {isOwner ? (
                <View style={styles.note}>
                  <Crown size={16} color={Colors.muted} strokeWidth={1.6} />
                  <Text style={styles.noteText}>
                    You own this lounge. Hand ownership to a member, or delete the lounge, to
                    leave it.
                  </Text>
                </View>
              ) : null}

              <AuxButton label="Close" variant="ghost" size="sm" fullWidth onPress={onClose} />
            </View>
          )}
        </GlassCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.scrim,
  },
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: Space.lg,
    zIndex: ZIndex.sheet,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    // Sheet radius, not card radius — this arrives from the bottom edge.
    borderRadius: Radius.xl,
    // Sits clear of the home indicator without needing insets here.
    marginBottom: Space.xl,
  },
  content: {
    gap: Space.md,
  },
  title: {
    ...Type.title,
    color: Colors.text,
  },
  body: {
    ...Type.body,
    color: Colors.muted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Space.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET + 6,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
  },
  itemPressed: {
    // Glass, so the press wash tints with the room behind the sheet rather than
    // stamping an opaque block onto a translucent surface.
    backgroundColor: Colors.glassStrong,
  },
  itemDisabled: {
    opacity: 0.55,
  },
  itemLabel: {
    ...Type.bodyStrong,
  },
  /*
    Colors.danger as 16px text measures ~3.5:1 on glass — fine for the icon
    (graphics need 3:1) but short of the 4.5:1 text floor. The rose icon plus
    the confirm step carries the destructive signal; the label stays readable.
  */
  itemLabelDanger: {
    color: Colors.text,
  },
  itemLabelMuted: {
    color: Colors.muted,
  },
  note: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingTop: Space.sm,
    // A hairline is enough to say "this explains the dead control above".
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  noteText: {
    ...Type.caption,
    color: Colors.muted,
    flex: 1,
  },
});
