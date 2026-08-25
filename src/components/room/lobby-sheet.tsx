/**
 * The lobby drawer — everything the Session can do that is not the transport.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L1286-L1305 (`sheetDrawer`),
 * README §9 "Drawer": a 2×2 grid of CHANGE LOBBY / DEAFEN / CAMERA / LOBBY
 * GAMES, then voice settings, add a track, and LEAVE THE LOBBY.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN EDIT TO THE SESSION SCREEN. The drawer
 * was drawn inline in 'src/app/room/[id].tsx' as a flat run of `LobbyRow`s,
 * and two of the user's named must-keep features — the game and change lobby —
 * were a dead `Soon` chip and nothing at all respectively. Both needed real
 * implementations, which is far more than a row: a catalogue, a table, a seat
 * queue, three lobby modes. Putting that in the screen would have doubled an
 * already 1200-line file. The screen keeps its `<Sheet>`; this replaces only
 * the body inside it, so the wiring stays where it is.
 *
 * THE DRAWER IS A LITTLE STACK, NOT THREE SHEETS. The design gives change-lobby
 * and games their own `sc-if` sheets; here they are panels this component
 * pushes over itself, because the host `<Sheet>` is a Modal and stacking a
 * second Modal on iOS drops the first one's gestures. A panel keeps one Modal,
 * one scrim and one back path, and the Android hardware-back handler already
 * in the screen still closes the whole thing in one press — see the note on
 * `onBackIntercept` for how a caller can make back step through panels first.
 *
 * NOTHING WAS DROPPED TO MATCH THE ARTBOARD. The drawer the code had carried
 * Microphone, Deafen, Chat, Screen share, Movie night, Game table and Leave.
 * All seven survive:
 *   · Microphone, Deafen  — the grid, where the design puts Deafen
 *   · Chat                — a row; the artboard reaches chat from the dock,
 *                           which this build does not have yet, so removing
 *                           the row would strand session chat entirely
 *   · Screen share,
 *     Movie night         — folded into CHANGE LOBBY, which is what they
 *                           actually are: lobby modes, not toggles. They were
 *                           two dead `Soon` rows; they are now two of the
 *                           three modes on a real switch
 *   · Game table          — LOBBY GAMES, now an actual table
 *   · Leave               — unchanged, and finally drawn in `danger` rather
 *                           than coral. Leaving is destruction; coral is
 *                           state. The old row broke the accent rule.
 * CAMERA and Voice settings are new, from the design. Camera has no transport,
 * so it says so instead of pretending.
 *
 * EVERY RESTING FILL IN HERE IS THE OPAQUE ONE, AND THAT IS A CORRECTION.
 * The tiles, the rows and the panel back button all shipped on `surface`. This
 * whole body is rendered inside the Session's `<Sheet>`, which is a `BlurView`
 * (src/app/room/[id].tsx L1034-L1072) — and `surface` is 5.5% white, so over a
 * blur it has nothing to sit on and every tile loses its edge. `surfaceSolid`
 * is the resolved composite of the same colour, so it looks identical the day
 * this body is ever rendered on a plain ground; the swap only ever costs
 * nothing. Same call `queue-list.tsx` and `add-track-sheet.tsx` already made.
 *
 * The PRESSED fills stay translucent deliberately: 9% white over the glass
 * reads brighter than the resolved solid, which is exactly what a press should
 * do. Only the resting state needed a floor.
 */

import {
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  HeadphoneOff,
  Headphones,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Plus,
  Repeat,
  SlidersHorizontal,
  Video,
  VideoOff,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChangeLobbyPanel, lobbyModeLabel, type LobbyMode } from '@/components/room/change-lobby';
