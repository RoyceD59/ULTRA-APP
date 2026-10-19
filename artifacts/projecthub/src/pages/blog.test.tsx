import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CompanionBlogPage from "./blog";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function setupFetch(role: "admin" | "member", status = "draft", runs: Record<string, unknown>[] = []) {
  localStorage.setItem("projecthub:token", "test-session-token");
  const article = {
    id: "article-1",
    title: "Safe water after flooding",
    summary: "Steps to take after floodwater reaches a well.",
    content: "## Check the source\n\nUse a credible source before treatment.",
    category: "Water safety",
    status,
    origin: "human",
    rationale: "Common reader question.",
    sources: [{ url: "https://www.who.int/health-topics/drinking-water", title: "WHO" }],
    version: 2,
    ...(status === "published" ? {
      publishedSnapshot: {
        title: "Safe water after flooding",
        summary: "Steps to take after floodwater reaches a well.",
        body: "## Check the source\n\nUse a credible source before treatment.",
        category: "Water safety",
        sources: [{ url: "https://www.who.int/health-topics/drinking-water", title: "WHO" }],
      },
    } : {}),
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) {
      return jsonResponse({ id: "team-1", email: "editor@example.test", name: "Editor", role, isActive: true, permissions: {} });
    }
    if (url.endsWith("/uc/editor/blog/runs")) return jsonResponse({ runs });
    if (url.endsWith("/uc/editor/blog/draft-from-brief")) return jsonResponse({ run: { id: "run-1", status: "queued" }, reused: false }, 202);
    if (url.endsWith("/uc/editor/blog")) return jsonResponse({ articles: [article] });
    if (url.endsWith("/uc/editor/blog/article-1") && init?.method === "PATCH") return jsonResponse({ article });
    if (url.endsWith("/uc/editor/blog/article-1")) return jsonResponse({ article, history: [] });
    if (url.endsWith("/uc/editor/blog/article-1/publish")) return jsonResponse({ article: { ...article, status: "published" } });
    return jsonResponse({ error: "Unexpected request" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, article };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.umami;
});

describe("Companion Blog editorial workspace", () => {
  it("loads source details and keeps publishing controls hidden for a member", async () => {
    const { fetchMock } = setupFetch("member");
    render(<CompanionBlogPage />);

    fireEvent.click(await screen.findByTestId("button-select-blog-article-1"));
    expect(await screen.findByDisplayValue("Safe water after flooding")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("https://www.who.int/health-topics/drinking-water")).toBeInTheDocument();
    expect(await screen.findByText(/Publishing controls are available only to a live-verified admin/)).toBeInTheDocument();
    expect(screen.queryByTestId("button-publish-blog-article")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-reject-blog-article")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/uc/editor/blog/article-1"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }));
  });

  it("offers publish to a live admin and calls the approval endpoint", async () => {
    const track = vi.fn();
    window.umami = { track };
    const { fetchMock } = setupFetch("admin");
    render(<CompanionBlogPage />);

    fireEvent.click(await screen.findByTestId("button-select-blog-article-1"));
    const publishButton = await screen.findByTestId("button-publish-blog-article");
    fireEvent.click(publishButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/uc/editor/blog/article-1/publish"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    const calls = fetchMock.mock.calls;
    const saveIndex = calls.findIndex(([url, init]) => String(url).endsWith("/uc/editor/blog/article-1") && init?.method === "PATCH");
    const publishIndex = calls.findIndex(([url]) => String(url).endsWith("/uc/editor/blog/article-1/publish"));
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeLessThan(publishIndex);
    await waitFor(() => expect(track).toHaveBeenCalledWith("blog_published", { sourceCount: 1 }));
    expect(track).toHaveBeenCalledWith("blog_saved", { action: "update", sourceCount: 1 });
    expect(track.mock.calls).toHaveLength(2);
  });

  it("does not count a failed save or publish as a successful outcome", async () => {
    const { fetchMock } = setupFetch("admin");
    const successfulFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/uc/editor/blog/article-1") && init?.method === "PATCH") {
        return jsonResponse({ error: "Save failed" }, 500);
      }
      return successfulFetch(input, init);
    });
    const track = vi.fn();
    window.umami = { track };
    render(<CompanionBlogPage />);
    fireEvent.click(await screen.findByTestId("button-select-blog-article-1"));
    fireEvent.click(await screen.findByTestId("button-publish-blog-article"));
    expect(await screen.findByTestId("status-blog-error")).toHaveTextContent("Save failed");
    expect(track).not.toHaveBeenCalled();
  });

  it("offers revision publishing only when a published article working copy differs from its live snapshot", async () => {
    const { fetchMock } = setupFetch("admin", "published");
    render(<CompanionBlogPage />);

    fireEvent.click(await screen.findByTestId("button-select-blog-article-1"));
    const publishRevisionButton = await screen.findByTestId("button-publish-blog-revision");
    expect(publishRevisionButton).toBeDisabled();

    fireEvent.change(await screen.findByTestId("textarea-blog-summary"), {
      target: { value: "Updated advice for household water safety." },
    });
    expect(publishRevisionButton).toBeEnabled();
    expect(await screen.findByText(/current live article stays available; you do not need to unpublish first/i)).toBeInTheDocument();
    fireEvent.click(publishRevisionButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/uc/editor/blog/article-1/publish"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    const calls = fetchMock.mock.calls;
    const saveIndex = calls.findIndex(([url, init]) => String(url).endsWith("/uc/editor/blog/article-1") && init?.method === "PATCH");
    const publishIndex = calls.findIndex(([url]) => String(url).endsWith("/uc/editor/blog/article-1/publish"));
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeLessThan(publishIndex);
  });

  it("displays brief run summaries and errors in run health", async () => {
    setupFetch("member", "draft", [{
      id: "brief-run-1",
      runType: "brief",
      status: "failed",
      brief: "Explain household water storage.",
      resultSummary: "Research did not return usable sources.",
      error: "Research source request timed out.",
    }]);
    render(<CompanionBlogPage />);

    const runCard = await screen.findByTestId("card-blog-run-brief-run-1");
    expect(runCard).toHaveTextContent("Brief research run");
    expect(runCard).toHaveTextContent("Research did not return usable sources.");
    expect(runCard).toHaveTextContent("Explain household water storage.");
    expect(runCard).toHaveTextContent("Research source request timed out.");
    expect(runCard).not.toHaveTextContent("Weekly research run");
  });

  it("shows an accepted brief as queued rather than as a generation error", async () => {
    setupFetch("member");
    render(<CompanionBlogPage />);
    fireEvent.change(await screen.findByTestId("textarea-blog-brief"), {
      target: { value: "Explain safe household water storage." },
    });
    fireEvent.click(screen.getByTestId("button-generate-blog-draft"));

    expect(await screen.findByTestId("status-blog-generation")).toHaveTextContent("Your brief is queued for research and drafting.");
    expect(screen.queryByTestId("status-blog-error")).not.toBeInTheDocument();
  });
});