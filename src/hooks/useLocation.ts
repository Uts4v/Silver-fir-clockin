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
 * Fast geolocation fix — lat/lng/accuracy only (no reverse geocoding).
 * Never throws: returns null on failure or timeout. Tries a cached/low-accuracy
 * fix first, then a high-accuracy one. Used by the geo-fence clock-in path so a
 * slow address lookup never blocks clock-in.
 */
export async function getCoords(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (!navigator.geolocation) return null;

  const attempt = (opts: PositionOptions) =>
    new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p),
        () => resolve(null),
        opts
      );
    });

  const t0 = Date.now();
  let pos =
    (await attempt({ enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 })) ||
    (await attempt({ enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }));

  // Hard ceiling so a stuck device never hangs the clock-in flow.
  if (Date.now() - t0 > 20000) pos = null;

  if (!pos) return null;
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
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
