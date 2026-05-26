/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAuthStatusMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const navigateMock = vi.fn();
let searchMock: { skill?: string; plugin?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: ComponentType }) => ({
    __config: config,
    useSearch: () => searchMock,
  }),
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    to?: string;
    search?: Record<string, string | undefined>;
  }) => <a href={to ?? "/"}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("../components/management/SecurityScanOverview", () => ({
  SecurityScanOverview: () => <div>Security overview marker</div>,
}));

async function loadManagementRoute() {
  return (await import("./management")).Route as unknown as {
    __config: {
      component: ComponentType;
    };
  };
}

describe("management route", () => {
  beforeEach(() => {
    vi.resetModules();
    searchMock = {};
    navigateMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
    useQueryMock.mockReset();
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      args === "skip" ? undefined : [],
    );
    useAuthStatusMock.mockReset();
  });

  it("hides the management console from ordinary users", async () => {
    useAuthStatusMock.mockReturnValue({ me: { _id: "users:reader", role: "user" } });
    const route = await loadManagementRoute();
    const Component = route.__config.component;

    render(<Component />);

    expect(screen.getByText("Management only.")).toBeTruthy();
    expect(screen.queryByText("Security overview marker")).toBeNull();
  });

  it("shows the security scan overview inside the staff management console", async () => {
    useAuthStatusMock.mockReturnValue({ me: { _id: "users:moderator", role: "moderator" } });
    const route = await loadManagementRoute();
    const Component = route.__config.component;

    render(<Component />);

    expect(screen.getByText("Management console")).toBeTruthy();
    expect(screen.getByText("Security overview marker")).toBeTruthy();
  });
});
