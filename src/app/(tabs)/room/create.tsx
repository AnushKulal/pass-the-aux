/**
 * Start a Session.
 *
 * Built from design/nocturne/aux-nocturne.dc.html `isCreateS` (L545–L576):
 * Cancel link, 28px title, one line of lede, the name card, the lounge picker,
 * the playback-source card, and the gradient pill.
 *
 * THIS SCREEN'S JOB CHANGED, WHICH IS WHY IT IS RESTRUCTURED AND NOT JUST
 * RESKINNED. The nav capsule's centre FAB now points straight here (see
 * `@/components/shell/nav-bar`), so what used to be a form almost nobody found
 * is the destination of the most prominent control in the app. It is a first
 * impression now, and it has to answer three questions before the button:
 * what am I about to do (the lede), where will it happen (the picker, with the
 * roster size and a coral badge on any lounge that already has a Session up),
 * and what will people actually hear (the source card, which the artboard draws
 * as a hardcoded string and which is derived from the real account here).
 *
 * THE ACCENT RULE, APPLIED. Selection is an ACTION — the picked lounge takes a
 * blue edge and a blue tick, the same hue as the CTA it leads to. Coral is
 * spent only on the LIVE badge, which reports a state of the world nobody on
 * this screen is choosing. The previous version had those two exactly backwards:
 * selection was coral and the "Go on aux" button was a coral fill, which left
 * the screen with no blue at all and made a form choice look like an event.
 *
 * DELIBERATE DEVIATIONS FROM THE ARTBOARD:
 *  - The lounge list comes from `useMyLounges` in '@/features/lounges/queries'
 *    rather than the `LoungeRow`-only one in '@/features/rooms/queries'. The
 *    design's row carries a member count and this is the query that knows one;
 *    it also knows `activeSessions`, which is what lights the LIVE badge. The
 *    Lounges tab already mounts it, so arriving from the capsule usually hits a
 *    warm cache.
 *  - The design's input is 700/16px; the shared `TextField` is 400/15px and has
 *    no title register. The kit wins — see the report.
 *  - The artboard has no failure state for the picker. The retry survives, drawn
 *    as the shared `EmptyState` rather than the chat kit's notice, which is what
 *    this screen used to borrow.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, Users, WifiOff } from 'lucide-react-native';
import { memo, useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEnterStyle } from '@/components/auth/onboarding';
import { tagFor } from '@/components/lounge/lounge-card';
import {
  EmptyState,
  GlassCard,
  PillButton,
  Skeleton,
  StatusPill,
  TextField,
  useToast,
} from '@/components/ui';
import { useMyLounges, type LoungeSummary } from '@/features/lounges/queries';
import { useCreateRoom } from '@/features/rooms/queries';
import { useAuth } from '@/lib/auth';
import { useDockReserve } from '@/lib/dock';
import {
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { usePlayback } from '@/playback/store';

const MAX_NAME_LENGTH = 50;
const SKELETON_ROWS = 3;

/** 12 pad + 34 tile + 12 pad — the artboard's row, so the placeholder is the row. */
const OPTION_HEIGHT = 58;
/** L563's `34px` tag tile. Smaller than the You screen's 38 on purpose. */
const TAG_TILE = 34;

/** The artboard's `padding:14px 18px 130px`; `Space` has no 14. */
const TOP = 14;
/** Matches `Screen`'s gutter, which this route cannot use — see the FlatList note. */
const GUTTER = 18;

const LINK_SLOP = { top: 6, bottom: 6, left: 8, right: 8 };

/**
 * What people will actually hear, derived rather than asserted.
 *
 * The artboard prints one hardcoded sentence here (L572). The truth is a
 * three-way: Spotify only carries the audio for a linked Premium account that
 * has not overridden the source in Settings, and everyone else — including
 * every free listener in the Session — is on YouTube. Saying so on the screen
 * that puts you on aux is the difference between a surprise and a choice.
 */
function sourceLine(linked: boolean, premium: boolean, forced: boolean): string {
  if (forced) return 'YouTube — you set it as your source in Settings';
  if (!linked) return 'YouTube — Spotify not linked';
  if (!premium) return 'YouTube — Spotify linked but not Premium';
  return 'Spotify — linked and Premium';
}

