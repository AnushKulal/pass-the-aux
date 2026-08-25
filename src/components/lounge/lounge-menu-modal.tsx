/**
 * The lounge `···` sheet, plus its one destructive confirmation.
 *
 * design/nocturne/aux-nocturne.dc.html: the shared sheet shell at L1163-L1167
 * and the `sheetLounge` body at L1455-L1474. A head naming the lounge, one
 * **Invite people** row inside a bordered card, then — for a member or a mod —
 * **Leave this lounge** with a footnote, or, if you own it, a danger-edged
 * block naming the member count with **Delete this lounge** in it and *no leave
 * option at all*. An owner is not offered a door they cannot walk through.
 *
 * The confirm step is a second view of this same sheet rather than
 * `Alert.alert`: RN Web has no Alert implementation, so on web the confirm would
 * silently never appear and the action would either fire unguarded or not at
 * all. One Modal behaves identically on all three platforms.
 *
 * THE SHEET FLOATS, which is the shape change from the direction this file was
 * written for. It used to be a slab welded to the bottom of the frame: square
 * corners, full bleed, a 2px rule along its top edge and a flat `bg` fill.
 * L1163 is an OBJECT — inset from both sides, lifted clear of the bottom,
 * rounded on all four corners, blurred, and bordered the whole way around. Two
 * consequences, both load-bearing:
 *
 *   `sheetShadow()`, NOT `dropped()`. A sheet is lit by the page it covers, so
 *   its shadow falls UPWARD onto that page. `dropped()` throws it down past the
 *   bottom of the screen where nobody can see it, and the sheet loses its edge
 *   against whatever it is covering.
 *
 *   EVERY SURFACE INSIDE IT IS OPAQUE. This is the translucency hazard at its
 *   sharpest, because a modal floats over arbitrary content: `surface` is 5.5%
 *   white, and laid over a BlurView it has nothing solid to sit on and simply
 *   dissolves into it. Both panels in here take the resolved composite instead
 *   — `GlassCard solid` for the invite group, `surfaceSolid` for the owner's
 *   warning block.
 *
 * NO CORAL ANYWHERE ON THIS SHEET, and that is the accent rule rather than an
 * oversight. Coral says "this is happening right now" and nothing here is
 * happening — a menu opening is not a live state. Destruction has its own hue
 * again in this direction (`danger`, a pink-red distinct from both accents),
 * which is the whole reason that token exists separately, and it is the only
 * colour on the sheet.
 *
 * Kept in step with `InviteSheet` in `src/app/(tabs)/lounge/[id].tsx`: the two
 * are opened from the same header, one from the other, and any disagreement
 * about corner, lift or head layout shows as a jump between them.
 */

