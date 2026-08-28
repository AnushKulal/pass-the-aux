/**
 * New Lounge.
 *
 * Built from design/nocturne/aux-nocturne.dc.html `isCreateL` (L523–L544): a
 * Cancel link, a 28px title, two radius-24 cards — the fields, then who can
 * join — and the gradient pill at the bottom. Nothing else. The direction's
 * whole answer to a form is that the CARD groups the fields and the page has no
 * chrome header at all, which is why this screen builds its own back link
 * instead of asking `Screen` for one.
 *
 * THE ACCENT SPEND. There is exactly one blue on this page at rest: the
 * selected segment. The CTA turns blue too, so the eye travels choice → action
 * down the same hue. Coral appears nowhere, because nothing here is happening
 * yet — making a lounge is an action, not a state, and the previous version of
 * this screen spent the reserved colour on the invite code and on a validation
 * message, which is precisely how the accent stops meaning "live".
 *
 * DELIBERATE DEVIATIONS FROM THE ARTBOARD:
 *  - The design's inputs are 700/16px. The shared `TextField` sets 400/15px and
 *    has no title register; the kit is the instruction here, so the field is the
 *    kit's. A `strong` (or `size="title"`) input is the kit change this screen
 *    wants — see the report.
 *  - The artboard prints one static line under the segmented control. Kept the
 *    per-state hint instead: the two options differ in where the lounge shows
 *    up, and one sentence covering both tells you neither.
 *  - The artboard draws only the empty form. All four real states survive: the
 *    form, the submit in flight (the fields go inert, the pill spins), the
 *    database refusing — quoted verbatim, with the retry beside it — and the
 *    panel that hands over the invite code.
 */

import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { useEnterStyle } from '@/components/auth/onboarding';
import { AuxButton, GlassCard, PillButton, Screen, TextField, useToast } from '@/components/ui';
import { shareInviteCode } from '@/features/lounges/invite';
import { loungeErrorMessage, useCreateLounge } from '@/features/lounges/queries';
import type { LoungeRow } from '@/lib/database.types';
import {
  Fonts,
  PointerEvents,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  pressed as pressedWell,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Mirrors the `char_length(name) between 2 and 50` check on `lounges`. */
const NAME_MIN = 2;
const NAME_MAX = 50;
const DESCRIPTION_MAX = 200;

/**
 * The artboard's own top padding (`padding:14px 18px 130px`). `Space` has no
 * 14 — `md` is 12 and `lg` is 16 — and the horizontal 18 already lives in
 * `Screen`'s gutter, so only this half needs holding locally.
 */
const TOP = 14;

const LINK_SLOP = { top: 6, bottom: 6, left: 8, right: 8 };

const CODE_SIZE = 32;
const CODE_TRACKING = tracking(CODE_SIZE, 0.14);

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/** L537–L538. The keys are the database's; only the labels are the design's. */
const VISIBILITY = [
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Invite only' },
];

const VISIBILITY_HINT: Record<string, string> = {
  public: 'Shows up in Explore. You still get an 8-character invite code.',
  private: 'Hidden until someone redeems the 8-character invite code.',
};

export default function CreateLoungeScreen() {
  const C = useColors();
  const toast = useToast();
  const create = useCreateLounge();
  const enter = useEnterStyle();

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

  const handleName = useCallback((value: string) => {
    setName(value);
    setNameError(null);
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
    <Screen scroll reserveDock ground={false}>
      <Animated.View style={[styles.body, enter]}>
        <CancelLink label="Cancel" onPress={handleBack} />
        <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
          New lounge
        </Text>

        {/*
          The whole form goes inert while the insert is in flight rather than
          each control being disabled one by one: `TextField` takes no
          `editable`, and a wrapper is honest about what is actually true —
          nothing on this page can be changed until the mutation answers.
          `pointerEvents` lives in the STYLE; RN 0.86 deprecated the prop.
        */}
        <View style={[styles.stack, busy && styles.inert, busy ? PointerEvents.none : null]}>
          <GlassCard>
            <View style={styles.cardStack}>
              <TextField
                label="Name"
                value={name}
                onChangeText={handleName}
                placeholder="The Back Room"
                maxLength={NAME_MAX}
                error={nameError ?? undefined}
              />
              <TextField
                label="Description — optional"
                value={description}
                onChangeText={setDescription}
                placeholder="What is this lounge for?"
                maxLength={DESCRIPTION_MAX}
                multiline
              />
            </View>
          </GlassCard>

          <GlassCard style={styles.card2}>
            <Text style={[styles.kicker, { color: C.ink3 }]}>Who can join</Text>
            <Segmented value={visibility} onChange={setVisibility} disabled={busy} />
            <Text style={[styles.note, { color: C.ink3 }]}>{VISIBILITY_HINT[visibility]}</Text>
          </GlassCard>
        </View>

        {failure ? (
          /*
            `danger` and not `live`. Destruction regained its own hue in this
            direction, and a refusal is the one thing on the screen that is
            neither an action (blue) nor a live state (coral). The retry inside
            it stays a QUIET bordered cell — a blue pill here would compete with
            the CTA six inches below it that performs the identical mutation.
          */
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.failure,
              { backgroundColor: C.dangerWash, borderColor: C.dangerBorder },
            ]}>
            <Text style={[styles.kicker, { color: C.danger }]}>The database said no</Text>
            <Text style={[styles.failureText, { color: C.ink }]}>{failure}</Text>
            <AuxButton label="Try again" onPress={handleSubmit} variant="bordered" size="sm" />
          </View>
        ) : null}

        <View style={styles.submit}>
          <PillButton
            label="Create lounge"
            onPress={handleSubmit}
            loading={busy}
            disabled={name.trim().length < NAME_MIN}
          />
        </View>
      </Animated.View>
    </Screen>
  );
}

