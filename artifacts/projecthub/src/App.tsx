import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation, Redirect } from 'wouter';
import { AppLayout } from '@/components/layout/AppLayout';
import { isTeamAuthenticated, isTeamAdmin, clearTeamAuth, canView } from '@/lib/team-auth';
import type { PageSlug } from '@/lib/team-auth';
import { useEffect } from 'react';
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import ForgotPasswordPage from '@/pages/forgot-password';
import ResetPasswordPage from '@/pages/reset-password';
import Dashboard from '@/pages/dashboard';
import Projects from '@/pages/projects';
import ProjectDetail from '@/pages/project-detail';
import Tasks from '@/pages/tasks';
import Team from '@/pages/team';
import AiMonitor from '@/pages/ai-monitor';
import ImpactPage from '@/pages/impact';
import AlisonFeedbackPage from '@/pages/alison-feedback';
import Contacts from '@/pages/contacts';
import Notifications from '@/pages/notifications';
import SystemStatus from '@/pages/system-status';
import MonitoringPage from '@/pages/monitoring';
import WebhookTester from '@/pages/webhook-tester';
import OrdersPage from '@/pages/orders';
import TicketsPage from '@/pages/tickets';
import WaterTestsPage from '@/pages/water-tests';
import UcNotificationFailuresPage from '@/pages/uc-notification-failures';
import LibraryPage from '@/pages/library';
import AdminUsersPage from '@/pages/admin/users';
import AdminPaymentSettingsPage from '@/pages/admin/payment-settings';
import AdminNotificationSettingsPage from '@/pages/admin/notification-settings';
import AdminInventoryPage from '@/pages/admin/inventory';
import AdminIntegrationsPage from '@/pages/admin/integrations';
import AdminRewardsPage from '@/pages/admin/rewards';
import AdminCustomersPage from '@/pages/admin/customers';
import AdminUnsyncedRegistrationsPage from '@/pages/admin/unsynced-registrations';
import AdminReferralsPage from '@/pages/admin/referrals';

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  useEffect(() => {
    const onUnauthorized = () => {
      clearTeamAuth();
      navigate(`/login?next=${encodeURIComponent(location)}`, { replace: true });
    };
    window.addEventListener('projecthub:unauthorized', onUnauthorized);
    return () => window.removeEventListener('projecthub:unauthorized', onUnauthorized);
  }, [location, navigate]);
  if (!isTeamAuthenticated()) return <Redirect to={`/login?next=${encodeURIComponent(location)}`} />;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  return isTeamAdmin() ? <>{children}</> : <Redirect to="/" />;
}

function PageGuard({ page, children }: { page: PageSlug; children: React.ReactNode }) {
  if (canView(page)) return <>{children}</>;
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <p className="text-lg font-semibold">Access restricted</p>
      <p className="text-sm text-muted-foreground max-w-xs">You don't have permission to view this page. Ask an admin to grant you access.</p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route>
        <AuthGuard>
          <AppLayout>
            <Switch>
              <Route path="/"><PageGuard page="dashboard"><Dashboard /></PageGuard></Route>
              <Route path="/projects"><PageGuard page="projects"><Projects /></PageGuard></Route>
              <Route path="/projects/:id"><PageGuard page="projects"><ProjectDetail /></PageGuard></Route>
              <Route path="/tasks"><PageGuard page="tasks"><Tasks /></PageGuard></Route>
              <Route path="/team"><PageGuard page="team"><Team /></PageGuard></Route>
              <Route path="/ai-monitor"><PageGuard page="ai-monitor"><AiMonitor /></PageGuard></Route>
              <Route path="/impact"><PageGuard page="impact"><ImpactPage /></PageGuard></Route>
              <Route path="/alison-feedback"><PageGuard page="alison-feedback"><AlisonFeedbackPage /></PageGuard></Route>
              <Route path="/contacts"><PageGuard page="contacts"><Contacts /></PageGuard></Route>
              <Route path="/notifications"><PageGuard page="notifications"><Notifications /></PageGuard></Route>
              <Route path="/system"><PageGuard page="system"><SystemStatus /></PageGuard></Route>
              <Route path="/monitoring"><PageGuard page="monitoring"><MonitoringPage /></PageGuard></Route>
              <Route path="/webhook"><PageGuard page="webhook"><WebhookTester /></PageGuard></Route>
              <Route path="/orders"><PageGuard page="orders"><OrdersPage /></PageGuard></Route>
              <Route path="/tickets"><PageGuard page="tickets"><TicketsPage /></PageGuard></Route>
              <Route path="/water-tests"><PageGuard page="water-tests"><WaterTestsPage /></PageGuard></Route>
              <Route path="/uc-notifications"><PageGuard page="uc-notifications"><UcNotificationFailuresPage /></PageGuard></Route>
              <Route path="/library"><PageGuard page="library"><LibraryPage /></PageGuard></Route>
              <Route path="/admin/users"><AdminGuard><AdminUsersPage /></AdminGuard></Route>
              <Route path="/admin/payment-settings"><AdminGuard><AdminPaymentSettingsPage /></AdminGuard></Route>
              <Route path="/admin/notification-settings"><AdminGuard><AdminNotificationSettingsPage /></AdminGuard></Route>
              <Route path="/admin/inventory"><AdminGuard><AdminInventoryPage /></AdminGuard></Route>
              <Route path="/admin/integrations"><AdminGuard><AdminIntegrationsPage /></AdminGuard></Route>
              <Route path="/admin/rewards"><AdminGuard><AdminRewardsPage /></AdminGuard></Route>
              <Route path="/admin/customers"><AdminGuard><AdminCustomersPage /></AdminGuard></Route>
              <Route path="/admin/unsynced-registrations"><AdminGuard><AdminUnsyncedRegistrationsPage /></AdminGuard></Route>
              <Route path="/admin/referrals"><AdminGuard><AdminReferralsPage /></AdminGuard></Route>
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}