import { useState } from "react";
import { 
  useListMembers, 
  useCreateMember, 
  useUpdateMember, 
  useDeleteMember,
  getListMembersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, MoreVertical, Mail, Briefcase, Trash2, Edit } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials, formatDate } from "@/components/shared/badges";
import { Member } from "@workspace/api-client-react";

const memberSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  role: z.string().min(1, "Role is required"),
});

function MemberDialog({ 
  member, 
  open, 
  onOpenChange 
}: { 
  member?: Member | null; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEditing = !!member;
  
  const form = useForm<z.infer<typeof memberSchema>>({
    resolver: zodResolver(memberSchema),
    values: {
      name: member?.name || "",
      email: member?.email || "",
      role: member?.role || "",
    },
  });

  const createMember = useCreateMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
        toast({ title: "Member added" });
        onOpenChange(false);
        form.reset();
      },
    }
  });

  const updateMember = useUpdateMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
        toast({ title: "Member updated" });
        onOpenChange(false);
      },
    }
  });

  function onSubmit(values: z.infer<typeof memberSchema>) {
    if (isEditing) {
      updateMember.mutate({ id: member.id, data: values });
    } else {
      createMember.mutate({ data: values });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update member details below." : "Add a new member to your workspace team."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="jane@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role / Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Frontend Engineer" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createMember.isPending || updateMember.isPending}>
                {createMember.isPending || updateMember.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Team() {
  const { data: members, isLoading } = useListMembers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);

  const deleteMember = useDeleteMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
        toast({ title: "Member removed" });
      }
    }
  });

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to remove this member?")) {
      deleteMember.mutate({ id });
    }
  };

  const handleEdit = (member: Member) => {
    setEditingMember(member);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingMember(null);
    setDialogOpen(true);
  };

  if (isLoading) {
    return <div className="p-8"><div className="h-8 w-48 bg-muted rounded animate-pulse mb-8" /></div>;
  }

  return (
    <div className="space-y-8 animate-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" />
            Team Directory
          </h1>
          <p className="text-muted-foreground mt-1">Manage who has access to ProjectHub.</p>
        </div>
        <Button onClick={handleNew} className="gap-2 shadow-sm font-semibold">
          <Plus className="w-4 h-4" /> Add Member
        </Button>
      </div>

      <MemberDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        member={editingMember} 
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {members?.map((member, i) => (
          <Card key={member.id} className={`stagger-${(i % 5) + 1} overflow-hidden group`}>
            <div className="h-16 bg-muted/50 border-b relative">
              <div className="absolute -bottom-8 left-6">
                <Avatar className="w-16 h-16 border-4 border-background shadow-sm">
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                    {getInitials(member.name)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="absolute top-3 right-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleEdit(member)} className="gap-2">
                      <Edit className="w-4 h-4 text-muted-foreground" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => handleDelete(member.id)} 
                      className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <CardContent className="pt-10 pb-6 px-6">
              <div className="space-y-1">
                <h3 className="font-bold text-lg leading-tight">{member.name}</h3>
                <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" /> {member.role}
                </p>
              </div>
              <div className="mt-4 pt-4 border-t space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="w-4 h-4" />
                  <a href={`mailto:${member.email}`} className="hover:text-foreground hover:underline truncate">
                    {member.email}
                  </a>
                </div>
                <div className="text-xs text-muted-foreground">
                  Joined {formatDate(member.createdAt)}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
