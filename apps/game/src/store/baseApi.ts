import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';

export interface ApiError {
  message: string;
}

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fakeBaseQuery<ApiError>(),
  endpoints: () => ({}),
});
