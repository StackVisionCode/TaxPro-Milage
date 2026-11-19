import { GpsPoint, Trip, TripPurpose, TripStatus } from './interfaces';
export interface MobileTrip {
  id: string;
  clientTripId: string;
  vehicleId: string;
  vehiclePlate: string;
  status: TripStatus;
  purpose: TripPurpose;
  notes?: string;
  startTime: string;
  endTime?: string;
  distanceMeters: number;
  distanceMiles: number;
  distanceKm: number;
  durationSeconds: number;
  averageSpeedMph: number;
  maxSpeedMph: number;
  revision: number;
  lastAcceptedPointSequence: number;
  mileageRateId?: string;
  ratePerMile: number | null;
  currency: string | null;
  estimatedAmount: number | null;
  createdAt: string;
  updatedAt: string;
  replayed: boolean;
}
export interface MobilePoint {
  sequence: number;
  observedAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedMetersPerSecond?: number;
  altitudeMeters?: number;
  heading?: number;
}
export interface MobilePage<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
  hasMore: boolean;
}
export interface PointPage {
  items: MobilePoint[];
  nextAfter: number;
  hasMore: boolean;
}
export interface MileageConfiguration {
  date: string;
  purpose: TripPurpose;
  distanceUnit: string;
  rateId: string | null;
  mileageRate: number | null;
  currency: string | null;
  isConfigured: boolean;
}
export interface MobileStatistics {
  totalTrips: number;
  totalMiles: number;
  totalKilometers: number;
  totalDurationSeconds: number;
  tripsThisWeek: number;
  milesThisWeek: number;
  tripsThisMonth: number;
  milesThisMonth: number;
  tripsThisYear: number;
  milesThisYear: number;
  averageTripMiles: number;
  averageTripDuration: number;
  milesByPurpose: { purpose: TripPurpose; miles: number }[];
  estimatedAmounts: { currency: string; amount: number }[];
  tripsWithoutRate: number;
  timeZone: string;
}
export function gpsPoint(p: MobilePoint): GpsPoint {
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: p.accuracyMeters,
    timestamp: Date.parse(p.observedAt),
    speed: p.speedMetersPerSecond,
    altitude: p.altitudeMeters,
    heading: p.heading,
  };
}
export function tripModel(t: MobileTrip, route: GpsPoint[] = []): Trip {
  return {
    ...t,
    route,
    startLocation: route[0] ?? { latitude: 0, longitude: 0, timestamp: Date.parse(t.startTime) },
    endLocation: route[route.length - 1],
    syncState: 'synced',
  };
}
