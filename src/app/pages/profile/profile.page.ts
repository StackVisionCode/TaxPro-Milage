import { TripService } from '../../services/trip.service';
import { VehicleInput } from '../../models/interfaces';
/**
 * TaxOffix - Página de Perfil MEJORADA
 * ==========================================
 * Incluye:
 * - Foto de perfil editable
 * - Gestión de vehículos (matrícula, foto, millaje)
 * - Configuración de auto-stop
 * - Ajustes de tracking
 */

import {
  Component,
  OnInit,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonToggle,
  IonButton,
  IonIcon,
  IonAvatar,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonSelect,
  IonSelectOption,
  IonChip,
  IonBadge,
  IonNote,
  IonSpinner,
  AlertController,
  ToastController,
  ActionSheetController,
  LoadingController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  personOutline,
  carOutline,
  settingsOutline,
  logOutOutline,
  cameraOutline,
  createOutline,
  trashOutline,
  addOutline,
  speedometerOutline,
  timeOutline,
  locationOutline,
  shieldCheckmarkOutline,
  fingerPrintOutline,
  informationCircleOutline,
  briefcaseOutline,
  imageOutline,
  chevronForwardOutline,
  checkmarkOutline,
  closeOutline,
} from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { firstValueFrom } from 'rxjs';

import { CustomerAuthService } from '../../services/customer-auth.service';
import { GpsTrackingService } from '../../services/gps-tracking.service';
import { User, Vehicle } from '../../models/interfaces';
import { ICustomerProfile } from '../../models/customer-login.interface';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';
import { CustomerTokenService } from '../../services/customer-token.service';
import { TrackingApiService } from '../../services/tracking-api.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonList,
    IonItem,
    IonLabel,
    IonToggle,
    IonButton,
    IonIcon,
    IonAvatar,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonSelect,
    IonSelectOption,
    IonChip,
    IonNote,
  ],
  templateUrl: './profile.page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './profile.page.scss',
})
export class ProfilePage implements OnInit {
  private authService = inject(CustomerAuthService);
  private gpsService = inject(GpsTrackingService);
  private alertController = inject(AlertController);
  private toastController = inject(ToastController);
  private actionSheetController = inject(ActionSheetController);
  private loadingController = inject(LoadingController);
  private router = inject(Router);
  private customerTokenService: CustomerTokenService =
    inject(CustomerTokenService);
  private vehicleService: TrackingApiService = inject(TrackingApiService);

  user: ICustomerProfile | null = null;
  profilePhoto: string | null = null;
  defaultAvatar =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzFhMzY1ZCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iMzUiIHI9IjE4IiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0yMCA4NWMwLTIwIDEzLTMwIDMwLTMwczMwIDEwIDMwIDMwIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==';

  vehicles: Vehicle[] = [];

  autoStopMinutes: number = 5;
  drivingDetectionEnabled: boolean = true;
  defaultPurpose: string = 'business';
  biometricEnabled: boolean = false;
  biometricAvailable: boolean = false;
  biometricType: string = 'huella digital';

  mileageRate: number|null = null;
  mileageCurrency: string|null = null;
  private tripsApi=inject(TripService);
  appVersion = environment.app.version;

  constructor() {
    addIcons({
      personOutline,
      carOutline,
      settingsOutline,
      logOutOutline,
      cameraOutline,
      createOutline,
      trashOutline,
      addOutline,
      speedometerOutline,
      timeOutline,
      locationOutline,
      shieldCheckmarkOutline,
      fingerPrintOutline,
      informationCircleOutline,
      briefcaseOutline,
      imageOutline,
      chevronForwardOutline,
      checkmarkOutline,
      closeOutline,
    });
  }

  async ngOnInit() {
    this.tripsApi.getMileageConfiguration().subscribe({next:c=>{this.mileageRate=c.mileageRate;this.mileageCurrency=c.currency;},error:()=>{this.mileageRate=null;}});
    await this.loadUserData();
    await this.loadBiometricAvailability();
    await this.loadSettings();
    await this.loadVehicles();
  }

