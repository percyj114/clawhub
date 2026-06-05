/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSettingsPage } from "../routes/plugins/$name/settings";

const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: { component?: unknown; beforeLoad?: unknown; loader?: unknown; head?: unknown }) => ({
      __config: config,
      useParams: () => ({ name: "demo-plugin" }),
    }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

describe("plugin settings route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("shows plugin inspector warnings to package managers", () => {
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getManageContext") {
        return {
          package: { _id: "packages:demo", name: "demo-plugin", displayName: "Demo Plugin" },
          latestRelease: { version: "1.0.0" },
        };
      }
      if (name === "packages:listPackageInspectorWarningsForManager") {
        return [
          {
            packageName: "demo-plugin",
            version: "1.0.0",
            code: "legacy-before-agent-start",
            issueClass: "deprecation-warning",
            severity: "P2",
            message: "legacy before_agent_start hook is deprecated",
            evidence: ["src/index.ts:4"],
            createdAt: 1,
          },
        ];
      }
      return undefined;
    });

    render(<PluginSettingsPage name="demo-plugin" />);

    expect(screen.getByRole("heading", { name: "Warnings" })).toBeTruthy();
    expect(screen.getByText("legacy-before-agent-start")).toBeTruthy();
    expect(screen.getByText("legacy before_agent_start hook is deprecated")).toBeTruthy();
    expect(screen.getByText("deprecation-warning")).toBeTruthy();
  });

  it("does not expose warning details without manage access", () => {
    useQueryMock.mockImplementation((query: unknown) => {
      const name = getFunctionName(query as never);
      if (name === "packages:getManageContext") return null;
      return undefined;
    });

    render(<PluginSettingsPage name="demo-plugin" />);

    expect(screen.getByText("Plugin settings unavailable")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Warnings" })).toBeNull();
  });
});
