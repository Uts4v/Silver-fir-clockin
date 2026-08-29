import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { InstallPanel } from "@/components/InstallApp";
import { useAuthContext } from "@/contexts/AuthContext";
import { db } from "@/integrations/firebase/client";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { TeaLeafIcon } from "@/components/ui/TeaLeafIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTimeShort } from "@/hooks/useWorkSession";
import { toast } from "sonner";
import {
  Award,
  Clock,
  Coffee,
  Calendar,
  TrendingUp,
  Edit3,
  Save,
  Loader2,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Mail,
  Briefcase,
  Lock,
  Building2,
  KeyRound,
} from "lucide-react";

interface Stats {
  totalWorkHours: number;
  totalBreakHours: number;
  workingDays: number;
  avgDailyHours: number;
}

const Profile = () => {
  const { user, profile, loading: authLoading, updateProfile, refetchProfile, changePassword } = useAuthContext();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");

  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  const [activePeriod, setActivePeriod] = useState<"month" | "30days" | "year">("month");
  const [stats, setStats] = useState<Record<"month" | "30days" | "year", Stats>>({
    month: { totalWorkHours: 0, totalBreakHours: 0, workingDays: 0, avgDailyHours: 0 },
    "30days": { totalWorkHours: 0, totalBreakHours: 0, workingDays: 0, avgDailyHours: 0 },
    year: { totalWorkHours: 0, totalBreakHours: 0, workingDays: 0, avgDailyHours: 0 },
  });
  const [loadingPeriod, setLoadingPeriod] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName);
      setDesignation(profile.designation);
      setDepartment(profile.department || "");
    }
  }, [profile]);

  useEffect(() => {
    const fetchStatsForPeriod = async (period: "month" | "30days" | "year") => {
      if (!user) return;
      setLoadingPeriod(true);

      const now = new Date();
      let startDate: Date;

      if (period === "month") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (period === "30days") {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
      } else {
        startDate = new Date(now.getFullYear(), 0, 1);
      }

      const endDate = now;

      try {
        const sessionsRef = collection(db, "users", user.uid, "sessions");
        const q = query(
          sessionsRef,
          where("date", ">=", startDate.toISOString().split("T")[0]),
          where("date", "<=", endDate.toISOString().split("T")[0]),
          orderBy("date", "desc")
        );

        const querySnapshot = await getDocs(q);
        const allSessions = querySnapshot.docs.map((doc) => doc.data());
        const completedSessions = allSessions.filter((s) => s.status === "completed");

        let newStats: Stats = {
          totalWorkHours: 0,
          totalBreakHours: 0,
          workingDays: 0,
          avgDailyHours: 0,
        };

        if (completedSessions.length > 0) {
          const totalWork = completedSessions.reduce((acc, s) => acc + (s.totalWorkDuration || 0), 0);
          const totalBreak = completedSessions.reduce((acc, s) => acc + (s.totalBreakDuration || 0), 0);
          const workingDays = completedSessions.length;

          newStats = {
            totalWorkHours: totalWork,
            totalBreakHours: totalBreak,
            workingDays,
            avgDailyHours: workingDays > 0 ? Math.round(totalWork / workingDays) : 0,
          };
        }

        setStats((prev) => ({ ...prev, [period]: newStats }));
      } catch (error) {
        console.error(`Error fetching ${period} stats:`, error);
      } finally {
        setLoadingPeriod(false);
      }
    };

    fetchStatsForPeriod(activePeriod);
  }, [user, activePeriod]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateProfile({
      fullName,
      designation,
      department: department.trim() || undefined,
    });

    if (error) {
      toast.error("Failed to update profile");
    } else {
      toast.success("Profile updated!");
      setEditing(false);
      refetchProfile();
    }
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setChangingPwd(true);
    const { error } = await changePassword(currentPassword, newPassword);
    if (error) {
      toast.error(error?.message || "Failed to change password");
    } else {
      toast.success("Password changed!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwdOpen(false);
    }
    setChangingPwd(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container px-4 md:px-6 py-8 md:py-12">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <h2 className="font-display text-2xl font-semibold">Profile not found</h2>
            <p className="text-muted-foreground">We couldn't load your profile. Try refreshing your profile data.</p>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={() => refetchProfile()} className="tea-button-primary">
                Refresh Profile
              </Button>
              <Button variant="outline" onClick={() => navigate("/auth")}>
                Go to Sign In
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const currentMonth = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const currentStats = stats[activePeriod];
  const totalTracked = currentStats.totalWorkHours + currentStats.totalBreakHours;
  const focusPercentage = totalTracked > 0 ? Math.round((currentStats.totalWorkHours / totalTracked) * 100) : 0;

  const periodLabel =
    activePeriod === "month"
      ? currentMonth
      : activePeriod === "30days"
      ? "Last 30 Days"
      : "This Year";

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container px-4 md:px-6 py-8 md:py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Download / Install App */}
          <motion.div
            className="tea-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-tea-forest flex items-center justify-center overflow-hidden">
                  <img src="/img/company-logo.jpeg" alt="Silver Fir" className="w-full h-full object-cover" />
                </div>
                <div>
                  <h2 className="font-display font-semibold text-lg text-foreground">Download the Silver Fir App</h2>
                  <p className="text-sm text-muted-foreground">
                    Install it on any device — it works offline and opens like a real app.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <InstallPanel />
            </div>
          </motion.div>

          {/* Profile Header */}
          <motion.div
            className="tea-card relative overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="absolute top-0 right-0 w-48 h-48 opacity-5">
              <TeaLeafIcon />
            </div>

            <div className="relative z-10 flex flex-col md:flex-row gap-6 items-start md:items-center">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-tea-forest flex items-center justify-center text-white text-3xl font-display">
                {profile.fullName.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 space-y-2">
                {editing ? (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="fullName">Full Name</Label>
                      <Input
                        id="fullName"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="designation">Designation</Label>
                      <Input
                        id="designation"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        className="mt-1"
                        placeholder="e.g., SEO Specialist, Developer"
                      />
                    </div>
                    <div>
                      <Label htmlFor="department">Department</Label>
                      <Input
                        id="department"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="mt-1"
                        placeholder="e.g., Engineering, HR"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <h1 className="font-display text-3xl font-semibold text-foreground">
                      {profile.fullName}
                    </h1>
                    <div className="flex flex-wrap gap-4 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        {profile.email}
                      </span>
                      <span className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" />
                        {profile.designation}
                      </span>
                      {profile.department && (
                        <span className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {profile.department}
                        </span>
                      )}
                      {profile.companyName && (
                        <span className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {profile.companyName}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="flex items-center gap-2 text-accent">
                    <Award className="w-5 h-5" />
                    <span className="font-display text-2xl font-semibold">{profile.teaPoints ?? 0}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Tea Points</span>
                </div>

                {editing ? (
                  <Button onClick={handleSave} disabled={saving} className="tea-button-primary">
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Change Password */}
          <motion.div className="tea-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-foreground">Change Password</h3>
                  <p className="text-sm text-muted-foreground">Keep your account secure</p>
                </div>
              </div>
              {!pwdOpen && (
                <Button variant="outline" onClick={() => setPwdOpen(true)}>
                  <Lock className="w-4 h-4 mr-2" />
                  Change Password
                </Button>
              )}
            </div>

            {pwdOpen && (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-1"
                    placeholder="Enter your current password"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-password">New Password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="mt-1"
                      placeholder="At least 6 characters"
                    />
                  </div>
                  <div>
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="mt-1"
                      placeholder="Repeat new password"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={changingPwd} className="tea-button-primary">
                    {changingPwd ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                    Update Password
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setPwdOpen(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </motion.div>

          {/* Monthly Overview (always current month) */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-2xl font-semibold text-foreground">Monthly Overview</h2>
              <span className="text-muted-foreground">{currentMonth}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Clock} label="Total Hours" value={formatTimeShort(stats.month.totalWorkHours)} color="primary" />
              <StatCard icon={Coffee} label="Break Time" value={formatTimeShort(stats.month.totalBreakHours)} color="accent" />
              <StatCard icon={Calendar} label="Working Days" value={stats.month.workingDays.toString()} color="primary" />
              <StatCard icon={TrendingUp} label="Avg Daily" value={formatTimeShort(stats.month.avgDailyHours)} color="accent" />
            </div>
          </motion.div>

          {/* Productivity Insights (always current month) */}
          <motion.div className="tea-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h3 className="font-display text-xl font-semibold text-foreground mb-4">Productivity Insights</h3>

            {stats.month.workingDays > 0 ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Work vs Break Ratio</span>
                    <span className="font-medium">
                      {Math.round((stats.month.totalWorkHours / (stats.month.totalWorkHours + stats.month.totalBreakHours)) * 100)}% focused
                    </span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                      initial={{ width: 0 }}
                      animate={{
                        width: `${
                          (stats.month.totalWorkHours / (stats.month.totalWorkHours + stats.month.totalBreakHours)) * 100
                        }%`,
                      }}
                      transition={{ duration: 1, delay: 0.5 }}
                    />
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  You've logged {stats.month.workingDays} working days this month with an average of{" "}
                  {formatTimeShort(stats.month.avgDailyHours)} per day. Keep up the great work! 🍃
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No completed sessions this month yet. Start tracking to see your insights!</p>
            )}
          </motion.div>

          {/* Analytics Dashboard */}
          <motion.div className="tea-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <BarChart3 className="w-6 h-6 text-primary" />
                <h2 className="font-display text-2xl font-semibold text-foreground">Analytics Dashboard</h2>
              </div>

              <div className="flex gap-1.5 bg-muted/40 p-1 rounded-lg">
                <Button
                  variant={activePeriod === "month" ? "default" : "ghost"}
                  size="sm"
                  className="text-xs px-3"
                  onClick={() => setActivePeriod("month")}
                  disabled={loadingPeriod}
                >
                  This Month
                </Button>
                <Button
                  variant={activePeriod === "30days" ? "default" : "ghost"}
                  size="sm"
                  className="text-xs px-3"
                  onClick={() => setActivePeriod("30days")}
                  disabled={loadingPeriod}
                >
                  Last 30 Days
                </Button>
                <Button
                  variant={activePeriod === "year" ? "default" : "ghost"}
                  size="sm"
                  className="text-xs px-3"
                  onClick={() => setActivePeriod("year")}
                  disabled={loadingPeriod}
                >
                  This Year
                </Button>
              </div>
            </div>

            {loadingPeriod ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : currentStats.workingDays > 0 ? (
              <div className="space-y-8">
                <div className="text-right text-sm text-muted-foreground">{periodLabel}</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  <AnalyticsStat
                    icon={Clock}
                    title="Total Work"
                    value={formatTimeShort(currentStats.totalWorkHours)}
                    trend="+8%"
                    trendUp
                    color="primary"
                  />
                  <AnalyticsStat
                    icon={Coffee}
                    title="Total Breaks"
                    value={formatTimeShort(currentStats.totalBreakHours)}
                    trend="-5%"
                    trendUp={false}
                    color="accent"
                  />
                  <AnalyticsStat
                    icon={Calendar}
                    title="Active Days"
                    value={currentStats.workingDays.toString()}
                    trend="+2 days"
                    trendUp
                    color="primary"
                  />
                  <AnalyticsStat
                    icon={TrendingUp}
                    title="Focus Score"
                    value={`${focusPercentage}%`}
                    trend={focusPercentage > 70 ? "+12%" : "-3%"}
                    trendUp={focusPercentage > 70}
                    color="accent"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Focus Ring */}
                  <div className="flex flex-col items-center p-6 bg-muted/30 rounded-xl border border-border/50">
                    <div className="relative w-40 h-40">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
                        <motion.circle
                          cx="50"
                          cy="50"
                          r="44"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeDasharray={276}
                          initial={{ strokeDashoffset: 276 }}
                          animate={{ strokeDashoffset: 276 - (276 * focusPercentage) / 100 }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                          className="text-primary"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-bold">{focusPercentage}%</span>
                        <span className="text-sm text-muted-foreground mt-1">Focus</span>
                      </div>
                    </div>
                    <p className="mt-4 text-sm text-center text-muted-foreground">
                      Percentage of tracked time spent in focused work
                    </p>
                  </div>

                  {/* Work vs Break Bars */}
                  <div className="flex flex-col justify-center p-6 bg-muted/30 rounded-xl border border-border/50 space-y-5">
                    <div>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span>Focused Work</span>
                        <span className="font-medium">{formatTimeShort(currentStats.totalWorkHours)}</span>
                      </div>
                      <div className="h-3 bg-primary/20 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${focusPercentage}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span>Breaks</span>
                        <span className="font-medium">{formatTimeShort(currentStats.totalBreakHours)}</span>
                      </div>
                      <div className="h-3 bg-accent/20 rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full" style={{ width: `${100 - focusPercentage}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center md:text-left text-sm text-muted-foreground bg-muted/20 p-4 rounded-lg">
                  {focusPercentage >= 80 ? (
                    <>Outstanding discipline — you're in the top tier of focused performers! 🍃</>
                  ) : focusPercentage >= 65 ? (
                    <>Solid consistency — small improvements in break management could push you above 80% focus.</>
                  ) : (
                    <>Room to grow — consider shorter, more structured breaks to boost overall focus time.</>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-40" />
                <h4 className="text-lg font-medium mb-2">No data for this period</h4>
                <p>Complete work sessions during {periodLabel.toLowerCase()} to see analytics.</p>
              </div>
            )}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

const StatCard = ({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  color: "primary" | "accent";
}) => (
  <motion.div className="tea-card text-center" whileHover={{ scale: 1.02 }} transition={{ duration: 0.2 }}>
    <div
      className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-3 ${
        color === "primary" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
      }`}
    >
      <Icon className="w-5 h-5" />
    </div>
    <p className="font-display text-2xl font-semibold text-foreground">{value}</p>
    <p className="text-sm text-muted-foreground">{label}</p>
  </motion.div>
);

const AnalyticsStat = ({
  icon: Icon,
  title,
  value,
  trend,
  trendUp,
  color,
}: {
  icon: any;
  title: string;
  value: string;
  trend: string;
  trendUp: boolean;
  color: "primary" | "accent";
}) => (
  <div className="tea-card p-5 text-center">
    <div
      className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-3 mx-auto ${
        color === "primary" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
      }`}
    >
      <Icon className="w-5 h-5" />
    </div>
    <p className="text-sm text-muted-foreground">{title}</p>
    <p className="text-2xl font-semibold mt-1">{value}</p>
    <div className={`mt-2 text-xs flex items-center justify-center gap-1 ${trendUp ? "text-green-500" : "text-red-500"}`}>
      {trendUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {trend}
    </div>
  </div>
);

export default Profile;