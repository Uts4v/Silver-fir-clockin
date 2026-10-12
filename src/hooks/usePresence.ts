import { useCallback, useEffect, useRef } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuthContext } from "@/contexts/AuthContext";
import type { TimerStatus } from "@/integrations/firebase/types";

// Presence is written to liveStatus/{uid}, which the admin console subscribes to.
// The doc is considered stale (→ Offline) after this long. Keep it at ~3× the
// heartbeat so a single missed beat never flips a working employee to Offline.
export const PRESENCE_HEARTBEAT_MS = 60_000;
export const PRESENCE_STALE_MS = 3 * 60 * 1000;

type PresenceStatus = TimerStatus | "offline";

/**
 * Global presence reporter.
 *
 * Previously the heartbeat lived inside `useWorkSession`, which is only mounted
 * on the dashboard route — the moment an employee opened History/Profile/Leaves
 * the interval was torn down and the admin saw them as Offline while they were
 * still working. This component is mounted once at the app root, so it keeps
 * reporting for as long as the user is signed in, no matter which page is open.
 *
 * It also re-reports immediately when the tab becomes visible / regains focus /
 * comes back online, so throttled background timers (especially on mobile) can
 * never leave a genuinely-active employee showing as Offline.
 */
export const PresenceReporter = () => {
  const { user, profile } = useAuthContext();

  const statusRef = useRef<PresenceStatus>("offline");
  const companyIdRef = useRef<string | undefined>(undefined);
  const fullNameRef = useRef("");
  const departmentRef = useRef("");

  // Keep the latest profile fields available to the write helper without
  // tearing down the listeners whenever the profile object changes.
  companyIdRef.current = profile?.companyId;
  fullNameRef.current = profile?.fullName || "";
  departmentRef.current = profile?.department || "";

  const write = useCallback(
    async (status: PresenceStatus) => {
      if (!user || !companyIdRef.current) return;
      try {
        await setDoc(doc(db, "liveStatus", user.uid), {
          status,
          companyId: companyIdRef.current,
          fullName: fullNameRef.current,
          department: departmentRef.current,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error("Failed to report live status:", err);
      }
    },
    [user]
  );

  // Follow today's session so a break/resume/clock-out is reflected instantly.
  useEffect(() => {
    if (!user) {
      statusRef.current = "offline";
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const q = query(
      collection(db, "users", user.uid, "sessions"),
      where("date", "==", today)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        let next: PresenceStatus = "offline";
        snap.docs.forEach((d) => {
          const st = (d.data() as { status?: string }).status;
          if (st === "working" || st === "break") next = st;
        });
        if (next !== statusRef.current) {
          statusRef.current = next;
          void write(next);
        }
      },
      (err) => console.error("presence session listener error:", err)
    );
    return () => unsub();
  }, [user, write]);

  // Heartbeat + event-driven refresh.
  useEffect(() => {
    if (!user) return;

    const beat = () => void write(statusRef.current);
    beat();
    const interval = setInterval(beat, PRESENCE_HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", beat);
    window.addEventListener("online", beat);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", beat);
      window.removeEventListener("online", beat);
    };
    // `companyId` is a dependency so the very first beat happens as soon as the
    // profile (and therefore companyId) is available, not up to a minute later.
  }, [user, write, profile?.companyId]);

  return null;
};

export default PresenceReporter;
