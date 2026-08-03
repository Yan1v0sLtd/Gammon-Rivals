import { extractErrorMessage } from '../../../../../packages/shared/src/errors';

export function boardPurchaseErrorMessage(code: string, unlockLevel: number): string {
  switch (code) {
    case 'insufficient_gems':
      return 'Not enough gems.';
    case 'level_too_low':
      return `Reach level ${unlockLevel} to unlock.`;
    case 'already_owned':
      return 'You already own this board.';
    case 'board_not_purchasable':
      return 'This board is not available for purchase.';
    case 'board_disabled':
    case 'board_not_found':
      return 'Board unavailable.';
    case 'not_authenticated':
      return 'Sign in to purchase boards.';
    default:
      return code;
  }
}

export function dailyBonusErrorMessage(code: string): string {
  switch (code) {
    case 'already_claimed':
      return "You've already claimed today's bonus.";
    case 'not_authenticated':
      return 'Sign in to claim daily bonuses.';
    default:
      // config_missing_for_day_N and anything else: surface the raw code.
      return code;
  }
}

export function matchmakingErrorMessage(err: unknown): string {
  // extractErrorMessage also unwraps the plain-object PostgrestError shape
  // RPCs reject with, which String(err) rendered as "[object Object]".
  const msg = extractErrorMessage(err);
  if (msg.includes('insufficient_coins')) return 'Not enough coins for this room.';
  if (msg.includes('level_too_low')) {
    return 'This room is locked at your current level.';
  }
  if (msg.includes('room_disabled')) return 'This room is temporarily unavailable.';
  if (msg.includes('pvp_not_allowed_in_tier')) {
    return 'PvP isn’t enabled in this room.';
  }
  if (msg.includes('ai_not_allowed')) return 'AI play is disabled in this room.';
  if (msg.includes('room_not_found')) return 'Room not found — try refreshing.';
  if (msg.includes('not_authenticated')) return 'Sign in to enter a room.';
  if (msg.includes('profile_missing')) {
    return 'Profile not ready yet — try again in a moment.';
  }
  if (msg.includes('stale_client_reload')) {
    return 'New version available — please refresh the page.';
  }
  // Fallback: surface the raw error for production debugging.
  console.error('[matchmaking] enter-room failure', err);
  return msg ? `Could not enter the room: ${msg}` : 'Could not enter the room. Try again.';
}
