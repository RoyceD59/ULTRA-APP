import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateContact,
  getListContactsQueryKey,
  getGetContactQueryKey,
  type Contact,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const editSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  role: z.string().trim(),
  organization: z.string().trim(),
  tags: z.string(),
});

export function ContactEditSection({ contact }: { contact: Contact }) {
  const [editing, setEditing] = useState(false);

  return (
    <section aria-label="Contact details">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contact Details</h3>
        {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {editing && <ContactEditForm contact={contact} onDone={() => setEditing(false)} />}
    </section>
  );
}

function ContactEditForm({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      fullName: contact.fullName,
      role: contact.role ?? "",
      organization: contact.organization ?? "",
      tags: (contact.tags ?? []).join(", "),
    },
  });
  const updateContact = useUpdateContact({
    mutation: {
      onSuccess: (_updated, variables) => {
        void queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(variables.id) });
        toast({ title: "Contact updated successfully" });
        onDone();
      },
      onError: () => {
        form.setError("root", { message: "Couldn't save this contact. Please try again." });
      },
    },
  });

  function onSubmit(values: z.infer<typeof editSchema>) {
    if (updateContact.isPending) return;
    form.clearErrors("root");
    updateContact.mutate({
      id: contact.id,
      data: {
        fullName: values.fullName,
        role: values.role,
        organization: values.organization,
        tags: values.tags.split(",").map(tag => tag.trim()).filter(Boolean),
      },
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <fieldset disabled={updateContact.isPending} className="space-y-4">
          <FormField control={form.control} name="fullName" render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl><Input autoFocus {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="role" render={({ field }) => (
            <FormItem>
              <FormLabel>Role (Optional)</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="organization" render={({ field }) => (
            <FormItem>
              <FormLabel>Organization</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="tags" render={({ field }) => (
            <FormItem>
              <FormLabel>Tags (Comma separated)</FormLabel>
              <FormControl><Input placeholder="Stakeholder, Partner" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          {form.formState.errors.root && (
            <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
            <Button type="submit" disabled={updateContact.isPending}>
              {updateContact.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  );
}