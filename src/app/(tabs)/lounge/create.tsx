/**
 * Starting a lounge.
 *
 * A back tile and a title, then kicker / field / kicker / field / a segmented
 * choice, and the inverted pill at the bottom. Every field is a surface with a
 * hairline; the visibility control is the design's segmented track — a recessed
 * well with a RAISED tile riding in it, which is the one place `pressed()` is
 * used on this screen because a full-width track is big enough to show both
 * halves of the inset pair.
 *
 * CREATE is not the accent. Making a lounge is not a live state, and the red
 * has to keep meaning one. The panel that follows is where the invite code
 * lives, and that gets the loudest readout in the app: a community starts as
 * eight characters somebody reads out over a room.
 *
 * All four states are here: the empty form, the form being filled, the submit
 * in flight (every control inert, the button spinning), and the database
 * refusing — quoted verbatim, with the retry beside it.
 */

import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';

import { Screen, useToast } from '@/components/ui';
import { shareInviteCode } from '@/features/lounges/invite';
import { loungeErrorMessage, useCreateLounge } from '@/features/lounges/queries';
import type { LoungeRow } from '@/lib/database.types';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  dropped,
  pressed as pressedWell,
  raised,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Mirrors the `char_length(name) between 2 and 50` check on `lounges`. */
const NAME_MIN = 2;
const NAME_MAX = 50;
const DESCRIPTION_MAX = 200;

const BACK_TILE = 38;
const BACK_SLOP = { top: 3, bottom: 3, left: 6, right: 6 };

const CODE_SIZE = 32;
const CODE_TRACKING = tracking(CODE_SIZE, 0.14);

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

const VISIBILITY = [
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Private' },
];

const VISIBILITY_HINT: Record<string, string> = {
  public: 'Anyone can find it in Explore and join.',
  private: 'Invite-only. Hidden until someone redeems the code.',
};

export default function CreateLoungeScreen() {
  const C = useColors();
  const toast = useToast();
  const create = useCreateLounge();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<LoungeRow | null>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/lounges');
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN) {
      setNameError(`Give it at least ${NAME_MIN} characters.`);
      return;
    }

    setNameError(null);
    setFailure(null);
    create.mutate(
      { name: trimmed, description: description.trim(), isPublic: visibility === 'public' },
      {
        onSuccess: (lounge) => setCreated(lounge),
        onError: (error) => {
          /*
            Kept verbatim and shown in place, not paraphrased. A private lounge
            currently fails on a row-level-security policy the owner cannot see
            their own insert through, and rewriting that into "Something went
            wrong" would hide the one sentence that says which policy.
          */
          const message = loungeErrorMessage(error, 'Could not create the lounge.');
          setFailure(message);
          toast.show(message, 'error');
        },
      },
    );
  }, [create, description, name, toast, visibility]);

  if (created) {
    return <CreatedPanel lounge={created} onBack={handleBack} />;
  }

  const busy = create.isPending;

  return (
    <Screen padded={false} scroll>
      <View style={styles.page}>
        <Head title="New lounge" onBack={handleBack} label="Cancel" />

        <Text style={[styles.kicker, { color: C.ink3 }]}>Name</Text>
        <Field
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameError(null);
          }}
          placeholder="Late Night Rotation"
          maxLength={NAME_MAX}
          accessibilityLabel="Name"
          editable={!busy}
          invalid={nameError !== null}
          strong
        />
        {nameError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: C.liveText }]}>
            {nameError}
          </Text>
        ) : null}

        <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>
          Description — optional
        </Text>
        <Field
          value={description}
          onChangeText={setDescription}
          placeholder="What gets played here?"
          maxLength={DESCRIPTION_MAX}
          accessibilityLabel="Description, optional"
          editable={!busy}
          multiline
        />

        <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>Visibility</Text>

        {/*
          The design's segmented track: a recessed well with a raised tile
          riding in it. Full width, so both halves of the inset pair land — this
          is the size the recipe is FOR.
        */}
        <View style={[styles.track, { backgroundColor: C.bgRecessed }, pressedWell(C)]}>
          {VISIBILITY.map((option) => {
            const active = visibility === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active, disabled: busy }}
                accessibilityLabel={option.label}
                disabled={busy}
                onPress={() => setVisibility(option.key)}
                style={[
                  styles.segment,
                  active ? { backgroundColor: C.surface } : null,
                  active ? raised(C) : null,
                ]}>
                <Text style={[styles.segmentLabel, { color: active ? C.ink : C.ink2 }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.note, { color: C.ink3 }]}>{VISIBILITY_HINT[visibility]}</Text>

        {failure ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.failure, { borderColor: C.live, backgroundColor: C.dangerWash }]}>
            <Text style={[styles.failureKicker, { color: C.liveText }]}>The database said no</Text>
            <Text style={[styles.failureText, { color: C.ink }]}>{failure}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.failureAction,
                { backgroundColor: pressed ? C.cream : C.pill },
              ]}>
              <Text style={[styles.failureActionLabel, { color: C.pillInk }]}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.submit}>
          <PrimaryButton
            label="Create lounge"
            busy={busy}
            disabled={name.trim().length < NAME_MIN}
            onPress={handleSubmit}
          />
        </View>
      </View>
    </Screen>
  );
}

