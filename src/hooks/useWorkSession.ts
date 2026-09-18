import { useState, useEffect, useCallback, useRef } from "react";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuthContext } from "@/contexts/AuthContext";
import type { TimerStatus, WorkSession, BreakLog, ClockInLocation, OfficeLocation } from "@/integrations/firebase/types";
import { toast } from "sonner";
import { useLocationCapture, getCoords, reverseGeocode } from "@/hooks/useLocation";
import { distanceMeters, findNearestSite, type GeoCandidate } from "@/lib/geo";

// ── Company geo-fence cache ────────────────────────────────────────────────
// Cached in memory + localStorage so clock-in never waits on companies/{id} /
// sites reads for every attempt. An *enabled* fence with sites is trusted for
// 1h; a disabled/missing one is re-checked after 60s so a freshly-saved site or
// master toggle is picked up fast.
interface GeofenceSites { enabled: boolean; sites: GeoCandidate[] }
const GEOFENCE_TTL = 60 * 60 * 1000;
const GEOFENCE_NULL_TTL = 60 * 1000;
const geofenceCache: { companyId: string; data: GeofenceSites | null; ts: number } = { companyId: "", data: null, ts: 0 };

const getGeofenceSites = async (companyId: string): Promise<GeofenceSites | null> => {
  const now = Date.now();
  if (geofenceCache.companyId === companyId) {
    const ttl =
      geofenceCache.data && geofenceCache.data.enabled && geofenceCache.data.sites.length > 0
        ? GEOFENCE_TTL
        : GEOFENCE_NULL_TTL;
    if (now - geofenceCache.ts < ttl) return geofenceCache.data;
  }

  const CACHE_KEY = "sf_geofence_" + companyId;
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const p = JSON.parse(cached);
      if (p && typeof p.enabled === "boolean" && Array.isArray(p.sites) && now - p.ts < GEOFENCE_TTL) {
        geofenceCache.companyId = companyId;
        geofenceCache.data = { enabled: p.enabled, sites: p.sites };
        geofenceCache.ts = now;
        return geofenceCache.data;
      }
    } catch { /* ignore corrupt cache */ }
  }

  let data: GeofenceSites | null = null;
  try {
    const compSnap = await getDoc(doc(db, "companies", companyId));
    if (compSnap.exists()) {
      const comp = compSnap.data() as {
        officeLocation?: OfficeLocation;
        radiusMeters?: number;
        geofencingEnabled?: boolean;
      };
      const hasLegacy = !!(comp.officeLocation && comp.radiusMeters && comp.radiusMeters > 0);
      // Companies configured before the master toggle existed keep geo-fencing on.
      let enabled = comp.geofencingEnabled === true;
      if (comp.geofencingEnabled === undefined && hasLegacy) enabled = true;

      const sitesSnap = await getDocs(collection(db, "companies", companyId, "sites"));
      let sites: GeoCandidate[] = sitesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }) as GeoCandidate & { active?: boolean })
        .filter(s => s.active !== false && s.radiusMeters > 0);

      // Back-compat: a configured single office behaves as one implicit site.
      if (enabled && sites.length === 0 && hasLegacy) {
        sites = [{
          id: "legacy-office",
          name: comp.officeLocation!.label || "Office",
          lat: comp.officeLocation!.lat,
          lng: comp.officeLocation!.lng,
          radiusMeters: comp.radiusMeters!,
        }];
      }

      data = enabled ? { enabled: true, sites } : { enabled: false, sites: [] };
    }
  } catch (err) {
    console.error("Failed to load company geofence:", err);
  }

  geofenceCache.companyId = companyId;
  geofenceCache.data = data;
  geofenceCache.ts = now;
  if (data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: data.enabled, sites: data.sites, ts: now })); } catch { /* ignore */ }
  }
  return data;
};