  vehiclePhotos: Record<string, string> = {};
  async ionViewWillEnter() {
    await this.refreshAvatar();
    await this.loadVehicles();
  }
  private async refreshAvatar() {
    this.profilePhoto = null;
    try {
      const contact = await firstValueFrom(this.authService.getMyCustomerContact());
      if (contact.avatarFileId) this.profilePhoto = environment.apiUrl + '/storage/avatars/' + encodeURIComponent(contact.avatarFileId);
    } catch { /* Keep the default avatar when the profile cannot be loaded. */ }
  }
  async loadUserData() {
    this.authService.currentCustomer$.subscribe(
      (customer: ICustomerProfile | null) => {
        this.user = customer;
      }
    );

    await this.refreshAvatar();
  }

  async loadSettings() {
    try {
      const autoStop = await Preferences.get({ key: 'autoStopMinutes' });
      if (autoStop.value) {
        this.autoStopMinutes = parseInt(autoStop.value, 10);
      }

      const drivingDetection = await Preferences.get({
        key: 'drivingDetectionEnabled',
      });
      this.drivingDetectionEnabled = drivingDetection.value !== 'false';

      const purpose = await Preferences.get({ key: 'defaultPurpose' });
      if (purpose.value) {
        this.defaultPurpose = purpose.value;
      }

      // Cargar estado real del biométrico desde el servicio
      this.biometricEnabled = await this.authService.isBiometricLoginEnabled();
    } catch (error) {
      console.error('Error cargando configuración:', error);
    }
  }

  async loadVehicles() {
    this.vehicles = [];
    this.vehicleService.getVehicles().subscribe({
      next: vehicles => {
        this.vehicles = vehicles; this.vehiclePhotos = {};
        for (const vehicle of vehicles) if (vehicle.id && vehicle.photo) {
          void this.vehicleService.vehiclePhotoUrl(vehicle.photo).then(url => {
            if (this.vehicles.includes(vehicle)) this.vehiclePhotos[vehicle.id!] = url;
          }).catch(() => undefined);
        }
      },
      error: () => this.showToast('Error loading vehicles', 'danger'),
    });
  }

  private persistVehicle(vehicle: Vehicle): void {
    if (!vehicle.id) return;
    this.vehicleService.updateVehicle(vehicle.id, vehicle).subscribe({
      next: () => { this.loadVehicles(); this.showToast('Vehicle updated'); },
      error: () => { this.loadVehicles(); this.showToast('Error updating vehicle', 'danger'); },
    });
  }

  // ===========================================
  // FOTO DE PERFIL
  // ===========================================

  async changeProfilePhoto() {
    const actionSheet = await this.actionSheetController.create({
      header: 'Cambiar Foto de Perfil',
      buttons: [
        {
          text: 'Tomar Foto',
          icon: 'camera-outline',
          handler: () => this.takePhoto('profile'),
        },
        {
          text: 'Elegir de Galería',
          icon: 'image-outline',
          handler: () => this.pickFromGallery('profile'),
        },
        {
          text: 'Cancelar',
          icon: 'close-outline',
          role: 'cancel',
        },
      ],
    });
    await actionSheet.present();
  }

