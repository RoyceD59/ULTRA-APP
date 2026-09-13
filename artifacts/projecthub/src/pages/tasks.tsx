import { useState } from "react";
import { Link } from "wouter";
import { 
  useListTasks, 
  useListProjects, 
  useListMembers,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  getListTasksQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckSquare, ChevronDown, Plus, Filter, Calendar, Radio, MoreHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

import { TaskStatusBadge, TaskPriorityBadge, getInitials, formatDate, formatRelativeDate } from "@/components/shared/badges";
import { Task, TaskInput, TaskUpdate } from "@workspace/api-client-react";
import { PushTaskDialog } from "@/components/tasks/PushTaskDialog";

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  projectId: z.coerce.number().min(1, "Project is required"),
  status: z.enum(["todo", "in_progress", "in_review", "done"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  assigneeId: z.coerce.number().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

function TaskDialog({ 
  task, 
  open, 
  onOpenChange,
  prefilledProjectId
}: { 
  task?: Task | null; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  prefilledProjectId?: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEditing = !!task;
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  
  const { data: projects } = useListProjects();
  const { data: members } = useListMembers();
  
  const form = useForm<z.infer<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    values: {
      title: task?.title || "",
      description: task?.description || "",
      projectId: task?.projectId || prefilledProjectId || 0,
      status: task?.status || "todo",
      priority: task?.priority || "medium",
      assigneeId: task?.assigneeId || null,
      dueDate: task?.dueDate ? task.dueDate.split('T')[0] : null,
    },
  });

  const createTask = useCreateTask({
      mutation: {
       onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
         toast({
           title: "Task created",
           description: result.assignmentEmailStatus === "failed"
             ? `Task saved, but the assignment email failed: ${result.assignmentEmailError ?? "unknown error"}`
             : result.assignmentEmailStatus === "sent"
               ? "Assignment email sent."
               : undefined,
           variant: result.assignmentEmailStatus === "failed" ? "destructive" : undefined,
         });
        onOpenChange(false);
        form.reset();
      },
    }
  });

  const updateTask = useUpdateTask({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({
          title: "Task updated",
          description: result.assignmentEmailStatus === "failed"
            ? `Task saved, but the assignment email failed: ${result.assignmentEmailError ?? "unknown error"}`
            : result.assignmentEmailStatus === "sent"
              ? "Assignment email sent."
              : undefined,
          variant: result.assignmentEmailStatus === "failed" ? "destructive" : undefined,
        });
        onOpenChange(false);
      },
    }
  });

  function onSubmit(values: z.infer<typeof taskSchema>) {
    // nullify empty strings
    const payload = {
      ...values,
      assigneeId: values.assigneeId || null,
      dueDate: values.dueDate || null,
    };

    if (isEditing) {
      updateTask.mutate({ id: task.id, data: payload as TaskUpdate });
    } else {
      createTask.mutate({ data: payload as TaskInput });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Task" : "Create Task"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update task details." : "Add a new task to a project."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Fix navigation bug..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value ? field.value.toString() : ""}
                      disabled={!!prefilledProjectId && !isEditing}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects?.map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assigneeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assignee</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value ? field.value.toString() : "none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {members?.map(m => (
                          <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Details about this task..." className="resize-none h-20" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="todo">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="in_review">In Review</SelectItem>
                        <SelectItem value="done">Done</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              {isEditing && task && (
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2"
                  onClick={() => setPushDialogOpen(true)}
                >
                  <Radio className="w-4 h-4" />
                  Push to Agent
                </Button>
              )}
              <Button type="submit" disabled={createTask.isPending || updateTask.isPending}>
                {createTask.isPending || updateTask.isPending ? "Saving..." : "Save Task"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      {isEditing && task && (
        <PushTaskDialog
          task={task}
          open={pushDialogOpen}
          onOpenChange={setPushDialogOpen}
          onSuccess={() => {/* toast already fired inside PushTaskDialog */}}
        />
      )}
    </Dialog>
  );
}

