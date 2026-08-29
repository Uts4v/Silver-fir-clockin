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
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import History from "./pages/History";
import Admin from "./pages/Admin";
import LeaveRequests from "./pages/LeaveRequests";
import NotFound from "./pages/NotFound";
import NotesSubscriptionsManager from "./pages/NotesSubscriptionsManager";
import { InstallBanner } from "@/components/InstallApp";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="system" storageKey="tea-tracker-theme">
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <InstallBanner />
          <BrowserRouter>
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
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;