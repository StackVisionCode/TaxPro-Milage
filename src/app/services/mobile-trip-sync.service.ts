import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { MobileTrackingPlatform } from './mobile-tracking-platform.service';
import { environment } from '../../environments/environment';
import { CustomerTokenService } from './customer-token.service';
import { GpsPoint, TrackingState, TripStatus, Trip } from '../models/interfaces';
import { MobilePoint, MobileTrip } from '../models/mobile-api';

type Action = 'tracking' | 'pause' | 'resume' | 'complete' | 'cancel';
interface Operation {
  kind: 'start' | Action | 'edit' | 'delete';
  body: Record<string, unknown>;
}
interface JournalTrip {
  clientTripId: string;
  serverId?: string;
  vehicleId: string;
  revision: number;
  pointSequence: number;
  routeCount: number;
  observedAt: number;
  status: TripStatus;
  operations: Operation[];
  ack?: MobileTrip;
  local?: Trip;
}
interface Journal {
  version: 1;
  trips: Record<string, JournalTrip>;
}

/** Durable per-account journal. HTTP acknowledgements are persisted before an operation is removed. */
@Injectable({ providedIn: 'root' })
export class MobileTripSyncService {
  private http = inject(HttpClient);
  private tokens = inject(CustomerTokenService);
  private platform = inject(MobileTrackingPlatform);
  private mutex: Promise<unknown> = Promise.resolve();
  private flights = new Map<string, Promise<void>>();
  readonly acknowledged$ = new Subject<MobileTrip>();
  readonly pendingCount$ = new BehaviorSubject(0);
  readonly error$ = new BehaviorSubject<string | null>(null);
  private readonly url = `${environment.apiUrl}/mobile/trips`;

  constructor() {
    this.tokens.token$.subscribe((token) => {
      if (token) this.schedule();
      else this.pendingCount$.next(0);
    });
    void this.platform.onReconnect(() => this.schedule());
    void this.platform.onResume(() => this.schedule());
  }

