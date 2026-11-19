import { MobileTripSyncService } from './mobile-trip-sync.service';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TrackingApiService } from './tracking-api.service';
import { CustomerTokenService } from './customer-token.service';
import { environment } from '../../environments/environment';
import { Vehicle } from '../models/interfaces';

describe('TrackingApiService vehicle contract', () => {
  let service: TrackingApiService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/mobile/vehicles`;
  const vehicle: Vehicle = { id: 'vehicle-1', plate: 'ABC', currentMileage: 0, isDefault: true, updatedAt: '2026-11-18T00:00:00Z' };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{provide:MobileTripSyncService,useValue:{}},provideHttpClient(), provideHttpClientTesting(), { provide: CustomerTokenService, useValue: {} }] });
    service = TestBed.inject(TrackingApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('creates a vehicle and sends only editable fields', () => {
    service.createVehicleProfile({ ...vehicle, customerId: 'spoof' } as Vehicle).subscribe(result => expect(result.id).toBe(vehicle.id));
    const request = http.expectOne(url);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.id).toBeUndefined();
    expect(request.request.body.customerId).toBeUndefined();
    request.flush(vehicle, { status: 201, statusText: 'Created' });
  });
  it('loads all pages and selects the default from a typed response', () => {
    service.getProfileVehicle().subscribe(result => expect(result?.id).toBe('default'));
    http.expectOne(`${url}?page=1&size=100`).flush({ items: [{ ...vehicle, isDefault: false }], page: 1, hasMore: true });
    http.expectOne(`${url}?page=2&size=100`).flush({ items: [{ ...vehicle, id: 'default' }], page: 2, hasMore: false });
  });
  it('returns null for an empty list', () => {
    service.getProfileVehicle().subscribe(result => expect(result).toBeNull());
    http.expectOne(`${url}?page=1&size=100`).flush({ items: [], page: 1, hasMore: false });
  });
  it('updates and deletes using the vehicle resource route', () => {
    service.updateVehicle('vehicle-1', vehicle).subscribe();
    const update = http.expectOne(`${url}/vehicle-1`);
    expect(update.request.method).toBe('PUT');
    update.flush(vehicle);
    service.deleteVehicle('vehicle-1').subscribe();
    const remove = http.expectOne(`${url}/vehicle-1`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
  });
});
