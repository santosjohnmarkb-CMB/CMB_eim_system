import { printHtml } from './print';
import { buildPurchaseRequestForm } from '../../shared/forms/purchaseForm';
import type { PurchaseRequest } from '../../shared/types';

// The document body builder lives in src/shared/forms so the main-process PDF
// archive pipeline produces byte-identical output to what is printed on screen.
export { buildPurchaseRequestForm };

export function printPurchaseRequestForm(req: PurchaseRequest): void {
  printHtml(`Purchase Request ${req.request_number}`, buildPurchaseRequestForm(req));
}