export default function Tasks() {
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  
  const queryParams = {
    ...(filterStatus !== "all" && { status: filterStatus as any }),
    ...(filterProject !== "all" && { projectId: Number(filterProject) }),
  };
  
  const { data: tasks, isLoading } = useListTasks(queryParams);
  const { data: projects } = useListProjects();
  const { data: members } = useListMembers();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Push-to-agent state
  const [pushDialogTask, setPushDialogTask] = useState<Task | null>(null);
  const [recentlyPushed, setRecentlyPushed] = useState<Set<number>>(new Set());
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<string>>(() => new Set(["done"]));

  const deleteTask = useDeleteTask({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: "Task deleted" });
      }
    }
  });

  const updateTaskStatus = useUpdateTask({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: "Status updated" });
      }
    }
  });

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingTask(null);
    setDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this task? This cannot be undone.")) {
      deleteTask.mutate({ id });
    }
  };

  const handleStatusChange = (id: number, status: any) => {
    updateTaskStatus.mutate({ id, data: { status } });
  };
  const toggleStatus = (status: string) => {
    setCollapsedStatuses(current => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };
  const taskSections = [
    { status: "in_progress", label: "In Progress" },
    { status: "in_review", label: "In Review" },
    { status: "todo", label: "To Do" },
    { status: "done", label: "Done" },
  ].map(section => ({ ...section, tasks: tasks?.filter(task => task.status === section.status) ?? [] }));

  if (isLoading && !tasks) {
    return <div className="p-8"><div className="h-8 w-48 bg-muted rounded animate-pulse mb-8" /></div>;
  }

  return (
    <div className="space-y-6 animate-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <CheckSquare className="w-8 h-8 text-primary" />
            All Tasks
          </h1>
          <p className="text-muted-foreground mt-1">Cross-project task list.</p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-3">
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filter by Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects?.map(p => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="todo">To Do</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={handleNew} className="col-span-2 sm:col-span-1 gap-2 shadow-sm min-h-11">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        </div>
      </div>

      <TaskDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        task={editingTask} 
      />

      {pushDialogTask && (
        <PushTaskDialog
          task={pushDialogTask}
          open={!!pushDialogTask}
          onOpenChange={(open) => { if (!open) setPushDialogTask(null); }}
          onSuccess={() => {
            if (pushDialogTask) {
              setRecentlyPushed(prev => new Set(prev).add(pushDialogTask.id));
            }
          }}
        />
      )}

      {!tasks?.length ? (
        <Card className="shadow-sm border-border/50">
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
            <CheckSquare className="w-12 h-12 mb-4 text-muted/50" />
            <p>No tasks found matching your filters.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {taskSections.filter(section => section.tasks.length > 0).map(section => {
            const collapsed = collapsedStatuses.has(section.status);
            return <Card key={section.status} className="shadow-sm border-border/50 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleStatus(section.status)}
                aria-expanded={!collapsed}
                className="w-full min-h-12 flex items-center gap-3 px-4 py-3 text-left bg-muted/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                <TaskStatusBadge status={section.status as Task["status"]} />
                <span className="ml-auto rounded-full bg-background border px-2 py-0.5 text-xs font-semibold">{section.tasks.length}</span>
              </button>
              {!collapsed && <div className="divide-y">
                {section.tasks.map((task, i) => {
              const project = projects?.find(p => p.id === task.projectId);
              const assignee = members?.find(m => m.id === task.assigneeId);
              
              return (
                <div key={task.id} className={`p-4 flex flex-col lg:flex-row lg:items-center gap-4 hover:bg-muted/20 transition-colors stagger-${(i % 5) + 1}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <TaskPriorityBadge priority={task.priority} />
                      <Link href={`/projects/${task.projectId}`} className="text-xs font-mono text-muted-foreground hover:text-primary hover:underline transition-colors">
                        {project?.name || `Project #${task.projectId}`}
                      </Link>
                    </div>
                    <h3 className="font-semibold text-base text-foreground leading-snug cursor-pointer hover:text-primary" onClick={() => handleEdit(task)}>
                      {task.title}
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 sm:gap-4 flex-shrink-0">
                    {task.dueDate && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(task.dueDate)}
                      </div>
                    )}
                    
                    <div className="flex items-center gap-2 min-w-0 sm:w-32">
                      <Avatar className="w-6 h-6 border">
                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                          {assignee ? getInitials(assignee.name) : '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-muted-foreground truncate">
                        {assignee?.name || 'Unassigned'}
                      </span>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full sm:w-[130px] justify-between text-left min-h-10 px-2 py-1">
                          <TaskStatusBadge status={task.status} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[150px]">
                        <DropdownMenuLabel className="text-xs font-mono text-muted-foreground">Update Status</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'todo')}>To Do</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'in_progress')}>In Progress</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'in_review')}>In Review</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'done')}>Done</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {recentlyPushed.has(task.id) ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2">
                        <Radio className="w-3 h-3" /> Sent ✓
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        title="Push to Agent"
                        onClick={() => setPushDialogTask(task)}
                      >
                        <Radio className="h-4 w-4" />
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(task)}>Edit Task</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPushDialogTask(task)}>
                          <Radio className="w-4 h-4 mr-2" /> Push to Agent
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDelete(task.id)} className="text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
                })}
              </div>}
            </Card>;
          })}
        </div>
      )}
    </div>
  );
}