/**
 * The invite code is shown here, before navigating on, and not merely on the
 * lounge screen. A code the founder never sees is a community with no way in.
 *
 * The code is set in INK, not in the accent it used to carry. Coral means
 * "happening right now" in this direction and an eight-character string is not
 * an event — the well, the 32px extrabold and the 0.14em tracking are what make
 * it the loudest readout in the app, and none of them costs a reserved colour.
 */
function CreatedPanel({ lounge, onBack }: { lounge: LoungeRow; onBack: () => void }) {
  const C = useColors();
  const toast = useToast();
  const enter = useEnterStyle();

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
    <Screen scroll reserveDock ground={false}>
      <Animated.View style={[styles.body, enter]}>
        <CancelLink label="Done" onPress={onBack} />
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: C.ink }]}>
          {lounge.name} is up
        </Text>

        <GlassCard>
          <Text style={[styles.kicker, { color: C.ink3 }]}>Invite code</Text>
          {/*
            A well, and a deep one: `pressed()` needs a box big enough for both
            halves of the inset pair to land, which at 96px it is. The fill is
            `bgRecessed` rather than `surface` — an input in this direction is
            cut INTO the page, and a 5.5%-white fill inside a 5.5%-white card
            composites to ~11% and stops being a separate object at all.
          */}
          <View
            style={[
              styles.codeWell,
              { backgroundColor: C.bgRecessed, borderColor: C.rule },
              pressedWell(C),
            ]}>
            <Text selectable style={[styles.code, { color: C.ink }]}>
              {lounge.invite_code}
            </Text>
          </View>
        </GlassCard>

        <View style={styles.submit}>
          <PillButton label="Share invite code" onPress={() => void handleShare()} />
          <Text style={[styles.note, { color: C.ink3 }]}>
            {Platform.OS === 'web' ? 'Copies it to your clipboard.' : 'Opens your share sheet.'}
          </Text>

          <AuxButton
            label="Open lounge"
            variant="bordered"
            size="lg"
            align="center"
            fullWidth
            // `replace`, so backing out of the lounge does not land on this panel
            // for a lounge that already exists.
            onPress={() => router.replace(`/lounge/${lounge.id}`)}
          />
        </View>
      </Animated.View>
    </Screen>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * The back control on a form is a LINK, not the header's round tile (L524).
 *
 * That difference is deliberate in the design: a form is a thing you are in the
 * middle of, so the way out is worded ("Cancel", "Done") rather than drawn as a
 * chrome affordance. The 44px minimum is held by the row, not by the 16px
 * glyph, and `hitSlop` widens the target past the label's own box.
 */
