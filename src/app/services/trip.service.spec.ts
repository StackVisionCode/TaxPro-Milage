import { MobileTrackingPlatform } from './mobile-tracking-platform.service';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { TripService } from './trip.service';
import { MobileTripSyncService } from './mobile-trip-sync.service';
import { CustomerTokenService } from './customer-token.service';
import { environment } from '../../environments/environment';

describe('TripService Mobile contract', () => {
  let service: TripService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/mobile`;
  const trip = {
    id: 'server-id',
    clientTripId: 'local-id',
    vehicleId: 'vehicle-id',
    status: 'Completed',
    purpose: 'business',
    startTime: '2026-11-19T00:00:00Z',
    revision: 5,
    lastAcceptedPointSequence: 1,
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MobileTrackingPlatform,
          useValue: { read: async () => null, write: async () => undefined },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: CustomerTokenService,
          useValue: {
            token$: new BehaviorSubject(null),
            decodeToken: () => ({ zoneinfo: 'Etc/UTC' }),
          },
        },
        {
          provide: MobileTripSyncService,
          useValue: {
            scope: () => 'owner-a',
            pendingTrips: async () => [],
            acknowledged$: new Subject(),
            flush: async () => undefined,
          },
        },
      ],
    });
    service = TestBed.inject(TripService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('uses GET query filters and loads subsequent pages', async () => {
    const promise = firstValueFrom(service.getTrips({ minDistance: 2, status: 'Completed' }));
    const first = http.expectOne((r) => r.url === `${base}/trips` && r.params.get('page') === '1');
    expect(first.request.method).toBe('GET');
    expect(first.request.body).toBeNull();
    expect(first.request.params.get('minDistanceMiles')).toBe('2');
    expect(first.request.params.has('customerId')).toBeFalse();
    first.flush({ items: [trip], page: 1, hasMore: true });
    http
      .expectOne((r) => r.url === `${base}/trips` && r.params.get('page') === '2')
      .flush({ items: [], page: 2, hasMore: false });
    expect((await promise)[0].id).toBe('server-id');
  });
  it('loads all cursor pages before returning route coordinates', async () => {
    const promise = firstValueFrom(service.getTripById('server-id'));
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne(`${base}/trips/server-id`).flush(trip);
    await new Promise((r) => setTimeout(r, 0));
    http
      .expectOne((r) => r.url.endsWith('/points') && r.params.get('after') === '-1')
      .flush({
        items: [
          {
            sequence: 0,
            latitude: 40,
            longitude: -74,
            observedAt: '2026-11-19T00:00:00Z',
            accuracyMeters: 5,
          },
        ],
        hasMore: true,
        nextAfter: 0,
      });
    await new Promise((r) => setTimeout(r, 0));
    http
      .expectOne((r) => r.url.endsWith('/points') && r.params.get('after') === '0')
      .flush({
        items: [
          {
            sequence: 1,
            latitude: 41,
            longitude: -74,
            observedAt: '2026-11-19T00:00:01Z',
            accuracyMeters: 5,
          },
        ],
        hasMore: false,
        nextAfter: 1,
      });
    const result = await promise;
    expect(result?.route.length).toBe(2);
    expect(result?.startLocation.latitude).toBe(40);
  });
  it('does not fabricate an estimate when a rate is missing or currencies differ', () => {
    service.getStatistics().subscribe((s) => {
      expect(s.totalDeductionAmount).toBeNull();
      expect(s.milesByPurpose.business).toBe(2);
    });
    http
      .expectOne((r) => r.url === `${base}/statistics`)
      .flush({
        milesByPurpose: [{ purpose: 'business', miles: 2 }],
        estimatedAmounts: [
          { currency: 'USD', amount: 1 },
          { currency: 'EUR', amount: 2 },
        ],
        tripsWithoutRate: 0,
      });
  });
  it('uses direct configuration and daily DTOs with no client owners', () => {
    service.getMileageConfiguration().subscribe((c) => expect(c.isConfigured).toBeFalse());
    http
      .expectOne(`${base}/mileage-configuration?purpose=business`)
      .flush({ isConfigured: false, mileageRate: null, currency: null });
    service.getMileSevenDays().subscribe((rows) => expect(rows.length).toBe(0));
    const daily = http.expectOne((r) => r.url === `${base}/statistics/daily`);
    expect(daily.request.method).toBe('GET');
    expect(daily.request.params.has('customerId')).toBeFalse();
    daily.flush([]);
  });
  it('propagates authorization failures instead of showing stale success', () => {
    service
      .getTrips()
      .subscribe({
        next: () => fail('Should not succeed'),
        error: (error) => expect(error.status).toBe(403),
      });
    http
      .expectOne((r) => r.url === `${base}/trips`)
      .flush({ code: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
  });
});
