export type MapPlatform = 'ios' | 'android' | 'web';

export interface DirectionsLocation {
  name: string;
  lat: number;
  lng: number;
}

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends MapCoordinate {
  latitudeDelta: number;
  longitudeDelta: number;
}

export type LocationMapFilter = 'All' | 'Centres' | 'ATMs' | 'Vendors' | 'Stations' | 'Taps';

export interface FilterableLocation {
  type: string;
}

const MIN_DELTA = 0.02;
const REGION_PADDING = 1.35;

function coordinates(location: DirectionsLocation) {
  return `${location.lat},${location.lng}`;
}

/** A browser-safe Google Maps directions URL for a named location. */
export function googleMapsDirectionsUrl(location: DirectionsLocation): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates(location))}&destination_name=${encodeURIComponent(location.name)}`;
}

/**
 * Builds the preferred installed-map-app URL and a browser fallback.
 * Apple Maps receives both a destination coordinate and its customer-facing label.
 */
export function directionsUrls(location: DirectionsLocation, platform: MapPlatform) {
  const googleMapsUrl = googleMapsDirectionsUrl(location);
  if (platform === 'ios') {
    return {
      primary: `http://maps.apple.com/?daddr=${encodeURIComponent(coordinates(location))}&q=${encodeURIComponent(location.name)}`,
      fallback: googleMapsUrl,
    };
  }
  if (platform === 'android') {
    return {
      primary: `google.navigation:q=${encodeURIComponent(coordinates(location))}&mode=d`,
      fallback: googleMapsUrl,
    };
  }
  return { primary: googleMapsUrl, fallback: googleMapsUrl };
}

export function mapCoordinates(locations: DirectionsLocation[]): MapCoordinate[] {
  return locations
    .filter(location => Number.isFinite(location.lat) && Number.isFinite(location.lng))
    .map(location => ({ latitude: location.lat, longitude: location.lng }));
}

/** Keeps web and native map tabs aligned as new location types are added. */
export function filterMapLocations<T extends FilterableLocation>(
  locations: readonly T[],
  filter: LocationMapFilter,
): T[] {
  if (filter === 'All') return [...locations];
  const typeByFilter: Record<Exclude<LocationMapFilter, 'All'>, string> = {
    Centres: 'experience_centre',
    ATMs: 'water_atm',
    Vendors: 'vendor',
    Stations: 'refill_station',
    Taps: 'city_tap',
  };
  return locations.filter(location => location.type === typeByFilter[filter]);
}

/** Derives a padded region for one or more markers when fitting is unavailable. */
export function regionForLocations(locations: DirectionsLocation[]): MapRegion | null {
  const points = mapCoordinates(locations);
  if (!points.length) return null;

  const latitudes = points.map(point => point.latitude);
  const longitudes = points.map(point => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * REGION_PADDING, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * REGION_PADDING, MIN_DELTA),
  };
}