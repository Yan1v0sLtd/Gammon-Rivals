import {createAction} from "@reduxjs/toolkit"

/**
 * Bridges the component-owned auto-roll preference and reveal gate to the
 * cancellable gameplay workflow without duplicating either value in Redux.
 */
export const autoRollEligibilityChanged = createAction<{
  readonly enabled: boolean,
}>("gameplay/autoRollEligibilityChanged")
