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
 * the permission prompt, and — when access is actually blocked — show the right
 * recovery steps (which differ between a browser tab and an installed PWA).
 *
 * `blocked` covers platforms (notably iOS PWAs) where the Permissions API can't
 * report geolocation: there, a denied fix comes back as a plain failure, so we
 * treat a failed request as "needs setup" instead of silently retrying forever.
 */
export function useGeolocation() {
  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;
  const [permission, setPermission] = useState<GeoPermission>(supported ? "prompt" : "unsupported");
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(supported);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applyState = useCallback((state: GeoPermission) => {
    setPermission(state);
    if (state === "granted") setBlocked(false);
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
  // makes in the browser/OS settings.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status && mountedRef.current) applyState(status.state as GeoPermission);
    };

    (async () => {
      const state = await queryPermission();
      if (cancelled || !mountedRef.current) return;
      applyState(state);
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
  }, [applyState, queryPermission, supported]);

  /** Request a location fix (this is what pops the browser permission prompt). */
  const enable = useCallback(async (): Promise<boolean> => {
    setRequesting(true);
    setError(null);
    try {
      const fix = await getCoords();
      if (fix) {
        if (mountedRef.current) {
          applyState("granted");
          setError(null);
        }
        return true;
      }
      if (mountedRef.current) {
        setBlocked(true);
        setError("Couldn't get your location. Enable it using the steps below, then tap Retry.");
      }
      return false;
    } catch {
      if (mountedRef.current) {
        setBlocked(true);
        setError("Couldn't get your location. Please try again.");
      }
      return false;
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
  }, [applyState]);

  return { permission, blocked, checking, requesting, error, enable, supported };
}
