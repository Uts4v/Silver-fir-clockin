import { createContext, useContext, ReactNode } from "react";
import {
  useAuth,
  Profile,
  RegisterCompanyInput,
  JoinCompanyInput,
} from "@/hooks/useAuth";
import type { User as FirebaseUser } from "firebase/auth";

type AuthResult = { data?: unknown; error?: unknown };

interface AuthContextType {
  user: FirebaseUser | null;
  session: null; // Firebase doesn't have sessions like Supabase
  profile: Profile | null;
  loading: boolean;
  registerCompany: (input: RegisterCompanyInput) => Promise<AuthResult>;
  signUp: (input: JoinCompanyInput) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  updateProfile: (updates: Partial<Profile>) => Promise<AuthResult>;
  refetchProfile: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
};