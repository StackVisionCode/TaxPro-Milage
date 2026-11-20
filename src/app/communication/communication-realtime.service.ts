import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, Observable, Subject, filter, map } from 'rxjs';
import type { Socket } from 'socket.io-client';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { environment } from '../../environments/environment';
import { CustomerTokenService } from '../services/customer-token.service';
import { CustomerSessionRefreshService } from '../services/customer-session-refresh.service';
import { accountKey } from './communication.model';
import { SocketAck, SocketEnvelope } from './realtime.model';

/** One authenticated socket for chat, calls, meetings and notifications, as in the CRM. */
@Injectable({ providedIn: 'root' })
export class CommunicationRealtimeService {
  private tokens = inject(CustomerTokenService);
  private refresh = inject(CustomerSessionRefreshService);
  private socket: Socket | null = null;
  private generation = 0;
  private opening = false;
  private owner: string | null = null;
  private seen = new Set<string>();
  private events = new Subject<{ event: string; payload: unknown }>();
  private reconnect = new Subject<void>();
  readonly reconnected$ = this.reconnect.asObservable();
  readonly connected = signal(false);
  readonly error = signal<string | null>(null);
  readonly serverOffsetMs = signal(0);
  readonly accountChanged$ = new Subject<void>();
  constructor() {
    this.tokens.token$.subscribe((token) => {
      const owner = accountKey(this.tokens.decodeToken());
      if (owner !== this.owner) {
        this.disconnect();
        this.owner = owner;
        this.accountChanged$.next();
      }
      if (!token) {
        this.disconnect();
        return;
      }
      if (this.socket?.connected)
        void this.refreshAuth(token).then((ack) => {
          if (!ack.ok) this.reopen();
        });
      else this.connect();
    });
    void App.addListener('appStateChange', (s) => {
      if (s.isActive) this.connect();
    });
    void Network.addListener('networkStatusChange', (s) => {
      if (s.connected) this.connect();
    });
    this.on<{ sessionId: string | null }>('session.revoked').subscribe((e) => {
      if (e.sessionId && e.sessionId === this.tokens.decodeToken()?.sid) this.tokens.removeTokens();
    });
    this.on('session.expiring').subscribe(() => void this.renew());
  }
  scope(): string {
    const key = accountKey(this.tokens.decodeToken());
    if (!key) throw new Error('Inicia sesion.');
    return key;
  }
  private async renew() {
    try {
      await firstValueFrom(this.refresh.refreshAccessToken());
    } catch {
      this.error.set('Renueva tu sesion para conectar.');
    }
  }
  connect(): void {
    if (this.opening || !this.tokens.token || this.socket?.connected || this.socket?.active) return;
    this.opening = true;
    const generation = ++this.generation;
    void import('socket.io-client')
      .then(({ io }) => {
        if (generation !== this.generation || !this.tokens.token) return;
        const socket = io(environment.apiUrl, {
          path: '/communication/socket.io',
          transports: ['websocket', 'polling'],
          auth: (done) => done({ token: this.tokens.token }),
          reconnection: true,
        });
        this.socket = socket;
        let once = false;
        socket.on('connect', () => {
          if (socket !== this.socket) return;
          this.connected.set(true);
          this.error.set(null);
          this.reconnect.next();
          once = true;
        });
        socket.on('disconnect', (reason) => {
          if (socket !== this.socket) return;
          this.connected.set(false);
          if (reason === 'io server disconnect') {
            this.dispose();
            void this.renew().then(() => this.connect());
          }
        });
        socket.on('connect_error', () => {
          this.error.set('No se pudo conectar a comunicacion.');
          if (!socket.active) {
            this.dispose();
            void this.renew().then(() => this.connect());
          }
        });
        socket.onAny((event: string, envelope: SocketEnvelope<unknown>) => {
          if (socket !== this.socket || accountKey(this.tokens.decodeToken()) !== this.owner)
            return;
          if (envelope?.eventId) {
            if (this.seen.has(envelope.eventId)) return;
            this.seen.add(envelope.eventId);
            if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value!);
          }
          const time = Date.parse(envelope?.emittedAtUtc);
          if (Number.isFinite(time)) this.serverOffsetMs.set(time - Date.now());
          this.events.next({ event, payload: envelope?.payload ?? envelope });
        });
      })
      .catch(() => this.error.set('No se pudo cargar comunicacion.'))
      .finally(() => {
        if (generation === this.generation) this.opening = false;
      });
  }
  private dispose() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }
  disconnect() {
    ++this.generation;
    this.opening = false;
    this.dispose();
    this.seen.clear();
  }
  private reopen() {
    this.disconnect();
    this.connect();
  }
  on<T>(event: string): Observable<T> {
    return this.events.pipe(
      filter((e) => e.event === event),
      map((e) => e.payload as T)
    );
  }
  async ready(): Promise<void> {
    const scope = this.scope();
    this.connect();
    const end = Date.now() + 12000;
    while (!this.connected() && Date.now() < end) {
      if (this.scope() !== scope) throw new Error('La cuenta cambio.');
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!this.connected()) throw new Error('Sin conexion con comunicacion.');
  }
  async emitAck<T>(event: string, payload: object): Promise<SocketAck<T>> {
    if (!this.socket?.connected)
      return { ok: false, code: 'Socket.NotConnected', message: 'Sin conexion con comunicacion.' };
    try {
      return (await this.socket.timeout(10000).emitWithAck(event, payload)) as SocketAck<T>;
    } catch {
      return {
        ok: false,
        code: 'Socket.Timeout',
        message: 'Sin confirmacion del servidor. Puedes reintentar.',
      };
    }
  }
  async command<T>(event: string, payload: object): Promise<T> {
    await this.ready();
    const scope = this.scope();
    const ack = await this.emitAck<T>(event, payload);
    if (this.scope() !== scope) throw new Error('La cuenta cambio.');
    if (!ack.ok) throw Object.assign(new Error(ack.message), { code: ack.code });
    return ack.value;
  }
  emitNoAck(event: string, payload: object) {
    if (this.socket?.connected) this.socket.emit(event, payload);
  }
  refreshAuth(token: string) {
    return this.emitAck('auth.refresh', { token });
  }
  newClientKey() {
    return crypto.randomUUID();
  }
}
