import { printHtml } from './print';
import { buildRepairReleaseForm } from '../../shared/forms/repairReleaseForm';
import type { RepairReleaseFormInput } from '../../shared/forms/repairReleaseForm';

// The document body builder lives in src/shared/forms so the main-process PDF
// archive pipeline produces byte-identical output to what is printed on screen.
export { buildRepairReleaseForm };
export type { RepairReleaseFormInput };

export function printRepairReleaseForm(input: RepairReleaseFormInput): void {
  printHtml(`Equipment Repair Release Form ${input.ticket_number}`, buildRepairReleaseForm(input));
}
