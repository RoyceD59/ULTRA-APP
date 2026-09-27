import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, contactsTable, contactMethodsTable } from "@workspace/db";
import { requireTeamAuth } from "./auth.js";
import {
  CreateContactBody,
  CreateContactResponse,
  GetContactParams,
  GetContactResponse,
  UpdateContactParams,
  UpdateContactBody,
  UpdateContactResponse,
  DeleteContactParams,
  ListContactsResponse,
  ListContactMethodsParams,
  ListContactMethodsResponse,
  AddContactMethodParams,
  AddContactMethodBody,
  AddContactMethodResponse,
  UpdateContactMethodParams,
  UpdateContactMethodBody,
  UpdateContactMethodResponse,
  DeleteContactMethodParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─── Contacts ────────────────────────────────────────────────────────────────

router.get("/contacts", requireTeamAuth, async (_req, res): Promise<void> => {
  const contacts = await db
    .select()
    .from(contactsTable)
    .orderBy(contactsTable.fullName);
  res.json(ListContactsResponse.parse(contacts));
});

router.post("/contacts", requireTeamAuth, async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db
    .insert(contactsTable)
    .values({
      fullName: parsed.data.fullName,
      role: parsed.data.role ?? "",
      organization: parsed.data.organization ?? "",
      tags: parsed.data.tags ?? [],
    })
    .returning();

  res.status(201).json(CreateContactResponse.parse(contact));
});

router.get("/contacts/:id", requireTeamAuth, async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, params.data.id));

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  const methods = await db
    .select()
    .from(contactMethodsTable)
    .where(eq(contactMethodsTable.contactId, params.data.id))
    .orderBy(contactMethodsTable.isPreferred);

  res.json(GetContactResponse.parse({ ...contact, methods }));
});

router.patch("/contacts/:id", requireTeamAuth, async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db
    .update(contactsTable)
    .set(parsed.data)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(UpdateContactResponse.parse(contact));
});

router.delete("/contacts/:id", requireTeamAuth, async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db
    .delete(contactsTable)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.sendStatus(204);
});

// ─── Bulk Import ─────────────────────────────────────────────────────────────

interface ImportRow {
  fullName: string;
  tags: string[];
  email?: string;
  phone?: string;
  phoneChannel: "sms" | "whatsapp";
  recordId?: string;
}

function parseImportBody(body: unknown): { rows: ImportRow[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b["rows"])) return null;
  const rows: ImportRow[] = [];
  for (const item of b["rows"]) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const fullName = typeof r["fullName"] === "string" ? r["fullName"].trim() : "";
    if (!fullName) continue;
    const tags = Array.isArray(r["tags"])
      ? (r["tags"] as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    const email = typeof r["email"] === "string" && r["email"].trim() ? r["email"].trim() : undefined;
    const phone = typeof r["phone"] === "string" && r["phone"].trim() ? r["phone"].trim() : undefined;
    const phoneChannel: "sms" | "whatsapp" = r["phoneChannel"] === "whatsapp" ? "whatsapp" : "sms";
    const recordId = typeof r["recordId"] === "string" && r["recordId"].trim() ? r["recordId"].trim() : undefined;
    rows.push({ fullName, tags, email, phone, phoneChannel, recordId });
  }
  return { rows };
}

