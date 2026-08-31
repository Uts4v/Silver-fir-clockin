import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { TeaLeafIcon } from "@/components/ui/TeaLeafIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuthContext } from "@/contexts/AuthContext";
import { normalizePhone } from "@/hooks/useAuth";
import { RecaptchaVerifier, signInWithPhoneNumber, sendPasswordResetEmail, type ConfirmationResult } from "firebase/auth";
import { auth } from "@/integrations/firebase/client";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Lock,
  User,
  ArrowRight,
  Coffee,
  BarChart2,
  Award,
  Leaf,
  Building2,
  Users,
  KeyRound,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

type Mode = "login" | "company" | "employee";

const generateInviteCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const errMsg = (err: unknown) => (err instanceof Error ? err.message : "An unexpected error occurred");

const Auth = () => {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Phone + password login (for admin-created employees). No OTP required.
  const [loginTab, setLoginTab] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);

  // Forgot password (email reset link)
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  // Phone-OTP join (self sign-up) still uses a 6-digit code.
  const [otp, setOtp] = useState("");
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  // Register company
  const [companyName, setCompanyName] = useState("");
  const [companyUsername, setCompanyUsername] = useState("");
  const [inviteCode, setInviteCode] = useState(generateInviteCode);
  const [adminFullName, setAdminFullName] = useState("");
  const [adminDepartment, setAdminDepartment] = useState("");

  // Join company (employee)
  const [companyKey, setCompanyKey] = useState("");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");

  const { signIn, signInWithPhone, signUp, registerCompany, getProfile, registerPhoneUser, refetchProfile, signOut } = useAuthContext();
  const navigate = useNavigate();

  const getPhoneVerifier = () => {
    if (!verifierRef.current) {
      verifierRef.current = new RecaptchaVerifier(auth, "phone-recaptcha", { size: "invisible" });
    }
    return verifierRef.current;
  };

  const resetFields = () => {
    setEmail("");
    setPassword("");
    setCompanyName("");
    setCompanyUsername("");
    setInviteCode(generateInviteCode());
    setAdminFullName("");
    setAdminDepartment("");
    setCompanyKey("");
    setFullName("");
    setDepartment("");
    setPhone("");
    setPhonePassword("");
    setOtp("");
    setConfirmResult(null);
    setLoginTab("email");
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    resetFields();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) throw error;
      toast.success("Welcome back!");
      navigate("/");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = forgotEmail.trim();
    if (!target) { toast.error("Enter your email"); return; }
    setForgotBusy(true);
    try {
      await sendPasswordResetEmail(auth, target);
      toast.success("Password reset link sent! Check your email.");
      setForgotOpen(false);
      setForgotEmail("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send reset link. Confirm the email is correct.");
    } finally {
      setForgotBusy(false);
    }
  };

  const handleRegisterCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await registerCompany({
        companyName,
        username: companyUsername,
        inviteCode,
        adminFullName,
        email,
        password,
        department: adminDepartment,
      });
      if (error) throw error;
      toast.success("Company created! You are now the admin.");
      navigate("/");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Email and password are required for email sign-up.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await signUp({
        companyKey,
        fullName,
        email,
        password,
        department,
        phone,
      });
      if (error) throw error;
      toast.success("Account created! Joined your company.");
      navigate("/");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Enter your phone number"); return; }
    if (!phonePassword.trim()) { toast.error("Enter your password"); return; }
    setPhoneBusy(true);
    try {
      const { error } = await signInWithPhone(phone, phonePassword);
      if (error) throw error;
      toast.success("Welcome back!");
      navigate("/");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setPhoneBusy(false);
    }
  };

  const sendJoinCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyKey.trim()) { toast.error("Enter your company username or invite code"); return; }
    if (!fullName.trim()) { toast.error("Enter your full name"); return; }
    if (!phone.trim()) { toast.error("Enter your phone number"); return; }
    setLoading(true);
    try {
      const conf = await signInWithPhoneNumber(auth, normalizePhone(phone), getPhoneVerifier());
      setConfirmResult(conf);
      toast.success("Verification code sent!");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  };

  const verifyJoinCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmResult || !otp.trim() || !phone.trim()) return;
    setLoading(true);
    try {
      const cred = await confirmResult.confirm(otp);
      const { error } = await registerPhoneUser({
        companyKey,
        fullName,
        department,
        phone,
        uid: cred.user.uid,
      });
      if (error) throw error;
      await refetchProfile();
      toast.success("Account created! Joined your company.");
      navigate("/");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) return handleJoinCompany(e);
    if (!confirmResult) return sendJoinCode(e);
    return verifyJoinCode(e);
  };

  const title =
    mode === "login" ? "Welcome Back" : mode === "company" ? "Register Your Company" : "Join Your Company";
  const subtitle =
    mode === "login"
      ? "Sign in to continue your productivity journey"
      : mode === "company"
      ? "Create a company. You'll be its main admin."
      : "Sign up with your company username or invite code";

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-tea-forest relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute inset-0 opacity-10">
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute text-white"
              style={{
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                width: `${40 + Math.random() * 60}px`,
                height: `${40 + Math.random() * 60}px`,
              }}
              animate={{
                y: [0, -20, 0],
                rotate: [0, 10, -10, 0],
              }}
              transition={{
                duration: 5 + Math.random() * 3,
                repeat: Infinity,
                delay: Math.random() * 2,
              }}
            >
              <TeaLeafIcon />
            </motion.div>
          ))}
        </div>

        <div className="relative z-10 flex flex-col justify-center px-12 text-white">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center gap-4 mb-8">
              <div>
                <h1 className="font-display text-4xl font-semibold">Silver Fir</h1>
                <p className="text-white/80">Clock-in & Productivity</p>
              </div>
            </div>

            <h2 className="font-display text-3xl font-semibold mb-4">
              Brew Your Best Work
            </h2>
            <p className="text-white/80 text-lg max-w-md leading-relaxed">
              Track attendance, manage productivity, and keep your team
              accountable — all in one place.
            </p>

            <div className="mt-12 space-y-4">
              <Feature icon={<Leaf className="w-5 h-5 text-white/90" />} text="Track work hours effortlessly" />
              <Feature icon={<Coffee className="w-5 h-5 text-white/90" />} text="Smart break management" />
              <Feature icon={<BarChart2 className="w-5 h-5 text-white/90" />} text="Daily Grind Cards" />
              <Feature icon={<Award className="w-5 h-5 text-white/90" />} text="Earn Tea Points" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right side - Auth form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="font-display text-2xl font-semibold text-foreground">
              Silver Fir
            </h1>
          </div>

          {/* Container that hosts the invisible reCAPTCHA for phone OTP */}
          <div id="phone-recaptcha" className="w-0 h-0 overflow-hidden" />

          {/* Mode switcher */}
          <div className="flex items-center justify-center gap-1.5 mb-6 bg-muted/50 p-1.5 rounded-xl">
            {[
              { id: "login" as Mode, label: "Sign In", icon: User },
              { id: "company" as Mode, label: "Register Company", icon: Building2 },
              { id: "employee" as Mode, label: "Join Company", icon: Users },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => switchMode(m.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  mode === m.id
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <m.icon className="w-3.5 h-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          <div className="tea-card p-8">
            <div className="text-center mb-8">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                {title}
              </h2>
              <p className="text-muted-foreground mt-2">
                {subtitle}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {mode === "login" && (
                <div key="login" className="space-y-4">
                  <div className="flex items-center gap-1.5 p-1 bg-muted/50 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setLoginTab("email")}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
                        loginTab === "email"
                          ? "bg-background text-primary shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email &amp; Password
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginTab("phone")}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
                        loginTab === "phone"
                          ? "bg-background text-primary shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      Phone Number
                    </button>
                  </div>

                  {loginTab === "email" && (
                    <motion.form
                      key="login-email"
                      onSubmit={handleLogin}
                      className="space-y-5"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Field label="Email" htmlFor="login-email" icon={<Mail className="w-4 h-4" />}>
                        <Input
                          id="login-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10"
                          required
                        />
                      </Field>
                      <Field label="Password" htmlFor="login-password" icon={<Lock className="w-4 h-4" />}>
                        <Input
                          id="login-password"
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10"
                          required
                          minLength={6}
                        />
                      </Field>
                      <SubmitButton loading={loading} label="Sign In" />
                      <button
                        type="button"
                        onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground mt-1"
                      >
                        Forgot password?
                      </button>
                    </motion.form>
                  )}

                  {loginTab === "phone" && (
                    <motion.form
                      key="login-phone"
                      onSubmit={handlePhoneLogin}
                      className="space-y-5"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Field label="Phone Number" htmlFor="login-phone" icon={<Smartphone className="w-4 h-4" />}>
                        <Input
                          id="login-phone"
                          type="tel"
                          placeholder="+977 98XXXXXXXX"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="pl-10"
                          required
                        />
                      </Field>
                      <Field label="Password" htmlFor="login-phone-password" icon={<Lock className="w-4 h-4" />}>
                        <Input
                          id="login-phone-password"
                          type="password"
                          placeholder="••••••••"
                          value={phonePassword}
                          onChange={(e) => setPhonePassword(e.target.value)}
                          className="pl-10"
                          required
                          minLength={6}
                        />
                      </Field>
                      <p className="text-[11px] text-muted-foreground -mt-2">
                        Include your country code and sign in with the password your admin set. No verification code needed.
                      </p>
                      <SubmitButton loading={phoneBusy} label="Sign In" />
                      <button
                        type="button"
                        onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground mt-1"
                      >
                        Forgot password?
                      </button>
                    </motion.form>
                  )}
                </div>
              )}

              {mode === "company" && (
                <motion.form
                  key="company"
                  onSubmit={handleRegisterCompany}
                  className="space-y-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  <FieldIcon icon={Building2}>
                    <Label htmlFor="companyName" className="text-foreground">
                      Company Name
                    </Label>
                  </FieldIcon>
                  <Input
                    id="companyName"
                    type="text"
                    placeholder="Acme Inc."
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                  />

                  <FieldIcon icon={Users}>
                    <Label htmlFor="companyUsername" className="text-foreground">
                      Company Username <span className="text-muted-foreground font-normal">(employees use this to join)</span>
                    </Label>
                  </FieldIcon>
                  <Input
                    id="companyUsername"
                    type="text"
                    placeholder="acme"
                    value={companyUsername}
                    onChange={(e) => setCompanyUsername(e.target.value)}
                    required
                  />

                  <FieldIcon icon={KeyRound}>
                    <Label htmlFor="inviteCode" className="text-foreground">
                      Invite Code
                    </Label>
                  </FieldIcon>
                  <div className="flex gap-2">
                    <Input
                      id="inviteCode"
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      className="font-mono uppercase"
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setInviteCode(generateInviteCode())}
                      title="Regenerate code"
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                  </div>

                  <Field label="Admin Full Name" htmlFor="adminFullName" icon={<User className="w-4 h-4" />}>
                    <Input
                      id="adminFullName"
                      type="text"
                      placeholder="Your full name"
                      value={adminFullName}
                      onChange={(e) => setAdminFullName(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </Field>

                  <Field label="Your Department (optional)" htmlFor="adminDepartment" icon={<Users className="w-4 h-4" />}>
                    <Input
                      id="adminDepartment"
                      type="text"
                      placeholder="e.g. Engineering, HR"
                      value={adminDepartment}
                      onChange={(e) => setAdminDepartment(e.target.value)}
                      className="pl-10"
                    />
                  </Field>

                  <Field label="Email" htmlFor="company-email" icon={<Mail className="w-4 h-4" />}>
                    <Input
                      id="company-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </Field>

                  <Field label="Password" htmlFor="company-password" icon={<Lock className="w-4 h-4" />}>
                    <Input
                      id="company-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                      minLength={6}
                    />
                  </Field>

                  <SubmitButton loading={loading} label="Create Company" />
                </motion.form>
              )}

              {mode === "employee" && (
                <motion.form
                  key="employee"
                  onSubmit={handleJoinSubmit}
                  className="space-y-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  <FieldIcon icon={Building2}>
                    <Label htmlFor="companyKey" className="text-foreground">
                      Company Username or Invite Code
                    </Label>
                  </FieldIcon>
                  <Input
                    id="companyKey"
                    type="text"
                    placeholder="acme or ABC123"
                    value={companyKey}
                    onChange={(e) => setCompanyKey(e.target.value)}
                    required
                  />

                  <Field label="Full Name" htmlFor="join-fullName" icon={<User className="w-4 h-4" />}>
                    <Input
                      id="join-fullName"
                      type="text"
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </Field>

                  <Field label="Department (optional)" htmlFor="join-department" icon={<Users className="w-4 h-4" />}>
                    <Input
                      id="join-department"
                      type="text"
                      placeholder="e.g. Engineering, HR"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="pl-10"
                    />
                  </Field>

                  <Field label="Phone Number (sign in without email)" htmlFor="join-phone" icon={<Smartphone className="w-4 h-4" />}>
                    <Input
                      id="join-phone"
                      type="tel"
                      placeholder="+977 98XXXXXXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10"
                    />
                  </Field>

                  <div className="flex items-center gap-3 opacity-60">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or use email</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <Field label="Email" htmlFor="join-email" icon={<Mail className="w-4 h-4" />}>
                    <Input
                      id="join-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                    />
                  </Field>

                  <Field label="Password" htmlFor="join-password" icon={<Lock className="w-4 h-4" />}>
                    <Input
                      id="join-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                      minLength={6}
                    />
                  </Field>

                  {confirmResult && (
                    <Field label="Verification Code" htmlFor="join-otp" icon={<KeyRound className="w-4 h-4" />}>
                      <Input
                        id="join-otp"
                        type="text"
                        inputMode="numeric"
                        placeholder="6-digit code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="pl-10 tracking-widest"
                        required
                      />
                    </Field>
                  )}

                  <SubmitButton
                    loading={loading}
                    label={email.trim() ? "Join Company" : confirmResult ? "Verify &amp; Join" : "Send Code"}
                  />
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Forgot password */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-md">
          <div className="text-center mb-4">
            <h3 className="font-display text-xl font-semibold text-foreground">Reset your password</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Enter your account email and we'll send you a reset link. No SMS code needed.
            </p>
          </div>
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <Field label="Email" htmlFor="forgot-email" icon={<Mail className="w-4 h-4" />}>
              <Input
                id="forgot-email"
                type="email"
                placeholder="you@example.com"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="pl-10"
                required
              />
            </Field>
            <Button
              type="submit"
              className="w-full tea-button-primary flex items-center justify-center gap-2"
              disabled={forgotBusy}
            >
              {forgotBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Reset Link"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Field = ({
  label,
  htmlFor,
  icon,
  children,
}: {
  label: string;
  htmlFor: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div>
    <Label htmlFor={htmlFor} className="text-foreground">
      {label}
    </Label>
    <div className="relative mt-1.5">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none">
          {icon}
        </div>
      )}
      {children}
    </div>
  </div>
);

const FieldIcon = ({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) => (
  <div className="flex items-center gap-1.5">
    <Icon className="w-4 h-4 text-muted-foreground" />
    {children}
  </div>
);

const SubmitButton = ({ loading, label }: { loading: boolean; label: string }) => (
  <Button
    type="submit"
    className="w-full tea-button-primary flex items-center justify-center gap-2"
    disabled={loading}
  >
    {loading ? (
      <Loader2 className="w-4 h-4 animate-spin" />
    ) : (
      <>
        {label}
        <ArrowRight className="w-4 h-4" />
      </>
    )}
  </Button>
);

const Feature = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div className="flex items-center gap-3 text-white/90">
    <div className="w-6 h-6 flex items-center justify-center">{icon}</div>
    <span>{text}</span>
  </div>
);

export default Auth;