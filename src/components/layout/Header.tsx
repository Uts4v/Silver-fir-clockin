import { motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import logo from "@/img/danfe.png";
import { User, Settings, LogOut, Loader2, Shield, Mail, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { collection, onSnapshot, query, where, or } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Header = () => {
  const { user, profile, signOut, loading } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

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
          <div className="w-9 h-9 text-primary">
            <img src={logo} alt="Logo" className="w-9 h-9" />
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