export default function CreateRoomScreen() {
  const C = useColors();
  const enter = useEnterStyle();
  const dockReserve = useDockReserve();

  // See room/[id].tsx: the generic must be a required-property shape.
  const params = useLocalSearchParams<{ loungeId: string }>();
  const toast = useToast();
  const { profile, loading: authLoading } = useAuth();

  const lounges = useMyLounges();
  const createRoom = useCreateRoom();

  // The playback store is the only place the source override lives, so the
  // sentence below has to read it there rather than keep a second copy.
  const sourcePreference = usePlayback((state) => state.sourcePreference);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(
    typeof params.loungeId === 'string' ? params.loungeId : null,
  );

  /*
    Derived, not synchronised. Coming from a lounge preselects it, and landing
    here from the capsule with exactly one lounge should not make the user tap a
    list of one — but writing that default into state from an effect means a
    cascading render, and a default that would fight the user's own choice the
    moment the query refetched.
  */
  const all = lounges.data;
  const loungeId = picked ?? (all && all.length === 1 ? all[0].lounge.id : null);

  const handleCreate = useCallback(() => {
    if (!loungeId) {
      toast.show('Pick a lounge for this Session.', 'error');
      return;
    }

    createRoom.mutate(
      { loungeId, name },
      {
        onSuccess: (room) => {
          // replace, not push: backing out of a Session should land on the
          // lounge, not on the form that created it.
          router.replace({ pathname: '/room/[id]', params: { id: room.id } });
        },
        onError: (error) => {
          toast.show(
            error instanceof Error ? error.message : 'Could not start the Session.',
            'error',
          );
        },
      },
    );
  }, [createRoom, loungeId, name, toast]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LoungeSummary>) => (
      <LoungeOption summary={item} selected={item.lounge.id === loungeId} onSelect={setPicked} />
    ),
    [loungeId],
  );

  const source = sourceLine(
    profile?.spotify_linked === true,
    profile?.is_premium === true,
    sourcePreference === 'youtube',
  );

  return (
    /*
      No ScrollView: membership is unbounded, so the options need a virtualised
      list — and a FlatList nested in a ScrollView would warn, lose
      virtualisation and fight it for the gesture. The FlatList owns the
      scrolling instead, with the form around it as header and footer. That is
      also why this route builds its own frame rather than using `Screen`.
    */
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <Animated.View style={[styles.flex, enter]}>
        <FlatList
          style={styles.flex}
          data={lounges.data ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={OptionGap}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            /*
              The nav capsule floats and takes no layout space, so the list has
              to leave room for it — and this screen is the capsule's own FAB
              destination, so the button that opens it was covering the "Go
              live" pill in the footer. Inline rather than a StyleSheet entry
              because `useDockReserve()` includes the device's bottom inset,
              which a static object cannot carry; the old `Dock.reserve` here
              left NEGATIVE clearance on every phone with a home indicator.
            */
            { paddingBottom: dockReserve },
          ]}
          ListHeaderComponent={
            /*
              No bottom padding on this block. The gap before the first row
              belongs to the kicker (`kickerSpaced`, the artboard's
              `margin:18px 0 10px`); paying it twice pushes the list a third of
              a row down and the section stops reading as one thing.
            */
            <View>
              <CancelLink label="Cancel" onPress={handleBack} />

              <Text accessibilityRole="header" style={[styles.title, { color: C.ink }]}>
                Start a Session
              </Text>
              <Text style={[styles.lede, { color: C.ink2 }]}>
                You&rsquo;ll be on aux. Anyone in the lounge can join, chat and add to the queue.
              </Text>

              <GlassCard>
                <TextField
                  label="Session name — optional"
                  value={name}
                  onChangeText={setName}
                  placeholder="The 2am one"
                  maxLength={MAX_NAME_LENGTH}
                />
              </GlassCard>

              <Text style={[styles.kicker, styles.kickerSpaced, { color: C.ink3 }]}>
                In which lounge
              </Text>
            </View>
          }
          ListEmptyComponent={
            lounges.isPending ? (
              <View style={styles.skeletons}>
                {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <Skeleton key={index} width="100%" height={OPTION_HEIGHT} radius={Radii.lg} />
                ))}
              </View>
            ) : lounges.isError ? (
              <EmptyState
                icon={WifiOff}
                title="Your lounges didn’t load."
                description="Check the connection and try again."
                primary={{ label: 'Retry', onPress: () => void lounges.refetch() }}
              />
            ) : (
              <EmptyState
                icon={Users}
                title="You are not in a lounge yet"
                description="A Session lives inside a lounge. Join a public one from Explore, or enter an 8-character invite code."
                primary={{ label: 'Find a lounge', onPress: () => router.replace('/lounges') }}
              />
            )
          }
          ListFooterComponent={
            <View style={styles.footer}>
              <GlassCard>
                <Text style={[styles.kicker, { color: C.ink3 }]}>Your playback source</Text>
                <Text style={[styles.sourceValue, { color: C.ink }]}>
                  {authLoading ? 'Checking your account…' : source}
                </Text>
                <Text style={[styles.sourceNote, { color: C.ink3 }]}>
                  Listeners on Premium hear it through Spotify. Same track, same second.
                </Text>
              </GlassCard>

              {/*
                BLUE, not the coral this button used to carry. Nocturne draws
                this CTA as the primary gradient (L575) and the accent rule is
                explicit that going live is something you DO — the coral belongs
                to the Session once it exists, which is where the stage screen
                spends it.
              */}
              <PillButton
                label="Go live"
                onPress={handleCreate}
                loading={createRoom.isPending}
                disabled={!loungeId}
              />
            </View>
          }
        />
      </Animated.View>
    </SafeAreaView>
  );
}

const keyExtractor = (item: LoungeSummary) => item.lounge.id;

