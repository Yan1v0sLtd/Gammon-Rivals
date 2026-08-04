import type {BillingOutcome, BillingService} from "./types"

/** Web billing is unavailable; operator grants belong to the Back Office. */
export class MockBillingService implements BillingService {
  purchase(): Promise<BillingOutcome> {
    return Promise.resolve({
      status: "error",
      code: "not_authorized",
      message: "Purchases are available in the native app.",
    })
  }
}
