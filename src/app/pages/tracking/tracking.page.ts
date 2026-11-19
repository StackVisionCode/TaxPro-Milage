import { toSignal } from '@angular/core/rxjs-interop';
import { MobileTripSyncService } from '../../services/mobile-trip-sync.service';
import { firstValueFrom } from 'rxjs';
import { TripService } from '../../services/trip.service';
/**
 * ============================================================
 * TRACKING PAGE - Página Principal de Seguimiento GPS
 * ============================================================
 *
 * Esta página es el corazón de la aplicación. Aquí el usuario:
 * - Ve su ubicación actual en Mapbox
 * - Inicia/Pausa/Detiene el seguimiento de millas
 * - Ve en tiempo real la ruta que está recorriendo
 * - Observa estadísticas del viaje actual (distancia, tiempo, velocidad)
 *
 * CARACTERÍSTICAS:
 * - Integración con Mapbox GL JS
 * - Dibujo de polyline del recorrido en tiempo real
 * - Marcadores de inicio/fin del viaje
 * - Actualización automática de estadísticas
 * - Selector de propósito del viaje (negocio, médico, etc.)
 * - Detección automática de parada (auto-stop)
 */

import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonFab,
  IonFabButton,
  IonFabList,
  IonSpinner,
  IonAlert,
  IonToast,
  IonActionSheet,
  IonChip,
  IonLabel,
  AlertController,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  playOutline,
  pauseOutline,
  stopOutline,
  locationOutline,
  navigateOutline,
  timeOutline,
  speedometerOutline,
  mapOutline,
  carSportOutline,
  briefcaseOutline,
  medkitOutline,
  heartOutline,
  homeOutline,
  ellipsisHorizontalOutline,
  refreshOutline,
  warningOutline,
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { GeoJSONSource, Map, Marker } from 'mapbox-gl/esm';

import { GpsTrackingService } from '../../services/gps-tracking.service';
import { TrackingState, TripPurpose, GpsPoint } from '../../models/interfaces';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-tracking',
  standalone: true,
  imports: [
    FormsModule,
    IonContent,
    IonButton,
    IonIcon,
    IonSpinner,
    IonToast,
  ],
  templateUrl: './tracking.page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tracking.page.scss',
})
export class TrackingPage implements OnInit, OnDestroy {
  // Referencias del DOM
  @ViewChild('mapElement', { static: true }) mapElement!: ElementRef;

  // Estado del mapa
  isLoadingMap = signal(true);
  mapError = signal<string | null>(null);

  // Estado del tracking (viene del servicio)
  trackingState = signal<TrackingState | null>(null);

  // Propósito seleccionado
  selectedPurpose = signal<TripPurpose | null>(null);

  // Estados de UI
  isStartingTracking = signal(false);

  // Toast notifications
  showToast = signal(false);
  toastMessage = signal('');
  toastColor = signal('primary');

  private readonly routeSourceId = 'active-route';
  private readonly routeLayerId = 'active-route-line';
  private map: Map | null = null;
  private currentPositionMarker: Marker | null = null;
  private startMarker: Marker | null = null;
  private endMarker: Marker | null = null;

  // Subscriptions
  private trackingSubscription?: Subscription;
  private drivingDetectionSubscription?: Subscription;

  // Detección de movimiento
  showDrivingPrompt = signal(false);

  private gpsTrackingService = inject(GpsTrackingService);
  private alertController = inject(AlertController);
  private toastController = inject(ToastController);

  constructor() {
    // Registrar iconos de Ionicons
    addIcons({
      playOutline,
      pauseOutline,
      stopOutline,
      locationOutline,
      navigateOutline,
      timeOutline,
      speedometerOutline,
      mapOutline,
      carSportOutline,
      briefcaseOutline,
      medkitOutline,
      heartOutline,
      homeOutline,
      ellipsisHorizontalOutline,
      refreshOutline,
      warningOutline,
    });
  }

