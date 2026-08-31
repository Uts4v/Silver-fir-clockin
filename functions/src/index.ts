import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

admin.initializeApp();

// Allows an authenticated company admin to set a new password for an employee
// in their company, without knowing the employee's current password. This uses
// the Firebase Admin SDK, so it overrides the normal "must know current
// password" client-side requirement. Works for email and phone accounts alike.
export const resetUserPassword = onCall(
  { cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    // Only admins may reset passwords.
    const callerSnap = await admin.firestore().doc(`users/${uid}`).get();
    const caller = callerSnap.data();
    if (!callerSnap.exists || caller?.role !== "admin") {
      throw new HttpsError("permission-denied", "Only a company admin can reset passwords.");
    }

    const targetUid = request.data?.uid;
    const newPassword = request.data?.newPassword;
    if (typeof targetUid !== "string" || !targetUid) {
      throw new HttpsError("invalid-argument", "A target user is required.");
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "New password must be at least 6 characters."
      );
    }

    // The target must belong to the same company as the admin caller.
    const targetSnap = await admin.firestore().doc(`users/${targetUid}`).get();
    const target = targetSnap.data();
    if (!targetSnap.exists || target?.companyId !== caller?.companyId) {
      throw new HttpsError("not-found", "Employee not found in your company.");
    }

    await admin.auth().updateUser(targetUid, { password: newPassword });
    return { ok: true };
  }
);
