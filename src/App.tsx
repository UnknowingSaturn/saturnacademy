import * as React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider as QCP } from "@tanstack/react-query";
import { BrowserRouter as BR, Routes as R, Route, Navigate as Nav } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AccountFilterProvider } from "@/contexts/AccountFilterContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { withForwardRef } from "@/lib/withForwardRef";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Journal from "./pages/Journal";
import Playbooks from "./pages/Playbooks";
import Import from "./pages/Import";
import Accounts from "./pages/Accounts";
import LiveTrades from "./pages/LiveTrades";
import Copier from "./pages/Copier";
import NotFound from "./pages/NotFound";
import ResetPassword from "./pages/ResetPassword";

const queryClient = new QueryClient();

// Wrap external components to handle refs safely
const QueryClientProvider = withForwardRef(QCP, "QueryClientProvider");
const BrowserRouter = withForwardRef(BR, "BrowserRouter");
const Routes = withForwardRef(R, "Routes");
const Navigate = withForwardRef(Nav, "Navigate");

const ProtectedRoute = React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(
  function ProtectedRoute({ children }, _ref) {
    const { user, loading } = useAuth();
    
    if (loading) {
      return <div className="min-h-screen flex items-center justify-center bg-background">Loading...</div>;
    }
    
    if (!user) {
      return <Navigate to="/auth" replace />;
    }
    
    return <AppLayout>{children}</AppLayout>;
  }
);

const AppRoutes = React.forwardRef<HTMLDivElement, object>(
  function AppRoutes(_props, _ref) {
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
        <Route path="/journal" element={<ProtectedRoute><Journal /></ProtectedRoute>} />
        <Route path="/live-trades" element={<ProtectedRoute><LiveTrades /></ProtectedRoute>} />
        <Route path="/playbooks" element={<ProtectedRoute><Playbooks /></ProtectedRoute>} />
        <Route path="/copier" element={<ProtectedRoute><Copier /></ProtectedRoute>} />
        <Route path="/import" element={<ProtectedRoute><Import /></ProtectedRoute>} />
        <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }
);

const App = React.forwardRef<HTMLDivElement, object>(
  function App(_props, _ref) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccountFilterProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </TooltipProvider>
          </AccountFilterProvider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }
);

export default App;
