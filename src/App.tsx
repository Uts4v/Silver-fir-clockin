/*
 * © 2026 Utsav Shrestha. All rights reserved.
 * This software and its source code are the proprietary property of Utsav Shrestha.
 * No part of this code may be copied, reproduced, or distributed without 
 * express written permission.
 */
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { PresenceReporter } from "@/hooks/usePresence";
import { lazy, Suspense } from "react";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { InstallBanner } from "./components/InstallApp";

// Only the landing + auth screens load in the initial bundle. The admin console
// alone is ~1900 lines plus charts, maps and export code, so employees should
// never pay for it; each heavy route is fetched the first time it is opened.
const Profile = lazy(() => import("./pages/Profile"));
const History = lazy(() => import("./pages/History"));
const Admin = lazy(() => import("./pages/Admin"));
const LeaveRequests = lazy(() => import("./pages/LeaveRequests"));
const NotesSubscriptionsManager = lazy(() => import("./pages/NotesSubscriptionsManager"));

const queryClient = new QueryClient();

// Shown while a route chunk is in flight. Deliberately minimal so it paints
// instantly and does not shift layout.
const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-6 h-6 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="system" storageKey="tea-tracker-theme">
      <TooltipProvider>
        <AuthProvider>
          <PresenceReporter />
          <Toaster />
          <Sonner />
          <InstallBanner />
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/notes" element={<NotesSubscriptionsManager />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/history" element={<History />} />
                <Route path="/leaves" element={<LeaveRequests />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;