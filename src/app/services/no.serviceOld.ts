// /**
//  * TaxOffix - Servicio de Autenticación
//  * ============================================
//  * Este servicio maneja toda la lógica de autenticación:
//  * - Login con usuario/contraseña
//  * - Autenticación biométrica (huella/Face ID)
//  * - Gestión de tokens JWT
//  * - Almacenamiento seguro de credenciales
//  */

// import { Injectable, inject } from '@angular/core';
// import { HttpClient, HttpErrorResponse } from '@angular/common/http';
// import { Router } from '@angular/router';
// import { BehaviorSubject, Observable, from, of, throwError } from 'rxjs';
// import { map, catchError, tap, switchMap } from 'rxjs/operators';
// import { Preferences } from '@capacitor/preferences';
// import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric';

// import { environment } from '../../environments/environment';
// import { 
//   User, 
//   LoginCredentials, 
//   LoginResponse, 
//   AuthToken,
//   ApiResponse 
// } from '../models/interfaces';

// @Injectable({
//   providedIn: 'root'
// })
// export class AuthService {
//   // Inyección de dependencias
//   private http = inject(HttpClient);
//   private router = inject(Router);

//   // Estado del usuario actual
//   private currentUserSubject = new BehaviorSubject<User | null>(null);
//   public currentUser$ = this.currentUserSubject.asObservable();

//   // Estado de autenticación
//   private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
//   public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

//   // Token actual
//   private authToken: AuthToken | null = null;

//   constructor() {
//     // Intentar restaurar sesión al iniciar
//     this.initializeAuth();
//   }

//   /**
//    * Inicializa la autenticación al arrancar la app
//    * Verifica si hay un token guardado y si es válido
//    */
//   private async initializeAuth(): Promise<void> {
//     console.log('🔐 Inicializando autenticación...');
    
//     try {
//       // Intentar obtener el token guardado
//       const savedToken = await this.getStoredToken();
      
//       if (savedToken && this.isTokenValid(savedToken)) {
//         this.authToken = savedToken;
//         this.isAuthenticatedSubject.next(true);
        
//         // Cargar datos del usuario
//         await this.loadUserData();
//         console.log('✅ Sesión restaurada exitosamente');
//       } else {
//         console.log('ℹ️ No hay sesión activa');
//         this.clearAuth();
//       }
//     } catch (error) {
//       console.error('❌ Error inicializando auth:', error);
//       this.clearAuth();
//     }
//   }

//   // ===========================================
//   // LOGIN CON CREDENCIALES
//   // ===========================================

//   /**
//    * Inicia sesión con email y contraseña
//    * @param credentials Credenciales del usuario
//    * @returns Observable con el resultado del login
//    */
//   login(credentials: LoginCredentials): Observable<User> {
//     console.log('🔐 Iniciando login para:', credentials.email);
    
//     // ============================================
//     // MODO DEMO - Para pruebas sin backend
//     // Credenciales de prueba: demo@test.com / demo123
//     // ============================================
//     if (this.isDemoMode(credentials)) {
//       return this.demoLogin(credentials);
//     }
    
//     const url = `${environment.apiUrl}${environment.endpoints.login}`;
    
//     return this.http.post<LoginResponse>(url, credentials).pipe(
//       tap(response => {
//         if (response.success) {
//           console.log('✅ Login exitoso');
          
//           // Guardar token
//           this.authToken = {
//             token: response.data.token,
//             refreshToken: response.data.refreshToken,
//             expiresAt: response.data.expiresAt
//           };
          
//           // Actualizar estado
//           this.currentUserSubject.next(response.data.user);
//           this.isAuthenticatedSubject.next(true);
          
//           // Guardar en almacenamiento persistente
//           this.saveTokenToStorage(this.authToken);
//           this.saveUserToStorage(response.data.user);
//         }
//       }),
//       map(response => response.data.user),
//       catchError(this.handleError)
//     );
//   }

//   /**
//    * Verifica si se debe usar el modo demo
//    */
//   private isDemoMode(credentials: LoginCredentials): boolean {
//     // Activar modo demo con credenciales específicas o si la API no está configurada
//     const isDemoCredentials = credentials.email === 'demo@test.com' && credentials.password === 'demo123';
//     const isApiNotConfigured = environment.apiUrl.includes('tu-dominio.com');
//     return isDemoCredentials || isApiNotConfigured;
//   }

//   /**
//    * Login en modo demo (sin backend)
//    */
//   private demoLogin(credentials: LoginCredentials): Observable<User> {
//     console.log('🎭 Usando MODO DEMO');
    
//     // Simular delay de red
//     return new Observable(observer => {
//       setTimeout(() => {
//         // Usuario demo
//         const demoUser: User = {
//           id: 'demo-user-001',
//           email: credentials.email || 'demo@test.com',
//           firstName: 'Usuario',
//           lastName: 'Demo',
//           phone: '+1 555-0123',
//           createdAt: new Date().toISOString(),
//           lastLogin: new Date().toISOString()
//         };

