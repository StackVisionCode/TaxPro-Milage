/**
 * TaxOffix - Página de Login
 * =================================
 * Página de inicio de sesión con:
 * - Login con email y contraseña
 * - Autenticación biométrica (huella/Face ID)
 * - Validación de formularios
 * - Manejo de errores
 */

import {
  Component,
  OnInit,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';

import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent,
  IonInput,
  IonButton,
  IonIcon,
  IonSpinner,
  IonInputPasswordToggle,
  AlertController,
  LoadingController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  fingerPrint,
  logInOutline,
  mailOutline,
  lockClosedOutline,
  alertCircleOutline,
} from 'ionicons/icons';
import {
  CustomerAuthService,
  BiometryType,
} from '../../services/customer-auth.service';
import {
  ICustomerLoginResponse,
  ICustomerTenantOption,
} from '../../models/customer-login.interface';
import { loginErrorMessage, PasswordChangeRequiredError } from '../../services/customer-login-outcome';
import { PasswordChangePromptService } from '../../services/password-change-prompt.service';
import { FORGOT_PASSWORD_HINT, QuickSignInDisabledError } from '../../services/session-end';
import { SessionEndService } from '../../services/session-end.service';
import { Browser } from '@capacitor/browser';
import {
  businessOutline,
  locationOutline,
  arrowBackOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonContent,
    IonInput,
    IonButton,
    IonIcon,
    IonSpinner,
    IonInputPasswordToggle,
  ],
  templateUrl: './login.page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './login.page.scss',
})
export class LoginPage implements OnInit {
  // Inyección de dependencias
  private authService = inject(CustomerAuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private alertController = inject(AlertController);
  private loadingController = inject(LoadingController);
  private sessionEnd = inject(SessionEndService);
  private passwordChangePrompt = inject(PasswordChangePromptService);

  // Aviso de por qué terminó la sesión
  noticeMessage = '';
  readonly forgotPasswordHint = FORGOT_PASSWORD_HINT;

  // Formulario de login
  loginForm: FormGroup;

  // Estados
  isLoading = false;
  errorMessage = '';
  biometryAvailable = false;
  biometricEnabled = false;
  biometryType: 'fingerprint' | 'faceId' | 'iris' | null = null;

  // Selección de oficina
  showCompanySelection = false;
  availableOffices: ICustomerTenantOption[] = [];
  private pendingDiscoverySessionRef: string | null = null;
  private selectedOfficeName: string | null = null;

  constructor() {
    // Registrar iconos
    addIcons({
      fingerPrint,
      logInOutline,
      mailOutline,
      lockClosedOutline,
      alertCircleOutline,
      businessOutline,
      locationOutline,
      arrowBackOutline,
    });

    // Inicializar formulario
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  async ngOnInit(): Promise<void> {
    this.showSessionEndNotice();
    // Verificar si hay biometría disponible
    await this.checkBiometricAvailability();
    // La redirección si ya está autenticado se maneja con noAuthGuard en las rutas
  }

  /**
   * Verifica si hay biometría disponible en el dispositivo
   */
  async ionViewWillEnter(): Promise<void> { this.showSessionEndNotice(); await this.checkBiometricAvailability(); }

  private showSessionEndNotice(): void {
    const notice = this.sessionEnd.takeNotice();
    if (notice) this.noticeMessage = notice;
  }

  /** Sin forgot propio: abre el del portal de la oficina (o el login central de clientes). */
  async openForgotPassword(): Promise<void> {
    const url = this.sessionEnd.forgotPasswordUrl();
    try {
      await Browser.open({ url });
    } catch {
      window.open(url, '_blank');
    }
  }

  async checkBiometricAvailability(): Promise<void> {
    this.biometryAvailable = false; this.biometricEnabled = false;
    try {
      // Verificar si el hardware biométrico está disponible
      const biometryType = await this.authService.checkBiometricAvailability();

      if (biometryType) {
        // Mapear el tipo de biometría
        switch (biometryType) {
          case BiometryType.FACE_ID:
            this.biometryType = 'faceId';
            break;
          case BiometryType.TOUCH_ID:
          case BiometryType.FINGERPRINT:
            this.biometryType = 'fingerprint';
            break;
          case BiometryType.IRIS_AUTHENTICATION:
            this.biometryType = 'iris';
            break;
          default:
            this.biometryType = 'fingerprint';
        }

        // Verificar si hay credenciales biométricas guardadas
        const biometricEnabled =
          await this.authService.isBiometricLoginEnabled();
        this.biometryAvailable = true;
        this.biometricEnabled = biometricEnabled;

        console.log(
          'Biometría disponible:',
          this.biometryType,
          'Habilitada:',
          biometricEnabled
        );
      } else {
        this.biometryAvailable = false;
      }
    } catch (error) {
      console.log('Biometría no disponible:', error);
      this.biometryAvailable = false;
    }
  }

  /**
   * Maneja el envío del formulario de login
   */
  async onSubmit(): Promise<void> {
    // Validar formulario
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.noticeMessage = '';

    // Limpiar localStorage antes del login
    this.authService.clearStorageBeforeLogin();

    const credentials = {
      email: this.loginForm.value.email.trim().toLowerCase(),
      password: this.loginForm.value.password,
    };

    this.performLogin(credentials);
  }

  /**
   * Ejecuta el login y maneja las respuestas incluyendo 409 (sesión activa)
   */
  private performLogin(credentials: { email: string; password: string }): void {
    this.authService.login(credentials).subscribe({
      next: async (response) => {
        console.log('Login response:', response);
        if (
          response.requiresTenantSelection &&
          response.discoverySessionRef &&
          response.offices.length > 0
        ) {
          this.availableOffices = response.offices;
          this.pendingDiscoverySessionRef = response.discoverySessionRef;

          if (response.offices.length === 1 && !response.offices[0].mfaRequired) {
            // selectOffice() is guarded by isLoading for user clicks; the initial
            // login request is still loading here, so complete the single-office
            // flow directly instead of returning before the tenant login starts.
            this.finishTenantLogin(response.offices[0]);
            return;
          }

          this.showCompanySelection = true;
          this.isLoading = false;
          return;
        }

        await this.handleSessionResponse(response);
      },
      error: (error) => {
        console.error('Error en login:', error);
        if (this.promptPasswordChange(error)) return;
        this.errorMessage = loginErrorMessage(error, 'Error al iniciar sesión');
        this.isLoading = false;
      },
      complete: () => {
        this.isLoading = false;
      },
    });
  }

  /**
   * Selecciona una company y completa el login
   */
  async selectOffice(office: ICustomerTenantOption): Promise<void> {
    if (!this.pendingDiscoverySessionRef || this.isLoading) return;

    if (office.mfaRequired) {
      const alert = await this.alertController.create({
        header: 'Verificación en dos pasos',
        message: `Ingresa el código de autenticación para ${office.name}.`,
        inputs: [
          {
            name: 'mfaCode',
            type: 'text',
            placeholder: 'Código de 6 dígitos',
            attributes: { inputmode: 'numeric', autocomplete: 'one-time-code' },
          },
        ],
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Continuar',
            handler: (values) => {
              const code = String(values?.mfaCode ?? '').trim();
              if (!code) return false;
              this.finishTenantLogin(office, code);
              return true;
            },
          },
        ],
      });
      await alert.present();
      return;
    }

    this.finishTenantLogin(office);
  }

