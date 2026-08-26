/**
 * Profile setup — the gate.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen `isNewProfile`
 * (L169-227): the 82px identity tile with its camera badge, the dashed video
 * slot beside it, one card holding the name and the bio, the activity toggle,
 * and a CTA that changes its own copy when it cannot be pressed.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE GATE IS A MUSIC SERVICE. IT USED TO BE A PHOTO AND A BIO, AND THAT WAS
 * BACKWARDS.
 *
 * This file's previous header argued the inversion at length: "THE GATE IS
 * PHOTO + BIO, NOT A LINKED PROVIDER … inverting it here would let people
 * through a door the shell still holds shut", and dropped the provider section
 * entirely. The reasoning was circular — the shell held that door shut only
 * because this screen told it to — and the requirement it defended was the
 * wrong one. A photo and a line about you are how people present themselves.
 * Neither is needed to hear a song. What Aux genuinely cannot proceed without
 * is somewhere for the audio to come from, which is exactly what the design
 * gates on ("LINK ONE TO PLAY — REQUIRED") and exactly what that pass deleted.
 *
 * So the provider section is back, it is required, and the photo and the bio
 * are optional. `useLocalProfile().complete` is now `musicService !== null`;
 * see `@/lib/providers`.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * AND MOST PEOPLE NEVER SEE THE QUESTION. Signing in already answers it —
 * Google means YouTube, Spotify means Spotify (see `musicServiceForUser` in
 * `@/lib/auth`). When the session settled it, this screen SHOWS the answer with
 * a tick instead of asking something it already knows. Only an email-and-
 * password account is asked, because only that account has not said.
 *
 * BE HONEST ABOUT YOUTUBE. Signing in with Google does not link a YouTube
 * account, because there is no YouTube account to link: playback here is the
 * IFrame player and it never asks anyone to sign in. "Google settles YouTube"
 * is a fact about the QUESTION being answered, not about an OAuth grant, and
 * the settled card says so in as many words rather than implying a connection
 * that does not exist.
 *
 * APPLE MUSIC IS DRAWN AND DISABLED. MusicKit is iOS and web only, there is no
 * Expo module for it, and Supabase has no apple-music auth provider — so there
 * is neither a sign-in to offer nor an adapter to write. It is shown as a
 * locked row rather than omitted, because a missing option reads as an app that
 * forgot Apple Music and a locked one reads as an app that knows.
 *
 * TWO REMAINING DEVIATIONS FROM THE ARTBOARD:
 *
 * 1. NO SEPARATE CHECKLIST TICKS on the optional cards. The disabled CTA names
 *    the one unmet condition outright, which says the same thing once, at the
 *    moment it matters, where the reader is already looking.
 * 2. The screen SCROLLS. The artboard is a fixed column with a flex spacer,
 *    which only fits because it was drawn on one 402x874 frame — with a
 *    keyboard up on a small phone the bio well would be off-screen.
 *
 * TODO(schema): `profiles` has no `music_service`, `bio`, photo, profile-video
 * or activity-visibility column yet, so everything except the display name is
 * held locally by `useLocalProfile` (AsyncStorage). The migration those fields
 * need is written out in `src/lib/providers.tsx`. `expo-image-picker` is not a
 * dependency either, so the photo tile and the video slot fill a placeholder
 * rather than opening a picker — wiring a real picker means setting `photoUri`
 * / `videoUri` alongside the flag and changing nothing else here.
 */

import { useRouter } from 'expo-router';
import {
  Apple,
  Camera,
  Check,
  Disc3,
  Lock,
  Play,
  Video,
  type LucideIcon,
} from 'lucide-react-native';
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
import {
  MUSIC_SERVICE_SUPPORTED,
  sourcePreferenceForService,
  usePlayback,
  type MusicService,
} from '@/playback/store';

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

/** The provider rows — design L206-214: a 34px glyph chip inside a 62px row. */
const SERVICE_ROW = 62;
const SERVICE_CHIP = 34;
const SERVICE_TICK = 22;
const SERVICE_DOT = 18;
/** The settled card's tick. */
const SETTLED_TICK = 26;

/** The switch, straight off the artboard: a 44x26 track with an 18px knob. */
const SWITCH_WIDTH = 44;
const SWITCH_HEIGHT = 26;
const KNOB = 18;

type ServiceOption = {
  id: MusicService;
  label: string;
  caption: string;
  icon: LucideIcon;
};

/**
 * The three services, in the order the design lists them.
 *
 * The glyphs are GENERIC, not brand marks: the lucide build in this repo ships
 * no Spotify or YouTube logo, and a hand-drawn approximation of a trademark is
 * worse than an honest abstraction. A play triangle, a disc and an apple read
 * correctly beside their own labels.
 */
