import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { useAuthContext } from "@/contexts/AuthContext";
import { db } from "@/integrations/firebase/client";
import {
  collection, addDoc, query, where, orderBy, getDocs, updateDoc, doc, Timestamp,
} from "firebase/firestore";
import { LeaveRequest } from "@/integrations/firebase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Loader2,
  CalendarPlus,
  CalendarDays,
  Clock,
  StickyNote,
  Check,
  X,
} from "lucide-react";

const statusCfg: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-400" },
  approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-400" },
  rejected: { label: "Rejected", cls: "bg-rose-500/10 text-rose-400" },
};

const LeaveRequests = () => {
  const { user, profile, loading: authLoading } = useAuthContext();
  const navigate = useNavigate();

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const isAdmin = profile?.role === "admin";

  const fetchRequests = useCallback(async () => {
    if (!user || !profile) return;
    try {
      let docs;
      if (isAdmin) {
        const snap = await getDocs(query(collection(db, "leaveRequests"), orderBy("createdAt", "desc")));
        docs = snap.docs
          .map(d => ({ id: d.id, ...d.data() }) as LeaveRequest)
          .filter(r => r.companyId === profile.companyId);
      } else {
        const snap = await getDocs(query(
          collection(db, "leaveRequests"),
          where("employeeId", "==", user.uid),
          orderBy("createdAt", "desc")
        ));
        docs = snap.docs.map(d => ({ id: d.id, ...d.data() }) as LeaveRequest);
      }
      setRequests(docs);
    } catch (err) {
      console.error("Failed to load leave requests:", err);
      toast.error("Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }, [user, profile, isAdmin]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user && profile) fetchRequests();
  }, [fetchRequests, user, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    if (!startDate || !endDate) { toast.error("Select start and end dates"); return; }
    if (endDate < startDate) { toast.error("End date can't be before start date"); return; }
    if (!reason.trim()) { toast.error("Add a reason for your leave"); return; }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "leaveRequests"), {
        employeeId: user.uid,
        employeeName: profile.fullName,
        employeeEmail: profile.email,
        department: profile.department || "",
        companyId: profile.companyId || "",
        startDate,
        endDate,
        reason: reason.trim(),
        status: "pending",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      toast.success("Leave request submitted");
      setStartDate(""); setEndDate(""); setReason("");
      fetchRequests();
    } catch (err) {
      console.error("Failed to submit leave request:", err);
      toast.error("Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (id: string, status: "approved" | "rejected") => {
    setReviewingId(id);
    try {
      const req = requests.find(r => r.id === id);
      await updateDoc(doc(db, "leaveRequests", id), {
        status,
        adminNote: noteDrafts[id] ?? req?.adminNote ?? "",
        reviewedBy: profile?.fullName,
        reviewedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      toast.success(`Leave ${status}`);
      fetchRequests();
    } catch (err) {
      console.error("Failed to review leave request:", err);
      toast.error("Failed to update request");
    } finally {
      setReviewingId(null);
    }
  };

  const saveNote = async (id: string) => {
    try {
      await updateDoc(doc(db, "leaveRequests", id), {
        adminNote: noteDrafts[id] ?? "",
        updatedAt: Timestamp.now(),
      });
      toast.success("Note saved");
      fetchRequests();
    } catch (err) {
      console.error("Failed to save note:", err);
      toast.error("Failed to save note");
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container px-4 md:px-6 py-8 md:py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-3xl font-semibold text-foreground">
              {isAdmin ? "Leave Requests" : "Request Leave"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {isAdmin
                ? "Review employee leave requests and add notes"
                : "Submit a leave request — your admin will review it"}
            </p>
          </motion.div>

          {/* Employee form */}
          {!isAdmin && (
            <motion.div className="tea-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="leave-start">Start Date</Label>
                    <div className="relative mt-1.5">
                      <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="leave-start" type="date" required value={startDate}
                        onChange={(e) => setStartDate(e.target.value)} className="pl-10" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="leave-end">End Date</Label>
                    <div className="relative mt-1.5">
                      <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="leave-end" type="date" required value={endDate}
                        onChange={(e) => setEndDate(e.target.value)} className="pl-10" />
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="leave-reason">Reason</Label>
                  <Textarea id="leave-reason" required rows={3} value={reason}
                    onChange={(e) => setReason(e.target.value)} className="mt-1.5"
                    placeholder="Explain why you need this leave" />
                </div>

                <Button type="submit" disabled={submitting} className="tea-button-primary flex items-center gap-2">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                  Submit Request
                </Button>
              </form>
            </motion.div>
          )}

          {/* List */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="font-display text-xl font-semibold text-foreground mb-4">
              {isAdmin ? `All Requests (${requests.length})` : `My Requests (${requests.length})`}
            </h2>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : requests.length === 0 ? (
              <div className="tea-card p-12 text-center text-muted-foreground">
                <CalendarPlus className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No leave requests yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((r) => {
                  const sc = statusCfg[r.status] || statusCfg.pending;
                  return (
                    <motion.div key={r.id} className="tea-card p-5" whileHover={{ scale: 1.005 }}>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-tea-forest flex items-center justify-center text-white font-display text-sm">
                            {(r.employeeName || "U").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {isAdmin ? r.employeeName : "Leave request"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {isAdmin && r.department ? `${r.department} · ` : ""}
                              {new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()}
                              <span className="ml-2 inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {Math.ceil((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1} day(s)
                              </span>
                            </p>
                          </div>
                        </div>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sc.cls}`}>{sc.label}</span>
                      </div>

                      <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-3">{r.reason}</p>

                      {r.adminNote && (
                        <div className="mt-3 text-sm bg-primary/5 border border-primary/10 rounded-lg p-3">
                          <span className="font-medium text-foreground flex items-center gap-1.5 mb-1">
                            <StickyNote className="w-3.5 h-3.5" /> Admin note
                          </span>
                          {r.adminNote}
                        </div>
                      )}

                      {isAdmin && (
                        <div className="mt-4 space-y-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Admin Note (visible to employee)</Label>
                            <Textarea rows={2} className="mt-1.5"
                              value={noteDrafts[r.id] ?? r.adminNote ?? ""}
                              onChange={(e) => setNoteDrafts(prev => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder="Add a note for the employee…" />
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button size="sm" variant="outline"
                              onClick={() => saveNote(r.id)}
                              className="flex items-center gap-1.5">
                              <StickyNote className="w-3.5 h-3.5" /> Save Note
                            </Button>
                            <Button size="sm" variant="outline"
                              disabled={reviewingId === r.id}
                              onClick={() => review(r.id, "approved")}
                              className="flex items-center gap-1.5 text-emerald-600">
                              <Check className="w-3.5 h-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline"
                              disabled={reviewingId === r.id}
                              onClick={() => review(r.id, "rejected")}
                              className="flex items-center gap-1.5 text-rose-600">
                              <X className="w-3.5 h-3.5" /> Reject
                            </Button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default LeaveRequests;