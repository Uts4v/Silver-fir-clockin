// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCtztRa_6d6q1uhdylsnZgcYMeYzXYrFIY",
  authDomain: "proof-of-grind.firebaseapp.com",
  projectId: "proof-of-grind",
  storageBucket: "proof-of-grind.firebasestorage.app",
  messagingSenderId: "367030230553",
  appId: "1:367030230553:web:86492bec143627ee151488",
  measurementId: "G-5SBZMJZKQP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Export the app for potential future use
export default app;