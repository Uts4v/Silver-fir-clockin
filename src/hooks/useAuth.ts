import { useState, useEffect, useCallback } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile as firebaseUpdateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword as firebaseUpdatePassword,
  User as FirebaseUser,
  UserCredential
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
  DocumentData
} from "firebase/firestore";
import { auth, db } from "@/integrations/firebase/client";

export interface Profile {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  designation: string;
  avatarUrl?: string;
  teaPoints: number;
  role: "admin" | "user";
  companyId?: string;
  companyName?: string;
  department?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RegisterCompanyInput {
  companyName: string;
  username: string;
  inviteCode: string;
  adminFullName: string;
  email: string;
  password: string;
  department?: string;
}

export interface JoinCompanyInput {
  companyKey: string;
  fullName: string;
  email: string;
  password: string;
  department?: string;
}

export const useAuth = () => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const profileDoc = await getDoc(doc(db, "users", userId));
      if (profileDoc.exists()) {
        return profileDoc.data() as Profile;
      }
      return null;
    } catch (error) {
      console.error("Error fetching profile:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        const profile = await fetchProfile(firebaseUser.uid);
        setProfile(profile);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchProfile]);

  const findCompanyByKey = useCallback(async (key: string) => {
    const normalized = key.trim().toLowerCase();
    if (!normalized) return null;

    const byUsername = query(
      collection(db, "companies"),
      where("username", "==", normalized)
    );
    let snap = await getDocs(byUsername);
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() } as DocumentData & { id: string };

    const byCode = query(
      collection(db, "companies"),
      where("inviteCode", "==", normalized)
    );
    snap = await getDocs(byCode);
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() } as DocumentData & { id: string };

    return null;
  }, []);

  // Registers a new company. The company owner becomes the main admin.
  const registerCompany = async (input: RegisterCompanyInput) => {
    const companyName = input.companyName.trim();
    const username = input.username.trim().toLowerCase();
    const inviteCode = input.inviteCode.trim();

    if (!companyName || !username || !inviteCode) {
      return { data: null, error: new Error("Company name, username and invite code are required.") };
    }

    try {
      const userCredential: UserCredential = await createUserWithEmailAndPassword(auth, input.email, input.password);

      await firebaseUpdateProfile(userCredential.user, {
        displayName: input.adminFullName,
      });

      const uid = userCredential.user.uid;

      const profileData: Profile = {
        id: uid,
        userId: uid,
        fullName: input.adminFullName.trim(),
        email: input.email,
        designation: "Company Admin",
        teaPoints: 0,
        role: "admin",
        companyName,
        department: input.department?.trim() || undefined,
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
      };

      await setDoc(doc(db, "users", uid), profileData);

      const companyRef = await addDoc(collection(db, "companies"), {
        name: companyName,
        username,
        inviteCode,
        adminUid: uid,
        radiusMeters: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "users", uid), { companyId: companyRef.id });

      return { data: { companyId: companyRef.id, userCredential }, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  // Joins an existing company using its username or invite code.
  const signUp = async (input: JoinCompanyInput) => {
    try {
      const company = await findCompanyByKey(input.companyKey);
      if (!company) {
        return { data: null, error: new Error("Invalid company username or invite code.") };
      }

      const userCredential: UserCredential = await createUserWithEmailAndPassword(auth, input.email, input.password);

      await firebaseUpdateProfile(userCredential.user, {
        displayName: input.fullName,
      });

      const profileData: Profile = {
        id: userCredential.user.uid,
        userId: userCredential.user.uid,
        fullName: input.fullName.trim(),
        email: input.email,
        designation: "Employee",
        teaPoints: 0,
        role: "user",
        companyId: company.id,
        companyName: company.name,
        department: input.department?.trim() || undefined,
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
      };

      await setDoc(doc(db, "users", userCredential.user.uid), profileData);

      return { data: userCredential, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const userCredential: UserCredential = await signInWithEmailAndPassword(auth, email, password);
      return { data: userCredential, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
      setProfile(null);
      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!user) return { error: new Error("No user logged in") };

    try {
      const credential = EmailAuthProvider.credential(user.email || "", currentPassword);
      await reauthenticateWithCredential(user, credential);
      await firebaseUpdatePassword(user, newPassword);
      return { data: true, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return { error: new Error("No user logged in") };

    try {
      const updateData: Partial<Profile> = {
        ...updates,
        updatedAt: serverTimestamp() as Timestamp,
      };

      await updateDoc(doc(db, "users", user.uid), updateData);

      // Update local state
      const currentProfile = profile;
      if (currentProfile) {
        setProfile({ ...currentProfile, ...updates });
      }

      return { data: { ...profile, ...updates }, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  return {
    user,
    session: null, // Firebase doesn't have sessions like Supabase
    profile,
    loading,
    registerCompany,
    signUp,
    signIn,
    signOut,
    changePassword,
    updateProfile,
    refetchProfile: () => user && fetchProfile(user.uid).then(setProfile),
  };
};