import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, EMPTY, firstValueFrom } from 'rxjs';
import { expand, map, reduce } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import {
  TrackingState,
  Vehicle,
  VehicleInput,
  VehiclePage,
  IPersonalData,
} from '../models/interfaces';
import { MobileTripSyncService } from './mobile-trip-sync.service';

@Injectable({
  providedIn: 'root',
})
export class TrackingApiService {
  private http = inject(HttpClient);
  private sync = inject(MobileTripSyncService);

  urlVehicle: string = environment.apiUrl + environment.endpoints.profileVehicle;
  urlGetVehicle: string = environment.apiUrl + environment.endpoints.getProfileVehicle;

  dataVehicle = '';

  sendTripPayload(state: TrackingState): Observable<void> {
    return from(this.sync.record(structuredClone(state)));
  }

  createVehicleProfile(payload: VehicleInput): Observable<Vehicle> {
    return this.http.post<Vehicle>(this.urlVehicle, this.vehicleBody(payload));
  }

  getVehicles(): Observable<Vehicle[]> {
    const page = (number: number) =>
      this.http.get<VehiclePage>(this.urlVehicle, {
        params: { page: number, size: 100 },
      });
    return page(1).pipe(
      expand((result) => (result.hasMore ? page(result.page + 1) : EMPTY)),
      reduce((vehicles, result) => [...vehicles, ...result.items], [] as Vehicle[])
    );
  }

  getVehicle(id: string): Observable<Vehicle> {
    return this.http.get<Vehicle>(`${this.urlVehicle}/${encodeURIComponent(id)}`);
  }

  updateVehicle(id: string, payload: VehicleInput): Observable<Vehicle> {
    return this.http.put<Vehicle>(
      `${this.urlVehicle}/${encodeURIComponent(id)}`,
      this.vehicleBody(payload)
    );
  }

  deleteVehicle(id: string): Observable<void> {
    return this.http.delete<void>(`${this.urlVehicle}/${encodeURIComponent(id)}`);
  }

  getProfileVehicle(_data?: IPersonalData): Observable<Vehicle | null> {
    return this.getVehicles().pipe(
      map((vehicles) => vehicles.find((vehicle) => vehicle.isDefault) ?? vehicles[0] ?? null)
    );
  }

  async uploadVehiclePhoto(file: File, customerId: string): Promise<string> {
    const base = environment.apiUrl + '/storage/files';
    const upload = await firstValueFrom(this.http.post<{fileId: string; uploadUrl: string; formData: Record<string,string>}>(base + '/uploads', {
      originalName: file.name, contentType: file.type, sizeBytes: file.size,
      ownerType: 'Customer', ownerId: customerId, folderType: 'Other', taxYear: null,
    }));
    const form = new FormData();
    Object.entries(upload.formData).forEach(([k,v]) => form.append(k,v));
    form.append('file', file);
    const response = await fetch(upload.uploadUrl, {method: 'POST', body: form});
    if (!response.ok) throw new Error('No se pudo subir la foto.');
    await firstValueFrom(this.http.post(base + '/' + upload.fileId + '/complete', {}));
    return 'storage:' + upload.fileId;
  }
  async vehiclePhotoUrl(photo: string): Promise<string> {
    if (!photo.startsWith('storage:')) return photo;
    const result = await firstValueFrom(this.http.post<{downloadUrl: string}>(environment.apiUrl + '/storage/files/' + encodeURIComponent(photo.slice(8)) + '/download-url', {}));
    return result.downloadUrl;
  }

  private vehicleBody(vehicle: VehicleInput): VehicleInput {
    const { plate, make, model, year, color, photo, currentMileage, isDefault } = vehicle;
    return { plate, make, model, year, color, photo, currentMileage, isDefault };
  }
}
