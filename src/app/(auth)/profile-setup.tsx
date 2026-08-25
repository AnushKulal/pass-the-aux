/**
 * Profile setup — the gate.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isNewProfile`
 * (L169-227): the 82px identity tile with its camera badge, the dashed video
 * slot beside it, one card holding the name and the bio, the activity toggle,
 * and a CTA that changes its own copy when it cannot be pressed.
 *
 * Two things have to be true before the app opens up: there is a photo, and
 * there is a line of bio. Until both are, the button renders as a flat surface
 * pill naming what is missing, and the shell's lounge rail and tab bar do not
 * render at all (see `(tabs)/_layout`).
 *
 * THREE DELIBERATE DEVIATIONS FROM THE ARTBOARD:
 *
 * 1. THE GATE IS PHOTO + BIO, NOT A LINKED PROVIDER. The design gates on
 *    "LINK ONE TO PLAY — REQUIRED" and calls the photo and bio optional. This
 *    app's gate lives in `useLocalProfile` and is read by `(tabs)/_layout`;
 *    inverting it here would let people through a door the shell still holds
 *    shut. The provider section is therefore absent rather than decorative —
 *    its rows are a `sc-for` over computed state that the design file itself
 *    truncates, and Spotify linking lives in Settings > Connections, which is
 *    behind this very gate. The footnote says so instead.
 * 2. NO SEPARATE CHECKLIST TICKS. The previous version put a `Done` tick on
 *    each of three cards. The disabled CTA now names the unmet condition
 *    outright, which says the same thing once, at the moment it matters, in the
 *    place the reader is already looking.
 * 3. The screen SCROLLS. The artboard is a fixed column with a flex spacer,
 *    which only fits because it was drawn on one 402x874 frame — with a
 *    keyboard up on a small phone the bio well would be off-screen.
 *
 * TODO(schema): `profiles` has no `bio`, photo, profile-video or
 * activity-visibility column yet, so everything except the display name is held
 * locally by `useLocalProfile` (AsyncStorage). The migration those fields need
 * is written out in `src/lib/providers.tsx`. `expo-image-picker` is not a
 * dependency either, so the photo tile and the video slot fill a placeholder
 * rather than opening a picker — wiring a real picker means setting `photoUri`
 * / `videoUri` alongside the flag and changing nothing else here.
 */

import { useRouter } from 'expo-router';
import { Camera, Video } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Done,
  OnboardingField,
  OnboardingHeader,
  PrimaryCta,
  useEnterStyle,
} from '@/components/auth/onboarding';
import { Avatar, useToast } from '@/components/ui';
import { useUpdateProfile } from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The artboard's 18px side padding — the same gutter every app screen uses. */
const GUTTER = 18;

/** The identity tile — design L178: 82px at radius 22. */
const TILE = 82;
const TILE_RADIUS = 22;
/** Its corner badge, hung 4px outside the tile on both edges. */
const BADGE = 26;
const BADGE_OFFSET = -4;

/** The dashed video slot (L182) and the inset inputs beside it (L193). */
const SLOT_MIN_HEIGHT = 44;
const INSET_HEIGHT = 42;

const BIO_MAX = 160;

/** The switch, straight off the artboard: a 44x26 track with an 18px knob. */
const SWITCH_WIDTH = 44;
const SWITCH_HEIGHT = 26;
const KNOB = 18;