/**
 * The invite code is shown here, before navigating on, and not merely on the
 * lounge screen. A code the founder never sees is a community with no way in.
 */
function CreatedPanel({ lounge, onBack }: { lounge: LoungeRow; onBack: () => void }) {
  const C = useColors();
  const toast = useToast();

  const handleShare = useCallback(async () => {
    try {
      const result = await shareInviteCode(lounge.name, lounge.invite_code);
      if (result === 'copied') toast.show(`Invite code ${lounge.invite_code} copied`, 'success');
      else if (result === 'shared') toast.show('Invite sent', 'success');
    } catch (error) {
      toast.show(loungeErrorMessage(error, 'Could not share the invite.'), 'error');
    }
  }, [lounge, toast]);

  return (
    <Screen padded={false} scroll>
      <View style={styles.page}>
        <Head title={`${lounge.name} is live`} onBack={onBack} label="Done" />

        <Text style={[styles.kicker, { color: C.ink3 }]}>Invite code</Text>

        {/* A well big enough for the inset pair to read as depth rather than dirt. */}
        <View style={[styles.codeWell, { backgroundColor: C.bgRecessed }, pressedWell(C)]}>
          <Text selectable style={[styles.code, { color: C.liveText }]}>
            {lounge.invite_code}
          </Text>
        </View>

        <View style={styles.submit}>
          <PrimaryButton label="Share invite code" onPress={() => void handleShare()} />
          <Text style={[styles.note, { color: C.ink3 }]}>
            {Platform.OS === 'web' ? 'Copies it to your clipboard.' : 'Opens your share sheet.'}
          </Text>

          <SecondaryButton
            label="Open lounge"
            // `replace`, so backing out of the lounge does not land on this panel
            // for a lounge that already exists.
            onPress={() => router.replace(`/lounge/${lounge.id}`)}
          />
        </View>
      </View>
    </Screen>
  );
}

/* ------------------------------------------------------------------ parts */

/** The design's header: a raised back tile, then the title. */
function Head({ title, onBack, label }: { title: string; onBack: () => void; label: string }) {
  const C = useColors();

  return (
    <View style={styles.head}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={BACK_SLOP}
        onPress={onBack}
        style={({ pressed }) => [
          styles.backTile,
          { backgroundColor: pressed ? C.surface2 : C.surface },
          raised(C),
        ]}>
        <ChevronLeft size={20} strokeWidth={2.4} color={C.ink} />
      </Pressable>
      <Text numberOfLines={2} style={[styles.title, { color: C.ink }]}>
        {title}
      </Text>
    </View>
  );
}

/**
 * A field is a surface with a hairline, NOT an inset well. At 52px the light
 * half of the pressed pair sits at 3.2% alpha on a dark ground and only the
 * dark half lands, which reads as dirt. Focus swaps the border to full-strength
 * ink and never changes its width, so nothing shifts by a pixel.
 */
