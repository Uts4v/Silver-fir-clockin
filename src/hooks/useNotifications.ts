import { useState, useEffect, useCallback } from "react";
import { collection, query, orderBy, limit, onSnapshot, updateDoc, doc } from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import { AppNotification } from "@/integrations/notifications";
import { useAuthContext } from "@/contexts/AuthContext";

export const useNotifications = () => {
  const { user } = useAuthContext();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
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

  const markRead = useCallback(async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "notifications", user.uid, "items", id), { read: true });
    } catch (e) {
      console.warn("markRead failed:", e);
    }
    setItems(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  }, [user]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const unread = items.filter(n => !n.read);
    await Promise.all(unread.map(n =>
      updateDoc(doc(db, "notifications", user.uid, "items", n.id), { read: true }).catch(() => {})
    ));
    setItems(prev => prev.map(n => ({ ...n, read: true })));
  }, [user, items]);

  const unread = items.filter(n => !n.read).length;

  return { items, unread, loading, markRead, markAllRead };
};