//         // Token demo (válido por 24 horas)
//         const expiresAt = new Date();
//         expiresAt.setHours(expiresAt.getHours() + 24);
        
//         this.authToken = {
//           token: 'demo-token-' + Date.now(),
//           refreshToken: 'demo-refresh-' + Date.now(),
//           expiresAt: expiresAt.toISOString()
//         };

//         // Actualizar estado
//         this.currentUserSubject.next(demoUser);
//         this.isAuthenticatedSubject.next(true);

//         // Guardar en almacenamiento
//         this.saveTokenToStorage(this.authToken);
//         this.saveUserToStorage(demoUser);

//         console.log('✅ Login demo exitoso');
//         observer.next(demoUser);
//         observer.complete();
//       }, 800); // Simular 800ms de latencia
//     });
//   }

//   /**
//    * Cierra la sesión del usuario
//    */
//   async logout(): Promise<void> {
//     console.log('🔐 Cerrando sesión...');
    
//     try {
//       // Llamar al endpoint de logout (opcional, para invalidar token en servidor)
//       if (this.authToken) {
//         const url = `${environment.apiUrl}${environment.endpoints.logout}`;
//         await this.http.post(url, {}).toPromise().catch(() => {});
//       }
//     } finally {
//       // Limpiar estado local
//       this.clearAuth();
      
//       // Navegar al login
//       await this.router.navigate(['/login'], { replaceUrl: true });
      
//       console.log('✅ Sesión cerrada');
//     }
//   }

//   // ===========================================
//   // AUTENTICACIÓN BIOMÉTRICA
//   // ===========================================

//   /**
//    * Verifica si el dispositivo soporta autenticación biométrica
//    * @returns Tipo de biometría disponible o null si no hay
//    */
//   async checkBiometricAvailability(): Promise<BiometryType | null> {
//     try {
//       const result = await NativeBiometric.isAvailable();
      
//       if (result.isAvailable) {
//         console.log('✅ Biometría disponible:', result.biometryType);
//         return result.biometryType;
//       } else {
//         console.log('ℹ️ Biometría no disponible');
//         return null;
//       }
//     } catch (error) {
//       console.error('❌ Error verificando biometría:', error);
//       return null;
//     }
//   }

//   /**
//    * Realiza autenticación biométrica (huella o Face ID)
//    * @returns true si la autenticación fue exitosa
//    */
//   async authenticateWithBiometrics(): Promise<boolean> {
//     try {
//       // Verificar disponibilidad
//       const biometryType = await this.checkBiometricAvailability();
      
//       if (!biometryType) {
//         throw new Error('Biometría no disponible en este dispositivo');
//       }

//       // Determinar el mensaje según el tipo
//       const reason = biometryType === BiometryType.FACE_ID 
//         ? 'Usa Face ID para acceder a TaxOffix'
//         : 'Usa tu huella digital para acceder a TaxOffix';

//       // Solicitar autenticación con NativeBiometric
//       await NativeBiometric.verifyIdentity({
//         reason: reason,
//         title: 'TaxOffix',
//         subtitle: 'Verificación de identidad',
//         description: 'Accede de forma segura a tu cuenta',
//         negativeButtonText: 'Usar contraseña',
//         maxAttempts: 3,
//         useFallback: true
//       });

//       console.log('✅ Autenticación biométrica exitosa');
      
//       // Restaurar sesión si hay credenciales guardadas
//       const savedToken = await this.getStoredToken();
//       const savedUser = await this.getStoredUser();
      
//       if (savedToken && savedUser && this.isTokenValid(savedToken)) {
//         this.authToken = savedToken;
//         this.currentUserSubject.next(savedUser);
//         this.isAuthenticatedSubject.next(true);
//         return true;
//       } else {
//         throw new Error('No hay sesión guardada. Por favor inicia sesión con tu contraseña.');
//       }
      
//     } catch (error: any) {
//       console.error('❌ Error en autenticación biométrica:', error);
//       throw error;
//     }
//   }

//   /**
//    * Habilita/deshabilita login biométrico para el usuario
//    */
//   async setBiometricLoginEnabled(enabled: boolean): Promise<void> {
//     await Preferences.set({
//       key: 'biometric_login_enabled',
//       value: String(enabled)
//     });
//   }

//   /**
//    * Verifica si el login biométrico está habilitado
//    */
//   async isBiometricLoginEnabled(): Promise<boolean> {
//     const { value } = await Preferences.get({ key: 'biometric_login_enabled' });
//     return value === 'true';
//   }

//   // ===========================================
//   // GESTIÓN DE TOKENS
//   // ===========================================

//   /**
//    * Obtiene el token actual para las peticiones HTTP
//    */
//   getToken(): string | null {
//     return this.authToken?.token || null;
//   }

