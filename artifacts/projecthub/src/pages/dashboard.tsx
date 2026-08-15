import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetDashboardSummary, useGetDashboardActivity } from "@workspace/api-client-react";
import { FolderKanban, CheckSquare, Clock, AlertTriangle, Activity, TimerOff, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { TaskStatusBadge, formatRelativeDate } from "@/components/shared/badges";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/team-auth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LifespanAuditProduct {
  id: number;
  name: string;
  sku: string;
  categories: string[];
  /** Number of times this product has been alerted; null if never alerted yet. */
  alertCount: number | null;
  /** ISO timestamp when the meta was last fixed; null if still unresolved. */
  resolvedAt: string | null;
}

interface LifespanAudit {
  source: string;
  checkedAt: string;
  checkedCount: number;
  missing: LifespanAuditProduct[];
}

/**
 * Small stat card showing total registered UC Companion app customers.
 * Visible to all logged-in team members; silently hidden on auth error.
 */
function UcCustomerCountCard() {
  const { data, isLoading } = useQuery<{ count: number } | null>({
    queryKey: ["uc-customers-count"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const headers = getAuthHeaders();
      if (!headers) return null;
      const res = await fetch(`${BASE}/api/uc/admin/customers/count`, { headers });
      if (!res.ok) return null;
      return res.json();
    },
  });

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow border-blue-500/20">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">Registered Customers</CardTitle>
        <Users className="w-4 h-4 text-blue-500" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-9 w-16 bg-muted rounded animate-pulse" />
        ) : (
          <>
            <div className="text-3xl font-bold text-foreground">
              {data?.count ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">UC Companion app sign-ups</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Warns the team when live store products lack the filter_lifespan_days meta —
 * those products ship without replacement reminders. Admin-only endpoint:
 * non-admin members get a 403 and the card simply stays hidden.
 */
export function LifespanAuditWarning() {
  const { data } = useQuery<LifespanAudit | null>({
    queryKey: ["uc-lifespan-audit"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const headers = getAuthHeaders();
      if (!headers) return null;
      const res = await fetch(`${BASE}/api/uc/admin/products/lifespan-audit`, { headers });
      if (!res.ok) return null; // 403 (non-admin) or store unreachable — stay quiet
      return res.json();
    },
  });

  if (!data || data.missing.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <TimerOff className="w-4 h-4" />
          {data.missing.length} store product{data.missing.length > 1 ? "s" : ""} missing a filter lifespan
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          These live products have no <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">filter_lifespan_days</code> meta
          on ucfilters.com, so customers who buy them will never get a replacement reminder.
          Add the meta value in WooCommerce to fix this.
        </p>
        <ul className="space-y-1.5">
          {data.missing.map((p) => {
            const isRepeat = (p.alertCount ?? 0) > 1;
            return (
              <li key={p.id} className="text-sm flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{p.name}</span>
                {p.sku && (
                  <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{p.sku}</span>
                )}
                {isRepeat && (
                  <Badge variant="destructive" className="text-xs px-1.5 py-0 h-5">
                    ⚠ alerted {p.alertCount}×
                  </Badge>
                )}
                {p.categories.length > 0 && (
                  <span className="text-xs text-muted-foreground">{p.categories.join(", ")}</span>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: activity, isLoading: isActivityLoading } = useGetDashboardActivity({ limit: 10 });

  if (isSummaryLoading || isActivityLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 bg-muted rounded-md animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted rounded-lg animate-pulse"></div>)}
        </div>
      </div>
    );
  }

  if (!summary) return <div>Failed to load dashboard.</div>;

  const totalTasks = summary.totalTasks || 1; // prevent div by 0
  const completedTasks = summary.statusBreakdown['done'] || 0;
  const progressPercent = Math.round((completedTasks / totalTasks) * 100);

  return (
    <div className="space-y-8 animate-in-up">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Good morning, Team.</h1>
        <p className="text-muted-foreground mt-1 text-lg">Here's what's happening across your projects today.</p>
      </div>

      <LifespanAuditWarning />

      {/* UC Companion snapshot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <UcCustomerCountCard />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="stagger-1 border-primary/20 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Projects</CardTitle>
            <FolderKanban className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{summary.activeProjects}</div>
            <p className="text-xs text-muted-foreground mt-1">Out of {summary.totalProjects} total</p>
          </CardContent>
        </Card>

        <Card className="stagger-2 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasks Due This Week</CardTitle>
            <Clock className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{summary.tasksDueThisWeek}</div>
            <p className="text-xs text-muted-foreground mt-1">Stay on track</p>
          </CardContent>
        </Card>

        <Card className="stagger-3 shadow-sm hover:shadow-md transition-shadow border-destructive/20 bg-destructive/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-destructive">Overdue Tasks</CardTitle>
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{summary.overdueTasks}</div>
            <p className="text-xs text-destructive/80 mt-1">Needs attention</p>
          </CardContent>
        </Card>

        <Card className="stagger-4 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Global Progress</CardTitle>
            <CheckSquare className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{progressPercent}%</div>
            <Progress value={progressPercent} className="h-2 mt-3" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4 stagger-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Recent Activity
            </h2>
            <Link href="/tasks" className="text-sm text-primary hover:underline font-medium">View all tasks</Link>
          </div>
          <Card className="shadow-sm">
            <div className="divide-y border-t-0">
              {!activity?.length && (
                <div className="p-8 text-center text-muted-foreground">No recent activity</div>
              )}
              {activity?.map((item) => (
                <div key={`${item.taskId}-${item.updatedAt}`} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground text-sm flex items-center gap-2">
                      <Link href={`/projects/${item.projectId}`} className="hover:underline hover:text-primary transition-colors">
                        {item.taskTitle}
                      </Link>
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{item.projectName}</span>
                      <span>•</span>
                      <span>{item.assigneeName || 'Unassigned'}</span>
                      <span>•</span>
                      <span>{formatRelativeDate(item.updatedAt)}</span>
                    </div>
                  </div>
                  <div>
                    <TaskStatusBadge status={item.status} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4 stagger-5">
          <h2 className="text-xl font-semibold">Status Breakdown</h2>
          <Card className="shadow-sm">
            <CardHeader>
              <CardDescription>Task distribution across all projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {['todo', 'in_progress', 'in_review', 'done'].map((status) => {
                const count = summary.statusBreakdown[status] || 0;
                const percentage = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                
                return (
                  <div key={status} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <TaskStatusBadge status={status as any} />
                      <span className="font-mono font-medium">{count}</span>
                    </div>
                    <Progress value={percentage} className="h-1.5" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
