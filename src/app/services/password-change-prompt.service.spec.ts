import { TestBed } from '@angular/core/testing';
import { ActionSheetButton, ActionSheetController } from '@ionic/angular';

import { PasswordChangeRequiredError } from './customer-login-outcome';
import {
  EXTERNAL_BROWSER,
  PasswordChangePromptService,
  passwordChangeSheet,
} from './password-change-prompt.service';
import { portalLoginUrl } from './session-end';
import { SessionEndService } from './session-end.service';

describe('PasswordChangePromptService', () => {
  const portalUrl = 'https://acme.taxoffix.io/portal/client/auth/login';

  describe('sheet copy', () => {
    it('names the office when the portal is known', () => {
      expect(passwordChangeSheet('Acme Tax', portalUrl)).toEqual({
        header: 'Update your password',
        message:
          "Acme Tax asks you to choose a new password. You'll do it on the Acme Tax client portal, then come back and sign in here.",
        openLabel: 'Open Acme Tax portal',
        dismissLabel: 'Not now',
      });
    });

    it('uses generic copy without an office portal', () => {
      const sheet = passwordChangeSheet('Acme Tax', null);

      expect(sheet.message).toBe(
        "Your office asks you to choose a new password. You'll do it on your office's client portal, then come back and sign in here."
      );
      expect(sheet.openLabel).toBe('Open client portal');
    });

    it('uses generic copy without the office name', () => {
      expect(passwordChangeSheet('  ', portalUrl).openLabel).toBe(
        'Open client portal'
      );
    });
  });

  describe('prompt', () => {
    let open: jasmine.Spy;
    let buttons: ActionSheetButton[];
    let header: string | undefined;
    let present: jasmine.Spy;

    beforeEach(() => {
      open = jasmine.createSpy('open').and.resolveTo();
      present = jasmine.createSpy('present').and.resolveTo();
      TestBed.configureTestingModule({
        providers: [
          { provide: EXTERNAL_BROWSER, useValue: { open } },
          {
            provide: ActionSheetController,
            useValue: {
              create: async (options: {
                header?: string;
                buttons: ActionSheetButton[];
              }) => {
                header = options.header;
                buttons = options.buttons;
                return { present };
              },
            },
          },
          {
            provide: SessionEndService,
            useValue: { portalLoginUrl: () => 'https://helper.example/portal' },
          },
        ],
      });
    });

    const press = async (text: string) => {
      const button = buttons.find((b) => b.text === text);
      expect(button).withContext(text).toBeDefined();
      await (button!.handler as () => unknown)();
    };

    it('opens the office portal from the sheet', async () => {
      await TestBed.inject(PasswordChangePromptService).show(
        new PasswordChangeRequiredError(portalUrl),
        'Acme Tax'
      );

      expect(present).toHaveBeenCalled();
      expect(header).toBe('Update your password');
      await press('Open Acme Tax portal');
      expect(open).toHaveBeenCalledWith({ url: portalUrl });
    });

    it('opens the central client login when Auth has no portal URL', async () => {
      await TestBed.inject(PasswordChangePromptService).show(
        new PasswordChangeRequiredError(null),
        'Acme Tax'
      );

      await press('Open client portal');
      // Sin `portalUrl` la oficina no tiene subdominio activo: login central.
      expect(open).toHaveBeenCalledWith({ url: portalLoginUrl(null) });
    });

    it('does nothing on "Not now"', async () => {
      await TestBed.inject(PasswordChangePromptService).show(
        new PasswordChangeRequiredError(portalUrl),
        'Acme Tax'
      );

      expect(buttons.find((b) => b.text === 'Not now')?.role).toBe('cancel');
      expect(open).not.toHaveBeenCalled();
    });
  });
});