function Field({
  value,
  onChangeText,
  placeholder,
  maxLength,
  accessibilityLabel,
  editable = true,
  invalid = false,
  multiline = false,
  strong = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  maxLength: number;
  accessibilityLabel: string;
  editable?: boolean;
  invalid?: boolean;
  multiline?: boolean;
  strong?: boolean;
}) {
  const C = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor={C.ink3}
      maxLength={maxLength}
      multiline={multiline}
      editable={editable}
      textAlignVertical={multiline ? 'top' : 'center'}
      selectionColor={C.live}
      accessibilityLabel={accessibilityLabel}
      style={[
        strong ? styles.fieldStrong : styles.field,
        multiline && styles.fieldMultiline,
        {
          color: C.ink,
          backgroundColor: C.surface,
          borderColor: invalid ? C.live : focused ? C.rule3 : C.rule,
        },
        editable ? null : styles.dim,
      ]}
    />
  );
}

/** The inverted pill — the design's one primary action shape. */
function PrimaryButton({
  label,
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const C = useColors();
  const blocked = busy || disabled;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: pressed ? C.cream : C.pill },
        dropped(C, 'lg'),
        blocked && styles.dim,
      ]}>
      {busy ? <ActivityIndicator size="small" color={C.pillInk} /> : null}
      <Text numberOfLines={1} style={[styles.primaryLabel, { color: C.pillInk }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A raised surface cell, for the second-choice action under a primary one. */
function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondary,
        { backgroundColor: pressed ? C.surface2 : C.surface },
        raised(C),
      ]}>
      <Text numberOfLines={1} style={[styles.primaryLabel, { color: C.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.md,
    paddingBottom: Space.xxxl,
  },
  dim: {
    opacity: 0.55,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: Space.xl,
  },
  backTile: {
    width: BACK_TILE,
    height: BACK_TILE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    ...Type.display(24),
    letterSpacing: tracking(24, -0.03),
  },

  kicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
    marginBottom: Space.sm,
  },
  kickerSpaced: {
    marginTop: Space.xl,
  },

  field: {
    ...Type.body(15),
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: 0,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  fieldStrong: {
    // The name is the thing being made, so it is set a step up in weight.
    fontFamily: Fonts.semibold,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: 0,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  fieldMultiline: {
    minHeight: 88,
    paddingVertical: Space.md,
  },
  fieldError: {
    ...Type.body(12.5),
    marginTop: Space.sm,
  },

  track: {
    flexDirection: 'row',
    gap: 6,
    padding: 6,
    borderRadius: Radii.lg,
  },
  segment: {
    flex: 1,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm + 1,
  },
  segmentLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: tracking(12.5, 0.06),
  },
  note: {
    ...Type.body(12.5),
    marginTop: 11,
  },

  failure: {
    marginTop: Space.xl,
    padding: Space.lg,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    gap: Space.sm,
    alignItems: 'flex-start',
  },
  failureKicker: {
    ...Type.label(10.5),
    letterSpacing: tracking(10.5, 0.15),
  },
  failureText: {
    ...Type.body(13),
  },
  failureAction: {
    minHeight: 40,
    justifyContent: 'center',
    marginTop: Space.xs,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.xs,
  },
  failureActionLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12.5,
    lineHeight: 16,
  },

  submit: {
    marginTop: Space.xxl,
    gap: Space.md,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm + 2,
    minHeight: 56,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.button,
  },
  primaryLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.button,
  },

  codeWell: {
    alignItems: 'center',
    justifyContent: 'center',
    // Tall enough that the inset pair reads as a well and not as a smudge.
    minHeight: 96,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.lg,
  },
  code: {
    ...readout(CODE_SIZE),
    letterSpacing: CODE_TRACKING,
    // Tracking leaves a gap after the last glyph; pulling it back keeps the
    // string optically centred in the well.
    marginRight: -CODE_TRACKING,
  },
});
