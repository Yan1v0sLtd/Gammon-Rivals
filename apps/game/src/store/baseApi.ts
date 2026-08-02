import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

export interface ApiError {
  message: string;
}

/** Normalize any queryFn rejection into the shared serializable ApiError shape. */
export function toApiError(err: unknown): ApiError {
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

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fakeBaseQuery<ApiError>(),
  tagTypes: ['Profile', 'Wallet', 'XpBoost', 'LevelConfigs', 'LevelStatusTiers'],
  endpoints: () => ({}),
});