  private finishTenantLogin(
    office: ICustomerTenantOption,
    mfaCode?: string
  ): void {
    if (!this.pendingDiscoverySessionRef) return;
    this.sessionEnd.rememberOffice(office.subdomain);
    this.selectedOfficeName = office.name;

    this.isLoading = true;
    this.errorMessage = '';

    this.authService
      .loginWithTenant({
        discoverySessionRef: this.pendingDiscoverySessionRef,
        tenantId: office.tenantId,
        mfaCode,
      })
      .subscribe({
        next: async (response) => {
          this.showCompanySelection = false;
          await this.handleSessionResponse(response);
        },
        error: (error) => {
          console.error('Error en login con oficina:', error);
          if (this.promptPasswordChange(error)) return;
          this.errorMessage = loginErrorMessage(error, 'Error al seleccionar la oficina');
          this.isLoading = false;
        },
      });
  }

  private async handleSessionResponse(
    response: ICustomerLoginResponse
  ): Promise<void> {
    if (response.takeoverRequired && response.takeoverTicket) {
      await this.confirmSessionTakeover(response.takeoverTicket);
      return;
    }

    if (!response.accessToken || !response.refreshToken) {
      this.errorMessage = 'La API no devolvió una sesión válida.';
      this.isLoading = false;
      return;
    }

    this.pendingDiscoverySessionRef = null;
    await this.completeLoginFlow();
  }

