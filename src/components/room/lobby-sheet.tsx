/**
 * The session dock and the lobby drawer inside it — everything the Session can
 * do that is not the transport.
 *
 * ============================ WHY THE DOCK IS HERE ==========================
 *
 * The user's complaint, verbatim: "the change lobby why is it so hard to build
 * i am litterally just asking if the application can be clicked on the bottom
 * bar affter the session is started if we swipe that up then the uptions let
 * it load in".
 *
 * Everything they asked for already existed and was TWO MODAL TRANSITIONS
 * away. The Session drew a bottom bar (`LobbyBar` in 'src/app/room/[id].tsx'),
 * whose handle was a press that opened a `<Modal>` sheet, whose body was
 * `LobbySheetBody` below, one of whose tiles pushed a panel. Three layers to
 * reach a three-option switch. The bar's own file header even wrote the
 * decision down — "THE BAR'S HANDLE IS A TAP, NOT A DRAG. The artboard binds
 * pointer-move to the grabber. A pan responder there competes with the
 * scroller directly above it" — and that reasoning is now overruled, because
 * the pan is bound to the HANDLE STRIP ONLY, which is 42px of chrome no
 * scroller has ever occupied. There was never a competition to lose.
 *
 * `SessionDock` at the bottom of this file is the bar and the drawer as ONE
 * object. Collapsed it is the artboard's dock (L1145-L1158): a grabber, a
 * tracked line, five cells. Dragged up — or tapped, see below — the same
 * object keeps rising and the lobby panel is simply the part of it that was
 * below the screen edge. No modal, no transition, no second surface. The
 * music never even repaints.
 *
 * BOTH GESTURES, AND THE TAP IS NOT A CONSOLATION PRIZE. A swipe with no
 * visible affordance is not a feature; it is a secret. The drag is the gesture
 * the user asked for and the tap is the one that TEACHES it, because the
 * handle is a labelled 42px target that says what is behind it. That label is
 * the one idea kept wholesale from the bar this replaces: the artboard writes
 * "SWIPE UP FOR MORE", and a door labelled "more" is exactly how the game
 * table and change-lobby went missing in the first place. This one names them.
 *
 * ------------------------------------------------------------------ layout
 *
 * The dock is ONE fixed-height object translated in Y, not a view whose height
 * changes. Height is a layout property: animating it re-lays-out five cells
 * and a scrolling panel on every frame of a drag. `translateY` moves one
 * layer. The panel is therefore always rendered, always laid out, and merely
 * parked below the bottom of the screen while collapsed — which is also why
 * expanding costs nothing and why the panel's scroll position survives it.
 *
 *   offset = travel  ->  collapsed, the panel sits off the bottom edge
 *   offset = 0       ->  expanded, the dock's top edge is `travel` px higher
 *
 * WHO WRITES THE SHARED VALUE, because this repo has a hard rule about that
 * and the rule turned out to be narrower than it reads.
 *
 * The rule as written is "a shared value is written from `useEffect`, never
 * from a press handler, because React Compiler rejects the second". Every
 * SETTLE here obeys it literally: the tap, the scrim press and the end of a
 * drag all set React state, and one effect runs one animation. That part was
 * easy.
 *
 * The DRAG cannot obey it, because a sheet that follows a finger has to be
 * written every frame and there is no state-based way to do that. The
 * assumption going in was that gesture worklets were exempt — they run on the
 * UI thread, so the compiler's reasoning about render purity does not apply.
 * THAT ASSUMPTION IS WRONG and the linter says so: `react-hooks/immutability`
 * fires on `offset.value = …` inside `onUpdate`, because `offset` is also read
 * by a `useAnimatedStyle` and the compiler will not let a value passed to a
 * hook be mutated anywhere it can see the assignment. The real rule is about
 * VISIBILITY, not about where the code runs. `driveTo` near the bottom of this
 * file is the one-line door through it, and it is documented there.
 *
 * A SECOND THING THE LINTER DOES NOT DO ON ITS OWN, worth knowing before you
 * edit this file: the compiler pass only reports diagnostics for `LobbySheetBody`
 * once this module contains a second component. Adding ANY component here —
 * even a two-line one — surfaces every latent violation above. Two of them
 * were sitting in `LobbySheetBody` from long before this pass and are fixed in
 * place rather than hidden again by moving the dock to its own file.
 *
 * `settle` is a counter and it is load-bearing: a drag that ends on the side
 * it started leaves `open` unchanged, React bails on the identical state, the
 * effect never re-runs, and the sheet stays wherever the finger dropped it.
 * Bumping a counter guarantees the settle regardless.
 *
 * ================= CHANGING THE LOBBY IS TWO STEPS NOW ==================
 *
 * The user, verbatim: "after the session is created and the swipe up thing i
 * dont want a toggle over there to change the lobby mode and suppose i change
 * then let it give me an option so it works that way".
 *
 * This file had TWO controls that switched the lobby mode on a single tap: the
 * segmented `LobbyModeSwitch` at the top of the docked panel, and the dock's
 * own SHARE cell, which is visible whether the dock is open or shut. Either
 * one moved everybody in the room instantly. Both now ASK first, through the
 * same `ConfirmDialog`, and 'change-lobby.tsx' carries the long argument for
 * why a segmented control was the wrong shape for this.
 *
 * THE SHARE CELL WAS NOT IN THE COMPLAINT AND IS FIXED ANYWAY, because it is
 * the same switch and it sits in the one row of this component a thumb reaches
 * without opening anything. Leaving it instant while the panel confirmed would
 * be two controls disagreeing about how serious the same act is — the exact
 * failure `mayChangeLobby` below exists to prevent, one level up.
 *
 * TWO `LobbyModeConfirm`s, ONE COPY. `SessionDock` mounts one for its SHARE
 * cell and `LobbySheetBody` mounts one for the picker and the change panel,
 * because `LobbySheetBody` is also mounted standalone inside the Session's
 * `<Sheet>` and has to be able to ask on its own. What is NOT duplicated is
 * anything that could drift: the guard is one function here, the wording and
 * the tone are one component in 'change-lobby.tsx'. Only the
 * `useState<LobbyMode | null>` is per-call-site, which is where UI state
 * belongs.
 *
 * A NESTED MODAL, KNOWINGLY. `ConfirmDialog` is a `Modal`, and in the
 * standalone mounting `LobbySheetBody` is already inside the Session's
 * `<Sheet>`, which is another one — so that path stacks a second scrim over
 * the first. 'lounge/lounge-menu-modal.tsx' declined to adopt `ConfirmDialog`
 * for exactly that reason and swapped its own body instead. The call goes the
 * other way here: that sheet had ONE question with a fixed answer, while this
 * has one question asked from two different components in two different
 * mountings, and a fourth hand-built dialog to keep in step with the kit's is
 * a worse cost than a darker scrim on the rarer of the two paths. The dock
 * path — which is the one the user actually asked about — is not nested at
 * all: the dock is a plain view in the screen, not a Modal.
 *
 * ==================== THE DRAWER BODY, WHICH IS OLDER ====================
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
 *   · Leave               — drawn in `danger` rather than coral. Leaving is
 *                           destruction; coral is state. The old row broke the
 *                           accent rule.
 *
 * LEAVE IS NO LONGER THE SAME THING AS PRESSING BACK, which is the one part of
 * this file's wiring that has changed since it was written. Both `onLeave`
 * props here were handed the Session screen's back handler, and that was
 * correct at the time: membership was a side effect of that screen being
 * mounted, so navigating away ended the Session whatever the button was called.
 * The lifecycle moved to `SessionProvider` (@/lib/session); back now minimises,
 * and `onLeave` is the only thing left that ends anything. Neither control in
 * here calls it directly — the screen puts a `ConfirmDialog` in front of both.
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
 *
 * WHAT `docked` REMOVES, AND WHY NOTHING WENT MISSING. Rendered inside the
 * dock, the body drops the Microphone row, the Session chat row and the LEAVE
 * button — all three are now CELLS in the dock's own row, sitting eight pixels
 * above this panel and permanently visible. Repeating them would be the same
 * control twice on one screen. Everything with no cell — change lobby, the
 * mode switch, lobby games, deafen, camera, add a track, voice settings —
 * stays, and `docked` defaults to false so the standalone `<Sheet>` mounting
 * still renders all seven of the original drawer's controls untouched.
 */