function CancelLink({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={LINK_SLOP}
      onPress={onPress}
      style={styles.cancel}>
      {({ pressed }) => (
        <>
          <ArrowLeft size={16} strokeWidth={2} color={pressed ? C.ink : C.ink2} />
          <Text style={[styles.cancelLabel, { color: pressed ? C.ink : C.ink2 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The visibility choice (L537–L539).
 *
 * A recessed pill-shaped track with the selected half filled by the primary
 * gradient and lit by the blue glow — a selected segment is an ACTION accent in
 * this direction, the same hue as the CTA underneath, and never the coral that
 * means something is live. It replaces a `surface` tile riding in a `pressed()`
 * well, which read as two greys once `surface` became 5.5% white.
 *
 * Both labels are 800/12 whether selected or not, so the row does not reflow by
 * a pixel when the choice moves — the only things that change are the fill and
 * the ink.
 */
function Segmented({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const C = useColors();

  return (
    <View style={[styles.track, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
      {VISIBILITY.map((option) => {
        const active = value === option.key;

        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={option.label}
            disabled={disabled}
            onPress={() => onChange(option.key)}
            style={[
              styles.segment,
              /*
                The design's `0 6px 16px var(--aux-glow)` (L538). It sits on the
                Pressable rather than on the gradient because a clipped child
                cannot cast outside its parent, and the glow's whole job is to
                spill onto the track around it.
              */
              active
                ? { boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 16, color: C.glow }] }
                : null,
            ]}>
            {({ pressed }) => (
              <>
                {/*
                  Absolutely positioned with its own radius rather than clipped
                  by the segment: `overflow: 'hidden'` on a box that also casts a
                  shadow drops the shadow entirely on Android.
                */}
                {active ? (
                  <LinearGradient
                    colors={[C.priTint, C.pill]}
                    start={GRADIENT_START}
                    end={GRADIENT_END}
                    style={styles.segmentFill}
                  />
                ) : null}
                <Text
                  style={[
                    styles.segmentLabel,
                    { color: active ? C.pillInk : pressed ? C.ink : C.ink2 },
                  ]}>
                  {option.label}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Module constants: `LinearGradient` re-renders on a fresh object identity. */
const GRADIENT_START = { x: 0, y: 0 };
const GRADIENT_END = { x: 0, y: 1 };

const styles = StyleSheet.create({
  body: {
    paddingTop: TOP,
  },
  inert: {
    opacity: 0.55,
  },

  cancel: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Space.sm,
    minHeight: TOUCH_TARGET,
  },
  cancelLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },

  /** L525: `font:800 28px;letter-spacing:-.025em;margin:8px 0 18px`. */
  title: {
    ...Type.display(28),
    letterSpacing: tracking(28, -0.025),
    marginTop: Space.sm,
    marginBottom: 18,
  },

  stack: {
    gap: Space.md,
  },
  cardStack: {
    gap: Space.lg,
  },
  /** L536–L540's own rhythm: kicker → 9 → track → 10 → helper, near enough one gap. */
  card2: {
    gap: 9,
  },

  /** The kit's own field kicker, so a card's heading lines up with its labels. */
  kicker: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.13),
  },
  note: {
    ...Type.body(12.5),
  },

  track: {
    flexDirection: 'row',
    gap: 5,
    padding: 5,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
  },
  /*
    Inset to zero rather than `StyleSheet.absoluteFill`: the segment carries no
    border, so the padding box IS the border box and there is no hairline for
    the fill to leave a transparent ring inside. (`absoluteFillObject` is not on
    this RN version's `StyleSheet` type.)
  */
  segmentFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radii.pill,
  },
  segmentLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tracking(12, 0.03),
  },

  failure: {
    marginTop: Space.lg,
    padding: Space.lg,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    gap: Space.sm,
    alignItems: 'flex-start',
  },
  failureText: {
    ...Type.body(13),
  },

  submit: {
    marginTop: Space.lg,
    gap: Space.md,
  },

  codeWell: {
    alignItems: 'center',
    justifyContent: 'center',
    // Tall enough that the inset pair reads as a well and not as a smudge.
    minHeight: 96,
    marginTop: Space.sm,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  code: {
    ...readout(CODE_SIZE),
    letterSpacing: CODE_TRACKING,
    // Tracking leaves a gap after the last glyph; pulling it back keeps the
    // string optically centred in the well.
    marginRight: -CODE_TRACKING,
  },
});
