import { Redirect, router } from 'expo-router';
import { Info, Music, Unlink } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuxButton, GlassCard, Screen, Skeleton, useToast } from '@/components/ui';
import { useSpotifyLink } from '@/features/spotify/use-spotify-link';
import { useAuth } from '@/lib/auth';
import { Colors, Radius, Space, TOUCH_TARGET, Type } from '@/lib/theme';
import { usePlayback, type SourcePreference } from '@/playback/store';

/** Resolved link state. "free" is a normal, supported way to use Aux. */
type LinkState = 'unlinked' | 'free' | 'premium';

const SOURCE_OPTIONS: { value: SourcePreference; title: string; detail: string }[] = [
  {
    value: 'auto',
    title: 'Auto (recommended)',
    detail: 'Plays through Spotify when your account is linked and Premium, YouTube for everyone else.',
  },
  {
    value: 'youtube',
    title: 'Always YouTube',
    detail: 'Ignores Spotify even on Premium. Useful if Spotify keeps handing playback to another device.',
  },
];

export default function ConnectionsScreen() {
  const toast = useToast();
  const { session, profile, loading } = useAuth();
  const { link, unlink, linking, error } = useSpotifyLink();
  // The playback store is the only reader of this preference, so this screen
  // has to write into that store — a settings copy of it would be a switch
  // wired to nothing.
  const source = usePlayback((state) => state.sourcePreference);

  // The hook keeps its own error string; the toast layer is where the user
  // actually looks, so mirror it there instead of adding a second banner.
  useEffect(() => {
    if (error) toast.show(error, 'error');
  }, [error, toast]);

  const state: LinkState = !profile?.spotify_linked
    ? 'unlinked'
    : profile.is_premium
      ? 'premium'
      : 'free';

  const overridden = state === 'premium' && source === 'youtube';

  // This screen sits outside both guarded groups, so a deep link can land here
  // signed out. Without this it would render "Not connected" to a stranger.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Screen
      title="Connections"
      scroll
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/profile');
      }}>
      <View style={styles.stack}>
        {loading ? (
          <SpotifyCardSkeleton />
        ) : (
          <SpotifyCard
            state={state}
            overridden={overridden}
            linking={linking}
            onLink={() => {
              void link();
            }}
            onUnlink={() => {
              void unlink();
            }}
          />
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Playback source</Text>
          <Text style={styles.sectionLede}>
            How Aux decides where the audio for a Session comes from.
          </Text>
        </View>

        <GlassCard padded={false}>
          <View style={styles.options} accessibilityRole="radiogroup">
            {/* No loading branch: the store holds the preference synchronously,
                and setSourcePreference re-picks the adapter mid-Session. */}
            {SOURCE_OPTIONS.map((option) => (
              <SourceOption
                key={option.value}
                title={option.title}
                detail={option.detail}
                selected={source === option.value}
                onSelect={() => usePlayback.getState().setSourcePreference(option.value)}
              />
            ))}
          </View>
        </GlassCard>

        <Text style={styles.footnote}>
          Your choice is stored on this device only, so each phone you sign in on can play from a
          different source.
        </Text>
      </View>
    </Screen>
  );
}

const BADGE: Record<LinkState, string> = {
  unlinked: 'Not connected',
  free: 'Connected · Free',
  premium: 'Connected · Premium',
};

const EXPLANATION: Record<LinkState, string> = {
  unlinked:
    'Aux does not need Spotify. Everything plays through YouTube unless you link a Spotify Premium account here.',
  free:
    'Your Spotify account is linked, but Spotify only lets apps control playback on Premium accounts. Aux will play your Sessions through YouTube instead.',
  premium:
    'Sessions play through the Spotify app on this device. Keep Spotify installed and signed in, and leave it open when you take the aux.',
};

