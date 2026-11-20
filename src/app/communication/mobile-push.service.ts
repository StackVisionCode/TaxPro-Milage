import { Preferences } from '@capacitor/preferences';
import { MobileSessionService } from './mobile-session.service';
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { environment } from '../../environments/environment';
import { CustomerTokenService } from '../services/customer-token.service';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { AppNotice, ChatMessage, IncomingCall, accountKey } from './communication.model';

@Injectable({ providedIn: 'root' })
export class MobilePushService {
  private calls = inject(MobileSessionService);
  private http = inject(HttpClient);
  private tokens = inject(CustomerTokenService);
  private realtime = inject(CommunicationRealtimeService);
  private router = inject(Router);
  readonly statusText = signal('Avisos en la app disponibles. Push de Android necesita Firebase.');
  private generation = 0;
  private localBound = false;
  private registration: { id: string; scope: string } | null = null;
  private bound = false;
  private localId = 1000;
  private owner: string | null = null;
  constructor() {
    this.tokens.token$.subscribe(() => {
      const scope = accountKey(this.tokens.decodeToken());
      if (scope !== this.owner) {
        this.owner = scope;
        this.registration = null;
        ++this.generation;
      }
    });
    this.realtime
      .on<IncomingCall>('call.incoming')
      .subscribe(
        (c) =>
          void this.local(
            'Llamada entrante',
            c.kind === 'Video' ? 'Videollamada de tu oficina' : 'Llamada de tu oficina',
            { section: 'calls', callId: c.callId }
          )
      );
    this.realtime.on<ChatMessage>('chat.message.new').subscribe((m) => {
      if (m.senderId !== this.tokens.decodeToken()?.sub)
        void this.local('Nuevo mensaje', 'Tienes un mensaje de tu oficina.', {
          section: 'chat',
          conversationId: m.conversationId,
        });
    });
    this.realtime
      .on<AppNotice>('notification.received')
      .subscribe(
        (n) => void this.local(n.title, n.body, { section: 'notifications', notificationId: n.id })
      );
  }
  async enable() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      this.statusText.set(
        'Las notificaciones push de esta entrega se activan desde la app Android.'
      );
      return;
    }
    await LocalNotifications.requestPermissions();
    await LocalNotifications.createChannel({
      id: 'taxvision-communication',
      name: 'Mensajes y llamadas',
      importance: 5,
      visibility: 0,
      sound: 'default',
    });
    if (!this.localBound) {
      this.localBound = true;
      await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (action) => void this.open(action.notification.extra as Record<string, unknown>)
      );
    }
    if (!environment.communication.androidPushConfigured) {
      this.statusText.set(
        'Falta conectar Firebase: añade google-services.json de com.taxoffix.mileage y configura FCM en el servidor.'
      );
      return;
    }
    await this.bind();
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      this.statusText.set(
        'Permiso de notificaciones denegado. Puedes cambiarlo en Ajustes de Android.'
      );
      return;
    }
    await LocalNotifications.requestPermissions();
    await PushNotifications.register();
    this.statusText.set('Registrando dispositivo…');
  }
  private async bind() {
    if (this.bound) return;
    this.bound = true;
    await PushNotifications.createChannel({
      id: 'taxvision-communication',
      name: 'Mensajes y llamadas',
      importance: 5,
      visibility: 0,
      sound: 'default',
    });
    await PushNotifications.addListener('registration', (token) => {
      const scope = accountKey(this.tokens.decodeToken());
      const generation = this.generation;
      if (!scope) return;
      void firstValueFrom(
        this.http.post<{ id: string }>(environment.apiUrl + '/notifications/push/devices', {
          platform: 'Fcm',
          token: token.value,
          deviceId: this.deviceId(),
        })
      )
        .then((r) => {
          if (accountKey(this.tokens.decodeToken()) === scope && generation === this.generation) {
            this.registration = { id: r.id, scope };
            void Preferences.set({
              key: 'communication_push_registration:' + scope,
              value: JSON.stringify(this.registration),
            });
            this.statusText.set('Notificaciones push activadas.');
          }
        })
        .catch(() =>
          this.statusText.set('No se pudo registrar el dispositivo. Reintenta con conexion.')
        );
    });
    await PushNotifications.addListener('registrationError', () =>
      this.statusText.set('No se pudo registrar con Firebase. Comprueba la configuracion Android.')
    );
    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => void this.open(action.notification.data as Record<string, unknown>)
    );
    if (!this.localBound) {
      this.localBound = true;
      await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (action) => void this.open(action.notification.extra as Record<string, unknown>)
      );
    }
  }
  private deviceId() {
    const key = 'taxpro_push_device';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  }
  private async local(title: string, body: string, data: Record<string, string>) {
    if (!Capacitor.isNativePlatform()) return;
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: ++this.localId,
          title,
          body,
          channelId: 'taxvision-communication',
          extra: { ...data, account: this.realtime.scope() },
        },
      ],
    }).catch(() => undefined);
  }
  private async open(data: Record<string, unknown>) {
    if (!this.tokens.token) return;
    const scope = accountKey(this.tokens.decodeToken());
    if (data['account'] && data['account'] !== scope) return;
    const claims = this.tokens.decodeToken();
    if (data['tenantId'] && data['tenantId'] !== claims?.tenant_id) return;
    if (data['recipientUserId'] && data['recipientUserId'] !== claims?.sub) return;
    const section =
      typeof data['section'] === 'string' &&
      ['chat', 'calls', 'meetings', 'notifications'].includes(data['section'])
        ? data['section']
        : 'notifications';
    const meetingId =
      typeof data['meetingId'] === 'string' && /^[0-9a-f-]{36}$/i.test(data['meetingId'])
        ? data['meetingId']
        : undefined;
    if (typeof data['callId'] === 'string' && /^[0-9a-f-]{36}$/i.test(data['callId']))
      await this.calls.recoverIncoming(data['callId']).catch(() => undefined);
    await this.router.navigate(['/communication'], {
      queryParams: { section, ...(meetingId ? { meetingId } : {}) },
    });
  }
  async revoke() {
    ++this.generation;
    const scope = accountKey(this.tokens.decodeToken());
    const stored = scope
      ? (await Preferences.get({ key: 'communication_push_registration:' + scope })).value
      : null;
    const registration =
      this.registration ?? (stored ? (JSON.parse(stored) as { id: string; scope: string }) : null);
    if (registration && accountKey(this.tokens.decodeToken()) === registration.scope)
      await firstValueFrom(
        this.http.delete<void>(
          environment.apiUrl + '/notifications/push/devices/' + encodeURIComponent(registration.id)
        )
      );
    if (Capacitor.isNativePlatform() && environment.communication.androidPushConfigured)
      await PushNotifications.unregister();
    if (scope) await Preferences.remove({ key: 'communication_push_registration:' + scope });
    this.registration = null;
  }
}