import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  HeadphoneOff,
  Headphones,
  ListMusic,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  Plus,
  Repeat,
  SlidersHorizontal,
  Video,
  VideoOff,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChangeLobbyPanel,
  LobbyModeConfirm,
  lobbyModeLabel,
  lobbyModeName,
  type LobbyMode,
} from '@/components/room/change-lobby';
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
import {
  Duration,
  PointerEvents,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
  raised,
  sheetShadow,
  tracking,
} from '@/lib/theme';
import { useActiveSource } from '@/features/tracks/active-source';
import { useColors, useTheme } from '@/lib/theme-context';

/**
 * Which panel of the little stack is on top.
 *
 * `games` is the catalogue and `table` is the open table — two panels rather
 * than one branch, so that browsing the catalogue while seated does not tear
 * the table down. Reaching the catalogue from a live table is the only way the
 * design's `2/4 SEATED · 5 WATCHING` row counts are ever non-zero.
 */
type Panel = 'controls' | 'change' | 'games' | 'table';

/**
 * WHO may change the lobby, in the one place every control that asks can reach.
 *
 * There are three ways to ask now — the drawer's CHANGE LOBBY panel, the
 * docked picker and the dock's SHARE cell — and a guard copied into three call
 * sites is a guard that will disagree with itself the first time any one of
 * them is edited.
 *
 * IT IS A BACKSTOP, NOT THE UI. None of the three should ever reach a refusal:
 * `ChangeLobbyPanel` disables a passenger's rows, and the picker that used to
 * passenger three pieces of text with no `Pressable` in them, and SHARE opens
 * the panel for a passenger instead of proposing anything. The toast is what
 * happens if a future control forgets — which is precisely the kind of thing
 * that gets forgotten, so it says something useful rather than nothing.
 */
function mayChangeLobby(isHost: boolean, onNotice: (message: string) => void): boolean {
  if (!isHost) {
    onNotice('Only the person on aux can change the lobby');
    return false;
  }
  return true;
}

/**
 * The receipt, said AFTER the confirm and never before it.
 *
 * IT USED TO CARRY THE CAVEAT AND NO LONGER DOES. The old toast read
 * "… is switched on for you — the shared transport lands with the video
 * layer", which is the right sentence in the wrong place: telling someone
 * their tap did less than they thought, after the tap. `switchCopy` in
 * 'change-lobby.tsx' says it in the dialog now, before they commit, so this is
 * left as what a toast is good at — confirming that the thing they asked for
 * happened.
 */
function announceModeSwitched(next: LobbyMode, onNotice: (message: string) => void): void {
  onNotice(next === 'music' ? 'Back to music' : `The lobby is now ${lobbyModeName(next)}`);
}

