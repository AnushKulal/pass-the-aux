/**
 * Change the lobby — the three things a Session can be, and the control that
 * moves everyone between them.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L1308-L1331 (`sheetUpgrade`)
 * and README §9 "Change the lobby".
 *
 * THIS FEATURE HAD NO IMPLEMENTATION BEFORE THIS FILE. The Session's lobby
 * sheet offered "Movie night" and "Screen share" as two dead rows chipped
 * `Soon`, and there was nothing anywhere that said which mode the lobby was
 * in or moved it to another one. The user named "change lobby" as a feature
 * they could not find in the shipped build — this is it, and it is two taps
 * from the Session (lobby sheet, then this panel).
 *
 * THERE IS NO BACKEND FOR IT. `rooms` has no `mode` column — see the Row type
 * in 'src/lib/database.types.ts' — so the mode is local state, exactly as mic,
 * deafen and per-person mute already are in the Session screen. That is a
 * deliberate copy of the precedent set there: the controls have to exist and
 * behave correctly before the transport arrives, and the RELATIONSHIPS are the
 * part worth getting right now — who may switch, what the switch promises,
 * and who follows. When a real `rooms.mode` lands, the only change here is
 * where `mode` comes from and where `onChange` writes to; the component is
 * already controlled from outside for exactly that reason.
 *
 * ACCENT: THE CURRENT MODE IS BLUE, AND THIS FILE USED TO ARGUE THE OPPOSITE.
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
 * changes because somebody standing in it tapped a row.
 *
 * `cream` is the badge tone for that, because `cream` and `pill` resolve to
 * the same blue — it is `accent` with the action hue instead of the state hue.
 *
 * The rows still carry no accent of their own: the row IS the control, so
 * painting it as well would put two accents on one element.
 *
 * TRANSLUCENCY: the fills here are `surfaceSolid`. This panel is pushed inside
 * the Session's lobby `<Sheet>`, which is a `BlurView` — a 5.5%-white row laid
 * over a blur has nothing to sit on and loses its edge entirely. On a plain
 * ground `surfaceSolid` is the resolved composite of the same colour, so this
 * costs nothing anywhere else.
 *
 * TWO CONTROLS NOW, AND THE SECOND ONE IS WHY THE USER WAS STILL ANGRY.
 *
 * `ChangeLobbyPanel` above is the FULL answer: three rows, each with the
 * promise its mode makes and a footnote about who may switch. Reaching it cost
 * a tap on a bar, a tap on a tile, and a read — and the user's complaint was
 * never that the panel was wrong, it was "why is it so hard", which is a
 * complaint about DISTANCE, not about content.
 *
 * `LobbyModeSwitch` is the same three modes as a segmented control, sized to
 * sit at the top of the session dock's expanded panel. One swipe on the dock
 * and the mode switch is already on screen, lit, with the current mode
 * showing. The full panel stays exactly where it is for the person who wants
 * to know what "Movie night" actually promises before they drag six listeners
 * into it.
 *
 * IT IS `SheetTabs`, NOT A HAND-BUILT ROW. This is the app's fourth selection
 * control and the argument in the header above — three selection controls in
 * two accents is drift — applies twice as hard to a fifth implementation of
 * the same pill. `SheetTabs` already paints the selected segment in the blue
 * gradient, already announces `tablist`/`tab` with a selected state, and
 * already cross-fades rather than snapping. Reusing it is the whole reason the
 * accent argument above stays true without being re-litigated here.
 *
 * A PASSENGER'S TAP IS NOT SWALLOWED SILENTLY. `SheetTabs` has no disabled
 * state and is not getting one for this: the tap runs `onChange`, the owner's
 * guard refuses it, and a toast says why. The segment does not move, which is
 * the honest readout — nothing changed. A greyed-out control would have said
 * the same thing with less information and one more prop.
 */

import { Film, MonitorUp, Music4, type LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SheetTabs, StatusPill, type SheetTab } from '@/components/ui';
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

/** For the drawer's subtitle line, which reads `MUSIC · 6 LISTENING`. */
export function lobbyModeLabel(mode: LobbyMode): string {
  return (LOBBY_MODES.find((entry) => entry.id === mode) ?? LOBBY_MODES[0]).name.toUpperCase();
}

export type ChangeLobbyPanelProps = {
  mode: LobbyMode;
  /**
   * Only the person on aux may switch. Everyone else still SEES the list —
   * hiding it would leave passengers unable to find out what the lobby can
   * even do — but their rows do not act, and the footnote says why.
   */
  canChange: boolean;
  onChange: (mode: LobbyMode) => void;
};

/**
 * The body of the change-the-lobby panel. Header and close live in whatever
 * sheet hosts it, so this renders only the list and its footnote.
 */
export const ChangeLobbyPanel = memo(function ChangeLobbyPanel({
  mode,
  canChange,
  onChange,
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
            onChange={onChange}
          />
        ))}
      </View>

      <Text style={[styles.note, { color: C.ink3 }]}>
        Only the person on aux can change the lobby. Everyone else follows the switch and keeps
        their place.
      </Text>
    </View>
  );
});

// ------------------------------------------------------------ mode switch

export type LobbyModeSwitchProps = {
  mode: LobbyMode;
  /** Only the person on aux may switch. See the header for why it is not disabled. */
  canChange: boolean;
  onChange: (mode: LobbyMode) => void;
};

/**
 * The three modes as one segmented control, for the top of the session dock.
 *
 * The caption underneath changes with WHO IS READING IT rather than with the
 * mode, because the two sentences answer the two different questions a person
 * has in front of this control. A host is about to move six people and wants
 * to know what that costs them — nothing, the queue is kept. A passenger is
 * about to tap a control that will not move and deserves to know that before
 * they tap it rather than in a toast afterwards.
 */
export const LobbyModeSwitch = memo(function LobbyModeSwitch({
  mode,
  canChange,
  onChange,
}: LobbyModeSwitchProps) {
  const C = useColors();

  // `SheetTabs` takes a mutable array, and rebuilding it every render would
  // re-render all three segments on every drift tick of the screen above.
  const tabs = useMemo<SheetTab[]>(
    () => LOBBY_MODES.map((entry) => ({ key: entry.id, label: entry.name })),
    []
  );

  const handleChange = useCallback((key: string) => onChange(key as LobbyMode), [onChange]);

  return (
    <View style={styles.switch}>
      <SheetTabs tabs={tabs} active={mode} onChange={handleChange} variant="segmented" />
      <Text numberOfLines={1} style={[styles.switchNote, { color: C.ink3 }]}>
        {canChange
          ? 'EVERYONE COMES WITH YOU · THE QUEUE IS KEPT'
          : 'ONLY THE PERSON ON AUX CAN CHANGE THE LOBBY'}
      </Text>
    </View>
  );
});

type ModeRowProps = {
  def: ModeDef;
  current: boolean;
  canChange: boolean;
  onChange: (mode: LobbyMode) => void;
};

const ModeRow = memo(function ModeRow({ def, current, canChange, onChange }: ModeRowProps) {
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
      disabled={inert}
      onPress={() => onChange(def.id)}
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
  switch: {
    gap: Space.sm,
  },
  /**
   * A tracked caption, not a sentence. It sits directly under a 54px control
   * inside a dock panel that is already dense — body copy there would read as
   * a paragraph the control had grown, where 9px tracked reads as a label on
   * the thing above it.
   */
  switchNote: {
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
