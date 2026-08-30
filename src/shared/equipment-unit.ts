import { DOCUMENT_TYPE_CONFIG } from './constants';

/** Status and action on a unit are driven by Maintenance tickets and Loaned Equipment, not inventory edit. */
export function unitActionLabel(asset: {
  current_status?: string | null;
  open_loan_number?: string | null;
  open_ticket_number?: string | null;
  open_ticket_type?: string | null;
}): string {
  if (asset.open_loan_number) return `On loan · ${asset.open_loan_number}`;
  if (asset.open_ticket_number) {
    const type = DOCUMENT_TYPE_CONFIG[asset.open_ticket_type || '']?.label || 'Maintenance';
    return `${type} · ${asset.open_ticket_number}`;
  }
  switch (asset.current_status) {
    case 'DEPLOYED': return 'On loan';
    case 'FOR_INSPECTION':
    case 'IN_REPAIR': return 'Maintenance';
    case 'MISSING': return 'Loss report';
    default: return '—';
  }
}

export function isLiveUnitStatus(status: string | null | undefined): boolean {
  return status !== 'RETIRED' && status !== 'MISSING';
}

export function isUnitLocked(asset: {
  id?: string | null;
  current_status?: string | null;
  open_loan_number?: string | null;
  open_ticket_number?: string | null;
}): boolean {
  if (!asset.id) return false;
  const status = asset.current_status || 'AVAILABLE';
  if (status !== 'AVAILABLE') return true;
  return Boolean(asset.open_loan_number || asset.open_ticket_number);
}
