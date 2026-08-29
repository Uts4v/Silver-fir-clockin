import { useState, useEffect } from "react";
import { collection, addDoc, getDocs, query, orderBy, Timestamp, updateDoc, doc, deleteDoc, where, or } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { useAuthContext } from "@/contexts/AuthContext";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bell, Send, Trash2, Calendar as CalendarIcon, DollarSign, AlertTriangle, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notifyNoteSent } from "@/integrations/notifications";

interface Note {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  subject: string;
  message: string;
  priority: "low" | "normal" | "high";
  isRead: boolean;
  createdAt: any;
  updatedAt: any;
}

interface Subscription {
  id: string;
  name: string;
  renewed_date?: any;
  deadline_date?: any;
  renewalDate?: any;
  description?: string;
  notifyDaysBefore?: number;
  cost: number;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  lastNotificationSent?: any;
}

interface User {
  id: string;
  fullName: string;
  email: string;
}

export default function NotesSubscriptionsManager() {
  const { user, profile } = useAuthContext();
  const [notes, setNotes] = useState<Note[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Admin note form state
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteRecipient, setNoteRecipient] = useState("all");
  const [noteSubject, setNoteSubject] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const [notePriority, setNotePriority] = useState<"low" | "normal" | "high">("normal");
  
  // Subscription form state
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [subName, setSubName] = useState("");
  const [subRenewedDate, setSubRenewedDate] = useState<Date | undefined>();
  const [subDeadlineDate, setSubDeadlineDate] = useState<Date | undefined>();
  const [subCost, setSubCost] = useState("");

  useEffect(() => {
    if (user && profile) {
      fetchData();
    }
  }, [user, profile]);

  const fetchData = async () => {
    if (!user || !profile) {
      console.log("fetchData: user or profile not available", { user: !!user, profile: !!profile });
      return;
    }

    console.log("fetchData: starting fetch for user", user.uid, "with role", profile.role);
    setLoading(true);
    try {
      // Fetch users (if admin)
      if (profile?.role === "admin") {
        const usersSnapshot = await getDocs(collection(db, "users"));
        setUsers(usersSnapshot.docs.map(doc => ({
          id: doc.id,
          fullName: doc.data().fullName,
          email: doc.data().email
        })));
      }

      // Fetch announcements/notes
      try {
        let notesQuery;
        if (profile?.role === "admin") {
          console.log("fetchData: fetching all notes for admin");
          notesQuery = query(
            collection(db, "notes"),
            orderBy("createdAt", "desc")
          );
        } else {
          console.log("fetchData: fetching user notes for user", user.uid);
          notesQuery = query(
            collection(db, "notes"),
            or(
              where("recipientId", "==", user.uid),
              where("recipientId", "==", "all")
            )
          );
        }
        const notesSnapshot = await getDocs(notesQuery);
        console.log("fetchData: fetched", notesSnapshot.docs.length, "notes");
        const fetchedNotes = notesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as Note)
        })) as Note[];

        if (profile?.role !== "admin") {
          fetchedNotes.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          });
        }

        setNotes(fetchedNotes);
      } catch (notesError) {
        console.error("Error fetching notes:", notesError);
        setNotes([]);
      }

      // Fetch subscriptions
      try {
        let subsQuery;
        if (profile?.role === "admin") {
          console.log("fetchData: fetching all subscriptions for admin");
          subsQuery = collection(db, "subscriptions");
        } else {
          console.log("fetchData: fetching active subscriptions for user");
          subsQuery = query(
            collection(db, "subscriptions"),
            where("isActive", "==", true)
          );
        }
        const subsSnapshot = await getDocs(subsQuery);
        console.log("fetchData: fetched", subsSnapshot.docs.length, "subscriptions");
        const fetchedSubs = subsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as Subscription)
        })) as Subscription[];
        setSubscriptions(fetchedSubs);
      } catch (subsError) {
        console.error("Error fetching subscriptions:", subsError);
        setSubscriptions([]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
    setLoading(false);
  };

  // Admin: Send announcement/note to employees
  const sendNote = async () => {
    if (!user || !noteSubject || !noteMessage || !noteRecipient) return;

    try {
      const recipient = users.find(u => u.id === noteRecipient);
      
      await addDoc(collection(db, "notes"), {
        senderId: user.uid,
        senderName: profile?.fullName || "Unknown",
        recipientId: noteRecipient,
        recipientName: noteRecipient === "all" ? "All Employees" : recipient?.fullName || "Unknown",
        subject: noteSubject,
        message: noteMessage,
        priority: notePriority,
        isRead: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      setNoteSubject("");
      setNoteMessage("");
      setNoteRecipient("all");
      setNotePriority("normal");
      setNoteDialogOpen(false);

      notifyNoteSent({
        recipientId: noteRecipient,
        companyId: profile?.companyId,
        senderName: profile?.fullName || "Unknown",
        subject: noteSubject,
      });

      await fetchData();
    } catch (error) {
      console.error("Error sending note:", error);
    }
  };

  const markAsRead = async (noteId: string) => {
    try {
      console.log("markAsRead: attempting to mark note as read", noteId);
      console.log("markAsRead: current user", user?.uid);

      const noteToUpdate = notes.find(n => n.id === noteId);
      console.log("markAsRead: note to update", noteToUpdate);

      if (!noteToUpdate) {
        console.error("markAsRead: note not found");
        return;
      }

      console.log("markAsRead: note recipientId", noteToUpdate.recipientId);

      await updateDoc(doc(db, "notes", noteId), {
        isRead: true,
        updatedAt: Timestamp.now()
      });
      console.log("markAsRead: successfully updated note");
      await fetchData();
    } catch (error) {
      console.error("Error marking note as read:", error);
    }
  };

  const deleteNote = async (noteId: string) => {
    try {
      await deleteDoc(doc(db, "notes", noteId));
      await fetchData();
    } catch (error) {
      console.error("Error deleting note:", error);
    }
  };

  const addSubscription = async () => {
    if (!user || !subName || !subRenewedDate || !subDeadlineDate) return;

    try {
      await addDoc(collection(db, "subscriptions"), {
        name: subName,
        renewed_date: Timestamp.fromDate(subRenewedDate),
        deadline_date: Timestamp.fromDate(subDeadlineDate),
        renewalDate: Timestamp.fromDate(subDeadlineDate),
        description: `${subName} subscription`,
        notifyDaysBefore: 7,
        cost: parseFloat(subCost) || 0,
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: user.uid
      });

      setSubName("");
      setSubRenewedDate(undefined);
      setSubDeadlineDate(undefined);
      setSubCost("");
      setSubDialogOpen(false);

      await fetchData();
    } catch (error) {
      console.error("Error adding subscription:", error);
    }
  };

  const toggleSubscriptionStatus = async (subId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, "subscriptions", subId), {
        isActive: !currentStatus,
        updatedAt: Timestamp.now()
      });
      await fetchData();
    } catch (error) {
      console.error("Error toggling subscription:", error);
    }
  };

  const deleteSubscription = async (subId: string) => {
    try {
      await deleteDoc(doc(db, "subscriptions", subId));
      await fetchData();
    } catch (error) {
      console.error("Error deleting subscription:", error);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "destructive";
      case "normal": return "default";
      case "low": return "secondary";
      default: return "default";
    }
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="flex justify-center items-center h-64">Loading...</div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="container mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">
            {profile?.role === "admin" ? "Announcements & Subscriptions" : "Announcements"}
          </h1>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            {/* Admin Only - Send Announcement and Add Subscription */}
            {profile?.role === "admin" && (
              <>
                <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full sm:w-auto">
                      <Send className="h-4 w-4 mr-2" />
                      Send Announcement
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Send Announcement</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Recipient</Label>
                        <Select value={noteRecipient} onValueChange={setNoteRecipient}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select recipient" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Employees</SelectItem>
                            {users.filter(u => u.id !== user?.uid).map(u => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.fullName} ({u.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Priority</Label>
                        <Select value={notePriority} onValueChange={(val: any) => setNotePriority(val)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Subject</Label>
                        <Input
                          value={noteSubject}
                          onChange={(e) => setNoteSubject(e.target.value)}
                          placeholder="Enter subject"
                        />
                      </div>
                      <div>
                        <Label>Message</Label>
                        <Textarea
                          value={noteMessage}
                          onChange={(e) => setNoteMessage(e.target.value)}
                          placeholder="Enter your message"
                          rows={5}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={sendNote}>Send</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full sm:w-auto">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Subscription
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add Subscription</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Subscription Name</Label>
                        <Input
                          value={subName}
                          onChange={(e) => setSubName(e.target.value)}
                          placeholder="e.g., Claude Pro, Freepik Premium"
                          className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-indigo-500 focus:ring-indigo-500 pr-10"
                        />
                      </div>
                      <div>
                        <Label>Renewed Date</Label>
                        <Input
                          type="date"
                          value={subRenewedDate ? subRenewedDate.toISOString().split('T')[0] : ''}
                          onChange={(e) => setSubRenewedDate(e.target.value ? new Date(e.target.value) : undefined)}
                          className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-indigo-500 focus:ring-indigo-500 pr-10"
                        />
                      </div>
                      <div>
                        <Label>Deadline Date</Label>
                        <Input
                          type="date"
                          value={subDeadlineDate ? subDeadlineDate.toISOString().split('T')[0] : ''}
                          onChange={(e) => setSubDeadlineDate(e.target.value ? new Date(e.target.value) : undefined)}
                          className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-indigo-500 focus:ring-indigo-500 pr-10"
                        />
                      </div>
                      <div>
                        <Label>Monthly Cost ($)</Label>
                        <Input
                          type="number"
                          value={subCost}
                          onChange={(e) => setSubCost(e.target.value)}
                          placeholder="0.00"
                          className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-indigo-500 focus:ring-indigo-500 pr-10"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setSubDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={addSubscription}>Add</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>

        <Tabs defaultValue="announcements" className="w-full">
          <TabsList className="w-full flex flex-col sm:flex-row">
            <TabsTrigger value="announcements" className="w-full sm:w-auto justify-start sm:justify-center">
              <Bell className="h-4 w-4 mr-2" />
              Announcements ({notes.filter(n => !n.isRead && (n.recipientId === user?.uid || n.recipientId === "all")).length})
            </TabsTrigger>
            {profile?.role === "admin" && (
            <TabsTrigger value="subscriptions" className="w-full sm:w-auto justify-start sm:justify-center">
                <CalendarIcon className="h-4 w-4 mr-2" />
                Subscriptions ({subscriptions.filter(s => s.isActive).length})
              </TabsTrigger>
            )}
          </TabsList>

          {/* Announcements Tab */}
          <TabsContent value="announcements" className="space-y-4">
            {notes.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  No announcements yet
                </CardContent>
              </Card>
            ) : (
              notes.map(note => (
                <Card key={note.id} className={!note.isRead && (note.recipientId === user?.uid || note.recipientId === "all") ? "border-primary" : ""}>
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-lg">{note.subject}</CardTitle>
                          <Badge variant={getPriorityColor(note.priority)}>
                            {note.priority}
                          </Badge>
                          {!note.isRead && (note.recipientId === user?.uid || note.recipientId === "all") && (
                            <Badge variant="default">New</Badge>
                          )}
                        </div>
                        <CardDescription>
                          From: {note.senderName} → To: {note.recipientName}
                        </CardDescription>
                        <CardDescription className="text-xs">
                          {note.createdAt?.toDate?.()?.toLocaleString()}
                        </CardDescription>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {!note.isRead && (note.recipientId === user?.uid || note.recipientId === "all") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => markAsRead(note.id)}
                          >
                            Mark Read
                          </Button>
                        )}
                        {profile?.role === "admin" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteNote(note.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap">{note.message}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Subscriptions Tab - Admin Only */}
          {profile?.role === "admin" && (
            <TabsContent value="subscriptions" className="space-y-4">
              {subscriptions.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center text-muted-foreground">
                    No subscriptions tracked
                  </CardContent>
                </Card>
              ) : (
                subscriptions.map(sub => {
                  const now = new Date();
                  const deadlineDate = sub.deadline_date || sub.renewalDate;
                  const deadlineDateObj = deadlineDate?.toDate?.();
                  const daysLeft = deadlineDateObj ? Math.ceil((deadlineDateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
                  const isExpiringSoon = daysLeft <= 7;
                  
                  return (
                    <Card key={sub.id} className={isExpiringSoon && sub.isActive ? "border-destructive" : ""}>
                    <CardHeader>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle>{sub.name}</CardTitle>
                              <Badge variant={sub.isActive ? "default" : "secondary"}>
                                {sub.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {isExpiringSoon && sub.isActive && (
                                <Badge variant="destructive">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Expiring Soon
                                </Badge>
                              )}
                            </div>
                            <CardDescription>
                              Renewed: {sub.renewed_date ? sub.renewed_date.toDate().toLocaleDateString() : 'N/A'} |
                              Deadline: {deadlineDateObj?.toLocaleDateString()}
                            </CardDescription>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleSubscriptionStatus(sub.id, sub.isActive)}
                            >
                              {sub.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deleteSubscription(sub.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <CalendarIcon className="h-4 w-4" />
                              Renewed Date
                            </div>
                            <div className="text-lg font-semibold">
                              {sub.renewed_date ? sub.renewed_date.toDate().toLocaleDateString() : 'N/A'}
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <AlertTriangle className="h-4 w-4" />
                              Deadline Date
                            </div>
                            <div className="text-lg font-semibold">
                              {deadlineDateObj?.toLocaleDateString()}
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <DollarSign className="h-4 w-4" />
                              Cost
                            </div>
                            <div className="text-lg font-semibold">${sub.cost}/mo</div>
                          </div>
                        </div>
                        <div className="mt-4 pt-4 border-t">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Bell className="h-4 w-4" />
                            Days Left Until Deadline
                          </div>
                          <div className={`text-lg font-semibold ${daysLeft <= 3 ? 'text-destructive' : daysLeft <= 7 ? 'text-yellow-600' : ''}`}>
                            {daysLeft > 0 ? `${daysLeft} days` : 'Expired'}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}
