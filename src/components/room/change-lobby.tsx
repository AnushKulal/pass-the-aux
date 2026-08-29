/**
 * Change the lobby — the three things a Session can be, and the two-step that
 * moves everyone between them.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L1308-L1331 (`sheetUpgrade`)
 * and README §9 "Change the lobby".
 *
 * THIS FEATURE HAD NO IMPLEMENTATION BEFORE THIS FILE. The Session's lobby
 * sheet offered "Movie night" and "Screen share" as two dead rows chipped
 * `Soon`, and there was nothing anywhere that said which mode the lobby was
 * in or moved it to another one. The user named "change lobby" as a feature
 * they could not find in the shipped build — this is it.
 *
 * THERE IS NO BACKEND FOR IT. `rooms` has no `mode` column — see the Row type
 * in 'src/lib/database.types.ts' — so the mode is local state, exactly as mic,
 * deafen and per-person mute already are in the Session screen. That is a
 * deliberate copy of the precedent set there: the controls have to exist and
 * behave correctly before the transport arrives, and the RELATIONSHIPS are the
 * part worth getting right now — who may switch, what the switch promises,
 * and who follows. When a real `rooms.mode` lands, the only change here is
 * where `mode` comes from and where the commit writes to; every control in
 * this file is already controlled from outside for exactly that reason.
 *
 * ====================== THE SWITCH IS TWO STEPS NOW ======================
 *
 * The user, verbatim: "after the session is created and the swipe up thing i
 * dont want a toggle over there to change the lobby mode and suppose i change
 * then let it give me an option so it works that way".
 *
 * WHAT WAS HERE AND WHY IT WAS WRONG. `LobbyModeSwitch` was a `SheetTabs`
 * segmented control parked at the top of the session dock's expanded panel:
 * one tap on a segment and the lobby mode changed, instantly, for a room other
 * people are sitting in. It was put there to answer a complaint about
 * DISTANCE — change lobby used to be three layers deep — and it answered that
 * complaint by making the most consequential control in the drawer the easiest
 * thing in the app to hit by accident. A segmented control is the right shape
 * for a filter over a list I am reading. It is the wrong shape for an action
 * that moves everyone else in the room, because a segment's whole promise is
 * that tapping it is free and reversible, and this is neither.
 *
 * `ChangeLobbyPanel` replaces it with three CHOICES rather than three segments,
 * and picking one does not switch anything: it proposes. `LobbyModeConfirm`
 * asks, states what the switch costs the room, and only then does the owner
 * commit. Two deliberate acts, which is one more than a stray thumb produces.
 *
 * THE DIALOG IS `ConfirmDialog` FROM THE KIT, not a fourth hand-built one and
 * emphatically not `Alert.alert` — react-native-web ships no Alert, so on web
 * the guard would silently evaporate and the instant switch would be back,
 * which is the exact bug 'ui/confirm-dialog.tsx' was extracted to end.
 *
 * A CONFIRM THAT DOES NOT SAY WHAT IT COSTS IS JUST AN EXTRA TAP, so
 * `switchCopy` below names the consequence out loud: how many other people
 * follow, that the queue survives, that the music does not stop, and — for
 * movie night and screen share — that there is no shared picture behind them
 * yet. That last sentence used to be a toast fired AFTER the switch had
 * already happened, which is the wrong order in which to tell someone their
 * tap did less than they thought it would.
 *
 * ONLY THE PERSON ON AUX, AND THIS FILE USED TO ARGUE THE OTHER SIDE. The old
 * header read "A PASSENGER'S TAP IS NOT SWALLOWED SILENTLY … the tap runs
 * `onChange`, the owner's guard refuses it, and a toast says why. A greyed-out
 * control would have said the same thing with less information". That argument
 * was about a segment that at least reported the current mode while it refused
 * you. It does not survive the two-step: a choice card exists only to propose
 * a change, so handing a passenger three of them is handing them a control
 * that cannot work, and a refusal toast is a worse answer than never having
 * offered. A passenger therefore gets the same three cards drawn as a
 * READOUT — no `Pressable` anywhere in them — with the current mode lit and
 * the caption underneath saying whose call it is.
 *
 * ACCENT: THE CURRENT MODE IS BLUE, AND THIS FILE USED TO ARGUE THAT TOO.
 *
 * It shipped with a `liveText` icon and a solid-coral `accent` badge, on the
 * reasoning that the lobby's mode is a state of the world every listener
 * shares rather than a filter this one user picked. That reading is arguable —
 * the mode genuinely is true of the room — but it loses to the fact that this
 * is the app's THIRD selection control and the other two are already blue:
 * 'ui/chip.tsx' paints the selected chip `pill`, and 'ui/sheet-tabs.tsx'
 * argues in its own header that "Selecting is something you DO, so it takes
 * the action colour". Three selection controls in two accents is drift
 * whichever accent wins, and blue is the one two of the three already hold.
 * It is also the honest reading of what this list is: the mode only ever
 * changes because somebody standing in it picked a card and then said yes.
 *
 * `cream` is the badge tone for that, because `cream` and `pill` resolve to
 * the same blue — it is `accent` with the action hue instead of the state hue.
 * The confirm dialog takes `pri` for the same reason and never `danger`:
 * switching a lobby is CONTROL, not destruction, and pink is reserved for
 * destruction alone.
 *
 * The rows and cards carry no second accent of their own: the card IS the
 * control, so painting it as well would put two accents on one element.
 *
 * TRANSLUCENCY: the fills here are `surfaceSolid`. These controls are pushed
 * inside the Session's lobby `<Sheet>` and inside the dock, both of which are
 * `BlurView`s — a 5.5%-white row laid over a blur has nothing to sit on and
 * loses its edge entirely. On a plain ground `surfaceSolid` is the resolved
 * composite of the same colour, so this costs nothing anywhere else.
 *
 * TWO CONTROLS STILL, AND THEY DO DIFFERENT JOBS. `ChangeLobbyPanel` is the
 * FULL answer — three rows, each carrying the promise its mode makes, plus the
 * footnote about who may switch — and it is what the CHANGE LOBBY tile opens.
 * The dock's control panel used to compress the same three modes into the top of the
 * session dock's panel, one swipe from anywhere in the Session. Both propose;
 * neither commits. They hand the same `onRequest` to the same owner, so the
 * two can never come to disagree about what a pick means.
 */

