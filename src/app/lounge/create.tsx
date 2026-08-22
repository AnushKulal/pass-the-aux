import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ArrowRight, PartyPopper, Share2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuxButton, GlassCard, Screen, SheetTabs, TextField, useToast } from '@/components/ui';
import { shareInviteCode } from '@/features/lounges/invite';
import { loungeErrorMessage, useCreateLounge } from '@/features/lounges/queries';
import type { LoungeRow } from '@/lib/database.types';
import {
  Colors,
  Fonts,
  PointerEvents,
  Radius,
  Space,
  Type,
  bloomGradient,
} from '@/lib/theme';

/** Mirrors the `char_length(name) between 2 and 50` check on `lounges`. */
const NAME_MIN = 2;
const NAME_MAX = 50;
const DESCRIPTION_MAX = 200;

const VISIBILITY_TABS = [
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Private' },
];

const VISIBILITY_HINT: Record<string, string> = {
  public: 'Anyone can find this lounge in Explore and join it.',
  private: 'Invite-only. It stays hidden until someone redeems the code.',
};

export default function CreateLoungeScreen() {
  const toast = useToast();
  const create = useCreateLounge();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [nameError, setNameError] = useState<string | null>(null);
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
    create.mutate(
      { name: trimmed, description: description.trim(), isPublic: visibility === 'public' },
      {
        onSuccess: (lounge) => setCreated(lounge),
        onError: (error) =>
          toast.show(loungeErrorMessage(error, 'Could not create the lounge.'), 'error'),
      },
    );
  }, [create, description, name, toast, visibility]);

  if (created) {
    return <CreatedPanel lounge={created} onBack={handleBack} />;
  }

  return (
    <Screen title="New lounge" onBack={handleBack} scroll>
      <View style={styles.form}>
        {/* Nothing is playing in here yet — the room only half lights until the
            lounge actually exists. */}
        <Bloom opacity={0.12} />

        <TextField
          label="Name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameError(null);
          }}
          placeholder="Late Night Rotation"
          maxLength={NAME_MAX}
          error={nameError ?? undefined}
        />

        <TextField
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="What gets played here?"
          maxLength={DESCRIPTION_MAX}
        />

        <View style={styles.visibility}>
          <Text style={styles.fieldLabel}>Visibility</Text>
          {/* Pill segments, per the artboard. Public/Private is readable copy and
              a passive choice, so it takes neither mono sizing nor accent. */}
          <SheetTabs
            tabs={VISIBILITY_TABS}
            active={visibility}
            onChange={setVisibility}
            variant="segmented"
          />
          <Text style={styles.hint}>{VISIBILITY_HINT[visibility]}</Text>
        </View>

        <AuxButton
          label="Create lounge"
          fullWidth
          loading={create.isPending}
          disabled={name.trim().length < NAME_MIN}
          onPress={handleSubmit}
        />
      </View>
    </Screen>
  );
}

/**
 * The invite code is shown here, before navigating on, and not merely on the
 * lounge screen. A code the founder never sees is a community with no way in.
 */
function CreatedPanel({ lounge, onBack }: { lounge: LoungeRow; onBack: () => void }) {
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
    <Screen title="Lounge created" onBack={onBack} scroll>
      <View style={styles.form}>
        {/* The lounge exists now, so the room comes up. */}
        <Bloom opacity={0.3} />

        <GlassCard style={styles.createdCard}>
          <View style={styles.created}>
            {/* A confirmation is not live/play/join. Colors.text rather than
                Colors.primary — indigo on the glass fill reads at ~1.9:1. */}
            <View style={styles.createdBadge}>
              <PartyPopper size={26} color={Colors.text} strokeWidth={1.6} />
            </View>
            <Text style={styles.createdTitle}>{lounge.name} is live</Text>
            <Text style={styles.hintCentred}>
              Share this code to let people in. You can find it again from the lounge header.
            </Text>

            {/*
              The single clearest mono moment in the app. A community starts as
              eight characters somebody has to read out over a room, so they get
              their own panel, the mono face, and as much tracking as fits.
            */}
            <View style={styles.codePanel}>
              <Text style={styles.codeLabel}>Invite code</Text>
              <Text selectable style={styles.code}>
                {lounge.invite_code}
              </Text>
            </View>

            <AuxButton
              label="Share invite code"
              icon={Share2}
              // Sharing a code is neither live, play, nor join.
              variant="primary"
              fullWidth
              onPress={() => void handleShare()}
            />
          </View>
        </GlassCard>

        <AuxButton
          label="Open lounge"
          icon={ArrowRight}
          // Outlined: the code above is the thing to act on first, and two
          // filled pills stacked would make neither of them the answer.
          variant="ghost"
          fullWidth
          // `replace`, so backing out of the lounge does not land on this panel
          // for a lounge that already exists.
          onPress={() => router.replace(`/lounge/${lounge.id}`)}
        />
      </View>
    </Screen>
  );
}

/**
 * The room's light. Decorative only — Bloom colours never carry meaning, which
 * is what keeps Colors.accent free to mean "live". React Native has no blur, so
 * the softness is two gradients falling off on different axes, with the hard
 * top edge parked above the header.
 */
function Bloom({ opacity }: { opacity: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.bloom, PointerEvents.none]}>
      <LinearGradient
        colors={bloomGradient(opacity)}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={bloomGradient(opacity * 0.6)}
        locations={[0, 0.5, 1]}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.95, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Space.xl,
    paddingTop: Space.sm,
  },
  visibility: {
    gap: Space.sm,
  },
  fieldLabel: {
    ...Type.label,
    color: Colors.muted,
  },
  hint: {
    ...Type.body,
    color: Colors.muted,
  },
  hintCentred: {
    ...Type.body,
    color: Colors.muted,
    textAlign: 'center',
  },
  createdCard: {
    // Sheet radius: this panel is the moment, not another row in a form.
    borderRadius: Radius.xl,
  },
  created: {
    alignItems: 'center',
    gap: Space.md,
  },
  createdBadge: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.borderBright,
  },
  createdTitle: {
    ...Type.title,
    color: Colors.text,
    textAlign: 'center',
  },
  codePanel: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Space.xs,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.borderBright,
  },
  codeLabel: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  code: {
    // No token carries a 32px mono, so it is composed from the mono face and
    // the display size rather than invented.
    fontFamily: Fonts.monoMedium,
    fontSize: Type.display.fontSize,
    lineHeight: Type.display.lineHeight,
    letterSpacing: 4.5,
    color: Colors.text,
    textAlign: 'center',
    // The tracking leaves a gap after the last glyph; pulling it back keeps the
    // string optically centred in the panel.
    marginRight: -4.5,
  },
  bloom: {
    position: 'absolute',
    // Parked above the header so its hard top edge never lands on the screen.
    top: -200,
    left: -Space.huge,
    right: -Space.huge,
    height: 380,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
});
