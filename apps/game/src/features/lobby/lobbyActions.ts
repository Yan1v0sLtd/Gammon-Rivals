import {createAction} from '@reduxjs/toolkit';

/**
 * Domain event dispatched when the daily-bonus claim RPC succeeds. The
 * listener middleware owns the delayed Wallet/Profile refresh so the
 * reward-flight animation lands before the balance ticks up.
 */
export const dailyBonusClaimConfirmed = createAction<{ readonly userId: string }>('lobby/dailyBonusClaimConfirmed');
