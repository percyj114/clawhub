/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
let searchMock: {
  q?: string;
  type?: "all" | "skills" | "plugins";
  nonSuspicious?: boolean;
} = {};
const useUnifiedSearchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; validateSearch?: unknown }) => ({
    __config: config,
    useSearch: () => searchMock,
  }),
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/useUnifiedSearch", () => ({
  useUnifiedSearch: (...args: unknown[]) => useUnifiedSearchMock(...args),
}));

vi.mock("../components/PluginListItem", () => ({
  PluginListItem: ({ item }: { item: { name: string } }) => <div>{item.name}</div>,
}));

vi.mock("../components/SkillListItem", () => ({
  SkillListItem: ({ skill }: { skill: { slug: string } }) => <div>{skill.slug}</div>,
}));

vi.mock("../components/ui/card", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

async function loadRoute() {
  return (await import("../routes/search")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

describe("search route", () => {
  beforeEach(() => {
    searchMock = { q: "first" };
    navigateMock.mockReset();
    useUnifiedSearchMock.mockReset();
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [],
      skillCount: 0,
      pluginCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      isSearching: false,
    });
  });

  it("keeps the input synced with query param changes while mounted", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    const rendered = render(<Component />);

    const input = screen.getByPlaceholderText("Search skills and plugins...") as HTMLInputElement;
    expect(input.value).toBe("first");

    fireEvent.change(input, { target: { value: "draft" } });
    expect(input.value).toBe("draft");

    searchMock = { q: "second" };
    rendered.rerender(<Component />);

    expect(
      (screen.getByPlaceholderText("Search skills and plugins...") as HTMLInputElement).value,
    ).toBe("second");
  });

  it("does not render a public users search tab", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /users/i })).toBeNull();
  });

  it("shows zero counts consistently for active search tabs", async () => {
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "github-plugin" } }],
      skillCount: 0,
      pluginCount: 3,
      skillHasMore: false,
      pluginHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins 3" })).toBeTruthy();
  });

  it("clears the active search query from the input", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: undefined, type: undefined },
      replace: true,
    });
  });

  it("can request more results from global search", async () => {
    searchMock = { q: "weather", type: "skills" };
    const skills = Array.from({ length: 25 }, (_, index) => ({
      type: "skill",
      skill: {
        _id: `skill-${index}`,
        slug: `weather-${index}`,
        displayName: `Weather ${index}`,
        ownerUserId: "users:1",
        stats: { downloads: 0, stars: 0 },
        updatedAt: 1,
        createdAt: 1,
      },
      ownerHandle: "clawhub",
      score: 1,
    }));
    useUnifiedSearchMock.mockReturnValue({
      results: skills,
      skillResults: skills,
      pluginResults: [],
      skillCount: 25,
      pluginCount: 0,
      skillHasMore: true,
      pluginHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenCalledWith("weather", "all", {
      limits: { skills: 25, plugins: 25 },
      nonSuspiciousOnly: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(useUnifiedSearchMock).toHaveBeenCalledWith("weather", "all", {
      limits: { skills: 50, plugins: 50 },
      nonSuspiciousOnly: true,
    });
  });

  it("keeps inactive tab counts honest while rendering the active tab", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: [
        {
          type: "skill",
          skill: {
            _id: "skill-weather",
            slug: "weather",
            displayName: "Weather",
            ownerUserId: "users:1",
            stats: { downloads: 0, stars: 0 },
            updatedAt: 1,
            createdAt: 1,
          },
          ownerHandle: "clawhub",
          score: 1,
        },
        { type: "plugin", plugin: { name: "weather-plugin" } },
      ],
      skillResults: [
        {
          type: "skill",
          skill: {
            _id: "skill-weather",
            slug: "weather",
            displayName: "Weather",
            ownerUserId: "users:1",
            stats: { downloads: 0, stars: 0 },
            updatedAt: 1,
            createdAt: 1,
          },
          ownerHandle: "clawhub",
          score: 1,
        },
      ],
      pluginResults: [{ type: "plugin", plugin: { name: "weather-plugin" } }],
      skillCount: 1,
      pluginCount: 1,
      skillHasMore: false,
      pluginHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins 1" })).toBeTruthy();
    expect(screen.getByText("weather")).toBeTruthy();
    expect(screen.queryByText("weather-plugin")).toBeNull();
  });

  it("marks tab counts as partial when more results are available", async () => {
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "github-plugin" } }],
      skillCount: 0,
      pluginCount: 25,
      skillHasMore: false,
      pluginHasMore: true,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All 25+" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins 25+" })).toBeTruthy();
  });

  it("does not show load more only because the current page is full", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: Array.from({ length: 25 }, (_, index) => ({
        type: "skill",
        skill: {
          _id: `skill-${index}`,
          slug: `weather-${index}`,
          displayName: `Weather ${index}`,
          ownerUserId: "users:1",
          stats: { downloads: 0, stars: 0 },
          updatedAt: 1,
          createdAt: 1,
        },
        ownerHandle: "clawhub",
        score: 1,
      })),
      skillResults: [],
      pluginResults: [],
      skillCount: 25,
      pluginCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("links to skills browse when search has no matches", async () => {
    searchMock = { q: "zzzz", type: "skills" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText('No matches for "zzzz"')).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all skills" }).getAttribute("href")).toBe(
      "/skills",
    );
    expect(screen.queryByRole("link", { name: "Show all plugins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Search all types" })).toBeNull();
  });

  it("offers all-types recovery when the active type is empty but another type matched", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: [{ type: "plugin", plugin: { name: "weather-plugin" } }],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "weather-plugin" } }],
      skillCount: 0,
      pluginCount: 1,
      skillHasMore: false,
      pluginHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Search all types" }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/search",
        replace: true,
        search: expect.objectContaining({ type: undefined }),
      }),
    );
  });

  it("offers under-review skill recovery without changing the browse link", async () => {
    searchMock = { q: "risky", type: "skills" };
    useUnifiedSearchMock.mockImplementation(
      (_query: string, _type: string, options: { nonSuspiciousOnly?: boolean }) => {
        if (options.nonSuspiciousOnly === false) {
          return {
            results: [
              {
                type: "skill",
                skill: {
                  _id: "skill-hidden",
                  slug: "review-risky",
                  displayName: "Review Risky",
                  ownerUserId: "users:1",
                  stats: { downloads: 0, stars: 0 },
                  updatedAt: 1,
                  createdAt: 1,
                },
                ownerHandle: "clawhub",
                score: 1,
              },
            ],
            skillResults: [
              {
                type: "skill",
                skill: {
                  _id: "skill-hidden",
                  slug: "review-risky",
                  displayName: "Review Risky",
                  ownerUserId: "users:1",
                  stats: { downloads: 0, stars: 0 },
                  updatedAt: 1,
                  createdAt: 1,
                },
                ownerHandle: "clawhub",
                score: 1,
              },
            ],
            pluginResults: [],
            skillCount: 1,
            pluginCount: 0,
            skillHasMore: false,
            pluginHasMore: false,
            isSearching: false,
          };
        }
        return {
          results: [],
          skillResults: [],
          pluginResults: [],
          skillCount: 0,
          pluginCount: 0,
          skillHasMore: false,
          pluginHasMore: false,
          isSearching: false,
        };
      },
    );
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("link", { name: "Show all skills" }).getAttribute("href")).toBe(
      "/skills",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show filtered skills" }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/search",
        replace: true,
        search: expect.objectContaining({ nonSuspicious: false }),
      }),
    );
    expect(screen.queryByRole("button", { name: "Search all types" })).toBeNull();
  });

  it("defaults nonSuspiciousOnly to true when URL param is absent", async () => {
    searchMock = { q: "hello" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenCalledWith(
      "hello",
      "all",
      expect.objectContaining({ nonSuspiciousOnly: true }),
    );
  });

  it("passes nonSuspiciousOnly=false to the hook when URL opts out", async () => {
    searchMock = { q: "hello", nonSuspicious: false };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenCalledWith(
      "hello",
      "all",
      expect.objectContaining({ nonSuspiciousOnly: false }),
    );
  });

  it("does not render a warning filter chip while keeping the safe default", async () => {
    searchMock = { q: "hello" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /Hiding warnings/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Showing all skills/i })).toBeNull();
    expect(useUnifiedSearchMock).toHaveBeenCalledWith(
      "hello",
      "all",
      expect.objectContaining({ nonSuspiciousOnly: true }),
    );
  });

  it("does not render a warning filter chip when opted out", async () => {
    searchMock = { q: "hello", nonSuspicious: false };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /Hiding warnings/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Showing all skills/i })).toBeNull();
    expect(useUnifiedSearchMock).toHaveBeenCalledWith(
      "hello",
      "all",
      expect.objectContaining({ nonSuspiciousOnly: false }),
    );
  });

  it("does not render a warning-filter chip on the plugins tab", async () => {
    searchMock = { q: "hello", type: "plugins" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /warnings/i })).toBeNull();
  });
});
