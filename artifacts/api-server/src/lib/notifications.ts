import { db, contactsTable, contactMethodsTable, notificationLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { sendViaResend } from "./resend";
import { sendEmail } from "./email";

export type TemplateId = "STAKEHOLDER_UPDATE" | "OWNER_ALERT" | "RESOURCE_REQ";

export type AssignmentEmailResult = {
  status: "sent" | "failed";
  error?: string;
};

export async function sendTaskAssignmentEmail(params: {
  to: string;
  memberName: string;
  taskTitle: string;
  projectName: string;
  taskId: number;
  dueDate?: string | null;
}): Promise<AssignmentEmailResult> {
  const subject = `New task assigned: ${params.taskTitle}`;
  const due = params.dueDate ? `\nDue date: ${params.dueDate}` : "";
  const text =
    `Hi ${params.memberName},\n\n` +
    `You have been assigned "${params.taskTitle}" in the ${params.projectName} project.` +
    `${due}\n\n` +
    `Open ProjectHub to review the task details.\n\nTeam Horizon`;
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  try {
    const accepted = await sendViaResend({
      from: "ProjectHub <noreply@contacts.ucfilters.com>",
      to: params.to,
      subject,
      text,
      html,
      meta: { template: "task-assignment" },
    });
    if (accepted) return { status: "sent" };

    const fallbackAccepted = await sendEmail({
      to: params.to,
      subject,
      text,
      html,
      template: "task-assignment",
    });
    return fallbackAccepted
      ? { status: "sent" }
      : { status: "failed", error: "Resend and fallback email providers rejected the message" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ to: params.to, error }, "Task assignment email failed");
    return { status: "failed", error };
  }
}

interface NotificationContext {
  taskId?: number | null;
  projectName?: string;
  taskDescription?: string;
  completionDate?: string;
  resourceSummary?: string;
  nextTaskRequirement?: string;
  dashboardLink?: string;
}

function renderTemplate(
  templateId: TemplateId,
  contactName: string,
  ctx: NotificationContext
): { subject: string; body: string } {
  const link = ctx.dashboardLink ?? `${process.env.REPLIT_DOMAINS?.split(",")[0] ?? ""}`;

  switch (templateId) {
    case "STAKEHOLDER_UPDATE":
      return {
        subject: `Project Update: ${ctx.projectName ?? "Team Horizon"} - Milestone Reached`,
        body: `Dear ${contactName},\n\nWe are pleased to inform you that "${ctx.taskDescription ?? "a task"}" has been successfully completed.\n\nProject Metrics:\n• Completed Date: ${ctx.completionDate ?? new Date().toDateString()}\n• Resources Used: ${ctx.resourceSummary ?? "N/A"}\n\nYou can view the full progress report here: ${link}\n\nBest regards,\nTeam Horizon Orchestration Hub`,
      };
    case "OWNER_ALERT":
      return {
        subject: `Task Update — Action Required`,
        body: `Hi ${contactName}, the task "${ctx.taskDescription ?? "your task"}" has been updated.\n\nNext steps: ${ctx.nextTaskRequirement ?? "Please review the dashboard for details."}\n\nView full task details here: ${link}`,
      };
    case "RESOURCE_REQ":
      return {
        subject: `Urgent Resource Request — ${ctx.projectName ?? "Team Horizon"}`,
        body: `Hi ${contactName},\n\nA resource request has been raised for task "${ctx.taskDescription ?? "an active task"}".\n\nResource details: ${ctx.resourceSummary ?? "See dashboard for details."}\n\nPlease review and approve: ${link}`,
      };
    default:
      return {
        subject: "Team Horizon Notification",
        body: `Hi ${contactName},\n\nYou have a new notification from Team Horizon.\n\nView your dashboard: ${link}`,
      };
  }
}

