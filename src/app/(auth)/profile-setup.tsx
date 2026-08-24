/**
 * Profile setup — the gate.
 *
 * Two things have to be true before the app opens up: there is a photo, and
 * there is a line of bio. Until both are, the button renders at 55% and the
 * shell's lounge rail and tab bar do not render at all (see `(tabs)/_layout`).
 * The tick on each card IS the checklist — the separate gate panel, the
 * provider cards, the display-name field and the video slot the previous
 * version carried are all gone, per design/v2/aux-v2.dc.html, screen
 * "Profile setup".
 *
 * TODO(schema): `profiles` has no `bio`, photo, profile-video or
 * activity-visibility column yet, so everything except the display name is held
 * locally by `useLocalProfile` (AsyncStorage). The migration those fields need
 * is written out in `src/lib/providers.tsx`. `expo-image-picker` is not a
 * dependency either, so the photo card fills a placeholder rather than opening
 * a picker — wiring a real picker means setting `photoUri` alongside the
 * `hasPhoto` flag and changing nothing else here.
 */

import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { useToast } from '@/components/ui';
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
  raisedLarge,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const GUTTER = 26;
const PHOTO_SLOT = 76;
const BIO_MAX = 160;
/** The three setup rows. Larger than `Radii.lg`, smaller than `Radii.xl`. */
const CARD_RADIUS = 20;
/** The switch, straight off the artboard: a 50×30 well with a 24px knob. */
const SWITCH_WIDTH = 50;
const SWITCH_HEIGHT = 30;
const KNOB = 24;

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

  const initial = (profile?.display_name?.trim()[0] ?? profile?.username?.[0] ?? '?').toUpperCase();

  const togglePhoto = useCallback(() => {
    local.update({ hasPhoto: !local.hasPhoto, photoUri: local.hasPhoto ? null : local.photoUri });
  }, [local]);

  const save = useCallback(async () => {
    if (!local.complete || saving) return;
    setSaving(true);
    try {
      // The only field on this screen with a column. Everything else is local
      // until the migration lands.
      if (!profile?.display_name?.trim() && profile?.username) {
        await updateProfile.mutateAsync({ display_name: profile.username });
      }
      local.markDone();
      router.replace('/(tabs)');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save your profile.', 'error');
      setSaving(false);
    }
  }, [local, profile, router, saving, toast, updateProfile]);

  if (local.hydrating) return null;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.bg, paddingTop: insets.top + Space.xxl }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.ScrollView
        style={enterStyle}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xxxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <OnboardingHeader
          title="Set up your profile"
          lede="Both of these are required before the Feed opens."
          size={29}
        />

        {/* ------------------------------------------------------------ photo */}
        <Pressable
          accessibilityRole="button"
          // The label carries the state; a `checked` flag on a button role is
          // read inconsistently and would say the same thing twice.
          accessibilityLabel={local.hasPhoto ? 'Remove your photo' : 'Add a photo'}
          onPress={togglePhoto}
          style={({ pressed }) => [
            styles.card,
            styles.photoCard,
            { backgroundColor: C.surface },
            raisedLarge(C),
            pressed ? styles.held : null,
          ]}>
          <View style={[styles.photo, { backgroundColor: C.artwork }]}>
            {local.hasPhoto && local.photoUri !== null ? (
              <ExpoImage
                source={{ uri: local.photoUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <Text style={[local.hasPhoto ? styles.photoInitial : styles.photoLabel, { color: C.artInk }]}>
                {local.hasPhoto ? initial : 'Photo'}
              </Text>
            )}
          </View>

          <View style={styles.cardCopy}>
            <Text style={[styles.cardTitle, { color: C.ink }]}>A photo</Text>
            <Text style={[styles.cardNote, { color: C.ink2 }]}>
              Square. Add a 2–6s loop later and it plays behind it.
            </Text>
          </View>

          {local.hasPhoto ? <Done /> : null}
        </Pressable>

        {/* -------------------------------------------------------------- bio */}
        <View style={[styles.card, styles.stack, { backgroundColor: C.surface }, raisedLarge(C)]}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { color: C.ink }]}>One line about you</Text>
            {local.hasBio ? <Done /> : null}
          </View>

          <View style={styles.well}>
            <OnboardingField
              multiline
              accessibilityLabel="One line about you"
              value={local.bio}
              onChangeText={(next) => local.update({ bio: next })}
              placeholder="What do you put on?"
              maxLength={BIO_MAX}
            />
          </View>
        </View>

        {/* --------------------------------------------------------- activity */}
        <View style={[styles.card, styles.activity, { backgroundColor: C.surface }, raisedLarge(C)]}>
          <View style={styles.cardCopy}>
            <Text style={[styles.cardTitle, { color: C.ink }]}>Show when I&apos;m active</Text>
            <Text style={[styles.cardNote, { color: C.ink2 }]}>
              Off means you never appear in the Feed.
            </Text>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: local.showActivity }}
            accessibilityLabel="Show when I'm active"
            onPress={() => local.update({ showActivity: !local.showActivity })}
            style={styles.switchTarget}>
            {/*
              A 50×30 track takes a hairline, NOT `pressed()`. The inset pair
              needs roughly 80px of surface before both halves land: at this
              size the 3.2%-alpha light half never shows on a dark ground and
              only the dark half survives, which reads as a smudge on the
              switch rather than a well. This is the same fix the auth fields
              already carry — the helper was reaching this file under the alias
              `recessed`, which is why it outlived the others.
            */}
            <View
              style={[
                styles.switchTrack,
                { backgroundColor: C.bgRecessed, borderColor: C.rule },
                local.showActivity ? styles.switchOn : styles.switchOff,
              ]}>
              <View style={[styles.knob, { backgroundColor: C.pill }, dropped(C, 'sm')]} />
            </View>
          </Pressable>
        </View>

        <View style={styles.spacer} />

        <PrimaryCta
          compact
          label="Save profile & enter aux"
          accessibilityLabel={
            local.complete
              ? 'Save profile and enter Aux'
              : 'Save profile and enter Aux, unavailable until a photo and a bio are added'
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

  card: {
    borderRadius: CARD_RADIUS,
    padding: Space.lg,
  },
  photoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    padding: 14,
    marginTop: Space.xxxl,
  },
  stack: {
    marginTop: Space.md,
  },
  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: Space.md,
  },

  photo: {
    width: PHOTO_SLOT,
    height: PHOTO_SLOT,
    flexShrink: 0,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoLabel: {
    ...Type.label(8.5),
    letterSpacing: tracking(8.5, 0.14),
  },
  photoInitial: {
    fontFamily: Fonts.extrabold,
    fontSize: 34,
    letterSpacing: tracking(34, -0.03),
  },

  cardCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  cardTitle: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    letterSpacing: tracking(15, -0.01),
  },
  cardNote: {
    ...Type.body(12.5),
    lineHeight: 18,
    marginTop: 3,
  },
  well: {
    marginTop: Space.md,
  },

  switchTarget: {
    width: SWITCH_WIDTH,
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

  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: Space.xxl,
  },
  held: {
    opacity: 0.9,
  },
});
