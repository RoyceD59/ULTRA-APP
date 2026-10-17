import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import AdminUnsyncedRegistrationsPage from "./unsynced-registrations";

const api = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock("@/lib/team-auth", () => ({ isTeamAdmin: () => true, getAuthHeaders: () => ({}) }));
vi.mock("@/components/customer-assignments", () => ({ CustomerAssignmentsSection: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  clearSelectedRegistrationRecords: api.clear, clearResolvedRegistrations: vi.fn(),
  getListUnsyncedRegistrationsQueryKey: () => ["registration-records"],
  getListUcCustomersQueryKey: () => ["customers"], recoverUnsyncedRegistration: vi.fn(),
  useListUcCustomers: () => ({ data: [] }),
  useListUnsyncedRegistrations: () => useQuery({ queryKey: ["registration-records"], queryFn: api.list, retry: false }),
}));
const record = (index: number, recoveryStatus: string) => ({
  id: index, recordKey: index.toString(16).padStart(64, "0"),
  firstName: "Fixture", lastName: String(index), email: `test-${index}@example.test`, phone: "+254700000001",
  recordedAt: "2026-10-17T12:00:00.000Z", dbPersisted: recoveryStatus === "resolved", recoveryStatus,
});
let records: ReturnType<typeof record>[];
const select = (index: number) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`Select registration for test-${index}@`) }));
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><AdminUnsyncedRegistrationsPage /></QueryClientProvider>);
}
beforeEach(() => {
  records = [record(1, "resolved"), record(2, "pending"), record(3, "blocked")];
  api.list.mockReset().mockImplementation(async () => ({ records: [...records] }));
  api.clear.mockReset().mockImplementation(async ({ recordKeys }: { recordKeys: string[] }) => {
    records = records.filter((row) => !recordKeys.includes(row.recordKey));
    return { cleared: recordKeys.length };
  });
  api.toast.mockReset();
});

describe("Selected test registration clearing", () => {
  it("clears only confirmed selected records across resolved and unresolved states and refreshes the list", async () => {
    renderPage();
    await screen.findByTestId("row-unsynced-registration-1");
    expect(screen.getByTestId("button-clear-selected-registrations")).toBeDisabled();
    select(1); select(2);
    fireEvent.click(screen.getByTestId("button-clear-selected-registrations"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Customer accounts, assignments, orders, payments and customer history will stay untouched");
    expect(dialog).toHaveTextContent("test-1@example.test");
    expect(dialog).toHaveTextContent("test-2@example.test");
    expect(dialog).not.toHaveTextContent("test-3@example.test");
    expect(api.clear).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear these test records" }));
    await waitFor(() => expect(screen.queryByTestId("row-unsynced-registration-1")).not.toBeInTheDocument());
    expect(screen.queryByTestId("row-unsynced-registration-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-unsynced-registration-3")).toBeInTheDocument();
    expect(api.clear).toHaveBeenCalledExactlyOnceWith({ confirm: true, recordKeys: [record(1, "resolved").recordKey, record(2, "pending").recordKey] });
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("cancels without removing any record and supports deselecting all", async () => {
    renderPage();
    await screen.findByTestId("row-unsynced-registration-1");
    select(3);
    fireEvent.click(screen.getByTestId("button-clear-selected-registrations"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(api.clear).not.toHaveBeenCalled();
    expect(screen.getByTestId("row-unsynced-registration-3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("retains records and asks for a fresh selection after a stale selection error", async () => {
    api.clear.mockRejectedValueOnce(new Error("Selected registration records changed. Refresh and select them again."));
    renderPage();
    await screen.findByTestId("row-unsynced-registration-1");
    select(2);
    fireEvent.click(screen.getByTestId("button-clear-selected-registrations"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear these test records" }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not clear selected records" })));
    expect(screen.getByTestId("row-unsynced-registration-2")).toBeInTheDocument();
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("does not claim that every registration synced after clearing the last unresolved record", async () => {
    records = [record(2, "pending")];
    renderPage();
    await screen.findByTestId("row-unsynced-registration-2");
    select(2);
    fireEvent.click(screen.getByTestId("button-clear-selected-registrations"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear these test records" }));
    expect(await screen.findByText("No registration recovery records to display")).toBeInTheDocument();
    expect(screen.queryByText("All registrations are synced")).not.toBeInTheDocument();
  });
});
