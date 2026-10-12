/*
 * © 2026 Utsav Shrestha. All rights reserved.
 * This software and its source code are the proprietary property of Utsav Shrestha.
 * No part of this code may be copied, reproduced, or distributed without
 * express written permission.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthContext } from "@/contexts/AuthContext";
import { db, firebaseConfig, auth as authenticatedAuth } from "@/integrations/firebase/client";
import { formatTimeShort, invalidateGeofenceCache } from "@/hooks/useWorkSession";
import { PRESENCE_STALE_MS } from "@/hooks/usePresence";
import { readCountOf } from "@/integrations/notifications";
import { useLocationCapture } from "@/hooks/useLocation";
import { toast } from "sonner";
import { createUserWithEmailAndPassword, initializeAuth, inMemoryPersistence, signOut, sendPasswordResetEmail } from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import {
  collection, doc, deleteDoc, getDocs, getDoc, onSnapshot, Timestamp,
  updateDoc, setDoc, addDoc, query, orderBy, limit, where,
} from "firebase/firestore";
import { Profile, Company } from "@/integrations/firebase/types";
import { normalizePhone, syntheticEmailForPhone } from "@/hooks/useAuth";
import AdminLocationView from "@/components/admin/AdminLocationView";
import EmployeeLocationsMap from "@/components/admin/EmployeeLocationsMap";
import AllEmployeesLocationsMap from "@/components/admin/AllEmployeesLocationsMap";
import AttendanceCalendar from "@/components/admin/Attendencecalendar";
import TeamAttendance from "@/components/admin/TeamAttendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Trash2, Users, Shield, ShieldCheck, RefreshCw, Search,
  Calendar, DollarSign, BarChart3, Clock, Coffee, Target,
  X, Eye, Download, FileText, MapPin, TrendingUp, TrendingDown,
  Activity, Zap, Award, LayoutDashboard, CreditCard, Ban, Unlock,
  Map as MapIcon, Settings as SettingsIcon, UserPlus, Save,
  Building2, KeyRound, Check, Image as ImageIcon, Mail, Plus,
  Bell, Eye as EyeIcon,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkSession {
  id: string; userId: string; date: string;
  workStartTime?: Timestamp; workEndTime?: Timestamp;
  totalWorkDuration: number; totalBreakDuration: number;
  status: "idle" | "working" | "break" | "completed";
  createdAt: Timestamp; updatedAt: Timestamp;
  clockInLocation?: {
    lat: number; lng: number; accuracy: number;
    label: string; fullAddress: string; city: string; country: string; capturedAt: string;
    siteId?: string; siteName?: string;
  };
}

interface BreakLog {
  id: string;
  breakStart: Timestamp;
  breakEnd?: Timestamp;
  createdAt?: Timestamp;
}

interface UserWithStats extends Profile {
  todayWorkTime: number; todayBreakTime: number;
  monthWorkTime: number; monthBreakTime: number;
  currentStatus: string; isActive: boolean;
  last30DaysWorkTime: number; last30DaysBreakTime: number; last30DaysSessions: number;
  averageDailyWorkTime: number; focusRate: number;
  totalSessionsThisMonth: number; averageSessionDuration: number;
  weeklyWorkPattern: { [key: string]: number };
  dailyWorkPattern: Array<{ date: string; workTime: number; breakTime: number }>;
  sessionHistory?: WorkSession[];
  prev30DaysFocusRate?: number; prev30DaysWorkHours?: number;
  department?: string;
}

export type { UserWithStats };

interface Subscription {
  id: string; name: string;
  renewed_date?: Timestamp; deadline_date?: Timestamp; renewalDate?: Timestamp;
  cost: number; isActive: boolean;
}

// Editable geo-fence site draft for the settings form. Numeric fields stay as
// strings so they can bind directly to <Input> values. `radius` is blank when
// the outlet inherits the company default; `radiusOverride` drives the checkbox.
interface SiteDraft {
  id: string; // "" until first save creates the Firestore doc
  name: string;
  lat: string;
  lng: string;
  radius: string;   // "" = inherit the company-wide default
  radiusOverride: boolean;
  active: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#818cf8","#34d399","#fbbf24","#f87171","#a78bfa","#38bdf8","#fb923c","#4ade80"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Downscale an uploaded logo to max 256×256 so the data-URL stays well under
// Firestore's 1MB document limit (PNG keeps transparency; falls back to JPEG).
function resizeLogo(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("Canvas is not supported")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const png = canvas.toDataURL("image/png");
      resolve(png.length > 800000 ? canvas.toDataURL("image/jpeg", 0.85) : png);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

function formatTime(s: number) {
  if (!s || s < 0) s = 0;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}
function fmtHrs(s: number) { return (s/3600).toFixed(1); }
function focusColor(r: number) { return r>=80?"#34d399":r>=65?"#fbbf24":"#f87171"; }
function statusCfg(st: string) {
  if (st==="working") return { label:"Working",  dot:"#34d399", bg:"rgba(52,211,153,0.1)",  tx:"#34d399" };
  if (st==="break")   return { label:"On Break", dot:"#fbbf24", bg:"rgba(251,191,36,0.1)",  tx:"#fbbf24" };
  return                     { label:"Offline",  dot:"#64748b", bg:"rgba(100,116,139,0.1)", tx:"#64748b" };
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avi({ name, sz="md" }: { name?:string; sz?:"sm"|"md"|"lg" }) {
  const ini = (name??"?").split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const pals = [["#6366f1","#4f46e5"],["#06b6d4","#0891b2"],["#10b981","#059669"],["#f59e0b","#d97706"],["#ec4899","#db2777"],["#8b5cf6","#7c3aed"]];
  const [a,b] = pals[(name?.charCodeAt(0)??0)%pals.length];
  const dim = {sm:"w-7 h-7 text-[9px]",md:"w-9 h-9 text-xs",lg:"w-11 h-11 text-sm"}[sz];
  return <div className={`${dim} rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0`} style={{background:`linear-gradient(135deg,${a},${b})`}}>{ini}</div>;
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KPI({ icon:Icon, label, value, sub, color }: {icon:any;label:string;value:string;sub:string;color:string}) {
  return (
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
      className="relative overflow-hidden rounded-2xl p-5 border group transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-2xl"
      style={{background:"linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))",borderColor:"rgba(255,255,255,0.07)"}}>
      <span className="absolute inset-x-0 top-0 h-[2px] opacity-70" style={{background:`linear-gradient(90deg,transparent,${color},transparent)`}}/>
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-[0.16] group-hover:opacity-30 transition-opacity" style={{background:color}}/>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{background:`${color}22`}}>
        <Icon className="w-4 h-4" style={{color}}/>
      </div>
      <p className="text-[26px] leading-none font-bold text-white tracking-tight mb-1.5">{value}</p>
      <p className="text-xs font-semibold" style={{color}}>{label}</p>
      <p className="text-[10px] text-white/40 mt-0.5">{sub}</p>
    </motion.div>
  );
}

// ─── Shared chart tooltip ────────────────────────────────────────────────────

const TT = {
  contentStyle:{background:"#0d0f18",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,fontSize:12,color:"white",padding:"10px 14px"},
  cursor:{fill:"rgba(255,255,255,0.03)"},
  labelStyle:{color:"rgba(255,255,255,0.4)",marginBottom:3},
  itemStyle:{color:"white"},
};

// Page headers for each section — gives every screen a clear title and purpose.
const SECTION_META: Record<string,{title:string;desc:string}> = {
  overview:      { title:"Overview",      desc:"A live snapshot of your team's activity today" },
  team:          { title:"Team",          desc:"Everyone in your organization and their real-time status" },
  attendance:    { title:"Attendance",    desc:"Daily attendance and calendars for your team" },
  analytics:     { title:"Analytics",     desc:"Focus, work and break trends across the team" },
  locations:     { title:"Locations",     desc:"Real-time clock-in map and outlet radius" },
  subscriptions: { title:"Subscriptions", desc:"Track recurring costs and upcoming renewals" },
  sent:          { title:"Sent",          desc:"Notifications you've sent and who has read them" },
  settings:      { title:"Settings",      desc:"Company profile, logo and geo-fence configuration" },
};

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

const Admin = () => {
  const { user, profile, loading: authLoading } = useAuthContext();

  const [users,         setUsers]         = useState<UserWithStats[]>([]);
  const [blocked,       setBlocked]       = useState<Set<string>>(new Set());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [error,         setError]         = useState<string|null>(null);
  const [section, setSection] = useState<"overview"|"team"|"attendance"|"analytics"|"locations"|"subscriptions"|"sent"|"settings">("overview");
  const [selEmp,        setSelEmp]        = useState<UserWithStats|null>(null);
  const [empOpen,       setEmpOpen]       = useState(false);
  const [empLoading,    setEmpLoading]    = useState(false);
  const [deptFilter,    setDeptFilter]    = useState<string>("all");

  // Realtime presence: liveStatus/{uid} docs emitted by employees on every
  // status transition. Snapshot listener → Working/Break/Offline updates instantly.
  // `updatedAt` may be null for a moment while a new server timestamp is being
  // acknowledged — kept nullable so we fall back to the stored session instead
  // of treating a just-written status as stale.
  const [liveMap, setLiveMap] = useState<Record<string, { status: string; updatedAt: Timestamp | null }>>({});

  // Company + settings
  const [company,        setCompany]       = useState<Company|null>(null);
  const [geoEnabled,     setGeoEnabled]    = useState(false);
  const [sites,          setSites]         = useState<SiteDraft[]>([]);
  const [defaultRadius,   setDefaultRadius]  = useState("150"); // shared by all outlets
  const [locLoading,     setLocLoading]    = useState(false);
  const [savingSettings, setSavingSettings]= useState(false);
  const [companyLogo,     setCompanyLogo]    = useState("");
  const [savingLogo,      setSavingLogo]     = useState(false);

  // Sent notifications + read receipts
  const [sentNotifs,      setSentNotifs]    = useState<SentRow[]>([]);
  const [sentLoading,     setSentLoading]   = useState(false);
  const [sentErr,         setSentErr]       = useState<string | null>(null);

  // Create-employee form
  const [empFormOpen,    setEmpFormOpen]   = useState(false);
  const [empName,        setEmpName]       = useState("");
  const [empEmail,       setEmpEmail]      = useState("");
  const [empPassword,    setEmpPassword]   = useState("");
const [empDepartment,  setEmpDepartment]  = useState("");
  const [empPhone,       setEmpPhone]       = useState("");
  const [creatingEmp,    setCreatingEmp]   = useState(false);

  // Reset-password dialog
  const [pwdEmp,         setPwdEmp]         = useState<UserWithStats|null>(null);
  const [resettingPwd,   setResettingPwd]   = useState(false);
  const [pwdOpen,        setPwdOpen]        = useState(false);

  const { captureLocation } = useLocationCapture();

  const filtered = users.filter(u =>
    (deptFilter === "all" || u.department === deptFilter) &&
    (u.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
     u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
     u.department?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const departments = Array.from(new Set(users.map(u=>u.department).filter(Boolean))).sort();

  // Live employee data for the detail modal, refreshed by the fetchUsers poll.
  const liveEmp = users.find(u => u.id === selEmp?.id) ?? selEmp;

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchSessions = async (uid: string): Promise<WorkSession[]> => {
    try {
      const q = query(collection(db,"users",uid,"sessions"),orderBy("createdAt","desc"),limit(50));
      return (await getDocs(q)).docs.map(d=>({id:d.id,...d.data()})) as WorkSession[];
    } catch { return []; }
  };

  const fetchPrev = async (uid: string) => {
    try {
      const now = new Date();
      const s = new Date(now); s.setDate(s.getDate()-60);
      const e = new Date(now); e.setDate(e.getDate()-30);
      const q = query(collection(db,"users",uid,"sessions"),
        where("date",">=",s.toISOString().split("T")[0]),
        where("date","<=",e.toISOString().split("T")[0]),
        orderBy("date","desc"));
      const rows = (await getDocs(q)).docs.map(d=>d.data());
      const w = rows.reduce((a,r)=>a+(r.totalWorkDuration||0),0);
      const t = w + rows.reduce((a,r)=>a+(r.totalBreakDuration||0),0);
      return { focusRate: t>0?(w/t)*100:0, workHours: w/3600 };
    } catch { return {focusRate:0,workHours:0}; }
  };

  const fetchUsers = useCallback(async () => {
    if (!user || profile?.role!=="admin") { setLoading(false); return; }
    try {
      setLoading(true); setError(null);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const cm = today.getMonth(), cy = today.getFullYear();
      const ago30 = new Date(); ago30.setDate(ago30.getDate()-30);
      const ago30s = ago30.toISOString().split("T")[0];
      const ago7  = new Date(); ago7.setDate(ago7.getDate()-7);
      const ago7s  = ago7.toISOString().split("T")[0];

      const uSnap = await getDocs(collection(db,"users"));
      const myUsers = profile?.companyId
        ? uSnap.docs.filter(d => (d.data() as {companyId?:string}).companyId === profile.companyId)
        : uSnap.docs;
      if (myUsers.length===0) { setUsers([]); setLoading(false); return; }

      const result = await Promise.all(myUsers.map(async ud => {
        const usr = {id:ud.id,...ud.data()} as Profile;
        let tw=0,tb=0,mw=0,mb=0,st="idle",active=false;
        let l30w=0,l30b=0,l30s=0,ms=0;
        const wk:Record<string,number>={Monday:0,Tuesday:0,Wednesday:0,Thursday:0,Friday:0,Saturday:0,Sunday:0};
        const dm = new Map<string,{workTime:number;breakTime:number}>();
        let hist:WorkSession[]=[];

        try {
          // Bound the read to the last 32 days instead of scanning the entire
          // session history — keeps the admin dashboard fast as data grows.
          const ago = new Date(); ago.setDate(ago.getDate()-32);
          const q = query(collection(db,"users",usr.id,"sessions"), where("date",">=",ago.toISOString().split("T")[0]));
          const sSnap = await getDocs(q);
          sSnap.docs.forEach(d => {
            const s = {id:d.id,...d.data()} as WorkSession;
            if (s.date===todayStr) {
              tw+=s.totalWorkDuration||0; tb+=s.totalBreakDuration||0;
              if (s.status==="working"||s.status==="break"){st=s.status;active=true;}
            }
            const sd=new Date(s.date);
            if (sd.getMonth()===cm && sd.getFullYear()===cy){mw+=s.totalWorkDuration||0;mb+=s.totalBreakDuration||0;ms++;}
            if (s.date>=ago30s) {
              l30w+=s.totalWorkDuration||0; l30b+=s.totalBreakDuration||0; l30s++;
              const dn=sd.toLocaleDateString("en-US",{weekday:"long"});
              wk[dn]=(wk[dn]||0)+(s.totalWorkDuration||0);
              if (!dm.has(s.date)) dm.set(s.date,{workTime:0,breakTime:0});
              const dd=dm.get(s.date)!; dd.workTime+=s.totalWorkDuration||0; dd.breakTime+=s.totalBreakDuration||0;
            }
            if (s.date>=ago7s && s.clockInLocation) hist.push(s);
          });

          // Newest first — the maps treat sessionHistory[0] as the live/LATEST pin.
          hist.sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
        } catch {}

        const t30=l30w+l30b;
        return {
          ...usr, todayWorkTime:tw, todayBreakTime:tb, monthWorkTime:mw, monthBreakTime:mb,
          currentStatus:st, isActive:active, last30DaysWorkTime:l30w, last30DaysBreakTime:l30b,
          last30DaysSessions:l30s, averageDailyWorkTime:l30s>0?l30w/30:0,
          focusRate:t30>0?(l30w/t30)*100:0, totalSessionsThisMonth:ms,
          averageSessionDuration:ms>0?mw/ms:0, weeklyWorkPattern:wk,
          dailyWorkPattern:Array.from(dm.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date,t])=>({
            date:new Date(date).toLocaleDateString("en-US",{month:"short",day:"numeric"}),
            workTime:Math.round(t.workTime/3600), breakTime:Math.round(t.breakTime/3600),
          })),
          sessionHistory:hist,
        } as UserWithStats;
      }));

      setUsers(result);
      try {
        const ss = await getDocs(collection(db,"subscriptions"));
        setSubscriptions(ss.docs.map(d=>({id:d.id,...d.data()})) as Subscription[]);
      } catch { setSubscriptions([]); }
      setLoading(false);
    } catch (err) {
      setError(`Failed to fetch: ${err instanceof Error?err.message:"Unknown error"}`);
      setLoading(false);
    }
  },[user,profile]);

  const fetchCompany = useCallback(async () => {
    if (!profile?.companyId) return;
    try {
      const snap = await getDoc(doc(db,"companies",profile.companyId));
      if (snap.exists()) {
        const c = {id:snap.id,...snap.data()} as Company;
        setCompany(c);
        setCompanyLogo(c.logoUrl || "");

        const sitesSnap = await getDocs(collection(db,"companies",profile.companyId,"sites"));
        let siteRows: SiteDraft[] = sitesSnap.docs.map(d => {
          const data = d.data() as { name?: string; lat?: number; lng?: number; radiusMeters?: number; active?: boolean };
          const hasOwnRadius = typeof data.radiusMeters === "number" && data.radiusMeters > 0;
          return {
            id: d.id,
            name: data.name || "",
            lat: data.lat != null ? String(data.lat) : "",
            lng: data.lng != null ? String(data.lng) : "",
            radius: hasOwnRadius ? String(data.radiusMeters) : "",
            radiusOverride: hasOwnRadius,
            active: data.active !== false,
          };
        });

        // Back-compat: companies configured before multi-site existed get their
        // single office migrated into the sites list automatically.
        const hasLegacy = !!(c.officeLocation && c.radiusMeters && c.radiusMeters > 0);
        if (siteRows.length === 0 && hasLegacy) {
          const seeded = {
            name: c.officeLocation!.label || "Office",
            lat: c.officeLocation!.lat,
            lng: c.officeLocation!.lng,
            active: true,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          };
          try {
            const ref = await addDoc(collection(db,"companies",profile.companyId,"sites"), seeded);
            siteRows = [{ id: ref.id, name: seeded.name, lat: String(seeded.lat), lng: String(seeded.lng), radius: "", radiusOverride: false, active: true }];
          } catch {
            siteRows = [{ id: "", name: seeded.name, lat: String(seeded.lat), lng: String(seeded.lng), radius: "", radiusOverride: false, active: true }];
          }
        }

        // Company-wide default radius. Falls back to the legacy office radius,
        // else a sane 150m so a fresh install starts usable.
        const resolvedDefault =
          (typeof c.siteRadiusMeters === "number" && c.siteRadiusMeters > 0 && c.siteRadiusMeters) ||
          (hasLegacy ? c.radiusMeters! : 0);
        setDefaultRadius(String(Math.round(resolvedDefault) || 150));

        setGeoEnabled(c.geofencingEnabled === true || (c.geofencingEnabled === undefined && hasLegacy));
        setSites(siteRows);
      }
    } catch (err) {
      console.error("Failed to load company:", err);
    }
  },[profile?.companyId]);

  useEffect(()=>{ if(!authLoading&&profile?.role==="admin") fetchCompany(); },[authLoading,profile,fetchCompany]);

  const updateSite = (i: number, patch: Partial<SiteDraft>) =>
    setSites(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const addSite = () =>
    setSites(prev => [...prev, { id: "", name: "", lat: "", lng: "", radius: "", radiusOverride: false, active: true }]);

  // Toggling the override on seeds the input with the current company default so
  // the admin starts from a sensible value instead of an empty box.
  const toggleRadiusOverride = (i: number, on: boolean) =>
    setSites(prev => prev.map((s, idx) =>
      idx === i ? { ...s, radiusOverride: on, radius: on ? (s.radius || defaultRadius) : "" } : s
    ));

  const removeSite = async (i: number) => {
    if (!company) return;
    const target = sites[i];
    if (target?.id) {
      try {
        await deleteDoc(doc(db,"companies",company.id,"sites",target.id));
      } catch (err) {
        console.error("Failed to delete site:", err);
        toast.error("Failed to delete site");
        return;
      }
    }
    setSites(prev => prev.filter((_, idx) => idx !== i));
  };

  const locateSite = async (i: number) => {
    setLocLoading(true);
    try {
      const cap = await captureLocation();
      setSites(prev => prev.map((s, idx) =>
        idx === i ? { ...s, lat: String(cap.lat), lng: String(cap.lng), name: s.name || cap.label } : s
      ));
      toast.success("Set to your current position — press Save to keep");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to get your location");
    } finally {
      setLocLoading(false);
    }
  };

  const toggleGeofencing = async (on: boolean) => {
    if (!company) return;
    const prev = geoEnabled;
    setGeoEnabled(on);
    setCompany(prevC => prevC ? { ...prevC, geofencingEnabled: on } : prevC);
    try {
      await updateDoc(doc(db,"companies",company.id), { geofencingEnabled: on, updatedAt: Timestamp.now() });
      invalidateGeofenceCache(company.id);
      toast.success(on ? "Geo-fenced clock-in enabled." : "Geo-fenced clock-in disabled — employees can clock in from anywhere.");
    } catch (err) {
      console.error("Failed to update geo-fencing setting:", err);
      setGeoEnabled(prev);
      setCompany(prevC => prevC ? { ...prevC, geofencingEnabled: prev } : prevC);
      toast.error("Failed to update geo-fencing setting");
    }
  };

  const saveSites = async () => {
    if (!company) return;
    const shared = parseInt(defaultRadius, 10);
    if (isNaN(shared) || shared <= 0) { toast.error("Set a valid default clock-in radius in meters"); return; }
    // Validate every outlet that carries its own override.
    const prepared = sites.map(s => {
      const override = s.radiusOverride ? parseInt(s.radius, 10) : 0;
      if (s.radiusOverride && (isNaN(override) || override <= 0)) {
        return { error: `"${s.name.trim() || "Unnamed outlet"}" needs a valid radius in meters` };
      }
      return { radiusMeters: override };
    });
    for (const p of prepared) {
      if ("error" in p) { toast.error(p.error as string); return; }
    }
    for (const s of sites) {
      const lat = parseFloat(s.lat);
      const lng = parseFloat(s.lng);
      if (isNaN(lat) || isNaN(lng)) { toast.error(`"${s.name.trim() || "Unnamed outlet"}" needs a valid latitude & longitude`); return; }
    }
    if (sites.length === 0) { toast.error("Add at least one outlet, or turn geo-fencing off"); return; }
    setSavingSettings(true);
    try {
      // The default radius lives on the company doc (authoritative for clock-in);
      // each outlet stores either its own override or null to inherit it.
      await updateDoc(doc(db,"companies",company.id), {
        siteRadiusMeters: shared,
        updatedAt: Timestamp.now(),
      });
      for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        const radiusMeters = (prepared[i] as { radiusMeters: number }).radiusMeters;
        const payload = {
          name: s.name.trim() || "Unnamed outlet",
          lat: parseFloat(s.lat),
          lng: parseFloat(s.lng),
          radiusMeters: radiusMeters > 0 ? radiusMeters : null,
          active: s.active,
          updatedAt: Timestamp.now(),
        };
        if (s.id) {
          await updateDoc(doc(db,"companies",company.id,"sites",s.id), payload);
        } else {
          await addDoc(collection(db,"companies",company.id,"sites"), { ...payload, createdAt: Timestamp.now() });
        }
      }
      invalidateGeofenceCache(company.id);
      setCompany(prev => prev ? { ...prev, siteRadiusMeters: shared, geofencingEnabled: geoEnabled, updatedAt: Timestamp.now() } : prev);
      const overrides = prepared.filter(p => (p as { radiusMeters: number }).radiusMeters > 0).length;
      toast.success(
        overrides
          ? `Outlets saved — ${shared}m default, ${overrides} location${overrides === 1 ? "" : "s"} with a custom radius.`
          : `Outlets saved — clock-in allowed within ${shared}m of any of your ${sites.length} outlet${sites.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      console.error("Failed to save sites:", err);
      toast.error("Failed to save outlets");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image is too large (max 5MB)"); return; }
    try {
      const resized = await resizeLogo(file);
      setCompanyLogo(resized);
      toast.success("Logo loaded — press 'Save Logo' to keep it");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to read that image");
    }
  };

  const saveCompanyLogo = async () => {
    if (!company) return;
    if (!companyLogo.trim()) { toast.error("Choose a logo image first"); return; }
    if (companyLogo.length > 900000) { toast.error("Image is too large (max ~1MB)"); return; }
    setSavingLogo(true);
    try {
      await updateDoc(doc(db,"companies",company.id), { logoUrl: companyLogo, updatedAt: Timestamp.now() });
      setCompanyLogo(companyLogo);
      setCompany(prev => prev ? { ...prev, logoUrl: companyLogo } : prev);
      toast.success("Company logo saved");
    } catch (err) {
      console.error("Failed to save logo:", err);
      toast.error("Failed to save logo");
    } finally {
      setSavingLogo(false);
    }
  };

  const removeCompanyLogo = async () => {
    if (!company) return;
    setSavingLogo(true);
    try {
      await updateDoc(doc(db,"companies",company.id), { logoUrl: "", updatedAt: Timestamp.now() });
      setCompanyLogo("");
      setCompany(prev => prev ? { ...prev, logoUrl: "" } : prev);
      toast.success("Company logo removed");
    } catch (err) {
      console.error("Failed to remove logo:", err);
      toast.error("Failed to remove logo");
    } finally {
      setSavingLogo(false);
    }
  };

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) { toast.error("Company not loaded"); return; }
    const phone = normalizePhone(empPhone);
    if (!empEmail.trim() && !phone) { toast.error("Provide an email or phone number"); return; }
    setCreatingEmp(true);
    try {
      // Email and phone are both optional — provide at least one. If no email is
      // given, generate a synthetic one from the phone (matches the app's phone
      // signup flow). No verification is required; Firebase creates the account directly.
      const accountEmail = empEmail.trim() || syntheticEmailForPhone(phone);
      // Create the account on an isolated auth instance so the admin's own session
      // is NOT switched to the new employee (createUserWithEmailAndPassword signs in).
      const tmpApp = initializeApp(firebaseConfig, "admin-create-tmp");
      const tmpAuth = initializeAuth(tmpApp, { persistence: inMemoryPersistence });
      try {
        const cred = await createUserWithEmailAndPassword(tmpAuth, accountEmail, empPassword);
        await setDoc(doc(db,"users",cred.user.uid), {
          id: cred.user.uid,
          userId: cred.user.uid,
          fullName: empName.trim(),
          email: accountEmail,
          designation: "Employee",
          teaPoints: 0,
          role: "user",
          companyId: company.id,
          companyName: company.name,
          ...(empDepartment.trim() ? { department: empDepartment.trim() } : {}),
          ...(phone ? { phone } : {}),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      } finally {
        try { await signOut(tmpAuth); } catch {}
        try { deleteApp(tmpApp); } catch {}
      }
      toast.success(`Employee "${empName}" created`);
      setEmpFormOpen(false);
      setEmpName(""); setEmpEmail(""); setEmpPassword(""); setEmpDepartment(""); setEmpPhone("");
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setCreatingEmp(false);
    }
  };

  useEffect(()=>{ if(!authLoading&&profile?.role==="admin") fetchUsers(); },[authLoading,profile,fetchUsers]);
  useEffect(()=>{
    if(!authLoading&&profile?.role==="admin"){
      const iv=setInterval(fetchUsers,60000); return ()=>clearInterval(iv);
    }
  },[authLoading,profile,fetchUsers]);

  useEffect(()=>{
    if (authLoading || profile?.role!=="admin" || !profile?.companyId) return;
    const q = query(collection(db,"liveStatus"), where("companyId","==",profile.companyId));
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string,{status:string;updatedAt:Timestamp|null}> = {};
      snap.forEach(d=>{
        const data = d.data() as {status?:string;updatedAt?:Timestamp|null};
        map[d.id] = { status: data.status==="working"||data.status==="break" ? data.status : "offline",
                      updatedAt: data.updatedAt ?? null };
      });
      setLiveMap(map);
    }, (err)=>{ console.error("liveStatus listener error:", err); });
    return () => unsub();
  },[authLoading,profile?.role,profile?.companyId]);

  // Live list of blocked account uids so rows can show Block/Unblock state.
  useEffect(()=>{
    if (authLoading || profile?.role!=="admin") return;
    const unsub = onSnapshot(collection(db,"blockedUsers"), (snap) => {
      setBlocked(new Set(snap.docs.map(d=>d.id)));
    }, (err)=>{ console.error("blockedUsers listener error:", err); });
    return () => unsub();
  },[authLoading,profile?.role]);

  const toggleBlock = async (u: UserWithStats, block: boolean) => {
    try {
      if (block) {
        await setDoc(doc(db,"blockedUsers",u.id), {
          email: u.email || "",
          name: u.fullName || "",
          blockedAt: Timestamp.now(),
        });
      } else {
        await deleteDoc(doc(db,"blockedUsers",u.id));
      }
      toast.success(block ? `${u.fullName||"User"} blocked` : `${u.fullName||"User"} unblocked`);
    } catch (err) {
      console.error("Failed to toggle block:", err);
      setError("Failed to update block status");
    }
  };

  const resetEmployeePassword = async () => {
    if (!pwdEmp) return;
    // Phone-created employees use a synthetic (non-real) email, so a reset
    // email can never be delivered to them. Reject those with a clear message.
    if (pwdEmp.email.startsWith("phone_") && pwdEmp.email.endsWith("@silverfir.app")) {
      toast.error("This employee has no real email account, so a password reset link cannot be sent. Please delete and recreate the employee with a new password.");
      return;
    }
    setResettingPwd(true);
    try {
      await sendPasswordResetEmail(authenticatedAuth, pwdEmp.email);
      toast.success(`Password reset email sent to ${pwdEmp.email}`);
      setPwdOpen(false); setPwdEmp(null);
    } catch (err) {
      console.error("Failed to send reset email:", err);
      toast.error(err instanceof Error ? err.message : "Failed to send reset email. Make sure this account has a real email address.");
    } finally {
      setResettingPwd(false);
    }
  };

  const openEmp = async (emp: UserWithStats) => {
    setEmpLoading(true); setSelEmp(emp); setEmpOpen(true);
    const [sessions,prev] = await Promise.all([fetchSessions(emp.id),fetchPrev(emp.id)]);
    setSelEmp(p=>p?{...p,sessionHistory:sessions,prev30DaysFocusRate:prev.focusRate,prev30DaysWorkHours:prev.workHours}:null);
    setEmpLoading(false);
  };

  const deleteUserData = async (uid:string) => {
    // Sessions + breaks subcollections
    const sessionsSnap = await getDocs(collection(db,"users",uid,"sessions"));
    await Promise.all(sessionsSnap.docs.map(async (s) => {
      const breaksSnap = await getDocs(collection(db,"users",uid,"sessions",s.id,"breaks"));
      await Promise.all(breaksSnap.docs.map(b => deleteDoc(doc(db,"users",uid,"sessions",s.id,"breaks",b.id))));
      await deleteDoc(doc(db,"users",uid,"sessions",s.id));
    }));
    try { await deleteDoc(doc(db,"liveStatus",uid)); } catch {}
    // Leave requests + personal notes owned by the user
    const leaves = await getDocs(query(collection(db,"leaveRequests"), where("employeeId","==",uid)));
    await Promise.all(leaves.docs.map(l => deleteDoc(doc(db,"leaveRequests",l.id))));
    const pNotes = await getDocs(query(collection(db,"personalNotes"), where("userId","==",uid)));
    await Promise.all(pNotes.docs.map(n => deleteDoc(doc(db,"personalNotes",n.id))));
  };

  const removeUser = async (u: UserWithStats) => {
    try {
      // Firebase Auth records can only be destroyed server-side (paid plan), so on the
      // free plan we block the uid — the client hooks and Firestore rules both reject it.
      await setDoc(doc(db,"blockedUsers",u.id), {
        email: u.email || "",
        name: u.fullName || "",
        blockedAt: Timestamp.now(),
      });
      // Purge is best-effort; blocking must never be held hostage by one failing step.
      try { await deleteUserData(u.id); }
      catch (purgeErr) { console.warn("Data purge incomplete:", purgeErr); }
      await deleteDoc(doc(db,"users",u.id));
      toast.success("User removed and blocked from logging in");
      fetchUsers();
    } catch (blockErr) {
      console.error("Failed to block/remove user:", blockErr);
      setError("Failed to remove user");
    }
  };

  const toggleRole = async (uid:string, cur:"admin"|"user") => {
    try {
      const nr = cur==="admin"?"user":"admin";
      await updateDoc(doc(db,"users",uid),{role:nr,updatedAt:Timestamp.now()});
      // Keep companies/{id}.adminUids in sync so employees can resolve admins for notifications.
      const u = users.find(x=>x.id===uid);
      if (u?.companyId) {
        const c = await getDoc(doc(db,"companies",u.companyId));
        if (c.exists()) {
          const cdata = c.data() as { adminUids?: string[] };
          const list = cdata.adminUids && cdata.adminUids.length ? cdata.adminUids : [];
          const next = cur==="user" ? Array.from(new Set([...list, uid])) : list.filter(x=>x!==uid);
          await updateDoc(doc(db,"companies",u.companyId),{adminUids:next,updatedAt:Timestamp.now()});
        }
      }
      fetchUsers(); toast.success(`Role updated to ${nr}`);
    } catch { setError("Failed to update role"); }
  };

  const delSub = async (id:string) => {
    try { await deleteDoc(doc(db,"subscriptions",id)); fetchUsers(); }
    catch { setError("Failed to delete subscription"); }
  };

  const exportCSV = () => {
    if (!selEmp?.sessionHistory?.length) return;
    const hdr=["Date","Day","Location","Status","Work","Break","Total","Started"];
    const rows=selEmp.sessionHistory.map(s=>[
      new Date(s.date).toLocaleDateString(),new Date(s.date).toLocaleDateString("en-US",{weekday:"long"}),s.clockInLocation?.label||"None",s.status,
      formatTime(s.totalWorkDuration),formatTime(s.totalBreakDuration),
      formatTime(s.totalWorkDuration+s.totalBreakDuration),s.createdAt?.toDate?.().toLocaleString()||"—",
    ]);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([[hdr,...rows].map(r=>r.join(",")).join("\n")],{type:"text/csv"}));
    a.setAttribute("download",`${selEmp.fullName||"employee"}_sessions.csv`);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const exportPDF = () => {
    if (!selEmp?.sessionHistory?.length) return;
    const d=new jsPDF();
    d.setFontSize(17); d.text(`Report: ${selEmp.fullName||"Employee"}`,20,20);
    d.setFontSize(11); d.text(`Focus Rate: ${selEmp.focusRate.toFixed(1)}%`,20,34);
    autoTable(d,{startY:44,theme:"grid",styles:{fontSize:8},headStyles:{fillColor:[99,102,241]},
      head:[["Date","Day","Location","Status","Work","Break","Total","Started"]],
      body:selEmp.sessionHistory.map(s=>[
        new Date(s.date).toLocaleDateString(),new Date(s.date).toLocaleDateString("en-US",{weekday:"long"}),s.clockInLocation?.label||"None",s.status,
        formatTime(s.totalWorkDuration),formatTime(s.totalBreakDuration),
        formatTime(s.totalWorkDuration+s.totalBreakDuration),s.createdAt?.toDate?.().toLocaleString()||"—",
      ])});
    d.save(`${selEmp.fullName||"employee"}_report.pdf`);
  };

  // ── Sent notifications / read receipts ───────────────────────────────────────
  // A listener (not a fetch) so read receipts tick in live as employees open
  // things, and so the effect can return its unsubscribe synchronously.
  const sentUnsubRef = useRef<(() => void) | null>(null);

  const subscribeSent = useCallback(() => {
    sentUnsubRef.current?.();
    sentUnsubRef.current = null;
    if (!profile?.companyId) return;
    setSentLoading(true);
    setSentErr(null);
    const q = query(
      collection(db, "sentNotifications"),
      where("companyId", "==", profile.companyId),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    sentUnsubRef.current = onSnapshot(
      q,
      (snap) => {
        setSentNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SentRow)));
        setSentLoading(false);
      },
      (err) => {
        console.error("sentNotifications listener failed:", err);
        setSentErr(
          err?.code === "failed-precondition"
            ? "Missing Firestore index for sentNotifications. Run: firebase deploy --only firestore:indexes"
            : "Could not load sent notifications."
        );
        setSentLoading(false);
      }
    );
  }, [profile?.companyId]);

  useEffect(() => {
    if (!authLoading && profile?.role === "admin" && section === "sent") {
      subscribeSent();
      return () => { sentUnsubRef.current?.(); sentUnsubRef.current = null; };
    }
  }, [authLoading, profile, section, subscribeSent]);

  // Detach the listener when the page unmounts.
  useEffect(() => () => { sentUnsubRef.current?.(); sentUnsubRef.current = null; }, []);

  // Realtime status for an employee.
  //   • A *fresh* presence doc (written by <PresenceReporter /> every minute) is
  //     authoritative — it reflects a break/resume instantly.
  //   • A stale doc (the app was closed / throttled) or no doc at all falls back
  //     to today's stored session, so anyone who clocked in and hasn't clocked
  //     out still shows as Working/On Break instead of vanishing to Offline.
  const liveStatusOf = useCallback((u: UserWithStats): string => {
    const lv = liveMap[u.id];
    const millis = lv?.updatedAt?.toMillis?.();
    if (millis != null && Date.now() - millis <= PRESENCE_STALE_MS) return lv!.status;
    return u.isActive ? u.currentStatus : "offline";
  }, [liveMap]);

  // Geo-fence outlines drawn on the admin map. Radius resolves per-outlet
  // override first, then the company-wide default — matching clock-in exactly.
  const mapSites = useMemo(() => sites
    .map(s => ({
      name: s.name || "Outlet",
      lat: parseFloat(s.lat),
      lng: parseFloat(s.lng),
      radius: s.radiusOverride ? parseInt(s.radius, 10) : parseInt(defaultRadius, 10),
      active: s.active,
    }))
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.radius > 0),
  [sites, defaultRadius]);

  // ── Guard states ───────────────────────────────────────────────────────────

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{background:"#07090f"}}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"/>
        <p className="text-[10px] text-white/45 tracking-widest uppercase">Loading</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/auth" replace />;
  if (profile?.role!=="admin") return (
    <div className="min-h-screen flex items-center justify-center" style={{background:"#07090f"}}>
      <div className="text-center p-10 rounded-3xl border border-white/[0.06]" style={{background:"rgba(255,255,255,0.024)"}}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{background:"rgba(99,102,241,0.13)"}}>
          <Shield className="w-7 h-7 text-indigo-400"/>
        </div>
        <h2 className="text-lg font-bold text-white mb-1">Access Denied</h2>
        <p className="text-xs text-white/45">You don't have admin permissions.</p>
      </div>
    </div>
  );

  // ── Derived data ───────────────────────────────────────────────────────────

  const working  = users.filter(u=>liveStatusOf(u)==="working").length;
  const onBreak  = users.filter(u=>liveStatusOf(u)==="break").length;
  const offline  = users.length - working - onBreak;
  const avgFocus = users.length ? users.reduce((a,u)=>a+u.focusRate,0)/users.length : 0;
  const totalCost= subscriptions.filter(s=>s.isActive).reduce((a,s)=>a+s.cost,0);
  const avgWork  = users.length ? users.reduce((a,u)=>a+u.todayWorkTime,0)/users.length : 0;

  const weeklyData = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(day=>({
    day:day.slice(0,3),
    ...Object.fromEntries(users.map(u=>[u.fullName||"Unknown",Math.round((u.weeklyWorkPattern[day]||0)/3600)])),
  }));

  const perfData = users.map(u=>({
    name:(u.fullName||"Unknown").split(" ")[0],
    fullName:u.fullName||"Unknown",
    "Work Hours":parseFloat(fmtHrs(u.monthWorkTime)),
    "Break Hours":parseFloat(fmtHrs(u.monthBreakTime)),
    "Focus Rate":parseFloat(u.focusRate.toFixed(1)),
  }));

  const pieData = [
    {name:"Working", value:working, color:"#34d399"},
    {name:"On Break",value:onBreak, color:"#fbbf24"},
    {name:"Offline", value:offline, color:"#475569"},
  ].filter(d=>d.value>0);

  interface SentRow {
  id: string;
  notificationId: string;
  type: "leave_request" | "leave_update" | "note";
  title: string;
  message: string;
  link?: string;
  companyId: string;
  senderId: string;
  senderName: string;
  recipientIds: string[];
  /** uid -> timestamp the recipient opened it. */
  readBy?: Record<string, Timestamp>;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

