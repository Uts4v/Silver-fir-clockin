import {
  addDoc, collection, doc, getDoc, query, where, getDocs, Timestamp,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";

export interface AppNotification {
  id: string;
  type: "leave_request" | "leave_update" | "note";
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: Timestamp;
}

const notifyUser = async (uid: string, data: Omit<AppNotification, "id" | "read" | "createdAt">) => {
  try {
    await addDoc(collection(db, "notifications", uid, "items"), {
      ...data,
      read: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  } catch (e) {
    console.warn("notifyUser failed for", uid, e);
  }
};

// Admins of a company. Uses companies/{id}.adminUids (maintained on role changes)
// so that employees can resolve admins without needing to list the users collection.
const getCompanyAdmins = async (companyId: string): Promise<string[]> => {
  try {
    const snap = await getDoc(doc(db, "companies", companyId));
    if (!snap.exists()) return [];
    const data = snap.data() as { adminUid?: string; adminUids?: string[] };
    const uids = data.adminUids && data.adminUids.length ? data.adminUids : (data.adminUid ? [data.adminUid] : []);
    return uids;
  } catch (e) {
    console.warn("getCompanyAdmins failed:", e);
    return [];
  }
};

const getCompanyUserUids = async (companyId: string): Promise<string[]> => {
  try {
    const snap = await getDocs(query(collection(db, "users"), where("companyId", "==", companyId)));
    return snap.docs.map(d => d.id);
  } catch (e) {
    console.warn("getCompanyUserUids failed:", e);
    return [];
  }
};

export const notifyLeaveSubmitted = async (input: {
  companyId: string;
  employeeName: string;
  dates: string;
  reason: string;
}) => {
  const admins = await getCompanyAdmins(input.companyId);
  await Promise.all(admins.map(uid => notifyUser(uid, {
    type: "leave_request",
    title: `New leave request from ${input.employeeName}`,
    message: `${input.dates} — ${input.reason}`,
    link: "/leaves",
  })));
};

export const notifyLeaveReviewed = async (input: {
  employeeId: string;
  status: "approved" | "rejected";
  reviewerName?: string;
  dates: string;
}) => {
  await notifyUser(input.employeeId, {
    type: "leave_update",
    title: `Leave ${input.status}`,
    message: `${input.reviewerName ? input.reviewerName + ": " : ""}Your leave request for ${input.dates} was ${input.status}.`,
    link: "/leaves",
  });
};

export const notifyNoteSent = async (input: {
  recipientId: string;
  companyId?: string;
  senderName: string;
  subject: string;
}) => {
  const recipients = input.recipientId === "all"
    ? (input.companyId ? await getCompanyUserUids(input.companyId) : [])
    : [input.recipientId];
  await Promise.all(recipients.map(uid => notifyUser(uid, {
    type: "note",
    title: `New note from ${input.senderName}`,
    message: input.subject,
    link: "/notes",
  })));
};