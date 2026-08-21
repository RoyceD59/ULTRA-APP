import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserPlus, Shield, ShieldOff, RotateCcw,
  Copy, Check, Loader2, UserX, UserCheck, Mail, Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  listUsers, inviteUser, updateUserRole, updateUser, adminResetPassword,
  isTeamAdmin, PAGES,
  type AdminResetResult, type TeamUserRecord, type PagePermission,
} from "@/lib/team-auth";

// ─── Permissions Dialog ────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<PagePermission, string> = {
  none: "No access",
  view: "View",
  edit: "Edit",
};

function PermissionsDialog({
  user,
  open,
  onClose,
}: { user: TeamUserRecord | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [perms, setPerms] = useState<Record<string, PagePermission>>({});

  // Reset local state when dialog opens for a new user
  function initialPerms(u: TeamUserRecord) {
    const base: Record<string, PagePermission> = {};
    for (const p of PAGES) base[p.slug] = "none";
    return { ...base, ...(u.permissions ?? {}) } as Record<string, PagePermission>;
  }

  function handleOpen(u: TeamUserRecord) {
    setPerms(initialPerms(u));
  }

  const mutation = useMutation({
    mutationFn: () => updateUser(user!.id, { permissions: perms }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team-users"] });
      toast({ title: "Permissions saved" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  function setAll(level: PagePermission) {
    const next: Record<string, PagePermission> = {};
    for (const p of PAGES) next[p.slug] = level;
    setPerms(next);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v && user) handleOpen(user);
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            Page permissions — {user?.name}
          </DialogTitle>
          <DialogDescription>
            Choose which pages <strong>{user?.email}</strong> can access.
            Admins always have full access regardless of these settings.
          </DialogDescription>
        </DialogHeader>

        {/* Quick-set row */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="mr-1">Set all:</span>
          {(["none", "view", "edit"] as PagePermission[]).map((lvl) => (
            <Button key={lvl} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setAll(lvl)}>
              {LEVEL_LABELS[lvl]}
            </Button>
          ))}
        </div>

        {/* Per-page permission matrix */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Page</TableHead>
                <TableHead className="text-center">No access</TableHead>
                <TableHead className="text-center">View</TableHead>
                <TableHead className="text-center">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PAGES.map((page) => (
                <TableRow key={page.slug}>
                  <TableCell className="font-medium text-sm">{page.label}</TableCell>
                  {(["none", "view", "edit"] as PagePermission[]).map((lvl) => (
                    <TableCell key={lvl} className="text-center">
                      <input
                        type="radio"
                        name={`perm-${page.slug}`}
                        value={lvl}
                        checked={(perms[page.slug] ?? "none") === lvl}
                        onChange={() => setPerms((p) => ({ ...p, [page.slug]: lvl }))}
                        className="accent-primary cursor-pointer w-4 h-4"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</> : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invite Dialog ─────────────────────────────────────────────────────────────

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => inviteUser(email.trim()),
    onSuccess: (data) => {
      setEmail(data.email);
      setInviteUrl(data.inviteUrl);
      setEmailSent(data.emailSent);
      void qc.invalidateQueries({ queryKey: ["team-users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    },
  });

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    setEmail("");
    setInviteUrl(null);
    setEmailSent(null);
    setCopied(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            Invite team member
          </DialogTitle>
          <DialogDescription>
            An invite link will be generated (valid 7 days). We'll also try to email it.
            After they join, set their page permissions from the Users table.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Invite link for <strong>{email}</strong>:
            </p>
            <div className="flex gap-2">
              <Input value={inviteUrl} readOnly className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={copyLink}>
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            {emailSent ? (
              <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                Invite email sent to {email}.
              </p>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Email delivery failed — share this link with the invitee manually.
              </p>
            )}
            <p className="text-xs text-muted-foreground">Share this link with the invitee. It expires in 7 days.</p>
            <DialogFooter><Button onClick={handleClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={mutation.isPending}
                onKeyDown={(e) => e.key === "Enter" && email.trim() && mutation.mutate()}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !email.trim()}>
                {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generating…</> : "Send invite"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset Password Dialog ──────────────────────────────────────────────────────

function ResetPasswordDialog({
  user, open, onClose,
}: { user: TeamUserRecord | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [result, setResult] = useState<AdminResetResult | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => adminResetPassword(user!.id),
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.resetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() { setResult(null); setCopied(false); onClose(); }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-primary" />
            Reset password — {user?.name}
          </DialogTitle>
          <DialogDescription>
            A reset link (valid 24 hours) will be generated and emailed to {user?.email}.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Reset link generated:</p>
            <div className="flex gap-2">
              <Input value={result.resetUrl} readOnly className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={copyLink}>
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            {result.emailSent ? (
              <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                Reset email sent to {result.email}.
              </p>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Email delivery failed — share this link with the user manually.
              </p>
            )}
            <p className="text-xs text-muted-foreground">This link expires in 24 hours.</p>
            <DialogFooter><Button onClick={handleClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generating…</> : "Generate reset link"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Permission summary badge ──────────────────────────────────────────────────

function PermissionSummary({ user }: { user: TeamUserRecord }) {
  if (user.role === "admin") return <span className="text-xs text-muted-foreground">All pages (admin)</span>;
  const perms = user.permissions ?? {};
  const editCount = Object.values(perms).filter((v) => v === "edit").length;
  const viewCount = Object.values(perms).filter((v) => v === "view").length;
  if (editCount === 0 && viewCount === 0) return <span className="text-xs text-destructive">No access</span>;
  const parts: string[] = [];
  if (editCount > 0) parts.push(`${editCount} edit`);
  if (viewCount > 0) parts.push(`${viewCount} view`);
  return <span className="text-xs text-muted-foreground">{parts.join(", ")}</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<TeamUserRecord | null>(null);
  const [permTarget, setPermTarget] = useState<TeamUserRecord | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["team-users"],
    queryFn: listUsers,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "admin" | "member" }) => updateUserRole(id, role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team-users"] }),
    onError: (err: Error) => toast({ title: "Role change failed", description: err.message, variant: "destructive" }),
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateUser(id, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team-users"] }),
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  if (!isTeamAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        You don't have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" /> User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite team members, manage roles, set page permissions, and reset passwords.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Invite member
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Page access</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} className={!user.isActive ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" />{user.email}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role === "admin" ? (
                        <><Shield className="w-3 h-3 mr-1" />Admin</>
                      ) : "Member"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PermissionSummary user={user} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "outline" : "destructive"}>
                      {user.isActive ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {/* Set permissions (members only) */}
                      {user.role === "member" && (
                        <Button
                          size="sm" variant="ghost" title="Set page permissions"
                          onClick={() => setPermTarget(user)}
                        >
                          <Settings2 className="w-4 h-4" />
                        </Button>
                      )}
                      {/* Toggle role */}
                      <Button
                        size="sm" variant="ghost"
                        title={user.role === "admin" ? "Demote to member" : "Promote to admin"}
                        disabled={roleMutation.isPending}
                        onClick={() => roleMutation.mutate({ id: user.id, role: user.role === "admin" ? "member" : "admin" })}
                      >
                        {user.role === "admin" ? <ShieldOff className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                      </Button>
                      {/* Reset password */}
                      <Button size="sm" variant="ghost" title="Reset password" onClick={() => setResetTarget(user)}>
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                      {/* Deactivate / reactivate */}
                      <Button
                        size="sm" variant="ghost"
                        title={user.isActive ? "Deactivate account" : "Reactivate account"}
                        disabled={activeMutation.isPending}
                        onClick={() => activeMutation.mutate({ id: user.id, isActive: !user.isActive })}
                      >
                        {user.isActive ? <UserX className="w-4 h-4 text-destructive" /> : <UserCheck className="w-4 h-4 text-green-600" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No team members yet. Invite someone to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ResetPasswordDialog user={resetTarget} open={!!resetTarget} onClose={() => setResetTarget(null)} />
      <PermissionsDialog user={permTarget} open={!!permTarget} onClose={() => setPermTarget(null)} />
    </div>
  );
}
