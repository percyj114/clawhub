import { describe, expect, it } from "vitest";
import {
  ACCOUNT_APPEAL_LINK_TEXT,
  ACCOUNT_APPEAL_URL,
  BANNED_SIGN_IN_MESSAGE,
  normalizeAuthErrorMessage,
} from "./authErrorMessage";

describe("authErrorMessage", () => {
  it("routes banned-account sign-in errors to the appeals site", () => {
    expect(normalizeAuthErrorMessage("Account banned", "fallback")).toBe(BANNED_SIGN_IN_MESSAGE);
    expect(BANNED_SIGN_IN_MESSAGE).toContain(ACCOUNT_APPEAL_LINK_TEXT);
    expect(ACCOUNT_APPEAL_URL).toBe("https://appeals.openclaw.ai/");
  });

  it("does not route deleted-account errors to appeals", () => {
    expect(
      normalizeAuthErrorMessage(
        "This account has been permanently deleted and cannot be restored.",
        "fallback",
      ),
    ).toBe("This ClawHub account was permanently deleted and cannot sign in again.");
  });
});
