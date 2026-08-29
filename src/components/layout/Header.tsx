import { motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { User, Settings, LogOut, Loader2, Shield, Mail, CalendarDays, Bell, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";
import { InstallPanel } from "@/components/InstallApp";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { collection, doc, onSnapshot, query, where, or } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Header = () => {
  const { user, profile, signOut, loading } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string>("");
  const { items: notifs, unread: notifUnread, markRead, markAllRead } = useNotifications();

  // Follow the company doc so the saved company logo appears in the top bar.
  useEffect(() => {
    if (!profile?.companyId) {
      setCompanyLogoUrl("");
      return;
    }
    const unsub = onSnapshot(
      doc(db, "companies", profile.companyId),
      (snap) => {
        const data = snap.data() as { logoUrl?: string } | undefined;
        setCompanyLogoUrl(data?.logoUrl || "");
      },
      (error) => console.warn("Company logo read failed for", profile.companyId, error)
    );
    return () => unsub();
  }, [profile?.companyId, profile]);

  // Listen for unread notes
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    try {
      const notesRef = collection(db, "notes");
      const notesQuery = query(
        notesRef,
        or(
          where("recipientId", "==", user.uid),
          where("recipientId", "==", "all")
        )
      );
      const unsubscribe = onSnapshot(
        notesQuery,
        (snapshot) => {
          try {
            const unreadNotes = snapshot.docs.filter(doc => {
              const data = doc.data();
              return !data.isRead;
            });
            setUnreadCount(unreadNotes.length);
          } catch (error) {
            console.error("Error filtering notes:", error);
            setUnreadCount(0);
          }
        },
        (error) => {
          console.error("Error listening to notes:", error);
          setUnreadCount(0);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error("Error setting up notes listener:", error);
      setUnreadCount(0);
    }
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const navItems = [
    { label: "Dashboard", path: "/" },
    { label: "Profile", path: "/profile" },
    { label: "History", path: "/history" },
    { label: "Leave", path: "/leaves", icon: CalendarDays },
    { 
      label: "Notes", 
      path: "/notes", 
      icon: Mail,
      badge: unreadCount > 0 ? unreadCount : undefined 
    },
    ...(profile?.role === "admin" ? [{ label: "Admin", path: "/admin", icon: Shield }] : []),
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        {/* Logo */}
        <motion.div
          className="flex items-center gap-3 cursor-pointer"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate("/")}
        >
          <div className="w-9 h-9">
            {companyLogoUrl ? (
              <img src={companyLogoUrl} alt="Company logo" className="w-9 h-9 object-contain" />
            ) : (
              <img src="/img/company-logo.jpeg" alt="Company logo" className="w-9 h-9 object-contain" />
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-display text-xl font-semibold text-foreground">
              Silver Fir
            </span>
          </div>
        </motion.div>

        {/* Navigation */}
        {user && (
          <motion.nav
            className="hidden md:flex items-center gap-1"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  location.pathname === item.path
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {item.icon && <item.icon className="w-4 h-4" />}
                {item.label}
                {item.badge !== undefined && (
                  <Badge 
                    variant="destructive" 
                    className="ml-1 h-5 min-w-5 flex items-center justify-center text-xs px-1.5"
                  >
                    {item.badge}
                  </Badge>
                )}
              </button>
            ))}
          </motion.nav>
        )}

        {/* Actions */}
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
        >
          <ThemeToggle />
          {user && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" title="Notifications">
                    <Bell className="w-5 h-5 text-muted-foreground" />
                    {notifUnread > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {notifUnread}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <p className="text-sm font-semibold text-foreground">Notifications</p>
                    {notifUnread > 0 && (
                      <button onClick={() => markAllRead()} className="text-[11px] text-primary hover:underline">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifs.length === 0 ? (
                      <p className="px-3 py-8 text-center text-xs text-muted-foreground">No notifications yet</p>
                    ) : (
                      notifs.map((n) => (
                        <DropdownMenuItem
                          key={n.id}
                          onClick={() => { markRead(n.id); if (n.link) navigate(n.link); }}
                          className={`flex-col items-start gap-0.5 py-2.5 px-3 ${n.read ? "opacity-55" : ""}`}
                        >
                          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${n.read ? "bg-muted" : "bg-primary"}`} />
                            {n.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground line-clamp-2">{n.message}</span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {n.createdAt?.toDate?.()?.toLocaleString() || ""}
                          </span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" title="Download / Install app">
                    <Download className="w-5 h-5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 p-4">
                  <InstallPanel />
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 px-3 relative"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-tea-forest flex items-center justify-center text-white text-sm font-medium">
                    {profile?.fullName?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <span className="hidden sm:inline text-sm font-medium">
                    {profile?.fullName || "User"}
                  </span>
                  {unreadCount > 0 && (
                    <Badge 
                      variant="destructive" 
                      className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center text-xs px-1.5"
                    >
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/history")}>
                  <Settings className="w-4 h-4 mr-2" />
                  History
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/leaves")}>
                  <CalendarDays className="w-4 h-4 mr-2" />
                  Leave
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/notes")}>
                  <Mail className="w-4 h-4 mr-2" />
                  Notes
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="ml-auto">
                      {unreadCount}
                    </Badge>
                  )}
                </DropdownMenuItem>
                {profile?.role === "admin" && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <Shield className="w-4 h-4 mr-2" />
                    Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => navigate("/auth")} variant="outline">
              Sign In
            </Button>
          )}
        </motion.div>
      </div>
    </header>
  );
};