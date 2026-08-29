import { Timestamp } from "firebase/firestore";

// Firebase Auth types
export interface FirebaseUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

// Profile document (stored in users/{userId})
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

// Company document (stored in companies/{companyId})
export interface OfficeLocation {
  lat: number;
  lng: number;
  label: string;
  fullAddress?: string;
  city?: string;
  country?: string;
  capturedAt?: string;
}

export interface Company {
  id: string;
  name: string;
  username: string;
  inviteCode: string;
  adminUid: string;
  logoUrl?: string;
  officeLocation?: OfficeLocation;
  radiusMeters?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Leave request document (stored in leaveRequests/{leaveRequestId})
export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  department?: string;
  companyId?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Work session document (stored in users/{userId}/sessions/{sessionId})
export interface ClockInLocation {
  lat: number;
  lng: number;
  accuracy: number; // metres
  label: string;      // human-readable address
  fullAddress: string;
  city: string;
  country: string;
  capturedAt: string; // ISO timestamp when location was captured
  distanceMeters?: number; // distance from configured office location
  inRadius?: boolean;      // whether the fix was inside the configured geo-fence
}

export interface WorkSession {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD format
  workStartTime?: Timestamp;
  workEndTime?: Timestamp;
  totalWorkDuration: number; // in seconds
  totalBreakDuration: number; // in seconds
  status: "idle" | "working" | "break" | "completed";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // optional location data recorded at clock-in
  clockInLocation?: ClockInLocation;
}

// Break log document (stored in users/{userId}/sessions/{sessionId}/breaks/{breakId})
export interface BreakLog {
  id: string;
  sessionId: string;
  userId: string;
  breakStart: Timestamp;
  breakEnd?: Timestamp;
  createdAt: Timestamp;
}

// Timer status type
export type TimerStatus = "idle" | "working" | "break" | "completed";