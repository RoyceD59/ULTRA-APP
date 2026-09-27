import { useState } from "react";
import { useRoute } from "wouter";
import { 
  useGetProject, 
  useGetProjectSummary, 
  useListTasks, 
  useUpdateProject, 
  useDeleteProject,
  getListTasksQueryKey,
  getGetProjectQueryKey,
  getGetProjectSummaryQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { FolderKanban, Calendar, ArrowLeft, Settings, Trash2, Edit } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { ProjectStatusBadge, TaskStatusBadge, TaskPriorityBadge, formatDate } from "@/components/shared/badges";

// Import TaskDialog from a refactored shared location or recreate it here.
// For now we'll recreate a smaller version specific to this project, or just link to the tasks page.
// In a real app we'd extract the TaskDialog. 
// Since we have Tasks page, we can also manage tasks there. Let's provide a way to navigate to tasks with project filter, 
// or implement a simple task list here.

export default function ProjectDetail() {
  const [match, params] = useRoute("/projects/:id");
  const projectId = params?.id ? parseInt(params.id, 10) : 0;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: project, isLoading: isProjectLoading } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId }
  });
  const { data: summary, isLoading: isSummaryLoading } = useGetProjectSummary(projectId, {
    query: { queryKey: getGetProjectSummaryQueryKey(projectId), enabled: !!projectId }
  });
  const { data: tasks, isLoading: isTasksLoading } = useListTasks({ projectId }, {
    query: { queryKey: getListTasksQueryKey({ projectId }), enabled: !!projectId }
  });

  const [isEditOpen, setIsEditOpen] = useState(false);
  const deleteProject = useDeleteProject({
    mutation: {
      onSuccess: () => {
        toast({ title: "Project deleted" });
        setLocation("/projects");
      }
    }
  });

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this project? All associated tasks will be lost.")) {
      deleteProject.mutate({ id: projectId });
    }
  };

  if (isProjectLoading || isSummaryLoading || isTasksLoading) {
    return <div className="p-8"><div className="h-8 w-64 bg-muted rounded animate-pulse mb-8" /></div>;
  }

  if (!project || !summary) {
    return (
      <div className="text-center py-12">
        <FolderKanban className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold">Project not found</h2>
        <Button asChild variant="link" className="mt-4"><Link href="/projects">Back to Projects</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in-up">
      <div className="flex items-center text-sm font-medium text-muted-foreground mb-4">
        <Link href="/projects" className="flex items-center hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Projects
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{project.name}</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-3 flex-1">
          <div className="flex items-center gap-3">
            <ProjectStatusBadge status={project.status} />
            <h1 className="text-3xl font-bold tracking-tight text-foreground leading-none">
              {project.name}
            </h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-3xl">
            {project.description || "No description provided."}
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Created {formatDate(project.createdAt)}
            </div>
            {project.dueDate && (
              <>
                <span>•</span>
                <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 font-medium">
                  <Calendar className="w-4 h-4" />
                  Due {formatDate(project.dueDate)}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <Settings className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:bg-destructive/10">
                <Trash2 className="w-4 h-4 mr-2" /> Delete Project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4">
        <Card className="md:col-span-2 shadow-sm border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overall Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-bold">{summary.progressPercent}%</span>
              <span className="text-sm text-muted-foreground mb-1">completed</span>
            </div>
            <Progress value={summary.progressPercent} className="h-2.5" />
          </CardContent>
        </Card>
        
        <Card className="shadow-sm border-destructive/20 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Overdue Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-destructive">{summary.overdueCount}</span>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">{summary.totalTasks}</span>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tasks" className="pt-6">
        <TabsList className="mb-4">
          <TabsTrigger value="tasks">Project Tasks</TabsTrigger>
          <TabsTrigger value="metrics">Metrics Breakdown</TabsTrigger>
        </TabsList>
        
        <TabsContent value="tasks" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Task List</h3>
            <Button asChild size="sm">
               {/* Ideally opens TaskDialog prefilled, but linking to global task creator is fine too */}
              <Link href="/tasks">Manage Tasks</Link>
            </Button>
          </div>
          
          <Card className="shadow-sm">
            <div className="divide-y">
              {!tasks?.length ? (
                <div className="p-8 text-center text-muted-foreground">No tasks in this project yet.</div>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <TaskPriorityBadge priority={task.priority} />
                        <span className="font-semibold text-foreground">{task.title}</span>
                      </div>
                      {task.dueDate && (
                        <div className="text-xs text-muted-foreground">
                          Due: {formatDate(task.dueDate)}
                        </div>
                      )}
                    </div>
                    <div>
                      <TaskStatusBadge status={task.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </TabsContent>
        
        <TabsContent value="metrics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(summary.statusBreakdown).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <TaskStatusBadge status={status as any} />
                    <span className="font-mono">{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Priority Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(summary.priorityBreakdown).map(([priority, count]) => (
                  <div key={priority} className="flex items-center justify-between">
                    <TaskPriorityBadge priority={priority as any} />
                    <span className="font-mono">{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
