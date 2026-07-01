import * as React from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider as QCP } from "@tanstack/react-query";
import { BrowserRouter as BR, Routes as R, Route, Navigate as Nav, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AccountFilterProvider } from "@/contexts/AccountFilterContext";
import { LiveTradesProvider } from "@/contexts/LiveTradesContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Journal from "./pages/Journal";
import Import from "./pages/Import";
import Playbooks from "./pages/Playbooks";
import Accounts from "./pages/Accounts";
import LiveTrades from "./pages/LiveTrades";
import Copier from "./pages/Copier";
import CopierConsole from "./pages/CopierConsole";

import SharedReports from "./pages/SharedReports";
import SharedReportEditor from "./pages/SharedReportEditor";
import PublicReport from "./pages/PublicReport";
import Knowledge from "./pages/Knowledge";
import PairLab from "./pages/PairLab";
import Coach from "./pages/Coach";
import { CoachProvider } from "@/contexts/CoachContext";
import { CoachFab } from "@/components/coach/CoachFab";
import { CoachPanel } from "@/components/coach/CoachPanel";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Most data is per-user and changes infrequently; one-minute freshness
      // kills the bulk of redundant refetches when navigating between pages.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const QueryClientProvider = QCP;
const BrowserRouter = BR;
const Routes = R;
const Navigate = Nav;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <AppLayout>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppLayout>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/dashboard" replace /> : <Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/analytics" element={<Navigate to="/reports" replace />} />
      <Route path="/journal" element={<ProtectedRoute><LiveTradesProvider><Journal /></LiveTradesProvider></ProtectedRoute>} />
      <Route path="/live-trades" element={<ProtectedRoute><LiveTradesProvider><LiveTrades /></LiveTradesProvider></ProtectedRoute>} />
      <Route path="/playbooks" element={<ProtectedRoute><Playbooks /></ProtectedRoute>} />
      <Route path="/pair-lab" element={<ProtectedRoute><PairLab /></ProtectedRoute>} />
      <Route path="/copier" element={<ProtectedRoute><Copier /></ProtectedRoute>} />
      <Route path="/copier/console" element={<ProtectedRoute><CopierConsole /></ProtectedRoute>} />
      
      <Route path="/shared-reports" element={<ProtectedRoute><SharedReports /></ProtectedRoute>} />
      <Route path="/shared-reports/:id" element={<ProtectedRoute><SharedReportEditor /></ProtectedRoute>} />
      <Route path="/knowledge" element={<ProtectedRoute><Knowledge /></ProtectedRoute>} />
      <Route path="/r/:slug" element={<PublicReport />} />
      <Route path="/import" element={<ProtectedRoute><Import /></ProtectedRoute>} />
      <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
      <Route path="/coach" element={<ProtectedRoute><Coach /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccountFilterProvider>
            <TooltipProvider>
              <Sonner />
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </TooltipProvider>
          </AccountFilterProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
