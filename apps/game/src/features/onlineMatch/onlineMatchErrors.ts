/**
 * supabase-js wraps a non-2xx edge-function response in a FunctionsHttpError
 * whose `.message` is the generic "Edge Function returned a non-2xx status
 * code" — the server's actual reason lives in the response body. Crack it open
 * so we (a) log the real cause for diagnosis and (b) can silence benign races
 * instead of flashing a confusing toast at the user.
 */
export async function edgeFunctionErrorDetail(fnName: string, err: unknown): Promise<string> {
  let serverReason: string | null = null;
  let status: number | null = null;
  const ctx = (err as { context?: Response } | null)?.context;
  if (ctx) {
    status = ctx.status ?? null;
    try {
      const body = await ctx.clone().json();
      if (body && typeof body === 'object' && 'error' in body) {
        serverReason = String((body as { error: unknown }).error);
      }
    }
    catch {
      // Body wasn't JSON; try plain text as a last resort.
      try {
        const text = await ctx.clone().text();
        if (text) serverReason = text;
      }
      catch { /* give up */
      }
    }
  }
  const generic = err instanceof Error ? err.message : String(err);
  console.error(`[onlineMatch] ${fnName} failed`, {
    status,
    serverReason,
    generic
  });
  return serverReason ?? generic;
}

// Races we swallow instead of surfacing, shared by the roll and turn-commit
// paths:
//   - "turn already in progress": another path (the auto-action, a concurrent
//     tab, a double fire) got the roll in first.
//   - no_turn_in_progress / not_your_turn: the server view already advanced
//     past us, or another path cleared current_turn.
//   - match finished / match_already_finished: an opponent claim or our own
//     resign landed between the click and the round-trip.
//   - opponent_still_active / race_lost: a concurrent caller won the forfeit
//     conversion.
// All of them surfaced as a flash to the user even though the server outcome
// is what we wanted anyway; the refetch after the command syncs local state.
const BENIGN_RACE_REASONS = ['turn already in progress', 'no_turn_in_progress', 'not_your_turn', 'match finished', 'match_already_finished', 'opponent_still_active', 'race_lost',];

export function isBenignCommandRace(detail: string): boolean {
  return BENIGN_RACE_REASONS.some((reason) => detail.includes(reason));
}

// The RPC reports failure through the error message, not a throw: retryable
// reasons must NOT fall through to finish_match while terminal ones must.
const RETRYABLE_CONVERSION_REASONS = ['opponent_still_active', 'race_lost'];
const TERMINAL_CONVERSION_REASONS = ['match_already_finished', 'not_a_pvp_match'];

export type ConversionErrorKind = 'retryable' | 'terminal' | 'fatal';

export function classifyConversionError(message: string): ConversionErrorKind {
  if (RETRYABLE_CONVERSION_REASONS.some((reason) => message.includes(reason))) return 'retryable';
  if (TERMINAL_CONVERSION_REASONS.some((reason) => message.includes(reason))) return 'terminal';
  return 'fatal';
}
