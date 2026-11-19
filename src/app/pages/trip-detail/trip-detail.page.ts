/**
 * TaxOffix - Página de Detalle del Viaje
 * =============================================
 * Esta página muestra todos los detalles de un viaje específico:
 * - Mapa con la ruta completa dibujada
 * - Estadísticas detalladas (distancia, tiempo, velocidades)
 * - Información de puntos de inicio y fin
 * - Opción de editar propósito y notas
 * - Compartir el viaje
 * - Eliminar el viaje
 */

import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonButton,
  IonChip,
  IonSpinner,
  IonTextarea,
  IonSelect,
  IonSelectOption,
  IonGrid,
  IonRow,
  IonCol,
  AlertController,
  ToastController,
  LoadingController,
  ActionSheetController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  locationOutline,
  flagOutline,
  timeOutline,
  speedometerOutline,
  navigateOutline,
  calendarOutline,
  cashOutline,
  createOutline,
  trashOutline,
  shareOutline,
  carOutline,
  analyticsOutline,
  chevronBackOutline,
  checkmarkOutline,
  closeOutline,
  mapOutline,
  ellipsisVertical,
  alertCircleOutline,
} from 'ionicons/icons';

import { TripService } from '../../services/trip.service';
import { Trip, TripPurpose, GpsPoint } from '../../models/interfaces';
import { Share } from '@capacitor/share';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { environment } from '../../../environments/environment';
import { LngLatBounds, Map, Marker } from 'mapbox-gl/esm';

@Component({
  selector: 'app-trip-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonIcon,
    IonButton,
    IonChip,
    IonSpinner,
    IonTextarea,
    IonSelect,
    IonSelectOption,
    IonGrid,
    IonRow,
    IonCol,
  ],
  templateUrl: './trip-detail.page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './trip-detail.page.scss',
})
export class TripDetailPage implements OnInit, OnDestroy {
  // Servicios
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tripService = inject(TripService);
  private alertController = inject(AlertController);
  private toastController = inject(ToastController);
  private loadingController = inject(LoadingController);
  private actionSheetController = inject(ActionSheetController);

  // Referencia al elemento del mapa
  @ViewChild('mapElement') mapElement!: ElementRef;

  // Datos del viaje
  trip: Trip | null = null;
  tripId: string = '';

  // Estados
  isLoading = true;
  error: string | null = null;
  mapLoaded = false;
  isEditing = false;
  isSaving = false;

  // Datos de edición
  editPurpose: TripPurpose = 'business';
  editNotes: string = '';

  // Direcciones
  startAddress: string = '';
  endAddress: string = '';

  // Tarifa por milla (desde environment.app.mileageRate)


  private map: Map | null = null;

  constructor() {
    addIcons({
      locationOutline,
      flagOutline,
      timeOutline,
      speedometerOutline,
      navigateOutline,
      calendarOutline,
      cashOutline,
      createOutline,
      trashOutline,
      shareOutline,
      carOutline,
      analyticsOutline,
      chevronBackOutline,
      checkmarkOutline,
      closeOutline,
      mapOutline,
      ellipsisVertical,
      alertCircleOutline,
    });
  }

  ngOnInit() {
    this.tripId = this.route.snapshot.paramMap.get('id') || '';

    if (this.tripId) {
      this.loadTrip();
    } else {
      this.error = 'ID de viaje no válido';
      this.isLoading = false;
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  async loadTrip(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      this.trip =
        (await this.tripService.getTripById(this.tripId).toPromise()) || null;

      if (this.trip) {
        this.editPurpose = this.trip.purpose;
        this.editNotes = this.trip.notes || '';
        setTimeout(() => this.initMap(), 100);
      } else {
        this.error = 'Viaje no encontrado';
      }
    } catch (err: any) {
      console.error('Error cargando viaje:', err);
      this.error = err.message || 'Error al cargar el viaje';
    } finally {
      this.isLoading = false;
    }
  }

  private async initMap(): Promise<void> {
    if (!this.trip?.route || this.trip.route.length === 0) {
      console.log('No hay ruta para mostrar');
      return;
    }

    try {
      const route = this.trip.route;
      const startPoint = route[0];
      const endPoint = route[route.length - 1];

      const bounds = new LngLatBounds();
      route.forEach((point: GpsPoint) => {
        bounds.extend([point.longitude, point.latitude]);
      });

      this.map?.remove();
      this.map = new Map({
        accessToken: environment.mapbox.accessToken,
        container: this.mapElement.nativeElement,
        style: environment.mapbox.style,
        center: [startPoint.longitude, startPoint.latitude],
        zoom: 14,
      });

      await new Promise<void>((resolve, reject) => {
        this.map!.once('load', () => resolve());
        this.map!.once('error', (event) => reject(event.error));
      });

      const routePath: [number, number][] = route.map((point: GpsPoint) => [
        point.longitude,
        point.latitude,
      ]);

      this.map.addSource('trip-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: routePath },
        },
      });
      this.map.addLayer({
        id: 'trip-route-line',
        type: 'line',
        source: 'trip-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3182ce',
          'line-opacity': 1,
          'line-width': 4,
        },
      });

      new Marker({ color: '#38a169', scale: 0.8 })
        .setLngLat([startPoint.longitude, startPoint.latitude])
        .addTo(this.map);
      new Marker({ color: '#e53e3e', scale: 0.8 })
        .setLngLat([endPoint.longitude, endPoint.latitude])
        .addTo(this.map);

      this.map.fitBounds(bounds, { padding: 50, maxZoom: 16 });

      this.mapLoaded = true;

