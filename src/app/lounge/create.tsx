/**
 * Starting a lounge.
 *
 * A form, drawn flat: kicker, field, kicker, field, a segmented choice, and one
 * accent cell at the bottom. No cards, no radius, no shadow — separation is the
 * 1px rule around each field and the gap between blocks.
 *
 * The created panel that follows is where the invite code lives, and it gets
 * the loudest readout in the app: a community starts as eight characters
 * somebody reads out over a room.
 */

import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
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
import { Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Mirrors the `char_length(name) between 2 and 50` check on `lounges`. */
const NAME_MIN = 2;
const NAME_MAX = 50;
const DESCRIPTION_MAX = 200;

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
  public: 'Anyone can find this lounge in Explore and join it.',
  private: 'Invite-only. It stays hidden until someone redeems the code.',
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

  return (
    <Screen padded={false} scroll>
      <View style={styles.page}>
        <BackRow label="CANCEL" onPress={handleBack} />

        <Text style={[styles.title, { color: C.ink }]}>New lounge</Text>

        <Text style={[styles.kicker, { color: C.ink3 }]}>NAME</Text>
        <Field
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameError(null);
          }}
          placeholder="Late Night Rotation"
          maxLength={NAME_MAX}
          accessibilityLabel="Name"
          strong
        />
        {nameError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.fieldError, { color: C.danger }]}>
            {nameError}
          </Text>
        ) : null}

        <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>
          DESCRIPTION (OPTIONAL)
        </Text>
        <Field
          value={description}
          onChangeText={setDescription}
          placeholder="What gets played here?"
          maxLength={DESCRIPTION_MAX}
          accessibilityLabel="Description (optional)"
          multiline
        />

        <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>VISIBILITY</Text>
        <View style={[styles.segmented, { borderColor: C.rule3 }]}>
          {VISIBILITY.map((option, index) => {
            const active = visibility === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={option.label}
                onPress={() => setVisibility(option.key)}
                style={[
                  styles.segment,
                  index > 0 && { borderLeftWidth: Rule.hair, borderLeftColor: C.rule3 },
                  active && { backgroundColor: C.live },
                ]}>
                <Text
                  style={[
                    active ? styles.segmentLabelActive : styles.segmentLabel,
                    { color: active ? C.onLive : C.ink2 },
                  ]}>
                  {option.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.note, { color: C.ink3 }]}>{VISIBILITY_HINT[visibility]}</Text>

        {failure ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.failure, { borderColor: C.dangerBorder, backgroundColor: C.dangerWash }]}>
            <Text style={[styles.failureKicker, { color: C.danger }]}>THE DATABASE SAID NO</Text>
            <Text style={[styles.failureText, { color: C.ink }]}>{failure}</Text>
          </View>
        ) : null}

        <View style={styles.submit}>
          <ActionCell
            label="CREATE LOUNGE"
            tone="accent"
            height={52}
            busy={create.isPending}
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
        <BackRow label="DONE" onPress={onBack} />

        <Text style={[styles.kicker, { color: C.ink3 }]}>LOUNGE CREATED</Text>
        <Text style={[styles.title, { color: C.ink }]}>{lounge.name} is live</Text>
        <Text style={[styles.body, { color: C.ink2 }]}>
          Share this code to let people in. You can find it again from the lounge header.
        </Text>

        <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>INVITE CODE</Text>
        <View style={[styles.codeFrame, { borderColor: C.live }]}>
          <Text selectable style={[styles.code, { color: C.liveText }]}>
            {lounge.invite_code}
          </Text>
        </View>

        <View style={styles.submit}>
          <ActionCell
            label="SHARE INVITE CODE"
            tone="accent"
            height={52}
            onPress={() => void handleShare()}
          />
          <Text style={[styles.note, { color: C.ink3 }]}>
            {Platform.OS === 'web'
              ? 'Copies the code to your clipboard.'
              : 'Opens your share sheet with the code in the message.'}
          </Text>

          <ActionCell
            label="OPEN LOUNGE"
            tone="outline"
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

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.backRow, pressed && styles.dim]}>
      <ArrowLeft size={15} color={C.ink2} strokeWidth={2} />
      <Text style={[styles.backLabel, { color: C.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A field is a rule around a surface. Focus swaps the border to full-strength
 * ink rather than to accent: typing a name is not a live thing, and the border
 * never changes width, so nothing shifts by a pixel when the field is touched.
 */
function Field({
  value,
  onChangeText,
  placeholder,
  maxLength,
  accessibilityLabel,
  multiline = false,
  strong = false,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  maxLength: number;
  accessibilityLabel: string;
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
      textAlignVertical={multiline ? 'top' : 'center'}
      selectionColor={C.live}
      accessibilityLabel={accessibilityLabel}
      style={[
        strong ? styles.fieldStrong : styles.field,
        multiline && styles.fieldMultiline,
        {
          color: C.ink,
          backgroundColor: C.surface,
          borderColor: focused ? C.ink : C.rule2,
        },
      ]}
    />
  );
}

type Tone = 'accent' | 'outline';

/** Flat, square, full-width. The same cell the lounge screen uses. */
function ActionCell({
  label,
  tone,
  onPress,
  height = 48,
  busy = false,
  disabled = false,
}: {
  label: string;
  tone: Tone;
  onPress: () => void;
  height?: number;
  busy?: boolean;
  disabled?: boolean;
}) {
  const C = useColors();
  const blocked = busy || disabled;
  const fill = tone === 'accent';
  const ink = fill ? C.onLive : C.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionCell,
        { minHeight: height },
        fill
          ? { backgroundColor: pressed ? C.liveText : C.live, borderColor: 'transparent' }
          : { borderColor: C.rule2, backgroundColor: pressed ? C.surface : 'transparent' },
        blocked && styles.dim,
      ]}>
      {busy ? <ActivityIndicator size="small" color={ink} /> : null}
      <Text numberOfLines={1} style={[styles.actionLabel, { color: ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: Space.md,
    paddingTop: Space.lg,
    paddingBottom: Space.xxl,
  },
  dim: {
    opacity: 0.55,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: TOUCH_TARGET,
    alignSelf: 'flex-start',
    paddingRight: Space.md,
  },
  backLabel: {
    ...Type.label(11),
  },
  title: {
    ...Type.display(26),
    marginTop: Space.xs,
    marginBottom: Space.lg,
  },
  kicker: {
    ...Type.label(10),
    marginBottom: 6,
  },
  kickerSpaced: {
    marginTop: Space.lg,
  },
  body: {
    ...Type.body(14),
    marginTop: -Space.sm,
    marginBottom: Space.sm,
  },
  field: {
    ...Type.body(16),
    minHeight: 48,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    borderWidth: Rule.hair,
  },
  fieldStrong: {
    // The name is the thing being made, so it is set in the display weight.
    ...Type.heading(16),
    letterSpacing: tracking(16, 0.02),
    minHeight: 48,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    borderWidth: Rule.hair,
  },
  fieldMultiline: {
    minHeight: 80,
    paddingVertical: 10,
  },
  fieldError: {
    ...Type.body(12),
    marginTop: 6,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: Rule.hair,
  },
  segment: {
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  segmentLabel: {
    ...Type.label(11),
    letterSpacing: tracking(11, 0.08),
  },
  segmentLabelActive: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.08),
  },
  note: {
    ...Type.body(12),
    marginTop: Space.sm,
  },
  failure: {
    marginTop: Space.lg,
    padding: Space.md,
    borderWidth: Rule.hair,
    gap: 6,
  },
  failureKicker: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
  failureText: {
    ...Type.body(13),
  },
  submit: {
    marginTop: Space.xl,
    gap: Space.md,
  },
  actionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.1),
  },
  codeFrame: {
    borderWidth: Rule.major,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xl,
  },
  code: {
    ...readout(CODE_SIZE),
    letterSpacing: CODE_TRACKING,
    // Tracking leaves a gap after the last glyph; pulling it back keeps the
    // string flush against the frame as drawn.
    marginRight: -CODE_TRACKING,
  },
});
