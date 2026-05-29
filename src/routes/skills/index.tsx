import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { Button } from "../../components/ui/button";
import { SKILL_CATEGORIES } from "../../lib/categories";
import { formatCompactStat } from "../../lib/numberFormat";
import { parseDir, parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import {
  normalizeSkillsView,
  useSkillsBrowseModel,
  type SkillsSearchState,
} from "./-useSkillsBrowseModel";

const BROWSE_SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "downloads", label: "Most downloaded" },
  { value: "stars", label: "Most starred" },
  { value: "installs", label: "Most installed" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];

const SEARCH_SORT_OPTIONS = [
  { value: "downloads", label: "Most downloaded" },
  { value: "stars", label: "Most starred" },
  { value: "installs", label: "Most installed" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];

export const Route = createFileRoute("/skills/")({
  validateSearch: (search): SkillsSearchState => {
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === "string" ? parseSort(search.sort) : undefined,
      dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
      highlighted:
        search.highlighted === "1" || search.highlighted === "true" || search.highlighted === true
          ? true
          : undefined,
      featured:
        search.featured === "1" || search.featured === "true" || search.featured === true
          ? true
          : undefined,
      nonSuspicious:
        search.nonSuspicious === "1" ||
        search.nonSuspicious === "true" ||
        search.nonSuspicious === true
          ? true
          : undefined,
      view: normalizeSkillsView(search.view),
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  component: SkillsIndex,
});

export function SkillsIndex() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const totalSkills = useQuery(api.skills.countPublicSkills);
  const totalSkillsText = typeof totalSkills === "number" ? formatCompactStat(totalSkills) : null;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const model = useSkillsBrowseModel({
    navigate,
    search,
    searchInputRef,
  });

  const sortOptionsWithRelevance = model.hasQuery
    ? [{ value: "relevance", label: "Relevance" }, ...SEARCH_SORT_OPTIONS]
    : BROWSE_SORT_OPTIONS;

  const handleSortChange = useCallback(
    (value: string) => {
      if (value === "featured") {
        if (!model.featuredOnly) model.onToggleFeatured();
        return;
      }

      if (model.featuredOnly) {
        const nextSort = parseSort(value);
        void navigate({
          search: (prev: SkillsSearchState) => {
            const reusePreviousDir =
              prev.sort !== undefined &&
              prev.sort !== "recommended" &&
              prev.sort !== "default" &&
              prev.sort !== "relevance";
            return {
              ...prev,
              sort: nextSort,
              dir:
                nextSort === "recommended" || nextSort === "default"
                  ? undefined
                  : parseDir(reusePreviousDir ? prev.dir : undefined, nextSort),
              featured: undefined,
              highlighted: undefined,
            };
          },
          replace: true,
        });
        return;
      }

      model.onSortChange(value);
    },
    [model.featuredOnly, model.onSortChange, model.onToggleFeatured, navigate],
  );

  const handleClear = useCallback(() => {
    model.onQueryChange("");
    if (model.featuredOnly) model.onToggleFeatured();
    if (model.nonSuspiciousOnly) model.onToggleNonSuspicious();
  }, [
    model.featuredOnly,
    model.onQueryChange,
    model.onToggleFeatured,
    model.onToggleNonSuspicious,
    model.nonSuspiciousOnly,
  ]);

  const handleCategoryChange = useCallback(
    (slug: string | undefined) => {
      if (slug) {
        const cat = SKILL_CATEGORIES.find((c) => c.slug === slug);
        if (cat?.keywords[0]) {
          model.onQueryChange(cat.keywords[0]);
        }
      } else {
        model.onQueryChange("");
      }
    },
    [model.onQueryChange],
  );

  const activeCategory = useMemo(() => {
    if (!model.query) return undefined;
    return (
      SKILL_CATEGORIES.find((c) => c.keywords.some((k) => k === model.query.trim().toLowerCase()))
        ?.slug ?? undefined
    );
  }, [model.query]);

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
          Skills
          {totalSkillsText ? <span className="browse-count">{totalSkillsText}</span> : null}
        </h1>
        <div className="browse-page-actions">
          <Button asChild variant="primary">
            <Link to="/publish-skill" search={{ updateSlug: undefined }}>
              Publish
            </Link>
          </Button>
        </div>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="browse-search-input"
          value={model.query}
          onChange={(event) => model.onQueryChange(event.target.value)}
          placeholder="Search skills..."
        />
      </div>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={SKILL_CATEGORIES}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={[{ value: "featured", label: "Featured" }, ...sortOptionsWithRelevance]}
          activeSort={model.featuredOnly ? "featured" : model.sort}
          onSortChange={handleSortChange}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {model.isLoadingSkills ? "\u2014" : `${model.sorted.length} results`}
              {model.hasQuery || model.featuredOnly || model.nonSuspiciousOnly ? (
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  Clear
                </button>
              ) : null}
            </span>
            <div className="browse-results-actions">
              {model.showSuspiciousFilter ? (
                <label className="browse-toolbar-checkbox">
                  <input
                    type="checkbox"
                    checked={model.nonSuspiciousOnly}
                    onChange={model.onToggleNonSuspicious}
                  />
                  <span>Hide suspicious</span>
                </label>
              ) : null}
              <div className="browse-view-toggle">
                <button
                  className={`browse-view-btn${model.view === "list" ? " is-active" : ""}`}
                  type="button"
                  onClick={model.view === "grid" ? model.onToggleView : undefined}
                >
                  List
                </button>
                <button
                  className={`browse-view-btn${model.view === "grid" ? " is-active" : ""}`}
                  type="button"
                  onClick={model.view === "list" ? model.onToggleView : undefined}
                >
                  Grid
                </button>
              </div>
            </div>
          </div>
          <SkillsResults
            isLoadingSkills={model.isLoadingSkills}
            sorted={model.sorted}
            view={model.view}
            listDoneLoading={!model.isLoadingSkills && !model.canLoadMore && !model.isLoadingMore}
            hasQuery={model.hasQuery}
            canLoadMore={model.canLoadMore}
            isLoadingMore={model.isLoadingMore}
            canAutoLoad={model.canAutoLoad}
            loadMoreRef={model.loadMoreRef}
            loadMore={model.loadMore}
          />
        </div>
      </div>
    </main>
  );
}
