import { useEffect, useRef, useState } from "react";
import type { UserWithStats } from "../../pages/Admin";

interface AllEmployeesLocationsMapProps {
  users: UserWithStats[];
}

// ── Leaflet loader (injected once) ───────────────────────────────────────────
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

// ── Distinct colours per employee ────────────────────────────────────────────
const EMPLOYEE_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f97316",
  "#8b5cf6", "#ec4899", "#14b8a6", "#eab308",
  "#06b6d4", "#84cc16", "#f43f5e", "#a855f7",
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ── Types ────────────────────────────────────────────────────────────────────
interface PinData {
  lat: number;
  lng: number;
  employeeName: string;
  employeeEmail: string;
  date: string;
  time: string;
  accuracy: number;
  label: string;
  color: string;
  initials: string;
  isLatest: boolean; // latest session for this employee
}

export default function AllEmployeesLocationsMap({ users }: AllEmployeesLocationsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map()); // employeeName → leaflet marker
  const [ready, setReady] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Build pin data from users ──────────────────────────────────────────────
  const employeeColorMap = new Map<string, string>();
  const allPins: PinData[] = [];

  // Assign stable colours per unique employee
  const uniqueEmployees = [...new Set(
    users.map((u) => u.fullName || u.email || "Unknown")
  )];
  uniqueEmployees.forEach((name, idx) => {
    employeeColorMap.set(name, EMPLOYEE_COLORS[idx % EMPLOYEE_COLORS.length]);
  });

  users.forEach((user) => {
    const employeeName = user.fullName || user.email || "Unknown";
    const color = employeeColorMap.get(employeeName) ?? "#6b7280";
    const sessions = (user.sessionHistory ?? []).filter((s) => s.clockInLocation);

    sessions.forEach((session, sIdx) => {
      const loc = session.clockInLocation!;
      const time =
        session.createdAt?.toDate?.().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }) ?? "";

      allPins.push({
        lat: loc.lat,
        lng: loc.lng,
        employeeName,
        employeeEmail: user.email ?? "",
        date: session.date,
        time,
        accuracy: loc.accuracy,
        label: loc.label,
        color,
        initials: getInitials(employeeName),
        isLatest: sIdx === 0, // sessionHistory assumed newest-first
      });
    });
  });

  // Filtered pins for the list panel
  const filteredEmployees = uniqueEmployees.filter((name) =>
    name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // only show the most recent location for each employee
  const displayPins = allPins.filter((p) => p.isLatest);

  // ── Load Leaflet ────────────────────────────────────────────────────────────
  useEffect(() => {
    ensureLeaflet().then(() => setReady(true));
  }, []);

  // ── Build map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapContainerRef.current) return;

    const L = (window as any).L;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    markersRef.current.clear();

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    mapInstanceRef.current = map;

    L.control.zoom({ position: "topright" }).addTo(map);

    // OpenStreetMap standard tiles (no API key required)
    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }
    ).addTo(map);

    if (displayPins.length === 0) {
      map.setView([20, 0], 2);
      return;
    }

    const bounds: [number, number][] = [];

    displayPins.forEach((pin) => {
      const iconHtml = `
        <div style="
          position:relative;
          filter:drop-shadow(0 3px 8px rgba(0,0,0,0.28));
          cursor:pointer;
        ">
          <svg viewBox="0 0 44 56" width="44" height="56" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2C13.163 2 6 9.163 6 18c0 12.5 16 34 16 34s16-21.5 16-34C38 9.163 30.837 2 22 2z"
              fill="${pin.color}" stroke="white" stroke-width="2.5"/>
            <circle cx="22" cy="18" r="10" fill="white" fill-opacity="0.93"/>
            <text x="22" y="23" text-anchor="middle"
              font-family="'DM Sans',system-ui,sans-serif"
              font-size="9" font-weight="800" fill="${pin.color}">${pin.initials}</text>
          </svg>
          ${pin.isLatest ? `
          <div style="
            position:absolute;top:-9px;right:-10px;
            background:#22c55e;color:white;
            font-size:7px;font-weight:800;font-family:system-ui;
            padding:1px 4px;border-radius:999px;
            border:1.5px solid white;
            letter-spacing:0.04em;white-space:nowrap;
          ">NOW</div>` : ""}
          <div style="
            position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);
            background:${pin.color};color:white;
            font-size:8.5px;font-weight:700;font-family:'DM Sans',system-ui,sans-serif;
            padding:2px 6px;border-radius:5px;white-space:nowrap;
            border:1.5px solid white;
            box-shadow:0 2px 6px rgba(0,0,0,0.2);
            pointer-events:none;
            max-width:100px;overflow:hidden;text-overflow:ellipsis;
          ">${pin.employeeName.split(" ")[0]}</div>
        </div>
      `;

      const icon = (window as any).L.divIcon({
        html: iconHtml,
        className: "",
        iconSize: [44, 76],
        iconAnchor: [22, 56],
        popupAnchor: [0, -58],
      });

      const accuracyColor =
        pin.accuracy <= 20 ? "#16a34a" : pin.accuracy <= 100 ? "#ca8a04" : "#dc2626";
      const accuracyBg =
        pin.accuracy <= 20 ? "#dcfce7" : pin.accuracy <= 100 ? "#fef9c3" : "#fee2e2";

      const marker = L.marker([pin.lat, pin.lng], { icon });

      marker.bindPopup(`
        <div style="font-family:'DM Sans',system-ui,sans-serif;min-width:230px;padding:2px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <div style="
              width:36px;height:36px;border-radius:50%;flex-shrink:0;
              background:${pin.color};color:white;
              display:flex;align-items:center;justify-content:center;
              font-weight:800;font-size:13px;letter-spacing:-0.5px;
            ">${pin.initials}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:14px;color:#0f172a;line-height:1.2;">
                ${pin.employeeName}
              </div>
              <div style="font-size:10px;color:#64748b;margin-top:1px;">
                ${pin.employeeEmail}
              </div>
            </div>
            ${pin.isLatest ? `
            <div style="
              background:#dcfce7;color:#16a34a;
              font-size:8px;font-weight:800;
              padding:2px 6px;border-radius:999px;
              border:1px solid #bbf7d0;flex-shrink:0;
            ">LATEST</div>` : ""}
          </div>

          <div style="
            background:#f8fafc;border:1px solid #e2e8f0;
            border-radius:8px;padding:10px;margin-bottom:10px;
          ">
            <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:3px;">
              📍 ${pin.label}
            </div>
            <div style="font-family:monospace;font-size:10px;color:#94a3b8;">
              ${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="
                font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;
                background:${accuracyBg};color:${accuracyColor};
              ">±${pin.accuracy}m</span>
              <span style="font-size:10px;color:#94a3b8;">accuracy</span>
            </div>
            <div style="font-size:11px;color:#64748b;">
              ${pin.date}${pin.time ? " · " + pin.time : ""}
            </div>
          </div>
        </div>
      `, { maxWidth: 290, className: "pog-all-popup" });

      marker.on("click", () => setSelectedEmployee(pin.employeeName));
      marker.addTo(map);
      // Store only the latest marker per employee for fly-to
      if (pin.isLatest) {
        markersRef.current.set(pin.employeeName, marker);
      }
      bounds.push([pin.lat, pin.lng]);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [48, 48] });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [ready, users]);

  // ── Fly-to on employee select ───────────────────────────────────────────────
  function flyToEmployee(name: string) {
    setSelectedEmployee(name);
    const marker = markersRef.current.get(name);
    const map = mapInstanceRef.current;
    if (marker && map) {
      const latlng = marker.getLatLng();
      map.flyTo(latlng, 16, { animate: true, duration: 0.8 });
      setTimeout(() => marker.openPopup(), 900);
    }
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  const hasAnyLocation = displayPins.length > 0;

  return (
    <div className="flex flex-col h-full gap-6">

      {/* ── Stats bar ── */}
      <div className="flex justify-between gap-4 p-4 bg-background/30 rounded-xl shadow-md">
        {[
          { label: "Total Employees", value: uniqueEmployees.length },
          { label: "With Location", value: uniqueEmployees.filter(n => displayPins.some(p => p.employeeName === n)).length },
          { label: "Latest Pins", value: displayPins.length },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex-1 flex flex-col items-center justify-center bg-card/70 backdrop-blur-sm rounded-lg py-4 px-2 shadow-inner"
          >
            <div className="text-2xl font-extrabold text-foreground leading-none">
              {stat.value}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Map ── */}
      <div className="relative rounded-2xl overflow-hidden border border-border shadow-lg flex-shrink-0" style={{ height: 480 }}>
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

        {/* No data overlay */}
        {ready && !hasAnyLocation && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/40 backdrop-blur-sm z-10 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-background border border-border flex items-center justify-center shadow">
              <svg className="w-7 h-7 text-muted-foreground opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold">No location data yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Employees will appear here after clocking in with location enabled.</p>
            </div>
          </div>
        )}

        {/* Attribution note */}
        <div className="absolute bottom-1 right-10 z-[400] text-[9px] text-muted-foreground pointer-events-none">
          Map © OSM · CARTO
        </div>
      </div>

      {/* ── Employee legend + list ── */}
      {hasAnyLocation && (
        <div className="flex flex-col gap-3">
          {/* Search */}
          <div className="relative w-full">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search employee…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-2 text-xs rounded-lg border border-border bg-background shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Employee cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">            {filteredEmployees.map((name) => {
              const color = employeeColorMap.get(name) ?? "#6b7280";
              const employeePins = allPins.filter((p) => p.employeeName === name);
              const latestPin = employeePins.find((p) => p.isLatest) ?? employeePins[0];
              const isSelected = selectedEmployee === name;

              if (!latestPin) return null;

              return (
                <button
                  key={name}
                  onClick={() => flyToEmployee(name)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all border ${
                    isSelected
                      ? "border-border bg-muted shadow-sm"
                      : "border-transparent hover:bg-muted/60"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow"
                    style={{ background: color }}
                  >
                    {getInitials(name)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {name}
                      </span>
                      {latestPin.isLatest && employeePins.length > 0 && (
                        <span className="text-[8px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-200 flex-shrink-0">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5" title={latestPin.label}>
                      📍 {latestPin.label}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-muted-foreground">
                        {employeePins.length} session{employeePins.length !== 1 ? "s" : ""}
                      </span>
                      <span className="text-[9px] text-muted-foreground">·</span>
                      <span className="text-[9px] text-muted-foreground">
                        Last: {latestPin.date}{latestPin.time ? ` ${latestPin.time}` : ""}
                      </span>
                    </div>
                  </div>

                  {/* Colour dot + chevron */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm" style={{ background: color }} />
                    <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                  </div>
                </button>
              );
            })}

            {filteredEmployees.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-2 py-4 text-center">
                No employees match "{searchQuery}"
              </p>
            )}
          </div>
        </div>
      )}

      {/* Popup styles */}
      <style>{`
        .pog-all-popup .leaflet-popup-content-wrapper {
          border-radius: 14px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.16);
          border: 1px solid #e2e8f0;
          padding: 0;
        }
        .pog-all-popup .leaflet-popup-content {
          margin: 14px 16px;
        }
        .pog-all-popup .leaflet-popup-tip { background: white; }
        .leaflet-attribution-flag { display:none !important; }
      `}</style>
    </div>
  );
}