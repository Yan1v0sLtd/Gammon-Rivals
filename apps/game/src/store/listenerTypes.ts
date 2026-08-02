import type {TypedStartListening} from '@reduxjs/toolkit';
import type {AppDispatch, RootState} from './store';

/**
 * Passed to feature listener modules so the middleware file stays a thin
 * composition root. Kept here to keep imports one-way: features never
 * import the file that imports them.
 */
export type AppStartListening = TypedStartListening<RootState, AppDispatch>;