  private async confirmSessionTakeover(ticket: string): Promise<void> {
    this.isLoading = false;
    const alert = await this.alertController.create({
      header: 'Sesión activa',
      message:
        'Esta cuenta ya tiene una sesión activa. ¿Deseas cerrarla e iniciar sesión en este dispositivo?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Continuar',
          role: 'confirm',
          handler: () => this.executeSessionTakeover(ticket),
        },
      ],
    });
    await alert.present();
  }

  private executeSessionTakeover(ticket: string): void {
    this.isLoading = true;
    this.authService.takeoverSession(ticket).subscribe({
      next: async () => {
        this.pendingDiscoverySessionRef = null;
        await this.completeLoginFlow();
      },
      error: (error) => {
        this.errorMessage = loginErrorMessage(error, 'No se pudo transferir la sesión.');
        this.isLoading = false;
      },
    });
  }

  /** Cambio obligatorio: sin sesión; la hoja lleva al portal de la oficina. */
  private promptPasswordChange(error: unknown): boolean {
    if (!(error instanceof PasswordChangeRequiredError)) return false;
    this.isLoading = false;
    this.showCompanySelection = false;
    this.pendingDiscoverySessionRef = null;
    this.loginForm.get('password')?.reset();
    void this.passwordChangePrompt.show(error, this.selectedOfficeName);
    return true;
  }

  /**
   * Volver al formulario de login desde la selección de company
   */
  backToLogin(): void {
    this.showCompanySelection = false;
    this.availableOffices = [];
    this.pendingDiscoverySessionRef = null;
    this.errorMessage = '';
  }

  /**
   * Flujo post-login: biometría + navegación al dashboard
   */
  private async completeLoginFlow(): Promise<void> {
    const biometryType = await this.authService.checkBiometricAvailability();
    const biometricEnabled = await this.authService.isBiometricLoginEnabled();

    if (biometryType) {
      if (!biometricEnabled) {
        this.biometryType =
          biometryType === BiometryType.FACE_ID ? 'faceId' : 'fingerprint';
        await this.askToEnableBiometrics();
      } else {
        await this.authService.setBiometricLoginEnabled(true);
      }
    }

    await this.router.navigate(['/tabs/dashboard'], { replaceUrl: true });
  }

  /**
   * Genera las iniciales de un nombre de compañía para el placeholder
   */
  getCompanyInitials(name: string): string {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  /**
   * Inicia sesión usando biometría
   */
  async loginWithBiometrics(): Promise<void> {
    if (this.isLoading) return;
    if (!this.biometricEnabled) {
      const alert = await this.alertController.create({
        header: 'Activar acceso biométrico',
        message: 'Inicia sesión con tu correo y contraseña. Después podrás activar la huella digital para los próximos accesos en este dispositivo.',
        buttons: ['Entendido'],
      });
      await alert.present(); return;
    }
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Verificando...',
      spinner: 'crescent',
    });

    try {
      await loading.present();

      const success = await this.authService.authenticateWithBiometrics();

      await loading.dismiss();

      if (success) {
        await this.router.navigate(['/tabs/dashboard'], { replaceUrl: true });
      } else {
        // Si no fue exitoso, mostrar mensaje para login manual
        await this.showBiometricExpiredAlert();
      }
    } catch (error: any) {
      await loading.dismiss();

      console.error('Error en login biométrico:', error);

      // El servidor cerró la sesión: la biometría ya se borró
      if (error instanceof QuickSignInDisabledError) {
        this.biometricEnabled = false;
        this.noticeMessage = error.message;
        return;
      }

      // Verificar si es un error de token expirado o credenciales inválidas
      if (
        error.message?.includes('401') ||
        error.message?.includes('expired') ||
        error.message?.includes('invalid')
      ) {
        await this.showBiometricExpiredAlert();
      } else {
        // Otro tipo de error (usuario canceló, etc.)
        const alert = await this.alertController.create({
          header: 'Error de autenticación',
          message: error.message || 'No se pudo verificar tu identidad',
          buttons: ['Entendido'],
        });
        await alert.present();
      }
    } finally { this.isLoading = false; }
  }

  /**
   * Muestra alerta cuando las credenciales biométricas expiraron
   */
  private async showBiometricExpiredAlert(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Sesión expirada',
      message:
        'Tu sesión guardada ha expirado. Por favor, inicia sesión con tu correo y contraseña para actualizar tus credenciales biométricas.',
      buttons: ['Entendido'],
    });
    await alert.present();
  }

  /**
   * Pregunta al usuario si quiere habilitar login biométrico
   */
  async askToEnableBiometrics(): Promise<void> {
    const biometryName =
      this.biometryType === 'faceId' ? 'Face ID' : 'huella digital';

    const alert = await this.alertController.create({
      header: 'Login rápido',
      message: `¿Deseas usar ${biometryName} para iniciar sesión más rápido?`,
      buttons: [
        {
          text: 'No, gracias',
          role: 'cancel',
        },
        {
          text: 'Sí, activar',
          handler: async () => {
            try {
              await this.authService.setBiometricLoginEnabled(true);
              this.biometricEnabled = true;
            } catch { this.errorMessage = 'No se pudo activar la huella. Puedes reintentarlo desde Mi Perfil.'; }
          },
        },
      ],
    });

    await alert.present();
    await alert.onDidDismiss();
  }

  /**
   * Maneja el error si el logo no carga
   */
  onLogoError(event: any): void {
    // Usar un placeholder si el logo no carga
    event.target.src =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCBmaWxsPSIjMWEzNjVkIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjIwIi8+PHRleHQgeD0iNTAiIHk9IjU1IiBmb250LXNpemU9IjQwIiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPk08L3RleHQ+PC9zdmc+';
  }
}
