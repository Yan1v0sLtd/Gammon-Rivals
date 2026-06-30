import { supabase } from '../supabase';
import type { BillingService, BillingPurchaseRequest, BillingOutcome } from './types';

/** Web / dev billing — NO real money. Routes the purchase through the admin-only
 *  test_purchase_shop_item RPC so the full grant → wallet → UI flow is exercisable
 *  in the browser before the native store exists. Non-admins get a clear
 *  not_authorized outcome (the Shop shows "coming soon"). */
export class MockBillingService implements BillingService {
  async purchase(req: BillingPurchaseRequest): Promise<BillingOutcome> {
    const { error } = await supabase.rpc('test_purchase_shop_item', { p_item_id: req.itemId });
    if (!error) return { status: 'granted' };
    const msg = error.message ?? '';
    const code = msg.includes('not_authorized')
      ? 'not_authorized'
      : msg.includes('already_owned_board')
        ? 'already_owned'
        : msg.includes('unsupported_grant')
          ? 'unsupported_grant'
          : 'error';
    return { status: 'error', code, message: msg };
  }
}
