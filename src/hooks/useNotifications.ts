import { useState, useEffect, useCallback } from "react";
import { collection, query, orderBy, limit, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { AppNotification, recordRead } from "@/integrations/notifications";
import { useAuthContext } from "@/contexts/AuthContext";

export const useNotifications = () => {
  const { user, profile } = useAuthContext();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Must return: without it `user.uid` below throws while signed out.
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "notifications", user.uid, "items"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification)));
      setLoading(false);
    }, (err) => {
      console.warn("notifications listener error:", err);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  // Flags the item read locally and records the receipt the admin counts.
  const markRead = useCallback(async (n: AppNotification) => {
    if (!user || n.read) return;
    const id = n.notificationId || n.id;
    // Optimistic so the dropdown feels instant; the receipt write follows.
    setItems(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    try {
      await recordRead({
        uid: user.uid,
        notificationId: id,
        companyId: n.companyId || profile?.companyId || "",
      });
    } catch (e) {
      console.warn("markRead failed:", e);
      // Fall back to the per-recipient flag so the badge is still correct even
      // if the shared receipt could not be written.
      try {
        await updateDoc(doc(db, "notifications", user.uid, "items", n.id), { read: true });
      } catch (inner) {
        console.warn("markRead fallback failed:", inner);
      }
    }
  }, [user, profile?.companyId]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const unread = items.filter(n => !n.read);
    if (unread.length === 0) return;
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    await Promise.allSettled(unread.map(n => markRead(n)));
  }, [user, items, markRead]);

  const unread = items.filter(n => !n.read).length;

  return { items, unread, loading, markRead, markAllRead };
};