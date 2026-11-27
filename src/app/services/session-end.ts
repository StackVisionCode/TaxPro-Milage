import { HttpErrorResponse } from '@angular/common/http';

import { environment } from '../../environments/environment';

/** Motivo con que Auth rechaza el refresh (campo `reason` del ProblemDetails). */
export type SessionEndReason = 'password_change' | 'admin_revoke' | 'mfa_reset_by_office' | 'generic';

export const NO_CONNECTION_MESSAGE = "No connection. We'll try again when you're back online.";
export const QUICK_SIGN_IN_OFF_MESSAGE =
  'Quick sign-in was turned off because your session ended. Sign in with your password to turn it back on.';
export const FORGOT_PASSWORD_HINT = "Reset it on your office's client portal.";

const SIGNED_OUT_MESSAGE = 'You were signed out. Sign in again to continue.';
const MESSAGES: Record<SessionEndReason, string> = {
  password_change: 'Your password was changed. Sign in with your new password.',
  admin_revoke: SIGNED_OUT_MESSAGE,
  mfa_reset_by_office: 'Your two-step verification was reset. Sign in again to continue.',
  generic: SIGNED_OUT_MESSAGE,
};

/** El servidor rechazó el refresh del login rápido: ya se borraron las credenciales biométricas. */
export class QuickSignInDisabledError extends Error {
  constructor() {
    super(QUICK_SIGN_IN_OFF_MESSAGE);
    this.name = 'QuickSignInDisabledError';
  }
}

/** Sin respuesta, timeout o servidor caído: la sesión sigue siendo válida. */
export function isTransientRefreshFailure(error: unknown): boolean {
  if (error instanceof HttpErrorResponse) return error.status === 0 || error.status === 408 || error.status >= 500;
  return error instanceof Error && error.name === 'TimeoutError';
}

/** Motivo del rechazo; desconocido o ausente ⇒ genérico. */
export function refreshRejectionReason(error: unknown): SessionEndReason {
  const reason = error instanceof HttpErrorResponse ? readReason(error.error) : '';
  return Object.prototype.hasOwnProperty.call(MESSAGES, reason) ? (reason as SessionEndReason) : 'generic';
}

export function sessionEndMessage(reason: SessionEndReason): string {
  return MESSAGES[reason];
}

/** Login rápido: si el servidor rechaza el refresh se borran las credenciales; si falla la red, se conservan. */
export async function renewQuickSignIn<T>(
  refresh: () => Promise<T>,
  forgetCredentials: () => Promise<void>
): Promise<T> {
  try {
    return await refresh();
  } catch (error) {
    if (isTransientRefreshFailure(error)) throw new Error(NO_CONNECTION_MESSAGE);
    await forgetCredentials();
    throw new QuickSignInDisabledError();
  }
}

/** Dominio de la plataforma: el host de la API sin su primera etiqueta (`api.{dominio}`). */
export function platformBaseDomain(apiUrl: string = environment.apiUrl): string {
  const host = new URL(apiUrl).hostname.toLowerCase();
  const labels = host.split('.');
  if (labels.length < 3 || labels.every((label) => /^\d+$/.test(label))) return host;
  return labels.slice(1).join('.');
}

/** Forgot del portal de la oficina; sin oficina, el login central de clientes. */
export function forgotPasswordUrl(subdomain: string | null | undefined, apiUrl: string = environment.apiUrl): string {
  const baseDomain = platformBaseDomain(apiUrl);
  const office = subdomain?.trim().toLowerCase();
  if (!office || !/^[a-z0-9-]+$/.test(office)) return `https://app.${baseDomain}/client`;
  return `https://${office}.${baseDomain}/portal/client/auth/forgot-password`;
}

function readReason(body: unknown): string {
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return '';
    }
  }
  if (!body || typeof body !== 'object') return '';
  const problem = body as { reason?: unknown; extensions?: { reason?: unknown } };
  const value = problem.reason ?? problem.extensions?.reason;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
