import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { UcLocation } from "@workspace/api-client-react";
import AdminLocationsPage from "./locations";

const api = vi.hoisted(() => ({
  locations: [] as UcLocation[],
  list: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  createUcAdminLocation: vi.fn(),
  getListUcAdminLocationsQueryKey: () => ["uc-admin-locations"],
  listUcAdminLocations: api.list,
  updateUcAdminLocation: api.update,
  useListUcAdminLocations: () => useQuery({
    queryKey: ["uc-admin-locations"],
    queryFn: api.list,
  }),
}));

vi.mock("./RatingsModeration", () => ({ RatingsModeration: () => null }));
vi.mock("./LocationAssessments", () => ({ LocationAssessments: () => null }));
vi.mock("@/lib/team-auth", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

function location(
  id: number,
  overrides: Partial<UcLocation> = {},
): UcLocation {
  return {
    id,
    name: `Location ${id}`,
    type: "experience_centre",
    address: `${id} Test Road`,
    hours: "08:00–17:00",
    phone: null,
    vendorName: null,
    lat: -1.286389,
    lng: 36.817223,
    active: true,
    verified: true,
    countryIso: null,
    city: null,
    accessNotes: null,
    municipal: null,
    sourceAttribution: null,
    lastFieldVerifiedOn: "2026-01-01",
    nextReviewOn: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminLocationsPage />
    </QueryClientProvider>,
  );
}

describe("admin location field-review warnings", () => {
  beforeEach(() => {
    // Fake only Date so query scheduling and Testing Library waits remain real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T09:00:00Z"));
    const today = "2026-10-04";
    api.locations = [
      location(1, { name: "Missing review date" }),
      location(2, { name: "Review due today", nextReviewOn: today }),
      location(3, { name: "Pending location", verified: false }),
      location(4, { name: "Inactive location", active: false }),
    ];
    api.list.mockReset();
    api.update.mockReset();
    api.list.mockImplementation(async () => ({ locations: api.locations }));
    api.update.mockImplementation(async (id: number, data: Partial<UcLocation>) => {
      const current = api.locations.find((item) => item.id === id);
      if (!current) throw new Error("Location not found");
      const updated = { ...current, ...data };
      api.locations = api.locations.map((item) => item.id === id ? updated : item);
      return { location: updated };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["before Nairobi midnight", "2026-10-03T20:59:59.999Z", "2026-10-04", false],
    ["at Nairobi midnight", "2026-10-03T21:00:00.000Z", "2026-10-04", true],
    ["after Nairobi midnight", "2026-10-03T21:00:00.001Z", "2026-10-04", true],
    ["before UTC midnight", "2026-10-03T23:59:59.999Z", "2026-10-04", true],
    ["after UTC midnight", "2026-10-04T00:00:00.000Z", "2026-10-04", true],
    ["before month rollover", "2026-10-31T20:59:59.999Z", "2026-11-01", false],
    ["at month rollover", "2026-10-31T21:00:00.000Z", "2026-11-01", true],
    ["before year rollover", "2026-12-31T20:59:59.999Z", "2027-01-01", false],
    ["at year rollover", "2026-12-31T21:00:00.000Z", "2027-01-01", true],
  ])("uses the business calendar %s", async (_label, instant, reviewDate, warned) => {
    vi.setSystemTime(new Date(instant));
    api.locations = [
      location(1, { nextReviewOn: reviewDate }),
      location(2, { nextReviewOn: "2026-01-01" }),
      location(3, { nextReviewOn: "2099-12-31" }),
      location(4),
      location(5, { nextReviewOn: reviewDate, verified: false }),
      location(6, { nextReviewOn: reviewDate, active: false }),
    ];
    renderPage();

    const card = await screen.findByTestId("card-location-1");
    expect(screen.getByText("Field-review dates use Africa/Nairobi time.")).toBeInTheDocument();
    const warning = within(card).queryByText(`Field review was due ${reviewDate}.`);
    if (warned) expect(warning).toBeInTheDocument();
    else expect(warning).not.toBeInTheDocument();
    expect(within(screen.getByTestId("card-location-2")).getByText(
      "Field review was due 2026-01-01.",
    )).toBeInTheDocument();
    expect(within(screen.getByTestId("card-location-3")).queryByText(/Field review was due/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("card-location-4")).getByText(
      "Published location has no next field-review date.",
    )).toBeInTheDocument();
    for (const id of [5, 6]) {
      expect(within(screen.getByTestId(`card-location-${id}`)).queryByText(/Field review was due/)).not.toBeInTheDocument();
    }
  });

  it("warns only for published locations with a missing or due review date", async () => {
    renderPage();

    const missing = await screen.findByTestId("card-location-1");
    const due = screen.getByTestId("card-location-2");
    const pending = screen.getByTestId("card-location-3");
    const inactive = screen.getByTestId("card-location-4");

    expect(within(missing).getByText("Published location has no next field-review date.")).toBeInTheDocument();
    expect(within(due).getByText(/Field review was due/)).toBeInTheDocument();
    expect(within(pending).queryByText(/field-review date|Field review was due/)).not.toBeInTheDocument();
    expect(within(inactive).queryByText(/field-review date|Field review was due/)).not.toBeInTheDocument();
  });

  it("clears the warning immediately after saving a future review date", async () => {
    renderPage();
    const card = await screen.findByTestId("card-location-1");
    expect(within(card).getByText("Published location has no next field-review date.")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const futureDate = "2099-12-31";
    fireEvent.change(screen.getByLabelText("Next review (optional)"), {
      target: { value: futureDate },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(api.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ nextReviewOn: futureDate }),
      );
      expect(within(screen.getByTestId("card-location-1")).queryByText(
        "Published location has no next field-review date.",
      )).not.toBeInTheDocument();
    });
    expect(within(screen.getByTestId("card-location-1")).getByText(
      new RegExp(`Next review: ${futureDate}`),
    )).toBeInTheDocument();
  });
});