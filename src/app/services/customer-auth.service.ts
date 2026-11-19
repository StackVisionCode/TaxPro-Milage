import { isPendingTrackingStorageKey } from './tracking-storage-keys';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  defer,
  catchError,
  from,
  map,
  Observable,
  of,
  Subject,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { Router } from '@angular/router';
import {
  ICustomerLogin,
  ICustomerLoginResponse,
  ICustomerProfile,
  ICustomerTenantLoginRequest,
  IMeResponse,
  IMyCustomerAvatarUploadResponse,
  IMyCustomerContactResponse,
  ITakeoverResponse,
} from '../models/customer-login.interface';
import { CustomerTokenService } from './customer-token.service';
import { environment } from '../../environments/environment';
import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { TripService } from './trip.service';
import { GpsTrackingService } from './gps-tracking.service';

export { BiometryType } from '@capgo/capacitor-native-biometric';

@Injectable({
  providedIn: 'root',
})
export class CustomerAuthService implements OnDestroy {
  private http = inject(HttpClient);
  private customerTokenService = inject(CustomerTokenService);
  // private cloudTokenService = inject(CloudTokenService);
  // private toastService = inject(ToastService);
  // private socketConnection = inject(SocketConnectionService);
  // private mediaCacheService = inject(MediaCacheService);
  // private notificationWS = inject(NotificationWebSocketService);
  private tripService : TripService = inject(TripService);
  private trackingService : GpsTrackingService = inject(GpsTrackingService);
  private router = inject(Router);

  public currentCustomerSubject = new BehaviorSubject<ICustomerProfile | null>(null);
  currentCustomer$ = this.currentCustomerSubject.asObservable();

  private destroy$ = new Subject<void>();
  private assignmentChangedSubject = new Subject<{
    taxUserId: string;
    isAssigned: boolean;
    reason?: string;
  }>();
  public assignmentChanged$ = this.assignmentChangedSubject.asObservable();