//   /**
//    * Verifica si el token es válido (no ha expirado)
//    */
//   private isTokenValid(token: AuthToken): boolean {
//     if (!token.expiresAt) return false;
    
//     const expiresAt = new Date(token.expiresAt).getTime();
//     const now = Date.now();
    
//     // Considerar inválido si expira en menos de 5 minutos
//     return expiresAt > (now + 5 * 60 * 1000);
//   }

//   /**
//    * Refresca el token de autenticación
//    */
//   async refreshToken(): Promise<boolean> {
//     if (!this.authToken?.refreshToken) {
//       return false;
//     }

//     try {
//       const url = `${environment.apiUrl}${environment.endpoints.refreshToken}`;
//       const response = await this.http.post<LoginResponse>(url, {
//         refreshToken: this.authToken.refreshToken
//       }).toPromise();

//       if (response?.success) {
//         this.authToken = {
//           token: response.data.token,
//           refreshToken: response.data.refreshToken,
//           expiresAt: response.data.expiresAt
//         };
        
//         await this.saveTokenToStorage(this.authToken);
//         return true;
//       }
      
//       return false;
//     } catch (error) {
//       console.error('❌ Error refrescando token:', error);
//       return false;
//     }
//   }

//   // ===========================================
//   // ALMACENAMIENTO PERSISTENTE
//   // ===========================================

//   /**
//    * Guarda el token en almacenamiento seguro
//    */
//   private async saveTokenToStorage(token: AuthToken): Promise<void> {
//     await Preferences.set({
//       key: environment.storage.authTokenKey,
//       value: JSON.stringify(token)
//     });
//   }

//   /**
//    * Obtiene el token del almacenamiento
//    */
//   private async getStoredToken(): Promise<AuthToken | null> {
//     const { value } = await Preferences.get({ 
//       key: environment.storage.authTokenKey 
//     });
    
//     return value ? JSON.parse(value) : null;
//   }

//   /**
//    * Guarda los datos del usuario
//    */
//   private async saveUserToStorage(user: User): Promise<void> {
//     await Preferences.set({
//       key: environment.storage.userDataKey,
//       value: JSON.stringify(user)
//     });
//   }

//   /**
//    * Obtiene los datos del usuario del almacenamiento
//    */
//   private async getStoredUser(): Promise<User | null> {
//     const { value } = await Preferences.get({ 
//       key: environment.storage.userDataKey 
//     });
    
//     return value ? JSON.parse(value) : null;
//   }

//   /**
//    * Carga los datos del usuario desde el servidor
//    */
//   private async loadUserData(): Promise<void> {
//     try {
//       // Primero intentar desde almacenamiento local
//       const storedUser = await this.getStoredUser();
//       if (storedUser) {
//         this.currentUserSubject.next(storedUser);
//       }
      
//       // Luego actualizar desde el servidor
//       const url = `${environment.apiUrl}${environment.endpoints.userProfile}`;
//       const response = await this.http.get<ApiResponse<User>>(url).toPromise();
      
//       if (response?.success) {
//         this.currentUserSubject.next(response.data);
//         await this.saveUserToStorage(response.data);
//       }
//     } catch (error) {
//       console.error('❌ Error cargando datos de usuario:', error);
//     }
//   }

//   /**
//    * Limpia todos los datos de autenticación
//    */
//   private async clearAuth(): Promise<void> {
//     this.authToken = null;
//     this.currentUserSubject.next(null);
//     this.isAuthenticatedSubject.next(false);
    
//     await Preferences.remove({ key: environment.storage.authTokenKey });
//     await Preferences.remove({ key: environment.storage.userDataKey });
//   }

//   // ===========================================
//   // UTILIDADES
//   // ===========================================

//   /**
//    * Obtiene el usuario actual de forma síncrona
//    */
//   getCurrentUser(): User | null {
//     return this.currentUserSubject.value;
//   }

//   /**
//    * Verifica si hay un usuario autenticado
//    */
//   isLoggedIn(): boolean {
//     return this.isAuthenticatedSubject.value;
//   }

//   /**
//    * Maneja errores de HTTP
//    */
//   private handleError = (error: HttpErrorResponse): Observable<never> => {
//     let errorMessage = 'Ha ocurrido un error';
    
//     if (error.error instanceof ErrorEvent) {
//       // Error del cliente
//       errorMessage = error.error.message;
//     } else {
//       // Error del servidor
//       switch (error.status) {
//         case 401:
//           errorMessage = 'Credenciales incorrectas';
//           break;
//         case 403:
//           errorMessage = 'Acceso denegado';
//           break;
//         case 404:
//           errorMessage = 'Servicio no disponible';
//           break;
//         case 500:
//           errorMessage = 'Error del servidor';
//           break;
//         default:
//           errorMessage = error.error?.message || 'Error de conexión';
//       }
//     }
    
//     console.error('❌ Error de autenticación:', errorMessage);
//     return throwError(() => new Error(errorMessage));
//   };
// }
