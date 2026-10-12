import { motion } from "framer-motion";
import { MapPin, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeolocation } from "@/hooks/useGeolocation";

/**
 * A single, obvious call-to-action for switching location back on.
 *
 * Hidden entirely when geolocation is already allowed (or unsupported), so it
 * only ever appears when it can actually help. When the browser has hard-denied
 * access (tapping "Block"), no app can re-open the prompt — so we switch to
 * clear, actionable instructions instead of a button that silently does nothing.
 */
export function EnableLocationCard() {
  const { permission, checking, requesting, error, enable } = useGeolocation();

  if (checking || permission === "granted" || permission === "unsupported") return null;

  const denied = permission === "denied";
  const accent = denied ? "#f87171" : "#fbbf24";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mb-10 w-full max-w-md"
    >
      <div
        className="rounded-2xl border p-5"
        style={{
          background: denied ? "rgba(248,113,113,0.06)" : "rgba(251,191,36,0.07)",
          borderColor: denied ? "rgba(248,113,113,0.25)" : "rgba(251,191,36,0.25)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: denied ? "rgba(248,113,113,0.15)" : "rgba(251,191,36,0.15)" }}
          >
            <MapPin className="w-5 h-5" style={{ color: denied ? "#f87171" : "#fbbf24" }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {denied ? "Location is blocked" : "Enable location to clock in"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {denied
                ? "Your browser has blocked location for this site. Open this site's settings (the padlock or tune icon in the address bar), set Location to Allow, then tap Retry."
                : "We use your location to confirm you're at a work site when you clock in. Tap below and choose Allow."}
            </p>

            {error && (
              <p
                className="text-[11px] mt-2 flex items-start gap-1.5"
                style={{ color: denied ? "#fca5a5" : "#fcd34d" }}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <div className="mt-3">
              <button
                type="button"
                onClick={() => void enable()}
                disabled={requesting}
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-50"
                style={{
                  background: denied ? "rgba(248,113,113,0.16)" : "rgba(251,191,36,0.18)",
                  color: denied ? "#fca5a5" : "#fcd34d",
                  border: `1px solid ${denied ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.3)"}`,
                }}
              >
                {requesting
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <MapPin className="w-3.5 h-3.5" />}
                {requesting ? "Checking…" : denied ? "Retry" : "Enable location"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default EnableLocationCard;
