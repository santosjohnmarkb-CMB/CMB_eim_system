import { printHtml } from './print';
import { buildLoanReleaseForm } from '../../shared/forms/loanForm';
import type { ReleaseFormInput, ReleaseFormItem } from '../../shared/forms/loanForm';

// The document body builder lives in src/shared/forms so the main-process PDF
// archive pipeline produces byte-identical output to what is printed on screen.
export { buildLoanReleaseForm };
export type { ReleaseFormInput, ReleaseFormItem };

export function printLoanReleaseForm(input: ReleaseFormInput): void {
  printHtml(`Equipment Release Form ${input.loan_number}`, buildLoanReleaseForm(input));
}
