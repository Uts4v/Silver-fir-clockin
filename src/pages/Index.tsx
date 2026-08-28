
import { useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { TimerDisplay } from "@/components/dashboard/TimerDisplay";
import { ActionButtons } from "@/components/dashboard/ActionButtons";
import { SessionInfo } from "@/components/dashboard/SessionInfo";
import { GrindCard } from "@/components/dashboard/GrindCard";

import { useWorkSession } from "@/hooks/useWorkSession";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { useAuthContext } from "@/contexts/AuthContext";
import { TeaLeafIcon } from "@/components/ui/TeaLeafIcon";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { user, loading: authLoading } = useAuthContext();
  const navigate = useNavigate();
  const {
    session,
    breakLogs,
    status,
    displayTime,
    breakDisplayTime,
    loading: sessionLoading,
    clockIn,
    clockOut,
    pauseWork,
    resumeWork,
    resetSession,
  } = useWorkSession();


  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  if (authLoading || sessionLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero/Main Section */}
      <main className="container px-4 md:px-6 py-8 md:py-12">
        {/* Floating tea leaves decoration */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <motion.div
            className="absolute top-20 left-10 w-8 h-8 text-primary/10"
            animate={{ y: [0, -20, 0], rotate: [0, 10, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          >
            <TeaLeafIcon />
          </motion.div>
          <motion.div
            className="absolute top-40 right-20 w-12 h-12 text-primary/5"
            animate={{ y: [0, 15, 0], rotate: [0, -15, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          >
            <TeaLeafIcon />
          </motion.div>
          <motion.div
            className="absolute bottom-40 left-1/4 w-6 h-6 text-accent/10"
            animate={{ y: [0, -10, 0], rotate: [0, 20, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          >
            <TeaLeafIcon />
          </motion.div>
        </div>

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Welcome Section */}
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <motion.h1
              className="font-display text-4xl md:text-5xl font-semibold text-foreground mb-3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              {status === "idle" && "Ready to Begin Your Day?"}
              {status === "working" && "Focus Mode Active"}
              {status === "break" && "Enjoying Your Break"}
              {status === "completed" && "Excellent Work Today! 🍃"}
            </motion.h1>
            <motion.p
              className="text-muted-foreground text-lg max-w-md mx-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {status === "idle" &&
                "Track your work, manage breaks, and earn Tea Points"}
              {status === "working" &&
                "Stay present. Great things are brewing."}
              {status === "break" &&
                "Refresh and recharge. Your work will wait."}
              {status === "completed" &&
                "View your Grind Card to see today's achievements"}
            </motion.p>
          </motion.div>



          {/* Status Badge */}
          <motion.div
            className="flex justify-center mb-8"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
          >
            <StatusBadge status={status} />
          </motion.div>

          {/* Timer Display */}
          <motion.div
            className="flex justify-center mb-10"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <TimerDisplay
              time={displayTime}
              breakTime={breakDisplayTime}
              status={status}
            />
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            className="flex justify-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <ActionButtons
              status={status}
              onClockIn={clockIn}
              onClockOut={clockOut}
              onPause={pauseWork}
              onResume={resumeWork}
              onReset={resetSession}
            />
          </motion.div>

          {/* Session Info */}
          {session && status !== "idle" && status !== "completed" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <SessionInfo session={session} breakLogs={breakLogs} />
            </motion.div>
          )}

          {/* Grind Card (when completed) */}
          {session && status === "completed" && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              <GrindCard session={session} breakLogs={breakLogs} />
            </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-auto">
        <div className="container px-4 md:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 text-primary">
                <TeaLeafIcon />
              </div>
              <span>Silver Fir</span>
            </div>
            <p>© 2026 Utsav Shrestha. All rights reserved.</p>
              <p>Brew productivity, one cup at a time.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
