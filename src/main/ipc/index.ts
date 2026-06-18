import { registerAuthHandlers } from './auth.handlers';
import { registerUserHandlers } from './users.handlers';
import { registerEquipmentHandlers } from './equipment.handlers';
import { registerMaintenanceHandlers } from './maintenance.handlers';
import { registerPartsHandlers } from './parts.handlers';
import { registerVendorHandlers } from './vendors.handlers';
import { registerLoanHandlers } from './loans.handlers';
import { registerPurchaseRequestHandlers } from './purchase-requests.handlers';
import { registerReportsHandlers } from './reports.handlers';
import { registerSyncHandlers } from './sync.handlers';
import { registerAppHandlers } from './app.handlers';

export function registerAllHandlers(): void {
  registerAuthHandlers();
  registerUserHandlers();
  registerEquipmentHandlers();
  registerMaintenanceHandlers();
  registerPartsHandlers();
  registerVendorHandlers();
  registerLoanHandlers();
  registerPurchaseRequestHandlers();
  registerReportsHandlers();
  registerSyncHandlers();
  registerAppHandlers();
}
