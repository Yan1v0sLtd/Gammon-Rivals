import type {BillingOutcome, BillingService} from './types';

/** Web billing is unavailable; operator grants belong to the Back Office. */
export class MockBillingService implements BillingService {
  async purchase(): Promise<BillingOutcome> {
    return {
      status: 'error',
      code: 'not_authorized',
      message: 'Purchases are available in the native app.',
    };
  }
}
