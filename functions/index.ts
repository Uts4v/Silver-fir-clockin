// src/integration/firebase/index.ts

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

// ──────────────────────────────────────────────────────────────
// Firebase Configuration
// Best: Load from environment variables in production
// ──────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCtztRa_6d6q1uhdylsnZgcYMeYzXYrFIY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "proof-of-grind.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "proof-of-grind",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "proof-of-grind.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "367030230553",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:367030230553:web:86492bec143627ee151488",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-5SBZMJZKQP",
};

// ──────────────────────────────────────────────────────────────
// Initialize Firebase (singleton pattern)
// ──────────────────────────────────────────────────────────────
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// ──────────────────────────────────────────────────────────────
// Services
// ──────────────────────────────────────────────────────────────
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Analytics (lazy-loaded, only if supported)
export let analytics: ReturnType<typeof getAnalytics> | null = null;
isSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
  }
});

// ──────────────────────────────────────────────────────────────
// Local Emulator Support (uncomment when running emulators)
// ──────────────────────────────────────────────────────────────
// if (import.meta.env.DEV) {
//   connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
//   connectFirestoreEmulator(db, "127.0.0.1", 8080);
//   connectStorageEmulator(storage, "127.0.0.1", 9199);
//   console.log("[Firebase] Connected to local emulators");
// }

// ──────────────────────────────────────────────────────────────
// Exports for convenience / type safety
// ──────────────────────────────────────────────────────────────
export { app };

// Re-export common types (optional but very helpful)
export type {
  User,
  UserCredential,
  AuthError,
  IdTokenResult,
} from "firebase/auth";

export type {
  DocumentData,
  DocumentReference,
  CollectionReference,
  Query,
  QuerySnapshot,
  Timestamp,
  FirestoreError,
} from "firebase/firestore";

export type { FirebaseStorage, StorageReference, UploadTask } from "firebase/storage";