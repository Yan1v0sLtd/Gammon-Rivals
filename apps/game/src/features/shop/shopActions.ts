import {createAction} from '@reduxjs/toolkit';

/**
 * Domain event dispatched by the Shop UI after ANY confirmed grant — the
 * gem RPC path (buyWithGems) and the Play-Billing/USD path
 * (handleUsdPurchase) both funnel here, so one listener owns the
 * post-purchase player-data refresh for both.
 */
export const shopGrantConfirmed = createAction<{ userId: string }>('shop/grantConfirmed');

/** Domain event for the app-start shop cache and image warm-up workflow. */
export const shopWarmupRequested = createAction('shop/warmupRequested');
