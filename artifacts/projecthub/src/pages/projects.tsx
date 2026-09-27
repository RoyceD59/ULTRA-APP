import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProjectStatusBadge, formatDate } from "@/components/shared/badges";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FolderKanban, Plus, MoreVertical, Calendar, CheckSquare, ListTodo } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const projectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["planning", "active", "on_hold", "completed"]),
  dueDate: z.string().optional().nullable(),
});

function CreateProjectDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      description: "",
      status: "planning",
      dueDate: null,
    },
  });

  const createProject = useCreateProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created", description: "Your new project is ready." });
        setOpen(false);
        form.reset();
      },
    }
  });

  function onSubmit(values: z.infer<typeof projectSchema>) {
    createProject.mutate({
      data: {
        ...values,
        description: values.description || "",
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Add a new project to your workspace. You can add tasks later.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Website Redesign" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Brief description of goals..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="planning">Planning</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createProject.isPending}>
                {createProject.isPending ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();

  if (isLoading) {
    return <div className="p-8"><div className="h-8 w-48 bg-muted rounded animate-pulse mb-8" /></div>;
  }

  return (
    <div className="space-y-8 animate-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <FolderKanban className="w-8 h-8 text-primary" />
            Projects
          </h1>
          <p className="text-muted-foreground mt-1">Manage and track your team's initiatives.</p>
        </div>
        <CreateProjectDialog>
          <Button className="gap-2 shadow-sm font-semibold">
            <Plus className="w-4 h-4" /> New Project
          </Button>
        </CreateProjectDialog>
      </div>

      {!projects?.length ? (
        <Card className="border-dashed border-2 bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center h-64 text-center">
            <FolderKanban className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No projects yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm mt-1">
              Get started by creating your first project. Projects contain tasks and track your team's progress.
            </p>
            <CreateProjectDialog>
              <Button className="mt-6 gap-2" variant="secondary">
                <Plus className="w-4 h-4" /> Create Project
              </Button>
            </CreateProjectDialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project, i) => (
            <Card key={project.id} className={`stagger-${(i % 5) + 1} flex flex-col group hover:shadow-md transition-all duration-200 border-border/50 hover:border-border`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <ProjectStatusBadge status={project.status} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${project.id}`}>View Details</Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CardTitle className="text-xl mt-3 line-clamp-1">
                  <Link href={`/projects/${project.id}`} className="hover:text-primary transition-colors">
                    {project.name}
                  </Link>
                </CardTitle>
                <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                  {project.description || "No description provided."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-4 flex-1">
                <div className="space-y-4">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5" title="Total Tasks">
                      <ListTodo className="w-4 h-4" />
                      <span>{project.taskCount}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Completed Tasks">
                      <CheckSquare className="w-4 h-4 text-emerald-500" />
                      <span>{project.doneCount}</span>
                    </div>
                    {project.dueDate && (
                      <div className="flex items-center gap-1.5" title="Due Date">
                        <Calendar className="w-4 h-4" />
                        <span>{formatDate(project.dueDate)}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span>Progress</span>
                      <span className="font-mono">{project.progressPercent}%</span>
                    </div>
                    <Progress value={project.progressPercent} className="h-2" />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-0 pb-4">
                <Button asChild variant="secondary" className="w-full bg-secondary/50 hover:bg-secondary">
                  <Link href={`/projects/${project.id}`}>Open Project</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
