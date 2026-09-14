import { beforeEach, describe, expect, it } from "vitest";
import { canEdit, canView, getTeamUser } from "./team-auth";

const USER_KEY = "projecthub:user";

describe("team user permission normalization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("treats null permissions from an older member session as no access", () => {
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        id: "member-1",
        email: "member@example.com",
        name: "Member",
        role: "member",
        permissions: null,
      }),
    );

    expect(getTeamUser()?.permissions).toEqual({});
    expect(canView("dashboard")).toBe(false);
    expect(canEdit("dashboard")).toBe(false);
  });

  it("preserves valid member permissions", () => {
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        id: "member-2",
        email: "editor@example.com",
        name: "Editor",
        role: "member",
        permissions: { dashboard: "view", projects: "edit" },
      }),
    );

    expect(canView("dashboard")).toBe(true);
    expect(canEdit("dashboard")).toBe(false);
    expect(canView("projects")).toBe(true);
    expect(canEdit("projects")).toBe(true);
  });
});