const SERVICES: readonly ServiceOption[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    caption: 'No account, nothing to link. This is what Aux plays by default.',
    icon: Play,
  },
  {
    id: 'spotify',
    label: 'Spotify',
    caption: 'Link it from Settings to hear the master on Premium.',
    icon: Disc3,
  },
  {
    id: 'apple-music',
    label: 'Apple Music',
    caption: 'MusicKit is iPhone and web only. Not buildable here yet.',
    icon: Apple,
  },
];

/**
 * What the settled card says, per service.
 *
 * Both halves are literally true and neither claims a link that does not exist
 * — see the file header. Keyed by the two services an identity provider can
 * actually settle; Apple Music is not one of them and never will be here.
 */
const SETTLED: Record<'youtube' | 'spotify', { title: string; note: string }> = {
  youtube: {
    title: 'YouTube is your source',
    note: 'You signed in with Google, so this is already settled. There is nothing to link either way: Aux plays YouTube through an embedded player that never asks anyone to sign in.',
  },
  spotify: {
    title: 'Spotify is your service',
    note: 'You signed in with Spotify, so this is already settled. Letting Aux drive playback is a separate one-tap link in Settings and needs Premium — until then you hear the same YouTube audio as everyone else.',
  },
};

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

  /**
   * Answering the required question.
   *
   * Writes BOTH halves, because they are two different facts: the draft records
   * what this person said their service is (the gate), and the playback store
   * records how audio should therefore be routed. `setSourcePreference` rather
   * than `adoptServiceDefault` — this is an explicit answer, so it is allowed to
   * overwrite an earlier one, which is what makes changing your mind here work.
   */
  const pickService = useCallback(
    (service: MusicService) => {
      // Belt and braces: the row is already disabled, but nothing in this app
      // should be able to select a service with no adapter behind it.
      if (!MUSIC_SERVICE_SUPPORTED[service]) return;
      local.update({ musicService: service });
      usePlayback.getState().setSourcePreference(sourcePreferenceForService(service));
    },
    [local]
  );

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

  /*
    A provider can only ever settle 'youtube' or 'spotify', but the value is
    typed across all three services, so look it up and fall back rather than
    assert — an assertion here would be a crash the day the union grows.
  */
  const settled =
    local.musicService === 'spotify' || local.musicService === 'youtube'
      ? SETTLED[local.musicService]
      : null;
  const showSettled = local.serviceFromProvider && settled !== null;

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
          title="Where your music comes from"
          lede={
            showSettled
              ? 'Your sign-in already settled that. Everything below is optional.'
              : 'Pick one service. That is the only thing Aux needs — a photo and a line are optional.'
          }
          size={26}
        />

        {/* ---------------------------------------------- the required answer */}
        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: C.ink3 }]}>MUSIC</Text>
          {/*
            CORAL, and that is the accent rule rather than emphasis for its own
            sake: this tag reports a condition that is true of the form right
            now. It is not a thing you press, so it does not take the blue.
          */}
          <Text style={[styles.required, { color: C.liveText }]}>
            {showSettled ? 'DONE' : 'REQUIRED'}
          </Text>
        </View>

        {showSettled && settled ? (
          <View style={[styles.settled, { backgroundColor: C.liveWash, borderColor: C.liveMid }]}>
            <Done size={SETTLED_TICK} />
            <View style={styles.serviceCopy}>
              <Text style={[styles.serviceLabel, { color: C.ink }]}>{settled.title}</Text>
              <Text style={[styles.settledNote, { color: C.ink2 }]}>{settled.note}</Text>
            </View>
          </View>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.services}>
            {SERVICES.map((option) => (
              <ServiceRow
                key={option.id}
                option={option}
                selected={local.musicService === option.id}
                onSelect={pickService}
              />
            ))}
          </View>
        )}

        {/* --------------------------------------------- everything optional */}
        <Text style={[styles.section, styles.sectionAlone, { color: C.ink3 }]}>OPTIONAL</Text>

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
              <Video size={17} strokeWidth={2} color={local.hasVideo ? C.liveText : C.ink3} />
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

        {/* --------------------------------------------------- name and bio */}
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
            <View style={[styles.handle, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
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
          style={[
            styles.card,
            styles.activity,
            { backgroundColor: C.surface, borderColor: C.rule },
          ]}>
          <View style={styles.activityCopy}>
            <Text style={[styles.activityTitle, { color: C.ink }]}>Show when I&apos;m active</Text>
            <Text style={[styles.activityNote, { color: C.ink3 }]}>
              A live dot and your track on the Feed. Off means you never appear there.
            </Text>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: local.showActivity }}
            accessibilityLabel="Show when I am active"
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
          You can change how Aux picks a source any time from Settings → Connections.
        </Text>

        <View style={styles.spacer} />

        <PrimaryCta
          compact
          label="Save profile & enter aux"
          disabledLabel="Pick a music service"
          accessibilityLabel={
            local.complete
              ? 'Save profile and enter Aux'
              : 'Save profile and enter Aux, unavailable: pick a music service'
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

/* -------------------------------------------------------------------- parts */

/**
 * One service in the picker.
 *
 * BLUE ON THE SELECTED ROW, not coral, and that is the accent rule read the
 * same way `OnboardingSwitch` and the Connections segmented control read it: a
 * row you pick is a thing you DO. Coral is reserved on this screen for the
 * settled card above, which reports a fact nobody chose here.
 *
 * The glyph chip is `surface2` on `surface` — the one place in this row where
 * stacking two translucent fills is the point, because the chip has to read as
 * a disc set INTO the row rather than as a second object floating on it. Same
 * recipe as the provider button on Sign in.
 */
function ServiceRow({
  option,
  selected,
  onSelect,
}: {
  option: ServiceOption;
  selected: boolean;
  onSelect: (service: MusicService) => void;
}) {
  const C = useColors();
  const supported = MUSIC_SERVICE_SUPPORTED[option.id];
  const Glyph = option.icon;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !supported }}
      accessibilityLabel={
        supported
          ? `${option.label}. ${option.caption}`
          : `${option.label}, unavailable. ${option.caption}`
      }
      disabled={!supported}
      onPress={() => onSelect(option.id)}
      style={({ pressed }) => [
        styles.service,
        {
          borderColor: selected ? C.pill : C.rule,
          backgroundColor: selected || pressed ? C.surface2 : C.surface,
        },
        supported ? null : styles.blocked,
        pressed && supported ? styles.held : null,
      ]}>
      <View
        style={[
          styles.serviceChip,
          {
            backgroundColor: selected ? C.pill : C.surface2,
            borderColor: selected ? C.pill : C.rule,
          },
        ]}>
        <Glyph size={16} strokeWidth={2} color={selected ? C.pillInk : C.ink2} />
      </View>

      <View style={styles.serviceCopy}>
        <Text style={[styles.serviceLabel, { color: C.ink }]}>{option.label}</Text>
        <Text style={[styles.serviceNote, { color: C.ink3 }]}>{option.caption}</Text>
      </View>

      {/*
        Three end states, and the locked one is deliberately NOT the danger
        colour: Apple Music being unbuildable here is a fact about the platform,
        not a failure the reader caused or can do anything about.
      */}
      {!supported ? (
        <View style={[styles.serviceTag, { borderColor: C.rule }]}>
          <Lock size={11} strokeWidth={2.2} color={C.ink3} />
          <Text style={[styles.serviceTagLabel, { color: C.ink3 }]}>IPHONE</Text>
        </View>
      ) : selected ? (
        <View style={[styles.serviceTick, { backgroundColor: C.pill }]}>
          <Check size={13} strokeWidth={3} color={C.pillInk} />
        </View>
      ) : (
        <View style={[styles.serviceDot, { borderColor: C.rule3 }]} />
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ styles */

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

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Space.xl,
    marginBottom: 10,
  },
  section: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.16),
  },
  sectionAlone: {
    marginTop: Space.xxl,
    marginBottom: 2,
  },
  required: {
    ...Type.label(9.5),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9.5, 0.14),
  },

  services: {
    gap: Space.sm,
  },
  service: {
    minHeight: SERVICE_ROW,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  serviceChip: {
    width: SERVICE_CHIP,
    height: SERVICE_CHIP,
    flexShrink: 0,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceCopy: {
    flex: 1,
    minWidth: 0,
  },
  serviceLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    letterSpacing: tracking(14, -0.01),
  },
  serviceNote: {
    ...Type.body(10.5),
    lineHeight: 15,
    marginTop: 2,
  },
  serviceTick: {
    width: SERVICE_TICK,
    height: SERVICE_TICK,
    flexShrink: 0,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceDot: {
    width: SERVICE_DOT,
    height: SERVICE_DOT,
    flexShrink: 0,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  serviceTag: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.sm,
    paddingVertical: 4,
  },
  serviceTagLabel: {
    ...Type.label(9),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(9, 0.1),
  },

  settled: {
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    padding: 13,
  },
  settledNote: {
    ...Type.body(11.5),
    lineHeight: 17,
    marginTop: 4,
  },

  media: {
    flexDirection: 'row',
    gap: 11,
    marginTop: 10,
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
  blocked: {
    opacity: 0.55,
  },
});
