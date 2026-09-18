// Haversine distance helpers used for geo-fenced clock-in.

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Distance in meters between two lat/lng coordinates.
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// A single candidate geo-fence site. Matches the CompanySite shape so we can
// pass Firestore docs straight in without a mapping layer.
export interface GeoCandidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface GeoMatch {
  site: GeoCandidate;
  distanceMeters: number;
}

// A coordinate fix (lat/lng + reported accuracy in meters).
export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Pick the nearest site whose radius the given fix falls inside. A match is only
 * accepted when the fix is both within the site radius AND accurate enough to be
 * trusted for that radius (accuracy <= radius). Returns null when no site matches.
 *
 * `rejectInaccurate` gates matches on GPS precision; default true.
 */
export function findNearestSite(
  fix: GeoFix,
  sites: GeoCandidate[],
  rejectInaccurate = true
): GeoMatch | null {
  let best: GeoMatch | null = null;
  for (const site of sites) {
    if (!site.radiusMeters || site.radiusMeters <= 0) continue;
    if (rejectInaccurate && fix.accuracy > site.radiusMeters) continue;
    const d = distanceMeters(fix.lat, fix.lng, site.lat, site.lng);
    if (d > site.radiusMeters) continue;
    if (!best || d < best.distanceMeters) {
      best = { site, distanceMeters: d };
    }
  }
  return best;
}