/**
 * TaxPro Mileage - Servicio de GPS y Tracking MEJORADO
 * =====================================================
 * Compatible con cualquier versión de environment.ts
 */

import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject, interval, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Geolocation, Position } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';

import { environment } from '../../environments/environment';
import {
  GpsPoint,
  TrackingState,
  Trip,
  TripPurpose,
  FinishTripData
} from '../models/interfaces';
import { TripService } from './trip.service';
import { TrackingApiService } from './tracking-api.service';
import { MobileTripSyncService } from './mobile-trip-sync.service';
import { CustomerTokenService } from './customer-token.service';

// Configuración por defecto (usada si no está en environment)
const DEFAULT_GPS_CONFIG = {
  updateInterval: 5000,
  minimumAccuracy: 50,
  minimumSpeedForDriving: 2.2,
  drivingDetectionSpeed: 4.2,
  stopTrackingTimeout: 300000,
  minimumStopTime: 120000,
  minimumDistance: 10,
  enableDrivingDetection: true,
  drivingDetectionTime: 30000,
};

@Injectable({
  providedIn: 'root'
})
export class GpsTrackingService {
  private tripService = inject(TripService);
  private trackingApiService = inject(TrackingApiService);
  private ngZone = inject(NgZone);
  private sync = inject(MobileTripSyncService);
  private tokens = inject(CustomerTokenService);

  // Configuración combinada (environment + defaults)
  private readonly config = {
    ...DEFAULT_GPS_CONFIG,
    ...environment.gpsConfig
  };

  // Estado del tracking
  private trackingStateSubject = new BehaviorSubject<TrackingState>({
    isTracking: false,
    isPaused: false,
    routePoints: [],
    elapsedTime: 0,
    currentDistance: 0,
    currentSpeed: 0
  });
  public trackingState$ = this.trackingStateSubject.asObservable();

  // Detección de conducción
  private drivingDetectionSubject = new BehaviorSubject<boolean>(false);
  public drivingDetected$ = this.drivingDetectionSubject.asObservable();

  // ID del watcher de posición
  private watchId: string | null = null;

  // Suscripción al timer
  private timerSubscription: Subscription | null = null;

  // Subject para detener el tracking
  private stopTracking$ = new Subject<void>();

  // Timestamp de la última posición con movimiento
  private lastMovementTime: number = 0;

  // Tiempo que lleva detenido
  private stoppedSince: number = 0;

  // Flag para indicar si está temporalmente detenido
  private isTemporarilyStopped: boolean = false;

  // Timeout para auto-stop
  private autoStopTimeout: ReturnType<typeof setTimeout> | null = null;

  // Watcher para detección de conducción
  private drivingDetectionWatchId: string | null = null;
  private drivingStartTime: number = 0;
  private consecutiveDrivingPoints: number = 0;

  // Configuración de auto-stop (puede ser modificada por el usuario)
  private autoStopMinutes: number = 5;

  // Control de logs para evitar spam
  private lastLoggedPosition: { lat: number; lng: number } | null = null;
  private lastLogTime: number = 0;
  private readonly LOG_INTERVAL_MS = 10000; // Solo log cada 10 segundos máximo
  private readonly POSITION_CHANGE_THRESHOLD = 0.0001; // ~11 metros de diferencia para considerar cambio

  // Contador de puntos ignorados para debugging
  private ignoredPointsCount: number = 0;

  // Sync periódico con el API
  private apiSyncSubscription: Subscription | null = null;
  private readonly API_SYNC_INTERVAL_MS = 30000; // Sync cada 30 segundos

  savedTrip = {} as Trip;

  private accountScope: string|null = null;
  constructor() {
    this.tokens.token$.subscribe(token=> {
      const next=token ? this.sync.scope() : null;
      if(this.accountScope!==next) {
        void this.stopPositionWatcher();void this.stopDrivingDetection();this.stopTimer();this.stopApiSync();this.resetTrackingState();
        this.accountScope=next;
        if(next) void this.restoreTrackingState();
      }
    });
    this.loadAutoStopSetting();
  }

