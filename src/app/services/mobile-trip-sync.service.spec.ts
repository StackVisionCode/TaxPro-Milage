import { MobileTrackingPlatform } from './mobile-tracking-platform.service';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { MobileTripSyncService } from './mobile-trip-sync.service';
import { CustomerTokenService } from './customer-token.service';
import { TrackingState } from '../models/interfaces';
import { MobileTrip } from '../models/mobile-api';

describe('Mobile durable tracking journal', () => {
  let service: MobileTripSyncService;
  let http: Record<'post' | 'put' | 'patch' | 'delete', jasmine.Spy>;
  let store: Map<string, string>;
  let account: string;
  let platform: Record<'read' | 'write' | 'onReconnect' | 'onResume', jasmine.Spy>;
  const state = (): TrackingState => ({
    tripId: 'local-uuid',
    vehicleId: 'vehicle-uuid',
    purpose: 'business',
    isTracking: true,
    isPaused: false,
    routePoints: [{ latitude: 40, longitude: -74, timestamp: Date.now() - 10000, accuracy: 5 }],
    startTime: Date.now() - 10000,
    elapsedTime: 10,
    currentDistance: 1,
    currentSpeed: 0,
  });
  const ack = (body: any): MobileTrip => ({
    id: 'server-uuid',
    clientTripId: 'local-uuid',
    vehicleId: 'vehicle-uuid',
    vehiclePlate: 'ABC',
    status: 'InProgress',
    purpose: 'business',
    startTime: body.startedAt ?? new Date().toISOString(),
    revision: 1,
    lastAcceptedPointSequence: 0,
    distanceMeters: 0,
    distanceMiles: 0,
    distanceKm: 0,
    durationSeconds: 0,
    averageSpeedMph: 0,
    maxSpeedMph: 0,
    ratePerMile: null,
    currency: null,
    estimatedAmount: null,
    createdAt: '',
    updatedAt: '',
    replayed: false,
  });
  const offline = () =>
    throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' }));
  const journal = () => JSON.parse([...store.values()][0]);
  beforeEach(() => {
    account = 'customer-a';
    store = new Map();
    platform = jasmine.createSpyObj('platform', ['read', 'write', 'onReconnect', 'onResume']);
    platform.read.and.callFake(async (key: string) => store.get(key) ?? null);
    platform.write.and.callFake(async (key: string, value: string) => {
      store.set(key, value);
    });
    platform.onReconnect.and.resolveTo({ remove: async () => undefined });
    platform.onResume.and.resolveTo({ remove: async () => undefined });
    http = jasmine.createSpyObj('HttpClient', ['post', 'put', 'patch', 'delete']);
    http.post.and.callFake(offline);
    http.put.and.callFake(offline);
    TestBed.configureTestingModule({
      providers: [
        { provide: MobileTrackingPlatform, useValue: platform },
        { provide: HttpClient, useValue: http },
        {
          provide: CustomerTokenService,
          useValue: {
            token$: new BehaviorSubject(null),
            decodeToken: () => ({
              tenant_id: 'office-a',
              customer_id: account,
              sub: account,
              actor_type: 'CustomerPortal',
            }),
          },
        },
      ],
    });
    service = TestBed.inject(MobileTripSyncService);
  });
  async function failedFlush() {
    try {
      await service.flush();
    } catch {
      /* expected offline */
    }
  }
  it('persists a start before HTTP and sends no client-supplied owner', async () => {
    await service.record(state());
    await failedFlush();
    const trip = journal().trips['local-uuid'];
    expect(trip.operations.length).toBe(1);
    const body = trip.operations[0].body;
    expect(body.vehicleId).toBe('vehicle-uuid');
    expect(body.customerId).toBeUndefined();
    expect(body.tenantId).toBeUndefined();
    expect(body.startPoint.sequence).toBe(0);
    expect(body.startedAt).toBe(body.startPoint.observedAt);
    expect([...store.keys()][0]).toBe('mobile_sync_v1:office-a:customer-a:customer-a');
  });
  it('retries the exact start payload after an uncertain failure and records the server ID', async () => {
    await service.record(state());
    await failedFlush();
    const first = JSON.stringify(http.post.calls.first().args[1]);
    http.post.and.callFake((_url: string, body: any) => of(ack(body)));
    await service.flush();
    expect(JSON.stringify(http.post.calls.mostRecent().args[1])).toBe(first);
    expect(journal().trips['local-uuid'].serverId).toBe('server-uuid');
    expect(service.pendingCount$.value).toBe(0);
  });
  it('chunks only new GPS samples and assigns contiguous point and operation sequences', async () => {
    const s = state();
    const time = s.routePoints[0].timestamp;
    s.routePoints = Array.from({ length: 600 }, (_, i) => ({
      latitude: 40,
      longitude: -74,
      timestamp: time + i,
      accuracy: 5,
    }));
    await service.record(s);
    await failedFlush();
    const ops = journal().trips['local-uuid'].operations;
    expect(ops.map((x: any) => x.kind)).toEqual(['start', 'tracking', 'tracking', 'tracking']);
    expect(ops.slice(1).map((x: any) => x.body.points.length)).toEqual([256, 256, 87]);
    expect(ops[1].body.sequence).toBe(2);
    expect(ops[3].body.sequence).toBe(4);
    expect(ops[3].body.points[86].sequence).toBe(599);
    await service.record(s);
    await failedFlush();
    expect(journal().trips['local-uuid'].operations.length).toBe(4);
  });
  it('keeps pause/resume/completion ordered and never reopens a terminal trip', async () => {
    const s = state();
    await service.record(s, 'pause');
    await service.record(s, 'resume');
    await service.record(s, 'complete');
    await failedFlush();
    expect(journal().trips['local-uuid'].operations.map((x: any) => x.kind)).toEqual([
      'start',
      'pause',
      'resume',
      'complete',
    ]);
    expect(journal().trips['local-uuid'].operations[3].body.points).toEqual([]);
    await service.record(s, 'resume');
    expect(journal().trips['local-uuid'].operations.length).toBe(4);
    expect((await service.pendingTrips())[0].syncState).toBe('pending');
  });
  it('does not send another account pending operations', async () => {
    await service.record(state());
    await failedFlush();
    http.post.calls.reset();
    account = 'customer-b';
    await service.flush();
    expect(http.post).not.toHaveBeenCalled();
    expect(await service.pendingTrips()).toEqual([]);
    expect(store.size).toBe(2);
  });
  it('rejects a recording when durable storage fails without issuing HTTP', async () => {
    platform.write.and.rejectWith(new Error('Disk full'));
    await expectAsync(service.record(state())).toBeRejectedWithError('Disk full');
    expect(http.post).not.toHaveBeenCalled();
  });
  it('keeps the original operation if persisting its acknowledgement fails', async () => {
    let rejectAck = true;
    http.post.and.callFake((_url: string, body: any) => {
      platform.write.and.callFake(async (key: string, value: string) => {
        if (rejectAck && JSON.parse(value).trips['local-uuid'].operations.length === 0)
          throw new Error('Disk full');
        store.set(key, value);
      });
      return of(ack(body));
    });
    await service.record(state());
    await failedFlush();
    expect(journal().trips['local-uuid'].operations.length).toBe(1);
    const original = JSON.stringify(http.post.calls.first().args[1]);
    rejectAck = false;
    await service.flush();
    expect(JSON.stringify(http.post.calls.mostRecent().args[1])).toBe(original);
    expect(service.pendingCount$.value).toBe(0);
  });
});