import { readout } from '@/components/room/drift';
import {
  GameTablePanel,
  LobbyGamesPanel,
  useGameTable,
  type GameId,
  type GamePerson,
  type TableRole,
} from '@/components/room/lobby-games';
import { AuxButton } from '@/components/ui';
import { Radii, Rule, Space, TOUCH_TARGET, Type, raised, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Which panel of the little stack is on top.
 *
 * `games` is the catalogue and `table` is the open table — two panels rather
 * than one branch, so that browsing the catalogue while seated does not tear
 * the table down. Reaching the catalogue from a live table is the only way the
 * design's `2/4 SEATED · 5 WATCHING` row counts are ever non-zero.
 */
type Panel = 'controls' | 'change' | 'games' | 'table';

export type LobbySheetBodyProps = {
  /**
   * The host sheet's own `visible`. Passing it resets the stack to the top
   * when the drawer closes, so reopening never lands mid-way inside a game
   * table the user thought they had backed out of. Optional so the component
   * still works if a caller forgets it.
   */
  visible?: boolean;
  loungeName: string;
  /** Only the person on aux may change the lobby, and only the host rules on seats. */
  isHost: boolean;
  micOn: boolean;
  deafened: boolean;
  onMic: () => void;
  onDeafen: () => void;
  /** Session chat. Not in the artboard's drawer, kept because nothing else reaches it. */
  onChat: () => void;
  onAddTrack: () => void;
  onLeave: () => void;
  /** The roster, for game seats and viewers. */
  people: readonly GamePerson[];
  currentUserId: string | null;
  /** Toast passthrough — every state change in here announces itself. */
  onNotice: (message: string) => void;
  /**
   * Lobby mode, if the caller wants to own it. Omitted, it is held here — see
   * the header of 'change-lobby.tsx' for why it is local state today.
   */
  mode?: LobbyMode;
  onModeChange?: (mode: LobbyMode) => void;
};

export const LobbySheetBody = memo(function LobbySheetBody({
  visible = true,
  loungeName,
  isHost,
  micOn,
  deafened,
  onMic,
  onDeafen,
  onChat,
  onAddTrack,
  onLeave,
  people,
  currentUserId,
  onNotice,
  mode,
  onModeChange,
}: LobbySheetBodyProps) {
  const C = useColors();

  const [panel, setPanel] = useState<Panel>('controls');
  const [cameraOn, setCameraOn] = useState(false);
  /** Only used when the caller does not control `mode`. */
  const [localMode, setLocalMode] = useState<LobbyMode>('music');
  const activeMode = mode ?? localMode;

  const games = useGameTable({ people, currentUserId, isHost, onNotice });

  // Closing the drawer pops the stack. Without this, reopening it drops the
  // user back inside the game table with no memory of how they got there.
  useEffect(() => {
    if (!visible) setPanel('controls');
  }, [visible]);

  /*
    "Leave table · back to music" tears the table down from inside the table
    panel, which would otherwise leave `panel` pointing at something that no
    longer exists. The render below already falls through to the controls in
    that frame — this only normalises the state so the LOBBY GAMES tile does
    not think there is still a table to return to.
  */
  useEffect(() => {
    if (panel === 'table' && !games.table) setPanel('controls');
  }, [games.table, panel]);

  const handleMode = useCallback(
    (next: LobbyMode) => {
      if (!isHost) {
        onNotice('Only the person on aux can change the lobby');
        return;
      }
      if (onModeChange) onModeChange(next);
      else setLocalMode(next);

      // Movie night and screen share have no transport behind them, and saying
      // so here is the honest version of the two `Soon` rows this replaced.
      onNotice(
        next === 'music'
          ? 'Back to music'
          : `${lobbyModeLabel(next)} is switched on for you — the shared transport lands with the video layer`
      );
      setPanel('controls');
    },
    [isHost, onModeChange, onNotice]
  );

  const handleCamera = useCallback(() => {
    setCameraOn((on) => {
      if (!on) onNotice('Camera is not live yet');
      return !on;
    });
  }, [onNotice]);

  const openGame = useCallback(
    (gameId: GameId, as: TableRole) => {
      games.open(gameId, as);
      setPanel('table');
    },
    [games]
  );

  const back = useCallback(() => setPanel('controls'), []);
  const toChange = useCallback(() => setPanel('change'), []);
  /** The tile goes wherever you left off: your table if you have one, else the list. */
  const toGames = useCallback(
    () => setPanel(games.table ? 'table' : 'games'),
    [games.table]
  );
  const toTable = useCallback(() => setPanel('table'), []);
  const toCatalogue = useCallback(() => setPanel('games'), []);

  if (panel === 'change') {
    return (
      <PanelShell
        title="Change the lobby"
        kicker="EVERYONE COMES WITH YOU. THE QUEUE IS KEPT."
        onBack={back}>
        <ChangeLobbyPanel mode={activeMode} canChange={isHost} onChange={handleMode} />
      </PanelShell>
    );
  }

  if (panel === 'table' && games.table) {
    return (
      <PanelShell title="At the table" kicker="THE MUSIC KEEPS GOING" onBack={back}>
        <GameTablePanel
          table={games.table}
          people={people}
          currentUserId={currentUserId}
          isHost={isHost}
          controller={games}
          onBrowse={toCatalogue}
        />
      </PanelShell>
    );
  }

  if (panel === 'games') {
    return (
      <PanelShell
        title="Lobby games"
        kicker="TAKE A SEAT OR WATCH · THE MUSIC KEEPS GOING"
        onBack={back}>
        <LobbyGamesPanel table={games.table} onOpen={openGame} onReturn={toTable} />
      </PanelShell>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
      <Text style={[readout(10), { color: C.ink3 }]}>
        {lobbyModeLabel(activeMode)} · {people.length} LISTENING
      </Text>

      {/*
        The 2×2 grid. Two rows of two rather than a wrapping flex row, because
        a wrap puts the fourth tile on its own line the moment a label grows a
        character in another language.
      */}
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <Tile icon={Repeat} label="CHANGE LOBBY" onPress={toChange} />
          <Tile
            icon={deafened ? HeadphoneOff : Headphones}
            label={deafened ? 'UNDEAFEN' : 'DEAFEN'}
            on={deafened}
            onPress={onDeafen}
          />
        </View>

        <View style={styles.gridRow}>
          <Tile
            icon={cameraOn ? Video : VideoOff}
            label={cameraOn ? 'CAMERA ON' : 'CAMERA'}
            on={cameraOn}
            onPress={handleCamera}
          />
          <Tile
            icon={Gamepad2}
            label="LOBBY GAMES"
            // The table is a state of the world once it exists, so the tile
            // reports it in coral the same way DEAFEN reports being deafened.
            on={games.table != null}
            onPress={toGames}
          />
        </View>
      </View>

      <View style={styles.rows}>
        <Row
          icon={micOn && !deafened ? Mic : MicOff}
          label="Microphone"
          sub={deafened ? 'DEAFENED — MIC IS OFF' : micOn ? 'ON' : 'OFF'}
          on={micOn && !deafened}
          onPress={onMic}
        />
        <Row
          icon={MessageCircle}
          label="Session chat"
          sub="TALK WITHOUT TALKING"
          navigates
          onPress={onChat}
        />
        <Row
          icon={Plus}
          label="Add a track"
          sub="ANYONE IN THE SESSION CAN ADD"
          navigates
          onPress={onAddTrack}
        />
        <Row
          icon={SlidersHorizontal}
          label="Voice settings"
          sub="APPLIES TO EVERY LOBBY"
          navigates
          onPress={() => onNotice('Voice is not live yet')}
        />
      </View>

      {/*
        Danger, not coral. Leaving the Session is destruction, and this is the
        one register the accent rule reserves for it — the row this replaced
        was drawn in `live`, which said "this is happening" about a door.
      */}
      <AuxButton
        label={`Leave ${loungeName}`}
        onPress={onLeave}
        variant="danger"
        icon={LogOut}
        fullWidth
      />
    </ScrollView>
  );
});

// ------------------------------------------------------------------- parts

/** A pushed panel: its own back row, then whatever it is. */
const PanelShell = memo(function PanelShell({
  title,
  kicker,
  onBack,
  children,
}: {
  title: string;
  kicker: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const C = useColors();

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
      <View style={styles.panelHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to lobby controls"
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: pressed ? C.surface2 : C.surfaceSolid, borderColor: C.rule },
          ]}>
          <ChevronLeft size={18} strokeWidth={2} color={C.ink} />
        </Pressable>

        <View style={styles.panelMeta}>
          <Text numberOfLines={1} style={[styles.panelTitle, { color: C.ink }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[readout(9), { color: C.ink3 }]}>
            {kicker}
          </Text>
        </View>
      </View>

      {children}
    </ScrollView>
  );
});

/**
 * One cell of the 2×2 grid.
 *
 * `on` paints the coral WASH, never the coral fill: a solid-coral tile in a
 * grid of four out-shouts the title of the sheet it sits in, and the state it
 * reports — deafened, camera live — is not more important than the drawer.
 */
const Tile = memo(function Tile({
  icon: Icon,
  label,
  on = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  on?: boolean;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        on
          ? { backgroundColor: C.liveWash, borderColor: C.liveMid }
          : { backgroundColor: pressed ? C.surface2 : C.surfaceSolid, borderColor: C.rule },
        raised(C),
      ]}>
      <Icon size={20} strokeWidth={2} color={on ? C.liveText : C.ink} />
      <Text numberOfLines={1} style={[styles.tileLabel, { color: on ? C.liveText : C.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * A raised row.
 *
 * The icon sits in a recessed FILL with a hairline rather than an inset shadow
 * pair: at 38px only the dark half of the pair survives on a dark ground and
 * the well reads as a smudge. Same rule as the auth fields — kept from the
 * drawer this replaces, because the reasoning did not change.
 */
const Row = memo(function Row({
  icon: Icon,
  label,
  sub,
  on = false,
  navigates = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  sub: string;
  on?: boolean;
  /** Shows a chevron instead of a state readout: this row goes somewhere. */
  navigates?: boolean;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sub}`}
      accessibilityState={navigates ? undefined : { checked: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? C.surface2 : C.surfaceSolid },
        raised(C),
      ]}>
      <View style={[styles.well, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        <Icon size={17} strokeWidth={2} color={on ? C.liveText : C.ink2} />
      </View>

      <View style={styles.rowMeta}>
        <Text numberOfLines={1} style={[styles.rowLabel, { color: C.ink }]}>
          {label}
        </Text>
        <Text numberOfLines={1} style={[readout(9), { color: on ? C.liveText : C.ink3 }]}>
          {sub}
        </Text>
      </View>

      {navigates ? <ChevronRight size={17} strokeWidth={2} color={C.ink3} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  body: {
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
  grid: {
    gap: Space.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  tile: {
    flex: 1,
    minHeight: 86,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    paddingHorizontal: Space.md,
    justifyContent: 'center',
    gap: Space.sm,
  },
  tileLabel: {
    ...Type.heading(10),
  },
  rows: {
    gap: Space.sm,
  },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radii.lg,
  },
  well: {
    width: 38,
    height: 38,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowLabel: {
    ...Type.heading(14),
    letterSpacing: tracking(14, -0.01),
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  backButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  panelMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  panelTitle: {
    ...Type.display(20),
  },
});
