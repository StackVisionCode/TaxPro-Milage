import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';

import { CustomerSessionRefreshService } from './customer-session-refresh.service';
import { CustomerTokenService } from './customer-token.service';
import { MobileTrackingPlatform } from './mobile-tracking-platform.service';
import {
  forgotPasswordUrl,
  isTransientRefreshFailure,
  NO_CONNECTION_MESSAGE,
  QUICK_SIGN_IN_OFF_MESSAGE,
  QuickSignInDisabledError,
  refreshRejectionReason,
  renewQuickSignIn,
  sessionEndMessage,
} from './session-end';
import { SessionEndService } from './session-end.service';

describe('SessionEnd', () => {
  const rejected = (error: unknown) => new HttpErrorResponse({ status: 401, error });

  describe('refresh rejection reason', () => {
    it('reads the reason from the ProblemDetails body', () => {
      expect(refreshRejectionReason(rejected({ reason: 'password_change' }))).toBe('password_change');
      expect(refreshRejectionReason(rejected({ reason: 'ADMIN_REVOKE' }))).toBe('admin_revoke');
      expect(refreshRejectionReason(rejected({ extensions: { reason: 'mfa_reset_by_office' } }))).toBe(
        'mfa_reset_by_office'
      );
      expect(refreshRejectionReason(rejected('{"reason":"password_change"}'))).toBe('password_change');
    });

    it('falls back to generic for unknown or missing reasons', () => {
      expect(refreshRejectionReason(rejected({ reason: 'account_secured' }))).toBe('generic');
      expect(refreshRejectionReason(rejected({ reason: 42 }))).toBe('generic');
      expect(refreshRejectionReason(rejected({ reason: 'constructor' }))).toBe('generic');
      expect(refreshRejectionReason(rejected(null))).toBe('generic');
      expect(refreshRejectionReason(rejected('not json'))).toBe('generic');
      expect(refreshRejectionReason(new Error('boom'))).toBe('generic');
    });

    it('uses the copy of each reason', () => {
      expect(sessionEndMessage('password_change')).toBe('Your password was changed. Sign in with your new password.');
      expect(sessionEndMessage('admin_revoke')).toBe('You were signed out. Sign in again to continue.');
      expect(sessionEndMessage('mfa_reset_by_office')).toBe(
        'Your two-step verification was reset. Sign in again to continue.'
      );
      expect(sessionEndMessage('generic')).toBe('You were signed out. Sign in again to continue.');
    });
  });

  it('treats no response, timeouts and server outages as connection failures', () => {
    expect(isTransientRefreshFailure(new HttpErrorResponse({ status: 0 }))).toBeTrue();
    expect(isTransientRefreshFailure(new HttpErrorResponse({ status: 504 }))).toBeTrue();
    const timeout = new Error('Timeout has occurred');
    timeout.name = 'TimeoutError';
    expect(isTransientRefreshFailure(timeout)).toBeTrue();
    expect(isTransientRefreshFailure(rejected({ reason: 'password_change' }))).toBeFalse();
    expect(isTransientRefreshFailure(new Error('boom'))).toBeFalse();
  });

  describe('forgot password url', () => {
    it('opens the forgot page of the office portal', () => {
      expect(forgotPasswordUrl('acme', 'https://api.taxoffix.io')).toBe(
        'https://acme.taxoffix.io/portal/client/auth/forgot-password'
      );
    });

    it('opens the central client login without an office', () => {
      expect(forgotPasswordUrl(null, 'https://api.taxoffix.io')).toBe('https://app.taxoffix.io/client');
      expect(forgotPasswordUrl('evil.com/x', 'https://api.taxoffix.io')).toBe('https://app.taxoffix.io/client');
    });
  });

  describe('quick sign-in renewal', () => {
    it('forgets the saved credentials when the server rejects the refresh', async () => {
      const forget = jasmine.createSpy('forget').and.resolveTo();
      const renewal = renewQuickSignIn(() => Promise.reject(rejected({ reason: 'password_change' })), forget);
      await expectAsync(renewal).toBeRejectedWith(jasmine.any(QuickSignInDisabledError));
      await expectAsync(renewal).toBeRejectedWithError(QUICK_SIGN_IN_OFF_MESSAGE);
      expect(forget).toHaveBeenCalled();
    });

    it('keeps the saved credentials when there is no connection', async () => {
      const forget = jasmine.createSpy('forget').and.resolveTo();
      const renewal = renewQuickSignIn(() => Promise.reject(new HttpErrorResponse({ status: 0 })), forget);
      await expectAsync(renewal).toBeRejectedWithError(NO_CONNECTION_MESSAGE);
      expect(forget).not.toHaveBeenCalled();
    });

    it('returns the new tokens when the refresh works', async () => {
      const forget = jasmine.createSpy('forget');
      await expectAsync(renewQuickSignIn(() => Promise.resolve('tokens'), forget)).toBeResolvedTo('tokens');
      expect(forget).not.toHaveBeenCalled();
    });
  });

  it('remembers the chosen office for "Forgot password?"', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: CustomerTokenService, useValue: {} },
        { provide: CustomerSessionRefreshService, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: ToastController, useValue: {} },
        { provide: MobileTrackingPlatform, useValue: {} },
      ],
    });
    const service = TestBed.inject(SessionEndService);
    service.rememberOffice('acme');
    expect(service.forgotPasswordUrl()).toContain('://acme.');
    expect(service.forgotPasswordUrl()).toContain('/portal/client/auth/forgot-password');
  });
});
