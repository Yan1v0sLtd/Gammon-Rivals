import { baseApi, toApiError } from '../../store/baseApi';
import { getGameWithMoves, type GameWithMoves } from './replayData';

export const replayApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getReplay: build.query<GameWithMoves, string>({
      queryFn: async (gameId) => {
        try {
          const data = await getGameWithMoves(gameId);
          return { data };
        } catch (err) {
          return { error: toApiError(err) };
        }
      },
      keepUnusedDataFor: 1800,
    }),
  }),
});

export const { useGetReplayQuery } = replayApi;