  constructor() {



    const token = this.customerTokenService.token;
    if (token) {
      this.loadCustomerProfile().subscribe();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }


  login(data: ICustomerLogin): Observable<ICustomerLoginResponse> {
    return this.http
      .post<ICustomerLoginResponse>(
        `${environment.apiUrl}${environment.endpoints.login}`,
        data
      )
      .pipe(switchMap((response) => this.processLoginResponse(response)));
  }

  loginWithTenant(
    data: ICustomerTenantLoginRequest
  ): Observable<ICustomerLoginResponse> {
    return this.http
      .post<ICustomerLoginResponse>(
        `${environment.apiUrl}${environment.endpoints.login}`,
        data
      )
      .pipe(switchMap((response) => this.processLoginResponse(response)));
  }

  takeoverSession(ticket: string): Observable<boolean> {
    return this.http
      .post<ITakeoverResponse>(
        `${environment.apiUrl}${environment.endpoints.takeoverSession}`,
        { ticket }
      )
      .pipe(
        switchMap((response) => {
          const tokens = response.tokens;
          if (!tokens?.accessToken || !tokens.refreshToken) {
            return throwError(() => new Error('No se recibieron tokens de sesión.'));
          }

          this.customerTokenService.setTokens(
            tokens.accessToken,
            tokens.refreshToken
          );
          return this.loadCustomerProfile().pipe(map(() => true));
        })
      );
  }

  private processLoginResponse(
    response: ICustomerLoginResponse
  ): Observable<ICustomerLoginResponse> {
    if (!response.accessToken || !response.refreshToken) {
      return of(response);
    }

    this.customerTokenService.setTokens(
      response.accessToken,
      response.refreshToken
    );
    return this.loadCustomerProfile().pipe(map(() => response));
  }

  loadCustomerProfile(): Observable<ICustomerProfile | null> {
    if (!this.customerTokenService.token) {
      return of(null);
    }

    return this.http
      .get<IMeResponse>(`${environment.apiUrl}${environment.endpoints.userProfile}`)
      .pipe(
        map((response) => {
          if (
            response.actorType !== 'CustomerPortal' ||
            !response.customerId
          ) {
            throw new Error('La sesión no pertenece a un cliente de oficina.');
          }

          const customer: ICustomerProfile = {
            customerId: response.customerId,
            userId: response.id,
            firstName: response.name,
            lastName: response.lastName,
            email: response.email,
            phoneNumber: response.phoneNumber ?? '',
            companyId: response.tenant.id,
            actorType: response.actorType,
            tenant: response.tenant,
            roles: response.roles,
            permissions: response.permissions,
            timeZoneId: response.timeZoneId,
          };
          this.currentCustomerSubject.next(customer);
          return customer;
        }),
        catchError((error) => {
          return throwError(() => error);
        })
      );
  }

  getMyCustomerContact(): Observable<IMyCustomerContactResponse> {
    return this.http.get<IMyCustomerContactResponse>(
      `${environment.apiUrl}${environment.endpoints.myCustomerContact}`
    );
  }

  uploadMyCustomerAvatar(file: File): Observable<IMyCustomerAvatarUploadResponse> {
    const form = new FormData();
    form.append('file', file, file.name || 'avatar.jpg');
    return this.http.put<IMyCustomerAvatarUploadResponse>(
      `${environment.apiUrl}${environment.endpoints.myCustomerAvatar}`,
      form
    );
  }

  logout(): Observable<boolean> {
    return defer(()=>this.trackingService.suspendForLogout()).pipe(
      switchMap(()=>this.http.post<void>(`${environment.apiUrl}${environment.endpoints.logout}`, {}).pipe(
        catchError(error => {
          console.warn('Error al notificar logout al servidor; se cierra la sesion local:',error);
          return of(undefined);
        })
      )),
      switchMap(() => {
        this.clearInMemoryState();
        return from(this.clearClientStorage());
      }),
      tap(() => this.router.navigate(['/login'])),
      map(() => true)
      );
  }

  /**
 * Limpiar estado en memoria ANTES de limpiar storage
 */
  private clearInMemoryState(): void {
    this.customerTokenService.removeTokens();
    this.currentCustomerSubject.next(null);

    // Limpiar cache de trips si existe
    if (this.tripService) {
      this.tripService.clearCache();
    }


  }

  private async clearClientStorage(): Promise<void> {
    try {
      // 1) Capacitor Preferences - limpiar todo
      const {keys}=await Preferences.keys();
      await Promise.all(keys.filter(key=>!isPendingTrackingStorageKey(key)).map(key=>Preferences.remove({key})));

      // Preferences shares localStorage on web: retain pending trips in both passes.
      for(const key of Object.keys(localStorage)) {
        if(!isPendingTrackingStorageKey(key)) localStorage.removeItem(key);
      }
      sessionStorage.clear();

      // 3) IndexedDB - limpiar bases de datos (si usas)
      if ('indexedDB' in window) {
        try {
          const databases = await indexedDB.databases();
          await Promise.all(
            databases.map(db => {
              if (db.name) {
                return new Promise((resolve, reject) => {
                  const request = indexedDB.deleteDatabase(db.name!);
                  request.onsuccess = () => resolve(true);
                  request.onerror = () => reject(request.error);
                });
              }
              return Promise.resolve();
            })
          );
        } catch (error) {
          console.warn('⚠️ Error limpiando IndexedDB:', error);
        }
      }

      // 4) Cache Storage (PWA / service worker)
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }

      console.log('✅ Storage limpiado exitosamente');
    } catch (error) {
      console.error('❌ Error limpiando storage:', error);
    }
  }


  // async logout(): Promise<void> {
  //   const currentCustomer = this.currentCustomerSubject.value;
  //   const customerName = currentCustomer
  //     ? `${currentCustomer.firstName} ${currentCustomer.lastName}`.trim()
  //     : this.customerTokenService.getCustomerDisplayNameFromToken();



  //   const localLogout$ = this.http
  //     .post(`${environment.apiUrl}/auth/client/logout`, {})
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error logging out the customer from the main backend.:', error);
  //         return of(null);
  //       })
  //     );



