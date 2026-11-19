import { MobileSessionService } from '../communication/mobile-session.service';
import { MobilePushService } from '../communication/mobile-push.service';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerTokenService } from './customer-token.service';
import { GpsTrackingService } from './gps-tracking.service';
import { TripService } from './trip.service';

describe('Logout with pending web GPS data', () => {
  let service: CustomerAuthService;
  let suspend: jasmine.Spy;
  let removeTokens: jasmine.Spy;
  let http: jasmine.Spy;
  const key = 'CapacitorStorage.mobile_sync_v1:office:customer:user';
  beforeEach(() => {
    localStorage.clear();
    suspend = jasmine.createSpy().and.resolveTo();
    removeTokens = jasmine.createSpy();
    http = jasmine.createSpy().and.returnValue(of(undefined));
    TestBed.configureTestingModule({
      providers: [
        {provide:MobileSessionService,useValue:{leaveForLogout:async()=>undefined}},
        {provide:MobilePushService,useValue:{revoke:async()=>undefined}},
        { provide: HttpClient, useValue: { post: http } },
        { provide: CustomerTokenService, useValue: { token: null, removeTokens } },
        { provide: GpsTrackingService, useValue: { suspendForLogout: suspend } },
        { provide: TripService, useValue: { clearCache: () => undefined } },
        { provide: Router, useValue: { navigate: async () => true } },
      ],
    });
    service = TestBed.inject(CustomerAuthService);
  });
  afterEach(() => localStorage.clear());
  it('retains durable GPS operations while removing login tokens and cached profile data', async () => {
    localStorage.setItem(key, 'pending-gps');
    localStorage.setItem('customer_auth_token', 'access');
    localStorage.setItem('CapacitorStorage.profilePhoto', 'private-photo');
    await firstValueFrom(service.logout());
    expect(localStorage.getItem(key)).toBe('pending-gps');
    expect(localStorage.getItem('customer_auth_token')).toBeNull();
    expect(localStorage.getItem('CapacitorStorage.profilePhoto')).toBeNull();
    expect(removeTokens).toHaveBeenCalled();
    expect(suspend).toHaveBeenCalled();
  });
  it('does not clear the trip or credentials if suspending cannot be persisted', async () => {
    localStorage.setItem(key, 'pending-gps');
    suspend.and.rejectWith(new Error('Disk full'));
    await expectAsync(firstValueFrom(service.logout())).toBeRejectedWithError('Disk full');
    expect(http).not.toHaveBeenCalled();
    expect(removeTokens).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe('pending-gps');
  });
});
