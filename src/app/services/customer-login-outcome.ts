import { HttpErrorResponse } from '@angular/common/http';
import { ICustomerLoginResponse, ICustomerTenantOption } from '../models/customer-login.interface';

/** Qué hacer con la respuesta de POST /auth/mobile/login. */
export type LoginOutcome =
  | { kind: 'selectOffice'; reference: string; offices: ICustomerTenantOption[] }
  | { kind: 'mfaSetupRequired' }
  | { kind: 'takeover'; ticket: string }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'invalid' };

/** La oficina exige verificación en dos pasos y el cliente aún no la configuró: se activa en el portal web. */
export class MfaSetupRequiredError extends Error {
  constructor() {
    super('MFA setup required');
    this.name = 'MfaSetupRequiredError';
  }
}

/**
 * Con MFA pendiente, Auth solo emite un token para configurarlo, que la API de la app rechaza. Por eso se
 * corta antes del takeover: no tiene sentido cerrar la otra sesión para entrar con un token inútil.
 */
export function interpretLoginResponse(response: ICustomerLoginResponse): LoginOutcome {
  if (response.requiresTenantSelection && response.discoverySessionRef && response.offices.length > 0)
    return { kind: 'selectOffice', reference: response.discoverySessionRef, offices: response.offices };
  if (response.mfaSetupRequired) return { kind: 'mfaSetupRequired' };
  if (response.takeoverRequired && response.takeoverTicket) return { kind: 'takeover', ticket: response.takeoverTicket };
  if (response.accessToken && response.refreshToken)
    return { kind: 'session', accessToken: response.accessToken, refreshToken: response.refreshToken };
  return { kind: 'invalid' };
}

/** Mensaje para el cliente según el código de error de Auth; nunca el texto técnico del servidor. */
export function loginErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof MfaSetupRequiredError)
    return 'Tu oficina exige verificación en dos pasos. Actívala desde el portal web y vuelve a iniciar sesión aquí.';
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'No hay conexión con el servidor. Revisa tu internet.';

  const body = error.error as { code?: string; retryAfterSeconds?: number } | null;
  switch (body?.code) {
    case 'Auth.LockedOut': {
      const minutes = Math.max(1, Math.ceil((body.retryAfterSeconds ?? 60) / 60));
      return `Demasiados intentos. Intenta de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
    }
    case 'Auth.Invalid':
      return 'Correo o contraseña incorrectos.';
    case 'Auth.MfaInvalid':
      return 'El código es incorrecto o venció.';
    case 'Auth.HandoffInvalid':
      return 'El inicio de sesión venció. Vuelve a ingresar tu correo y contraseña.';
    case 'Auth.TakeoverInvalid':
      return 'La confirmación venció. Vuelve a iniciar sesión.';
    default:
      return fallback;
  }
}
