import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import Contacts from "./contacts";

vi.mock("@/components/contacts/ImportContactsDialog", () => ({ ImportContactsDialog: () => null }));
vi.mock("@/components/contacts/ConnectSheetDialog", () => ({ ConnectSheetDialog: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("contact detail editing", () => {
  let client: QueryClient;
  let contact: { id: number; fullName: string; role: string; organization: string; tags: string[] };
  let calls: { url: string; method: string; data: unknown }[];
  let failSave: boolean;
  let holdSave: Promise<void> | undefined;
  const method = { id: 9, contactId: 7, channelType: "email", channelValue: "jane@example.com", isPreferred: false };

  beforeEach(() => {
    contact = { id: 7, fullName: "Jane Doe", role: "CEO", organization: "Acme", tags: ["Partner", "Lead"] };
    calls = []; failSave = false; holdSave = undefined;
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
    setBaseUrl(null);
    setAuthTokenGetter(() => "test-only");
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      const verb = options?.method ?? "GET";
      const data = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), method: verb, data });
      let body: unknown;
      let status = 200;
      if (String(url).endsWith("/sync/sheets")) body = { connected: false };
      else if (verb === "PATCH") {
        await holdSave;
        if (failSave) { status = 503; body = { error: "Unavailable" }; }
        else { contact = { ...contact, ...data }; body = contact; }
      } else if (verb === "POST") body = { ...method, ...data };
      else if (String(url).endsWith("/contacts")) body = [contact];
      else body = { ...contact, methods: [method] };
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => {
    cleanup(); client.clear(); vi.unstubAllGlobals(); setAuthTokenGetter(null); setBaseUrl(null);
  });

  async function openEditor() {
    render(<QueryClientProvider client={client}><Contacts /></QueryClientProvider>);
    fireEvent.click(await screen.findByText("Jane Doe"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
  }

  function change(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  it("prefills all fields, PATCHes edits and refreshes both the sheet and the list", async () => {
    await openEditor();
    expect(screen.getByLabelText("Full Name")).toHaveValue("Jane Doe");
    expect(screen.getByLabelText("Role (Optional)")).toHaveValue("CEO");
    expect(screen.getByLabelText("Organization")).toHaveValue("Acme");
    expect(screen.getByLabelText("Tags (Comma separated)")).toHaveValue("Partner, Lead");
    change("Full Name", "  Jane Smith  ");
    change("Role (Optional)", "Director");
    change("Organization", "New Org");
    change("Tags (Comma separated)", " Stakeholder, , Partner ");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByRole("button", { name: "Edit", exact: true });
    expect(calls.find(call => call.method === "PATCH")).toEqual({
      url: "/api/contacts/7", method: "PATCH",
      data: { fullName: "Jane Smith", role: "Director", organization: "New Org", tags: ["Stakeholder", "Partner"] },
    });
    await waitFor(() => expect(screen.getAllByText("Jane Smith")).toHaveLength(2));
    expect(within(screen.getByRole("dialog")).getByText("New Org")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    expect(screen.getByLabelText("Full Name")).toHaveValue("Jane Smith");
  });

  it("sends explicit empty optional fields so they can be cleared", async () => {
    await openEditor();
    change("Role (Optional)", "");
    change("Organization", "");
    change("Tags (Comma separated)", "");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByRole("button", { name: "Edit", exact: true });
    expect(contact).toMatchObject({ role: "", organization: "", tags: [] });
    await waitFor(() => expect(screen.queryByText("Acme")).not.toBeInTheDocument());
  });

  it("rejects whitespace-only names without sending a PATCH", async () => {
    await openEditor();
    change("Full Name", "   ");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByText("Name is required");
    expect(calls.some(call => call.method === "PATCH")).toBe(false);
  });

  it("cancels without saving and discards the draft on reopen", async () => {
    await openEditor();
    change("Full Name", "Unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
    expect(screen.getByLabelText("Full Name")).toHaveValue("Jane Doe");
    expect(calls.some(call => call.method === "PATCH")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Jane Doe"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
    expect(screen.getByLabelText("Full Name")).toHaveValue("Jane Doe");
  });

  it("retains a failed draft for retry and disables editing during save", async () => {
    await openEditor();
    change("Full Name", "Jane Smith");
    failSave = true;
    let release!: () => void;
    holdSave = new Promise<void>(resolve => { release = resolve; });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled());
    expect(screen.getByLabelText("Full Name")).toBeDisabled();
    release();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save this contact");
    expect(screen.getByLabelText("Full Name")).toHaveValue("Jane Smith");
    expect(contact.fullName).toBe("Jane Doe");
    failSave = false; holdSave = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByRole("button", { name: "Edit", exact: true });
    expect(contact.fullName).toBe("Jane Smith");
  });

  it("keeps Add New Method working beneath the edit section", async () => {
    await openEditor();
    expect(screen.getByText("Add New Method")).toBeInTheDocument();
    change("Value (Email or Phone Number)", "new@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Add Method", exact: true }));
    await waitFor(() => expect(calls.find(call => call.method === "POST")?.data).toEqual({
      channelType: "email", channelValue: "new@example.com", isPreferred: false,
    }));
    expect(screen.getByLabelText("Full Name")).toHaveValue("Jane Doe");
    expect(calls.some(call => call.method === "PATCH")).toBe(false);
  });
});