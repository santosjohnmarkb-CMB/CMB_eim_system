import type { IpcMainInvokeEvent } from 'electron';

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  role: string;
  email?: string;
  department?: 'camera' | 'lights_grips' | null;
}

const sessions = new Map<number, SessionUser>();

export function setSession(event: IpcMainInvokeEvent, user: SessionUser): void {
  const id = event.sender.id;
  sessions.set(id, user);
  if (!event.sender.isDestroyed()) {
    event.sender.once('destroyed', () => sessions.delete(id));
  }
}

export function clearSession(event: IpcMainInvokeEvent): void {
  sessions.delete(event.sender.id);
}

export function getSession(event: IpcMainInvokeEvent): SessionUser | null {
  return sessions.get(event.sender.id) ?? null;
}

export function requireSession(event: IpcMainInvokeEvent): SessionUser {
  const user = getSession(event);
  if (!user) throw new Error('Not authenticated. Please sign in and try again.');
  return user;
}

export function requireAdmin(event: IpcMainInvokeEvent): SessionUser {
  const user = requireSession(event);
  if (user.role !== 'admin') {
    throw new Error('Admin privileges are required for this action.');
  }
  return user;
}

// The viewer role is a cross-department, read-only account: it can see every
// department but must never mutate data. Use this in place of requireSession on
// any handler that writes, so viewers are blocked server-side regardless of UI.
export function requireWriteAccess(event: IpcMainInvokeEvent): SessionUser {
  const user = requireSession(event);
  if (user.role === 'viewer') {
    throw new Error('Your account has view-only access and cannot make changes.');
  }
  return user;
}

export function requireRole(event: IpcMainInvokeEvent, ...roles: string[]): SessionUser {
  const user = requireSession(event);
  if (!roles.includes(user.role)) {
    throw new Error(`One of the following roles is required: ${roles.join(', ')}`);
  }
  return user;
}

export function getSessionActorId(
  event: IpcMainInvokeEvent,
  fallback: string | null | undefined,
): string | null {
  const user = getSession(event);
  if (user) return user.id;
  return fallback ?? null;
}
