/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { PublicPublisherListItem } from "../lib/publicUser";

const { actionMock, mutationMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  mutationMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => actionMock,
  useMutation: () => mutationMock,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("GitHubSyncPanel", () => {
  beforeEach(() => {
    actionMock.mockReset();
    mutationMock.mockReset();
    actionMock.mockResolvedValue({ url: "https://github.com/apps/clawhub/installations/new" });
    mutationMock.mockResolvedValue({ ok: true });
  });

  it("renders repository controls and submits sync settings", async () => {
    const { GitHubSyncPanel } = await import("../routes/user/$handle");

    render(<GitHubSyncPanel publisher={publisher} repositories={[repository]} />);

    expect(screen.getByRole("heading", { name: "GitHub Sync" })).toBeTruthy();
    expect(screen.getByText("openclaw/skills")).toBeTruthy();
    expect(screen.getByLabelText("GitHub account ID")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("main"), { target: { value: "stable" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mutationMock).toHaveBeenCalledWith({
        repositoryId: "publisherGitHubRepositories:repo",
        syncRef: "stable",
        syncRoots: ["skills"],
        mode: "discover",
        enabled: true,
      });
    });
  });

  it("queues a repository sync", async () => {
    const { GitHubSyncPanel } = await import("../routes/user/$handle");

    render(<GitHubSyncPanel publisher={publisher} repositories={[repository]} />);
    fireEvent.click(screen.getByRole("button", { name: /sync/i }));

    await waitFor(() => {
      expect(mutationMock).toHaveBeenCalledWith({
        repositoryId: "publisherGitHubRepositories:repo",
      });
    });
  });
});

const publisher: PublicPublisherListItem = {
  _id: "publishers:org" as Id<"publishers">,
  _creationTime: 1,
  kind: "org",
  handle: "openclaw",
  displayName: "OpenClaw",
  image: undefined,
  bio: undefined,
  linkedUserId: undefined,
  stats: { skills: 0, packages: 0, installs: 0, downloads: 0, stars: 0 },
  publishedItems: [],
};

const repository: Doc<"publisherGitHubRepositories"> & { sourceLinkCount: number } = {
  _id: "publisherGitHubRepositories:repo" as Id<"publisherGitHubRepositories">,
  _creationTime: 1,
  publisherId: "publishers:org" as Id<"publishers">,
  githubLinkId: "publisherGitHubLinks:link" as Id<"publisherGitHubLinks">,
  installationId: "123",
  repoFullName: "openclaw/skills",
  repoId: "456",
  defaultBranch: "main",
  syncRef: "main",
  syncRoots: ["skills"],
  mode: "discover",
  enabled: true,
  lastSyncStatus: "idle",
  createdAt: 1,
  updatedAt: 1,
  sourceLinkCount: 2,
};