function SpotifyCard({
  state,
  overridden,
  linking,
  onLink,
  onUnlink,
}: {
  state: LinkState;
  overridden: boolean;
  linking: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  return (
    <GlassCard>
      <View style={styles.cardHead}>
        <View style={styles.tile}>
          <Music size={22} color={Colors.muted} />
        </View>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>Spotify</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{BADGE[state]}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.body}>{EXPLANATION[state]}</Text>

      {state === 'free' ? (
        /*
          Deliberately NOT Colors.danger. A free Spotify account is a supported
          configuration, not a failure — the app works end to end, it just uses
          YouTube for audio. Painting this red would tell the user to go fix
          something that is not broken.
        */
        <View style={styles.notice}>
          <Info size={18} color={Colors.muted} />
          <Text style={styles.noticeText}>
            Nothing is broken and nothing is missing. Search, queueing, chat and sync all work
            exactly the same — only the audio comes from YouTube.
          </Text>
        </View>
      ) : null}

      {overridden ? (
        <View style={styles.notice}>
          <Info size={18} color={Colors.muted} />
          <Text style={styles.noticeText}>
            Playback source is set to Always YouTube below, so Sessions are not using Spotify right
            now.
          </Text>
        </View>
      ) : null}

      <View style={styles.cardAction}>
        {state === 'unlinked' ? (
          <AuxButton label="Connect Spotify" fullWidth loading={linking} onPress={onLink} />
        ) : (
          <AuxButton
            label="Disconnect Spotify"
            icon={Unlink}
            variant="ghost"
            fullWidth
            loading={linking}
            onPress={onUnlink}
          />
        )}
      </View>
    </GlassCard>
  );
}

function SpotifyCardSkeleton() {
  return (
    <GlassCard>
      <View style={styles.cardHead}>
        <Skeleton width={44} height={44} radius={Radius.md} />
        <View style={styles.cardHeadText}>
          <Skeleton width={92} height={22} />
          <Skeleton width={130} height={18} radius={Radius.pill} />
        </View>
      </View>
      <View style={styles.skeletonBody}>
        <Skeleton width="100%" height={16} />
        <Skeleton width="88%" height={16} />
      </View>
    </GlassCard>
  );
}

function SourceOption({
  title,
  detail,
  selected,
  onSelect,
}: {
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={title}
      accessibilityHint={detail}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: {
    paddingTop: Space.sm,
    gap: Space.lg,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
  },
  cardHeadText: {
    flex: 1,
    gap: Space.xs,
    alignItems: 'flex-start',
  },
  cardTitle: {
    ...Type.heading,
    color: Colors.text,
  },
  badge: {
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: {
    ...Type.caption,
    color: Colors.muted,
  },
  body: {
    ...Type.body,
    color: Colors.text,
    marginTop: Space.lg,
  },
  notice: {
    flexDirection: 'row',
    gap: Space.md,
    marginTop: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
  },
  noticeText: {
    ...Type.body,
    color: Colors.muted,
    flex: 1,
  },
  cardAction: {
    marginTop: Space.lg,
  },
  skeletonBody: {
    marginTop: Space.lg,
    gap: Space.sm,
  },
  section: {
    gap: Space.xs,
    marginTop: Space.sm,
  },
  sectionTitle: {
    ...Type.heading,
    color: Colors.text,
  },
  sectionLede: {
    ...Type.body,
    color: Colors.muted,
  },
  options: {
    padding: Space.sm,
    // 8px between adjacent hit areas, per the touch-target spacing rule.
    gap: Space.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    minHeight: TOUCH_TARGET + Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
  },
  optionSelected: {
    backgroundColor: Colors.surfaceRaised,
  },
  optionPressed: {
    opacity: 0.75,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    // Optically aligns the control with the cap height of the title beside it.
    marginTop: 2,
  },
  /*
    White, not Colors.primary: indigo-on-indigo lands around 1.5:1 against the
    glass card, so the "on" state would be invisible on a phone in a dark room —
    which is the only place this app gets used.
  */
  radioOn: {
    borderColor: Colors.text,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.text,
  },
  optionText: {
    flex: 1,
    gap: Space.xs,
  },
  optionTitle: {
    ...Type.bodyStrong,
    color: Colors.text,
  },
  optionDetail: {
    ...Type.label,
    color: Colors.muted,
  },
  footnote: {
    ...Type.label,
    color: Colors.muted,
    marginBottom: Space.xl,
  },
});
