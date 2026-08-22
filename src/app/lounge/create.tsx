import { router } from 'expo-router';
import { ArrowRight, PartyPopper, Share2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuxButton, GlassCard, Screen, SheetTabs, TextField, useToast } from '@/components/ui';
import { shareInviteCode } from '@/features/lounges/invite';
import { loungeErrorMessage, useCreateLounge } from '@/features/lounges/queries';
import type { LoungeRow } from '@/lib/database.types';
import { Colors, Space, Type } from '@/lib/theme';

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
          <SheetTabs tabs={VISIBILITY_TABS} active={visibility} onChange={setVisibility} />
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
        <GlassCard>
          <View style={styles.created}>
            {/* A confirmation is not live/play/join. Colors.text rather than
                Colors.primary — indigo on the glass fill reads at ~1.9:1. */}
            <PartyPopper size={28} color={Colors.text} />
            <Text style={styles.createdTitle}>{lounge.name} is live</Text>
            <Text style={styles.hint}>
              Share this code to let people in. You can find it again from the lounge header.
            </Text>

            <Text selectable style={styles.code}>
              {lounge.invite_code}
            </Text>

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
          fullWidth
          // `replace`, so backing out of the lounge does not land on this panel
          // for a lounge that already exists.
          onPress={() => router.replace(`/lounge/${lounge.id}`)}
        />
      </View>
    </Screen>
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
  created: {
    alignItems: 'center',
    gap: Space.md,
  },
  createdTitle: {
    ...Type.title,
    color: Colors.text,
    textAlign: 'center',
  },
  code: {
    ...Type.hero,
    color: Colors.text,
    letterSpacing: 4,
    textAlign: 'center',
  },
});
