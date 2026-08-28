// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAhxhaY6JCPHs_m7HUFV7jdE9-qtZ4wAFo",
  authDomain: "silver-fir-clockin.firebaseapp.com",
  projectId: "silver-fir-clockin",
  storageBucket: "silver-fir-clockin.firebasestorage.app",
  messagingSenderId: "284910301648",
  appId: "1:284910301648:web:998eb9b04c650c51c549d5",
  measurementId: "G-63GJBRVY7P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Export the app for potential future use
export default app;