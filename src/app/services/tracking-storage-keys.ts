import { environment } from '../../environments/environment';

/** Capacitor Preferences uses localStorage on web and native preferences on devices. */
export function isPendingTrackingStorageKey(key: string): boolean {
  const logical = key.replace(/^CapacitorStorage\./, '');
  return (
    logical.startsWith('mobile_sync_v1:') ||
    logical.startsWith('mobile_tracking_v1:') ||
    logical.startsWith('pending_trip_') ||
    logical === 'pending_trips' ||
    logical === environment.storage.tempTrackingKey
  );
}