  private tripsApi = inject(TripService);
  private syncQueue=inject(MobileTripSyncService);
  readonly pendingSync=toSignal(this.syncQueue.pendingCount$, {initialValue:0});
  readonly syncError=toSignal(this.syncQueue.error$, {initialValue:null});
  private officeRate: number|null = null;
  private officeCurrency: string|null = null;
  async ngOnInit() {
    console.log('🗺️ TrackingPage: Inicializando...');

    // Suscribirse al estado del tracking
    this.trackingSubscription =
      this.gpsTrackingService.trackingState$.subscribe((state) => {
        console.log('📍 Estado de tracking actualizado:', state);
        this.trackingState.set(state);

        // Actualizar el mapa con la nueva posición
        if (state.routePoints.length > 0) {
          this.updateMapWithRoute(state.routePoints);
        }
      });

    // Suscribirse a la detección de conducción
    this.drivingDetectionSubscription =
      this.gpsTrackingService.drivingDetected$.subscribe(async (isDetected) => {
        if (isDetected && !this.trackingState()?.isTracking) {
          console.log('🚗 Conducción detectada, mostrando prompt...');
          await this.showDrivingDetectedAlert();
        }
      });

    await this.loadMapbox();
  }

  ngOnDestroy() {
    // Limpiar subscripciones
    if (this.trackingSubscription) {
      this.trackingSubscription.unsubscribe();
    }
    if (this.drivingDetectionSubscription) {
      this.drivingDetectionSubscription.unsubscribe();
    }
    this.map?.remove();
    this.map = null;
  }

  /**
   * Muestra alerta cuando se detecta conducción
   */
  async showDrivingDetectedAlert() {
    const alert = await this.alertController.create({
      header: '🚗 ¡Movimiento Detectado!',
      message:
        'Parece que estás conduciendo. ¿Deseas iniciar el tracking de millas?',
      cssClass: 'driving-detected-alert',
      backdropDismiss: false,
      buttons: [
        {
          text: 'No, gracias',
          role: 'cancel',
          handler: () => {
            console.log('Usuario rechazó iniciar tracking');
          },
        },
        {
          text: 'Sí, iniciar',
          handler: () => {
            // Mostrar selector de propósito
            this.showPurposeSelectorForAutoStart();
          },
        },
      ],
    });

    await alert.present();
  }

