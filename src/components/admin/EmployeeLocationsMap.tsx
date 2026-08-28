import { useEffect, useRef, useState } from "react";
import type { UserWithStats } from "../../pages/Admin";

interface EmployeeLocationsMapProps {
  employee: UserWithStats;
}

// Inject Leaflet CSS + JS once
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

// Deterministic colour per session index
const PIN_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

export default function EmployeeLocationsMap({ employee }: EmployeeLocationsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const sessionsWithLocation = (employee?.sessionHistory ?? []).filter(
    (s) => s.clockInLocation
  );

  // Load Leaflet then mark ready
  useEffect(() => {
    ensureLeaflet().then(() => setReady(true));
  }, []);

  // Build / rebuild map whenever sessions or readiness change
  useEffect(() => {
    if (!ready || !mapContainerRef.current) return;
    if (sessionsWithLocation.length === 0) return;

    const L = (window as any).L;

    // Destroy previous instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    mapInstanceRef.current = map;

    // Custom zoom control – top-right
    L.control.zoom({ position: "topright" }).addTo(map);

    // Tile layer – OpenStreetMap standard (no API key required)
    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }
    ).addTo(map);

    const bounds: [number, number][] = [];
    const markersRef: any[] = [];

    sessionsWithLocation.forEach((session, idx) => {
      const loc = session.clockInLocation!;
      const color = PIN_COLORS[idx % PIN_COLORS.length];
      const date = new Date(session.date).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      const time =
        session.createdAt?.toDate?.().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }) ?? "";

      // Custom SVG pin with employee initials
      const initials = (employee.fullName ?? "?")
        .split(" ")
        .map((w: string) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

      const iconHtml = `
        <div style="
          position:relative;
          width:42px;
          height:52px;
          filter: drop-shadow(0 3px 6px rgba(0,0,0,0.28));
        ">
          <svg viewBox="0 0 42 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:42px;height:52px">
            <path d="M21 2C12.163 2 5 9.163 5 18c0 12.5 16 32 16 32s16-19.5 16-32c0-8.837-7.163-16-16-16z"
              fill="${color}" stroke="white" stroke-width="2"/>
            <circle cx="21" cy="18" r="10" fill="white" fill-opacity="0.92"/>
            <text x="21" y="23" text-anchor="middle"
              font-family="'DM Sans',system-ui,sans-serif"
              font-size="9" font-weight="700" fill="${color}">${initials}</text>
          </svg>
          ${idx === 0 ? `
          <div style="
            position:absolute;top:-8px;right:-8px;
            background:#22c55e;color:white;
            font-size:8px;font-weight:700;font-family:system-ui;
            padding:1px 4px;border-radius:9999px;border:1.5px solid white;
            letter-spacing:0.03em;white-space:nowrap;
          ">LATEST</div>` : ""}
        </div>
      `;

      const icon = L.divIcon({
        html: iconHtml,
        className: "",
        iconSize: [42, 52],
        iconAnchor: [21, 52],
        popupAnchor: [0, -54],
      });

      const marker = L.marker([loc.lat, loc.lng], { icon });

      // Rich popup
      const accuracyClass =
        loc.accuracy <= 20 ? "high" : loc.accuracy <= 100 ? "medium" : "low";
      const accuracyColor =
        accuracyClass === "high" ? "#16a34a" : accuracyClass === "medium" ? "#ca8a04" : "#dc2626";
      const accuracyBg =
        accuracyClass === "high" ? "#dcfce7" : accuracyClass === "medium" ? "#fef9c3" : "#fee2e2";

      marker.bindPopup(`
        <div style="
          font-family:'DM Sans',system-ui,sans-serif;
          min-width:220px;
          padding:4px 2px;
        ">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <div style="
              width:34px;height:34px;border-radius:50%;
              background:${color};color:white;
              display:flex;align-items:center;justify-content:center;
              font-weight:700;font-size:13px;flex-shrink:0;
            ">${initials}</div>
            <div>
              <div style="font-weight:700;font-size:14px;color:#0f172a;line-height:1.2;">
                ${employee.fullName ?? "Employee"}
              </div>
              <div style="font-size:11px;color:#64748b;">${date}${time ? " · " + time : ""}</div>
            </div>
          </div>

          <div style="
            background:#f8fafc;border:1px solid #e2e8f0;
            border-radius:8px;padding:10px;margin-bottom:8px;
          ">
            <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:4px;">
              📍 ${loc.label}
            </div>
            <div style="font-size:10px;font-family:monospace;color:#94a3b8;">
              ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:6px;">
            <span style="
              font-size:10px;font-weight:700;padding:2px 7px;
              border-radius:999px;
              background:${accuracyBg};color:${accuracyColor};
            ">±${loc.accuracy}m</span>
            <span style="font-size:10px;color:#94a3b8;">GPS accuracy</span>
          </div>
        </div>
      `, { maxWidth: 280, className: "pog-popup" });

      marker.on("click", () => setSelectedIdx(idx));
      marker.addTo(map);
      markersRef.push(marker);
      bounds.push([loc.lat, loc.lng]);
    });

    // Fit map to all markers
    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else {
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    // Open popup for latest on load
    if (markersRef.length > 0) {
      setTimeout(() => markersRef[0].openPopup(), 400);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [ready, employee]);

  // ── No location state ────────────────────────────────────────────────────────
  if (sessionsWithLocation.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground py-12">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm">No location data available</p>
          <p className="text-xs mt-1 max-w-xs">
            {employee.fullName} hasn't clocked in with location tracking enabled yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">

      {/* ── Map header ── */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-semibold text-foreground">
            {sessionsWithLocation.length} clock-in location{sessionsWithLocation.length !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Powered by OpenStreetMap · CARTO
        </span>
      </div>

      {/* ── Map container ── */}
      <div className="relative rounded-xl overflow-hidden border border-border shadow-sm" style={{ height: 320 }}>
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Loading overlay */}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/60 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground">Loading map…</span>
            </div>
          </div>
        )}

        {/* Legend overlay – bottom-left */}
        <div className="absolute bottom-2 left-2 z-[400] bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-md pointer-events-none">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Legend</p>
          <div className="flex flex-col gap-1">
            {sessionsWithLocation.slice(0, 4).map((session, idx) => {
              const color = PIN_COLORS[idx % PIN_COLORS.length];
              const date = new Date(session.date).toLocaleDateString("en-GB", {
                day: "2-digit", month: "short",
              });
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/80"
                    style={{ background: color }}
                  />
                  <span className="text-[10px] text-foreground font-medium leading-none">
                    {date}
                    {idx === 0 && (
                      <span className="ml-1 text-[8px] text-green-600 font-bold">latest</span>
                    )}
                  </span>
                </div>
              );
            })}
            {sessionsWithLocation.length > 4 && (
              <span className="text-[9px] text-muted-foreground">
                +{sessionsWithLocation.length - 4} more
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Location list ── */}
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
        {sessionsWithLocation.map((session, idx) => {
          const loc = session.clockInLocation!;
          const color = PIN_COLORS[idx % PIN_COLORS.length];
          const date = new Date(session.date).toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", year: "numeric",
          });
          const time =
            session.createdAt?.toDate?.().toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit",
            }) ?? "";
          const isSelected = selectedIdx === idx;

          return (
            <button
              key={idx}
              onClick={() => {
                setSelectedIdx(idx);
                const L = (window as any).L;
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setView([loc.lat, loc.lng], 16, { animate: true });
                }
              }}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all border ${
                isSelected
                  ? "border-border bg-muted shadow-sm"
                  : "border-transparent hover:bg-muted/60"
              }`}
            >
              {/* Colour dot */}
              <div
                className="w-3 h-3 rounded-full mt-0.5 flex-shrink-0 ring-2 ring-white shadow"
                style={{ background: color }}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">
                    {employee.fullName}
                  </span>
                  {idx === 0 && (
                    <span className="text-[9px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-200">
                      LATEST
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5" title={loc.label}>
                  📍 {loc.label}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground">{date}{time ? ` · ${time}` : ""}</span>
                  <span
                    className="text-[9px] font-semibold px-1 rounded"
                    style={{
                      background: loc.accuracy <= 20 ? "#dcfce7" : loc.accuracy <= 100 ? "#fef9c3" : "#fee2e2",
                      color: loc.accuracy <= 20 ? "#16a34a" : loc.accuracy <= 100 ? "#ca8a04" : "#dc2626",
                    }}
                  >
                    ±{loc.accuracy}m
                  </span>
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          );
        })}
      </div>

      {/* Leaflet popup style override */}
      <style>{`
        .pog-popup .leaflet-popup-content-wrapper {
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.15);
          border: 1px solid #e2e8f0;
          padding: 0;
        }
        .pog-popup .leaflet-popup-content {
          margin: 14px 16px;
        }
        .pog-popup .leaflet-popup-tip {
          background: white;
        }
        .leaflet-attribution-flag { display: none !important; }
      `}</style>
    </div>
  );
}