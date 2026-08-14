import type { TaskStatus, TaskPriority, ProjectStatus } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Clock, AlertCircle, AlertTriangle, ArrowUp, ArrowRight, ArrowDown } from 'lucide-react';

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const config: Record<TaskStatus, { label: string; className: string; icon: typeof Circle }> = {
    todo: { label: 'To Do', className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300', icon: Circle },
    in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock },
    in_review: { label: 'In Review', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400', icon: AlertCircle },
    done: { label: 'Done', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle2 },
  };

  const { label, className, icon: Icon } = config[status];

  return (
    <Badge variant="outline" className={cn("font-medium gap-1.5 whitespace-nowrap", className)}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </Badge>
  );
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const config: Record<TaskPriority, { label: string; className: string; icon: typeof Circle }> = {
    low: { label: 'Low', className: 'text-slate-500 bg-slate-50 border-slate-200 dark:bg-slate-800 dark:text-slate-400', icon: ArrowDown },
    medium: { label: 'Medium', className: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400', icon: ArrowRight },
    high: { label: 'High', className: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400', icon: ArrowUp },
    urgent: { label: 'Urgent', className: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-900/20 dark:text-red-400', icon: AlertTriangle },
  };

  const { label, className, icon: Icon } = config[priority];

  return (
    <Badge variant="outline" className={cn("font-medium gap-1 whitespace-nowrap", className)}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const config: Record<ProjectStatus, { label: string; className: string }> = {
    planning: { label: 'Planning', className: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400' },
    active: { label: 'Active', className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400' },
    on_hold: { label: 'On Hold', className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400' },
    completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' },
  };

  const { label, className } = config[status];

  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", className)}>
      {label}
    </Badge>
  );
}

export function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return 'No date';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'Never';

  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;

  return formatDate(date);
}