async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
  template?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { sendEmail } = await import("./email");
    await sendEmail({
      to,
      subject,
      html: body.replace(/\n/g, "<br>"),
      text: body,
      template,
    });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ to, error: message }, "Email dispatch failed");
    return { success: false, error: message };
  }
}

async function sendWhatsApp(
  to: string,
  body: string
): Promise<{ success: boolean; error?: string; whatsappMessageId?: string }> {
  try {
    const { sendWhatsAppMessage, getWhatsAppStatus } = await import("./whatsapp");
    const { state } = getWhatsAppStatus();
    if (state !== "connected") {
      return { success: false, error: `WhatsApp not connected (state: ${state})` };
    }
    const msgId = await sendWhatsAppMessage(to, body);
    return { success: true, whatsappMessageId: msgId || undefined };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ to, error: message }, "WhatsApp dispatch failed");
    return { success: false, error: message };
  }
}

export interface DispatchResult {
  success: boolean;
  channelUsed: string;
  logId: number;
  fallbackUsed: boolean;
  message: string;
}

export async function dispatchToContact(
  contactId: number,
  templateId: TemplateId,
  context: NotificationContext,
  overrideChannel?: string | null
): Promise<DispatchResult> {
  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, contactId));

  if (!contact) {
    throw new Error(`Contact ${contactId} not found`);
  }

  // Get communication methods, preferred first
  const methods = await db
    .select()
    .from(contactMethodsTable)
    .where(eq(contactMethodsTable.contactId, contactId))
    .orderBy(contactMethodsTable.isPreferred);

  if (methods.length === 0) {
    throw new Error(`Contact ${contactId} has no communication methods`);
  }

  const preferredMethod = overrideChannel
    ? methods.find((m) => m.channelType === overrideChannel) ?? methods[0]
    : methods.find((m) => m.isPreferred) ?? methods[0];

  const fallbackMethod = methods.find((m) => m.id !== preferredMethod?.id);

  const { subject, body } = renderTemplate(templateId, contact.fullName, context);

  let result: { success: boolean; error?: string; whatsappMessageId?: string };
  let channelUsed = preferredMethod?.channelType ?? "email";
  let fallbackUsed = false;

  if (preferredMethod?.channelType === "whatsapp") {
    result = await sendWhatsApp(preferredMethod.channelValue, body);
  } else {
    result = await sendEmailNotification(preferredMethod?.channelValue ?? "", subject, body, templateId.toLowerCase());
  }

  // Fail-safe: fall back to secondary channel
  if (!result.success && fallbackMethod) {
    logger.warn(
      { primary: channelUsed, error: result.error },
      "Primary channel failed, using fallback"
    );
    fallbackUsed = true;
    channelUsed = fallbackMethod.channelType;

    if (fallbackMethod.channelType === "whatsapp") {
      result = await sendWhatsApp(fallbackMethod.channelValue, body);
    } else {
      result = await sendEmailNotification(fallbackMethod.channelValue, subject, body, templateId.toLowerCase());
    }
  }

  // Log the dispatch
  const [log] = await db
    .insert(notificationLogsTable)
    .values({
      taskId: context.taskId ?? null,
      contactId,
      channelType: channelUsed,
      channelValue:
        (fallbackUsed ? fallbackMethod?.channelValue : preferredMethod?.channelValue) ?? "",
      templateId,
      subject,
      body,
      status: result.success ? "sent" : "failed",
      errorMessage: result.success ? null : result.error,
      // Store Baileys message key so receipt events can be matched back to this log row.
      // Only meaningful for WhatsApp — leave null for email/SMS.
      whatsappMessageId: channelUsed === "whatsapp" ? (result.whatsappMessageId ?? null) : null,
    })
    .returning();

  return {
    success: result.success,
    channelUsed,
    logId: log?.id ?? 0,
    fallbackUsed,
    message: result.success
      ? `Notification sent via ${channelUsed}`
      : `Notification failed: ${result.error}`,
  };
}