// Turn a failed geo check into a helpful block message.
function buildGeoError(coords: { lat: number; lng: number; accuracy: number }, sites: GeoCandidate[]): string {
  let nearest: GeoCandidate | null = null;
  let minDist = Infinity;
  for (const s of sites) {
    const d = distanceMeters(coords.lat, coords.lng, s.lat, s.lng);
    if (d < minDist) { minDist = d; nearest = s; }
  }
  if (!nearest) return "No work sites are configured for your company. Ask an admin to add one.";
  if (minDist <= nearest.radiusMeters) {
    return `Your GPS accuracy is ${Math.round(coords.accuracy)}m — too imprecise to verify you are at "${nearest.name}" (allowed ${nearest.radiusMeters}m). Move to open sky and retry.`;
  }
  return `You are ${Math.round(minDist)}m from "${nearest.name}" (clock-in allowed within ${nearest.radiusMeters}m of a site).`;
}

export const useWorkSession = () => {
  const { user, profile } = useAuthContext();
  const [session, setSession] = useState<WorkSession | null>(null);
  const [breakLogs, setBreakLogs] = useState<BreakLog[]>([]);
  const [displayTime, setDisplayTime] = useState(0);
  const [breakDisplayTime, setBreakDisplayTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isBreakAlertPlaying, setIsBreakAlertPlaying] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const beepIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const playBreakAlert = useCallback(() => {
    const playBeep = () => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // 800 Hz beep
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Volume

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5); // 0.5 second beep
    };

    // Play beep every second
    beepIntervalRef.current = setInterval(playBeep, 1000);
  }, []);

  const stopBreakAlert = useCallback(() => {
    if (beepIntervalRef.current) {
      clearInterval(beepIntervalRef.current);
      beepIntervalRef.current = null;
    }
  }, []);

  const today = new Date().toISOString().split("T")[0];

  // Fetch today's session
  const fetchTodaySession = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Query for today's session
      const sessionsRef = collection(db, "users", user.uid, "sessions");
      const q = query(sessionsRef, where("date", "==", today));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const sessionDoc = querySnapshot.docs[0];
        const sessionData = { id: sessionDoc.id, ...sessionDoc.data() } as WorkSession;
        setSession(sessionData);

        // Fetch break logs for this session
        const breaksRef = collection(db, "users", user.uid, "sessions", sessionDoc.id, "breaks");
        const breaksQuery = query(breaksRef, orderBy("breakStart", "asc"));
        const breaksSnapshot = await getDocs(breaksQuery);

        const breaks = breaksSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as BreakLog[];

        setBreakLogs(breaks);
      } else {
        setSession(null);
        setBreakLogs([]);
      }
    } catch (error) {
      console.error("Error fetching session:", error);
    }
    setLoading(false);
  }, [user, today]);

  useEffect(() => {
    fetchTodaySession();
  }, [fetchTodaySession]);

  // Calculate elapsed times
  const calculateElapsedTime = useCallback(() => {
    if (!session || !session.workStartTime) return { work: 0, break: 0 };

    const now = new Date();
    let totalBreakTime = 0;

    // Filter breaks started after current workStartTime
    const currentBreaks = breakLogs.filter(log => log.breakStart.toDate() > session.workStartTime.toDate());

    // Add completed breaks in current segment
    totalBreakTime += currentBreaks.filter(log => log.breakEnd).reduce((acc, log) => {
      return acc + Math.floor((log.breakEnd!.toDate().getTime() - log.breakStart.toDate().getTime()) / 1000);
    }, 0);

    // Add time from current break if on break
    const currentBreak = breakLogs.find((log) => log.breakEnd === undefined);
    if (currentBreak) {
      totalBreakTime += Math.floor(
        (now.getTime() - currentBreak.breakStart.toDate().getTime()) / 1000
      );
    }

    // Calculate total work time
    const endTime = session.workEndTime ? session.workEndTime.toDate() : now;
    const totalElapsed = Math.floor(
      (endTime.getTime() - session.workStartTime.toDate().getTime()) / 1000
    );
    const workTime = totalElapsed - totalBreakTime;

    return { work: Math.max(0, workTime), break: totalBreakTime };
  }, [session, breakLogs]);

  // Update display times
  useEffect(() => {
    const updateDisplay = () => {
      const times = calculateElapsedTime();
      setDisplayTime(times.work);
      setBreakDisplayTime(times.break);

      // Break alert: if on break and break time >= 45 minutes (2700 seconds)
      if (session?.status === "break" && times.break >= 4 && !isBreakAlertPlaying) {
        playBreakAlert();
        setIsBreakAlertPlaying(true);
      } else if (session?.status !== "break" && isBreakAlertPlaying) {
        stopBreakAlert();
        setIsBreakAlertPlaying(false);
      }
    };

    updateDisplay();

    const status = session?.status;
    if (status === "working" || status === "break") {
      intervalRef.current = setInterval(updateDisplay, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      stopBreakAlert();
    };
  }, [session?.status, calculateElapsedTime, playBreakAlert, stopBreakAlert, isBreakAlertPlaying]);

  const { captureLocation } = useLocationCapture();

  // ── Realtime presence ─────────────────────────────────────────────────────
  // Writes a lightweight liveStatus/{uid} doc on every status transition so the
  // admin panel can subscribe and show Working / Break / Offline instantly.
  const reportLive = useCallback(async (s: TimerStatus | "offline") => {
    if (!user || !profile?.companyId) return;
    try {
      await setDoc(doc(db, "liveStatus", user.uid), {
        status: s,
        companyId: profile.companyId,
        fullName: profile.fullName,
        department: profile.department || "",
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to report live status:", err);
    }
  }, [user, profile]);

  // Publish presence on mount if an active session exists, and heartbeat every
  // 60s while working/break so the admin always sees the current realtime state.
  useEffect(() => {
    if ((session?.status === "working" || session?.status === "break") && user) {
      void reportLive(session.status);
      const iv = setInterval(() => void reportLive(session.status), 60000);
      return () => clearInterval(iv);
    }
  }, [session?.status, user, reportLive]);

  // Enrich a verified fix with a reverse-geocoded address in the background so
  // a slow Nominatim call never blocks clock-in. Site/distance fields are kept.
  const enrichLocation = useCallback(async (sessionId: string, base: ClockInLocation) => {
    if (!user) return;
    const uid = user.uid;
    try {
      const geo = await reverseGeocode(base.lat, base.lng);
      const fullLoc: ClockInLocation = {
        ...base,
        label: geo.label,
        fullAddress: geo.fullAddress,
        city: geo.city,
        country: geo.country,
        capturedAt: base.capturedAt,
      };
      await updateDoc(
        doc(db, "users", uid, "sessions", sessionId),
        { clockInLocation: fullLoc, updatedAt: Timestamp.now() } as unknown as Parameters<typeof updateDoc>[1]
      );
      setSession(prev =>
        prev && prev.id === sessionId
          ? { ...prev, clockInLocation: fullLoc }
          : prev
      );
    } catch (err) {
      console.error("Failed to enrich location:", err);
    }
  }, [user]);

  const clockIn = async () => {
    if (!user) return;

    try {
      // Resolve the company's geo-fence while simultaneously grabbing a fast
      // geolocation fix — the reads overlap instead of serialising.
      let geofence: GeofenceSites | null = null;
      let coordsPromise: Promise<{ lat: number; lng: number; accuracy: number } | null> = Promise.resolve(null);

      if (profile?.companyId) {
        coordsPromise = getCoords();
        geofence = await getGeofenceSites(profile.companyId);
      }

      let locationData: ClockInLocation | null = null;
      if (geofence?.enabled) {
        toast.info("Verifying your work-site location…");
        const coords = await coordsPromise;
        if (!coords) {
          toast.error("Could not determine your location. Please allow location access and retry.");
          return false;
        }

        // Auto-match the nearest site whose radius covers the fix. A fix is only
        // accepted when GPS precision is good enough to trust for that radius.
        const match = findNearestSite(
          { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy },
          geofence.sites
        );
        if (!match) {
          toast.error(buildGeoError(coords, geofence.sites));
          return false;
        }

        locationData = {
          lat: coords.lat,
          lng: coords.lng,
          accuracy: Math.round(coords.accuracy),
          label: match.site.name,
          fullAddress: "",
          city: "",
          country: "",
          capturedAt: new Date().toISOString(),
          siteId: match.site.id,
          siteName: match.site.name,
          distanceMeters: Math.round(match.distanceMeters),
          inRadius: true,
        };
      }

      const sessionData: Partial<WorkSession> = {
        userId: user.uid,
        date: today,
        workStartTime: Timestamp.now(),
        totalWorkDuration: 0,
        totalBreakDuration: 0,
        status: "working" as const,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      let newSession: WorkSession;
      if (session) {
        // Update existing session
        const updatePayload = {
          workStartTime: Timestamp.now(),
          status: "working" as const,
          workEndTime: null,
          updatedAt: Timestamp.now(),
        } as unknown as Parameters<typeof updateDoc>[1];
        await updateDoc(doc(db, "users", user.uid, "sessions", session.id), updatePayload);
        newSession = { ...session, workStartTime: Timestamp.now(), status: "working", workEndTime: null };
      } else {
        // Create new session
        const docRef = await addDoc(collection(db, "users", user.uid, "sessions"), sessionData);
        newSession = { id: docRef.id, ...sessionData } as WorkSession;
      }

      setSession(newSession);
      setBreakLogs([]);
      toast.success("Clocked in!");
      void reportLive("working");

      if (locationData) {
        // Geo-fenced clock-in: attach the verified fix now, enrich the address lazily.
        try {
          const payload = {
            clockInLocation: locationData,
            updatedAt: Timestamp.now(),
          } as unknown as Parameters<typeof updateDoc>[1];
          await updateDoc(doc(db, "users", user.uid, "sessions", newSession.id), payload);
          setSession(prev =>
            prev && prev.id === newSession.id
              ? { ...prev, clockInLocation: locationData as ClockInLocation }
              : prev
          );
        } catch (locErr) {
          console.error("Failed to attach location:", locErr);
        }
        void enrichLocation(newSession.id, locationData);
        return true;
      }

      // No geo-fence configured: capture location in the background and attach
      // it once ready — a slow/failed fix never blocks clock-in.
      captureLocation()
        .then(async (captured) => {
          if (!captured) return;
          const payload = {
            clockInLocation: captured as ClockInLocation,
            updatedAt: Timestamp.now(),
          } as unknown as Parameters<typeof updateDoc>[1];
          await updateDoc(doc(db, "users", user.uid, "sessions", newSession.id), payload);
          setSession(prev =>
            prev && prev.id === newSession.id
              ? { ...prev, clockInLocation: captured as ClockInLocation }
              : prev
          );
        })
        .catch((locErr: unknown) => {
          console.error("Location capture failed:", locErr);
          toast.error(
            locErr instanceof Error && locErr.message
              ? locErr.message
              : "Could not capture your location."
          );
        });
      return true;
    } catch (error) {
      console.error("Error clocking in:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to clock in. Please try again."
      );
      return false;
    }
  };

  const clockOut = async () => {
    if (!session || !user) return;

    try {
      const times = calculateElapsedTime();

      // End any current break first
      const currentBreak = breakLogs.find((log) => log.breakEnd === undefined);
      if (currentBreak) {
        await updateDoc(
          doc(db, "users", user.uid, "sessions", session.id, "breaks", currentBreak.id),
          { breakEnd: Timestamp.now() }
        );
      }

      // Update session
      await updateDoc(doc(db, "users", user.uid, "sessions", session.id), {
        workEndTime: Timestamp.now(),
        totalWorkDuration: times.work,
        totalBreakDuration: times.break,
        status: "completed",
        updatedAt: Timestamp.now(),
      });

      // Update tea points in profile
      const teaPointsEarned = Math.floor(times.work / 3600) * 10;
      if (teaPointsEarned > 0) {
        const profileRef = doc(db, "users", user.uid);
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const currentPoints = profileSnap.data().teaPoints || 0;
          await updateDoc(profileRef, {
            teaPoints: currentPoints + teaPointsEarned,
            updatedAt: Timestamp.now(),
          });
        }
      }

      setSession({
        ...session,
        workEndTime: Timestamp.now(),
        totalWorkDuration: times.work,
        totalBreakDuration: times.break,
        status: "completed"
      });

      await reportLive("offline");
      await fetchTodaySession();
      stopBreakAlert();
      setIsBreakAlertPlaying(false);
    } catch (error) {
      console.error("Error clocking out:", error);
    }
  };

  const pauseWork = async () => {
    if (!session || !user) return;

    try {
      const breakData = {
        sessionId: session.id,
        userId: user.uid,
        breakStart: Timestamp.now(),
        createdAt: Timestamp.now(),
      };

      const docRef = await addDoc(
        collection(db, "users", user.uid, "sessions", session.id, "breaks"),
        breakData
      );

      await updateDoc(doc(db, "users", user.uid, "sessions", session.id), {
        status: "break",
        updatedAt: Timestamp.now(),
      });

      const newBreak = { id: docRef.id, ...breakData };
      setBreakLogs([...breakLogs, newBreak]);
      setSession({ ...session, status: "break" });
      await reportLive("break");
    } catch (error) {
      console.error("Error starting break:", error);
    }
  };

  const resumeWork = async () => {
    if (!session || !user) return;

    try {
      const currentBreak = breakLogs.find((log) => log.breakEnd === undefined);
      if (currentBreak) {
        await updateDoc(
          doc(db, "users", user.uid, "sessions", session.id, "breaks", currentBreak.id),
          { breakEnd: Timestamp.now() }
        );

        // Calculate total break duration
        const updatedBreaks = breakLogs.map((log) =>
          log.id === currentBreak.id
            ? { ...log, breakEnd: Timestamp.now() }
            : log
        );
        setBreakLogs(updatedBreaks);

        const totalBreak = updatedBreaks.reduce((acc, log) => {
          if (log.breakEnd) {
            return (
              acc +
              Math.floor(
                (log.breakEnd.toDate().getTime() - log.breakStart.toDate().getTime()) / 1000
              )
            );
          }
          return acc;
        }, 0);

        await updateDoc(doc(db, "users", user.uid, "sessions", session.id), {
          status: "working",
          totalBreakDuration: totalBreak,
          updatedAt: Timestamp.now(),
        });

        setSession({ ...session, status: "working", totalBreakDuration: totalBreak });
        stopBreakAlert();
        setIsBreakAlertPlaying(false);
        await reportLive("working");
      }
    } catch (error) {
      console.error("Error resuming work:", error);
    }
  };

  const resetSession = async () => {
    if (!user) return;

    try {
      // If there's an active session that isn't completed, end it first so the record is preserved.
      if (session && session.status !== "completed") {
        await clockOut();
      }

      // Do NOT delete or zero out the stored session/break logs in Firestore.
      // Preserve history for the History page. Just clear local state so the UI can start a fresh day.
      setSession(null);
      setBreakLogs([]);
      setDisplayTime(0);
      setBreakDisplayTime(0);
    } catch (error) {
      console.error("Error resetting session:", error);
    }
  };

  const status: TimerStatus = session?.status || "idle";

  return {
    session,
    breakLogs,
    status,
    displayTime,
    breakDisplayTime,
    loading,
    clockIn,
    clockOut,
    pauseWork,
    resumeWork,
    resetSession,
    refetch: fetchTodaySession,
  };
};

export const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hrs.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export const formatTimeShort = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
};