import { Film, MonitorUp, Music4, type LucideIcon } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmDialog, StatusPill } from '@/components/ui';
import { Radii, Rule, Space, TOUCH_TARGET, Type, raised, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** What a Session is doing. Music is the only one with a transport behind it. */
export type LobbyMode = 'music' | 'movie' | 'screen';

type ModeDef = {
  id: LobbyMode;
  name: string;
  /** The promise the mode makes, in the design's own words. */
  blurb: string;
  icon: LucideIcon;
};

/**
 * Ordered as the design orders them, which is also least-to-most disruptive:
 * music is the mode the Session is born in and the only one that survives a
 * reload today.
 */
export const LOBBY_MODES: readonly ModeDef[] = [
  {
    id: 'music',
    name: 'Music',
    blurb: 'A shared queue, synced to the fraction of a second.',
    icon: Music4,
  },
  {
    id: 'movie',
    name: 'Movie night',
    blurb: 'Same sync engine, longer timeline. Subtitles stay per-person.',
    icon: Film,
  },
  {
    id: 'screen',
    name: 'Screen share',
    blurb: 'One person shares, everyone else gets a View screen button.',
    icon: MonitorUp,
  },
];

const modeDef = (mode: LobbyMode): ModeDef =>
  LOBBY_MODES.find((entry) => entry.id === mode) ?? LOBBY_MODES[0];

/** Sentence case, for prose — a dialog title is a sentence, not a readout. */
export function lobbyModeName(mode: LobbyMode): string {
  return modeDef(mode).name;
}

/** For the drawer's subtitle line, which reads `MUSIC · 6 LISTENING`. */
export function lobbyModeLabel(mode: LobbyMode): string {
  return lobbyModeName(mode).toUpperCase();
}

// --------------------------------------------------------------- the panel

export type ChangeLobbyPanelProps = {
  mode: LobbyMode;
  /**
   * Only the person on aux may switch. Everyone else still SEES the list —
   * hiding it would leave passengers unable to find out what the lobby can
   * even do — but their rows do not act, and the footnote says why.
   */
  canChange: boolean;
  /**
   * ASKS for the switch. Named `onRequest` rather than `onChange` because
   * nothing in this file changes anything: the owner opens `LobbyModeConfirm`
   * and the mode moves only if the person says yes. A prop called `onChange`
   * that does not change is how the next edit to this file puts the instant
   * toggle back by accident.
   */
  onRequest: (mode: LobbyMode) => void;
};

/**
 * The body of the change-the-lobby panel. Header and close live in whatever
 * sheet hosts it, so this renders only the list and its footnote.
 */
export const ChangeLobbyPanel = memo(function ChangeLobbyPanel({
  mode,
  canChange,
  onRequest,
}: ChangeLobbyPanelProps) {
  const C = useColors();

  return (
    <View>
      {/*
        `radiogroup` rather than a bare View: three mutually exclusive options
        where exactly one is already lit is a radio group by definition, and a
        screen reader announcing "3 items" instead of "1 of 3 selected" is the
        usual way a hand-built row of these gets it wrong.
      */}
      <View accessibilityRole="radiogroup" style={styles.list}>
        {LOBBY_MODES.map((entry) => (
          <ModeRow
            key={entry.id}
            def={entry}
            current={entry.id === mode}
            canChange={canChange}
            onRequest={onRequest}
          />
        ))}
      </View>

      <Text style={[styles.note, { color: C.ink3 }]}>
        Only the person on aux can change the lobby, and the switch asks before it moves anyone.
        Everyone else follows it and keeps their place.
      </Text>
    </View>
  );
});

// -------------------------------------------------------------- the picker

/*
  `LobbyModePicker` and its private `ModeChoice` stood here, and they are
  DELETED rather than left unexported.

  The picker drew the three lobby modes as choices at the top of the dock's
  control panel — a thumb above a CHANGE LOBBY tile that opens
  `ChangeLobbyPanel`, which offers the same three modes with the explanation
  and the confirm. Two controls for one decision, and it was reported as
  exactly that.

  Deleted and not merely unwired, because a component that still compiles
  beside the thing that replaced it is how this codebase has already shipped
  two docks, three lounge rows and two member rows: the wrong one stays on
  screen and nobody can tell which they are looking at.

  `ChangeLobbyPanel` is the survivor, and it is the one carrying the
  two-step confirm that makes a mode change deliberate.
*/
export type LobbyModeConfirmProps = {
  /** The mode being proposed, or null when nothing has been asked for. */
  pending: LobbyMode | null;
  /** Everyone in the Session, the local user included — the roster length. */
  listeners: number;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The question, and the one place the consequence of a switch is written down.
 *
 * It is a component rather than three arguments at each call site because
 * there are two call sites — the dock's SHARE cell and the panel's picker —
 * and copy duplicated across two of those is copy that will disagree with
 * itself the first time either one is edited. The same argument
 * `mayChangeLobby` in 'lobby-sheet.tsx' already makes about the host guard.
 */
export const LobbyModeConfirm = memo(function LobbyModeConfirm({
  pending,
  listeners,
  onConfirm,
  onCancel,
}: LobbyModeConfirmProps) {
  /*
    THE MODE THE DIALOG IS ASKING ABOUT, HELD ACROSS THE CLOSE.

    `pending` goes null the instant the question is answered, and the dialog
    takes a fade to leave after that. Reading the copy straight off
    `pending ?? 'music'` would therefore repaint the panel to "Switch the lobby
    to Music?" for the whole of that fade — a question the user never asked,
    flashing at them as their answer is accepted.

    React's own "adjust state when a prop changes" pattern, not an effect: it
    re-renders before anything is committed, so there is no stale frame at all.
    The same reason 'lobby-sheet.tsx' resets its panel stack this way.
  */
  const [asked, setAsked] = useState<LobbyMode>(pending ?? 'music');
  if (pending !== null && pending !== asked) setAsked(pending);

  const copy = switchCopy(asked, listeners);

  return (
    <ConfirmDialog
      visible={pending !== null}
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirmLabel}
      // Not a bare "Cancel". The cancel branch of a two-step is the one where
      // nothing happens, and naming it is the cheapest way to make that plain
      // to someone who opened this dialog by accident.
      cancelLabel="Keep the lobby as it is"
      // `pri`, never `danger`: switching a lobby is CONTROL, and the accent
      // rule spends pink on destruction only. `ConfirmDialog` bans coral here
      // outright, which is the same rule read from the other side.
      tone="pri"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
});

/**
 * What the switch actually costs, in the room's own terms.
 *
 * TRUE TODAY, not aspirational. Nothing in this build clears the queue, stops
 * the deck or tears down a game table when the mode changes — so this does not
 * claim any of that, because a confirm that invents a consequence is training
 * people to disbelieve the next one. What it DOES claim is the thing the old
 * post-switch toast said too late: movie night and screen share have no shared
 * transport behind them yet, so the tap sets what the lobby IS without putting
 * a picture on anyone's screen. If a real transport lands and a switch starts
 * costing the queue or the table, this function is where that sentence goes,
 * and both call sites get it for free.
 */
function switchCopy(
  next: LobbyMode,
  listeners: number
): { title: string; message: string; confirmLabel: string } {
  const name = lobbyModeName(next);
  /** The roster counts the person doing the switching; they are not "everyone else". */
  const others = Math.max(0, listeners - 1);

  const who =
    others === 0
      ? 'Nobody else is in the Session yet, so this moves only you.'
      : others === 1
        ? 'The other person in the Session comes with you.'
        : `All ${others} other people in the Session come with you.`;

  const cost =
    next === 'music'
      ? 'The shared queue comes back exactly as it is — nothing playing stops, and nobody loses their place.'
      : next === 'movie'
        ? 'The queue is kept and the music keeps playing. There is no shared picture yet, so until the video layer lands this only changes what the lobby is set to.'
        : 'The queue is kept and the music keeps playing. Nobody can see a screen yet, so until the video layer lands this only changes what the lobby is set to.';

  return {
    title: `Switch the lobby to ${name}?`,
    message: `${who} ${cost}`,
    // Sentence case — `AuxButton` does not uppercase it, so "SWITCH TO MUSIC"
    // would ship as a shout.
    confirmLabel: `Switch to ${name}`,
  };
}

// ------------------------------------------------------------------- parts

type ModeRowProps = {
  def: ModeDef;
  current: boolean;
  canChange: boolean;
  onRequest: (mode: LobbyMode) => void;
};

const ModeRow = memo(function ModeRow({ def, current, canChange, onRequest }: ModeRowProps) {
  const C = useColors();
  const Icon = def.icon;

  // Already the mode is not a thing you can pick again, so it is inert for the
  // host too — but it reads as CURRENT rather than as disabled, because it is
  // the answer, not a refusal.
  const inert = current || !canChange;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: current, disabled: inert }}
      accessibilityLabel={`${def.name}. ${def.blurb}${current ? ' Current lobby.' : ''}`}
      accessibilityHint={inert ? undefined : 'Asks you to confirm before the lobby changes'}
      disabled={inert}
      onPress={() => onRequest(def.id)}
      style={({ pressed }) => [
        styles.row,
        // Opaque at rest — see the translucency note in the header. The pressed
        // fill stays translucent on purpose: 9% white reads BRIGHTER than the
        // resolved solid over this sheet's glass, which is what a press wants.
        { backgroundColor: pressed ? C.surface2 : C.surfaceSolid },
        raised(C),
        // Passengers get the list at reduced weight rather than a lock icon:
        // the mode is still information they want, it just is not their call.
        !canChange && !current ? styles.inert : null,
      ]}>
      {/*
        A recessed FILL with a hairline, not an inset shadow pair. At 38px only
        the dark half of the pair survives on a dark ground — the light half is
        ~3% alpha — and the well reads as a smudge instead of a recess. Same
        rule the auth fields and the existing lobby rows follow.
      */}
      <View style={[styles.well, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        <Icon size={18} strokeWidth={2} color={current ? C.pill : C.ink2} />
      </View>

      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
          {def.name}
        </Text>
        <Text style={[styles.blurb, { color: C.ink3 }]}>{def.blurb}</Text>
      </View>

      {current ? <StatusPill label="CURRENT" tone="cream" /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  picker: {
    gap: Space.sm,
  },
  choices: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  /**
   * The three cards stretch to the tallest of them on their own — a flex row
   * defaults to `alignItems:'stretch'`, so a passenger's shorter cards do not
   * need equalising. `minHeight` is here for the other reason: at 84 the card
   * is unmistakably a target rather than a chip, which is the whole difference
   * between this and the segmented control it replaces.
   */
  choice: {
    flex: 1,
    minHeight: 84,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
  },
  /**
   * Sentence case at 12, not a 10px tracked shout. These three are the NAMES
   * of things you can choose between; the tracked caps in this direction are
   * for readouts, and a readout is exactly what this control stopped being.
   */
  choiceName: {
    ...Type.heading(12),
    letterSpacing: tracking(12, -0.01),
    textAlign: 'center',
  },
  choiceState: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.1),
  },
  /**
   * A tracked caption, not a sentence. It sits directly under a dense row of
   * cards inside a dock panel that is already dense — body copy there would
   * read as a paragraph the control had grown, where 9px tracked reads as a
   * label on the thing above it.
   */
  pickerNote: {
    ...Type.label(9),
    letterSpacing: tracking(9, 0.1),
    paddingHorizontal: Space.xs,
  },
  list: {
    gap: Space.sm,
  },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    borderRadius: Radii.lg,
  },
  inert: {
    opacity: 0.55,
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
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    ...Type.heading(14),
    letterSpacing: tracking(14, -0.01),
  },
  blurb: {
    ...Type.body(12),
  },
  note: {
    ...Type.body(12),
    marginTop: Space.lg,
    // The footnote sits under a 44px-tall run of rows; without this it reads as
    // a caption on the last row rather than on the group.
    paddingHorizontal: Space.xs,
    minHeight: TOUCH_TARGET / 2,
  },
});
