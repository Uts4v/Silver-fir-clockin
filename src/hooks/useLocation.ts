import { useState, useCallback } from "react";

export interface LocationData {
  lat: number;
  lng: number;
  accuracy: number;
  label: string;
  fullAddress: string;
  city: string;
  country: string;
  capturedAt: string;
  distanceMeters?: number;
  inRadius?: boolean;
}

/**
 * Last accepted fix, reused for a short window.
 *
 * Getting a real GPS fix can take seconds, and the same user taps clock-in
 * repeatedly across a shift (clock-in, break, resume, next session). Reusing a
 * very recent fix removes that wait. The window is deliberately short (45s) so a
 * fix is never meaningfully stale — the employee physically cannot have moved
 * between two taps seconds apart, so the geo-fence still proves presence.
 */
const FIX_CACHE_TTL = 45_000;
let lastFix: { lat: number; lng: number; accuracy: number; at: number } | null = null;

/**
 * Geolocation fix — lat/lng/accuracy only (no reverse geocoding).
 * Never throws: returns null on failure or timeout.
 *
 * A precise (GPS) fix is requested first because the geo-fence radius is often
 * only 100–200m and a network-derived fix can be off by hundreds of metres —
 * racing the two (as this used to) let the coarse fix "win" almost every time
 * and employees were wrongly told their location was too imprecise. We only
 * fall back to the fast coarse fix when the precise attempt fails or times out.
 * A fix from the last few seconds is reused outright.
 */
export async function getCoords(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (!navigator.geolocation) return null;

  if (lastFix && Date.now() - lastFix.at < FIX_CACHE_TTL) {
    return { lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy };
  }

  const attempt = (opts: PositionOptions) =>
    new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p),
        () => resolve(null),
        opts
      );
    });

  let pos = await attempt({ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  if (!pos) {
    pos = await attempt({ enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 });
  }
  if (!pos) return null;

  const fix = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  };
  lastFix = { ...fix, at: Date.now() };
  return fix;
}

/**
 * Reverse geocode coordinates → human-readable address
 * via OpenStreetMap Nominatim (free, no API key needed)
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{
  label: string;
  fullAddress: string;
  city: string;
  country: string;
}> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim requires a User-Agent identifying your app
        "User-Agent": "SilverFirClockIn/1.0 (com.silverfir.clockin)"
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("Geocoding request failed");
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.road || a.pedestrian || a.footway,
      a.suburb || a.neighbourhood || a.quarter,
      a.city || a.town || a.village || a.county,
      a.state,
      a.country,
    ].filter(Boolean);

    return {
      label: parts.join(", ") || data.display_name || "Unknown Location",
      fullAddress: data.display_name || "Unknown Location",
      city: a.city || a.town || a.village || a.county || "",
      country: a.country || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Custom React hook that grabs geolocation from the browser and optionally
 * reverse–geocodes it.  Used by the clock‑in flow.
 *
 * Returns an object with:
 *   captureLocation(): Promise<LocationData>
 *   loading: boolean
 *   error: string | null
 */
export function useLocationCapture() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captureLocation = useCallback(async (): Promise<LocationData> => {
    setLoading(true);
    setError(null);

    try {
      const coords = await getCoords();
      if (!coords) {
        throw new Error(
          navigator.geolocation && navigator.permissions?.query
            ? "Could not determine your location. Check location permissions and try again."
            : "Geolocation is not supported by your browser."
        );
      }

      const { lat, lng, accuracy } = coords;
      const geoInfo = await reverseGeocode(lat, lng);

      const locationData: LocationData = {
        lat,
        lng,
        accuracy: Math.round(accuracy),
        label: geoInfo.label,
        fullAddress: geoInfo.fullAddress,
        city: geoInfo.city,
        country: geoInfo.country,
        capturedAt: new Date().toISOString(),
      };

      setLoading(false);
      return locationData;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      throw err;
    }
  }, []);

  return { captureLocation, loading, error };
}
