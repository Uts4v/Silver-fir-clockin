import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, Share2, Plus, Check, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/usePWAInstall";

const seenKey = "silverfir-install-seen";

// Shared panel used in the header dropdown and the Profile "Download App" card.
export const InstallPanel = () => {
  const { canInstall, ios, installed, promptInstall } = usePWAInstall();
  const [busy, setBusy] = useState(false);

  if (installed) {
    return (
      <p className="text-xs text-emerald-500 flex items-center gap-1.5">
        <Check className="w-3.5 h-3.5" /> Silver Fir is installed on this device
      </p>
    );
  }

  const installNow = async () => {
    setBusy(true);
    await promptInstall();
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-tea-forest flex items-center justify-center overflow-hidden">
          <img src="/img/company-logo.jpeg" alt="Silver Fir" className="w-full h-full object-cover" />
        </div>
        <div>
          <p className="font-display font-semibold text-sm">Silver Fir App</p>
          <p className="text-xs text-muted-foreground">Clock-in · Leave · Notes · Productivity</p>
        </div>
      </div>

      {canInstall && (
        <Button className="w-full tea-button-primary flex items-center justify-center gap-2" onClick={installNow} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download / Install App
        </Button>
      )}

      {ios && (
        <div className="text-xs text-muted-foreground space-y-1.5 bg-muted/40 rounded-xl p-3">
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5" /> Install on iPhone / iPad
          </p>
          <p className="flex items-center gap-1.5"><span className="text-primary font-semibold">1.</span> Tap <Share2 className="w-3 h-3 inline" /> Share</p>
          <p className="flex items-center gap-1.5"><span className="text-primary font-semibold">2.</span> Tap <Plus className="w-3 h-3 inline" /> Add to Home Screen</p>
        </div>
      )}

      {!canInstall && !ios && (
        <p className="text-xs text-muted-foreground bg-muted/40 rounded-xl p-3">
          Use <span className="font-medium text-foreground">Chrome</span> or <span className="font-medium text-foreground">Edge</span> on your phone or desktop and choose
          {" "}<span className="font-medium text-foreground">"Install app"</span> from the browser menu. It installs like a real app on any device.
        </p>
      )}
    </div>
  );
};

// Slide-up popup shown after a short delay (once per session) when the app is installable.
export const InstallBanner = () => {
  const { canInstall, ios, installed } = usePWAInstall();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open && (canInstall || ios) && !installed) {
      const t = setTimeout(() => {
        if (!sessionStorage.getItem(seenKey)) setOpen(true);
      }, 4500);
      return () => clearTimeout(t);
    }
  }, [canInstall, ios, installed, open]);

  const dismiss = () => {
    sessionStorage.setItem(seenKey, "1");
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 64 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 64 }}
          className="fixed bottom-4 left-4 z-[70] w-[min(92vw,360px)] rounded-2xl border border-border bg-background/95 backdrop-blur-md shadow-2xl p-4"
        >
          <button onClick={dismiss} className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
          <InstallPanel />
          {!canInstall && !ios && (
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={dismiss}>Got it</Button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};