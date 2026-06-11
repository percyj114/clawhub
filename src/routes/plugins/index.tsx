import { createFileRoute, redirect } from "@tanstack/react-router";
import { isPluginCategorySlug } from "clawhub-schema";
import { PackageSearch, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { formatBrowseCount } from "../../lib/browseCount";
import { PLUGIN_CATEGORIES } from "../../lib/categories";
import {
  fetchPluginCatalog,
  isRateLimitedPackageApiError,
  type PackageListItem,
} from "../../lib/packageApi";

type PluginSort = "relevance" | "updated" | "downloads" | "newest" | "name";

const PLUGINS_PAGE_SIZE = 25;

type PluginSearchState = {
  q?: string;
  category?: string;
  cursor?: string;
  family?: undefined;
  featured?: boolean;
  official?: boolean;
  executesCode?: boolean;
  sort?: PluginSort;
  view?: LegacyPluginView;
};

type PluginView = "list" | "grid";
type LegacyPluginView = PluginView | "cards";

function normalizePluginView(value: unknown): PluginView | undefined {
  if (value === "list") return "list";
  if (value === "grid" || value === "cards") return "grid";
  return undefined;
}

type PluginsLoaderData = {
  items: PackageListItem[];
  nextCursor: string | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  totalCount?: number | null;
  isLoading?: boolean;
  apiError?: boolean;
};

type PluginsPageDataRequest = {
  q?: string;
  category?: string;
  cursor?: string;
  featured?: boolean;
  official?: boolean;
  executesCode?: boolean;
  sort?: PluginSort;
  signal?: AbortSignal;
};

function createPluginsLoadingData(): PluginsLoaderData {
  return {
    items: [],
    nextCursor: null,
    rateLimited: false,
    retryAfterSeconds: null,
    totalCount: null,
    isLoading: true,
    apiError: false,
  };
}

function formatRetryDelay(retryAfterSeconds: number | null) {
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return "in a moment";
  if (retryAfterSeconds < 60) {
    return `in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function parsePluginSort(value: unknown): PluginSort | undefined {
  if (
    value === "relevance" ||
    value === "updated" ||
    value === "downloads" ||
    value === "newest" ||
    value === "name"
  ) {
    return value;
  }
  return undefined;
}

function sortPluginSearchItems(items: PackageListItem[], sort: PluginSort) {
  if (sort === "relevance") return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    const tieBreak = () =>
      b.updatedAt - a.updatedAt ||
      b.createdAt - a.createdAt ||
      a.family.localeCompare(b.family) ||
      a.name.localeCompare(b.name);

    if (sort === "name") {
      return (
        a.displayName.localeCompare(b.displayName) ||
        a.name.localeCompare(b.name) ||
        a.family.localeCompare(b.family)
      );
    }

    if (sort === "newest") {
      return (
        b.createdAt - a.createdAt ||
        b.updatedAt - a.updatedAt ||
        a.family.localeCompare(b.family) ||
        a.name.localeCompare(b.name)
      );
    }

    if (sort === "downloads") {
      return (b.stats?.downloads ?? 0) - (a.stats?.downloads ?? 0) || tieBreak();
    }

    return tieBreak();
  });
  return sorted;
}

function isNavigationAbortError(err: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === "AbortError";
}

export async function loadPluginsPageData(
  args: PluginsPageDataRequest,
): Promise<PluginsLoaderData> {
  try {
    const data = await fetchPluginCatalog({
      q: args.q,
      category: args.category,
      cursor: args.q ? undefined : args.cursor,
      featured: args.featured,
      isOfficial: args.official,
      executesCode: args.executesCode,
      ...(!args.q && args.sort === "downloads" ? { sort: args.sort } : {}),
      limit: PLUGINS_PAGE_SIZE,
      signal: args.signal,
    });

    return {
      items: data?.items ?? [],
      nextCursor: data?.nextCursor ?? null,
      totalCount: data?.totalCount ?? null,
      rateLimited: false,
      retryAfterSeconds: null,
      isLoading: false,
      apiError: false,
    };
  } catch (error) {
    if (isNavigationAbortError(error, args.signal)) throw error;
    if (isRateLimitedPackageApiError(error)) {
      return {
        items: [],
        nextCursor: null,
        rateLimited: true,
        retryAfterSeconds: error.retryAfterSeconds,
        totalCount: null,
        isLoading: false,
        apiError: false,
      };
    }

    return {
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
      totalCount: null,
      isLoading: false,
      apiError: true,
    };
  }
}

export const Route = createFileRoute("/plugins/")({
  pendingComponent: PluginsIndexPending,
  validateSearch: (search): PluginSearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim() : undefined,
    category:
      typeof search.category === "string" && isPluginCategorySlug(search.category)
        ? search.category
        : undefined,
    cursor: typeof search.cursor === "string" && search.cursor ? search.cursor : undefined,
    featured:
      search.featured === true || search.featured === "true" || search.featured === "1"
        ? true
        : undefined,
    official:
      search.official === true ||
      search.official === "true" ||
      search.official === "1" ||
      search.verified === true ||
      search.verified === "true" ||
      search.verified === "1"
        ? true
        : undefined,
    executesCode:
      search.executesCode === true || search.executesCode === "true" || search.executesCode === "1"
        ? true
        : undefined,
    sort: parsePluginSort(search.sort),
    view: normalizePluginView(search.view),
  }),
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    const incompatibleSort =
      !hasQuery && search.sort && search.sort !== "updated" && search.sort !== "downloads";
    const browseOnlyFeatured = hasQuery && search.featured;
    const invalidCategory = Boolean(search.category && !isPluginCategorySlug(search.category));
    if (incompatibleSort || browseOnlyFeatured || invalidCategory) {
      throw redirect({
        to: "/plugins",
        search: {
          ...search,
          category: invalidCategory ? undefined : search.category,
          featured: browseOnlyFeatured ? undefined : search.featured,
          sort: incompatibleSort ? undefined : search.sort,
        },
        replace: true,
      });
    }
  },
  loader: (): PluginsLoaderData => createPluginsLoadingData(),
  component: PluginsIndex,
});

function PluginsIndexPending() {
  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button className="browse-sidebar-toggle" type="button" disabled>
          Filters
        </button>
        <h1 className="browse-title">Plugins</h1>
        <div className="browse-view-toggle">
          <button className="browse-view-btn is-active" type="button" disabled>
            List
          </button>
          <button className="browse-view-btn" type="button" disabled>
            Grid
          </button>
        </div>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          className="browse-search-input"
          aria-label="Search plugins"
          placeholder="Search plugins..."
          disabled
        />
      </div>
      <div className="browse-layout">
        <BrowseSidebar
          categories={PLUGIN_CATEGORIES}
          activeCategory={undefined}
          onCategoryChange={() => {}}
          sortOptions={[
            { value: "featured", label: "Featured" },
            { value: "downloads", label: "Most downloaded" },
            { value: "updated", label: "Recently updated" },
          ]}
          activeSort="updated"
          onSortChange={() => {}}
          filters={[
            { key: "official", label: "Official only", active: false },
            { key: "executesCode", label: "Executes code", active: false },
          ]}
          onFilterToggle={() => {}}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">Loading results</span>
          </div>
          <BrowseResultsSkeleton />
        </div>
      </div>
    </main>
  );
}

function PluginsIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const initialLoaderData = Route.useLoaderData() as PluginsLoaderData | undefined;
  const [catalogData, setCatalogData] = useState<PluginsLoaderData>(
    () => initialLoaderData ?? createPluginsLoadingData(),
  );
  const shouldKeepInitialDataRef = useRef(
    Boolean(initialLoaderData && !initialLoaderData.isLoading),
  );

  // Defensive handling for when loader data is unavailable (SSR errors, etc.)
  const items = catalogData.items;
  const nextCursor = catalogData.nextCursor;
  const rateLimited = catalogData.rateLimited;
  const retryAfterSeconds = catalogData.retryAfterSeconds;
  const totalCount = catalogData.totalCount ?? null;
  const isLoading = catalogData.isLoading ?? false;
  const apiError = catalogData.apiError ?? false;
  const view = normalizePluginView(search.view) ?? "list";

  const [query, setQuery] = useState(search.q ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  const hasQuery = Boolean(search.q?.trim());
  const hasActiveFilters =
    hasQuery ||
    Boolean(search.category) ||
    Boolean(search.official) ||
    Boolean(search.executesCode) ||
    Boolean(search.featured);
  const formattedCount = !hasActiveFilters ? formatBrowseCount(totalCount) : null;

  useEffect(() => {
    if (shouldKeepInitialDataRef.current) {
      shouldKeepInitialDataRef.current = false;
      return () => {};
    }
    const controller = new AbortController();
    setCatalogData(createPluginsLoadingData());
    void loadPluginsPageData({
      q: search.q,
      category: search.category,
      cursor: search.cursor,
      featured: search.featured,
      official: search.official,
      executesCode: search.executesCode,
      sort: search.sort,
      signal: controller.signal,
    })
      .then((data) => setCatalogData(data))
      .catch((error) => {
        if (isNavigationAbortError(error, controller.signal)) return;
        setCatalogData({
          items: [],
          nextCursor: null,
          rateLimited: false,
          retryAfterSeconds: null,
          totalCount: null,
          isLoading: false,
          apiError: true,
        });
      });
    return () => controller.abort();
  }, [
    search.category,
    search.cursor,
    search.executesCode,
    search.featured,
    search.official,
    search.q,
    search.sort,
  ]);

  const activeCategory = search.category;

  const activeSort = hasQuery
    ? (search.sort ?? "relevance")
    : search.featured
      ? "featured"
      : (search.sort ?? "updated");
  const visibleItems = useMemo(
    () => (hasQuery ? sortPluginSearchItems(items, activeSort as PluginSort) : items),
    [activeSort, hasQuery, items],
  );

  const sortOptions = useMemo(() => {
    if (hasQuery) {
      return [
        { value: "relevance", label: "Relevance" },
        { value: "downloads", label: "Most downloaded" },
        { value: "updated", label: "Recently updated" },
        { value: "newest", label: "Newest" },
        { value: "name", label: "Name" },
      ];
    }
    return [
      { value: "featured", label: "Featured" },
      { value: "downloads", label: "Most downloaded" },
      { value: "updated", label: "Recently updated" },
    ];
  }, [hasQuery]);

  const handleFilterToggle = (key: string) => {
    if (key === "official") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          official: prev.official ? undefined : true,
        }),
      });
    } else if (key === "executesCode") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          executesCode: prev.executesCode ? undefined : true,
        }),
      });
    }
  };

  const handleSortChange = (value: string) => {
    if (value === "featured") {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          featured: true,
          family: undefined,
          q: undefined,
          sort: undefined,
        }),
      });
      return;
    }

    if (hasQuery) {
      void navigate({
        search: (prev: PluginSearchState) => ({
          ...prev,
          cursor: undefined,
          family: undefined,
          featured: undefined,
          sort: parsePluginSort(value) === "relevance" ? undefined : parsePluginSort(value),
        }),
        replace: true,
      });
      return;
    }

    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        featured: undefined,
        sort: parsePluginSort(value) === "updated" ? undefined : parsePluginSort(value),
      }),
      replace: true,
    });
  };

  const handleCategoryChange = (slug: string | undefined) => {
    const category = slug && isPluginCategorySlug(slug) ? slug : undefined;
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        category,
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        q: query.trim() || undefined,
        featured: undefined,
        sort: undefined,
      }),
    });
  };

  const handleToggleView = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        view: normalizePluginView(prev.view) === "grid" ? undefined : "grid",
      }),
      replace: true,
    });
  };

  const handleClear = () => {
    void navigate({
      search: (prev: PluginSearchState) => ({
        ...prev,
        cursor: undefined,
        family: undefined,
        q: undefined,
        category: undefined,
        official: undefined,
        executesCode: undefined,
        featured: undefined,
        sort: undefined,
      }),
      replace: true,
    });
    setQuery("");
  };

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button
          className="browse-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle filters"
        >
          Filters
        </button>
        <h1 className="browse-title">
          Plugins
          {formattedCount ? (
            <>
              {" "}
              <span className="browse-count">{formattedCount}</span>
            </>
          ) : null}
        </h1>
        <div className="browse-view-toggle">
          <button
            className={`browse-view-btn${view === "list" ? " is-active" : ""}`}
            type="button"
            onClick={view === "grid" ? handleToggleView : undefined}
          >
            List
          </button>
          <button
            className={`browse-view-btn${view === "grid" ? " is-active" : ""}`}
            type="button"
            onClick={view === "list" ? handleToggleView : undefined}
          >
            Grid
          </button>
        </div>
      </div>
      <form className="browse-page-search" onSubmit={handleSearch}>
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          className="browse-search-input"
          aria-label="Search plugins"
          placeholder="Search plugins..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={PLUGIN_CATEGORIES}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={sortOptions}
          activeSort={activeSort}
          onSortChange={handleSortChange}
          filters={[
            { key: "official", label: "Official only", active: search.official ?? false },
            { key: "executesCode", label: "Executes code", active: search.executesCode ?? false },
          ]}
          onFilterToggle={handleFilterToggle}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            {hasActiveFilters ? (
              <span className="browse-results-count">
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  Clear
                </button>
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <BrowseResultsSkeleton variant={view} />
          ) : apiError ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">Unable to load plugins</p>
              <p className="empty-state-body">
                The plugin catalog is temporarily unavailable. Please try again later.
              </p>
            </div>
          ) : rateLimited ? (
            <div className="empty-state">
              <PackageSearch size={22} className="empty-state-icon" aria-hidden="true" />
              <p className="empty-state-title">Plugin catalog is temporarily unavailable</p>
              <p className="empty-state-body">Try again {formatRetryDelay(retryAfterSeconds)}.</p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No plugins found</p>
              <p className="empty-state-body">Try a different search term or remove filters.</p>
            </div>
          ) : (
            <div className={view === "grid" ? "grid" : "results-list"}>
              {visibleItems.map((item) => (
                <PluginListItem
                  key={item.name}
                  item={item}
                  variant={view === "grid" ? "card" : "list"}
                />
              ))}
            </div>
          )}

          {!isLoading && !hasQuery && (search.cursor || nextCursor) ? (
            <div className="mt-5 flex justify-center gap-3">
              {search.cursor ? (
                <Button
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev: PluginSearchState) => ({ ...prev, cursor: undefined }),
                    });
                  }}
                >
                  First page
                </Button>
              ) : null}
              {nextCursor ? (
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => {
                    void navigate({
                      search: (prev: PluginSearchState) => ({ ...prev, cursor: nextCursor }),
                    });
                  }}
                >
                  Next page
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