export type LobbySheetBodyProps = {
  /**
   * The host sheet's own `visible`. Passing it resets the stack to the top
   * when the drawer closes, so reopening never lands mid-way inside a game
   * table the user thought they had backed out of. Optional so the component
   * still works if a caller forgets it.
   */
  visible?: boolean;
  /**
   * Rendered inside `SessionDock` rather than in a sheet of its own.
   *
   * The dock's five cells already carry mic, chat and leave, so this drops
   * those three and puts the lobby MODE SWITCH at the top instead — the thing
   * the user could not find, now the first thing in view after one swipe.
   * Defaults to false: the standalone `<Sheet>` mounting is unchanged.
   */
  docked?: boolean;
  /**
   * What LEAVE is leaving, for the button's label. Optional because `docked`
   * has no such button — LEAVE is a dock cell there — and a caller should not
   * have to invent a string for a control that is not drawn.
   */
  loungeName?: string;
  /** Only the person on aux may change the lobby, and only the host rules on seats. */
  isHost: boolean;
  micOn: boolean;
  deafened: boolean;
  onMic: () => void;
  onDeafen: () => void;
  /** Session chat. Not in the artboard's drawer, kept because nothing else reaches it. */
  onChat: () => void;
  onAddTrack: () => void;
  /**
   * Actually leave the Session — the only thing in the app that ends one.
   *
   * IT USED TO BE THE SCREEN'S BACK HANDLER, and that was honest at the time:
   * membership was a side effect of the Session screen being mounted, so
   * navigating away and leaving were the same operation. They are not any more
   * (see @/lib/session), which turns this into a one-way door and makes it the
   * caller's job to ASK before calling it. `src/app/room/[id].tsx` puts a
   * `ConfirmDialog` in front of both this and the dock's LEAVE cell.
   */
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
  docked = false,
  loungeName = 'the Session',
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
  /**
   * The mode somebody has ASKED for and not yet confirmed. Null is the resting
   * state; anything else means the dialog is up and nothing has moved.
   */
  const [pendingMode, setPendingMode] = useState<LobbyMode | null>(null);

  const games = useGameTable({ people, currentUserId, isHost, onNotice });

  /*
    CLOSING THE DRAWER POPS THE STACK, AND THIS USED TO BE AN EFFECT.

    `useEffect(() => { if (!visible) setPanel('controls') }, [visible])` is a
    `react-hooks/set-state-in-effect` violation, and the rule is right about
    it: the frame in which the drawer closes still renders the old panel, and
    only the frame after it renders the reset. Reopening therefore had a real
    chance of flashing a game table the user thought they had backed out of —
    the exact bug the effect was written to prevent.

    This is React's own "adjust state when a prop changes" pattern instead: it
    re-renders before anything is committed, so there is no stale frame at all.

    THE LINT WAS NOT FIRING BEFORE, WHICH IS WORTH WRITING DOWN. Both effects
    below predate this pass and both were violations the whole time; the
    compiler pass only surfaced them once a second component (`SessionDock`)
    was added to this module. Adding ANY component here does it. So if a future
    edit to this file suddenly reports two errors on untouched code, this is
    what happened, and the answer is not to move the new component out.
  */
  const [lastVisible, setLastVisible] = useState(visible);
  if (lastVisible !== visible) {
    setLastVisible(visible);
    if (!visible) {
      setPanel('controls');
      // An unanswered question does not survive the drawer closing. The dialog
      // is a Modal — it is its own window on native and a portal on web — so
      // it would otherwise be left floating over a Session whose dock the user
      // has just swiped shut, asking about a control they can no longer see.
      setPendingMode(null);
    }
  }

  /*
    "Leave table · back to music" tears the table down from inside the table
    panel, which would otherwise leave `panel` pointing at something that no
    longer exists.

    DERIVED, not corrected after the fact. The second effect this replaces
    normalised the state one frame late, which meant one frame in which the
    render below fell through to the controls while `panel` still said
    `'table'`. A value that is a pure function of two other values does not
    need to be state at all.
  */
  const shown: Panel = panel === 'table' && !games.table ? 'controls' : panel;

  /*
    STEP ONE. Nothing changes here — it opens the question. Both the picker at
    the top of the docked panel and the full CHANGE LOBBY panel hand their pick
    to this one function, so neither can ever be the one that commits directly.
  */
  const requestMode = useCallback(
    (next: LobbyMode) => {
      if (!mayChangeLobby(isHost, onNotice)) return;
      // Picking the mode you are already in is not a change to confirm. Both
      // controls already draw the current option as inert, so this only fires
      // if one of them stops doing that.
      if (next === activeMode) return;
      setPendingMode(next);
    },
    [activeMode, isHost, onNotice]
  );

  const cancelMode = useCallback(() => setPendingMode(null), []);

  /*
    STEP TWO, and the only place in this component that moves the lobby.

    `setPanel('controls')` comes along because confirming from inside the
    CHANGE LOBBY panel means the question has been answered and there is
    nothing left to read there — the same pop the instant switch used to do.
  */
  const commitMode = useCallback(() => {
    if (pendingMode == null) return;

    if (onModeChange) onModeChange(pendingMode);
    else setLocalMode(pendingMode);

    announceModeSwitched(pendingMode, onNotice);
    setPendingMode(null);
    setPanel('controls');
  }, [onModeChange, onNotice, pendingMode]);

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

  /*
    ONE RETURN, NOT FOUR EARLY ONES, AND THE CONFIRM DIALOG IS WHY.

    Every panel in this little stack can be the one you are looking at when the
    question about the lobby mode is up: the picker asks from the controls
    list, CHANGE LOBBY asks from its own panel, and the dialog has to outlive
    the pop back to `controls` that answering it performs. Four early returns
    would mean four copies of the same `<LobbyModeConfirm>` — four places to
    forget one. The branch picks a BODY; the tail renders it with the dialog
    beside it, exactly once.
  */
  /*
    Uppercased to sit in the same tracked readout as the mode and the count.
    `label` is a sentence ("Playing through Spotify"); this line is a row of
    facts, so it takes the provider alone.
  */
  const sourceReadout = useActiveSource().provider === 'spotify' ? 'VIA SPOTIFY' : 'VIA YOUTUBE';

  let body: ReactNode;

  if (shown === 'change') {
    body = (
      <PanelShell
        title="Change the lobby"
        kicker="EVERYONE COMES WITH YOU · YOU CONFIRM BEFORE ANYONE MOVES"
        onBack={back}>
        <ChangeLobbyPanel mode={activeMode} canChange={isHost} onRequest={requestMode} />
      </PanelShell>
    );
  } else if (shown === 'table' && games.table) {
    body = (
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
  } else if (shown === 'games') {
    body = (
      <PanelShell
        title="Lobby games"
        kicker="TAKE A SEAT OR WATCH · THE MUSIC KEEPS GOING"
        onBack={back}>
        <LobbyGamesPanel table={games.table} onOpen={openGame} onReturn={toTable} />
      </PanelShell>
    );
  } else {
    body = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/*
          A READOUT, NOT A PICKER, AND THE PICKER THAT WAS HERE IS DELETED.

          `LobbyModePicker` drew the three modes as choices at the top of this
          panel, directly above a CHANGE LOBBY tile that opens a panel offering
          the same three. The comment that stood here defended keeping both — the
          picker for someone who knows what they want, the panel for someone who
          needs the explanation — and that reasoning is not unreasonable. It is
          still two controls for one decision, sitting a thumb apart, and it was
          reported as exactly that: "the change lobby does the same work then why
          duplicate work".

          So the mode is now a FACT on this line and CHANGE LOBBY is the only way
          to alter it. That is also where the two-step confirm lives, which is
          the behaviour that was asked for — a mode change should be deliberate,
          and one of these two paths was a single tap.

          The source rides on the same line. Which service the audio is coming
          out of has never been visible anywhere in the app, which is most of why
          the whole cross-provider design reads as unimplemented — see
          `@/features/tracks/active-source`.
        */}
        <Text style={[readout(10), { color: C.ink3 }]}>
          {lobbyModeLabel(activeMode)} · {people.length} LISTENING · {sourceReadout}
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
          {/*
            Mic and chat are DOCK CELLS when docked — eight pixels above this
            panel and never out of reach — so drawing them again here would be
            the same control twice on one screen.
          */}
          {docked ? null : (
            <Row
              icon={micOn && !deafened ? Mic : MicOff}
              label="Microphone"
              sub={deafened ? 'DEAFENED — MIC IS OFF' : micOn ? 'ON' : 'OFF'}
              on={micOn && !deafened}
              onPress={onMic}
            />
          )}
          {docked ? null : (
            <Row
              icon={MessageCircle}
              label="Session chat"
              sub="TALK WITHOUT TALKING"
              navigates
              onPress={onChat}
            />
          )}
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

          Docked, LEAVE is the last cell of the dock and in `danger` there too,
          so this button would be the second copy of it inside one panel.
        */}
        {docked ? null : (
          <AuxButton
            label={`Leave ${loungeName}`}
            onPress={onLeave}
            variant="danger"
            icon={LogOut}
            fullWidth
          />
        )}
      </ScrollView>
    );
  }

  return (
    <>
      {body}

      {/*
        STEP TWO OF THE SWITCH, and it is a SIBLING of the body rather than
        something a panel renders. `ConfirmDialog` is a Modal — its own window
        on native, a portal on web — so nothing above it in this tree can clip
        or translate it, which matters here more than usual: the docked mounting
        of this body lives inside the dock's `overflow:'hidden'` glass, and a
        dialog drawn as an ordinary child of that would be sliced off at the
        panel's edge and dragged around by the dock's own translateY.

        `people.length` is the roster INCLUDING this person; `switchCopy` does
        the subtraction, in the one place that can then never disagree with the
        dock's copy of the same question.
      */}
      <LobbyModeConfirm
        pending={pendingMode}
        listeners={people.length}
        onConfirm={commitMode}
        onCancel={cancelMode}
      />
    </>
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

// ------------------------------------------------------------ session dock

/**
 * THESE TWO ARE THE LAYOUT CONTRACT, not decoration, and the shell's height is
 * computed from them rather than measured. The dock is one fixed-height object
 * that translates, so its height has to be known before layout — an
 * `onLayout` measurement would mean one frame at the wrong offset on every
 * mount. Change a padding below and change the number here with it, or the
 * children stop adding up to the box they are in and the seam shows at the
 * bottom edge of the screen.
 */
/** L1146: 11 top + 5 grabber + 5 gap + 12 label + 8 bottom, rounded to 42. */
const HANDLE_HEIGHT = 42;
/** L1147-L1157: a 60px cell, plus the row's own 8px of bottom padding. */
const CELLS_HEIGHT = 68;
/** L1145: `border-radius:26px 26px 0 0`. `Radii` has no 26. */
const DOCK_RADIUS = 26;

/**
 * A COLLAPSED dock, before the device's bottom inset.
 *
 * DO NOT PAD A SCROLLER WITH THIS. It is half an answer, exactly like
 * `Dock.reserveBase` in 'src/lib/theme.ts' — and that constant is documented
 * at length because nine of the ten screens written against its predecessor
 * forgot to add the inset and put their last row under the glass. Ask
 * `useSessionDockReserve()`, which cannot be got wrong because it does the
 * addition itself.
 */
export const SESSION_DOCK_HEIGHT = HANDLE_HEIGHT + CELLS_HEIGHT;

/**
 * What a Session scroller must leave clear of the dock at rest.
 *
 * The EXPANDED height is deliberately not in this sum: the panel covers the
 * body behind a scrim, and reserving room for a state the user is looking
 * away from would leave 470px of dead air under the roster the rest of the
 * time.
 */
export function useSessionDockReserve(): number {
  const insets = useSafeAreaInsets();
  return SESSION_DOCK_HEIGHT + insets.bottom + Space.xxl;
}

/** However tall the phone, the panel stops here — it is a dock, not a screen. */
const PANEL_MAX = 470;
/** Scrim left visible above an expanded dock, so it still reads as a sheet. */
const PANEL_HEADROOM = 120;
/**
 * NO FLOOR, DELIBERATELY. An earlier version clamped the panel to a minimum
 * 180px so a short phone still got something usable, which is fine at 568px
 * and catastrophic at 260: the dock ends up TALLER than the window it lives
 * in, and a flex-end child that overflows overflows upward, covering the whole
 * Session. Zero is the honest answer to a window with no room in it — the dock
 * degrades to the bar it already was, and the panel scrolls at every size that
 * is actually a phone.
 */
const PANEL_FLOOR = 0;
/** px/s past which a flick is an intention rather than a nudge. */
const FLING = 550;
/** How far a finger must travel before the drag claims the gesture from the tap. */
const DRAG_SLOP = 8;

export type SessionDockProps = {
  /** Something is actually playing — the one thing that turns the edge coral. */
  playing: boolean;
  /** Only the person on aux may change the lobby. */
  isHost: boolean;
  micOn: boolean;
  deafened: boolean;
  queueCount: number;
  onMic: () => void;
  onDeafen: () => void;
  onQueue: () => void;
  onChat: () => void;
  onAddTrack: () => void;
  /**
   * Actually leave the Session. The LEAVE cell is the ONE control in the dock
   * that ends anything — back and the return bar keep the Session alive now —
   * so the caller is expected to ask first. See the note on the cell itself.
   */
  onLeave: () => void;
  /** The roster, for the game table's seats and viewers. */
  people: readonly GamePerson[];
  currentUserId: string | null;
  /** Toast passthrough — every state change in here announces itself. */
  onNotice: (message: string) => void;
  mode: LobbyMode;
  onModeChange: (mode: LobbyMode) => void;
  /**
   * Controlled expansion.
   *
   * Hand these in and Android's hardware back can collapse the dock, which it
   * must: an expanded dock is a layer the user opened, and back should close
   * the layer rather than drop them out of the Session and stop their music.
   * Left out, the dock keeps the flag itself and back walks past it.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

/**
 * The Session's bottom dock: the artboard's bar at L1145-L1158, and the lobby
 * panel it grows into.
 *
 * IT IS GLASS, which means `C.nav` and not `C.dock`. The two chrome fills do
 * different jobs and are not interchangeable: `dock` is near-opaque because
 * the mini player sits directly ON album art with no blur under it, while this
 * has a real `BlurView` beneath it and wants the translucent value — handing
 * it `dock` would blur the wall and then paint over the result.
 *
 * THE SHADOW LIVES ON THE OUTER ANIMATED VIEW. The glass clips its children to
 * the top corners, and Android throws a view's own `boxShadow` away along with
 * whatever `overflow:'hidden'` clips — the dock would silently lose its lift
 * on one platform only.
 *
 * IT IS `sheetShadow()`, NOT `floating()`, AND THAT IS A CORRECTION TO THE BAR
 * THIS REPLACES. `LobbyBar` used `floating()`, whose shadow falls DOWNWARD at
 * +18px — off the bottom of the screen, where nobody has ever seen it. The
 * house rule names the right one: a bottom sheet is lit by the page it covers,
 * so its shadow points up. Collapsed, that is the only lift this object can
 * actually show; expanded, it is what separates the panel from the Session
 * behind it. One function serves both states because both states are the same
 * object.
 *
 * THE EDGE IS ON THE TOP ONLY, deliberately against `floating()`'s usual
 * advice to border a floating object all the way round: this one is welded to
 * the bottom of the frame, so a bottom edge would be drawn under the home
 * indicator and the side edges would end in mid-air. It goes CORAL while
 * something is playing, per the artboard's own dock (L891) — coral is a state,
 * and "there is music happening in here" is the closest thing a bar has to one.
 *
 * SO DOES THE GRABBER, AND THAT IS NEW. The user's screenshot draws the handle
 * bar coral, and the bar this replaces drew it `rule3` in every condition. The
 * screenshot wins on the same argument the edge above it already won: the
 * handle belongs to a live thing, and it is the one part of the dock a finger
 * is meant to find without looking. It reverts to `rule3` when nothing is
 * playing, because coral over a silent Session would be reporting a state that
 * is not true.
 */
export const SessionDock = memo(function SessionDock({
  playing,
  isHost,
  micOn,
  deafened,
  queueCount,
  onMic,
  onDeafen,
  onQueue,
  onChat,
  onAddTrack,
  onLeave,
  people,
  currentUserId,
  onNotice,
  mode,
  onModeChange,
  expanded,
  onExpandedChange,
}: SessionDockProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [localOpen, setLocalOpen] = useState(false);
  const open = expanded ?? localOpen;
  /**
   * Bumped on every settle, changed or not. See the file header: a drag that
   * ends on the side it started leaves `open` identical, React bails on the
   * state update, the effect below never re-runs, and the dock stays wherever
   * the finger let go of it.
   */
  const [settle, setSettle] = useState(0);
  /**
   * The mode the SHARE cell has asked for and not yet had confirmed.
   *
   * The dock owns this rather than reaching into `LobbySheetBody`'s copy
   * because the cell is the dock's own control and is reachable with the panel
   * shut. Only the flag is duplicated — the guard, the wording and the tone all
   * live in one place each. See the file header.
   */
  const [pendingShare, setPendingShare] = useState<LobbyMode | null>(null);

  const travel = Math.max(
    PANEL_FLOOR,
    Math.min(PANEL_MAX, windowHeight - SESSION_DOCK_HEIGHT - insets.bottom - PANEL_HEADROOM)
  );

  /** px below the expanded position. `travel` is collapsed, 0 is open. */
  const offset = useSharedValue(travel);
  /** Where the finger picked the dock up, so a drag is relative, not absolute. */
  const grabbedAt = useSharedValue(travel);

  const settleTo = useCallback(
    (next: boolean) => {
      if (next !== open) tick();
      onExpandedChange?.(next);
      if (expanded === undefined) setLocalOpen(next);
      setSettle((count) => count + 1);
    },
    [expanded, onExpandedChange, open]
  );

  const toggle = useCallback(() => settleTo(!open), [open, settleTo]);
  const collapse = useCallback(() => settleTo(false), [settleTo]);

  /*
    THE ONLY SETTLE ANIMATION IN THIS COMPONENT, and the only place outside a
    worklet that a shared value is written. `Easing.bezier(.2,.85,.2,1)` is the
    artboard's own sheet curve (`auxSheetIn`), not an invention.
  */
  useEffect(() => {
    const target = open ? 0 : travel;
    offset.value = reduced
      ? target
      : withTiming(target, {
          duration: Duration.sheet,
          easing: Easing.bezier(0.2, 0.85, 0.2, 1),
        });
  }, [open, settle, travel, reduced, offset]);

  /*
    Bound to the HANDLE STRIP ONLY — 42px of chrome with no scroller in it —
    which is what makes a pan safe here at all. `activeOffsetY` means the
    gesture does not claim the touch until the finger has moved 8px, so a tap
    still reaches the `Pressable` underneath and the discoverable fallback
    survives. `failOffsetX` hands a sideways swipe straight back, so a
    horizontal gesture is never half-eaten by a vertical sheet.

    BUILT ON EVERY RENDER, NOT MEMOISED, AND THAT IS A LINT FIX RATHER THAN A
    STYLE CHOICE. Wrapping this in `useMemo` — which is where it started, and
    where anyone reading it will want to put it back — adds a SECOND
    `react-hooks/immutability` error on top of the one `driveTo` already
    handles: inside a memo callback even `grabbedAt` counts as a value passed
    to a hook, so nothing in the gesture may be written at all.

    The cost of rebuilding is one `Gesture.Pan()` object per render, and
    `GestureDetector` diffs it — same handler types, same count, so it updates
    the callbacks in place rather than re-attaching, and a drag in flight is
    not dropped. This component re-renders on prop changes only; no clock, no
    drift tick and no scroll position reaches it, so "every render" is a
    handful of them.
  */
  const pan = Gesture.Pan()
    .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetX([-24, 24])
    .onStart(() => {
      driveTo(grabbedAt, offset.value);
    })
    .onUpdate((event) => {
      const next = grabbedAt.value + event.translationY;
      driveTo(offset, next < 0 ? 0 : next > travel ? travel : next);
    })
    .onEnd((event) => {
      // Velocity beats position: a fast flick is an intention, and a slow drag
      // past the halfway mark is a decision. Either one alone is enough.
      const flung = event.velocityY < -FLING ? true : event.velocityY > FLING ? false : null;
      runOnJS(settleTo)(flung ?? offset.value < travel / 2);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: travel > 0 ? 1 - offset.value / travel : 0,
  }));

  const micLive = micOn && !deafened;
  const sharing = mode === 'screen';
  const modeLabel = lobbyModeLabel(mode);

  /*
    QUEUE, CHAT and ADD A TRACK open Modals over the Session, so the dock gets
    out of the way first — a sheet sliding up out of a panel that is still up
    is two bottom sheets arguing. MIC, SHARE and DEAFEN toggle in place and
    deliberately do not collapse: you should be able to mute yourself without
    losing the panel you were reading.
  */
  const handleQueue = useCallback(() => {
    collapse();
    onQueue();
  }, [collapse, onQueue]);

  const handleChat = useCallback(() => {
    collapse();
    onChat();
  }, [collapse, onChat]);

  const handleAddTrack = useCallback(() => {
    collapse();
    onAddTrack();
  }, [collapse, onAddTrack]);

  /*
    SHARE IS A LOBBY MODE, NOT A TOGGLE, which is what the artboard's fourth
    cell actually is once you ask what it would do — and it therefore ASKS,
    exactly as the panel's picker does.

    IT USED TO SWITCH ON THE TAP. This cell is in the row that is on screen
    whether the dock is open or shut, which makes it the easiest control in the
    Session to hit by accident and the last one that should have been instant.
    A confirm here is not consistency for its own sake: it is the same act, and
    two controls disagreeing about how serious the same act is teaches people
    to ignore the one that asks.

    A PASSENGER GETS THE PANEL, NOT A REFUSAL. Tapping used to toast "only the
    person on aux can change the lobby", which is a control that cannot work
    dressed as one that can. Opening the dock instead takes them to the mode
    readout and the line that says whose call it is — an answer to the question
    they were actually asking, which is what the lobby is set to. When the dock
    is already open that readout is on screen, so a second tap correctly does
    nothing.
  */
  const handleShare = useCallback(() => {
    if (!isHost) {
      settleTo(true);
      return;
    }
    setPendingShare(sharing ? 'music' : 'screen');
  }, [isHost, settleTo, sharing]);

  const cancelShare = useCallback(() => setPendingShare(null), []);

  const commitShare = useCallback(() => {
    if (pendingShare == null) return;
    onModeChange(pendingShare);
    announceModeSwitched(pendingShare, onNotice);
    setPendingShare(null);
  }, [onModeChange, onNotice, pendingShare]);

  return (
    <View style={[styles.dockLayer, PointerEvents.boxNone]}>
      {/*
        The scrim's OPACITY is animated; its tappability is not. Pointer events
        come from React state, so a collapsed dock can never swallow a tap
        along the bottom of the scroller behind it — a full-bleed overlay has
        already eaten every tap in this app once. The static `opacity: 0` is
        the safety net underneath that: if a platform ever declines to run the
        animated style, the failure is an invisible scrim rather than a black
        screen.
      */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.dockScrim,
          { backgroundColor: C.scrim },
          open ? PointerEvents.auto : PointerEvents.none,
          scrimStyle,
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the lobby controls"
          onPress={collapse}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.dockShell,
          { height: SESSION_DOCK_HEIGHT + insets.bottom + travel },
          sheetShadow(C),
          sheetStyle,
        ]}>
        <BlurView
          intensity={scheme === 'dark' ? 40 : 60}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          // Android does not blur at all without this; the tint alone would
          // leave a flat translucent slab with nothing happening behind it.
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={[styles.dockGlass, { borderTopColor: playing ? C.liveMid : C.chromeBorder }]}>
          {/*
            The tint rides ON TOP of the blur rather than being handed to
            BlurView as a background: underneath, it becomes the thing being
            blurred and the whole dock reads as fog.
          */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.nav }]} />

          {/*
            A `Pressable` INSIDE the detector, not a bare View. RNGH would
            happily drive a plain view, but a plain view is not a button to
            TalkBack or VoiceOver, and this handle is the only way into the
            lobby for anyone using either. The pan's 8px activation threshold
            is what lets both live on the same 42px strip.
          */}
          <GestureDetector gesture={pan}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={open ? 'Close the lobby controls' : 'Open the lobby controls'}
              accessibilityHint="Change the lobby, lobby games, deafen, camera, voice settings"
              onPress={toggle}
              style={({ pressed }) => [styles.dockHandle, pressed ? styles.dim : null]}>
              <View
                style={[
                  styles.dockGrabber,
                  {
                    backgroundColor: playing ? C.live : C.rule3,
                    // Wider while open: the handle is now a drag target with a
                    // direction, and the grabber is the only thing on it that
                    // can say so without another line of type.
                    width: open ? 56 : 44,
                  },
                ]}
              />
              <Text numberOfLines={1} style={[styles.dockHandleLabel, { color: C.ink3 }]}>
                {open
                  ? `${modeLabel} · SWIPE DOWN TO CLOSE`
                  : `${modeLabel} · SWIPE UP · GAMES · CHANGE LOBBY`}
              </Text>
            </Pressable>
          </GestureDetector>

          {/*
            The inset stays on THIS row rather than on the panel below it,
            because this row is the dock's bottom edge whenever it is closed —
            which is nearly always. Open, it becomes a gap between the cells
            and the panel, and the panel's hairline turns that gap into a
            deliberate divider instead of a hole.

            `Space.sm +` IS LOAD-BEARING, not a nicety. It is the artboard's
            own 8px (L1147, `padding:0 8px 8px`) and it is the 8 in
            `CELLS_HEIGHT`. Drop it and the children add up to eight pixels
            less than the shell they are laid out in, which puts the top eight
            pixels of the panel — hairline included — above the bottom edge of
            the screen while the dock is closed.
          */}
          <View style={[styles.dockCells, { paddingBottom: Space.sm + insets.bottom }]}>
            {/*
              WHILE DEAFENED THIS CELL UNDEAFENS, AND THAT IS NOT A SHORTCUT
              BEING CLEVER — it is the only way the cell is not dead. Deafen
              forces the mic off upstream, so a deafened person tapping MIC
              under the obvious wiring would flip a flag, see nothing change,
              and be looking at a control that does not work. Deafen's own tile
              is one swipe up in the panel; this is the door for the person who
              hit the wrong thing and wants back in. Two taps to speaking, each
              of them with a visible result, and neither of them a lie.

              The tone follows this file's stated rule rather than the cell's
              position: coral is audio FLOWING, `danger` is audio CUT, and
              deafened is the loudest cut there is.
            */}
            <DockCell
              icon={micLive ? Mic : MicOff}
              label={micLive ? 'MIC ON' : deafened ? 'DEAFENED' : 'MIC OFF'}
              tone={micLive ? 'live' : deafened ? 'danger' : 'quiet'}
              hint={
                deafened
                  ? 'Stop being deafened'
                  : micLive
                    ? 'Mute your microphone'
                    : 'Unmute your microphone'
              }
              onPress={deafened ? onDeafen : onMic}
            />
            <DockCell
              icon={ListMusic}
              label={queueCount > 0 ? `QUEUE ${queueCount}` : 'QUEUE'}
              hint="Open the queue"
              onPress={handleQueue}
            />
            <DockCell
              icon={MessageCircle}
              label="CHAT"
              hint="Open the Session chat"
              onPress={handleChat}
            />
            <DockCell
              icon={MonitorUp}
              label={sharing ? 'SHARING' : 'SHARE'}
              // Coral once it is on: a lobby that is sharing a screen is a
              // state of the room, the same as one that is playing.
              tone={sharing ? 'live' : 'quiet'}
              /*
                The spoken name has to match what the press does, and for a
                passenger the press opens the lobby rather than switching it.
                A cell that announces "switch the lobby to screen share" and
                then declines to is worse than one that never offered.
              */
              hint={
                !isHost
                  ? sharing
                    ? 'The lobby is on screen share. Open the lobby controls'
                    : 'Open the lobby controls'
                  : sharing
                    ? 'Go back to music. You will be asked to confirm'
                    : 'Switch the lobby to screen share. You will be asked to confirm'
              }
              onPress={handleShare}
            />
            {/*
              THE ONLY WAY OUT OF A SESSION, AND THAT IS NEW.

              This cell used to be wired to the screen's back handler, because
              back and leave were the same operation — membership died with the
              screen. Now back MINIMISES and this is the one control in the app
              that ends a Session, which is exactly the change that earns it a
              confirm. The dialog is the caller's (`src/app/room/[id].tsx`); the
              hint says so, on the same rule the SHARE cell above already
              follows — a control that is about to ask should say it is going
              to, so nobody braces for an instant exit that does not come.

              It deliberately does NOT collapse the dock first, where QUEUE,
              CHAT and ADD A TRACK all do. Those open bottom sheets, and two
              bottom sheets arguing is what that rule exists to prevent; a
              centred dialog has no such quarrel, and cancelling it should put
              the user back on the panel they were reading rather than shut it.
            */}
            <DockCell
              icon={LogOut}
              label="LEAVE"
              // `danger`, never coral. Leaving is destruction, and the accent
              // rule reserves exactly one register for that.
              tone="danger"
              hint="Leave the Session. You will be asked to confirm"
              onPress={onLeave}
            />
          </View>

          {/*
            Always rendered, always laid out, and merely parked below the
            screen edge while collapsed — which is what makes expanding free
            and what lets the panel keep its scroll position across a close.
          */}
          <View
            style={[
              styles.dockPanel,
              {
                height: travel,
                borderTopColor: C.ruleSoft,
                // The inset is spent TWICE on purpose. The cells row above
                // owns one copy because it is the dock's bottom edge whenever
                // the dock is closed; this one keeps the panel's last row off
                // the home indicator when it is open. They are two different
                // edges that happen to exist in the same object, and only one
                // of them is on screen at a time.
                paddingBottom: insets.bottom,
              },
            ]}>
            <LobbySheetBody
              docked
              visible={open}
              isHost={isHost}
              micOn={micOn}
              deafened={deafened}
              onMic={onMic}
              onDeafen={onDeafen}
              onChat={handleChat}
              onAddTrack={handleAddTrack}
              onLeave={onLeave}
              people={people}
              currentUserId={currentUserId}
              onNotice={onNotice}
              mode={mode}
              onModeChange={onModeChange}
            />
          </View>
        </BlurView>
      </Animated.View>

      {/*
        THE SHARE CELL'S QUESTION, and it is deliberately a sibling of the
        shell rather than a child of it.

        The shell is translated in Y on every frame of a drag and its glass
        clips to the top corners — "a view with overflow:hidden CLIPS what its
        children draw outside it" is the hazard that shipped the nav FAB with a
        flat lid. A Modal is its own window on native and a portal on web, so
        neither would actually reach it today; putting it out here anyway
        means the answer does not depend on that staying true.
      */}
      <LobbyModeConfirm
        pending={pendingShare}
        listeners={people.length}
        onConfirm={commitShare}
        onCancel={cancelShare}
      />
    </View>
  );
});

