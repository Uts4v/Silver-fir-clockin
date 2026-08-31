/*
 * TeamAttendance.tsx — Admin attendance panel.
 * Left sidebar lists every team member; picking a member shows their
 * personal attendance calendar (month-based) on the right.
 * Also supports exporting attendance as CSV or PDF — per member or all.
 */

import { useState } from "react";
import {
  Users, Search, ChevronRight, CalendarDays, Download, FileSpreadsheet, FileText,
} from "lucide-react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { WorkSession } from "@/integrations/firebase/types";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import AttendanceCalendar from "@/components/admin/Attendencecalendar";

interface TeamMember {
  id: string;
  fullName?: string;
  email: string;
}

interface Props {
  users: TeamMember[];
}

function Initial({ name }: { name?: string }) {
  const ini = (name ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 bg-gradient-to-br from-indigo-500 to-indigo-700">
      {ini}
    </div>
  );
}

/* ─── Export helpers ─────────────────────────────────── */

function fmtDur(sec: number): string {
  if (!sec || sec < 0) return "0h 0m";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function localTime(ts?: { toDate?: () => Date } | null): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  try {
    const d = ts.toDate();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function statusLabel(s?: string): string {
  if (!s) return "—";
  if (s === "completed") return "Completed";
  if (s === "working") return "Working";
  if (s === "break") return "Break";
  if (s === "idle") return "Idle";
  return s;
}

async function fetchUserSessions(uid: string): Promise<WorkSession[]> {
  try {
    const q = query(collection(db, "users", uid, "sessions"), orderBy("date", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as WorkSession);
  } catch (e) {
    console.error("Export fetch error:", e);
    return [];
  }
}

function escapeCsv(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Builds CSV rows: one row per session (arrival time, location, etc.)
function buildRows(rows: { emp: string; s: WorkSession }[]): string[][] {
  return rows.map(({ emp, s }) => [
    emp,
    s.date || "—",
    new Date(s.date).toLocaleDateString("en-US", { weekday: "long" }),
    localTime(s.workStartTime),
    s.workEndTime ? localTime(s.workEndTime) : "—",
    fmtDur(s.totalWorkDuration),
    fmtDur(s.totalBreakDuration),
    statusLabel(s.status),
    s.clockInLocation?.label || "—",
    s.clockInLocation?.fullAddress || "—",
    s.clockInLocation?.lat?.toString() ?? "—",
    s.clockInLocation?.lng?.toString() ?? "—",
    s.clockInLocation?.distanceMeters != null ? `${Math.round(s.clockInLocation.distanceMeters)}m` : "—",
    s.clockInLocation?.inRadius != null ? (s.clockInLocation.inRadius ? "Yes" : "No") : "—",
  ]);
}

const HEADERS = [
  "Employee", "Date", "Day", "Check In (Arrival)", "Check Out", "Work",
  "Break", "Status", "Location", "Address", "Lat", "Lng", "Distance", "In Radius",
];

function downloadCsv(filename: string, rows: string[][]) {
  const csv = "\uFEFF" + [HEADERS.map(escapeCsv).join(","), ...rows.map(r => r.map(escapeCsv).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadPdf(filename: string, title: string, rows: string[][]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(15);
  doc.text(title, 14, 16);
  autoTable(doc, {
    startY: 24,
    theme: "grid",
    styles: { fontSize: 7 },
    headStyles: { fillColor: [99, 102, 241] },
    head: [HEADERS],
    body: rows,
  });
  doc.save(filename);
}

export default function TeamAttendance({ users }: Props) {
  const [selected, setSelected] = useState<TeamMember | null>(users[0] ?? null);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  const activeUser = (selected && users.find(u => u.id === selected.id)) || users[0] || null;

  const filtered = users.filter(u =>
    (u.fullName ?? "").toLowerCase().includes(query.toLowerCase()) ||
    u.email.toLowerCase().includes(query.toLowerCase())
  );

  const buildAll = async () => {
    const out: { emp: string; s: WorkSession }[] = [];
    for (const u of users) {
      const sessions = await fetchUserSessions(u.id);
      sessions.forEach(s => out.push({ emp: u.fullName || u.email || "Employee", s }));
    }
    return out;
  };

  const exportCsv = async (scope: "selected" | "all") => {
    if (scope === "selected" && !activeUser) { toast.error("No member selected"); return; }
    setExporting(true);
    try {
      let rows: { emp: string; s: WorkSession }[];
      let filename: string;
      if (scope === "selected") {
        const sessions = await fetchUserSessions(activeUser!.id);
        rows = sessions.map(s => ({ emp: activeUser!.fullName || activeUser!.email || "Employee", s }));
        filename = `attendance_${(activeUser!.fullName || activeUser!.email || "employee").replace(/\s+/g, "_")}.csv`;
      } else {
        rows = await buildAll();
        filename = `all_employee_attendance.csv`;
      }
      downloadCsv(filename, buildRows(rows));
      toast.success(scope === "selected" ? "CSV downloaded" : "All attendance CSV downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (scope: "selected" | "all") => {
    if (scope === "selected" && !activeUser) { toast.error("No member selected"); return; }
    setExporting(true);
    try {
      let rows: { emp: string; s: WorkSession }[];
      let title: string;
      let filename: string;
      if (scope === "selected") {
        const sessions = await fetchUserSessions(activeUser!.id);
        rows = sessions.map(s => ({ emp: activeUser!.fullName || activeUser!.email || "Employee", s }));
        title = `Attendance — ${activeUser!.fullName || activeUser!.email || "Employee"}`;
        filename = `attendance_${(activeUser!.fullName || activeUser!.email || "employee").replace(/\s+/g, "_")}.pdf`;
      } else {
        rows = await buildAll();
        title = "All Employee Attendance";
        filename = "all_employee_attendance.pdf";
      }
      downloadPdf(filename, title, buildRows(rows));
      toast.success(scope === "selected" ? "PDF downloaded" : "All attendance PDF downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
      {/* ── Member list sidebar ── */}
      <div className="pg rounded-2xl overflow-hidden lg:sticky lg:top-4">
        <div className="px-4 py-3 border-b border-white/[0.055] flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-indigo-400" />
          <span className="ph text-sm font-semibold text-white">Team Members</span>
          <span className="ml-auto text-[10px] text-white/25">{users.length}</span>
        </div>

        <div className="p-2 border-b border-white/[0.04]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search members…"
              className="w-full pl-8 pr-3 py-2 rounded-xl text-xs text-white bg-transparent pg focus:outline-none focus:ring-1 focus:ring-indigo-500/30 placeholder-white/15"
            />
          </div>
        </div>

        <div className="max-h-[68vh] overflow-y-auto">
          {filtered.length === 0 && (
            <p className="py-10 text-center text-xs text-white/18">No members found</p>
          )}
          {filtered.map(u => {
            const active = activeUser?.id === u.id;
            return (
              <button key={u.id} onClick={() => setSelected(u)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-white/[0.03] last:border-0 ${
                  active ? "bg-indigo-500/12" : "hover:bg-white/[0.02]"
                }`}>
                <Initial name={u.fullName} />
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold truncate ${active ? "text-indigo-300" : "text-white/80"}`}>
                    {u.fullName || u.email || "—"}
                  </p>
                  <p className="text-[9px] text-white/22 truncate">{u.email}</p>
                </div>
                <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${active ? "text-indigo-400" : "text-white/12"}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Selected member's attendance calendar ── */}
      <div className="min-w-0">
        {/* Export toolbar */}
        <div className="pg rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mr-auto px-1">
            Export Attendance
          </span>

          <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/10 rounded-xl p-1">
            <span className="px-2 text-[10px] text-white/35 uppercase tracking-wider">Selected</span>
            <button onClick={() => exportCsv("selected")} disabled={exporting || !activeUser}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 rounded-lg hover:bg-emerald-500/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Download selected member's attendance as CSV">
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={() => exportPdf("selected")} disabled={exporting || !activeUser}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 rounded-lg hover:bg-rose-500/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Download selected member's attendance as PDF">
              <FileText className="w-3.5 h-3.5" /> PDF
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/10 rounded-xl p-1">
            <span className="px-2 text-[10px] text-white/35 uppercase tracking-wider">All Employees</span>
            <button onClick={() => exportCsv("all")} disabled={exporting || users.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-300 rounded-lg hover:bg-sky-500/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Download everyone's attendance as CSV">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={() => exportPdf("all")} disabled={exporting || users.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-300 rounded-lg hover:bg-violet-500/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Download everyone's attendance as PDF">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        </div>

        {activeUser ? (
          <div className="dark">
            <AttendanceCalendar userId={activeUser.id} employeeName={activeUser.fullName} />
          </div>
        ) : (
          <div className="pg rounded-2xl py-20 flex flex-col items-center gap-3 text-center">
            <CalendarDays className="w-8 h-8 text-white/10" />
            <p className="text-sm text-white/18">No team members found</p>
          </div>
        )}
      </div>
    </div>
  );
}