  async takePhoto(type: 'profile' | 'vehicle', vehicle?: Vehicle) {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });


      if (type === 'profile') {
        await this.uploadProfilePhoto(image.base64String);
      } else if (vehicle) {
        await this.uploadVehiclePhoto(image.base64String, vehicle);
      }
    } catch (error) {
      console.error('Error tomando foto:', error);
    }
  }

  async pickFromGallery(type: 'profile' | 'vehicle', vehicle?: Vehicle) {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: true,
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
      });


      if (type === 'profile') {
        await this.uploadProfilePhoto(image.base64String);
      } else if (vehicle) {
        await this.uploadVehiclePhoto(image.base64String, vehicle);
      }
    } catch (error) {
      console.error('Error seleccionando foto:', error);
    }
  }

  private async uploadProfilePhoto(base64: string | undefined): Promise<void> {
    if (!base64) {
      await this.showToast('No se pudo leer la foto seleccionada', 'danger');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Subiendo y verificando la foto...',
      spinner: 'crescent',
    });
    await loading.present();

    try {
      const file = this.base64ToFile(base64, 'profile.jpg');
      const { fileId } = await firstValueFrom(
        this.authService.uploadMyCustomerAvatar(file)
      );

      const result = await this.waitForAvatarApproval(fileId);
      if (result === 'approved') {
        this.profilePhoto = `${environment.apiUrl}/storage/avatars/${fileId}`;
        await Preferences.remove({ key: 'profilePhoto' });
        await this.showToast('Foto de perfil actualizada');
      } else if (result === 'pending') {
        await this.showToast(
          'La foto está en revisión y aparecerá cuando sea aprobada',
          'medium'
        );
      } else {
        await this.showToast(
          'La foto no fue aprobada. Elige otra imagen.',
          'warning'
        );
      }
    } catch (error) {
      console.error('Error subiendo foto de perfil:', error);
      await this.showToast('No se pudo subir la foto de perfil', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  private base64ToFile(base64: string, fileName: string): File {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0)
    );
    return new File([bytes], fileName, { type: 'image/jpeg' });
  }

  private async waitForAvatarApproval(
    fileId: string
  ): Promise<'approved' | 'pending' | 'rejected'> {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      let contact;
      try {
        contact = await firstValueFrom(this.authService.getMyCustomerContact());
      } catch {
        continue;
      }

      if (contact.avatarFileId === fileId) return 'approved';
      if (
        contact.avatarModerationFileId === fileId &&
        contact.avatarModerationStatus === 'blocked'
      ) {
        return 'rejected';
      }
      if (
        contact.avatarModerationFileId === fileId &&
        contact.avatarModerationStatus === 'under_review'
      ) {
        continue;
      }
      if (
        contact.avatarUploadStatus === 'failed' ||
        contact.pendingAvatarFileId !== fileId
      ) {
        return 'rejected';
      }
    }

    return 'pending';
  }

  // ===========================================
  // VEHÍCULOS
  // ===========================================

  async addVehicle() {
    const alert = await this.alertController.create({
      header: 'Agregar Vehículo',
      message: 'Todos los campos son opcionales excepto la matrícula',
      inputs: [
        { name: 'plate', type: 'text', placeholder: 'Matrícula/Placa *' },
        { name: 'make', type: 'text', placeholder: 'Marca (ej: Toyota)' },
        { name: 'model', type: 'text', placeholder: 'Modelo (ej: Camry)' },
        { name: 'year', type: 'number', placeholder: 'Año (ej: 2020)' },
        {
          name: 'currentMileage',
          type: 'number',
          placeholder: 'Millaje actual',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Agregar',
          handler: (data) => {
            if (!data.plate || data.plate.trim() === '') {
              this.showToast('La matrícula es requerida', 'warning');
              return false;
            }

            const newVehicle: VehicleInput = {
              plate: data.plate.trim().toUpperCase(),
              photo: data.photo || undefined,
              make: data.make?.trim() || environment.make,
              model: data.model?.trim() || environment.model,
              year: data.year ? parseInt(data.year, 10) : environment.year,
              color: data.color?.trim() || environment.color,
              currentMileage: data.currentMileage
                ? parseInt(data.currentMileage, 10)
                : 0,
              isDefault: this.vehicles.length === 0,
            };

            return this.vehicleService
              .createVehicleProfile(newVehicle)
              .subscribe({
                next: async (response: Vehicle) => {
                  if (response) {
                    this.showToast(
                      'The vehicle profile was created successfully'
                    );
                    this.loadVehicles();
                    return true;
                  }

                  this.showToast('The vehicle cannot be created');
                  return false;
                },
                error: (error) => {
                  console.error('Error adding vehicle:', error);
                  this.showToast('Error adding vehicle');
                  return false;
                },
              });
          },
        },
      ],
    });
    await alert.present();
  }

  async editVehicle(vehicle: Vehicle) {
    const alert = await this.alertController.create({
      header: 'Editar Vehículo',
      inputs: [
        {
          name: 'plate',
          type: 'text',
          placeholder: 'Matrícula/Placa',
          value: vehicle.plate,
        },
        {
          name: 'make',
          type: 'text',
          placeholder: 'Marca',
          value: vehicle.make || '',
        },
        {
          name: 'model',
          type: 'text',
          placeholder: 'Modelo',
          value: vehicle.model || '',
        },
        {
          name: 'year',
          type: 'number',
          placeholder: 'Año',
          value: vehicle.year?.toString() || '',
        },
        {
          name: 'currentMileage',
          type: 'number',
          placeholder: 'Millaje actual',
          value: vehicle.currentMileage?.toString() || '0',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: (data) => {
            if (!data.plate || data.plate.trim() === '') {
              this.showToast('La matrícula es requerida', 'warning');
              return false;
            }

            vehicle.plate = data.plate.trim().toUpperCase();
            vehicle.make = data.make?.trim() || undefined;
            vehicle.model = data.model?.trim() || undefined;
            vehicle.year = data.year ? parseInt(data.year, 10) : undefined;
            vehicle.currentMileage = data.currentMileage
              ? parseInt(data.currentMileage, 10)
              : 0;
            vehicle.updatedAt = new Date().toISOString();

            this.persistVehicle(vehicle);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async deleteVehicle(vehicle: Vehicle) {
    const alert = await this.alertController.create({
      header: 'Eliminar Vehículo',
      message: `¿Estás seguro de eliminar el vehículo ${vehicle.plate}?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: () => {
            if (!vehicle.id) return;
            this.vehicleService.deleteVehicle(vehicle.id).subscribe({
              next: () => { this.loadVehicles(); this.showToast('Vehicle deleted'); },
              error: () => this.showToast('Error deleting vehicle', 'danger'),
            });
          },
        },
      ],
    });
    await alert.present();
  }

  async setDefaultVehicle(vehicle: Vehicle) {
    this.persistVehicle({ ...vehicle, isDefault: true });
  }

  async changeVehiclePhoto(vehicle: Vehicle) {
    const sheet = await this.actionSheetController.create({
      header: 'Foto del vehículo', buttons: [
        {text: 'Tomar foto', handler: () => { void this.takePhoto('vehicle', vehicle); }},
        {text: 'Elegir de galería', handler: () => { void this.pickFromGallery('vehicle', vehicle); }},
        {text: 'Cancelar', role: 'cancel'},
      ],
    });
    await sheet.present();
  }
  private async uploadVehiclePhoto(base64: string | undefined, vehicle: Vehicle) {
    const customerId = this.customerTokenService.decodeToken()?.customer_id;
    if (!base64 || !customerId || !vehicle.id) return;
    const loading = await this.loadingController.create({message: 'Subiendo foto del vehículo…'});
    await loading.present();
    try {
      const photo = await this.vehicleService.uploadVehiclePhoto(this.base64ToFile(base64, 'vehicle.jpg'), customerId);
      await firstValueFrom(this.vehicleService.updateVehicle(vehicle.id, {...vehicle, photo}));
      await this.loadVehicles();
      await this.showToast('Foto guardada. Aparecerá cuando finalice su verificación.');
    } catch { await this.showToast('No se pudo guardar la foto del vehículo', 'danger'); }
    finally { await loading.dismiss(); }
  }

  // ===========================================
  // CONFIGURACIÓN
  // ===========================================

  async loadBiometricAvailability() {
    const biometryType = await this.authService.checkBiometricAvailability();
    if (biometryType) {
      this.biometricAvailable = true;
      const { BiometryType } = await import('@capgo/capacitor-native-biometric');
      this.biometricType = biometryType === BiometryType.FACE_ID ? 'Face ID' : 'huella digital';
    }
  }

  async saveAutoStopSetting() {
    await Preferences.set({
      key: 'autoStopMinutes',
      value: this.autoStopMinutes.toString(),
    });
    this.gpsService.setAutoStopMinutes(this.autoStopMinutes);

    if (this.autoStopMinutes === 0) {
      this.showToast('Auto-stop desactivado (solo manual)');
    } else {
      this.showToast(`Auto-stop: ${this.autoStopMinutes} minutos`);
    }
  }

  async saveDrivingDetectionSetting() {
    await Preferences.set({
      key: 'drivingDetectionEnabled',
      value: this.drivingDetectionEnabled.toString(),
    });

    if (this.drivingDetectionEnabled) {
      this.gpsService.startDrivingDetection();
      this.showToast('Detección de conducción activada');
    } else {
      this.gpsService.stopDrivingDetection();
      this.showToast('Detección de conducción desactivada');
    }
  }

  async saveDefaultPurpose() {
    await Preferences.set({
      key: 'defaultPurpose',
      value: this.defaultPurpose,
    });
  }

  async toggleBiometric() {
    if (this.biometricEnabled) {
      // Activar: verificar identidad primero
      try {
        const { NativeBiometric } = await import(
          '@capgo/capacitor-native-biometric'
        );
        await NativeBiometric.verifyIdentity({
          reason: `Confirma tu ${this.biometricType} para activar el login rápido`,
          title: 'Verificar identidad',
          subtitle: `Usa tu ${this.biometricType}`,
          description:
            'Necesitamos verificar tu identidad para activar esta función',
        });

        // Verificación exitosa → guardar credenciales
        await this.authService.setBiometricLoginEnabled(true);
        this.showToast(`Login con ${this.biometricType} activado`);
      } catch (error) {
        console.error('Error activando biometría:', error);
        this.biometricEnabled = false; // Revertir
        this.showToast('No se pudo verificar tu identidad', 'danger');
      }
    } else {
      // Desactivar: no requiere verificación
      try {
        await this.authService.setBiometricLoginEnabled(false);
        this.showToast(`Login con ${this.biometricType} desactivado`);
      } catch (error) {
        console.error('Error desactivando biometría:', error);
        this.biometricEnabled = true; // Revertir
        this.showToast('Error al desactivar login biométrico', 'danger');
      }
    }
  }

  // ===========================================
  // UTILIDADES
  // ===========================================

  async logout() {
    const currentCustomer = this.authService.currentCustomerSubject.value;
    const customerName = currentCustomer
      ? `${currentCustomer.firstName} ${currentCustomer.lastName}`.trim()
      : this.customerTokenService.getCustomerDisplayNameFromToken();

    const alert = await this.alertController.create({
      header: 'Cerrar Sesión',
      message: '¿Estás seguro de que deseas cerrar sesión?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Cerrar Sesión',
          role: 'destructive',
          handler: () =>
            this.authService.logout().subscribe({
              next: async (item: boolean) => {
                if (item) {
                  await this.router.navigate(['/login'], { replaceUrl: true });
                }
              },
              error: async (error) => {
                console.error('Error cerrando sesión:', error);
                await this.showToast('Error cerrando sesión', 'danger');
              },
              complete: () => {
                this.customerTokenService.removeTokens();
                this.authService.currentCustomerSubject.next(null);

                const keysToRemove = Object.keys(localStorage).filter(
                  (key) =>
                    key.startsWith('customer_') ||
                    key.includes('chat_') ||
                    key.includes('webrtc_') ||
                    key.includes('TokenCloud')
                );
                keysToRemove.forEach((key) => localStorage.removeItem(key));
              },
            }),
        },
      ],
    });
    await alert.present();
  }

  private async showToast(message: string, color: string = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color,
    });
    await toast.present();
  }
}