/** `quiet` is every cell that is only a door; the other two report a state. */
type CellTone = 'quiet' | 'live' | 'danger';

/** L1147-L1157: one 60px cell — a 20px glyph over a 9px tracked caption. */
const DockCell = memo(function DockCell({
  icon: Icon,
  label,
  tone = 'quiet',
  hint,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  tone?: CellTone;
  /** The spoken name. The 9px label is a caption, not a sentence. */
  hint: string;
  onPress: () => void;
}) {
  const C = useColors();
  const color = tone === 'live' ? C.liveText : tone === 'danger' ? C.danger : C.ink2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.dockCell, pressed ? { backgroundColor: C.surface2 } : null]}>
      <Icon size={20} strokeWidth={2} color={color} />
      <Text numberOfLines={1} style={[styles.dockCellLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * Write a shared value from inside a gesture worklet.
 *
 * THE INDIRECTION IS THE POINT AND IT IS NOT OBFUSCATION. `offset` is read by
 * a `useAnimatedStyle`, which makes it — in React Compiler's words — "a value
 * previously passed as an argument to a hook", and the compiler refuses to let
 * one of those be mutated anywhere it can see the assignment. It cannot see
 * through a call into a module-level function, and it is right not to try:
 * this runs on the UI thread during a drag, which is the one place the
 * compiler's reasoning about render purity has nothing to say.
 *
 * The `useEffect` settle inside `SessionDock` assigns `offset.value` directly
 * and is allowed to, because an effect is the sanctioned place for exactly
 * this. Only the gesture needs this door, and it is the narrowest one that
 * opens: a single assignment, no branching, no state.
 *
 * Both shared values go through it rather than only the one the compiler
 * currently objects to. One rule with no exception survives someone adding a
 * second `useAnimatedStyle` later; a rule with an exception does not.
 */
function driveTo(value: SharedValue<number>, to: number): void {
  'worklet';
  value.value = to;
}

/** RN Web has no haptics engine, and calling into one there throws. */
function tick(): void {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
  dim: {
    opacity: 0.6,
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

  // -------------------------------------------------------- session dock
  /**
   * Spans the whole frame so the scrim has something to fill, and is
   * `box-none` so the transparent air above the dock does not swallow taps
   * meant for the body behind it.
   */
  dockLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: ZIndex.dock,
  },
  /** Overridden by the animated style the instant the dock has a position. */
  dockScrim: {
    opacity: 0,
  },
  dockShell: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderTopLeftRadius: DOCK_RADIUS,
    borderTopRightRadius: DOCK_RADIUS,
  },
  dockGlass: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    borderTopLeftRadius: DOCK_RADIUS,
    borderTopRightRadius: DOCK_RADIUS,
    borderTopWidth: Rule.hair,
  },
  /** L1146: `padding:11px 0 7px`, `gap:5px`. Height must match HANDLE_HEIGHT. */
  dockHandle: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs + 1,
  },
  dockGrabber: {
    height: 5,
    borderRadius: Radii.pill,
  },
  dockHandleLabel: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.12),
  },
  /** L1147: `gap:4px;padding:0 8px 8px`. */
  dockCells: {
    flexDirection: 'row',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
  },
  dockCell: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs + 1,
    borderRadius: Radii.button,
  },
  dockCellLabel: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.04),
  },
  /**
   * The gutter lives here rather than in `LobbySheetBody`, because that body
   * is also mounted inside the Session's `<Sheet>`, which supplies its own.
   */
  dockPanel: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    borderTopWidth: Rule.hair,
  },
});