  /**
   * Carga la configuración de auto-stop del usuario
   */
  private async loadAutoStopSetting(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: 'autoStopMinutes' });
      if (value) {
        this.autoStopMinutes = parseInt(value, 10);
      }
    } catch (error) {
      console.error('Error cargando configuración de auto-stop:', error);
    }
  }

  /**
   * Establece el tiempo de auto-stop en minutos
   */
  async setAutoStopMinutes(minutes: number): Promise<void> {
    this.autoStopMinutes = minutes;
    await Preferences.set({
      key: 'autoStopMinutes',
      value: minutes.toString()
    });
  }

  /**
   * Obtiene el tiempo de auto-stop actual
   */
  getAutoStopMinutes(): number {
    return this.autoStopMinutes;
  }

  // ===========================================
  // DETECCIÓN AUTOMÁTICA DE CONDUCCIÓN
  // ===========================================

  /**
   * Inicia la detección de conducción en segundo plano
   * Solo emite eventos cuando detecta conducción real
   */
  async startDrivingDetection(): Promise<void> {
    if (this.drivingDetectionWatchId) return;
    if (!this.config.enableDrivingDetection) return;

    try {
      await this.checkAndRequestPermissions();

      this.drivingDetectionWatchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000
        },
        (position, err) => {
          if (err) {
            // Solo log de errores críticos
            return;
          }

          if (position) {
            this.ngZone.run(() => {
              this.checkIfDriving(position);
            });
          }
        }
      );
    } catch (error) {
      console.error('Error iniciando detección de conducción:', error);
    }
  }

  /**
   * Detiene la detección de conducción
   */
  async stopDrivingDetection(): Promise<void> {
    if (this.drivingDetectionWatchId) {
      await Geolocation.clearWatch({ id: this.drivingDetectionWatchId });
      this.drivingDetectionWatchId = null;
      this.drivingDetectionSubject.next(false);
      this.consecutiveDrivingPoints = 0;
    }
  }

  /**
   * Verifica si el usuario está conduciendo
   * Solo emite log cuando hay cambio de estado significativo
   */
  private checkIfDriving(position: Position): void {
    const speed = position.coords.speed || 0;
    const speedMph = speed * 2.237;
    const drivingThreshold = this.config.drivingDetectionSpeed;

    if (speed >= drivingThreshold) {
      this.consecutiveDrivingPoints++;

      if (this.consecutiveDrivingPoints === 1) {
        this.drivingStartTime = Date.now();
      }

      const drivingTime = Date.now() - this.drivingStartTime;
      const detectionTime = this.config.drivingDetectionTime;

      if (drivingTime >= detectionTime && !this.drivingDetectionSubject.value) {
        // Solo log cuando realmente detecta conducción
        this.logThrottled(`🚗 Conducción detectada (${speedMph.toFixed(0)} MPH)`);
        this.drivingDetectionSubject.next(true);
        this.sendDrivingNotification();
      }
    } else {
      // Reset sin log
      this.consecutiveDrivingPoints = 0;
      this.drivingStartTime = 0;

      if (this.drivingDetectionSubject.value) {
        this.drivingDetectionSubject.next(false);
      }
    }
  }

  /**
   * Envía notificación de conducción detectada
   */
  private async sendDrivingNotification(): Promise<void> {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          title: '🚗 ¿Iniciar tracking?',
          body: 'Parece que estás conduciendo. ¿Quieres registrar este viaje?',
          id: 1,
          actionTypeId: 'DRIVING_DETECTED',
          extra: { action: 'start_tracking' }
        }]
      });
    } catch (error) {
      console.log('Notificaciones no disponibles:', error);
    }
  }

  // ===========================================
  // CONTROL DE TRACKING
  // ===========================================

  /**
   * Inicia el tracking de un nuevo recorrido
   */
  async startTracking(purpose: TripPurpose = 'business'): Promise<void> {
    const scope=this.sync.scope();
    try {
      if(!await this.checkAndRequestPermissions()) throw new Error('Se necesita permiso de ubicacion.');
      await this.stopDrivingDetection();

      const initialPosition = await this.getCurrentPosition();

      if (!initialPosition) {
        throw new Error('No se pudo obtener la ubicación inicial');
      }

      const startPoint: GpsPoint = {
        latitude: initialPosition.coords.latitude,
        longitude: initialPosition.coords.longitude,
        altitude: initialPosition.coords.altitude ?? undefined,
        accuracy: initialPosition.coords.accuracy ?? undefined,
        speed: initialPosition.coords.speed ?? undefined,
        heading: initialPosition.coords.heading ?? undefined,
        timestamp: initialPosition.timestamp
      };

      // Inicializar control de logs
      this.lastLoggedPosition = { lat: startPoint.latitude, lng: startPoint.longitude };
      this.lastLogTime = Date.now();
      this.ignoredPointsCount = 0;

      const newState: TrackingState = {
        tripId: this.generateTripId(),
        purpose,
        isTracking: true,
        isPaused: false,
        routePoints: [startPoint],
        currentPosition: startPoint,
        startTime: startPoint.timestamp,
        elapsedTime: 0,
        currentDistance: 0,
        currentSpeed: (initialPosition.coords.speed || 0) * 2.237,
        lastUpdate: Date.now()
      };

      const vehicle = await firstValueFrom(this.trackingApiService.getProfileVehicle());
      if(!vehicle?.id) throw new Error('Registra un vehiculo antes de iniciar el recorrido.');
      if(this.sync.scope()!==scope) throw new Error('La cuenta cambio durante el inicio.');
      newState.vehicleId = vehicle.id;
      await this.sync.record(newState);
      if(this.sync.scope()!==scope) return;
      this.trackingStateSubject.next(newState);
      await this.saveTrackingState();
      this.lastMovementTime = Date.now();
      this.stoppedSince = 0;
      this.isTemporarilyStopped = false;

      await this.startPositionWatcher();
      this.startTimer();
      this.startApiSync();
      await this.saveTrackingState();

      console.log('Tracking iniciado');

    } catch (error) {
      console.error('❌ Error iniciando tracking:', error);
      throw error;
    }
  }

  /**
   * Pausa el tracking actual (manual)
   */
  async pauseTracking(): Promise<void> {
    const scope=this.sync.scope();
    const currentState = this.trackingStateSubject.value;

    if (!currentState.isTracking || currentState.isPaused) {
      return;
    }

    await this.sync.record(structuredClone(currentState),'pause');
    if(this.sync.scope()!==scope) return;
    this.trackingStateSubject.next({...currentState,isPaused:true});
    await this.saveTrackingState();

    this.stopPositionWatcher();
    this.stopTimer();
    this.stopApiSync();
    this.clearAutoStopTimeout();
  }

  /**
   * Reanuda el tracking pausado
   */
  async resumeTracking(): Promise<void> {
    const scope=this.sync.scope();
    const currentState = this.trackingStateSubject.value;

    if (!currentState.isTracking || !currentState.isPaused) {
      return;
    }

    await this.sync.record(structuredClone(currentState),'resume');
    if(this.sync.scope()!==scope) return;
    this.trackingStateSubject.next({...currentState,isPaused:false});
    await this.saveTrackingState();

    await this.startPositionWatcher();
    this.startTimer();
    this.startApiSync();

    this.lastMovementTime = Date.now();
    this.stoppedSince = 0;
    this.isTemporarilyStopped = false;
  }

  /**
   * Detiene el tracking y finaliza el recorrido
   */
  async stopTracking(autoStopped: boolean = false): Promise<Trip | null> {
    const scope=this.sync.scope();
    const currentState = this.trackingStateSubject.value;

    if (!currentState.isTracking) {
      return null;
    }

    this.stopPositionWatcher();
    this.stopTimer();
    this.stopApiSync();
    this.clearAutoStopTimeout();
    this.stopTracking$.next();

    try {
      const finalPosition = await this.getCurrentPosition();

      let endPoint: GpsPoint;

      if (finalPosition) {
        endPoint = {
          latitude: finalPosition.coords.latitude,
          longitude: finalPosition.coords.longitude,
          altitude: finalPosition.coords.altitude ?? undefined,
          accuracy: finalPosition.coords.accuracy ?? undefined,
          speed: finalPosition.coords.speed ?? undefined,
          heading: finalPosition.coords.heading ?? undefined,
          timestamp: finalPosition.timestamp
        };
      } else {
        endPoint = currentState.routePoints[currentState.routePoints.length - 1];
      }

      if(this.sync.scope()!==scope) return null;
      const finalState = structuredClone(currentState);
      if(!currentState.isPaused && endPoint.timestamp > (finalState.routePoints[finalState.routePoints.length-1]?.timestamp ?? 0))
        finalState.routePoints.push(endPoint);
      const savedTrip = await this.tripService.finishTracking(finalState);
      this.savedTrip = savedTrip;

      this.resetTrackingState();
      await this.clearSavedTrackingState();

      if (this.config.enableDrivingDetection) {
        this.startDrivingDetection();
      }

      // Solo log al finalizar con resumen
      console.log(`✅ Tracking finalizado: ${currentState.currentDistance.toFixed(2)} mi, ${currentState.routePoints.length} puntos`);

      return this.savedTrip || null;

    } catch (error) {
      console.error('❌ Error finalizando tracking:', error);
      await this.saveTrackingState();
      throw error;
    }
  }

  /**
   * Cancela el tracking sin guardar
   */
  async cancelTracking(): Promise<void> {
    const state = this.trackingStateSubject.value;
    if(state.isTracking) await this.sync.record(structuredClone(state),'cancel');
    this.stopPositionWatcher();
    this.stopTimer();
    this.stopApiSync();
    this.clearAutoStopTimeout();
    this.stopTracking$.next();
    this.resetTrackingState();
    await this.clearSavedTrackingState();

    if (this.config.enableDrivingDetection) {
      this.startDrivingDetection();
    }
  }

  // ===========================================
  // WATCHER DE POSICIÓN GPS
  // ===========================================

  private async startPositionWatcher(): Promise<void> {
    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    try {
      this.watchId = await Geolocation.watchPosition(options, (position, err) => {
        if (err) {
          // Solo log de errores críticos, no spam
          return;
        }

        if (position) {
          this.ngZone.run(() => {
            this.handlePositionUpdate(position);
          });
        }
      });
    } catch (error) {
      console.error('❌ Error iniciando watcher GPS:', error);
      throw error;
    }
  }

  private async stopPositionWatcher(): Promise<void> {
    if (this.watchId) {
      await Geolocation.clearWatch({ id: this.watchId });
      this.watchId = null;
    }
  }

  /**
   * Procesa una actualización de posición
   * Solo registra puntos cuando hay movimiento real (conduciendo)
   * Limita los logs para evitar spam en la consola
   */
  private handlePositionUpdate(position: Position): void {
    const currentState = this.trackingStateSubject.value;

    if (!currentState.isTracking || currentState.isPaused) {
      return;
    }

    const newPoint: GpsPoint = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitude: position.coords.altitude ?? undefined,
      accuracy: position.coords.accuracy ?? undefined,
      speed: position.coords.speed ?? undefined,
      heading: position.coords.heading ?? undefined,
      timestamp: position.timestamp
    };

    // Verificar si la posición es significativamente diferente
    const isSamePosition = this.isSamePosition(newPoint.latitude, newPoint.longitude);

    // Si la precisión es muy baja, ignorar silenciosamente
    if (newPoint.accuracy && newPoint.accuracy > this.config.minimumAccuracy) {
      this.ignoredPointsCount++;
      return;
    }

    const currentSpeedMph = (position.coords.speed || 0) * 2.237;
    const lastPoint = currentState.routePoints[currentState.routePoints.length - 1];
    const distanceFromLastFeet = this.calculateDistance(lastPoint, newPoint) * 5280;

    // Criterios más estrictos para considerar que está conduciendo
    // Debe tener velocidad >= 5 MPH O haber movido >= 50 pies (15 metros)
    const isDriving = currentSpeedMph >= 5 || distanceFromLastFeet > 50;

    // Movimiento mínimo: velocidad >= 2 MPH O movido >= 30 pies
    const hasMinimalMovement = currentSpeedMph >= 2 || distanceFromLastFeet > 30;

    if (isDriving) {
      // Está conduciendo activamente
      this.lastMovementTime = Date.now();
      this.ignoredPointsCount = 0;

      if (this.isTemporarilyStopped) {
        this.logThrottled('🚗 Conducción detectada, reanudando tracking...');
        this.isTemporarilyStopped = false;
        this.stoppedSince = 0;
        this.clearAutoStopTimeout();
      }

      // Solo registrar punto si se movió lo suficiente (distancia mínima)
      if (distanceFromLastFeet >= this.config.minimumDistance * 3.281) {
        const newDistance = currentState.currentDistance + this.calculateDistance(lastPoint, newPoint);

        // Actualizar posición de log
        this.lastLoggedPosition = { lat: newPoint.latitude, lng: newPoint.longitude };

        this.trackingStateSubject.next({
          ...currentState,
          routePoints: [...currentState.routePoints, newPoint],
          currentPosition: newPoint,
          currentDistance: newDistance,
          currentSpeed: currentSpeedMph,
          lastUpdate: Date.now()
        });

        this.saveTrackingState();
      } else {
        // Solo actualizar velocidad y posición actual, sin agregar punto a la ruta
        this.trackingStateSubject.next({
          ...currentState,
          currentPosition: newPoint,
          currentSpeed: currentSpeedMph,
          lastUpdate: Date.now()
        });
      }
    } else if (hasMinimalMovement) {
      // Movimiento leve (posible tráfico lento, estacionando, etc.)
      this.lastMovementTime = Date.now();

      // Solo actualizar velocidad, no agregar puntos
      this.trackingStateSubject.next({
        ...currentState,
        currentPosition: newPoint,
        currentSpeed: currentSpeedMph,
        lastUpdate: Date.now()
      });
    } else {
      // Detenido o en el mismo lugar
      if (!this.isTemporarilyStopped) {
        this.isTemporarilyStopped = true;
        this.stoppedSince = Date.now();
        this.logThrottled('⏸️ Vehículo detenido, auto-stop en ' + this.autoStopMinutes + ' min');
        this.scheduleAutoStop();
      }

      // Solo actualizar estado si es necesario (evitar actualizaciones innecesarias)
      if (currentState.currentSpeed !== 0) {
        this.trackingStateSubject.next({
          ...currentState,
          currentSpeed: 0,
          lastUpdate: Date.now()
        });
      }
    }
  }

  /**
   * Verifica si la posición es la misma que la última registrada
   */
  private isSamePosition(lat: number, lng: number): boolean {
    if (!this.lastLoggedPosition) {
      return false;
    }

    const latDiff = Math.abs(lat - this.lastLoggedPosition.lat);
    const lngDiff = Math.abs(lng - this.lastLoggedPosition.lng);

    return latDiff < this.POSITION_CHANGE_THRESHOLD && lngDiff < this.POSITION_CHANGE_THRESHOLD;
  }

  /**
   * Log con throttling para evitar spam en la consola
   */
  private logThrottled(message: string): void {
    const now = Date.now();
    if (now - this.lastLogTime >= this.LOG_INTERVAL_MS) {
      console.log(message);
      this.lastLogTime = now;
    }
  }

  /**
   * Programa el auto-stop después del tiempo configurado
   */
  private scheduleAutoStop(): void {
    if (this.autoStopMinutes === 0) {
      console.log('⏰ Auto-stop desactivado (modo manual)');
      return;
    }

    this.clearAutoStopTimeout();

    const timeoutMs = this.autoStopMinutes * 60 * 1000;

    console.log(`⏰ Auto-stop programado en ${this.autoStopMinutes} minutos`);

    this.autoStopTimeout = setTimeout(() => {
      if (this.isTemporarilyStopped) {
        console.log('⏰ Tiempo de auto-stop alcanzado');
        this.handleAutoStop();
      }
    }, timeoutMs);
  }

  private clearAutoStopTimeout(): void {
    if (this.autoStopTimeout) {
      clearTimeout(this.autoStopTimeout);
      this.autoStopTimeout = null;
    }
  }

  private async handleAutoStop(): Promise<void> {
    const currentState = this.trackingStateSubject.value;

    if (!currentState.isTracking) {
      return;
    }

    console.log('🚗💤 Auto-stop: Finalizando tracking automáticamente...');

    try {
      await this.stopTracking(true);
    } catch (error) {
      console.error('❌ Error en auto-stop:', error);
    }
  }

  // ===========================================
  // TIMER
  // ===========================================

  private startTimer(): void {
    this.timerSubscription = interval(1000).pipe(
      takeUntil(this.stopTracking$)
    ).subscribe(() => {
      const currentState = this.trackingStateSubject.value;

      if (currentState.isTracking && !currentState.isPaused) {
        this.trackingStateSubject.next({
          ...currentState,
          elapsedTime: currentState.elapsedTime + 1
        });
      }
    });
  }

  private stopTimer(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
      this.timerSubscription = null;
    }
  }

  // ===========================================
  // SYNC PERIÓDICO CON API
  // ===========================================

  private startApiSync(): void {
    this.stopApiSync();
    this.apiSyncSubscription = interval(this.API_SYNC_INTERVAL_MS).pipe(
      takeUntil(this.stopTracking$)
    ).subscribe(() => {
      const currentState = this.trackingStateSubject.value;
      if (currentState.isTracking && !currentState.isPaused && currentState.routePoints.length > 0) {
        this.trackingApiService.sendTripPayload(currentState).subscribe({
          error: (err) => console.error('Error en sync periódico con API:', err)
        });
      }
    });
  }

  private stopApiSync(): void {
    if (this.apiSyncSubscription) {
      this.apiSyncSubscription.unsubscribe();
      this.apiSyncSubscription = null;
    }
  }

  // ===========================================
  // UTILIDADES
  // ===========================================

  async getCurrentPosition(): Promise<Position | null> {
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000
      });
      return position;
    } catch (error) {
      console.error('❌ Error obteniendo posición:', error);
      return null;
    }
  }

  calculateDistance(point1: GpsPoint, point2: GpsPoint): number {
    const R = 3959;

    const dLat = this.toRad(point2.latitude - point1.latitude);
    const dLon = this.toRad(point2.longitude - point1.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(point1.latitude)) *
      Math.cos(this.toRad(point2.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private milesToKm(miles: number): number {
    return miles * 1.60934;
  }

  private calculateAverageSpeed(miles: number, seconds: number): number {
    if (seconds === 0) return 0;
    return (miles / seconds) * 3600;
  }

  private calculateMaxSpeed(points: GpsPoint[]): number {
    let maxSpeed = 0;

    for (const point of points) {
      if (point.speed) {
        const speedMph = point.speed * 2.237;
        if (speedMph > maxSpeed) {
          maxSpeed = speedMph;
        }
      }
    }

    return maxSpeed;
  }

  /**
   * Genera un UUID v4 único para identificar el trip.
   * Usa crypto.randomUUID() si está disponible, de lo contrario genera uno manualmente.
   */
  private generateTripId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback: generar UUID v4 manualmente
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ===========================================
  // PERMISOS
  // ===========================================

  async checkAndRequestPermissions(): Promise<boolean> {
    try {
      let permissions = await Geolocation.checkPermissions();

      console.log('📍 Estado de permisos:', permissions.location);

      if (permissions.location !== 'granted') {
        permissions = await Geolocation.requestPermissions();

        if (permissions.location !== 'granted') {
          throw new Error('Permisos de ubicación denegados');
        }
      }

      console.log('✅ Permisos de ubicación concedidos');
      return true;

    } catch (error) {
      console.error('❌ Error con permisos:', error);
      throw error;
    }
  }

  // ===========================================
  // PERSISTENCIA
  // ===========================================

  private async saveTrackingState(): Promise<void> {
    const state = this.trackingStateSubject.value;

    await Preferences.set({
      key: this.sync.trackingKey(),
      value: JSON.stringify(state)
    });
  }

  private async restoreTrackingState(): Promise<void> {
    try {
      const scope=this.sync.scope();
      const { value } = await Preferences.get({
        key: this.sync.trackingKey()
      });

      if(this.sync.scope()!==scope) return;
      if (value) {
        const savedState: TrackingState = JSON.parse(value);
        if(savedState.tripId && ['Completed','Cancelled'].includes(await this.sync.plannedStatus(savedState.tripId) ?? '')) {
          await this.clearSavedTrackingState(); return;
        }

        if (savedState.isTracking) {
          console.log('🔄 Restaurando tracking en progreso...');

          if(this.sync.scope()!==scope) return;
          if(!savedState.isPaused) await this.sync.record(savedState,'pause');
          if(this.sync.scope()!==scope) return;
          savedState.isPaused = true;
          this.trackingStateSubject.next(savedState);
        }
      }
    } catch (error) {
      console.error('❌ Error restaurando estado:', error);
    }
  }

  private async clearSavedTrackingState(): Promise<void> {
    await Preferences.remove({
      key: this.sync.trackingKey()
    });
  }

  async suspendForLogout(): Promise<void> {
    const state=this.trackingStateSubject.value;
    if(state.isTracking && !state.isPaused) await this.sync.record(structuredClone(state),'pause');
    if(state.isTracking) {
      this.trackingStateSubject.next({...state,isPaused:true});
      await this.saveTrackingState();
    }
    await this.stopPositionWatcher();
    await this.stopDrivingDetection();
    this.stopTimer();this.stopApiSync();this.clearAutoStopTimeout();this.resetTrackingState();
  }

  private resetTrackingState(): void {
    this.trackingStateSubject.next({
      isTracking: false,
      isPaused: false,
      routePoints: [],
      elapsedTime: 0,
      currentDistance: 0,
      currentSpeed: 0
    });
    this.isTemporarilyStopped = false;
    this.stoppedSince = 0;
  }

  // ===========================================
  // GETTERS
  // ===========================================

  getCurrentState(): TrackingState {
    return this.trackingStateSubject.value;
  }

  isTrackingActive(): boolean {
    return this.trackingStateSubject.value.isTracking;
  }

  getStoppedTime(): number {
    if (!this.isTemporarilyStopped || this.stoppedSince === 0) {
      return 0;
    }
    return Math.floor((Date.now() - this.stoppedSince) / 1000);
  }

  isVehicleStopped(): boolean {
    return this.isTemporarilyStopped;
  }
}
