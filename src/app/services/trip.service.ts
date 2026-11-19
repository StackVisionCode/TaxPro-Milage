import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { BehaviorSubject, EMPTY, Observable, defer, firstValueFrom, from, throwError } from 'rxjs';
import { expand, finalize, map, reduce, switchMap, tap, catchError } from 'rxjs/operators';
import { MobileTrackingPlatform } from './mobile-tracking-platform.service';
import { environment } from '../../environments/environment';
import {
  Trip,
  TripFilters,
  TrackingState,
  UserStatistics,
  DailyMileage,
  TripProfileData,
  IIRSConfiguration,
  TripPurpose,
} from '../models/interfaces';
import {
  MobileTrip,
  MobilePage,
  MobileStatistics,
  PointPage,
  MileageConfiguration,
  gpsPoint,
  tripModel,
} from '../models/mobile-api';
import { MobileTripSyncService } from './mobile-trip-sync.service';
import { CustomerTokenService } from './customer-token.service';

@Injectable({ providedIn: 'root' })
export class TripService {
  private http = inject(HttpClient);
  private sync = inject(MobileTripSyncService);
  private platform = inject(MobileTrackingPlatform);
  private tokens = inject(CustomerTokenService);
  private readonly url = `${environment.apiUrl}/mobile/trips`;
  private tripsCache = new BehaviorSubject<Trip[]>([]);
  readonly trips$ = this.tripsCache.asObservable();
  private statisticsSubject = new BehaviorSubject<UserStatistics | null>(null);
  readonly statistics$ = this.statisticsSubject.asObservable();
  private loadingSubject = new BehaviorSubject(false);
  readonly loading$ = this.loadingSubject.asObservable();
  constructor() {
    this.tokens.token$.subscribe(() => this.clearCache());
    this.sync.acknowledged$.subscribe((dto) => {
      const old = this.tripsCache.value.find((t) => t.id === dto.id || t.id === dto.clientTripId);
      this.upsert(tripModel(dto, old?.route));
    });
  }
  private params(filters: TripFilters, page: number): HttpParams {
    const values: Record<string, string> = {
      page: String(page),
      size: String(filters.limit ?? 100),
      sortBy: filters.sortBy ?? 'date',
      sortOrder: filters.sortOrder ?? 'desc',
    };
    for (const key of ['startDate', 'endDate', 'purpose', 'status'] as const)
      if (filters[key]) values[key] = filters[key]!;
    if (filters.minDistance !== undefined) values['minDistanceMiles'] = String(filters.minDistance);
    if (filters.maxDistance !== undefined) values['maxDistanceMiles'] = String(filters.maxDistance);
    return new HttpParams({ fromObject: values });
  }
  getTrips(filters: TripFilters = {}): Observable<Trip[]> {
    return defer(() => {
      const scope = this.sync.scope();
      this.loadingSubject.next(true);
      const page = (number: number) =>
        this.http.get<MobilePage<MobileTrip>>(this.url, { params: this.params(filters, number) });
      return page(filters.page ?? 1).pipe(
        expand((result) => (!filters.page && result.hasMore ? page(result.page + 1) : EMPTY)),
        reduce((all, result) => [...all, ...result.items], [] as MobileTrip[]),
        switchMap(async (rows) => {
          const pending = await this.sync.pendingTrips();
          const models = rows.map((t) => tripModel(t));
          const merged = [
            ...pending,
            ...models.filter((t) => !pending.some((p) => p.clientTripId === t.clientTripId)),
          ].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
          if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante la consulta.');
          if (!filters.page)
            await this.platform.write(`mobile_cache_v1:${scope}`, JSON.stringify(merged));
          return merged;
        }),
        catchError((error) => {
          if (!(error instanceof HttpErrorResponse) || error.status !== 0)
            return throwError(() => error);
          return from(this.offlineTrips(scope));
        }),
        tap((rows) => {
          if (this.sync.scope() === scope) this.tripsCache.next(rows);
        }),
        finalize(() => this.loadingSubject.next(false))
      );
    });
  }
  getTripById(id: string): Observable<Trip | null> {
    return defer(async () => {
      const scope = this.sync.scope();
      const pending = (await this.sync.pendingTrips()).find(
        (t) => t.id === id || t.clientTripId === id
      );
      if (pending) return pending;
      const dto = await firstValueFrom(
        this.http.get<MobileTrip>(`${this.url}/${encodeURIComponent(id)}`)
      );
      const route = [];
      let after = -1,
        hasMore = true;
      while (hasMore) {
        const page = await firstValueFrom(
          this.http.get<PointPage>(`${this.url}/${encodeURIComponent(id)}/points`, {
            params: { after, size: 512 },
          })
        );
        route.push(...page.items.map(gpsPoint));
        hasMore = page.hasMore;
        if (hasMore && page.nextAfter <= after) throw new Error('El cursor de la ruta no avanzo.');
        after = page.nextAfter;
      }
      if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante la consulta.');
      const trip = tripModel(dto, route);
      this.upsert(trip);
      return trip;
    });
  }
  getTripsByDateRange(startDate: string, endDate: string): Observable<Trip[]> {
    return this.getTrips({ startDate, endDate });
  }
  updateTrip(id: string, changes: Partial<Trip>): Observable<Trip> {
    return defer(async () => {
      const scope = this.sync.scope();
      await this.sync.flush();
      const current = await firstValueFrom(
        this.http.get<MobileTrip>(`${this.url}/${encodeURIComponent(id)}`)
      );
      if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante la edicion.');
      const dto = await this.sync.mutate(current, 'edit', {
        purpose: changes.purpose ?? current.purpose,
        notes: changes.notes ?? current.notes ?? null,
      });
      if (!dto) throw new Error('No se confirmo el cambio.');
      if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante la edicion.');
      const trip = tripModel(dto, this.tripsCache.value.find((t) => t.id === id)?.route);
      this.upsert(trip);
      return trip;
    });
  }
  deleteTrip(id: string): Observable<boolean> {
    return defer(async () => {
      const scope = this.sync.scope();
      await this.sync.flush();
      const current = await firstValueFrom(
        this.http.get<MobileTrip>(`${this.url}/${encodeURIComponent(id)}`)
      );
      if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante el borrado.');
      await this.sync.mutate(current, 'delete');
      if (this.sync.scope() !== scope) return true;
      this.tripsCache.next(this.tripsCache.value.filter((t) => t.id !== id));
      return true;
    });
  }
  async finishTracking(state: TrackingState): Promise<Trip> {
    const scope = this.sync.scope();
    await this.sync.record(structuredClone(state), 'complete');
    if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante el guardado.');
    const dto = await this.sync.latest(state.tripId!);
    // A previous InProgress acknowledgement cannot be shown as a confirmed completion.
    const trip: Trip =
      dto?.status === 'Completed'
        ? tripModel(dto, state.routePoints)
        : {
            id: state.tripId!,
            clientTripId: state.tripId,
            vehicleId: state.vehicleId,
            startTime: new Date(state.startTime!).toISOString(),
            endTime: new Date().toISOString(),
            status: 'Completed',
            purpose: state.purpose ?? 'business',
            route: state.routePoints,
            startLocation: state.routePoints[0],
            endLocation: state.routePoints[state.routePoints.length - 1],
            distanceMiles: state.currentDistance,
            distanceKm: state.currentDistance * 1.609344,
            durationSeconds: state.elapsedTime,
            createdAt: new Date(state.startTime!).toISOString(),
            updatedAt: new Date().toISOString(),
            estimatedAmount: null,
            syncState: 'pending',
          };
    if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante el guardado.');
    this.upsert(trip);
    return trip;
  }
  getMileageConfiguration(purpose: TripPurpose = 'business'): Observable<MileageConfiguration> {
    return this.http.get<MileageConfiguration>(
      `${environment.apiUrl}/mobile/mileage-configuration`,
      { params: { purpose } }
    );
  }
  getIRSConfiguration(_payload?: TripProfileData): Observable<IIRSConfiguration> {
    return this.getMileageConfiguration().pipe(
      map((c) => ({
        id: c.rateId ?? '',
        companyId: '',
        customerId: null,
        taxUserId: '',
        name: 'Tarifa de la oficina',
        currency: c.currency,
        mileageRate: c.mileageRate,
        distanceUnit: c.distanceUnit,
        isActive: c.isConfigured,
        isAll: true,
      }))
    );
  }
  getStatistics(): Observable<UserStatistics> {
    return defer(() => {
      const scope = this.sync.scope();
      return this.http
        .get<MobileStatistics>(`${environment.apiUrl}/mobile/statistics`, {
          params: { timeZone: this.timeZone() },
        })
        .pipe(
          map((dto) => ({
            ...dto,
            totalDeductionAmount:
              dto.tripsWithoutRate === 0 &&
              dto.estimatedAmounts.every((x) => x.currency === environment.app.currency)
                ? dto.estimatedAmounts.reduce((n, x) => n + x.amount, 0)
                : null,
            averageTripsPerWeek: 0,
            milesByPurpose: Object.assign(
              { business: 0, medical: 0, moving: 0, personal: 0, charity: 0 },
              ...dto.milesByPurpose.map((x) => ({ [x.purpose]: x.miles }))
            ),
          })),
          tap((stats) => {
            if (this.sync.scope() !== scope)
              throw new Error('La cuenta cambio durante la consulta.');
            this.statisticsSubject.next(stats);
          })
        );
    });
  }
  getMileSevenDays(_payload?: TripProfileData): Observable<DailyMileage[]> {
    return this.http.get<DailyMileage[]>(`${environment.apiUrl}/mobile/statistics/daily`, {
      params: { days: 7, timeZone: this.timeZone() },
    });
  }
  refreshStatistics(): void {
    this.getStatistics().subscribe({ error: () => undefined });
  }
  async getStatisticsFromCache(): Promise<UserStatistics> {
    if (this.statisticsSubject.value) return this.statisticsSubject.value;
    return firstValueFrom(this.getStatistics());
  }
  async monthlyEstimate(): Promise<number | null> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const trips = await firstValueFrom(
      this.getTrips({
        startDate: start.toISOString(),
        endDate: now.toISOString(),
        status: 'Completed',
      })
    );
    if (trips.some((t) => t.estimatedAmount == null || t.currency !== environment.app.currency))
      return null;
    return trips.reduce((n, t) => n + (t.estimatedAmount ?? 0), 0);
  }
  getRecentTrips(): Trip[] {
    return this.tripsCache.value.slice(0, 10);
  }
  getCurrentStatistics(): UserStatistics | null {
    return this.statisticsSubject.value;
  }
  async syncPendingTrips(): Promise<void> {
    await this.sync.flush();
  }
  private timeZone(): string {
    return (
      this.tokens.decodeToken()?.zoneinfo ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'Etc/UTC'
    );
  }
  private async offlineTrips(scope: string): Promise<Trip[]> {
    if (this.sync.scope() !== scope) throw new Error('La cuenta cambio durante la consulta.');
    const value = await this.platform.read(`mobile_cache_v1:${scope}`);
    const cached: Trip[] = value ? JSON.parse(value) : [];
    const pending = await this.sync.pendingTrips();
    return [
      ...pending,
      ...cached.filter((t) => !pending.some((p) => p.clientTripId === t.clientTripId)),
    ];
  }
  private upsert(trip: Trip): void {
    this.tripsCache.next([
      trip,
      ...this.tripsCache.value.filter(
        (t) => t.id !== trip.id && t.clientTripId !== trip.clientTripId
      ),
    ]);
  }
  clearCache(): void {
    this.tripsCache.next([]);
    this.statisticsSubject.next(null);
    this.loadingSubject.next(false);
  }
}
