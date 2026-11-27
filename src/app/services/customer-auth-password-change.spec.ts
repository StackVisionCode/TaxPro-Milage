import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import { MobilePushService } from '../communication/mobile-push.service';
import { MobileSessionService } from '../communication/mobile-session.service';
import { ICustomerLoginResponse } from '../models/customer-login.interface';
import { environment } from '../../environments/environment';
import { CustomerAuthService } from './customer-auth.service';
import { PasswordChangeRequiredError } from './customer-login-outcome';
import { CustomerTokenService } from './customer-token.service';
import { GpsTrackingService } from './gps-tracking.service';
import { TripService } from './trip.service';

describe('CustomerAuthService password change required', () => {
  const portalUrl = 'https://acme.taxoffix.io/portal/client/auth/login';
  const restricted: ICustomerLoginResponse = {
    requiresTenantSelection: false,
    offices: [],
    mfaSetupRequired: false,
    takeoverRequired: false,
    passwordChangeRequired: true,
    portalUrl,
    accessToken: 'restricted-access',
    refreshToken: 'restricted-refresh',
  };

  let service: CustomerAuthService;
  let post: jasmine.Spy;
  let get: jasmine.Spy;
  let setTokens: jasmine.Spy;

  function setup(response: ICustomerLoginResponse): void {
    post = jasmine
      .createSpy('post')
      .and.callFake((url: string) =>
        url.endsWith(environment.endpoints.login) ? of(response) : of(undefined)
      );
    get = jasmine.createSpy('get').and.returnValue(of({}));
    setTokens = jasmine.createSpy('setTokens');
    TestBed.configureTestingModule({
      providers: [
        { provide: MobileSessionService, useValue: {} },
        { provide: MobilePushService, useValue: {} },
        { provide: HttpClient, useValue: { post, get } },
        {
          provide: CustomerTokenService,
          useValue: { token: null, refreshToken: null, setTokens },
        },
        { provide: GpsTrackingService, useValue: {} },
        { provide: TripService, useValue: {} },
        { provide: Router, useValue: { navigate: async () => true } },
      ],
    });
    service = TestBed.inject(CustomerAuthService);
  }

  it('does not keep the restricted tokens nor open a session', async () => {
    setup(restricted);

    const login = firstValueFrom(
      service.loginWithTenant({ discoverySessionRef: 'ref', tenantId: 't1' })
    );

    await expectAsync(login).toBeRejectedWith(
      jasmine.any(PasswordChangeRequiredError)
    );
    expect(setTokens).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(service.getCurrentCustomer()).toBeNull();
  });

  it('passes the office portal URL to the prompt', async () => {
    setup(restricted);

    const error = await firstValueFrom(
      service.login({ email: 'a@b.c', password: 'secret' })
    ).catch((e) => e);

    expect(error).toEqual(jasmine.any(PasswordChangeRequiredError));
    expect((error as PasswordChangeRequiredError).portalUrl).toBe(portalUrl);
  });

  it('discards the restricted session on the server with its own token', async () => {
    setup(restricted);

    await firstValueFrom(
      service.login({ email: 'a@b.c', password: 'secret' })
    ).catch(() => undefined);

    const logout = post.calls
      .all()
      .find((call) =>
        String(call.args[0]).endsWith(environment.endpoints.logout)
      );
    expect(logout).toBeDefined();
    expect(logout!.args[2]?.headers?.Authorization).toBe(
      'Bearer restricted-access'
    );
  });

  it('skips the server logout when the response has no token', async () => {
    setup({
      ...restricted,
      accessToken: undefined,
      refreshToken: undefined,
      takeoverRequired: true,
      takeoverTicket: 't',
    });

    await firstValueFrom(
      service.login({ email: 'a@b.c', password: 'secret' })
    ).catch(() => undefined);

    expect(post).toHaveBeenCalledTimes(1);
  });
});
