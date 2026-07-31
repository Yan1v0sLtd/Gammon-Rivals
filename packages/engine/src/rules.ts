import { BAR, OFF } from './types';
import type { BoardState, Die, Move, Player, Point } from './types';

const opponent = (p: Player): Player => (p === 'white' ? 'black' : 'white');
const direction = (p: Player) => (p === 'white' ? 1 : -1);
const homeRange = (p: Player): readonly [number, number] =>
  p === 'white' ? [18, 23] : [0, 5];

function inHome(p: Player, idx: number): boolean {
  const [lo, hi] = homeRange(p);
  return idx >= lo && idx <= hi;
}

function allInHome(state: BoardState, p: Player): boolean {
  if (state.bar[p] > 0) return false;
  for (let i = 0; i < 24; i++) {
    const pt = state.points[i]!;
    if (pt.owner === p && pt.count > 0 && !inHome(p, i)) return false;
  }
  return true;
}

function canLand(point: Point, p: Player): boolean {
  if (point.count === 0) return true;
  if (point.owner === p) return true;
  return point.count === 1; // opponent blot — can land (will hit)
}

function isHit(point: Point, p: Player): boolean {
  return point.owner !== null && point.owner !== p && point.count === 1;
}

function entryPointFor(p: Player, die: Die): number {
  return p === 'white' ? die - 1 : 24 - die;
}

function bearOffPossible(state: BoardState, from: number, die: Die, p: Player): boolean {
  if (!inHome(p, from)) return false;
  const target = from + direction(p) * die;

  if (p === 'white') {
    if (target === 24) return true;
    if (target > 24) {
      for (let i = 18; i < from; i++) {
        const pt = state.points[i]!;
        if (pt.owner === 'white' && pt.count > 0) return false;
      }
      return true;
    }
    return false;
  }
  if (target === -1) return true;
  if (target < -1) {
    for (let i = from + 1; i <= 5; i++) {
      const pt = state.points[i]!;
      if (pt.owner === 'black' && pt.count > 0) return false;
    }
    return true;
  }
  return false;
}

function singleMovesForDie(state: BoardState, die: Die): Move[] {
  const p = state.turn;
  const dir = direction(p);

  if (state.bar[p] > 0) {
    const entry = entryPointFor(p, die);
    if (entry < 0 || entry > 23) return [];
    const point = state.points[entry]!;
    if (canLand(point, p)) {
      return [{ from: BAR, to: entry, die, hit: isHit(point, p) }];
    }
    return [];
  }

  const moves: Move[] = [];
  const homeOnly = allInHome(state, p);

  for (let from = 0; from < 24; from++) {
    const point = state.points[from]!;
    if (point.owner !== p || point.count === 0) continue;

    const target = from + dir * die;

    if (target >= 0 && target < 24) {
      const tp = state.points[target]!;
      if (canLand(tp, p)) {
        moves.push({ from, to: target, die, hit: isHit(tp, p) });
      }
    } else if (homeOnly && bearOffPossible(state, from, die, p)) {
      moves.push({ from, to: OFF, die, hit: false });
    }
  }

  return moves;
}

function uniqueOrderings(dice: readonly Die[]): Die[][] {
  if (dice.length <= 1) return [[...dice]];
  const set = new Set(dice);
  if (set.size === 1) return [[...dice]];
  if (dice.length === 2) {
    return [
      [dice[0]!, dice[1]!],
      [dice[1]!, dice[0]!],
    ];
  }
  return [[...dice]];
}

function maxSequenceLength(state: BoardState, dice: readonly Die[]): number {
  if (dice.length === 0) return 0;
  let best = 0;
  for (const ord of uniqueOrderings(dice)) {
    const first = ord[0]!;
    const moves = singleMovesForDie(state, first);
    if (moves.length === 0) continue;
    for (const m of moves) {
      const next = applyMove(state, m);
      const len = 1 + maxSequenceLength(next, ord.slice(1));
      if (len > best) best = len;
      if (best === dice.length) return best;
    }
  }
  return best;
}

const moveKey = (m: Move) => `${String(m.from)}->${String(m.to)}@${m.die}`;

export function legalMoves(state: BoardState, remainingDice: readonly Die[]): readonly Move[] {
  if (remainingDice.length === 0) return [];

  const maxLen = maxSequenceLength(state, remainingDice);
  if (maxLen === 0) return [];

  // "Must use larger die" — applies only at the start of a non-doubles turn
  // when only one of the two dice can be played
  if (
    remainingDice.length === 2 &&
    remainingDice[0] !== remainingDice[1] &&
    maxLen === 1
  ) {
    const a = remainingDice[0]!;
    const b = remainingDice[1]!;
    const larger = (a > b ? a : b) as Die;
    const smaller = (a > b ? b : a) as Die;
    const largerMoves = singleMovesForDie(state, larger);
    if (largerMoves.length > 0) return largerMoves;
    return singleMovesForDie(state, smaller);
  }

  const seen = new Set<string>();
  const result: Move[] = [];
  for (const ord of uniqueOrderings(remainingDice)) {
    const first = ord[0]!;
    for (const m of singleMovesForDie(state, first)) {
      const key = moveKey(m);
      if (seen.has(key)) continue;
      const next = applyMove(state, m);
      const cont = maxSequenceLength(next, ord.slice(1));
      if (1 + cont >= maxLen) {
        seen.add(key);
        result.push(m);
      }
    }
  }
  return result;
}

export function applyMove(state: BoardState, move: Move): BoardState {
  const p = state.turn;
  const opp = opponent(p);
  const points: Point[] = state.points.map((pt) => ({ owner: pt.owner, count: pt.count }));
  const bar = { ...state.bar };
  const off = { ...state.off };

  if (move.from === BAR) {
    if (bar[p] === 0) throw new Error(`no ${p} checker on bar`);
    bar[p] -= 1;
  } else if (move.from === OFF) {
    throw new Error('cannot move from off');
  } else {
    const fp = points[move.from]!;
    if (fp.owner !== p || fp.count === 0) {
      throw new Error(`no ${p} checker at point ${move.from}`);
    }
    const newCount = fp.count - 1;
    points[move.from] = { owner: newCount === 0 ? null : p, count: newCount };
  }

  if (move.to === OFF) {
    off[p] += 1;
  } else if (move.to === BAR) {
    throw new Error('cannot move to bar');
  } else {
    const tp = points[move.to]!;
    if (tp.owner === opp) {
      if (tp.count !== 1) throw new Error(`point ${move.to} is blocked by ${opp}`);
      bar[opp] += 1;
      points[move.to] = { owner: p, count: 1 };
    } else {
      points[move.to] = { owner: p, count: tp.count + 1 };
    }
  }

  return { ...state, points, bar, off };
}

export function endTurn(state: BoardState): BoardState {
  return { ...state, turn: opponent(state.turn) };
}

export function winner(state: BoardState): Player | null {
  if (state.off.white === 15) return 'white';
  if (state.off.black === 15) return 'black';
  return null;
}
