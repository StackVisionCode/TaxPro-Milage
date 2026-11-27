import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { PluginListenerHandle } from '@capacitor/core';
import { ToastController } from '@ionic/angular';

import { CustomerSessionRefreshService } from './customer-session-refresh.service';
import { CustomerTokenService } from './customer-token.service';
import { MobileTrackingPlatform } from './mobile-tracking-platform.service';
import {
  forgotPasswordUrl,
  isTransientRefreshFailure,
  NO_CONNECTION_MESSAGE,
  refreshRejectionReason,
  sessionEndMessage,
} from './session-end';

/** Cierre de sesión explicado: aviso por motivo, sin cerrar por fallos de red. */
@Injectable({ providedIn: 'root' })
export class SessionEndService {
  private tokens = inject(CustomerTokenService);
  private refresh = inject(CustomerSessionRefreshService);
  private router = inject(Router);
  private toasts = inject(ToastController);
  private platform = inject(MobileTrackingPlatform);

  private notice: string | null = null;
  private officeSubdomain: string | null = null;
  private reconnect?: Promise<PluginListenerHandle>;

  /** Oficina elegida o de la sesión actual: destino de "Forgot password?". */
  rememberOffice(subdomain: string | null | undefined): void {
    if (subdomain) this.officeSubdomain = subdomain;
  }

  forgotPasswordUrl(): string {
    return forgotPasswordUrl(this.officeSubdomain);
  }

  /** Aviso pendiente para el login; se entrega una sola vez. */
  takeNotice(): string | null {
    const notice = this.notice;
    this.notice = null;
    return notice;
  }

  /** Refresh fallido: por red se conserva la sesión y se reintenta; si el servidor lo rechaza, se cierra con aviso. */
  handleRefreshFailure(error: unknown): void {
    if (isTransientRefreshFailure(error)) {
      this.retryWhenOnline();
      return;
    }
    this.cancelRetry();
    this.tokens.removeTokens();
    this.notice = sessionEndMessage(refreshRejectionReason(error));
    void this.router.navigate(['/login']);
  }

  private retryWhenOnline(): void {
    if (this.reconnect) return;
    void this.toasts
      .create({ message: NO_CONNECTION_MESSAGE, duration: 4000, position: 'bottom' })
      .then((toast) => toast.present());
    this.reconnect = this.platform.onReconnect(() => {
      this.cancelRetry();
      if (!this.tokens.refreshToken) return;
      this.refresh.refreshAccessToken().subscribe({ error: (error) => this.handleRefreshFailure(error) });
    });
  }

  private cancelRetry(): void {
    const reconnect = this.reconnect;
    this.reconnect = undefined;
    void reconnect?.then((handle) => handle.remove());
  }
}
