import type { GameWithMoves, MoveRow } from '../../lib/queries';

export const REPLAY_GAME_ID = 'game-1';

/** A legal persisted white sub-move from the engine's opening position. */
export const WHITE_ONE_SUB_MOVE = { from: 0, to: 1, die: 1, hit: false } as const;

/** A legal black sub-move from the position after WHITE_ONE_SUB_MOVE + endTurn. */
export const BLACK_TWO_SUB_MOVE = { from: 23, to: 22, die: 1, hit: false } as const;

export function makeMoveRow(overrides: Partial<MoveRow> = {}): MoveRow {
  return {
    id: 1,
    game_id: REPLAY_GAME_ID,
    ply: 1,
    player: 'white',
    dice: [1, 3],
    sub_moves: [WHITE_ONE_SUB_MOVE],
    elapsed_ms: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeGame(overrides: Partial<GameWithMoves> = {}): GameWithMoves {
  return {
    match: {
      id: 'match-1',
      owner_id: 'owner-1',
      opponent_id: null,
      owner_color: 'white',
      invite_code: null,
      invite_expires_at: null,
      current_turn: null,
      current_game_id: null,
      cube_value: 1,
      cube_owner: null,
      cube_offer: null,
      is_public: false,
      mode: 'hotseat',
      is_bot: false,
      bot_level: null,
      target: 1,
      white_score: 0,
      black_score: 0,
      winner: null,
      crawford_game_number: null,
      table_config_id: null,
      started_at: '2026-01-01T00:00:00.000Z',
      finished_at: null,
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    game: {
      id: REPLAY_GAME_ID,
      match_id: 'match-1',
      game_number: 1,
      winner: null,
      win_type: null,
      cube_value: 1,
      cube_owner: null,
      dropped_double: false,
      points_awarded: 0,
      was_crawford: false,
      started_at: '2026-01-01T00:00:00.000Z',
      finished_at: null,
    },
    moves: [makeMoveRow()],
    ...overrides,
  };
}

/** A two-ply replay: white 0→1, then black 23→22. */
export function makeTwoMoveGame(): GameWithMoves {
  return {
    ...makeGame(),
    moves: [
      makeMoveRow(),
      makeMoveRow({
        id: 2,
        ply: 2,
        player: 'black',
        dice: [1, 5],
        sub_moves: [BLACK_TWO_SUB_MOVE],
      }),
    ],
  };
}
