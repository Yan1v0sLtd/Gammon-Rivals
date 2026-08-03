import type { AppStartListening } from '../../store/listenerTypes';
import { baseApi } from '../../store/baseApi';
import { shopGrantConfirmed } from './shopActions';

const SHOP_WALLET_REFRESH_DELAY_MS = 600;

export function startShopListeners(startListening: AppStartListening): void {
  // Post-purchase player-data refresh. The Shop funnels both purchase paths
  // (gem RPC + Play Billing/USD) through shopGrantConfirmed so this one
  // workflow owns the wallet + XP-boost refresh for every grant. The 600 ms
  // wallet delay is animation choreography, not a data concern: the
  // reward-flight tokens visually land in the balance before the number
  // ticks up. No cancelActiveListeners — two purchases in a row must each
  // get their own refresh.
  startListening({
    actionCreator: shopGrantConfirmed,
    effect: async (action, { delay, dispatch }) => {
      dispatch(baseApi.util.invalidateTags([{ type: 'XpBoost', id: action.payload.userId }]));
      await delay(SHOP_WALLET_REFRESH_DELAY_MS);
      dispatch(baseApi.util.invalidateTags([{ type: 'Wallet', id: action.payload.userId }]));
    },
  });
}