/** L562's `gap:9px` between picker rows, and over the 8px floor for radios. */
const OptionGap = () => <View style={styles.optionGap} />;

/**
 * The back control on a form is a LINK, not the header's round tile (L546).
 *
 * A form is something you are in the middle of, so the way out is worded rather
 * than drawn as chrome. The 44px minimum is held by the row; `hitSlop` widens
 * the target past the label's own box.
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

type LoungeOptionProps = {
  summary: LoungeSummary;
  selected: boolean;
  onSelect: (loungeId: string) => void;
};

/**
 * One lounge in the picker (L563–L567): tag tile, name, roster size.
 *
 * Hand-rolled rather than wrapped around a `GlassCard`, because this is a
 * CONTROL and the card has no press state — but the skin is the card's `row`
 * recipe exactly: `surface` fill, 1px `rule`, radius 18, no shadow. Pressing
 * takes it to `surface2`, which is the design's `style-active` on the same row.
 *
 * The edge is `Rule.thick` on every row, selected or not. A 1px border that
 * grows on selection reflows the whole list by half a pixel per row; holding
 * the width and moving only the COLOUR keeps the geometry still, and at 1.5px
 * the resting `rule` is still a hairline rather than an outline.
 *
 * Selection carries a filled blue tick as well as the edge tint, so it survives
 * being seen by someone who cannot separate the blue from the ground — a shape
 * that appears is a stronger cue than a word, and the row has a LIVE badge and
 * a count competing for the same right-hand column on a narrow phone.
 */
const LoungeOption = memo(function LoungeOption({
  summary,
  selected,
  onSelect,
}: LoungeOptionProps) {
  const C = useColors();
  const { lounge, memberCount, activeSessions } = summary;
  const live = activeSessions > 0;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={lounge.name}
      accessibilityHint={live ? 'A Session is already running in this lounge.' : undefined}
      onPress={() => onSelect(lounge.id)}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: pressed ? C.surface2 : C.surface,
          borderColor: selected ? C.pill : C.rule,
        },
      ]}>
      {/*
        `bgRecessed`, not `surface`: a translucent tile inside a translucent row
        composites to ~11% and stops reading as a separate object. Same reason
        the kit's empty-state tile inverted.
      */}
      <View style={[styles.tag, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        <Text style={[styles.tagLabel, { color: C.ink2 }]}>{tagFor(lounge.name)}</Text>
      </View>

      <View style={styles.optionMeta}>
        <Text numberOfLines={1} style={[styles.optionName, { color: C.ink }]}>
          {lounge.name}
        </Text>
        <Text numberOfLines={1} style={[styles.optionCount, { color: C.ink3 }]}>
          {memberCount === 1 ? '1 member' : `${memberCount} members`}
        </Text>
      </View>

      {/* Coral says a Session is already up in there. It is a fact about the
          world, not a reason not to start another — so it informs, it does not
          block. */}
      {live ? <StatusPill label="Live" tone="liveWash" dot live /> : null}

      {selected ? (
        <View style={[styles.tick, { backgroundColor: C.pill }]}>
          <Check size={14} strokeWidth={2.6} color={C.pillInk} />
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  /*
    No `backgroundColor`. The ambient blobs are painted once behind the whole
    tab navigator and an opaque ground here would cover them — this screen shows
    them through its cards like every other one in the group.
  */
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: GUTTER,
    paddingTop: TOP,
    // The bottom padding is inline on the FlatList — see the note there.
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

  /** L547: `font:800 28px;letter-spacing:-.025em;margin:8px 0 6px`. */
  title: {
    ...Type.display(28),
    letterSpacing: tracking(28, -0.025),
    marginTop: Space.sm,
    marginBottom: 6,
  },
  lede: {
    ...Type.body(14),
    lineHeight: 22,
    marginBottom: 18,
  },

  /** The kit's field kicker, so a section heading lines up with the labels. */
  kicker: {
    ...Type.label(10),
    fontFamily: Fonts.extrabold,
    letterSpacing: tracking(10, 0.13),
  },
  kickerSpaced: {
    marginTop: 18,
    marginBottom: 10,
  },

  skeletons: {
    gap: 9,
  },
  optionGap: {
    height: 9,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 14,
    paddingVertical: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Rule.thick,
  },
  tag: {
    width: TAG_TILE,
    height: TAG_TILE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
  },
  tagLabel: {
    fontFamily: Fonts.extrabold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: tracking(9, 0.06),
  },
  optionMeta: {
    flex: 1,
    minWidth: 0,
  },
  optionName: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: tracking(14, -0.01),
  },
  /** L566: `font:400 10px;letter-spacing:.07em` — regular weight, not a label. */
  optionCount: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: tracking(10, 0.07),
    textTransform: 'uppercase',
    marginTop: 2,
  },
  tick: {
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.pill,
  },

  footer: {
    gap: Space.lg,
    paddingTop: Space.lg,
  },
  sourceValue: {
    ...Type.body(15),
    marginTop: 7,
  },
  sourceNote: {
    ...Type.body(12.5),
    marginTop: 5,
  },
});
