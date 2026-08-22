import { Redirect, router } from 'expo-router';
import { Info, Music, Unlink } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { AuxButton, GlassCard, Screen, SheetTabs, Skeleton, useToast } from '@/components/ui';
import { useSpotifyLink } from '@/features/spotify/use-spotify-link';
import { useAuth } from '@/lib/auth';
import { Bloom, Colors, PointerEvents, Radius, Space, Type } from '@/lib/theme';
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

const SOURCE_TABS = SOURCE_OPTIONS.map((option) => ({ key: option.value, label: option.title }));

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
  const sourceDetail = SOURCE_OPTIONS.find((option) => option.value === source)?.detail ?? '';

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
      {/* Signature 1, at its faintest: settings sit further from the artwork
          than anything else in the app. */}
      <View style={[styles.bloom, PointerEvents.none]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="connectionsBloom" cx="50%" cy="6%" rx="60%" ry="88%">
              <Stop offset="0" stopColor={Bloom.a} stopOpacity={0.2} />
              <Stop offset="0.45" stopColor={Bloom.b} stopOpacity={0.11} />
              <Stop offset="0.76" stopColor={Colors.bg} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#connectionsBloom)" />
        </Svg>
      </View>

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

          {/* No loading branch: the store holds the preference synchronously,
              and setSourcePreference re-picks the adapter mid-Session. */}
          {/* Pill segments, per the artboard: "Always YouTube" is a word label,
              and a stored source preference is not a live state. */}
          <SheetTabs
            tabs={SOURCE_TABS}
            active={source}
            variant="segmented"
            onChange={(next) => {
              usePlayback
                .getState()
                .setSourcePreference(next === 'youtube' ? 'youtube' : 'auto');
            }}
          />

          <Text style={styles.sectionDetail}>{sourceDetail}</Text>
        </View>

        <View style={styles.gap} />

        <View style={styles.footnoteRow}>
          <Text style={styles.footnote}>
            Your choice is stored on this device only, so each phone you sign in on can play from a
            different source.
          </Text>
        </View>
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
          <Music size={22} color={Colors.muted} strokeWidth={1.6} />
        </View>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>Spotify</Text>
          {/* Signature 4: a connection state is a readout, so it is mono. */}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{BADGE[state]}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.body}>{EXPLANATION[state]}</Text>

      {state === 'free' ? (
        /*
          Colors.warn at most, and never Colors.danger. A free Spotify account is
          a supported configuration, not a failure — the app works end to end, it
          just uses YouTube for audio. Painting this red would tell the user to
          go fix something that is not broken.
        */
        <View style={styles.notice}>
          <Info size={18} color={Colors.warn} strokeWidth={1.6} />
          <Text style={styles.noticeText}>
            Nothing is broken and nothing is missing. Search, queueing, chat and sync all work
            exactly the same — only the audio comes from YouTube.
          </Text>
        </View>
      ) : null}

      {overridden ? (
        <View style={styles.notice}>
          <Info size={18} color={Colors.warn} strokeWidth={1.6} />
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

const styles = StyleSheet.create({
  bloom: {
    position: 'absolute',
    // Out past the screen gutter so the glow reaches the edges rather than
    // stopping on the same line the content does.
    left: -Space.lg,
    right: -Space.lg,
    top: 0,
    height: 320,
  },
  stack: {
    flexGrow: 1,
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
    backgroundColor: Colors.glassStrong,
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
    paddingHorizontal: 9,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: {
    ...Type.monoLabel,
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
    backgroundColor: Colors.glass,
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
    gap: Space.sm,
    marginTop: Space.sm,
  },
  sectionTitle: {
    ...Type.monoLabel,
    color: Colors.muted,
  },
  sectionLede: {
    ...Type.body,
    color: Colors.muted,
  },
  /** The consequence of the segment above it, not a caption for the screen. */
  sectionDetail: {
    ...Type.body,
    color: Colors.muted,
    marginTop: Space.xs,
  },
  gap: {
    flexGrow: 1,
    minHeight: Space.lg,
  },
  footnoteRow: {
    paddingTop: Space.md,
    marginBottom: Space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  footnote: {
    ...Type.label,
    color: Colors.muted,
  },
});
