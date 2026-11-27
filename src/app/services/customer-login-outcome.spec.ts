import { HttpErrorResponse } from '@angular/common/http';
import { ICustomerLoginResponse } from '../models/customer-login.interface';
import {
  interpretLoginResponse,
  loginErrorMessage,
  MfaSetupRequiredError,
} from './customer-login-outcome';

const base: ICustomerLoginResponse = {
  requiresTenantSelection: false,
  offices: [],
  mfaSetupRequired: false,
  takeoverRequired: false,
};

const apiError = (status: number, code: string, retryAfterSeconds?: number) =>
  new HttpErrorResponse({ status, error: { code, message: 'server text', retryAfterSeconds } });

describe('interpretLoginResponse', () => {
  it('asks to choose an office when Auth returns the selector', () => {
    const office = { tenantId: 't1', name: 'Acme', subdomain: 'acme', mfaRequired: false };

    const outcome = interpretLoginResponse({
      ...base,
      requiresTenantSelection: true,
      discoverySessionRef: 'ref',
      offices: [office],
    });

    expect(outcome).toEqual({ kind: 'selectOffice', reference: 'ref', offices: [office] });
  });

  // Auth solo da un token para configurar MFA: la app no puede usarlo, así que no se guarda ni se toma otra sesión.
  it('stops before the takeover when the office still requires setting up MFA', () => {
    const outcome = interpretLoginResponse({
      ...base,
      mfaSetupRequired: true,
      takeoverRequired: true,
      takeoverTicket: 'ticket',
    });

    expect(outcome).toEqual({ kind: 'mfaSetupRequired' });
  });

  it('stops when the session only allows setting up MFA', () => {
    const outcome = interpretLoginResponse({ ...base, mfaSetupRequired: true, accessToken: 'a', refreshToken: 'r' });

    expect(outcome).toEqual({ kind: 'mfaSetupRequired' });
  });

  // Token restringido de cambio obligatorio: no se abre sesión ni se toma la otra; el cambio va al portal.
  it('sends the password change to the office portal instead of opening a session', () => {
    const portalUrl = 'https://acme.taxoffix.io/portal/client/auth/login';

    const outcome = interpretLoginResponse({
      ...base,
      passwordChangeRequired: true,
      portalUrl,
      accessToken: 'a',
      refreshToken: 'r',
    });

    expect(outcome).toEqual({ kind: 'passwordChangeRequired', portalUrl, accessToken: 'a' });
  });

  it('does not take over the other session when a password change is required', () => {
    const outcome = interpretLoginResponse({
      ...base,
      passwordChangeRequired: true,
      portalUrl: null,
      takeoverRequired: true,
      takeoverTicket: 'ticket',
    });

    expect(outcome).toEqual({ kind: 'passwordChangeRequired', portalUrl: null, accessToken: undefined });
  });

  it('asks to confirm the takeover of the other app session', () => {
    const outcome = interpretLoginResponse({ ...base, takeoverRequired: true, takeoverTicket: 'ticket' });

    expect(outcome).toEqual({ kind: 'takeover', ticket: 'ticket' });
  });

  it('returns the session tokens', () => {
    const outcome = interpretLoginResponse({ ...base, accessToken: 'a', refreshToken: 'r' });

    expect(outcome).toEqual({ kind: 'session', accessToken: 'a', refreshToken: 'r' });
  });

  it('treats a response without tokens as invalid', () => {
    expect(interpretLoginResponse(base)).toEqual({ kind: 'invalid' });
  });
});

describe('loginErrorMessage', () => {
  it('tells how many minutes to wait after too many attempts, rounding up', () => {
    const message = loginErrorMessage(apiError(429, 'Auth.LockedOut', 241), 'fallback');

    expect(message).toBe('Demasiados intentos. Intenta de nuevo en 5 minutos.');
  });

  it('uses the singular for one minute', () => {
    expect(loginErrorMessage(apiError(429, 'Auth.LockedOut', 30), 'fallback')).toBe(
      'Demasiados intentos. Intenta de nuevo en 1 minuto.'
    );
  });

  it('sends the client to the web portal to set up MFA', () => {
    expect(loginErrorMessage(new MfaSetupRequiredError(), 'fallback')).toContain('portal web');
  });

  it('names wrong credentials without saying which one failed', () => {
    expect(loginErrorMessage(apiError(401, 'Auth.Invalid'), 'fallback')).toBe('Correo o contraseña incorrectos.');
  });

  it('explains an expired sign-in so the client starts again', () => {
    expect(loginErrorMessage(apiError(401, 'Auth.HandoffInvalid'), 'fallback')).toContain('Vuelve a ingresar');
  });

  it('explains an expired session takeover', () => {
    expect(loginErrorMessage(apiError(401, 'Auth.TakeoverInvalid'), 'fallback')).toContain('Vuelve a iniciar sesión');
  });

  it('names a wrong MFA code', () => {
    expect(loginErrorMessage(apiError(401, 'Auth.MfaInvalid'), 'fallback')).toBe('El código es incorrecto o venció.');
  });

  it('falls back when the code is unknown or there is no connection', () => {
    expect(loginErrorMessage(apiError(500, 'Something.Else'), 'fallback')).toBe('fallback');
    expect(loginErrorMessage(new HttpErrorResponse({ status: 0 }), 'fallback')).toBe(
      'No hay conexión con el servidor. Revisa tu internet.'
    );
  });
});