      this.getAddressFromCoords(
        startPoint.latitude,
        startPoint.longitude,
        'start'
      );
      this.getAddressFromCoords(endPoint.latitude, endPoint.longitude, 'end');
    } catch (error) {
      console.error('Error inicializando mapa:', error);
    }
  }

  private async getAddressFromCoords(
    lat: number,
    lng: number,
    type: 'start' | 'end'
  ): Promise<void> {
    const params = new URLSearchParams({
      longitude: String(lng),
      latitude: String(lat),
      access_token: environment.mapbox.accessToken,
    });

    try {
      const response = await fetch(
        `https://api.mapbox.com/search/geocode/v6/reverse?${params}`
      );
      if (!response.ok) return;

      const body = await response.json();
      const feature = body?.features?.[0];
      const address =
        feature?.properties?.full_address ??
        feature?.properties?.name ??
        feature?.place_name;
      if (!address) return;

      if (type === 'start') this.startAddress = address;
      else this.endAddress = address;
    } catch (error) {
      console.warn('No se pudo resolver la dirección con Mapbox:', error);
    }
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return '';
    try {
      return format(new Date(dateString), "EEEE, d 'de' MMMM yyyy", {
        locale: es,
      });
    } catch {
      return dateString;
    }
  }

  formatTime(dateString: string | undefined): string {
    if (!dateString) return '';
    try {
      return format(new Date(dateString), 'h:mm a');
    } catch {
      return '';
    }
  }

  formatDurationShort(seconds: number | undefined): string {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  calculateDeduction(): number | null {
    return this.trip?.estimatedAmount ?? null;
  }

  getPurposeLabel(purpose: TripPurpose | undefined): string {
    const labels: Record<TripPurpose, string> = {
      business: 'Negocios',
      medical: 'Médico',
      moving: 'Mudanza',
      personal: 'Personal',
      charity: 'Beneficencia',
    };
    return labels[purpose || 'personal'];
  }

  getPurposeColor(purpose: TripPurpose | undefined): string {
    const colors: Record<TripPurpose, string> = {
      business: 'primary',
      medical: 'danger',
      moving: 'warning',
      personal: 'medium',
      charity: 'tertiary',
    };
    return colors[purpose || 'personal'];
  }

  async showActions(): Promise<void> {
    const actionSheet = await this.actionSheetController.create({
      header: 'Opciones',
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => this.startEdit(),
        },
        {
          text: 'Compartir',
          icon: 'share-outline',
          handler: () => this.shareTrip(),
        },
        {
          text: 'Eliminar',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => this.confirmDelete(),
        },
        { text: 'Cancelar', icon: 'close-outline', role: 'cancel' },
      ],
    });
    await actionSheet.present();
  }

  startEdit(): void {
    if (this.trip) {
      this.editPurpose = this.trip.purpose;
      this.editNotes = this.trip.notes || '';
      this.isEditing = true;
    }
  }

  cancelEdit(): void {
    this.isEditing = false;
  }

  async saveChanges(): Promise<void> {
    if (!this.trip) return;
    if(this.trip.syncState==='pending') {await this.showToast('Espera a que el recorrido se sincronice.');return;}
    this.isSaving = true;

    try {
      const updated = await this.tripService
        .updateTrip(this.trip.id, {
          purpose: this.editPurpose,
          notes: this.editNotes,
        })
        .toPromise();

      if(updated) this.trip = updated;
      this.isEditing = false;
      await this.showToast('Viaje actualizado');
    } catch (error: any) {
      console.error('Error guardando cambios:', error);
      await this.showToast('Error al guardar cambios', 'danger');
    } finally {
      this.isSaving = false;
    }
  }

  async shareTrip(): Promise<void> {
    if (!this.trip) return;

    const deduction = this.calculateDeduction();
    const text = `📍 TaxOffix - Resumen de Viaje

📅 Fecha: ${this.formatDate(this.trip.startTime)}
🚗 Distancia: ${this.trip.distanceMiles.toFixed(2)} millas
⏱️ Duración: ${this.formatDurationShort(this.trip.durationSeconds)}
🏷️ Propósito: ${this.getPurposeLabel(this.trip.purpose)}
💰 Deducción estimada: ${deduction == null ? 'Sin tarifa configurada' : deduction.toFixed(2)+' '+(this.trip.currency ?? '')}

Registrado con TaxOffix`;

    try {
      await Share.share({
        title: 'Resumen de Viaje',
        text: text,
        dialogTitle: 'Compartir viaje',
      });
    } catch (error) {
      console.error('Error compartiendo:', error);
    }
  }

  async confirmDelete(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Eliminar Viaje',
      message:
        '¿Estás seguro de que deseas eliminar este viaje? Esta acción no se puede deshacer.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: () => this.deleteTrip(),
        },
      ],
    });
    await alert.present();
  }

  async deleteTrip(): Promise<void> {
    if (!this.trip) return;

    if(this.trip.syncState==='pending') {await this.showToast('Espera a que el recorrido se sincronice.');return;}
    const loading = await this.loadingController.create({
      message: 'Eliminando viaje...',
    });
    await loading.present();

    try {
      await this.tripService.deleteTrip(this.trip.id).toPromise();
      await loading.dismiss();
      await this.showToast('Viaje eliminado');
      this.router.navigate(['/tabs/history'], { replaceUrl: true });
    } catch (error: any) {
      await loading.dismiss();
      console.error('Error eliminando viaje:', error);
      await this.showToast('Error al eliminar el viaje', 'danger');
    }
  }

  private async showToast(
    message: string,
    color: string = 'success'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color,
    });
    await toast.present();
  }
}