import { BlurView } from 'expo-blur';
import { ChevronRight, UserPlus, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuxButton, CircleIconButton, GlassCard } from '@/components/ui';
import type { MemberRole } from '@/lib/database.types';
import {
  Duration,
  PointerEvents,
  Radii,
  Rule,
  Sheet as SheetMetrics,
  Space,
  Type,
  ZIndex,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

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

/**
 * L1163 draws the sheet at 30, and `SheetMetrics.radius` is 28. The literal
 * wins here because this sheet has to agree with `InviteSheet` on the lounge
 * screen, which is also 30 — a 2px disagreement between two sheets the same
 * header opens back to back is visible. The token wants to move to 30; this
 * constant disappears the day it does.
 */
const SHEET_RADIUS = 30;

/** L1461: `min-height:60px`, the row height every sheet menu in the app uses. */
const ROW_HEIGHT = 60;
const ROW_ICON = 19;
const ROW_CHEVRON = 17;

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
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState<Confirm>(null);

  const reduced = useReducedMotion();
  const rise = useSharedValue(0);
  const dark = scheme === 'dark';

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

  /*
    The same number in two voices. The kicker SHOUTS, because L1457 sets it
    uppercase beside the lounge name; the owner's warning below is a sentence,
    and "for all 128 MEMBERS" set mid-prose is exactly the shout that an
    uppercase kicker exists to keep out of prose.
  */
  const membersProse = typeof memberCount === 'number' ? `${memberCount} members` : null;

  /** The float: clear of the home indicator, and never flush on a device without one. */
  const lift = Math.max(insets.bottom, Space.md) + Space.md;

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
        {/*
          The shadow rides on this view, the blur clips inside it. Android
          throws away a view's own boxShadow along with whatever
          `overflow: 'hidden'` clips, so a single view would lose its lift on
          one platform only.

          Deliberately uncapped in height. A `maxHeight` with no scroller under
          it compresses the flex children, and the child that would lose its
          pixels first is the DELETE button at the bottom of the owner branch —
          a destructive control clipped out of reach is worse than a sheet that
          runs tall on a very small screen.
        */}
        <Animated.View
          style={[styles.shell, { marginBottom: lift }, sheetShadow(C), sheetStyle]}>
          <BlurView
            intensity={dark ? 46 : 60}
            tint={dark ? 'dark' : 'light'}
            // Android does not blur at all without this; the tint alone would
            // leave a flat translucent slab with nothing happening behind it.
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={[styles.glass, { borderColor: C.chromeBorder }]}>
            {/*
              The tint rides ON TOP of the blur rather than being handed to
              BlurView as a background: underneath, the tint becomes the thing
              being blurred and the whole sheet reads as fog. It is also the
              safety net — a Modal is its own window, so if a platform declines
              to blur what is behind it, this layer is still a near-opaque `nav`
              fill and the sheet stays a legible panel.
            */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

            <View style={styles.grabberSlot}>
              <View style={[styles.grabber, { backgroundColor: C.rule3 }]} />
            </View>

            <View style={styles.head}>
              <View style={styles.headText}>
                <Text numberOfLines={1} style={[styles.headTitle, { color: C.ink }]}>
                  {loungeName ?? 'Lounge'}
                </Text>
                {subtitle ? (
                  <Text style={[styles.headSub, { color: C.ink3 }]}>{subtitle}</Text>
                ) : null}
              </View>

              {/*
                `chip` rather than `surface`: the design's close circle is the
                9%-white fill (L1458), which is what this tone paints, and the
                kit has no tone pairing that fill with a hairline. The missing
                1px reads as nothing on glass — the fill alone is twice the
                contrast a `surface` circle would have here.
              */}
              <CircleIconButton
                icon={X}
                tone="chip"
                accessibilityLabel="Close"
                onPress={onClose}
              />
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
                  label={confirming === 'delete' ? 'Delete this lounge' : 'Leave this lounge'}
                  variant="danger"
                  fullWidth
                  loading={confirming === 'delete' ? isDeleting : isLeaving}
                  onPress={confirming === 'delete' ? (onDelete ?? onClose) : onLeave}
                />
                <AuxButton
                  label="Cancel"
                  variant="ghost"
                  fullWidth
                  onPress={() => setConfirming(null)}
                />
              </View>
            ) : (
              <View style={styles.body}>
                {onInvite ? (
                  /*
                    L1460: the row lives inside its own bordered card rather
                    than running edge to edge. `solid` is not optional — this
                    card is mounted inside a BlurView, where a 5.5%-white fill
                    has nothing to sit on and vanishes into the glass.

                    No top hairline on the row: it is the only one in the group,
                    and the card's own edge is already 1px above it. Two
                    hairlines a pixel apart read as a 2px border, not as a
                    separator.
                  */
                  <GlassCard variant="row" solid padded={false} style={styles.group}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Invite people"
                      accessibilityHint="Copy the 8-character code"
                      onPress={onInvite}
                      style={({ pressed }) => [
                        styles.item,
                        { backgroundColor: pressed ? C.surface2 : 'transparent' },
                      ]}>
                      <UserPlus size={ROW_ICON} color={C.ink2} strokeWidth={2} />
                      <View style={styles.itemText}>
                        <Text style={[styles.itemLabel, { color: C.ink }]}>Invite people</Text>
                        <Text style={[styles.itemSub, { color: C.ink3 }]}>
                          Copy the 8-character code
                        </Text>
                      </View>
                      {/* The design's chevron (L1461). It promises a next step,
                          which this row genuinely has — the invite sheet. */}
                      <ChevronRight size={ROW_CHEVRON} color={C.ink3} strokeWidth={2} />
                    </Pressable>
                  </GlassCard>
                ) : null}

                {isOwner ? (
                  /* No leave action anywhere in this branch — an owner walking
                     out would leave the lounge running with nobody who can
                     moderate it. Deleting is the only exit, and it is warned. */
                  <>
                    {/*
                      L1468 fills this block with `danger-w`, a 12% pink wash.
                      It takes the opaque `surfaceSolid` instead, and the swap is
                      the whole reason the block is legible: a 12% wash inside a
                      BlurView has nothing to sit on, AND the `danger` button
                      below is itself a `dangerWash` fill, so wash on wash would
                      composite the button into its own container and leave a
                      pink rectangle with a word in it. The `dangerBorder` edge
                      is what still says "danger" structurally, and it is kept.
                    */}
                    <View
                      style={[
                        styles.warnBlock,
                        { backgroundColor: C.surfaceSolid, borderColor: C.dangerBorder },
                      ]}>
                      <Text style={[styles.warnTitle, { color: C.danger }]}>
                        YOU OWN THIS LOUNGE
                      </Text>
                      <Text style={[styles.note, { color: C.ink2 }]}>
                        An owner cannot walk away and leave it running. Deleting removes the
                        lounge, its chat history and every live Session
                        {membersProse ? ` for all ${membersProse}` : ''}.
                      </Text>

                      {onDelete ? (
                        <AuxButton
                          label="Delete this lounge"
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
                  </>
                ) : (
                  <>
                    {/*
                      The hand-rolled `LeaveCell` this replaces drew its own
                      bordered pill so that leaving would not out-shout the
                      owner's irreversible DELETE. The kit's `danger` variant IS
                      that treatment — a `dangerWash` fill behind a
                      `dangerBorder` edge with `danger` ink, pressing to the
                      solid border colour — so the local copy was a second
                      implementation of one design, and it had no loading
                      spinner.
                    */}
                    <AuxButton
                      label="Leave this lounge"
                      variant="danger"
                      fullWidth
                      loading={isLeaving}
                      onPress={() => setConfirming('leave')}
                    />

                    <Text style={[styles.footnote, { color: C.ink3 }]}>
                      Leaving removes you from the members list and the chat, and drops the lounge
                      from your rail. You can rejoin with the invite code if it is private.
                    </Text>
                  </>
                )}
              </View>
            )}
          </BlurView>
        </Animated.View>
      </View>
    </Modal>
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
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
    /* L1163's `margin:0 10px`. It lives on the PARENT rather than as a margin
       on the sheet, because the sheet is `width:'100%'` and a margin would put
       it 20px wider than the screen. */
    paddingHorizontal: Space.sm + 2,
    zIndex: ZIndex.sheet,
  },
  /** Carries the shadow and the placement. The glass below carries the skin. */
  shell: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: SHEET_RADIUS,
  },
  glass: {
    borderRadius: SHEET_RADIUS,
    borderWidth: Rule.hair,
    // Without this the blur paints square corners behind the rounded border.
    overflow: 'hidden',
  },
  grabberSlot: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: Space.sm,
  },
  grabber: {
    width: SheetMetrics.grabberW,
    height: SheetMetrics.grabberH,
    borderRadius: Radii.pill,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingBottom: Space.md,
  },
  headText: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  headTitle: {
    // L1457: 800 at 18 with NEGATIVE tracking. The old 15px `heading` opened
    // its letters out, which is the kicker's voice, not a title's.
    ...Type.display(18),
    letterSpacing: tracking(18, -0.015),
  },
  /** Matches the kicker under every other sheet title in the app. */
  headSub: {
    ...Type.body(11),
    lineHeight: 14,
    letterSpacing: tracking(11, 0.04),
    marginTop: 3,
  },
  body: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
  group: {
    // The card clips its own pressed fill to the 18px corner; without it the
    // press paints a square behind a rounded edge.
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: ROW_HEIGHT,
    paddingHorizontal: Space.lg,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemLabel: {
    ...Type.body(15),
  },
  itemSub: {
    ...Type.body(11),
    lineHeight: 14,
  },
  confirmTitle: {
    ...Type.display(22),
  },
  note: {
    ...Type.body(12),
  },
  footnote: {
    ...Type.body(11),
    lineHeight: 17,
  },
  warnBlock: {
    borderWidth: Rule.hair,
    // L1468 draws 20; `Radii.xl` is 22 and the nearest step the scale carries.
    // Inventing a 20 here would put a third corner value on one sheet.
    borderRadius: Radii.xl,
    padding: Space.lg,
    gap: Space.md,
  },
  warnTitle: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.09),
  },
});
