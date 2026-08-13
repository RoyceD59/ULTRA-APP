import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation, Redirect } from 'wouter';
import { AppLayout } from '@/components/layout/AppLayout';
import { isTeamAuthenticated, isTeamAdmin, clearTeamAuth, canView } from '@/lib/team-auth';
import type { PageSlug } from '@/lib/team-auth';
import { useEffect } from 'react';

// Public pages
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import ForgotPasswordPage from '@/pages/forgot-password';
import ResetPasswordPage from '@/pages/reset-password';

// Protected pages
import Dashboard from '@/pages/dashboard';
import Projects from '@/pages/projects';
import ProjectDetail from '@/pages/project-detail';
import Tasks from '@/pages/tasks';
import Team from '@/pages/team';
import AiMonitor from '@/pages/ai-monitor';
import ImpactPage from '@/pages/impact';
import AlisonFeedbackPage from '@/pages/alison-feedback';
// Team Horizon pages
import Contacts from '@/pages/contacts';
import Notifications from '@/pages/notifications';
import SystemStatus from '@/pages/system-status';
import WebhookTester from '@/pages/webhook-tester';
import OrdersPage from '@/pages/orders';
import UcNotificationFailuresPage from '@/pages/uc-notification-failures';
// Admin pages
import AdminUsersPage from '@/pages/admin/users';
import AdminPaymentSettingsPage from '@/pages/admin/payment-settings';

const queryClient = new QueryClient();

/** Redirects unauthenticated users to /login; fires on mid-session 401 events. */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();

  useEffect(() => {
    function onUnauthorized() {
      clearTeamAuth();
      const next = encodeURIComponent(location);
      navigate(`/login?next=${next}`, { replace: true });
    }
    window.addEventListener('projecthub:unauthorized', onUnauthorized);
    return () => window.removeEventListener('projecthub:unauthorized', onUnauthorized);
  }, [location, navigate]);

  if (!isTeamAuthenticated()) {
    const next = encodeURIComponent(location);
    return <Redirect to={`/login?next=${next}`} />;
  }

  return <>{children}</>;
}

/** Requires admin role in addition to authentication. */
function AdminGuard({ children }: { children: React.ReactNode }) {
  if (!isTeamAdmin()) return <Redirect to="/" />;
  return <>{children}</>;
}

/**
 * Guards a page by slug — admins always pass; members need at least "view" permission.
 * Falls back to dashboard when access is denied so members see something useful.
 */
function PageGuard({ page, children }: { page: PageSlug; children: React.ReactNode }) {
  if (!canView(page)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <p className="text-lg font-semibold">Access restricted</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          You don't have permission to view this page. Ask an admin to grant you access.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />

      {/* All other routes require authentication */}
      <Route>
        <AuthGuard>
          <AppLayout>
            <Switch>
              <Route path="/">
                <PageGuard page="dashboard"><Dashboard /></PageGuard>
              </Route>
              <Route path="/projects">
                <PageGuard page="projects"><Projects /></PageGuard>
              </Route>
              <Route path="/projects/:id">
                <PageGuard page="projects"><ProjectDetail /></PageGuard>
              </Route>
              <Route path="/tasks">
                <PageGuard page="tasks"><Tasks /></PageGuard>
              </Route>
              <Route path="/team">
                <PageGuard page="team"><Team /></PageGuard>
              </Route>
              <Route path="/ai-monitor">
                <PageGuard page="ai-monitor"><AiMonitor /></PageGuard>
              </Route>
              <Route path="/impact">
                <PageGuard page="impact"><ImpactPage /></PageGuard>
              </Route>
              <Route path="/alison-feedback">
                <PageGuard page="alison-feedback"><AlisonFeedbackPage /></PageGuard>
              </Route>
              <Route path="/contacts">
                <PageGuard page="contacts"><Contacts /></PageGuard>
              </Route>
              <Route path="/notifications">
                <PageGuard page="notifications"><Notifications /></PageGuard>
              </Route>
              <Route path="/system">
                <PageGuard page="system"><SystemStatus /></PageGuard>
              </Route>
              <Route path="/webhook">
                <PageGuard page="webhook"><WebhookTester /></PageGuard>
              </Route>
              <Route path="/orders">
                <PageGuard page="orders"><OrdersPage /></PageGuard>
              </Route>
              <Route path="/uc-notifications">
                <PageGuard page="uc-notifications"><UcNotificationFailuresPage /></PageGuard>
              </Route>
              {/* Admin-only */}
              <Route path="/admin/users">
                <AdminGuard><AdminUsersPage /></AdminGuard>
              </Route>
              <Route path="/admin/payment-settings">
                <AdminGuard><AdminPaymentSettingsPage /></AdminGuard>
              </Route>
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
