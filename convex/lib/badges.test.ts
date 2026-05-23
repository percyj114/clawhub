import { describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { buildBadgeMap } from "./badges";

describe("buildBadgeMap", () => {
  it("preserves official publisher source metadata", () => {
    const badges = buildBadgeMap([
      {
        _id: "skillBadges:official",
        _creationTime: 1,
        skillId: "skills:demo",
        kind: "official",
        byUserId: "users:admin",
        at: 123,
        sourcePublisherId: "publishers:openclaw",
      } as Doc<"skillBadges">,
      {
        _id: "skillBadges:highlighted",
        _creationTime: 1,
        skillId: "skills:demo",
        kind: "highlighted",
        byUserId: "users:admin",
        at: 124,
        sourcePublisherId: "publishers:openclaw",
      } as Doc<"skillBadges">,
    ]);

    expect(badges.official).toEqual({
      byUserId: "users:admin",
      at: 123,
      sourcePublisherId: "publishers:openclaw",
    });
    expect(badges.highlighted).toEqual({
      byUserId: "users:admin",
      at: 124,
    });
  });
});
