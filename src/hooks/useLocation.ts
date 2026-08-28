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
        "User-Agent": "TeaBreakTracker/1.0 (https://github.com/your-repo)"
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
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Geolocation is not supported by your browser."));
          return;
        }

        let settled = false;
        const finish = <T,>(fn: (v: T) => void, value: T) => {
          if (!settled) { settled = true; fn(value); }
        };

        const onSuccess = (pos: GeolocationPosition) => finish(resolve, pos.coords);
        const onError = (err: GeolocationPositionError) => {
          switch (err.code) {
            case err.PERMISSION_DENIED:
              finish(reject, new Error(
                "PERMISSION_DENIED: Location access was denied. Please allow location access to clock in."
              ));
              break;
            case err.POSITION_UNAVAILABLE:
              finish(reject, new Error("Location information is unavailable."));
              break;
            case err.TIMEOUT:
              finish(reject, new Error("Location request timed out."));
              break;
            default:
              finish(reject, new Error("An unknown location error occurred."));
          }
        };

        // Fast attempt first (low accuracy, may use a cached fix).
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          () => {
            // Fall back to a high-accuracy fix.
            navigator.geolocation.getCurrentPosition(onSuccess, onError, {
              enableHighAccuracy: true, timeout: 8000, maximumAge: 0,
            });
          },
          { enableHighAccuracy: false, timeout: 4000, maximumAge: 30000 }
        );
      });

      const { latitude, longitude, accuracy } = coords;
      const geoInfo = await reverseGeocode(latitude, longitude);

      const locationData: LocationData = {
        lat: latitude,
        lng: longitude,
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
