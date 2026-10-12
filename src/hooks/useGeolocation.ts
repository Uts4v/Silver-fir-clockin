import { useCallback, useEffect, useRef, useState } from "react";
import { getCoords } from "@/hooks/useLocation";

export type GeoPermission = "unsupported" | "prompt" | "granted" | "denied";

/**
 * Tracks the browser's geolocation permission and exposes an `enable()` action
 * that actually requests a fix.
 *
 * Why a dedicated hook: when location is switched off in the browser (or the
 * employee previously tapped "Block"), the plain clock-in flow just fails with a
 * vague error. This lets the UI offer a clear "Enable location" button, trigger
 * the permission prompt, and — when the browser has hard-denied access — tell the
 * employee exactly how to switch it back on.
 */
export function useGeolocation() {
  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;
  const [permission, setPermission] = useState<GeoPermission>(supported ? "prompt" : "unsupported");
  const [checking, setChecking] = useState(supported);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const queryPermission = useCallback(async (): Promise<GeoPermission> => {
    if (!supported) return "unsupported";
    if (!navigator.permissions?.query) return "prompt";
    try {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      return status.state as GeoPermission;
    } catch {
      return "prompt";
    }
  }, [supported]);

  // Read the current permission once, then stay in sync with changes the user
  // makes in the browser's address-bar / site settings.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status && mountedRef.current) setPermission(status.state as GeoPermission);
    };

    (async () => {
      const state = await queryPermission();
      if (cancelled || !mountedRef.current) return;
      setPermission(state);
      setChecking(false);
      if (supported && navigator.permissions?.query) {
        try {
          status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
          status.addEventListener?.("change", onChange);
        } catch {
          /* Permissions API is best-effort — leave the initial state in place. */
        }
      }
    })();

    return () => {
      cancelled = true;
      status?.removeEventListener?.("change", onChange);
    };
  }, [queryPermission, supported]);

  /** Request a location fix (this is what pops the browser permission prompt). */
  const enable = useCallback(async (): Promise<boolean> => {
    setRequesting(true);
    setError(null);
    try {
      const fix = await getCoords();
      if (fix) {
        if (mountedRef.current) setPermission("granted");
        return true;
      }
      const state = await queryPermission();
      if (mountedRef.current) {
        setPermission(state);
        setError(
          state === "denied"
            ? "Location is blocked for this site. Enable it in your browser's site settings, then tap Retry."
            : "Couldn't get your location. Make sure your device's GPS / Location is switched on, then tap Retry."
        );
      }
      return false;
    } catch {
      if (mountedRef.current) setError("Couldn't get your location. Please try again.");
      return false;
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
  }, [queryPermission]);

  return { permission, checking, requesting, error, enable, supported };
}
