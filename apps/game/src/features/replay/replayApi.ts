import { baseApi, type ApiError } from '../../store/baseApi';
import { getGameWithMoves, type GameWithMoves } from '../../lib/queries';

function toApiError(err: unknown): ApiError {
  if (err instanceof Error) return { message: err.message };
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return { message: (err as { message: string }).message };
  }
  return { message: String(err) };
}

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
