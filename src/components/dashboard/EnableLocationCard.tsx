import { motion } from "framer-motion";
import { MapPin, Navigation, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeolocation } from "@/hooks/useGeolocation";
import { isStandalone, isIOS } from "@/hooks/usePWAInstall";

/**
 * A single, obvious call-to-action for switching location back on.
 *
 * Hidden entirely when geolocation is already allowed (or unsupported), so it
 * only ever appears when it can actually help. Recovery steps are tailored to
 * where the app is running: a browser tab (site settings in the address bar) vs
 * an installed PWA (device/OS settings — there is no address bar to tap).
 */
export function EnableLocationCard() {
  const { permission, blocked, checking, requesting, error, enable } = useGeolocation();

  if (checking || permission === "granted" || permission === "unsupported") return null;

  const standalone = isStandalone();
  const ios = isIOS();
  const needsSetup = blocked || permission === "denied";

  const title = needsSetup
    ? standalone
      ? "Allow location for this app"
      : "Location is blocked"
    : "Enable location to clock in";

  let steps: string;
  if (!needsSetup) {
    steps = "We use your location to confirm you're at a work site when you clock in. Tap below and choose Allow.";
  } else if (standalone && ios) {
    steps = "Open Settings → scroll down to Silver Fir → Location → set it to While Using the App. Then reopen this app and tap Retry.";
  } else if (standalone) {
    steps = "Open Settings → Apps → Silver Fir → Permissions → Location → Allow. Then reopen this app and tap Retry.";
  } else if (ios) {
    steps = "In Safari, tap the \"aA\" icon in the address bar → Website Settings → Location → Allow. Then tap Retry.";
  } else {
    steps = "Tap the padlock (or tune) icon in the address bar → Permissions / Site settings → Location → Allow. Then tap Retry.";
  }

  const accent = needsSetup ? "#f87171" : "#fbbf24";
  const bg = needsSetup ? "rgba(248,113,113,0.06)" : "rgba(251,191,36,0.07)";
  const border = needsSetup ? "rgba(248,113,113,0.25)" : "rgba(251,191,36,0.25)";
  const chipBg = needsSetup ? "rgba(248,113,113,0.15)" : "rgba(251,191,36,0.15)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mb-10 w-full max-w-md"
    >
      <div className="rounded-2xl border p-5" style={{ background: bg, borderColor: border }}>
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: chipBg }}
          >
            <MapPin className="w-5 h-5" style={{ color: accent }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{steps}</p>

            {error && (
              <p
                className="text-[11px] mt-2 flex items-start gap-1.5"
                style={{ color: accent }}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-[1px] flex-shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <div className="mt-3">
              <Button
                size="sm"
                onClick={() => void enable()}
                disabled={requesting}
                className="h-auto rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: chipBg,
                  color: accent,
                  border: `1px solid ${border}`,
                }}
              >
                {requesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : needsSetup ? (
                  <RefreshCw className="w-3.5 h-3.5" />
                ) : (
                  <Navigation className="w-3.5 h-3.5" />
                )}
                {requesting ? "Checking…" : needsSetup ? "Retry" : "Enable location"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default EnableLocationCard;
