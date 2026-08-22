/**
 * Profile setup — the gate.
 *
 * Two things have to be true before the app opens up: there is a photo, and
 * there is a line of bio. Until both are, SAVE PROFILE & ENTER AUX renders
 * disabled at 55% and the shell's lounge rail and tab bar do not render at all
 * (see `(tabs)/_layout`). Aux is a room full of people; a blank square in it is
 * a cost everyone else pays.
 *
 * TODO(schema): `profiles` has no `bio`, photo, profile-video or
 * activity-visibility column yet, so everything except the display name is held
 * locally by `useLocalProfile` (AsyncStorage). The migration those fields need
 * is written out in `src/lib/providers.tsx`. `expo-image-picker` is not a
 * dependency either, so the photo and video slots fill a placeholder rather
 * than opening a picker — wiring a real picker means setting `photoUri` /
 * `videoUri` alongside the `hasPhoto` / `hasVideo` flags and changing nothing
 * else here.
 */

import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { Image as ImageIcon, Video } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/components/ui/toast';
import { useUpdateProfile } from '@/features/profile/queries';
import { useAuth } from '@/lib/auth';
import { useLocalProfile } from '@/lib/providers';
import { Duration, Rule, Space, TOUCH_TARGET, Type, type Palette } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const PHOTO_SLOT = 92;
const FIELD_HEIGHT = 46;
const BIO_HEIGHT = 74;
const TICK = 12;
/** 44×26 visual inside the 44×44 target. */
const SWITCH_WIDTH = 44;
const SWITCH_HEIGHT = 26;
const KNOB = 20;
const KNOB_OFF = 2;
const KNOB_ON = 20;
const BIO_MAX = 160;

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/* ------------------------------------------------------------------- parts */

function SectionLabel({
  text,
  color,
  style,
}: {
  text: string;
  color: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.sectionLabel, { color }, style]}>{text}</Text>;
}

/**
 * One checklist line. The square fills accent the moment its condition is
 * satisfied — this is the accent doing its actual job, reporting a live fact
 * about state rather than decorating a list.
 */
function CheckRow({ done, label, C }: { done: boolean; label: string; C: Palette }) {
  return (
    <View
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}>
      <View style={[styles.tick, { backgroundColor: done ? C.live : C.rule2 }]} />
      <Text style={[styles.checkLabel, { color: C.ink2 }]}>{label}</Text>
    </View>
  );
}

