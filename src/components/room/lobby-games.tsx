/**
 * Lobby games — the catalogue, the table, and the seat queue that connects
 * them.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L1082-L1143 (`modeGame`, the
 * table) and L1333-L1356 (`sheetGames`, the catalogue), plus README §10
 * "Lobby games", which is the only complete written spec for the join queue.
 *
 * THE GAME WAS A TOAST BEFORE THIS FILE. The Session's lobby sheet carried one
 * row — `Game table`, chipped `Soon` — whose handler read
 * `toast.show('The game table is not built yet')`. The user named the game as
 * a feature they could not find in the shipped build, and they were right:
 * there was nothing to find. This is the feature, and it is two taps from the
 * Session (lobby sheet, then LOBBY GAMES).
 *
 * THERE IS NO BACKEND, AND THE UI SAYS SO. No `games`, `game_seats` or
 * `game_queue` table exists — see 'src/lib/database.types.ts'. Seats therefore
 * live in local state, under exactly the contract mic, deafen and per-person
 * mute already ship under in the Session screen: the control exists and
 * behaves correctly before its transport arrives, because the RELATIONSHIPS
 * are the part worth getting right now. `TABLE_IS_LOCAL` is printed at the
 * bottom of the table so nobody is misled into thinking the room can see it.
 *
 * The table is SEEDED FROM THE REAL ROSTER rather than from invented people,
 * which is README §10's own instruction — "build the seated list from the
 * roster with the local user excluded unless `gameRole === 'player'`" — and it
 * is the reason `seedTable` is the single function a real backend would
 * replace. Everything downstream of it already works off ids.
 *
 * THE ONE RULE THE QUEUE EXISTS TO PROTECT: a game in progress is never
 * interrupted. While `live`, a spectator's only move is to ask; seats open
 * between games and are filled from the top of the approved list, in order.
 * Every guard in `useGameTable` traces back to that sentence.
 *
 * ACCENT, AND A DELIBERATE DEVIATION FROM THE ARTBOARD. The design draws
 * TAKE A SEAT as a coral outline (L1350, L1134) and REQUEST A SEAT as the blue
 * gradient (L1135). Both are actions, so painting one coral breaks the rule
 * the rest of this direction is built on — coral is a state of the world, blue
 * is a thing you do. Both are blue here; the coral is spent instead on the
 * badges that report state (`GAME IN PROGRESS`, the seated count, `TO PLAY`),
 * which is the "blue button, coral badge" split the accent rule specifies for
 * exactly this case. 'ui/aux-button.tsx' agrees: it documents `liveOutline` as
 * the *notice* pill, not an action.
 *
 * THE CARD FILLS ARE ALL `surfaceSolid`, AND THIS FILE USED TO DISAGREE WITH
 * ITSELF ABOUT THAT. The two queue cards were already opaque while the game
 * rows and the seat rows next to them were `surface` — the same panel tree,
 * two different answers. The opaque one is right: both panels are pushed
 * inside the Session's lobby `<Sheet>`, which is a `BlurView`
 * (src/app/room/[id].tsx L1034-L1072), and a 5.5%-white card over a blur has
 * nothing to sit on and dissolves into it. `surfaceSolid` is the resolved
 * composite of the same colour, so it looks identical on a plain ground and
 * the swap only ever costs nothing.
 *
 * `bgRecessed` (the board, the wells) and the dashed empty seat are unaffected
 * — the first is already opaque and the second is meant to have no fill.
 *
 * WHY `.map` AND NOT `FlatList`. The house rule is that feeds, chat and the
 * queue must virtualise. These lists do not qualify and must not: six fixed
 * games, at most eight seats, and a viewers strip bounded by the roster — all
 * inside a sheet that already scrolls. A VirtualizedList nested in a ScrollView
 * loses its own virtualisation and warns about it, so `.map` is the correct
 * call here rather than an exception to the rule.
 */