const NOTIF_TYPE_META: Record<SentRow["type"], { label: string; color: string }> = {
  leave_request: { label: "Leave request", color: "#fbbf24" },
  leave_update:   { label: "Leave decision", color: "#34d399" },
  note:           { label: "Note", color: "#818cf8" },
};

const NAV=[
    {id:"overview",      label:"Overview",      icon:LayoutDashboard},
    {id:"team",          label:"Team",          icon:Users},
    {id:"attendance",    label:"Attendance",    icon:Calendar},
    {id:"analytics",     label:"Analytics",     icon:BarChart3},
    {id:"locations",     label:"Locations",     icon:MapIcon},
    {id:"subscriptions", label:"Subscriptions", icon:CreditCard},
    {id:"sent",          label:"Sent",          icon:Bell},
    {id:"settings",      label:"Settings",      icon:SettingsIcon},
  ] as const;

  const renderRow = (u: UserWithStats, idx: number) => {
    const st = liveStatusOf(u);
    const sc = statusCfg(st);
    return (
      <motion.div key={u.id} initial={{opacity:0,x:-5}} animate={{opacity:1,x:0}} transition={{delay:idx*0.025}}
        className="pr grid px-5 py-3.5 border-b border-white/[0.04] last:border-0 group items-center transition-colors min-w-[860px]"
        style={{gridTemplateColumns:"2.2fr 1fr 1.1fr 1.3fr 1fr 0.75fr 0.2fr 0.9fr"}}>

        <div className="flex items-center gap-2.5 min-w-0">
          <Avi name={u.fullName} sz="sm"/>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{u.fullName||"—"}</p>
            <p className="text-[10px] text-white/45 truncate">{u.email} · {u.department||"—"}</p>
          </div>
        </div>

        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold"
            style={{background:sc.bg,color:sc.tx}}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{background:sc.dot,boxShadow:st==="working"?`0 0 4px ${sc.dot}`:"none"}}/>
            {sc.label}
          </span>
        </div>

        <div>
          <p className="text-xs font-medium text-white">{formatTime(u.todayWorkTime)}</p>
          <p className="text-[9px] text-white/40">brk {formatTime(u.todayBreakTime)}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-white">{formatTime(u.monthWorkTime)}</p>
          <p className="text-[9px] text-white/40">brk {formatTime(u.monthBreakTime)}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="w-14 h-1 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.06)"}}>
            <div className="h-full rounded-full" style={{width:`${u.focusRate}%`,background:focusColor(u.focusRate)}}/>
          </div>
          <span className="text-xs font-bold" style={{color:focusColor(u.focusRate)}}>{u.focusRate.toFixed(0)}%</span>
        </div>

        <div>
          {blocked.has(u.id) ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
              style={{background:"rgba(244,63,94,0.13)",color:"#fb7185"}}>
              Blocked
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
              style={{background:u.role==="admin"?"rgba(129,140,248,0.13)":"rgba(255,255,255,0.05)",color:u.role==="admin"?"#818cf8":"rgba(255,255,255,0.28)"}}>
              {u.role==="admin"?"Admin":"Member"}
            </span>
          )}
        </div>

        <div/>

        <div className={`flex items-center gap-1 transition-opacity justify-end ${blocked.has(u.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <button onClick={()=>openEmp(u)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-emerald-500/15 transition-colors" title="View">
            <Eye className="w-3.5 h-3.5 text-emerald-400"/>
          </button>
          <button onClick={()=>toggleBlock(u,!blocked.has(u.id))} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-amber-500/15 transition-colors" title={blocked.has(u.id)?"Unblock employee":"Block employee"}>
            {blocked.has(u.id)?<Unlock className="w-3.5 h-3.5 text-emerald-400"/>:<Ban className="w-3.5 h-3.5 text-amber-400/70"/>}
          </button>
          <button onClick={()=>toggleRole(u.id,u.role||"user")} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-indigo-500/15 transition-colors">
            {u.role==="admin"?<ShieldCheck className="w-3.5 h-3.5 text-indigo-400"/>:<Shield className="w-3.5 h-3.5 text-white/45"/>}
          </button>
          <button onClick={()=>{setPwdEmp(u); setPwdOpen(true);}} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-sky-500/15 transition-colors" title="Reset password">
            <KeyRound className="w-3.5 h-3.5 text-sky-400/70 hover:text-sky-300"/>
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-rose-500/15 transition-colors">
                <Trash2 className="w-3.5 h-3.5 text-rose-400/50 group-hover:text-rose-400 transition-colors"/>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl border border-white/10" style={{background:"#0d0f18"}}>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Delete Employee?</AlertDialogTitle>
                <AlertDialogDescription className="text-white/35">
                  Permanently delete <strong className="text-white/65">{u.fullName||u.email}</strong> and all their data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-white/10 text-white/55 rounded-xl" style={{background:"rgba(255,255,255,0.04)"}}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={()=>removeUser(u)} className="bg-rose-600 hover:bg-rose-700 rounded-xl">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </motion.div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{background:"radial-gradient(1000px 480px at 12% -8%, rgba(99,102,241,0.10), transparent 60%), radial-gradient(900px 460px at 100% -4%, rgba(16,185,129,0.07), transparent 55%), #07090f",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
        .ph{font-family:'Syne',sans-serif;letter-spacing:-0.01em}
        .pg{background:rgba(255,255,255,0.028);border:1px solid rgba(255,255,255,0.07);transition:background .18s ease,border-color .18s ease}
        .pg-h:hover{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.13)}
        .pr{transition:background .15s ease}
        .pr:hover{background:rgba(255,255,255,0.024)}
        .noscroll::-webkit-scrollbar{display:none}
        .noscroll{scrollbar-width:none}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:99px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.18)}
      `}</style>

      <div className="max-w-[1500px] mx-auto px-5 lg:px-8 pb-10">

        {/* Sticky top bar + nav */}
        <div className="sticky top-0 z-30 -mx-5 lg:-mx-8 px-5 lg:px-8 pt-6 pb-3 mb-7 border-b border-white/[0.07]"
          style={{background:"rgba(7,9,15,0.82)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)"}}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>
                {company?.logoUrl
                  ? <img src={company.logoUrl} alt="" className="w-full h-full object-cover"/>
                  : <Building2 className="w-5 h-5 text-white"/>}
              </div>
              <div>
                <h1 className="ph text-lg font-bold text-white leading-none tracking-tight">Silver Fir Admin</h1>
                <p className="text-[10px] text-white/40 mt-1">
                  {company?.name || "Workspace"}{company?.name ? " · " : ""}{new Date().toLocaleDateString("en-US",{weekday:"short",month:"long",day:"numeric",year:"numeric"})}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl pg text-[11px] text-white/55">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                {working} active now
              </div>
              <button onClick={fetchUsers} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white/55 hover:text-white pg pg-h transition-all disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${loading?"animate-spin":""}`}/>Refresh
              </button>
            </div>
          </div>

          {/* Nav */}
          <nav className="noscroll flex items-center gap-1 overflow-x-auto">
            {NAV.map(({id,label,icon:Icon})=>(
              <button key={id} onClick={()=>setSection(id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  section===id
                    ? "border-indigo-400/40 text-white shadow-sm"
                    : "border-transparent text-white/45 hover:text-white hover:bg-white/[0.05]"
                }`}
                style={section===id?{background:"linear-gradient(135deg,rgba(99,102,241,0.9),rgba(79,70,229,0.72))"}:{}}>
                <Icon className="w-3.5 h-3.5"/>{label}
              </button>
            ))}
          </nav>
        </div>

        {/* Section header */}
        <div className="mb-5">
          <h2 className="ph text-xl font-bold text-white tracking-tight">{SECTION_META[section].title}</h2>
          <p className="text-xs text-white/40 mt-1">{SECTION_META[section].desc}</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl text-rose-400 text-xs border border-rose-500/20"
            style={{background:"rgba(248,113,113,0.07)"}}>{error}</div>
        )}

        <AnimatePresence mode="wait">

          {/* ══════════════ OVERVIEW ══════════════ */}
          {section==="overview" && (
            <motion.div key="ov" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}}>

              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <KPI icon={Users}      label="Total Employees" value={String(users.length)}       sub={`${working} working · ${onBreak} on break`} color="#818cf8"/>
                <KPI icon={Target}     label="Avg Focus Rate"  value={`${avgFocus.toFixed(1)}%`} sub="last 30 days average"                       color="#34d399"/>
                <KPI icon={Clock}      label="Avg Work Today"  value={formatTime(avgWork)}        sub="per employee today"                         color="#38bdf8"/>
                <KPI icon={DollarSign} label="Monthly Cost"    value={`$${totalCost.toFixed(0)}`} sub={`${subscriptions.filter(s=>s.isActive).length} active subs`} color="#fbbf24"/>
              </div>

              {/* Live status strip */}
              <div className="pg rounded-2xl px-5 py-3.5 mb-5 flex items-center gap-5 flex-wrap">
                <p className="text-[8px] font-bold tracking-[0.22em] uppercase text-white/40 flex-shrink-0">Live</p>
                {[{l:"Working",c:"#34d399",n:working,pulse:true},{l:"On Break",c:"#fbbf24",n:onBreak,pulse:false},{l:"Offline",c:"#475569",n:offline,pulse:false}].map(s=>(
                  <div key={s.l} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.pulse?"animate-pulse":""}`} style={{background:s.c,boxShadow:s.pulse?`0 0 6px ${s.c}`:"none"}}/>
                    <span className="text-sm font-bold" style={{color:s.c}}>{s.n}</span>
                    <span className="text-xs text-white/45">{s.l}</span>
                  </div>
                ))}
                <div className="ml-auto flex items-center gap-2.5">
                  <div className="h-1.5 w-36 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.05)"}}>
                    <div className="h-full flex">
                      <div style={{width:`${users.length?(working/users.length)*100:0}%`,background:"#34d399"}}/>
                      <div style={{width:`${users.length?(onBreak/users.length)*100:0}%`,background:"#fbbf24"}}/>
                    </div>
                  </div>
                  <span className="text-[9px] text-white/40">{users.length} total</span>
                </div>
              </div>

              {/* Top 3 performers */}
              {users.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                  {[...users].sort((a,b)=>b.focusRate-a.focusRate).slice(0,3).map((u,i)=>(
                    <div key={u.id} className="pg pg-h rounded-2xl p-4 flex items-center gap-3 cursor-pointer transition-all"
                      onClick={()=>openEmp(u)}>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                        style={{background:i===0?"linear-gradient(135deg,#fbbf24,#f59e0b)":i===1?"linear-gradient(135deg,#94a3b8,#64748b)":"linear-gradient(135deg,#b45309,#92400e)"}}>
                        {i+1}
                      </div>
                      <Avi name={u.fullName} sz="sm"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{u.fullName||u.email}</p>
                        <p className="text-[9px] text-white/45">{formatTime(u.monthWorkTime)} this month</p>
                      </div>
                      <span className="text-sm font-bold flex-shrink-0" style={{color:focusColor(u.focusRate)}}>
                        {u.focusRate.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Charts row */}
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 pg rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="ph text-sm font-semibold text-white">Weekly Work Hours</h3>
                      <p className="text-[9px] text-white/40 mt-0.5">Last 30 days · per employee</p>
                    </div>
                    <BarChart3 className="w-3.5 h-3.5 text-white/12"/>
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer>
                      <BarChart data={weeklyData} barGap={2} barCategoryGap="32%">
                        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false}/>
                        <XAxis dataKey="day" tick={{fill:"rgba(255,255,255,0.25)",fontSize:11}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fill:"rgba(255,255,255,0.18)",fontSize:10}} axisLine={false} tickLine={false}/>
                        <Tooltip {...TT}/>
                        <Legend wrapperStyle={{fontSize:11,color:"rgba(255,255,255,0.28)",paddingTop:10}}/>
                        {users.map((u,i)=>(
                          <Bar key={u.id} dataKey={u.fullName||"Unknown"} fill={CHART_COLORS[i%CHART_COLORS.length]} radius={[3,3,0,0]} maxBarSize={18}/>
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="pg rounded-2xl p-5 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="ph text-sm font-semibold text-white">Team Status</h3>
                      <p className="text-[9px] text-white/40 mt-0.5">Right now</p>
                    </div>
                    <Activity className="w-3.5 h-3.5 text-white/12"/>
                  </div>
                  <div className="h-36">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={62} dataKey="value" paddingAngle={4} strokeWidth={0}>
                          {pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                        </Pie>
                        <Tooltip {...TT}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-auto space-y-2">
                    {pieData.map(d=>(
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{background:d.color}}/>
                          <span className="text-xs text-white/30">{d.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-white/55">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ══════════════ TEAM ══════════════ */}
          {section==="team" && (
            <motion.div key="tm" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}}>
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40"/>
                  <input type="text" placeholder="Search employees…" value={searchQuery}
                    onChange={e=>setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white bg-transparent pg focus:outline-none focus:ring-1 focus:ring-indigo-500/30 placeholder-white/40"/>
                </div>
                <span className="text-xs text-white/40">{filtered.length} results</span>
                <Button onClick={()=>setEmpFormOpen(true)} size="sm"
                  className="ml-auto flex items-center gap-1.5 text-xs rounded-xl" style={{background:"rgba(99,102,241,0.16)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.25)"}}>
                  <UserPlus className="w-3.5 h-3.5"/> Add Employee
                </Button>
              </div>

              {/* Department filter */}
              <div className="flex items-center gap-1.5 mb-5 flex-wrap">
                {["all",...departments].map(d=>(
                  <button key={d} onClick={()=>setDeptFilter(d)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-all border ${
                      deptFilter===d ? "border-indigo-500/30 text-indigo-300" : "border-transparent text-white/45 hover:text-white/55"}`}
                    style={deptFilter===d?{background:"rgba(99,102,241,0.13)"}:{}}>
                    {d==="all"?"All Departments":d}
                  </button>
                ))}
              </div>

              <div className="pg rounded-2xl overflow-x-auto noscroll">
                {/* header */}
                <div className="grid px-5 py-3 border-b border-white/[0.055] min-w-[860px]"
                  style={{gridTemplateColumns:"2.2fr 1fr 1.1fr 1.3fr 1fr 0.75fr 0.2fr 0.9fr"}}>
                  {["Employee","Status","Today","This Month","Focus","Role","",""].map((h,i)=>(
                    <div key={i} className="text-[8px] font-bold uppercase tracking-widest text-white/40">{h}</div>
                  ))}
                </div>

                {loading ? (
                  <div className="flex flex-col items-center gap-3 py-14 text-white/40">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
                    <span className="text-xs">Loading…</span>
                  </div>
                ) : filtered.length===0 ? (
                  <div className="py-14 text-center text-white/40 text-sm">No employees found</div>
                ) : (()=>{
                  const grouped = [
                    ...departments.map(d=>{const items=filtered.filter(u=>u.department===d);return {label:d,items};}).filter(g=>g.items.length>0),
                    ...(filtered.some(u=>!u.department)?[{label:"Unassigned",items:filtered.filter(u=>!u.department)}]:[]),
                  ];
                  return grouped.map(g=>(
                    <div key={g.label}>
                      <div className="px-5 py-2 flex items-center gap-2 bg-white/[0.02] border-b border-white/[0.04] min-w-[860px]">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-300/70">{g.label}</span>
                        <span className="text-[9px] text-white/40">{g.items.length}</span>
                      </div>
                      {g.items.map((u,idx)=>renderRow(u,idx))}
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          )}

          {/* ══════════════ ATTENDANCE ══════════════ */}
          {section==="attendance" && (
            <motion.div key="at" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}}>
              <TeamAttendance users={users} />
            </motion.div>
          )}

          {/* ══════════════ ANALYTICS ══════════════ */}
          {section==="analytics" && (
            <motion.div key="an" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}} className="space-y-4">

              {/* Focus comparison */}
              <div className="pg rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="ph text-sm font-semibold text-white">Focus Rate Comparison</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">All employees · last 30 days</p>
                  </div>
                  <Award className="w-3.5 h-3.5 text-white/12"/>
                </div>
                <div className="h-60">
                  <ResponsiveContainer>
                    <BarChart data={perfData} barCategoryGap="38%">
                      <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false}/>
                      <XAxis dataKey="name" tick={{fill:"rgba(255,255,255,0.28)",fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis domain={[0,100]} tick={{fill:"rgba(255,255,255,0.18)",fontSize:10}} axisLine={false} tickLine={false}/>
                      <Tooltip {...TT}/>
                      <Bar dataKey="Focus Rate" radius={[5,5,0,0]} maxBarSize={38}>
                        {perfData.map((e,i)=><Cell key={i} fill={focusColor(e["Focus Rate"])}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                {/* Monthly work vs break */}
                <div className="pg rounded-2xl p-5">
                  <div className="mb-4">
                    <h3 className="ph text-sm font-semibold text-white">Work vs Break (Month)</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Hours this month</p>
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer>
                      <BarChart data={perfData} layout="vertical" barGap={2} barCategoryGap="28%">
                        <CartesianGrid strokeDasharray="2 4" horizontal={false} stroke="rgba(255,255,255,0.04)"/>
                        <XAxis type="number" tick={{fill:"rgba(255,255,255,0.18)",fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis dataKey="name" type="category" width={65} tick={{fill:"rgba(255,255,255,0.28)",fontSize:11}} axisLine={false} tickLine={false}/>
                        <Tooltip {...TT}/>
                        <Legend wrapperStyle={{fontSize:11,color:"rgba(255,255,255,0.28)",paddingTop:8}}/>
                        <Bar dataKey="Work Hours"  fill="#818cf8" radius={3} maxBarSize={11}/>
                        <Bar dataKey="Break Hours" fill="#fbbf24" radius={3} maxBarSize={11}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Weekly patterns */}
                <div className="pg rounded-2xl p-5">
                  <div className="mb-4">
                    <h3 className="ph text-sm font-semibold text-white">Weekly Patterns</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Hours per day (30d avg)</p>
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer>
                      <BarChart data={weeklyData} barGap={2} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false}/>
                        <XAxis dataKey="day" tick={{fill:"rgba(255,255,255,0.28)",fontSize:11}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fill:"rgba(255,255,255,0.18)",fontSize:10}} axisLine={false} tickLine={false}/>
                        <Tooltip {...TT}/>
                        <Legend wrapperStyle={{fontSize:11,color:"rgba(255,255,255,0.28)",paddingTop:8}}/>
                        {users.map((u,i)=>(
                          <Bar key={u.id} dataKey={u.fullName||"Unknown"} fill={CHART_COLORS[i%CHART_COLORS.length]} radius={[3,3,0,0]} maxBarSize={16}/>
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Ranked list */}
              <div className="pg rounded-2xl p-5">
                <h3 className="ph text-sm font-semibold text-white mb-4">Focus Rankings</h3>
                <div className="space-y-3">
                  {[...users].sort((a,b)=>b.focusRate-a.focusRate).map((u,i)=>(
                    <div key={u.id} className="flex items-center gap-3">
                      <span className="text-[10px] text-white/40 w-4 text-right flex-shrink-0">{i+1}</span>
                      <Avi name={u.fullName} sz="sm"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{u.fullName||u.email}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.05)"}}>
                            <motion.div className="h-full rounded-full" initial={{width:0}}
                              animate={{width:`${u.focusRate}%`}} transition={{duration:0.8,delay:i*0.04}}
                              style={{background:focusColor(u.focusRate)}}/>
                          </div>
                          <span className="text-xs font-bold flex-shrink-0" style={{color:focusColor(u.focusRate)}}>
                            {u.focusRate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-medium text-white/50">{formatTime(u.monthWorkTime)}</p>
                        <p className="text-[9px] text-white/40">this month</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ══════════════ LOCATIONS ══════════════ */}
          {section==="locations" && (
            <motion.div key="lo" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}}>
              <div className="pg rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.055]">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(248,113,113,0.11)"}}>
                    <MapPin className="w-4 h-4 text-rose-400"/>
                  </div>
                  <div>
                    <h3 className="ph text-sm font-semibold text-white">Employee Locations</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Real-time clock-in map · last 7 days</p>
                  </div>
                </div>
                <div className="p-4">
                  <AllEmployeesLocationsMap users={users} sites={mapSites} statusOf={liveStatusOf}/>
                </div>
              </div>
            </motion.div>
          )}

          {/* ══════════════ SUBSCRIPTIONS ══════════════ */}
          {section==="subscriptions" && (
            <motion.div key="sb" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}}>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  {l:"Total",    v:String(subscriptions.length),                             c:"#818cf8"},
                  {l:"Active",   v:String(subscriptions.filter(s=>s.isActive).length),       c:"#34d399"},
                  {l:"Monthly",  v:`$${totalCost.toFixed(0)}`,                               c:"#fbbf24"},
                ].map(s=>(
                  <div key={s.l} className="pg rounded-2xl p-5 text-center">
                    <p className="text-2xl font-bold" style={{color:s.c}}>{s.v}</p>
                    <p className="text-[10px] text-white/40 mt-1">{s.l}</p>
                  </div>
                ))}
              </div>

              {subscriptions.length===0 ? (
                <div className="pg rounded-2xl p-16 text-center">
                  <CreditCard className="w-10 h-10 text-white/10 mx-auto mb-3"/>
                  <p className="text-sm text-white/40">No subscriptions found</p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {subscriptions.map((sub,idx)=>{
                    const dTs=sub.deadline_date||sub.renewalDate;
                    const dObj=dTs?.toDate?.();
                    const dl=dObj?Math.ceil((dObj.getTime()-Date.now())/86400000):0;
                    const urg=dl>=0&&dl<=5, warn=dl>5&&dl<=14;
                    const bc=urg?"#f87171":warn?"#fbbf24":"#34d399";
                    return (
                      <motion.div key={sub.id} initial={{opacity:0,scale:0.97}} animate={{opacity:1,scale:1}} transition={{delay:idx*0.05}}
                        className="pg pg-h rounded-2xl p-5 flex flex-col gap-4 transition-all"
                        style={{outline:urg?"1px solid rgba(248,113,113,0.28)":"none"}}>
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="ph text-sm font-bold text-white">{sub.name}</h4>
                            <span className="text-[9px] font-semibold mt-1.5 inline-flex items-center gap-1"
                              style={{color:sub.isActive?"#34d399":"#64748b"}}>
                              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:sub.isActive?"#34d399":"#64748b"}}/>
                              {sub.isActive?"Active":"Inactive"}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold text-white">${sub.cost}</p>
                            <p className="text-[9px] text-white/40">/month</p>
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-white/45">Renewed</span>
                            <span className="text-white/45">{sub.renewed_date?sub.renewed_date.toDate().toLocaleDateString():"—"}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-white/45">Expires</span>
                            <span className="text-white/45">{dObj?.toLocaleDateString()||"—"}</span>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] text-white/40">Days remaining</span>
                            <span className="text-xs font-bold" style={{color:bc}}>{dl>0?`${dl}d`:"Expired"}{urg?" ⚠":""}</span>
                          </div>
                          <div className="h-1 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.05)"}}>
                            <div className="h-full rounded-full transition-all"
                              style={{width:`${Math.max(0,Math.min(100,(dl/30)*100))}%`,background:bc}}/>
                          </div>
                        </div>
                        <div className="pt-1 border-t border-white/[0.045]">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button className="flex items-center gap-1.5 text-[10px] text-white/40 hover:text-rose-400 transition-colors">
                                <Trash2 className="w-3 h-3"/> Delete subscription
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-2xl border border-white/10" style={{background:"#0d0f18"}}>
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-white">Delete Subscription?</AlertDialogTitle>
                                <AlertDialogDescription className="text-white/35">
                                  Permanently remove <strong className="text-white/65">{sub.name}</strong>.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="border-white/10 text-white/55 rounded-xl" style={{background:"rgba(255,255,255,0.04)"}}>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={()=>delSub(sub.id)} className="bg-rose-600 hover:bg-rose-700 rounded-xl">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ══════════════ SENT / READ RECEIPTS ══════════════ */}
          {section==="sent" && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="space-y-4">
              <div className="pg rounded-2xl p-5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(99,102,241,0.11)"}}>
                    <Bell className="w-4 h-4 text-indigo-300"/>
                  </div>
                  <div className="flex-1">
                    <h3 className="ph text-sm font-semibold text-white">Sent & Read Receipts</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Every notification and announcement you sent, and how many people opened it</p>
                  </div>
                  <Button type="button" variant="outline" onClick={subscribeSent}
                    className="rounded-xl text-[10px] border-white/10 text-white/55 hover:text-white">
                    <RefreshCw className={sentLoading?"w-3 h-3 animate-spin":"w-3 h-3"}/>
                  </Button>
                </div>
              </div>

              {sentErr && (
                <div className="pg rounded-2xl p-4">
                  <p className="text-xs text-amber-300/80">{sentErr}</p>
                </div>
              )}

              {!sentErr && sentNotifs.length === 0 && (
                <div className="pg rounded-2xl p-10 text-center">
                  <p className="text-xs text-white/30">
                    {sentLoading ? "Loading…" : "Nothing sent yet. Leave requests and announcements will appear here."}
                  </p>
                </div>
              )}

              {!sentErr && sentNotifs.length > 0 && (
                <div className="pg rounded-2xl overflow-hidden">
                  <div className="pr grid px-5 py-3 border-b border-white/[0.06] text-[9px] uppercase tracking-widest text-white/45"
                    style={{gridTemplateColumns:"2fr 1fr 1.1fr 1fr"}}>
                    <span>Notification</span>
                    <span>Sent by</span>
                    <span>Recipients</span>
                    <span>Read</span>
                  </div>
                  {sentNotifs.map((s, idx) => {
                    const total = s.recipientIds?.length || 0;
                    const read = readCountOf(s);
                    const pct = total > 0 ? Math.round((read / total) * 100) : 0;
                    const meta = NOTIF_TYPE_META[s.type] || NOTIF_TYPE_META.note;
                    return (
                      <div key={s.id}
                        className="pr grid px-5 py-3.5 border-b border-white/[0.04] last:border-0 items-center gap-3"
                        style={{gridTemplateColumns:"2fr 1fr 1.1fr 1fr"}}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md shrink-0"
                              style={{background:meta.color+"1f", color:meta.color}}>
                              {meta.label}
                            </span>
                            <p className="text-xs font-semibold text-white/85 truncate">{s.title}</p>
                          </div>
                          <p className="text-[10px] text-white/45 truncate mt-0.5">{s.message}</p>
                        </div>
                        <p className="text-[11px] text-white/50 truncate">{s.senderName || "—"}</p>
                        <p className="text-[11px] text-white/50">{total} {total === 1 ? "person" : "people"}</p>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-semibold"
                              style={{color: read > 0 ? "#34d399" : "rgba(255,255,255,0.3)"}}>
                              {read} / {total}
                            </span>
                            <span className="text-[9px] text-white/45">{pct}%</span>
                          </div>
                          <div className="h-1 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.07)"}}>
                            <div className="h-full rounded-full transition-all"
                              style={{ width: pct+"%", background: pct === 100 ? "#34d399" : "#818cf8" }}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ══════════════ SETTINGS ══════════════ */}
          {section==="settings" && (
            <motion.div key="st" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:0.17}} className="space-y-4">

              {/* Company info */}
              <div className="pg rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(99,102,241,0.12)"}}>
                    <Building2 className="w-4 h-4 text-indigo-400"/>
                  </div>
                  <div>
                    <h3 className="ph text-sm font-semibold text-white">Company</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Your organization profile</p>
                  </div>
                </div>
                {company ? (
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="rounded-xl p-4" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)"}}>
                      <p className="text-[9px] text-white/40 uppercase tracking-widest">Name</p>
                      <p className="text-sm font-semibold text-white mt-1">{company.name}</p>
                    </div>
                    <div className="rounded-xl p-4" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)"}}>
                      <p className="text-[9px] text-white/40 uppercase tracking-widest">Username</p>
                      <p className="text-sm font-semibold text-white mt-1 font-mono">{company.username}</p>
                    </div>
                    <div className="rounded-xl p-4" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)"}}>
                      <p className="text-[9px] text-white/40 uppercase tracking-widest inline-flex items-center gap-1"><KeyRound className="w-3 h-3"/> Invite Code</p>
                      <p className="text-sm font-semibold text-white mt-1 font-mono">{company.inviteCode}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-white/45">Company not loaded.</p>
                )}
                <p className="text-[10px] text-white/40 mt-3">Employees sign up using your company username or invite code.</p>
              </div>

              {/* Company logo */}
              <div className="pg rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(129,140,248,0.12)"}}>
                    <ImageIcon className="w-4 h-4 text-indigo-400"/>
                  </div>
                  <div>
                    <h3 className="ph text-sm font-semibold text-white">Company Logo</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Shown in the top bar on every page for your team</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
                    {(company?.logoUrl || companyLogo) ? (
                      <img src={company?.logoUrl || companyLogo} alt="Company logo" className="w-full h-full object-contain"/>
                    ) : (
                      <Building2 className="w-6 h-6 text-white/40"/>
                    )}
                  </div>
                  <div className="space-y-2 flex-1">
                    <label className="inline-flex">
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoFile}/>
                      <span className="inline-flex items-center gap-2 cursor-pointer rounded-xl text-xs px-3 py-2 text-white/70 hover:text-white transition-all" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>
                        <ImageIcon className="w-3.5 h-3.5"/>
                        Choose Image…
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Button type="button" onClick={saveCompanyLogo} disabled={savingLogo || !companyLogo}
                        className="rounded-xl text-xs inline-flex items-center gap-2" style={{background:"rgba(99,102,241,0.16)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.25)"}}>
                        {savingLogo ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
                        Save Logo
                      </Button>
                      {(companyLogo || company?.logoUrl) && (
                        <Button type="button" variant="outline" onClick={removeCompanyLogo} disabled={savingLogo}
                          className="rounded-xl text-xs border-white/10 text-rose-400/80 hover:text-rose-300 inline-flex items-center gap-2">
                          <Trash2 className="w-3.5 h-3.5"/>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Geo-fence config */}
              <div className="pg rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(52,211,153,0.11)"}}>
                    <MapPin className="w-4 h-4 text-emerald-400"/>
                  </div>
                  <div className="flex-1">
                    <h3 className="ph text-sm font-semibold text-white">Geo-Fenced Clock-In</h3>
                    <p className="text-[9px] text-white/40 mt-0.5">Set how far employees must be from an outlet to clock in — one default for all, or a custom radius per location</p>
                  </div>
                  <Switch checked={geoEnabled} onCheckedChange={toggleGeofencing}/>
                </div>
                <p className="text-[10px] text-white/45 mb-4">
                  {geoEnabled
                    ? `On — employees clock in only within ${defaultRadius}m of an outlet (unless a location has its own radius), and the outlet is recorded on their session.`
                    : "Off — employees can clock in from anywhere."}
                </p>

                <div className="rounded-xl p-3 mb-4" style={{background:"rgba(52,211,153,0.06)",border:"1px solid rgba(52,211,153,0.16)"}}>
                  <Label className="text-[9px] text-white/40 uppercase tracking-widest">Default clock-in radius (meters)</Label>
                  <Input value={defaultRadius} onChange={e=>setDefaultRadius(e.target.value)} placeholder="e.g. 150"
                    type="number" min={1} step={10}
                    className="mt-1 bg-transparent border-white/10 text-white text-sm"/>
                  <p className="text-[9px] text-white/45 mt-1.5">
                    Applied to every outlet that does not set its own radius below. On clock-in we detect which outlet the employee is inside and tag their session with it.
                  </p>
                  {(() => {
                    const r = parseInt(defaultRadius, 10);
                    if (isNaN(r) || r <= 0) return null;
                    if (r < 75) {
                      return (
                        <p className="text-[9px] mt-1.5 rounded-md px-2 py-1.5" style={{background:"rgba(251,191,36,0.1)",color:"rgba(253,224,71,0.85)"}}>
                          Heads up: under ~75m most phones cannot produce a precise enough GPS fix, and employees will be
                          told their location is too imprecise. 100–200m is a safer starting point.
                        </p>
                      );
                    }
                    if (r > 1000) {
                      return (
                        <p className="text-[9px] mt-1.5 text-white/30">
                          {Math.round((r / 1000) * 10) / 10}km from the outlet centre — anyone inside that circle can clock in there.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>

                {sites.length === 0 ? (
                  <div className="rounded-xl p-4 text-center text-xs text-white/30 mb-4" style={{background:"rgba(255,255,255,0.03)",border:"1px dashed rgba(255,255,255,0.1)"}}>
                    No outlets yet. Add every location your staff work at.
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    {sites.map((s, i) => (
                      <div key={i} className="rounded-xl p-3 space-y-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                        <div className="flex items-center gap-2">
                          <Input value={s.name} onChange={e=>updateSite(i,{name:e.target.value})} placeholder="Outlet name — e.g. Baneshwor Tower Project"
                            className="flex-1 bg-transparent border-white/10 text-white text-sm"/>
                          <Button type="button" variant="outline" size="sm" onClick={()=>locateSite(i)} disabled={locLoading}
                            className="rounded-xl text-[10px] border-white/10 text-white/55 hover:text-white whitespace-nowrap">
                            {locLoading ? <RefreshCw className="w-3 h-3 animate-spin"/> : <MapPin className="w-3 h-3"/>}
                            My location
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={()=>removeSite(i)}
                            className="rounded-xl text-[10px] border-white/10 text-rose-400/70 hover:text-rose-300 px-2.5">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 items-end">
                          <div>
                            <Label className="text-[9px] text-white/45 uppercase tracking-widest">Latitude</Label>
                            <Input value={s.lat} onChange={e=>updateSite(i,{lat:e.target.value})} placeholder="27.7172"
                              className="mt-1 bg-transparent border-white/10 text-white text-sm"/>
                          </div>
                          <div>
                            <Label className="text-[9px] text-white/45 uppercase tracking-widest">Longitude</Label>
                            <Input value={s.lng} onChange={e=>updateSite(i,{lng:e.target.value})} placeholder="85.3240"
                              className="mt-1 bg-transparent border-white/10 text-white text-sm"/>
                          </div>
                          <div className="col-span-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-[9px] text-white/45 uppercase tracking-widest">
                                Radius (meters)
                              </Label>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <Checkbox
                                  checked={s.radiusOverride}
                                  onCheckedChange={v=>toggleRadiusOverride(i,!!v)}
                                />
                                <span className="text-[9px] text-white/35">
                                  {s.radiusOverride ? "Custom for this location" : `Using default (${defaultRadius}m)`}
                                </span>
                              </label>
                            </div>
                            <Input
                              value={s.radiusOverride ? s.radius : ""}
                              onChange={e=>updateSite(i,{radius:e.target.value})}
                              placeholder={s.radiusOverride ? "e.g. 75" : `${defaultRadius}m (default)`}
                              type="number" min={1} step={5}
                              disabled={!s.radiusOverride}
                              className="mt-1 bg-transparent border-white/10 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                            {s.radiusOverride && (() => {
                              const r = parseInt(s.radius, 10);
                              if (!isNaN(r) && r > 0 && r < 75) {
                                return (
                                  <p className="text-[9px] mt-1" style={{color:"rgba(253,224,71,0.75)"}}>
                                    Under ~75m is tighter than most phones can verify.
                                  </p>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          <label className="flex items-center gap-2 pb-1 cursor-pointer select-none col-span-2">
                            <Checkbox checked={s.active} onCheckedChange={v=>updateSite(i,{active:!!v})}/>
                            <span className="text-[10px] text-white/40">Active — accepts clock-ins</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={addSite}
                    className="rounded-xl text-xs border-white/10 text-white/55 hover:text-white inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5"/>
                    Add outlet
                  </Button>
                  <Button type="button" onClick={saveSites} disabled={savingSettings}
                    className="rounded-xl text-xs inline-flex items-center gap-2" style={{background:"rgba(99,102,241,0.16)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.25)"}}>
                    {savingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
                    Save Outlets
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ══════════════ EMPLOYEE MODAL ══════════════ */}
      <Dialog open={empOpen} onOpenChange={setEmpOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0 border border-white/10 rounded-3xl" style={{background:"#0a0c14"}}>

          {/* Sticky header */}
          <div className="sticky top-0 z-10 border-b border-white/[0.065] px-6 py-4 flex items-center justify-between"
            style={{background:"rgba(10,12,20,0.96)",backdropFilter:"blur(20px)"}}>
            <div className="flex items-center gap-3">
              {selEmp && <Avi name={selEmp.fullName} sz="md"/>}
              <div>
                <h2 className="ph font-bold text-white text-base leading-none">{selEmp?.fullName||"Employee"}</h2>
                <p className="text-[9px] text-white/45 mt-0.5">{selEmp?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportCSV} disabled={!selEmp?.sessionHistory?.length||empLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/35 hover:text-white pg rounded-xl transition-all disabled:opacity-25">
                <Download className="w-3 h-3"/> CSV
              </button>
              <button onClick={exportPDF} disabled={!selEmp?.sessionHistory?.length||empLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/35 hover:text-white pg rounded-xl transition-all disabled:opacity-25">
                <FileText className="w-3 h-3"/> PDF
              </button>
              <button onClick={()=>setEmpOpen(false)}
                className="w-7 h-7 rounded-xl flex items-center justify-center pg text-white/30 hover:text-white transition-all">
                <X className="w-3.5 h-3.5"/>
              </button>
            </div>
          </div>

          <div className="p-6">
            {empLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
                <p className="text-xs text-white/45">Loading performance data…</p>
              </div>
            ) : selEmp ? (
              // ── 5 tabs now: Overview · Session History · Locations · Attendance · Goals
              <Tabs defaultValue="overview">
                <TabsList className="pg rounded-xl p-1 mb-6 bg-transparent border-0 w-full grid grid-cols-5">
                  {[
                    ["overview",   "Overview"],
                    ["history",    "Sessions"],
                    ["locations",  "Locations"],
                    ["attendance", "Attendance"],
                    ["goals",      "Goals"],
                  ].map(([v,l])=>(
                    <TabsTrigger key={v} value={v}
                      className="rounded-lg text-xs data-[state=active]:bg-indigo-600/75 data-[state=active]:text-white text-white/45 font-medium capitalize">
                      {l}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {/* ── Overview ── */}
                <TabsContent value="overview" className="mt-0 space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      {icon:Clock,    label:"Today Work",  val:formatTimeShort(selEmp.todayWorkTime),         c:"#818cf8"},
                      {icon:Coffee,   label:"Today Break", val:formatTimeShort(selEmp.todayBreakTime),        c:"#fbbf24"},
                      {icon:Calendar, label:"Active Days", val:String(selEmp.totalSessionsThisMonth),        c:"#38bdf8"},
                      {icon:Activity, label:"Avg Daily",   val:formatTimeShort(selEmp.averageDailyWorkTime), c:"#34d399"},
                    ].map(m=>(
                      <div key={m.label} className="pg rounded-xl p-4">
                        <m.icon className="w-4 h-4 mb-3 opacity-35" style={{color:m.c}}/>
                        <p className="text-xl font-bold text-white">{m.val}</p>
                        <p className="text-[9px] text-white/45 mt-0.5">{m.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="pg rounded-2xl p-6 flex flex-col items-center">
                      <div className="relative w-36 h-36">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="7"/>
                          <motion.circle cx="50" cy="50" r="44" fill="none"
                            stroke={focusColor(selEmp.focusRate)} strokeWidth="7"
                            strokeDasharray={276} initial={{strokeDashoffset:276}}
                            animate={{strokeDashoffset:276-(276*selEmp.focusRate)/100}}
                            transition={{duration:1.4,ease:"easeOut"}} strokeLinecap="round"/>
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-bold text-white">{selEmp.focusRate.toFixed(0)}%</span>
                          <span className="text-[9px] text-white/45 mt-0.5">Focus Rate</span>
                        </div>
                      </div>
                      {selEmp.prev30DaysFocusRate!==undefined && (
                        <div className="flex items-center gap-1.5 mt-4 text-xs font-bold px-3 py-1.5 rounded-full"
                          style={{background:selEmp.focusRate>selEmp.prev30DaysFocusRate?"rgba(52,211,153,0.1)":"rgba(248,113,113,0.1)",color:selEmp.focusRate>selEmp.prev30DaysFocusRate?"#34d399":"#f87171"}}>
                          {selEmp.focusRate>selEmp.prev30DaysFocusRate?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}
                          {Math.abs(selEmp.focusRate-selEmp.prev30DaysFocusRate).toFixed(1)}% vs prev 30d
                        </div>
                      )}
                    </div>

                    <div className="pg rounded-2xl p-5 flex flex-col justify-center gap-4">
                      {[
                        {l:"Work time",  v:formatTimeShort(selEmp.monthWorkTime),  pct:selEmp.focusRate,      c:"#818cf8"},
                        {l:"Break time", v:formatTimeShort(selEmp.monthBreakTime), pct:100-selEmp.focusRate, c:"#fbbf24"},
                      ].map(b=>(
                        <div key={b.l}>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-white/30">{b.l}</span>
                            <span className="text-white/50 font-medium">{b.v}</span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.055)"}}>
                            <motion.div className="h-full rounded-full" initial={{width:0}}
                              animate={{width:`${b.pct}%`}} transition={{duration:1,ease:"easeOut"}}
                              style={{background:b.c}}/>
                          </div>
                        </div>
                      ))}
                      <p className="text-[10px] text-white/40 pt-2 border-t border-white/[0.04]">
                        {selEmp.focusRate>=80?"🏆 Outstanding — top-tier focus!":selEmp.focusRate>=65?"💪 Solid performance — room to improve.":"📈 Focus on shorter, intentional breaks."}
                      </p>
                    </div>
                  </div>

                  {selEmp.dailyWorkPattern.length>0 && (
                    <div className="pg rounded-2xl p-5">
                      <h4 className="text-[9px] font-bold text-white/45 uppercase tracking-widest mb-4">Daily Pattern (30d)</h4>
                      <div className="h-52">
                        <ResponsiveContainer>
                          <AreaChart data={selEmp.dailyWorkPattern}>
                            <defs>
                              <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.28}/>
                                <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
                            <XAxis dataKey="date" tick={{fill:"rgba(255,255,255,0.2)",fontSize:10}} axisLine={false} tickLine={false}/>
                            <YAxis tick={{fill:"rgba(255,255,255,0.15)",fontSize:10}} axisLine={false} tickLine={false}/>
                            <Tooltip {...TT}/>
                            <Legend wrapperStyle={{fontSize:11,color:"rgba(255,255,255,0.28)",paddingTop:8}}/>
                            <Area type="monotone" dataKey="workTime"  stroke="#818cf8" fill="url(#wg)" name="Work (h)"  strokeWidth={1.5}/>
                            <Area type="monotone" dataKey="breakTime" stroke="#fbbf24" fill="url(#bg)" name="Break (h)" strokeWidth={1.5}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Session History ── */}
                <TabsContent value="history" className="mt-0">
                  <div className="pg rounded-2xl overflow-hidden">
                    <div className="grid px-5 py-3 border-b border-white/[0.05] text-[8px] font-bold uppercase tracking-widest text-white/40"
                      style={{gridTemplateColumns:"0.9fr 2fr 0.8fr 0.9fr 0.9fr 1fr 1.2fr"}}>
                      {["Date","Location","Status","Work","Break","Total","Started"].map(h=><div key={h}>{h}</div>)}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {selEmp.sessionHistory?.length ? selEmp.sessionHistory.map(s=>{
                        const sc=statusCfg(s.status);
                        return (
                          <div key={s.id} className="pr grid px-5 py-3 border-b border-white/[0.035] last:border-0 items-start transition-colors"
                            style={{gridTemplateColumns:"0.9fr 2fr 0.8fr 0.9fr 0.9fr 1fr 1.2fr"}}>
                            <p className="text-[10px] text-white/35">{new Date(s.date).toLocaleDateString()}</p>
                            <div><AdminLocationView session={s}/></div>
                            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-lg self-start" style={{background:sc.bg,color:sc.tx}}>{sc.label}</span>
                            <p className="text-[10px] font-medium text-white/65">{formatTime(s.totalWorkDuration)}</p>
                            <p className="text-[10px] text-white/28">{formatTime(s.totalBreakDuration)}</p>
                            <p className="text-[10px] font-bold text-white">{formatTime(s.totalWorkDuration+s.totalBreakDuration)}</p>
                            <p className="text-[9px] text-white/40">{s.createdAt?.toDate?.().toLocaleString()||"—"}</p>
                          </div>
                        );
                      }) : (
                        <div className="py-12 text-center text-white/40 text-xs">No sessions found</div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* ── Locations ── */}
                <TabsContent value="locations" className="mt-0">
                  <div className="pg rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/[0.055] flex items-center gap-3">
                      <MapPin className="w-4 h-4 text-rose-400 flex-shrink-0"/>
                      <div>
                        <p className="text-sm font-semibold text-white">Clock-in Locations</p>
                        <p className="text-[9px] text-white/40 mt-0.5">Recent 7-day map for {selEmp.fullName}</p>
                      </div>
                    </div>
                    <div style={{height:480}} className="p-3">
                      <EmployeeLocationsMap employee={liveEmp}/>
                    </div>
                  </div>
                </TabsContent>

                {/* ── Attendance Calendar ── */}
                <TabsContent value="attendance" className="mt-0">
                  <AttendanceCalendar
                    userId={selEmp.id}
                    employeeName={selEmp.fullName}
                  />
                </TabsContent>

                {/* ── Goals ── */}
                <TabsContent value="goals" className="mt-0">
                  <div className="pg rounded-2xl p-16 flex flex-col items-center text-center gap-3">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{background:"rgba(255,255,255,0.04)"}}>
                      <Target className="w-5 h-5 text-white/12"/>
                    </div>
                    <h3 className="ph font-bold text-white/45 text-sm">Goals Tracking — Coming Soon</h3>
                    <p className="text-xs text-white/40 max-w-xs">Set daily/weekly focus targets, track progress, and receive personalised recommendations.</p>
                  </div>
                </TabsContent>

              </Tabs>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════════════ CREATE EMPLOYEE MODAL ══════════════ */}
      <Dialog open={empFormOpen} onOpenChange={setEmpFormOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-white/10" style={{background:"#0a0c14"}}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(129,140,248,0.13)"}}>
              <UserPlus className="w-4 h-4 text-indigo-400"/>
            </div>
            <div>
              <h3 className="ph font-bold text-white text-sm">Add Employee</h3>
              <p className="text-[9px] text-white/45 mt-0.5">Create an account for a new {company?.name || "company"} employee</p>
            </div>
          </div>

          <form onSubmit={createEmployee} className="space-y-3.5">
            <div>
              <Label className="text-[10px] text-white/45 uppercase tracking-widest">Full Name</Label>
              <Input required value={empName} onChange={e=>setEmpName(e.target.value)} placeholder="Employee name"
                className="mt-1.5 bg-transparent border-white/10 text-white text-sm"/>
            </div>
            <div>
              <Label className="text-[10px] text-white/45 uppercase tracking-widest">Email</Label>
              <Input type="email" value={empEmail} onChange={e=>setEmpEmail(e.target.value)} placeholder="employee@example.com"
                className="mt-1.5 bg-transparent border-white/10 text-white text-sm"/>
              <p className="text-[9px] text-white/30 mt-1">Optional if you provide a phone number below</p>
            </div>
            <div>
              <Label className="text-[10px] text-white/45 uppercase tracking-widest">Phone Number</Label>
              <Input value={empPhone} onChange={e=>setEmpPhone(e.target.value)} placeholder="+977 98XXXXXXXX"
                className="mt-1.5 bg-transparent border-white/10 text-white text-sm"/>
              <p className="text-[9px] text-white/30 mt-1">Optional if you provide an email above — no verification required</p>
            </div>
            <div>
              <Label className="text-[10px] text-white/45 uppercase tracking-widest">Temporary Password</Label>
              <Input required type="text" value={empPassword} onChange={e=>setEmpPassword(e.target.value)} placeholder="min 6 characters"
                minLength={6} className="mt-1.5 bg-transparent border-white/10 text-white text-sm"/>
            </div>
            <div>
              <Label className="text-[10px] text-white/45 uppercase tracking-widest">Department</Label>
              <Input value={empDepartment} onChange={e=>setEmpDepartment(e.target.value)} placeholder="e.g. Engineering, HR"
                className="mt-1.5 bg-transparent border-white/10 text-white text-sm"/>
            </div>

            <div className="flex items-center gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={()=>setEmpFormOpen(false)}
                className="rounded-xl text-xs border-white/10 text-white/45">
                Cancel
              </Button>
              <Button type="submit" disabled={creatingEmp}
                className="rounded-xl text-xs inline-flex items-center gap-2" style={{background:"rgba(99,102,241,0.16)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.25)"}}>
                {creatingEmp ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}
                Create Employee
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ══════════════ RESET PASSWORD MODAL ══════════════ */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="max-w-md rounded-3xl border border-white/10" style={{background:"#0a0c14"}}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"rgba(56,189,248,0.13)"}}>
              <KeyRound className="w-4 h-4 text-sky-400"/>
            </div>
            <div>
              <h3 className="ph font-bold text-white text-sm">Reset Password</h3>
              <p className="text-[9px] text-white/45 mt-0.5">{pwdEmp?.fullName || pwdEmp?.email || "employee"}</p>
            </div>
          </div>

          <form onSubmit={(e)=>{e.preventDefault(); resetEmployeePassword();}} className="space-y-3.5">
            <p className="text-xs text-white/55 leading-relaxed">
              A password reset <strong className="text-white/80">link</strong> will be emailed to{" "}
              <strong className="text-sky-400 break-all">{pwdEmp?.email}</strong>. The employee clicks it to
              set a new password. This avoids the SMS OTP that can fail in some regions.
            </p>

            <div className="flex items-center gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={()=>setPwdOpen(false)}
                className="rounded-xl text-xs border-white/10 text-white/45">
                Cancel
              </Button>
              <Button type="submit" disabled={resettingPwd}
                className="rounded-xl text-xs inline-flex items-center gap-2" style={{background:"rgba(56,189,248,0.16)",color:"#7dd3fc",border:"1px solid rgba(56,189,248,0.25)"}}>
                {resettingPwd ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Mail className="w-3.5 h-3.5"/>}
                Send Reset Link
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;