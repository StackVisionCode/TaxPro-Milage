import { inject, Injectable, InjectionToken } from '@angular/core';
import { Browser } from '@capacitor/browser';
import { ActionSheetController } from '@ionic/angular';

import { PasswordChangeRequiredError } from './customer-login-outcome';
import { portalLoginUrl } from './session-end';

export interface ExternalBrowser {
  open(options: { url: string }): Promise<void>;
}

/** Navegador del sistema (Capacitor); reemplazable en pruebas. */
export const EXTERNAL_BROWSER = new InjectionToken<ExternalBrowser>(
  'EXTERNAL_BROWSER',
  {
    providedIn: 'root',
    factory: () => Browser,
  }
);

export interface PasswordChangeSheet {
  header: string;
  message: string;
  openLabel: string;
  dismissLabel: string;
}

/** Copy de 04 §9; sin oficina o sin portal conocido, genérico. */
export function passwordChangeSheet(
  officeName: string | null | undefined,
  portalUrl: string | null | undefined
): PasswordChangeSheet {
  const office = officeName?.trim();
  const named = !!office && !!portalUrl;
  return {
    header: 'Update your password',
    message: named
      ? `${office} asks you to choose a new password. You'll do it on the ${office} client portal, then come back and sign in here.`
      : "Your office asks you to choose a new password. You'll do it on your office's client portal, then come back and sign in here.",
    openLabel: named ? `Open ${office} portal` : 'Open client portal',
    dismissLabel: 'Not now',
  };
}

/** Hoja "Update your password": el cambio se hace en el portal web de la oficina. */
@Injectable({ providedIn: 'root' })
export class PasswordChangePromptService {
  private sheets = inject(ActionSheetController);
  private browser = inject(EXTERNAL_BROWSER);

  async show(
    error: PasswordChangeRequiredError,
    officeName?: string | null
  ): Promise<void> {
    const sheet = passwordChangeSheet(officeName, error.portalUrl);
    // Sin `portalUrl` la oficina no tiene subdominio activo: login central.
    const url = error.portalUrl ?? portalLoginUrl(null);
    const actionSheet = await this.sheets.create({
      header: sheet.header,
      subHeader: sheet.message,
      buttons: [
        { text: sheet.openLabel, handler: () => this.open(url) },
        { text: sheet.dismissLabel, role: 'cancel' },
      ],
    });
    await actionSheet.present();
  }

  private async open(url: string): Promise<void> {
    try {
      await this.browser.open({ url });
    } catch {
      window.open(url, '_blank');
    }
  }
}
