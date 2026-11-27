import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { CustomerSessionRefreshService } from '../services/customer-session-refresh.service';
import { CustomerTokenService } from '../services/customer-token.service';
import { MobileTrackingPlatform } from '../services/mobile-tracking-platform.service';
import { NO_CONNECTION_MESSAGE } from '../services/session-end';
import { SessionEndService } from '../services/session-end.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let removeTokens: jasmine.Spy;
  let refreshAccessToken: jasmine.Spy;
  let navigate: jasmine.Spy;
  let createToast: jasmine.Spy;
  let reconnect: (() => void) | undefined;

  beforeEach(() => {
    reconnect = undefined;
    removeTokens = jasmine.createSpy('removeTokens');
    refreshAccessToken = jasmine.createSpy('refreshAccessToken');
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    createToast = jasmine.createSpy('create').and.resolveTo({ present: async () => undefined });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: CustomerTokenService,
          useValue: {
            token: 'access',
            refreshToken: 'refresh',
            decodeToken: () => ({ tenant_id: 'office-a', customer_id: 'customer-a', sub: 'user-a' }),
            removeTokens,
          },
        },
        { provide: CustomerSessionRefreshService, useValue: { refreshAccessToken } },
        { provide: Router, useValue: { navigate } },
        { provide: ToastController, useValue: { create: createToast } },
        {
          provide: MobileTrackingPlatform,
          useValue: {
            onReconnect: (callback: () => void) => {
              reconnect = callback;
              return Promise.resolve({ remove: async () => undefined });
            },
          },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  function requestWithExpiredToken(): void {
    http.get(`${environment.apiUrl}/mobile/trips`).subscribe({ error: () => undefined });
    backend.expectOne(`${environment.apiUrl}/mobile/trips`).flush(null, { status: 401, statusText: 'Unauthorized' });
  }

  function refreshFailsWith(error: unknown): void {
    refreshAccessToken.and.returnValue(throwError(() => error));
  }

  it('keeps the session and warns when the refresh fails for lack of connection', async () => {
    refreshFailsWith(new HttpErrorResponse({ status: 0 }));
    requestWithExpiredToken();
    await Promise.resolve();
    expect(removeTokens).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(createToast).toHaveBeenCalledWith(jasmine.objectContaining({ message: NO_CONNECTION_MESSAGE }));
  });

  it('retries the refresh when the connection comes back', async () => {
    refreshFailsWith(new HttpErrorResponse({ status: 0 }));
    requestWithExpiredToken();
    await Promise.resolve();
    expect(reconnect).toBeDefined();
    reconnect!();
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it('signs out with the password notice when the server rejects the refresh', () => {
    refreshFailsWith(new HttpErrorResponse({ status: 401, error: { reason: 'password_change' } }));
    requestWithExpiredToken();
    expect(removeTokens).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(TestBed.inject(SessionEndService).takeNotice()).toBe(
      'Your password was changed. Sign in with your new password.'
    );
  });

  it('signs out with the generic notice when the rejection has no known reason', () => {
    refreshFailsWith(new HttpErrorResponse({ status: 401, error: { title: 'Unauthorized' } }));
    requestWithExpiredToken();
    expect(removeTokens).toHaveBeenCalled();
    expect(TestBed.inject(SessionEndService).takeNotice()).toBe('You were signed out. Sign in again to continue.');
  });
});
