import { useState, useEffect, useRef } from "react";
import type { WorkSession } from "@/integrations/firebase/types";

interface AdminLocationViewProps {
  session: WorkSession & { userName?: string };
}

function ensureLeaflet(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).L) { resolve(); return; }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

export default function AdminLocationView({ session }: AdminLocationViewProps) {
  const loc = session?.clockInLocation;
  const [mapOpen, setMapOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  const userName = session.userName ?? "Employee";
  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (!mapOpen || !loc || !mapRef.current) return;

    ensureLeaflet().then(() => {
      const L = (window as any).L;

      // Prevent double-init
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current!, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
      });
      mapInstanceRef.current = map;

      L.control.zoom({ position: "topright" }).addTo(map);

      L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }
      ).addTo(map);

      map.setView([loc.lat, loc.lng], 15);

      // Custom named pin
      const iconHtml = `
        <div style="position:relative;filter:drop-shadow(0 3px 8px rgba(0,0,0,0.3))">
          <svg viewBox="0 0 44 54" width="44" height="54" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2C13.163 2 6 9.163 6 18c0 12.5 16 32 16 32s16-19.5 16-32c0-8.837-7.163-16-16-16z"
              fill="#ef4444" stroke="white" stroke-width="2"/>
            <circle cx="22" cy="18" r="10" fill="white" fill-opacity="0.93"/>
            <text x="22" y="23" text-anchor="middle"
              font-family="system-ui,sans-serif"
              font-size="9" font-weight="800" fill="#ef4444">${initials}</text>
          </svg>
          <div style="
            position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);
            background:#0f172a;color:white;
            font-size:9px;font-weight:600;font-family:system-ui;
            padding:2px 6px;border-radius:4px;white-space:nowrap;
            pointer-events:none;
          ">${userName}</div>
        </div>
      `;

      const icon = L.divIcon({
        html: iconHtml,
        className: "",
        iconSize: [44, 72],
        iconAnchor: [22, 54],
        popupAnchor: [0, -56],
      });

      L.marker([loc.lat, loc.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:system-ui,sans-serif;min-width:180px;">
            <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:4px;">
              ${userName}
            </div>
            <div style="font-size:11px;color:#334155;margin-bottom:6px;">
              📍 ${loc.label}
            </div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8;">
              ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}
            </div>
          </div>
        `, { className: "pog-mini-popup" })
        .openPopup();
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapOpen, loc]);

  if (!loc) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1 bg-muted/50 rounded-md">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.59 16.59A9 9 0 0 1 3 10c0-2.61 1.1-4.96 2.87-6.65M21 10c0 7-9 13-9 13a23.35 23.35 0 0 1-3.56-3.05" />
        </svg>
        No location
      </span>
    );
  }

  const { lat, lng, label, accuracy, capturedAt } = loc;
  const accuracyLevel = accuracy <= 20 ? "high" : accuracy <= 100 ? "medium" : "low";
  const accuracyStyle = {
    high:   { bg: "#dcfce7", color: "#16a34a" },
    medium: { bg: "#fef9c3", color: "#ca8a04" },
    low:    { bg: "#fee2e2", color: "#dc2626" },
  }[accuracyLevel];

  const osmLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

  return (
    <div className="flex flex-col gap-2">

      {/* ── Location pill ── */}
      <div className="flex items-start gap-2">
        <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate leading-tight" title={label}>
            {label}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: accuracyStyle.bg, color: accuracyStyle.color }}
            >
              ±{accuracy}m
            </span>
            {capturedAt && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Toggle button ── */}
      <button
        className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 hover:text-blue-700 w-fit transition-colors"
        onClick={() => setMapOpen((v) => !v)}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: mapOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        {mapOpen ? "Hide map" : "Show on map"}
      </button>

      {/* ── Inline Leaflet map ── */}
      {mapOpen && (
        <div className="rounded-lg overflow-hidden border border-border shadow-sm" style={{ height: 200 }}>
          <div ref={mapRef} className="w-full h-full" />
        </div>
      )}

      {/* ── Footer ── */}
      {mapOpen && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </span>
          <a href={osmLink} target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-blue-600 hover:underline font-medium">
            Open in OSM ↗
          </a>
        </div>
      )}

      <style>{`
        .pog-mini-popup .leaflet-popup-content-wrapper {
          border-radius:10px;
          box-shadow:0 6px 24px rgba(0,0,0,0.13);
          border:1px solid #e2e8f0;
          padding:0;
        }
        .pog-mini-popup .leaflet-popup-content { margin:12px 14px; }
        .pog-mini-popup .leaflet-popup-tip { background:white; }
      `}</style>
    </div>
  );
}