function ProviderCard({
  provider,
  status,
  note,
  accent,
  chip,
  C,
}: {
  provider: string;
  status: string;
  note?: string;
  accent: boolean;
  chip?: string;
  C: Palette;
}) {
  return (
    <View style={[styles.providerCard, { borderColor: accent ? C.live : C.rule2 }]}>
      <Text style={[styles.providerName, { color: C.ink3 }]}>{provider}</Text>
      <Text style={[styles.providerStatus, { color: accent ? C.liveText : C.ink }]}>{status}</Text>
      {chip !== undefined ? (
        <View style={[styles.chip, { backgroundColor: C.live }]}>
          <Text style={[styles.chipText, { color: C.onLive }]}>{chip}</Text>
        </View>
      ) : null}
      {note !== undefined ? (
        <Text style={[styles.providerNote, { color: C.ink2 }]}>{note}</Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ screen */

export default function ProfileSetupScreen() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const reduced = useReducedMotion();

  const { user, profile } = useAuth();
  const local = useLocalProfile();
  const updateProfile = useUpdateProfile(user?.id);

  /**
   * Null means "untouched", which is what lets the field show the profile row
   * the moment it lands — a cold start resolves it a tick after mount — without
   * an effect that would later overwrite something the user has typed, or
   * refill the field the instant they clear it.
   */
  const [typedName, setTypedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = typedName ?? profile?.display_name ?? '';

  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter, easing: EASE });
  }, [enter, reduced]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  const initial = (name.trim()[0] ?? profile?.username?.[0] ?? '?').toUpperCase();
  const handle = profile?.username ? `@${profile.username}` : '@you';

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
      const trimmed = name.trim();
      // Only touch the network for the one field that has a column. Everything
      // else on this screen is local until the migration lands.
      if (trimmed.length > 0 && trimmed !== profile?.display_name) {
        await updateProfile.mutateAsync({ display_name: trimmed });
      }
      local.markDone();
      router.replace('/(tabs)');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save your profile.', 'error');
      setSaving(false);
    }
  }, [local, name, profile, router, saving, toast, updateProfile]);

  const ready = local.complete && !saving;

  if (local.hydrating) return null;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: C.bg, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.ScrollView
        style={enterStyle}
        contentContainerStyle={{ paddingBottom: insets.bottom + Space.xxl }}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.header, { borderBottomColor: C.rule }]}>
          <SectionLabel text="YOUR PROFILE" color={C.ink3} />
          <Text style={[styles.title, { color: C.ink }]}>How people see you</Text>
        </View>

        {/* -------------------------------------------------- photo + video */}
        <View style={[styles.mediaRow, { borderBottomColor: C.rule }]}>
          <Pressable
            onPress={togglePhoto}
            accessibilityRole="button"
            accessibilityLabel={local.hasPhoto ? 'Remove your photo' : 'Add a photo'}
            style={[
              styles.photoSlot,
              { borderColor: C.rule2, backgroundColor: C.bgRecessed },
            ]}>
            {local.hasPhoto ? (
              local.photoUri !== null ? (
                <ExpoImage
                  source={{ uri: local.photoUri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: C.live }]}>
                  <Text style={[styles.photoInitial, { color: C.onLive }]}>{initial}</Text>
                </View>
              )
            ) : (
              <>
                <ImageIcon size={22} color={C.ink3} strokeWidth={2} />
                <Text style={[styles.slotLabel, { color: C.ink3 }]}>ADD PHOTO</Text>
              </>
            )}
          </Pressable>

          <View style={styles.mediaColumn}>
            <Pressable
              onPress={toggleVideo}
              accessibilityRole="button"
              accessibilityLabel={
                local.hasVideo ? 'Replace your profile video' : 'Add a profile video'
              }
              style={[styles.videoSlot, { borderColor: C.rule3 }]}>
              <Video size={18} color={local.hasVideo ? C.liveText : C.ink3} strokeWidth={2} />
              <Text
                style={[styles.slotLabel, { color: local.hasVideo ? C.liveText : C.ink3 }]}
                numberOfLines={1}>
                {local.hasVideo ? 'LOOP · 4s · REPLACE' : 'ADD A PROFILE VIDEO'}
              </Text>
            </Pressable>
            <Text style={[styles.helper, { color: C.ink3 }]}>
              A 2–6 second loop plays behind your avatar when someone opens your profile.
            </Text>
          </View>
        </View>

        {/* --------------------------------------------------- name + handle */}
        <View style={[styles.block, { borderBottomColor: C.rule }]}>
          <SectionLabel text="DISPLAY NAME & HANDLE" color={C.ink3} style={styles.labelGap} />
          <View style={styles.nameRow}>
            <TextInput
              value={name}
              onChangeText={setTypedName}
              placeholder="Your name"
              placeholderTextColor={C.ink3}
              selectionColor={C.ink}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="Display name"
              style={[
                styles.field,
                styles.nameField,
                { backgroundColor: C.surface, borderColor: C.rule2, color: C.ink },
              ]}
            />
            <View style={[styles.handle, { backgroundColor: C.surface, borderColor: C.rule2 }]}>
              <Text style={[styles.handleText, { color: C.ink2 }]}>{handle}</Text>
            </View>
          </View>

          <SectionLabel text="BIO" color={C.ink3} style={styles.bioLabel} />
          <TextInput
            value={local.bio}
            onChangeText={(next) => local.update({ bio: next })}
            placeholder="One line. What do you put on?"
            placeholderTextColor={C.ink3}
            selectionColor={C.ink}
            multiline
            maxLength={BIO_MAX}
            textAlignVertical="top"
            accessibilityLabel="Bio"
            style={[
              styles.field,
              styles.bioField,
              { backgroundColor: C.surface, borderColor: C.rule2, color: C.ink },
            ]}
          />
        </View>

        {/* -------------------------------------------------------- activity */}
        <View style={[styles.activityRow, { borderBottomColor: C.rule }]}>
          <View style={styles.activityCopy}>
            <Text style={[styles.activityTitle, { color: C.ink }]}>Show when I&apos;m active</Text>
            <Text style={[styles.helper, { color: C.ink2 }]}>
              A live dot on your avatar and your track on the Feed. Turn it off and you go quiet
              everywhere.
            </Text>
          </View>
          <Pressable
            onPress={() => local.update({ showActivity: !local.showActivity })}
            accessibilityRole="switch"
            accessibilityState={{ checked: local.showActivity }}
            accessibilityLabel="Show when I'm active"
            style={styles.switchTarget}>
            <View
              style={[
                styles.switchTrack,
                {
                  borderColor: C.rule2,
                  backgroundColor: local.showActivity ? C.live : C.surface3,
                },
              ]}>
              <View
                style={[
                  styles.switchKnob,
                  { backgroundColor: C.ink, left: local.showActivity ? KNOB_ON : KNOB_OFF },
                ]}
              />
            </View>
          </Pressable>
        </View>

        {/* ------------------------------------------------------- providers */}
        <View style={[styles.providerRow, { borderBottomColor: C.rule }]}>
          <ProviderCard
            C={C}
            provider="SPOTIFY"
            status={profile?.spotify_linked ? 'LINKED' : 'NOT LINKED'}
            chip={profile?.is_premium ? 'PREMIUM' : undefined}
            note={profile?.is_premium ? undefined : 'Free tier'}
            accent={false}
          />
          <ProviderCard
            C={C}
            provider="YOUTUBE"
            status="SIGNED IN"
            note="No account needed"
            accent
          />
        </View>

        {/* ------------------------------------------------------------ gate */}
        <View style={[styles.gate, { borderColor: C.rule2 }]}>
          <SectionLabel text="BEFORE YOU CAN LOOK AROUND" color={C.ink3} />
          <CheckRow C={C} done={local.hasPhoto} label="Add a photo" />
          <CheckRow C={C} done={local.hasBio} label="Write a one-line bio" />
          <Text style={[styles.gateNote, { color: C.ink3 }]}>
            Lounges, chat and the Feed stay closed until both are done. Aux is a room full of
            people — nobody wants a blank square in it.
          </Text>
        </View>

        {ready ? (
          <Pressable
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="Save profile and enter Aux"
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: pressed ? C.liveText : C.live },
            ]}>
            <Text style={[styles.ctaLabel, { color: C.onLive }]}>SAVE PROFILE &amp; ENTER AUX</Text>
          </Pressable>
        ) : (
          /*
            Rendered, not hidden: the button has to stay where it is so the two
            unfinished checklist rows above it read as the reason it is dim.
          */
          <View
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Save profile and enter Aux, unavailable until the checklist above is done"
            style={[styles.cta, styles.ctaDisabled, { borderColor: C.rule2 }]}>
            <Text style={[styles.ctaLabel, { color: C.ink3 }]}>SAVE PROFILE &amp; ENTER AUX</Text>
          </View>
        )}
      </Animated.ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: Space.md,
    paddingVertical: 14,
    // 2px: the title block is a major section boundary, not a list hairline.
    borderBottomWidth: Rule.major,
  },
  title: {
    ...Type.display(26),
    letterSpacing: -0.65,
    marginTop: Space.xs,
  },
  sectionLabel: {
    ...Type.label(10),
    letterSpacing: 1.2,
  },
  labelGap: { marginBottom: 6 },
  bioLabel: { marginTop: 14, marginBottom: 6 },

  mediaRow: {
    flexDirection: 'row',
    gap: Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: 14,
    borderBottomWidth: Rule.hair,
  },
  photoSlot: {
    width: PHOTO_SLOT,
    height: PHOTO_SLOT,
    flexShrink: 0,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    overflow: 'hidden',
  },
  photoInitial: {
    ...Type.display(40),
  },
  mediaColumn: {
    flex: 1,
    minWidth: 0,
    gap: Space.sm,
  },
  videoSlot: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderWidth: Rule.hair,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: 10,
  },
  slotLabel: {
    ...Type.label(10),
    letterSpacing: 0.9,
    textAlign: 'center',
    flexShrink: 1,
  },
  helper: {
    ...Type.body(11),
    lineHeight: 16,
  },

  block: {
    paddingHorizontal: Space.md,
    paddingVertical: 14,
    borderBottomWidth: Rule.hair,
  },
  nameRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  field: {
    borderWidth: Rule.hair,
    ...Type.body(16),
  },
  nameField: {
    flex: 1,
    minWidth: 0,
    height: FIELD_HEIGHT,
    paddingHorizontal: Space.md,
  },
  handle: {
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderWidth: Rule.hair,
  },
  handleText: {
    ...Type.heading(14),
    letterSpacing: 0,
  },
  bioField: {
    height: BIO_HEIGHT,
    paddingHorizontal: Space.md,
    paddingVertical: 10,
  },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: 14,
    borderBottomWidth: Rule.hair,
  },
  activityCopy: { flex: 1, minWidth: 0, gap: 2 },
  activityTitle: {
    ...Type.heading(14),
    letterSpacing: 0.2,
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
    borderWidth: Rule.hair,
    justifyContent: 'center',
  },
  switchKnob: {
    position: 'absolute',
    top: 2,
    width: KNOB,
    height: KNOB,
  },

  providerRow: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: 14,
    borderBottomWidth: Rule.hair,
  },
  providerCard: {
    flex: 1,
    borderWidth: Rule.hair,
    padding: 10,
    alignItems: 'flex-start',
  },
  providerName: {
    ...Type.label(10),
    letterSpacing: 1,
  },
  providerStatus: {
    ...Type.heading(12),
    letterSpacing: 0.2,
    marginTop: Space.xs,
  },
  providerNote: {
    ...Type.body(11),
    lineHeight: 15,
    marginTop: 3,
  },
  chip: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 3,
  },
  chipText: {
    ...Type.heading(10),
    letterSpacing: 0.9,
  },

  gate: {
    marginHorizontal: Space.md,
    marginTop: Space.lg,
    borderWidth: Rule.hair,
    padding: Space.md,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 10,
  },
  tick: {
    width: TICK,
    height: TICK,
    flexShrink: 0,
  },
  checkLabel: {
    ...Type.body(14),
  },
  gateNote: {
    ...Type.body(12),
    lineHeight: 18,
    marginTop: 10,
  },

  cta: {
    marginHorizontal: Space.md,
    marginTop: Space.md,
    marginBottom: Space.xxl,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  ctaDisabled: {
    borderWidth: Rule.hair,
    opacity: 0.55,
  },
  ctaLabel: {
    ...Type.heading(13),
    letterSpacing: 1.3,
  },
});