  //   forkJoin({
  //     local: localLogout$
  //   }).subscribe({
  //     next: (results) => {
  //       console.log('Customer logout completed from all services.');
  //     },
  //     error: (error) => {
  //       console.error('Error during customer logout process:', error);


  //     },
  //     complete: () => {
  //       this.customerTokenService.removeTokens();
  //       this.currentCustomerSubject.next(null);

  //       const keysToRemove = Object.keys(localStorage).filter((key) =>
  //         key.startsWith('customer_') ||
  //         key.includes('chat_') ||
  //         key.includes('webrtc_') ||
  //         key.includes('TokenCloud')
  //       );
  //       keysToRemove.forEach((key) => localStorage.removeItem(key));
  //     },
  //   });
  // }


  hasValidSession(): boolean {
    const token = this.customerTokenService.token;
    const customer = this.currentCustomerSubject.value;

    return !!(
      token &&
      this.customerTokenService.isCustomerPortalToken() &&
      customer?.customerId
    );
  }

  isAuthenticated(): boolean {
    const token = this.customerTokenService.token;
    const customer = this.currentCustomerSubject.value;

    return !!(token &&
      this.customerTokenService.isCustomerPortalToken() &&
      customer?.customerId);
  }

  getCurrentCustomer(): ICustomerProfile | null {
    return this.currentCustomerSubject.value;
  }

  /**
   * Verifica si el usuario está logueado
   */
  isLoggedIn(): boolean {
    const token = this.customerTokenService.token;
    if (!token) {
      return false;
    }
    // Verificar que el token no esté expirado
    const decodedToken = this.customerTokenService.decodeToken();
    if (!decodedToken) {
      return false;
    }
    const currentTime = Math.floor(Date.now() / 1000);
    return decodedToken.exp > currentTime;
  }

  /**
   * Limpia el localStorage antes del login
   * NO borra las credenciales biométricas para permitir login con huella
   */
  clearStorageBeforeLogin(): void {
    const keysToRemove = Object.keys(localStorage).filter((key) =>
      (key.startsWith('customer_') ||
        key.includes('chat_') ||
        key.includes('webrtc_') ||
        key.includes('TokenCloud')) &&
      !key.includes('biometric_')
    );
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    this.customerTokenService.removeTokens();
    this.currentCustomerSubject.next(null);
  }

