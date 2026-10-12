import {
  collection, doc, setDoc, writeBatch, getDoc, getDocs, query, where, Timestamp,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";

export type NotificationType = "leave_request" | "leave_update" | "note";

/** A recipient's own copy of a notification, at
 *  notifications/{uid}/items/{notificationId}. */
export interface AppNotification {
  id: string; // == notificationId
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  companyId: string;
  senderId: string;
  senderName: string;
  read: boolean;
  readAt?: Timestamp;
  createdAt: Timestamp;
}

/** The single canonical record of one send, at sentNotifications/{notificationId}.
 *  Holds the recipient list and the read receipts, so an admin can report
 *  "X of Y read" without reading every recipient's inbox. */
export interface SentNotification {
  id: string;
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  companyId: string;
  senderId: string;
  senderName: string;
  recipientIds: string[];
  /** uid -> timestamp the recipient opened it */
  readBy: Record<string, Timestamp>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** How many recipients have opened a send. Derived from the readBy map so it can
 *  never drift from reality — no denormalised counter to keep in sync. */
export const readCountOf = (sent: { readBy?: Record<string, unknown> }): number =>
  sent.readBy ? Object.keys(sent.readBy).length : 0;

/** Record a read receipt. The recipient's own flag and the canonical readBy map
 *  are written together so the admin count and the inbox badge always agree. */
export const recordRead = async (input: {
  uid: string;
  notificationId: string;
  companyId: string;
}) => {
  const { uid, notificationId, companyId } = input;
  const now = Timestamp.now();
  const batch = writeBatch(db);

  batch.set(
    doc(db, "notifications", uid, "items", notificationId),
    { read: true, readAt: now, updatedAt: now },
    { merge: true }
  );
  // Field-path write so we only ever add/refresh our own receipt key.
  // Existence is checked first: notifications sent before this schema existed
  // have no canonical doc, and a blind `merge` would resurrect one as a stub
  // row (no title, 0/0 read) in the admin Sent list.
  const canonical = await getDoc(doc(db, "sentNotifications", notificationId));
  if (canonical.exists()) {
    batch.set(
      doc(db, "sentNotifications", notificationId),
      {
        [`readBy.${uid}`]: now,
        // Only restate companyId when we actually have it; writing "" would
        // wipe a correct value and lock the admin out of the doc's own rules.
        ...(companyId ? { companyId } : {}),
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
};

/** Fan a notification out to recipients. Writes the canonical send doc plus one
 *  item per recipient, chunked to stay under Firestore's 500-op batch limit. */
const dispatch = async (input: {
  recipients: string[];
  companyId: string;
  senderId: string;
  senderName: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  /** Pass an ID to make this send correlate with an existing doc (e.g. a note). */
  notificationId?: string;
}) => {
  const now = Timestamp.now();
  const notificationId =
    input.notificationId ?? doc(collection(db, "sentNotifications")).id;
  const uniqueRecipients = Array.from(new Set(input.recipients)).filter(Boolean);

  // The canonical record. Created even with no recipients so the admin still
  // sees that the send happened.
  await setDoc(
    doc(db, "sentNotifications", notificationId),
    {
      notificationId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      companyId: input.companyId,
      senderId: input.senderId,
      senderName: input.senderName,
      recipientIds: uniqueRecipients,
      readBy: {},
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // 490 leaves room for the batch commit's own overhead.
  const CHUNK = 490;
  for (let i = 0; i < uniqueRecipients.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const uid of uniqueRecipients.slice(i, i + CHUNK)) {
      batch.set(
        doc(db, "notifications", uid, "items", notificationId),
        {
          notificationId,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link ?? null,
          companyId: input.companyId,
          senderId: input.senderId,
          senderName: input.senderName,
          read: false,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  return notificationId;
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
  senderId: string;
  senderName: string;
  employeeName: string;
  dates: string;
  reason: string;
}) => {
  const admins = await getCompanyAdmins(input.companyId);
  await dispatch({
    recipients: admins,
    companyId: input.companyId,
    senderId: input.senderId,
    senderName: input.senderName,
    type: "leave_request",
    title: `New leave request from ${input.employeeName}`,
    message: `${input.dates} — ${input.reason}`,
    link: "/leaves",
  });
};

export const notifyLeaveReviewed = async (input: {
  companyId: string;
  senderId: string;
  senderName: string;
  employeeId: string;
  status: "approved" | "rejected";
  reviewerName?: string;
  dates: string;
}) => {
  await dispatch({
    recipients: [input.employeeId],
    companyId: input.companyId,
    senderId: input.senderId,
    senderName: input.senderName,
    type: "leave_update",
    title: `Leave ${input.status}`,
    message: `${input.reviewerName ? input.reviewerName + ": " : ""}Your leave request for ${input.dates} was ${input.status}.`,
    link: "/leaves",
  });
};

export const notifyNoteSent = async (input: {
  recipientId: string;
  companyId?: string;
  senderId: string;
  senderName: string;
  subject: string;
  /** The note doc this send represents, so note reads roll up into the same
   *  canonical readBy map the admin counts. */
  notificationId?: string;
}) => {
  if (!input.companyId) return;
  const recipients =
    input.recipientId === "all"
      ? await getCompanyUserUids(input.companyId)
      : [input.recipientId];
  await dispatch({
    recipients,
    companyId: input.companyId,
    senderId: input.senderId,
    senderName: input.senderName,
    type: "note",
    title: `New note from ${input.senderName}`,
    message: input.subject,
    link: "/notes",
    notificationId: input.notificationId,
  });
};