  scope(): string {
    const c = this.tokens.decodeToken();
    if (!c?.tenant_id || !c.customer_id || !c.sub || c.actor_type !== 'CustomerPortal')
      throw new Error('Inicia sesion con una cuenta de cliente para sincronizar recorridos.');
    return `${c.tenant_id}:${c.customer_id}:${c.sub}`;
  }
  trackingKey(): string {
    return `mobile_tracking_v1:${this.scope()}`;
  }
  private key(scope: string): string {
    return `mobile_sync_v1:${scope}`;
  }
  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const next = this.mutex.then(job, job);
    this.mutex = next.catch(() => undefined);
    return next;
  }
  private async read(scope: string): Promise<Journal> {
    const value = await this.platform.read(this.key(scope));
    if (!value) return { version: 1, trips: {} };
    const journal = JSON.parse(value) as Journal;
    if (journal.version !== 1 || !journal.trips)
      throw new Error('No se puede leer la cola de recorridos.');
    return journal;
  }
  private async save(scope: string, journal: Journal): Promise<void> {
    await this.platform.write(this.key(scope), JSON.stringify(journal));
    if (this.sameAccount(scope))
      this.pendingCount$.next(
        Object.values(journal.trips).reduce((n, t) => n + t.operations.length, 0)
      );
  }
  private sameAccount(scope: string): boolean {
    try {
      return this.scope() === scope;
    } catch {
      return false;
    }
  }
  private schedule(): void {
    void this.flush().catch((error) =>
      this.error$.next(error?.error?.message ?? error?.message ?? 'Sincronizacion pendiente.')
    );
  }
  private point(p: GpsPoint, sequence: number): MobilePoint {
    return {
      sequence,
      observedAt: new Date(p.timestamp).toISOString(),
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyMeters: p.accuracy ?? 0,
      speedMetersPerSecond: p.speed !== undefined && p.speed >= 0 ? p.speed : undefined,
      altitudeMeters: p.altitude,
      heading: p.heading !== undefined && p.heading >= 0 ? p.heading : undefined,
    };
  }

  /** Resolves once the immutable request is durable; being offline does not erase the trip. */
  async record(state: TrackingState, action: Action = 'tracking'): Promise<void> {
    const scope = this.scope();
    await this.exclusive(async () => {
      if (!this.sameAccount(scope)) throw new Error('La cuenta cambio durante el guardado.');
      const journal = await this.read(scope);
      if (!state.tripId || !state.vehicleId || !state.routePoints.length)
        throw new Error('El recorrido necesita un vehiculo y un punto inicial.');
      let trip = journal.trips[state.tripId];
      if (!trip) {
        const first = state.routePoints[0];
        trip = {
          clientTripId: state.tripId,
          vehicleId: state.vehicleId,
          revision: 1,
          pointSequence: 0,
          routeCount: 1,
          observedAt: first.timestamp,
          status: 'InProgress',
          operations: [
            {
              kind: 'start',
              body: {
                clientTripId: state.tripId,
                vehicleId: state.vehicleId,
                purpose: state.purpose ?? 'business',
                startedAt: new Date(first.timestamp).toISOString(),
                startPoint: this.point(first, 0),
              },
            },
          ],
        };
        journal.trips[state.tripId] = trip;
      }
      if (trip.status === 'Completed' || trip.status === 'Cancelled') return;
      if (trip.status === 'InProgress') {
        let lastTime = trip.observedAt;
        const fresh = state.routePoints.slice(trip.routeCount).filter((p) => {
          if (p.timestamp < lastTime) return false;
          lastTime = p.timestamp;
          return true;
        });
        for (let offset = 0; offset < fresh.length; offset += 256) {
          const points = fresh
            .slice(offset, offset + 256)
            .map((p) => this.point(p, ++trip.pointSequence));
          trip.observedAt = Date.parse(points[points.length - 1].observedAt);
          trip.operations.push({
            kind: 'tracking',
            body: {
              sequence: ++trip.revision,
              observedAt: new Date(trip.observedAt).toISOString(),
              points,
            },
          });
        }
      }
      trip.routeCount = state.routePoints.length;
      if (action !== 'tracking') {
        if (
          (action === 'pause' && trip.status === 'Paused') ||
          (action === 'resume' && trip.status === 'InProgress')
        ) {
          await this.save(scope, journal);
          return;
        }
        trip.observedAt = Math.max(Date.now(), trip.observedAt);
        const body: Record<string, unknown> = {
          sequence: ++trip.revision,
          observedAt: new Date(trip.observedAt).toISOString(),
        };
        if (action === 'complete') body['points'] = [];
        trip.operations.push({ kind: action, body });
        trip.status =
          action === 'pause'
            ? 'Paused'
            : action === 'resume'
            ? 'InProgress'
            : action === 'complete'
            ? 'Completed'
            : 'Cancelled';
      }
      if (action === 'complete')
        trip.local = {
          id: trip.serverId ?? state.tripId,
          clientTripId: state.tripId,
          vehicleId: state.vehicleId,
          status: 'Completed',
          purpose: state.purpose ?? 'business',
          route: state.routePoints,
          startLocation: state.routePoints[0],
          endLocation: state.routePoints[state.routePoints.length - 1],
          startTime: new Date(state.startTime!).toISOString(),
          endTime: new Date(trip.observedAt).toISOString(),
          distanceMiles: state.currentDistance,
          distanceKm: state.currentDistance * 1.609344,
          durationSeconds: state.elapsedTime,
          createdAt: new Date(state.startTime!).toISOString(),
          updatedAt: new Date().toISOString(),
          estimatedAmount: null,
          syncState: 'pending',
        };
      await this.save(scope, journal);
    });
    this.schedule();
  }

  /** Editing/deleting also keeps a stable sequence and timestamp across uncertain HTTP failures. */
  async mutate(
    dto: MobileTrip,
    kind: 'edit' | 'delete',
    fields: Record<string, unknown> = {}
  ): Promise<MobileTrip | undefined> {
    const scope = this.scope();
    await this.exclusive(async () => {
      const journal = await this.read(scope);
      let trip = journal.trips[dto.clientTripId];
      if (!trip)
        trip = journal.trips[dto.clientTripId] = {
          clientTripId: dto.clientTripId,
          serverId: dto.id,
          vehicleId: dto.vehicleId,
          revision: dto.revision,
          pointSequence: dto.lastAcceptedPointSequence,
          routeCount: 0,
          observedAt: Date.parse(dto.updatedAt),
          status: dto.status,
          operations: [],
          ack: dto,
        };
      if (trip.operations.length)
        throw new Error('Sincroniza los cambios pendientes antes de editar.');
      trip.revision = dto.revision;
      trip.operations.push({
        kind,
        body: { ...fields, sequence: ++trip.revision, observedAt: new Date().toISOString() },
      });
      await this.save(scope, journal);
    });
    await this.flush();
    return this.latest(dto.clientTripId);
  }
  async latest(clientTripId: string): Promise<MobileTrip | undefined> {
    const scope = this.scope();
    return this.exclusive(async () => (await this.read(scope)).trips[clientTripId]?.ack);
  }
  async pendingTrips(): Promise<Trip[]> {
    const scope = this.scope();
    return this.exclusive(async () =>
      Object.values((await this.read(scope)).trips)
        .filter((t) => t.operations.length > 0 && t.local)
        .map((t) => t.local!)
    );
  }
  async plannedStatus(clientTripId: string): Promise<TripStatus | undefined> {
    const scope = this.scope();
    return this.exclusive(async () => (await this.read(scope)).trips[clientTripId]?.status);
  }
  flush(): Promise<void> {
    let scope: string;
    try {
      scope = this.scope();
    } catch {
      return Promise.resolve();
    }
    const existing = this.flights.get(scope);
    if (existing) return existing;
    const flight = this.drain(scope).finally(() => this.flights.delete(scope));
    this.flights.set(scope, flight);
    return flight;
  }
  private async drain(scope: string): Promise<void> {
    while (this.sameAccount(scope)) {
      const next = await this.exclusive(async () => {
        const journal = await this.read(scope);
        const trip = Object.values(journal.trips).find((t) => t.operations.length);
        await this.save(scope, journal);
        return trip
          ? { trip: structuredClone(trip), op: structuredClone(trip.operations[0]) }
          : null;
      });
      if (!next) {
        this.error$.next(null);
        return;
      }
      if (!this.sameAccount(scope)) return;
      const { trip, op } = next;
      let response: MobileTrip | undefined;
      const path = `${this.url}/${encodeURIComponent(trip.serverId ?? '')}`;
      if (op.kind === 'start')
        response = await firstValueFrom(this.http.post<MobileTrip>(this.url, op.body));
      else {
        if (!trip.serverId) throw new Error('El servidor no confirmo el inicio del recorrido.');
        if (op.kind === 'delete')
          await firstValueFrom(
            this.http.delete<void>(path, {
              params: {
                sequence: String(op.body['sequence']),
                observedAt: String(op.body['observedAt']),
              },
            })
          );
        else if (op.kind === 'edit')
          response = await firstValueFrom(this.http.patch<MobileTrip>(path, op.body));
        else if (op.kind === 'tracking')
          response = await firstValueFrom(this.http.put<MobileTrip>(`${path}/tracking`, op.body));
        else
          response = await firstValueFrom(
            this.http.post<MobileTrip>(`${path}/${op.kind}`, op.body)
          );
      }
      // Even if logout happened during HTTP, acknowledge only the original account's journal.
      await this.exclusive(async () => {
        const journal = await this.read(scope);
        const current = journal.trips[trip.clientTripId];
        if (JSON.stringify(current.operations[0]) !== JSON.stringify(op))
          throw new Error('La cola cambio inesperadamente.');
        if (response) {
          current.serverId = response.id;
          current.ack = response;
        }
        current.operations.shift();
        if (current.operations.length === 0) delete current.local;
        if (op.kind === 'delete') delete journal.trips[trip.clientTripId];
        await this.save(scope, journal);
      });
      if (response && this.sameAccount(scope)) this.acknowledged$.next(response);
    }
  }
}