router.post("/contacts/import", requireTeamAuth, async (req, res): Promise<void> => {
  const parsed = parseImportBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid import body: expected { rows: ImportRow[] }" });
    return;
  }

  const { rows } = parsed;

  // ── Fetch existing dedup sets in one round-trip each ──────────────────────

  // All emails already stored in contact_methods
  const existingMethods = await db
    .select({ channelValue: contactMethodsTable.channelValue })
    .from(contactMethodsTable)
    .where(eq(contactMethodsTable.channelType, "email"));
  const existingEmails = new Set(
    existingMethods.map((m) => m.channelValue.toLowerCase())
  );

  // All record-ID tags (tags starting with "id:") from contacts
  const allContacts = await db
    .select({ tags: contactsTable.tags })
    .from(contactsTable);
  const existingRecordIds = new Set<string>();
  for (const c of allContacts) {
    for (const tag of c.tags ?? []) {
      if (tag.startsWith("id:")) existingRecordIds.add(tag.slice(3));
    }
  }

  // ── Process rows ──────────────────────────────────────────────────────────

  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Track within-batch emails to avoid intra-import duplicates
  const batchEmails = new Set<string>();

  for (const row of rows) {
    // Skip by record ID
    if (row.recordId && existingRecordIds.has(row.recordId)) {
      skipped++;
      continue;
    }

    // Skip by email (existing DB or already created in this batch)
    const normEmail = row.email ? row.email.toLowerCase() : null;
    if (normEmail && (existingEmails.has(normEmail) || batchEmails.has(normEmail))) {
      skipped++;
      continue;
    }

    // Create contact + methods in a transaction; rollback on any failure
    try {
      await db.transaction(async (tx) => {
        const [contact] = await tx
          .insert(contactsTable)
          .values({
            fullName: row.fullName,
            role: "",
            organization: "",
            tags: row.tags,
          })
          .returning();

        if (row.email) {
          await tx.insert(contactMethodsTable).values({
            contactId: contact.id,
            channelType: "email",
            channelValue: row.email,
            isPreferred: row.phoneChannel !== "whatsapp",
          });
        }

        if (row.phone) {
          await tx.insert(contactMethodsTable).values({
            contactId: contact.id,
            channelType: row.phoneChannel,
            channelValue: row.phone,
            isPreferred: true,
          });
        }
      });

      // Only update dedup sets after a successful transaction
      if (normEmail) {
        existingEmails.add(normEmail);
        batchEmails.add(normEmail);
      }
      if (row.recordId) existingRecordIds.add(row.recordId);
      created++;
    } catch {
      failed++;
    }
  }

  res.json({ created, skipped, failed });
});

// ─── Contact Methods ──────────────────────────────────────────────────────────

router.get("/contacts/:id/methods", requireTeamAuth, async (req, res): Promise<void> => {
  const params = ListContactMethodsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const methods = await db
    .select()
    .from(contactMethodsTable)
    .where(eq(contactMethodsTable.contactId, params.data.id))
    .orderBy(contactMethodsTable.isPreferred);

  res.json(ListContactMethodsResponse.parse(methods));
});

router.post("/contacts/:id/methods", requireTeamAuth, async (req, res): Promise<void> => {
  const params = AddContactMethodParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddContactMethodBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Ensure contact exists
  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, params.data.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  const [method] = await db
    .insert(contactMethodsTable)
    .values({
      contactId: params.data.id,
      channelType: parsed.data.channelType,
      channelValue: parsed.data.channelValue,
      isPreferred: parsed.data.isPreferred ?? false,
    })
    .returning();

  res.status(201).json(AddContactMethodResponse.parse(method));
});

router.patch(
  "/contacts/:id/methods/:methodId",
  requireTeamAuth,
  async (req, res): Promise<void> => {
    const params = UpdateContactMethodParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateContactMethodBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [method] = await db
      .update(contactMethodsTable)
      .set(parsed.data)
      .where(eq(contactMethodsTable.id, params.data.methodId))
      .returning();

    if (!method) {
      res.status(404).json({ error: "Contact method not found" });
      return;
    }

    res.json(UpdateContactMethodResponse.parse(method));
  }
);

router.delete(
  "/contacts/:id/methods/:methodId",
  requireTeamAuth,
  async (req, res): Promise<void> => {
    const params = DeleteContactMethodParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [method] = await db
      .delete(contactMethodsTable)
      .where(eq(contactMethodsTable.id, params.data.methodId))
      .returning();

    if (!method) {
      res.status(404).json({ error: "Contact method not found" });
      return;
    }

    res.sendStatus(204);
  }
);

export default router;