import {
  Check,
  CircleDot,
  Crown,
  Dice5,
  Disc3,
  Grid3x3,
  Hourglass,
  Layers,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { readout } from '@/components/room/drift';
import { AuxButton, Avatar, StatusPill } from '@/components/ui';
import { Radii, Rule, Space, TOUCH_TARGET, Type, pressed, raised, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type GameId = 'ludo' | 'chess' | 'checkers' | 'carrom' | 'connect4' | 'uno';

/** Chess and checkers get a real chequerboard; everything else a ruled field. */
type BoardKind = 'chequer' | 'grid';

export type GameDef = {
  id: GameId;
  name: string;
  /** Seats at the table. The queue exists because this number is small. */
  seats: number;
  blurb: string;
  board: BoardKind;
  icon: LucideIcon;
};

/** README §10, in its order. Seat counts are the spec's, not a guess. */
export const GAMES: readonly GameDef[] = [
  { id: 'ludo', name: 'Ludo', seats: 4, blurb: 'Four colours, one die.', board: 'grid', icon: Dice5 },
  { id: 'chess', name: 'Chess', seats: 2, blurb: 'Long games. Bring a drink.', board: 'chequer', icon: Crown },
  {
    id: 'checkers',
    name: 'Checkers',
    seats: 2,
    blurb: 'Same board, shorter evening.',
    board: 'chequer',
    icon: CircleDot,
  },
  { id: 'carrom', name: 'Carrom', seats: 4, blurb: 'Flick, pocket, repeat.', board: 'grid', icon: Disc3 },
  {
    id: 'connect4',
    name: 'Connect Four',
    seats: 2,
    blurb: 'Four in a row, seven columns.',
    board: 'grid',
    icon: Grid3x3,
  },
  { id: 'uno', name: 'Uno', seats: 8, blurb: 'Eight seats and no friendships.', board: 'grid', icon: Layers },
];

const gameById = (id: GameId): GameDef => GAMES.find((g) => g.id === id) ?? GAMES[0];

/** Anyone this component needs to draw. Structurally what `useRoomParticipants` returns. */
export type GamePerson = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

/** Where the local user sits, which is the only role that changes any control. */
export type TableRole = 'player' | 'viewer';

export type TableState = {
  gameId: GameId;
  /** A game is running. The queue's entire reason to exist. */
  live: boolean;
  /** Seat holders, in turn order. */
  seated: readonly string[];
  viewers: readonly string[];
  /** Asked for a seat; the host has not ruled yet. */
  pending: readonly string[];
  /** Approved and waiting. The ORDER is the promise made to them. */
  queue: readonly string[];
  /** Index into `seated`. */
  turn: number;
};

// --------------------------------------------------------------- the machine

/**
 * Seed a table from the people actually in the Session.
 *
 * THE ONE FUNCTION A REAL BACKEND REPLACES. Everything else in this file works
 * off the id lists this produces, so swapping it for a subscription changes no
 * component and no guard.
 *
 * README §10: the local user is excluded from the seated list unless they hold
 * a seat. Taking a seat therefore puts them at the FRONT of the turn order
 * (they opened the table), and watching leaves the seats to everyone else.
 */
function seedTable(def: GameDef, people: readonly GamePerson[], meId: string, as: TableRole): TableState {
  const others = people.filter((person) => person.userId !== meId).map((person) => person.userId);

  const seated = as === 'player' ? [meId, ...others.slice(0, def.seats - 1)] : others.slice(0, def.seats);
  const viewers =
    as === 'player' ? others.slice(def.seats - 1) : [meId, ...others.slice(def.seats)];

  return {
    gameId: def.id,
    // Sitting down opens a table BETWEEN games so the first thing you can do is
    // start one. Walking up to watch means there is already something to watch,
    // provided anyone is actually sitting at it.
    live: as === 'viewer' && seated.length >= 2,
    seated,
    viewers,
    pending: [],
    queue: [],
    turn: 0,
  };
}

export type GameTableController = ReturnType<typeof useGameTable>;

/**
 * The seat/queue state machine.
 *
 * Held here rather than in the Session screen because none of it is Session
 * state — no query, subscription or mutation touches it — and because keeping
 * it local means the screen wiring this up gains one component and no state.
 */
export function useGameTable(options: {
  people: readonly GamePerson[];
  currentUserId: string | null;
  /** The Session host rules on seat requests, per README §10. */
  isHost: boolean;
  /** Toasts. Every branch that changes someone's standing says so out loud. */
  onNotice: (message: string) => void;
}) {
  const { people, currentUserId, isHost, onNotice } = options;
  const [table, setTable] = useState<TableState | null>(null);

  const nameOf = useCallback(
    (id: string) => people.find((person) => person.userId === id)?.displayName ?? 'Someone',
    [people]
  );

  const open = useCallback(
    (gameId: GameId, as: TableRole) => {
      if (!currentUserId) {
        onNotice('Sign in to take a seat.');
        return;
      }
      const def = gameById(gameId);
      setTable(seedTable(def, people, currentUserId, as));
      onNotice(as === 'player' ? `You are seated at ${def.name}` : `Watching ${def.name}`);
    },
    [currentUserId, onNotice, people]
  );

  const leave = useCallback(() => setTable(null), []);

  /*
    EVERY ACTION BELOW READS `table` FROM THE CLOSURE RATHER THAN FROM A
    `setTable(current => …)` UPDATER, AND THAT IS DELIBERATE.

    An updater does not run synchronously — React schedules it — so a handler
    that decides inside the updater and then announces the result afterwards
    announces the state BEFORE its own change. The first draft of `endGame`
    collected the promoted names inside the updater and always reported an
    empty list; `startNext` always claimed success. Deciding out here means the
    guard, the write and the notice all see one consistent snapshot.

    These are press handlers, so `table` is current by definition — nothing
    else writes it.
  */

  /** Between games only — a running game is never interrupted for a latecomer. */
  const takeSeat = useCallback(() => {
    if (!currentUserId || !table) return;
    const def = gameById(table.gameId);
    if (table.live || table.seated.length >= def.seats || table.seated.includes(currentUserId)) {
      return;
    }

    setTable({
      ...table,
      seated: [...table.seated, currentUserId],
      viewers: table.viewers.filter((id) => id !== currentUserId),
      queue: table.queue.filter((id) => id !== currentUserId),
    });
    onNotice('You have the free seat');
  }, [currentUserId, onNotice, table]);

  /**
   * Ask for a seat in the next game.
   *
   * A host asking is approved on the spot: "awaiting host" is not a state the
   * host can meaningfully be in, and making someone accept their own request
   * would be a decision with no decider.
   */
  const requestSeat = useCallback(() => {
    if (!currentUserId || !table) return;
    if (table.pending.includes(currentUserId) || table.queue.includes(currentUserId)) return;

    setTable(
      isHost
        ? { ...table, queue: [...table.queue, currentUserId] }
        : { ...table, pending: [...table.pending, currentUserId] }
    );
    onNotice(
      isHost
        ? `You are #${table.queue.length + 1} in line for the next game`
        : 'Seat requested — the host decides'
    );
  }, [currentUserId, isHost, onNotice, table]);

  const withdrawRequest = useCallback(() => {
    if (!currentUserId || !table) return;
    if (!table.pending.includes(currentUserId) && !table.queue.includes(currentUserId)) return;

    setTable({
      ...table,
      pending: table.pending.filter((id) => id !== currentUserId),
      queue: table.queue.filter((id) => id !== currentUserId),
    });
    onNotice('Request withdrawn');
  }, [currentUserId, onNotice, table]);

  /** Accepting QUEUES someone. It does not seat them — README §10 is explicit. */
  const accept = useCallback(
    (userId: string) => {
      if (!table) return;
      setTable({
        ...table,
        pending: table.pending.filter((id) => id !== userId),
        queue: [...table.queue, userId],
      });
      onNotice(`${nameOf(userId)} is #${table.queue.length + 1} in line`);
    },
    [nameOf, onNotice, table]
  );

  const decline = useCallback(
    (userId: string) => {
      if (!table) return;
      setTable({ ...table, pending: table.pending.filter((id) => id !== userId) });
      onNotice(`${nameOf(userId)} stays in the viewers`);
    },
    [nameOf, onNotice, table]
  );

  /**
   * End the game and seat the queue.
   *
   * Only genuinely FREE seats fill — ending a game does not evict the people
   * sitting at it. That is why the notice reports who got in rather than
   * assuming anyone did: with a full table the honest answer is nobody.
   */
  const endGame = useCallback(() => {
    if (!table) return;
    const def = gameById(table.gameId);
    const free = Math.max(0, def.seats - table.seated.length);
    const promoted = table.queue.slice(0, free);

    setTable({
      ...table,
      live: false,
      seated: [...table.seated, ...promoted],
      viewers: table.viewers.filter((id) => !promoted.includes(id)),
      queue: table.queue.slice(promoted.length),
      turn: 0,
    });

    onNotice(
      promoted.length > 0
        ? `Game over — ${promoted.map(nameOf).join(', ')} got in`
        : 'Game over — no seats opened up'
    );
  }, [nameOf, onNotice, table]);

  const startNext = useCallback(() => {
    if (!table) return;
    // Two people or it is not a game. Starting alone would strand the queue
    // behind a table that can never end.
    if (table.seated.length < 2) {
      onNotice('A game needs two people at the table');
      return;
    }
    setTable({ ...table, live: true, turn: 0 });
    onNotice('Game on');
  }, [onNotice, table]);

  return { table, open, leave, takeSeat, requestSeat, withdrawRequest, accept, decline, endGame, startNext };
}

// -------------------------------------------------------------- catalogue

export type LobbyGamesPanelProps = {
  /**
   * The open table, if there is one. The row for THAT game reports its real
   * counts and offers the way back to it — which is the only reason the
   * catalogue stays reachable once you are seated.
   */
  table: TableState | null;
  onOpen: (gameId: GameId, as: TableRole) => void;
  /** Back to the open table without disturbing it. */
  onReturn: () => void;
};

/** The list of games. `TAKE A SEAT` reads `FULL` once the seats are gone. */
export const LobbyGamesPanel = memo(function LobbyGamesPanel({
  table,
  onOpen,
  onReturn,
}: LobbyGamesPanelProps) {
  return (
    <View style={styles.catalogue}>
      {GAMES.map((def) => (
        <GameRow
          key={def.id}
          def={def}
          table={table && table.gameId === def.id ? table : null}
          onOpen={onOpen}
          onReturn={onReturn}
        />
      ))}
    </View>
  );
});

const GameRow = memo(function GameRow({
  def,
  table,
  onOpen,
  onReturn,
}: {
  def: GameDef;
  table: TableState | null;
  onOpen: (gameId: GameId, as: TableRole) => void;
  onReturn: () => void;
}) {
  const C = useColors();
  const Icon = def.icon;

  const seatedCount = table?.seated.length ?? 0;
  const watching = table?.viewers.length ?? 0;
  const full = seatedCount >= def.seats;

  const handleSeat = useCallback(() => onOpen(def.id, full ? 'viewer' : 'player'), [def.id, full, onOpen]);
  const handleWatch = useCallback(() => onOpen(def.id, 'viewer'), [def.id, onOpen]);

  return (
    <View style={[styles.gameRow, { backgroundColor: C.surfaceSolid }, raised(C)]}>
      <View style={styles.gameHead}>
        <View style={[styles.well, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
          <Icon size={18} strokeWidth={2} color={table ? C.liveText : C.ink2} />
        </View>

        <View style={styles.gameMeta}>
          <Text numberOfLines={1} style={[styles.gameName, { color: C.ink }]}>
            {def.name}
          </Text>
          <Text numberOfLines={1} style={[styles.gameBlurb, { color: C.ink3 }]}>
            {def.blurb}
          </Text>

          <View style={styles.counts}>
            {/*
              The seated count is the one number that says whether anything is
              happening, so it takes the coral. `N WATCHING` is a neutral
              readout beside it — two coral badges in one row and neither wins.
            */}
            <Text style={[readout(10), { color: seatedCount > 0 ? C.liveText : C.ink3 }]}>
              {seatedCount}/{def.seats} SEATED
            </Text>
            <Text style={[readout(10), { color: C.ink3 }]}>
              {watching === 0 ? 'NOBODY WATCHING' : `${watching} WATCHING`}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.gameActions}>
        {table ? (
          // This is the table you are already at. Offering TAKE A SEAT here
          // would re-seed it and silently throw away the queue standing on it.
          <AuxButton label="Return to table" onPress={onReturn} variant="pri" size="sm" fullWidth />
        ) : (
          <>
            {/*
              `FULL` still acts: the design says it "drops you to watching when
              taken", which is more useful than a dead button, so the label
              changes and the destination changes with it.
            */}
            <AuxButton
              label={full ? 'Full — watch' : 'Take a seat'}
              onPress={handleSeat}
              variant={full ? 'bordered' : 'pri'}
              size="sm"
              fullWidth
            />
            <AuxButton label="Watch" onPress={handleWatch} variant="bordered" size="sm" fullWidth />
          </>
        )}
      </View>
    </View>
  );
});

// ------------------------------------------------------------------ table

export type GameTablePanelProps = {
  table: TableState;
  people: readonly GamePerson[];
  currentUserId: string | null;
  isHost: boolean;
  controller: GameTableController;
  /** Back to the catalogue with this table left standing. */
  onBrowse: () => void;
};

/** The table itself: board, whose turn, who is sitting, who is waiting. */
export const GameTablePanel = memo(function GameTablePanel({
  table,
  people,
  currentUserId,
  isHost,
  controller,
  onBrowse,
}: GameTablePanelProps) {
  const C = useColors();
  const def = gameById(table.gameId);

  const personOf = useCallback(
    (id: string): GamePerson =>
      people.find((person) => person.userId === id) ?? {
        userId: id,
        displayName: 'Someone',
        avatarUrl: null,
      },
    [people]
  );

  const seated = useMemo(() => table.seated.map(personOf), [personOf, table.seated]);
  const viewers = useMemo(() => table.viewers.map(personOf), [personOf, table.viewers]);
  const queue = useMemo(() => table.queue.map(personOf), [personOf, table.queue]);
  const pending = useMemo(() => table.pending.map(personOf), [personOf, table.pending]);

  const iAmSeated = currentUserId != null && table.seated.includes(currentUserId);
  const freeSeats = Math.max(0, def.seats - table.seated.length);
  const myPlace = currentUserId ? table.queue.indexOf(currentUserId) : -1;
  const iAmPending = currentUserId != null && table.pending.includes(currentUserId);

  const turnName = table.live && seated.length > 0 ? seated[table.turn % seated.length].displayName : null;

  return (
    <View style={styles.table}>
      {/* ---- board and the state of play ---- */}
      <View style={[styles.board, { backgroundColor: C.bgRecessed, borderColor: C.rule }, pressed(C)]}>
        <Board kind={def.board} />
      </View>

      <View style={styles.playHead}>
        <View style={styles.playMeta}>
          <Text numberOfLines={1} style={[styles.gameTitle, { color: C.ink }]}>
            {def.name}
          </Text>
          <Text style={[readout(10), { color: C.ink3 }]}>
            {table.seated.length}/{def.seats} SEATED · {table.viewers.length} WATCHING
          </Text>
        </View>

        <StatusPill
          label={table.live ? 'GAME IN PROGRESS' : 'BETWEEN GAMES'}
          tone={table.live ? 'accent' : 'outline'}
          dot={table.live}
          live={table.live}
        />
      </View>

      <Text style={[styles.turn, { color: table.live ? C.ink : C.ink3 }]}>
        {turnName ? `${turnName} to play` : 'Waiting for the next game to start'}
      </Text>

      {/* ---- who is at the table ---- */}
      <Text style={[styles.kicker, { color: C.ink3 }]}>At the table</Text>
      <View style={styles.seats}>
        {seated.map((person, index) => (
          <SeatRow
            key={person.userId}
            person={person}
            you={person.userId === currentUserId}
            toPlay={table.live && index === table.turn % Math.max(1, seated.length)}
            seatNumber={index + 1}
          />
        ))}

        {/*
          Free seats are DRAWN, not implied by absence. "2/4 seated" tells you
          how many are missing; an empty chair tells you one is yours.
        */}
        {Array.from({ length: freeSeats }, (_, index) => (
          <EmptySeat key={`free-${index}`} number={table.seated.length + index + 1} />
        ))}
      </View>

      {/* ---- viewers ---- */}
      {viewers.length > 0 ? (
        <>
          <Text style={[styles.kicker, { color: C.ink3 }]}>
            {viewers.length} watching
          </Text>
          <View style={styles.viewers}>
            {viewers.slice(0, 8).map((person) => (
              <Avatar key={person.userId} name={person.displayName} uri={person.avatarUrl} size={30} />
            ))}
            {viewers.length > 8 ? (
              <Text style={[readout(11), { color: C.ink3 }]}>+{viewers.length - 8}</Text>
            ) : null}
          </View>
        </>
      ) : null}

      {/* ---- the approved queue ---- */}
      {queue.length > 0 ? (
        <View style={[styles.queueCard, { backgroundColor: C.surfaceSolid, borderColor: C.rule }]}>
          <View style={styles.queueHead}>
            <Text style={[styles.kicker, { color: C.ink3 }]}>
              Next up · {queue.length} in line
            </Text>
            <Text style={[readout(10), { color: freeSeats > 0 ? C.liveText : C.ink3 }]}>
              {freeSeats} FREE
            </Text>
          </View>

          {queue.map((person, index) => (
            <View key={person.userId} style={styles.queueRow}>
              <Text style={[readout(11), { color: C.ink3, width: 20 }]}>{index + 1}</Text>
              <Avatar name={person.displayName} uri={person.avatarUrl} size={26} />
              <Text numberOfLines={1} style={[styles.queueName, { color: C.ink }]}>
                {person.displayName}
                {person.userId === currentUserId ? ' (you)' : ''}
              </Text>
            </View>
          ))}

          <Text style={[styles.fine, { color: C.ink3 }]}>
            Seats fill from the top of this list the moment the current game ends.
          </Text>
        </View>
      ) : null}

      {/* ---- host: rule on requests ---- */}
      {isHost && pending.length > 0 ? (
        <View style={[styles.queueCard, { backgroundColor: C.surfaceSolid, borderColor: C.rule }]}>
          <Text style={[styles.kicker, { color: C.liveText }]}>
            {pending.length} waiting on you
          </Text>

          {pending.map((person) => (
            <View key={person.userId} style={styles.pendingRow}>
              <Avatar name={person.displayName} uri={person.avatarUrl} size={30} />
              <View style={styles.pendingMeta}>
                <Text numberOfLines={1} style={[styles.queueName, { color: C.ink }]}>
                  {person.displayName}
                </Text>
                <Text style={[readout(9), { color: C.ink3 }]}>WANTS THE NEXT SEAT</Text>
              </View>

              <AuxButton
                label="Accept"
                onPress={() => controller.accept(person.userId)}
                variant="pri"
                size="sm"
                icon={Check}
              />
              <IconAction
                icon={X}
                label={`Decline ${person.displayName}`}
                onPress={() => controller.decline(person.userId)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* ---- what this person can actually do ---- */}
      <View style={styles.tableActions}>
        {!iAmSeated && !table.live && freeSeats > 0 ? (
          <AuxButton label="Take the free seat" onPress={controller.takeSeat} variant="pri" fullWidth />
        ) : null}

        {!iAmSeated && myPlace < 0 && !iAmPending && (table.live || freeSeats === 0) ? (
          <AuxButton
            label="Request a seat · next game"
            onPress={controller.requestSeat}
            variant="pri"
            fullWidth
          />
        ) : null}

        {iAmPending ? (
          <AuxButton
            label="Request sent · awaiting host — withdraw"
            onPress={controller.withdrawRequest}
            variant="bordered"
            size="sm"
            icon={Hourglass}
            fullWidth
          />
        ) : null}

        {myPlace >= 0 ? (
          <AuxButton
            label={`You are #${myPlace + 1} in line — withdraw`}
            onPress={controller.withdrawRequest}
            variant="bordered"
            size="sm"
            fullWidth
          />
        ) : null}

        {isHost && table.live ? (
          <AuxButton
            label="End game · seat the queue"
            onPress={controller.endGame}
            variant="bordered"
            fullWidth
          />
        ) : null}

        {isHost && !table.live ? (
          <AuxButton
            label="Start the next game"
            onPress={controller.startNext}
            variant="bordered"
            fullWidth
          />
        ) : null}

        <AuxButton
          label="Browse other games"
          onPress={onBrowse}
          variant="ghost"
          size="sm"
          fullWidth
        />

        <AuxButton
          label="Leave table · back to music"
          onPress={controller.leave}
          variant="ghost"
          size="sm"
          fullWidth
        />
      </View>

      <Text style={[styles.fine, { color: C.ink3 }]}>
        A game in progress is never interrupted — spectators can only request a seat, and the host
        decides. Free seats open up between games. The music keeps playing throughout.
      </Text>
      <Text style={[styles.fine, { color: C.ink3 }]}>
        Seats are local to your device until the games backend lands. Nobody else sees this table
        yet.
      </Text>
    </View>
  );
});

// ------------------------------------------------------------------- parts

/**
 * The board.
 *
 * Drawn in Views rather than shipped as an image so it inherits the palette
 * and survives a theme flip — the light palette's "dark" square has to stay
 * darker than its light one, which a baked PNG cannot do.
 */
const Board = memo(function Board({ kind }: { kind: BoardKind }) {
  const C = useColors();
  const side = kind === 'chequer' ? 8 : 6;

  const rows = useMemo(() => Array.from({ length: side }, (_, r) => r), [side]);
  const cols = useMemo(() => Array.from({ length: side }, (_, c) => c), [side]);

  return (
    <View style={styles.boardInner}>
      {rows.map((r) => (
        <View key={r} style={styles.boardRow}>
          {cols.map((c) => (
            <View
              key={c}
              style={[
                styles.boardCell,
                kind === 'chequer'
                  ? // A solid ground under a translucent square: the container is
                    // `bgRecessed` (opaque), so `surface2` over it composites to a
                    // defined value instead of stacking two translucent whites.
                    { backgroundColor: (r + c) % 2 === 0 ? C.surface2 : 'transparent' }
                  : { borderColor: C.grid, borderRightWidth: Rule.hair, borderBottomWidth: Rule.hair },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
});

const SeatRow = memo(function SeatRow({
  person,
  you,
  toPlay,
  seatNumber,
}: {
  person: GamePerson;
  you: boolean;
  toPlay: boolean;
  seatNumber: number;
}) {
  const C = useColors();

  return (
    <View
      style={[styles.seat, { backgroundColor: C.surfaceSolid, borderColor: toPlay ? C.liveMid : C.rule }]}>
      {/* The accent ring is the seat's only state, so `live` carries it. */}
      <Avatar name={person.displayName} uri={person.avatarUrl} size={34} live={toPlay} />

      <View style={styles.seatMeta}>
        <Text numberOfLines={1} style={[styles.seatName, { color: C.ink }]}>
          {person.displayName}
          {you ? ' (you)' : ''}
        </Text>
        <Text style={[readout(9), { color: C.ink3 }]}>SEAT {seatNumber}</Text>
      </View>

      {toPlay ? <StatusPill label="TO PLAY" tone="liveWash" /> : null}
    </View>
  );
});

const EmptySeat = memo(function EmptySeat({ number }: { number: number }) {
  const C = useColors();

  return (
    <View style={[styles.seat, styles.seatEmpty, { borderColor: C.rule2 }]}>
      <View style={[styles.emptyRing, { borderColor: C.rule2 }]} />
      <Text style={[readout(10), { color: C.ink3 }]}>SEAT {number} · FREE</Text>
    </View>
  );
});

/** The bare decline affordance — an icon that still meets the touch target. */
const IconAction = memo(function IconAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed: isPressed }) => [
        styles.iconAction,
        { backgroundColor: isPressed ? C.surface2 : 'transparent', borderColor: C.rule },
      ]}>
      <Icon size={16} strokeWidth={2} color={C.ink3} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // ------------------------------------------------------------- catalogue
  catalogue: {
    gap: Space.sm,
  },
  gameRow: {
    padding: Space.md,
    borderRadius: Radii.lg,
    gap: Space.md,
  },
  gameHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
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
  gameMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  gameName: {
    ...Type.heading(14),
    letterSpacing: tracking(14, -0.01),
  },
  gameBlurb: {
    ...Type.body(12),
  },
  counts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  gameActions: {
    flexDirection: 'row',
    gap: Space.sm,
  },

  // ----------------------------------------------------------------- table
  table: {
    gap: Space.md,
  },
  board: {
    // Square, and it must stay square — a stretched chequerboard reads as a
    // rendering fault rather than as a board.
    aspectRatio: 1,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    overflow: 'hidden',
    padding: Space.sm,
  },
  boardInner: {
    flex: 1,
  },
  boardRow: {
    flex: 1,
    flexDirection: 'row',
  },
  boardCell: {
    flex: 1,
  },
  playHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  playMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  gameTitle: {
    ...Type.display(20),
  },
  turn: {
    ...Type.body(13),
  },
  kicker: {
    ...Type.label(10),
  },
  seats: {
    gap: Space.sm,
  },
  seat: {
    minHeight: TOUCH_TARGET + 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radii.md,
    borderWidth: Rule.hair,
  },
  seatEmpty: {
    // Dashed, because an empty chair is an invitation and a solid edge would
    // read as another occupied row at a glance.
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  emptyRing: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    borderStyle: 'dashed',
  },
  seatMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  seatName: {
    ...Type.heading(13),
    letterSpacing: tracking(13, -0.01),
  },
  viewers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    flexWrap: 'wrap',
  },
  queueCard: {
    padding: Space.md,
    borderRadius: Radii.lg,
    borderWidth: Rule.hair,
    gap: Space.sm,
  },
  queueHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 34,
  },
  queueName: {
    ...Type.body(13),
    flex: 1,
    minWidth: 0,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: TOUCH_TARGET,
  },
  pendingMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  iconAction: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableActions: {
    gap: Space.sm,
    marginTop: Space.xs,
  },
  fine: {
    ...Type.body(11),
  },
});
