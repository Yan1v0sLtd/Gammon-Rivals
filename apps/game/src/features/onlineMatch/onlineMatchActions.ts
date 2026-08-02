import {createAction} from '@reduxjs/toolkit';

/**
 * Workflow input, not application state: the auto-roll preference stays in the
 * page's useAutoRoll and is mirrored into the listener's closure, matching how
 * the local-gameplay workflow takes the same toggle.
 */
export const onlineAutoRollEligibilityChanged = createAction<{
  readonly enabled: boolean
}>('onlineMatch/autoRollEligibilityChanged',);
