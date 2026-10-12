import { motion } from "framer-motion";
import { Calendar, Clock } from "lucide-react";
import type { WorkSession, BreakLog } from "@/integrations/firebase/types";

interface SessionInfoProps {
  session: WorkSession;
  breakLogs: BreakLog[];
}

const formatTimeOfDay = (timestamp: any): string => {
  if (!timestamp) return "--:--";

  // Handle Firebase Timestamp objects
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

export const SessionInfo = ({ session, breakLogs }: SessionInfoProps) => {
  if (session.status === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="tea-card space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span className="text-sm">{formatDate(session.date)}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Started at
            </span>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="font-medium">
                {formatTimeOfDay(session.workStartTime)}
              </span>
            </div>
            {session.clockInLocation && (
              <div className="mt-2 rounded-lg px-2.5 py-1.5 bg-muted/40 border border-border/60">
                <div className="text-xs font-medium text-foreground truncate">
                  {session.clockInLocation.siteId
                    ? `Clocked in at: ${session.clockInLocation.siteName || session.clockInLocation.label}`
                    : `📍 ${session.clockInLocation.label}`}
                </div>
                {session.clockInLocation.siteId && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    {typeof session.clockInLocation.distanceMeters === "number" &&
                      `${session.clockInLocation.distanceMeters}m from the outlet centre`}
                    {typeof session.clockInLocation.distanceMeters === "number" && " · "}
                    verified inside geo-fence
                  </div>
                )}
              </div>
            )}
          </div>

          {session.workEndTime && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Ended at
              </span>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-destructive" />
                <span className="font-medium">
                  {formatTimeOfDay(session.workEndTime)}
                </span>
              </div>
            </div>
          )}
        </div>

        {breakLogs.length > 0 && (
          <div className="pt-3 border-t border-border">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Break Log
            </span>
            <div className="mt-2 space-y-2">
              {breakLogs.map((log, index) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">Break {index + 1}</span>
                  <span>
                    {formatTimeOfDay(log.breakStart)}
                    {log.breakEnd && (
                      <span className="text-muted-foreground">
                        {" "}
                        → {formatTimeOfDay(log.breakEnd)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