export default function ProfileSetupScreen() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const enterStyle = useEnterStyle();

  const { user, profile } = useAuth();
  const local = useLocalProfile();
  const updateProfile = useUpdateProfile(user?.id);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  /*
    The profile row is written server-side by a signup trigger and can land a
    beat after this screen mounts. Seed the name field once it arrives, then
    never again — a second seed would overwrite whatever is being typed.
  */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setName(profile.display_name ?? '');
  }, [profile]);

  const togglePhoto = useCallback(() => {
    local.update({ hasPhoto: !local.hasPhoto, photoUri: local.hasPhoto ? null : local.photoUri });
  }, [local]);

  const toggleVideo = useCallback(() => {
    local.update({ hasVideo: !local.hasVideo, videoUri: local.hasVideo ? null : local.videoUri });
  }, [local]);

  const save = useCallback(async () => {
    if (!local.complete || saving) return;
    setSaving(true);
    try {
      // The only field on this screen with a column of its own. Everything else
      // is local until the migration lands. An emptied name falls back to the
      // handle rather than writing an empty string — a nameless profile renders
      // as a blank row in the Feed and on every message.
      const nextName = name.trim() || profile?.username;
      if (nextName && nextName !== profile?.display_name) {
        await updateProfile.mutateAsync({ display_name: nextName });
      }
      local.markDone();
      router.replace('/(tabs)');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save your profile.', 'error');
      setSaving(false);
    }
  }, [local, name, profile, router, saving, toast, updateProfile]);

  if (local.hydrating) return null;

  /** The unmet half of the gate, named on the button that is waiting for it. */
  const blockedLabel = !local.hasPhoto
    ? local.hasBio
      ? 'Add a photo'
      : 'Add a photo and one line'
    : 'Add one line about you';

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + Space.md }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.ScrollView
        style={enterStyle}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xxxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <OnboardingHeader
          kicker="Your profile"
          title="How people see you"
          lede="A photo and one line are what open the Feed."
          size={26}
        />

        {/* ------------------------------------------------------- media row */}
        <View style={styles.media}>
          <Pressable
            accessibilityRole="button"
            // The label carries the state; a `checked` flag on a button role is
            // read inconsistently and would say the same thing twice.
            accessibilityLabel={local.hasPhoto ? 'Remove your photo' : 'Add a photo'}
            onPress={togglePhoto}
            style={({ pressed }) => [styles.tile, pressed ? styles.held : null]}>
            {/*
              Hidden from the reader: the Pressable above already names the
              control, and `Avatar` announces itself as an image with the user's
              name, which would make one tile read as two things.
            */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Avatar
                identity
                size={TILE}
                radius={TILE_RADIUS}
                uri={local.hasPhoto ? local.photoUri : null}
                name={name.trim() || profile?.username || '?'}
              />
            </View>

            <View style={styles.badge}>
              {local.hasPhoto ? (
                // Ringed, because a coral disc laid on the coral identity
                // gradient has no edge of its own.
                <Done size={BADGE} ring />
              ) : (
                /*
                  `dock`, not `nav`. The design blurs this badge; RN would need a
                  BlurView for a 26px disc, and `nav` is the fill that assumes a
                  blur behind it — laid on artwork unblurred it goes
                  transparent and the gradient reads straight through the glyph.
                  `dock` is the same chrome at near-opaque, which is exactly what
                  this case is for.
                */
                <View
                  style={[
                    styles.badgeChrome,
                    { backgroundColor: C.dock, borderColor: C.chromeBorder },
                  ]}>
                  <Camera size={13} strokeWidth={2} color={C.ink} />
                </View>
              )}
            </View>
          </Pressable>

          <View style={styles.mediaCopy}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                local.hasVideo ? 'Replace your profile video' : 'Add a profile video'
              }
              onPress={toggleVideo}
              style={({ pressed }) => [
                styles.slot,
                {
                  borderColor: local.hasVideo ? C.liveMid : C.rule3,
                  backgroundColor: pressed ? C.surface : 'transparent',
                },
              ]}>
              <Video
                size={17}
                strokeWidth={2}
                color={local.hasVideo ? C.liveText : C.ink3}
              />
              <Text
                numberOfLines={1}
                style={[styles.slotLabel, { color: local.hasVideo ? C.liveText : C.ink3 }]}>
                {local.hasVideo ? 'Loop added · replace' : 'Add a profile video'}
              </Text>
            </Pressable>

            <Text style={[styles.mediaHint, { color: C.ink3 }]}>
              A 2–6 second loop plays behind your avatar.
            </Text>
          </View>
        </View>

        {/* -------------------------------------------------- name and bio */}
        {/*
          One card holding both, and the fields inside it are `inset` for a
          reason that is not taste: a translucent field card on a translucent
          card composites to ~11% white and the inner one stops being a separate
          object. Recessed wells are the design's own answer here (L193-196).
        */}
        <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <View style={styles.nameRow}>
            <View style={styles.nameField}>
              <OnboardingField
                variant="inset"
                accessibilityLabel="Your name"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                autoComplete="name"
                maxLength={40}
              />
            </View>

            {/* The handle, shown and not editable: it is claimed one screen
                earlier and changing it here would need the availability check
                that screen owns. */}
            <View
              style={[styles.handle, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
              <Text numberOfLines={1} style={[styles.handleLabel, { color: C.ink2 }]}>
                @{profile?.username ?? '…'}
              </Text>
            </View>
          </View>

          <View style={styles.bio}>
            <OnboardingField
              multiline
              variant="inset"
              accessibilityLabel="One line about you"
              value={local.bio}
              onChangeText={(next) => local.update({ bio: next })}
              placeholder="What do you put on?"
              maxLength={BIO_MAX}
            />
          </View>
        </View>

        {/* --------------------------------------------------------- activity */}
        <View
          style={[styles.card, styles.activity, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <View style={styles.activityCopy}>
            <Text style={[styles.activityTitle, { color: C.ink }]}>Show when I&apos;m active</Text>
            <Text style={[styles.activityNote, { color: C.ink3 }]}>
              A live dot and your track on the Feed. Off means you never appear there.
            </Text>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: local.showActivity }}
            accessibilityLabel="Show when I'm active"
            onPress={() => local.update({ showActivity: !local.showActivity })}
            style={styles.switchTarget}>
            {/*
              A 44x26 track takes a hairline, NOT `pressed()`. The inset pair
              needs roughly 80px of surface before both halves land: at this
              size the light half never shows on a dark ground and only the dark
              one survives, which reads as a smudge on the switch rather than as
              a well. The ON fill is `pill` because a switch you flick is an
              action, and it is what makes the white knob legible.
            */}
            <View
              style={[
                styles.switchTrack,
                {
                  backgroundColor: local.showActivity ? C.pill : C.bgRecessed,
                  borderColor: local.showActivity ? C.pill : C.rule,
                },
                local.showActivity ? styles.switchOn : styles.switchOff,
              ]}>
              <View style={[styles.knob, { backgroundColor: C.pillInk }, dropped(C, 'sm')]} />
            </View>
          </Pressable>
        </View>

        <Text style={[styles.footnote, { color: C.ink3 }]}>
          Aux plays through YouTube by default. Link Spotify Premium any time from Settings →
          Connections.
        </Text>

        <View style={styles.spacer} />

        <PrimaryCta
          compact
          label="Save profile & enter aux"
          disabledLabel={blockedLabel}
          accessibilityLabel={
            local.complete
              ? 'Save profile and enter Aux'
              : `Save profile and enter Aux, unavailable: ${blockedLabel}`
          }
          disabled={!local.complete}
          loading={saving}
          onPress={() => {
            void save();
          }}
        />
      </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
  },

  media: {
    flexDirection: 'row',
    gap: 11,
    marginTop: Space.lg,
  },
  tile: {
    flexShrink: 0,
    // The badge hangs outside the tile, so this must not clip.
    overflow: 'visible',
  },
  badge: {
    position: 'absolute',
    right: BADGE_OFFSET,
    bottom: BADGE_OFFSET,
  },
  badgeChrome: {
    width: BADGE,
    height: BADGE,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },

  mediaCopy: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  /*
    Dashed, and it is the only dashed edge in the signed-out flow: an empty slot
    that is waiting for a file reads as unfinished rather than as broken.
    iOS draws a dashed border solid once a radius is applied — the slot still
    reads as empty there because the fill stays transparent and the label is a
    kicker rather than a sentence.
  */
  slot: {
    flex: 1,
    minHeight: SLOT_MIN_HEIGHT,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: 11,
  },
  slotLabel: {
    ...Type.label(9.5),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9.5, 0.07),
    flexShrink: 1,
  },
  mediaHint: {
    ...Type.body(10.5),
    lineHeight: 15,
  },

  card: {
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.md,
    paddingVertical: 11,
    marginTop: 10,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 7,
  },
  nameField: {
    flex: 1,
    minWidth: 0,
  },
  handle: {
    flexShrink: 0,
    maxWidth: 132,
    height: INSET_HEIGHT,
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 13,
  },
  bio: {
    marginTop: 7,
  },

  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activityCopy: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, -0.01),
  },
  activityNote: {
    ...Type.body(10.5),
    lineHeight: 15,
    marginTop: 2,
  },

  switchTarget: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchTrack: {
    width: SWITCH_WIDTH,
    height: SWITCH_HEIGHT,
    borderRadius: SWITCH_HEIGHT / 2,
    borderWidth: Rule.hair,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
  },
  switchOn: {
    justifyContent: 'flex-end',
  },
  switchOff: {
    justifyContent: 'flex-start',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: Radii.pill,
  },

  footnote: {
    ...Type.body(11.5),
    lineHeight: 17,
    marginTop: 10,
  },

  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xl,
  },
  held: {
    opacity: 0.9,
  },
});
