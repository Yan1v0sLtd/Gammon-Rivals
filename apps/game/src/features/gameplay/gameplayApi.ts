import {baseApi, toApiError} from '../../store/baseApi';
import {
  createMatch,
  type CreateMatchArgs,
  finishMatch,
  type FinishMatchArgs,
  type FinishMatchRewardResult,
  finishMatchRpc,
  saveGame,
  type SaveGameArgs,
} from './gameplayData';

export type FinishMatchRpcMutationArgs = FinishMatchArgs & {
  readonly userId: string; readonly ownerAbandoned?: boolean; readonly opponentAbandoned?: boolean;
};

export function gameplayFinishCacheKey(sessionId: string): string {
  return `gameplay-finish:${sessionId}`;
}

export const gameplayApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    createMatch: build.mutation<string, CreateMatchArgs>({
      queryFn: async (args) => {
        try {
          return {data: await createMatch(args)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
    }),
    saveGame: build.mutation<void, SaveGameArgs>({
      queryFn: async (args) => {
        try {
          await saveGame(args);
          return {data: undefined};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
    }),
    finishMatch: build.mutation<void, FinishMatchArgs>({
      queryFn: async (args) => {
        try {
          await finishMatch(args);
          return {data: undefined};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
    }),
    finishMatchRpc: build.mutation<FinishMatchRewardResult, FinishMatchRpcMutationArgs>({
      queryFn: async (args) => {
        try {
          return {data: await finishMatchRpc(args)};
        }
        catch (err) {
          return {error: toApiError(err)};
        }
      },
      invalidatesTags: (_result, error, {userId}) => error ? [] : [{
        type: 'Wallet',
        id: userId
      }, {
        type: 'Profile',
        id: userId
      }, {
        type: 'XpBoost',
        id: userId
      },],
    }),
  }),
});

export const {useFinishMatchRpcMutation} = gameplayApi;