  /**
   * Muestra selector de propósito para inicio automático
   */
  async showPurposeSelectorForAutoStart() {
    const alert = await this.alertController.create({
      header: 'Selecciona el Propósito',
      message: '¿Cuál es el propósito de este viaje?',
      inputs: [
        {
          name: 'purpose',
          type: 'radio',
          label: 'Negocios',
          value: 'business',
          checked: true,
        },
        {
          name: 'purpose',
          type: 'radio',
          label: 'Médico',
          value: 'medical',
        },
        {
          name: 'purpose',
          type: 'radio',
          label: 'Mudanza',
          value: 'moving',
        },
      ],
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Iniciar',
          handler: async (purpose) => {
            if (purpose) {
              this.selectedPurpose.set(purpose);
              await this.startTracking();
            }
          },
        },
      ],
    });

    await alert.present();
  }

  /**
   * ============================================================
   * CARGA DE MAPBOX
   * ============================================================
   * Inicializa el mapa centrado en la ubicación del usuario.
   */
  private async loadMapbox() {
    console.log('🗺️ Cargando Mapbox...');
    this.isLoadingMap.set(true);
    this.mapError.set(null);

    if (!environment.mapbox.accessToken) {
      this.mapError.set('Token público de Mapbox no configurado.');
      this.isLoadingMap.set(false);
      return;
    }

    try {
      await this.initializeMap();
    } catch (error) {
      console.error('❌ Error cargando Mapbox:', error);
      this.mapError.set(
        'Error al cargar el mapa. Verifica tu conexión a internet.'
      );
      this.isLoadingMap.set(false);
    }
  }

  private async initializeMap() {
    try {
      const position = await this.getCurrentPosition();
      this.map?.remove();

      this.map = new Map({
        accessToken: environment.mapbox.accessToken,
        container: this.mapElement.nativeElement,
        style: environment.mapbox.style,
        center: [position.longitude, position.latitude],
        zoom: 16,
      });

      await new Promise<void>((resolve, reject) => {
        this.map!.once('load', () => resolve());
        this.map!.once('error', (event) => reject(event.error));
      });

      const isDarkMode = document.body.classList.contains('dark');

      this.currentPositionMarker = new Marker({
        color: isDarkMode ? '#60a5fa' : '#3182ce',
        scale: 0.85,
      })
        .setLngLat([position.longitude, position.latitude])
        .addTo(this.map);

      this.map.addSource(this.routeSourceId, {
        type: 'geojson',
        data: this.routeFeature([]),
      });
      this.map.addLayer({
        id: this.routeLayerId,
        type: 'line',
        source: this.routeSourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': isDarkMode ? '#60a5fa' : '#1a365d',
          'line-width': 4,
        },
      });

      const existingRoute = this.trackingState()?.routePoints ?? [];
      if (existingRoute.length > 0) this.updateMapWithRoute(existingRoute);

      console.log('✅ Mapa inicializado correctamente');
      this.isLoadingMap.set(false);
    } catch (error) {
      console.error('❌ Error inicializando mapa:', error);
      this.mapError.set(
        'No se pudo obtener tu ubicación. Verifica los permisos de GPS.'
      );
      this.isLoadingMap.set(false);
    }
  }

  /**
   * Obtiene la posición actual del usuario usando el servicio de GPS
   */
  private getCurrentPosition(): Promise<{
    latitude: number;
    longitude: number;
  }> {
    return new Promise((resolve, reject) => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        reject(new Error('Geolocalización no soportada'));
      }
    });
  }

  /**
   * Reintentar cargar el mapa
   */
  retryLoadMap() {
    this.loadMapbox();
  }

  /**
   * ============================================================
   * ACTUALIZACIÓN DEL MAPA CON LA RUTA
   * ============================================================
   */
  private updateMapWithRoute(routePoints: GpsPoint[]) {
    if (!this.map || !this.map.isStyleLoaded() || routePoints.length === 0) return;

    const path: [number, number][] = routePoints.map((point) => [
      point.longitude,
      point.latitude,
    ]);

    const source = this.map.getSource(this.routeSourceId) as
      | GeoJSONSource
      | undefined;
    source?.setData(this.routeFeature(path));

    // Mover marcador de posición actual al último punto
    const lastPoint = path[path.length - 1];
    if (this.currentPositionMarker) {
      this.currentPositionMarker.setLngLat(lastPoint);
    }

    this.map.easeTo({ center: lastPoint, duration: 400 });

    if (!this.startMarker) {
      this.startMarker = new Marker({ color: '#38a169', scale: 0.8 })
        .setLngLat(path[0])
        .addTo(this.map);
    }
  }

  private routeFeature(coordinates: [number, number][]) {
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates,
      },
    };
  }

  /**
   * ============================================================
   * CONTROLES DE TRACKING
   * ============================================================
   */

  /**
   * Seleccionar propósito del viaje
   */
  selectPurpose(purpose: TripPurpose) {
    this.selectedPurpose.set(purpose);
    console.log('🎯 Propósito seleccionado:', purpose);
  }

  /**
   * Iniciar tracking
   */
  async startTracking() {
    const purpose = this.selectedPurpose();
    if (!purpose) {
      this.showNotification('Selecciona un propósito para el viaje', 'warning');
      return;
    }

    this.isStartingTracking.set(true);

    try {
      const rate=await firstValueFrom(this.tripsApi.getMileageConfiguration(purpose));
      this.officeRate=rate.mileageRate;this.officeCurrency=rate.currency;
      await this.gpsTrackingService.startTracking(purpose);
      this.showNotification('¡Tracking iniciado! Buen viaje 🚗', 'success');

      // Limpiar marcadores anteriores
      if (this.startMarker) {
        this.startMarker.remove();
        this.startMarker = null;
      }
      if (this.endMarker) {
        this.endMarker.remove();
        this.endMarker = null;
      }
      this.clearRouteLine();
    } catch (error: any) {
      console.error('❌ Error iniciando tracking:', error);
      this.showNotification(
        error.message || 'Error al iniciar el tracking',
        'danger'
      );
    } finally {
      this.isStartingTracking.set(false);
    }
  }

  /**
   * Pausar tracking
   */
  async pauseTracking() {
    try { await this.gpsTrackingService.pauseTracking(); } catch(error) { this.showNotification('No se pudo guardar la pausa','danger'); return; }
    this.showNotification('Tracking pausado', 'warning');
  }

  /**
   * Reanudar tracking
   */
  async resumeTracking() {
    try { await this.gpsTrackingService.resumeTracking(); } catch(error) { this.showNotification('No se pudo guardar la reanudacion','danger'); return; }
    this.showNotification('Tracking reanudado', 'success');
  }

  /**
   * Confirmar detención del tracking
   */
  async confirmStopTracking() {
    const alert = await this.alertController.create({
      header: 'Finalizar Recorrido',
      message:
        '¿Estás seguro de que deseas finalizar este recorrido? Los datos se guardarán automáticamente.',
      cssClass: 'taxpro-alert',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Finalizar',
          role: 'confirm',
          handler: () => this.stopTracking(),
        },
      ],
    });

    await alert.present();
  }

  /**
   * Detener tracking
   */
  async stopTracking() {
    try {
      // Obtener estado antes de detener para mostrar marcador de fin
      const stateBeforeStop = this.trackingState();

      const savedTrip = await this.gpsTrackingService.stopTracking();

      // Añadir marcador de fin
      if (stateBeforeStop && stateBeforeStop.routePoints.length > 0) {
        const lastPoint =
          stateBeforeStop.routePoints[stateBeforeStop.routePoints.length - 1];
        if (this.map) {
          this.endMarker = new Marker({ color: '#e53e3e', scale: 0.8 })
            .setLngLat([lastPoint.longitude, lastPoint.latitude])
            .addTo(this.map);
        }
      }

      this.showNotification(savedTrip?.syncState === 'pending' ? 'Recorrido guardado en el dispositivo. Sincronizacion pendiente.' : 'Recorrido sincronizado correctamente.', 'success');

      // Reiniciar completamente el estado
      this.resetTrackingUI();
    } catch (error: any) {
      console.error('❌ Error deteniendo tracking:', error);
      this.showNotification(
        error.message || 'Error al finalizar el recorrido',
        'danger'
      );
    }
  }

  /**
   * Reinicia la UI del tracking completamente
   */
  private resetTrackingUI() {
    // Limpiar propósito seleccionado
    this.selectedPurpose.set(null);

    // Limpiar marcadores después de un tiempo para que el usuario vea el resultado
    setTimeout(() => {
      if (this.startMarker) {
        this.startMarker.remove();
        this.startMarker = null;
      }
      if (this.endMarker) {
        this.endMarker.remove();
        this.endMarker = null;
      }
      this.clearRouteLine();
    }, 3000);
  }

  private clearRouteLine(): void {
    if (!this.map || !this.map.isStyleLoaded()) return;
    const source = this.map.getSource(this.routeSourceId) as
      | GeoJSONSource
      | undefined;
    source?.setData(this.routeFeature([]));
  }

  /**
   * ============================================================
   * FUNCIONES DE FORMATO Y UTILIDAD
   * ============================================================
   */

  formatDistance(miles: number): string {
    return miles.toFixed(2);
  }

  formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  formatSpeed(mph: number): string {
    // currentSpeed del servicio ya viene en MPH
    return mph.toFixed(0);
  }

  calculateDeduction(miles: number): string {
    if(this.officeRate==null) return 'Sin tarifa configurada';
    return `${(miles*this.officeRate).toFixed(2)} ${this.officeCurrency ?? ''}`;
  }

  getStatusColor(): string {
    const state = this.trackingState();
    if (!state?.isTracking) return 'medium';
    if (state.isPaused) return 'warning';
    return 'success';
  }

  getStatusText(): string {
    const state = this.trackingState();
    if (!state?.isTracking) return 'Inactivo';
    if (state.isPaused) return 'Pausado';
    return 'Activo';
  }

  getPurposeIcon(purpose?: TripPurpose): string {
    const icons: Record<TripPurpose, string> = {
      business: 'briefcase-outline',
      medical: 'medkit-outline',
      moving: 'home-outline',
      personal: 'car-sport-outline',
      charity: 'heart-outline',
    };
    return icons[purpose || 'personal'];
  }

  getPurposeLabel(purpose?: TripPurpose): string {
    const labels: Record<TripPurpose, string> = {
      business: 'Negocios',
      medical: 'Médico',
      moving: 'Mudanza',
      personal: 'Personal',
      charity: 'Beneficencia',
    };
    return labels[purpose || 'personal'];
  }

  getPurposeColor(purpose?: TripPurpose): string {
    const colors: Record<TripPurpose, string> = {
      business: 'primary',
      medical: 'danger',
      moving: 'secondary',
      personal: 'medium',
      charity: 'tertiary',
    };
    return colors[purpose || 'personal'];
  }

  /**
   * Mostrar notificación toast
   */
  private showNotification(message: string, color: string = 'primary') {
    this.toastMessage.set(message);
    this.toastColor.set(color);
    this.showToast.set(true);
  }
}
