import { printHtml } from './print';
import { buildLoanReleaseForm, buildInwardLoanForm } from '../../shared/forms/loanForm';
import type { ReleaseFormInput, ReleaseFormItem } from '../../shared/forms/loanForm';

// The document body builder lives in src/shared/forms so the main-process PDF
// archive pipeline produces byte-identical output to what is printed on screen.
export { buildLoanReleaseForm, buildInwardLoanForm };
export type { ReleaseFormInput, ReleaseFormItem };

export function printLoanReleaseForm(input: ReleaseFormInput): void {
  printHtml(`Equipment Release Form ${input.loan_number}`, buildLoanReleaseForm(input));
}

// Inward loans (equipment borrowed from an external owner) use a receiving form
// instead of a release form.
export function printInwardLoanForm(input: ReleaseFormInput): void {
  printHtml(`Inward Loan Receiving Form ${input.loan_number}`, buildInwardLoanForm(input));
}