  /**
   * Verifica si la biometría está disponible en el dispositivo
   * @returns BiometryType si está disponible, null si no
   */
  async checkBiometricAvailability(): Promise<BiometryType | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }

    try {
      const result = await NativeBiometric.isAvailable();
      if (result.isAvailable) {
        return result.biometryType;
      }
      return null;
    } catch (error) {
      console.error('Error checking biometric availability:', error);
      return null;
    }
  }

  /**
   * Verifica si el login biométrico está habilitado para el usuario
   */
  async isBiometricLoginEnabled(): Promise<boolean> {
    const enabled = localStorage.getItem('biometric_login_enabled');
    const hasCredentials = localStorage.getItem('biometric_credentials');
    return enabled === 'true' && !!hasCredentials;
  }

  /**
   * Habilita o deshabilita el login biométrico
   */
  async setBiometricLoginEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      const currentCustomer = this.currentCustomerSubject.value;
      const token = this.customerTokenService.token;
      const refreshToken = this.customerTokenService.refreshToken;

      if (token) {
        try {
          // Guardamos los tokens como JSON para poder recuperarlos después
          const credentialsData = JSON.stringify({
            accessToken: token,
            refreshToken: refreshToken || token
          });

          await NativeBiometric.setCredentials({
            username: currentCustomer?.email || this.customerTokenService.getCustomerEmailFromToken() || 'user',
            password: credentialsData,
            server: environment.apiUrl
          });
          localStorage.setItem('biometric_login_enabled', 'true');
          localStorage.setItem('biometric_credentials', 'true');
          console.log('Biometric credentials saved successfully');
        } catch (error) {
          console.error('Error setting biometric credentials:', error);
          throw error;
        }
      }
    } else {
      try {
        await NativeBiometric.deleteCredentials({
          server: environment.apiUrl
        });
      } catch (error) {
        console.error('Error deleting biometric credentials:', error);
      }
      localStorage.removeItem('biometric_login_enabled');
      localStorage.removeItem('biometric_credentials');
    }
  }

  /**
   * Autentica al usuario usando biometría
   * @returns true si la autenticación fue exitosa
   */
  async authenticateWithBiometrics(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Biometric authentication is only available on native platforms');
    }

    try {
      // verifyIdentity lanza excepción si falla, no retorna valor
      await NativeBiometric.verifyIdentity({
        reason: 'Inicia sesión en TaxPro Mileage',
        title: 'Autenticación biométrica',
        subtitle: 'Usa tu huella digital o Face ID',
        description: 'Verifica tu identidad para acceder a tu cuenta'
      });

      // Si llegamos aquí, la verificación fue exitosa
      const credentials = await NativeBiometric.getCredentials({
        server: environment.apiUrl
      });

      if (credentials && credentials.password) {
        let accessToken: string;
        let refreshToken: string;

        try {
          // Intentar parsear como JSON (nuevo formato)
          const tokensData = JSON.parse(credentials.password);
          accessToken = tokensData.accessToken;
          refreshToken = tokensData.refreshToken;
        } catch {
          // Si falla el parse, es el formato antiguo (solo token)
          accessToken = credentials.password;
          refreshToken = credentials.password;
        }

        // Verificar si el token está expirado
        const isTokenExpired = this.isTokenExpired(accessToken);

        if (isTokenExpired) {
          // Intentar refrescar el token usando el refreshToken
          try {
            const newTokens = await this.refreshTokens(refreshToken);
            if (newTokens) {
              accessToken = newTokens.accessToken;
              refreshToken = newTokens.refreshToken;

              // Actualizar credenciales biométricas con los nuevos tokens
              await this.updateBiometricCredentials(credentials.username, accessToken, refreshToken);
            } else {
              // No se pudo refrescar, el usuario debe hacer login manual
              return false;
            }
          } catch (refreshError) {
            console.error('Error refreshing token:', refreshError);
            // El refreshToken también expiró o falló
            return false;
          }
        }

        // Establecer los tokens (frescos o recién refrescados)
        this.customerTokenService.setTokens(accessToken, refreshToken);

        // Cargar el perfil del usuario
        await this.loadCustomerProfile().toPromise();
        return true;
      }

      return false;
    } catch (error: any) {
      console.error('Biometric authentication failed:', error);
      throw new Error(error.message || 'No se pudo verificar tu identidad');
    }
  }

  /**
   * Verifica si un token JWT está expirado
   */
  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const currentTime = Math.floor(Date.now() / 1000);
      // Considerar expirado si le quedan menos de 60 segundos
      return payload.exp < (currentTime + 60);
    } catch {
      return true;
    }
  }

  /**
   * Intenta refrescar los tokens usando el refreshToken
   */
  private async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const response = await this.http.post<{
        accessToken: string;
        refreshToken: string;
      }>(
        `${environment.apiUrl}${environment.endpoints.refreshToken}`,
        { refreshToken }
      ).toPromise();

      if (response?.accessToken && response.refreshToken) {
        return {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken
        };
      }
      return null;
    } catch (error) {
      console.error('Error in refreshTokens:', error);
      return null;
    }
  }

  /**
   * Actualiza las credenciales biométricas con nuevos tokens
   */
  private async updateBiometricCredentials(username: string, accessToken: string, refreshToken: string): Promise<void> {
    try {
      const credentialsData = JSON.stringify({
        accessToken,
        refreshToken
      });

      await NativeBiometric.setCredentials({
        username,
        password: credentialsData,
        server: environment.apiUrl
      });
      console.log('Biometric credentials updated with new tokens');
    } catch (error) {
      console.error('Error updating biometric credentials:', error);
    }
  }

  /**
   * Verifica si hay credenciales biométricas guardadas
   */
  async hasBiometricCredentials(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    try {
      const credentials = await NativeBiometric.getCredentials({
        server: environment.apiUrl
      });
      return !!(credentials && credentials.password);
    } catch {
      return false;
    }
  }
}
