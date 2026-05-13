import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PluginListItem } from "../components/PluginListItem";
import { SkillListItem } from "../components/SkillListItem";
import { Card } from "../components/ui/card";
import type { PublicSkill } from "../lib/publicUser";
import {
  useUnifiedSearch,
  type UnifiedSearchType,
  type UnifiedPluginResult,
  type UnifiedSkillResult,
} from "../lib/useUnifiedSearch";

const SEARCH_PAGE_SIZE = 25;

type SearchState = {
  q?: string;
  type?: UnifiedSearchType;
  nonSuspicious?: boolean;
};

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    type: search.type === "skills" || search.type === "plugins" ? search.type : undefined,
    nonSuspicious:
      search.nonSuspicious === false || search.nonSuspicious === "false" ? false : undefined,
  }),
  component: UnifiedSearchPage,
});

function UnifiedSearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const activeType = search.type ?? "all";
  // Unified search defaults to moderation-safe (skills with warnings hidden).
  // Keep the URL flag for compatibility even though the search UI no longer
  // exposes a warning filter control.
  const nonSuspiciousOnly = search.nonSuspicious ?? true;
  const [query, setQuery] = useState(search.q ?? "");
  const [resultLimit, setResultLimit] = useState(SEARCH_PAGE_SIZE);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setResultLimit(SEARCH_PAGE_SIZE);
  }, [search.q, activeType, nonSuspiciousOnly]);

  const {
    results: allResults,
    skillResults,
    pluginResults,
    skillCount,
    pluginCount,
    skillHasMore,
    pluginHasMore,
    isSearching,
  } = useUnifiedSearch(search.q ?? "", "all", {
    limits: {
      skills: resultLimit,
      plugins: resultLimit,
    },
    nonSuspiciousOnly,
  });
  const results: Array<UnifiedSkillResult | UnifiedPluginResult> =
    activeType === "all" ? allResults : activeType === "skills" ? skillResults : pluginResults;
  const shouldProbeReviewFilteredSkills = Boolean(
    search.q &&
    nonSuspiciousOnly &&
    activeType !== "plugins" &&
    !isSearching &&
    results.length === 0,
  );
  const { skillCount: reviewFilteredSkillCount, isSearching: isProbingReviewFilteredSkills } =
    useUnifiedSearch(search.q ?? "", "skills", {
      debounceMs: 0,
      enabled: shouldProbeReviewFilteredSkills,
      limits: {
        skills: 1,
        plugins: 0,
      },
      nonSuspiciousOnly: false,
    });
  const showSearchCounts = Boolean(search.q);
  const allCount = skillCount + pluginCount;
  const allHasMore = skillHasMore || pluginHasMore;
  const canLoadMore =
    search.q &&
    !isSearching &&
    ((activeType === "all" && allHasMore) ||
      (activeType === "skills" && skillHasMore) ||
      (activeType === "plugins" && pluginHasMore));
  const hasReviewFilteredSkills =
    shouldProbeReviewFilteredSkills &&
    !isProbingReviewFilteredSkills &&
    reviewFilteredSkillCount > 0;
  const hasOtherTypeMatches = activeType !== "all" && allCount > 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: "/search",
      search: {
        q: query.trim() || undefined,
        type: search.type,
        nonSuspicious: search.nonSuspicious,
      },
    });
  };

  const setType = (type: UnifiedSearchType) => {
    void navigate({
      to: "/search",
      search: {
        q: search.q,
        type: type === "all" ? undefined : type,
        nonSuspicious: search.nonSuspicious,
      },
      replace: true,
    });
  };

  const showReviewFilteredSkills = () => {
    void navigate({
      to: "/search",
      search: {
        q: search.q,
        type: search.type,
        nonSuspicious: false,
      },
      replace: true,
    });
  };

  const clearSearch = () => {
    setQuery("");
    void navigate({
      to: "/search",
      search: { q: undefined, type: search.type },
      replace: true,
    });
  };

  return (
    <main className="browse-page">
      <h1 className="browse-title mb-4">
        {search.q ? (
          <>
            Search results for <span className="text-[color:var(--accent)]">"{search.q}"</span>
          </>
        ) : (
          "Search"
        )}
      </h1>

      <form className="search-page-form" onSubmit={handleSearch}>
        <div className="browse-search-bar search-page-field max-w-[560px] flex-1">
          <Search size={16} className="navbar-search-icon" aria-hidden="true" />
          <input
            className="browse-search-input"
            type="text"
            placeholder="Search skills and plugins..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query ? (
            <button
              className="search-clear-button"
              type="button"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </form>

      <div className="search-tabs">
        <button
          className={`search-tab${activeType === "all" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("all")}
        >
          All{" "}
          {showSearchCounts ? (
            <span className="search-tab-count">{formatSearchCount(allCount, allHasMore)}</span>
          ) : null}
        </button>
        <button
          className={`search-tab${activeType === "skills" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("skills")}
        >
          Skills{" "}
          {showSearchCounts ? (
            <span className="search-tab-count">{formatSearchCount(skillCount, skillHasMore)}</span>
          ) : null}
        </button>
        <button
          className={`search-tab${activeType === "plugins" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("plugins")}
        >
          Plugins{" "}
          {showSearchCounts ? (
            <span className="search-tab-count">
              {formatSearchCount(pluginCount, pluginHasMore)}
            </span>
          ) : null}
        </button>
      </div>

      {isSearching ? (
        <Card>
          <div className="loading-indicator">Searching...</div>
        </Card>
      ) : !search.q ? (
        <Card className="text-center p-10">
          <p className="text-ink-soft">Enter a search term to find skills and plugins</p>
        </Card>
      ) : results.length === 0 ? (
        <SearchEmptyState
          activeType={activeType}
          hasOtherTypeMatches={hasOtherTypeMatches}
          hasReviewFilteredSkills={hasReviewFilteredSkills}
          onSearchAllTypes={() => setType("all")}
          onShowReviewFilteredSkills={showReviewFilteredSkills}
          query={search.q}
        />
      ) : (
        <>
          {activeType === "all" ? (
            <div className="search-results-sections">
              {skillResults.length > 0 ? (
                <SearchResultSection
                  countLabel={formatSearchCount(skillCount, skillHasMore)}
                  title="Skills"
                >
                  {skillResults.map((item) => (
                    <SkillResultRow key={`skill-${item.skill._id}`} result={item} />
                  ))}
                </SearchResultSection>
              ) : null}
              {pluginResults.length > 0 ? (
                <SearchResultSection
                  countLabel={formatSearchCount(pluginCount, pluginHasMore)}
                  title="Plugins"
                >
                  {pluginResults.map((item) => (
                    <PluginResultRow key={`plugin-${item.plugin.name}`} result={item} />
                  ))}
                </SearchResultSection>
              ) : null}
            </div>
          ) : (
            <div className="results-list">
              {results.map((item) =>
                item.type === "skill" ? (
                  <SkillResultRow key={`skill-${item.skill._id}`} result={item} />
                ) : (
                  <PluginResultRow key={`plugin-${item.plugin.name}`} result={item} />
                ),
              )}
            </div>
          )}
          {canLoadMore ? (
            <div className="search-load-more">
              <button
                type="button"
                className="search-load-more-button"
                onClick={() => setResultLimit((limit) => limit + SEARCH_PAGE_SIZE)}
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

function SearchEmptyState({
  activeType,
  hasOtherTypeMatches,
  hasReviewFilteredSkills,
  onSearchAllTypes,
  onShowReviewFilteredSkills,
  query,
}: {
  activeType: UnifiedSearchType;
  hasOtherTypeMatches: boolean;
  hasReviewFilteredSkills: boolean;
  onSearchAllTypes: () => void;
  onShowReviewFilteredSkills: () => void;
  query: string;
}) {
  const browseHref = activeType === "plugins" ? "/plugins" : "/skills";
  const browseLabel = activeType === "plugins" ? "Show all plugins" : "Show all skills";

  return (
    <Card className="search-empty-state">
      <p className="search-empty-title">No matches for "{query}"</p>
      <div className="search-empty-actions">
        {!hasReviewFilteredSkills && hasOtherTypeMatches ? (
          <button type="button" className="search-empty-action" onClick={onSearchAllTypes}>
            Search all types
          </button>
        ) : null}
        {hasReviewFilteredSkills ? (
          <button
            type="button"
            className="search-empty-action"
            onClick={onShowReviewFilteredSkills}
          >
            Show filtered skills
          </button>
        ) : null}
        <a className="search-empty-action" href={browseHref}>
          {browseLabel}
        </a>
      </div>
    </Card>
  );
}

function formatSearchCount(count: number, hasMore: boolean) {
  return hasMore ? `${count}+` : String(count);
}

function SearchResultSection({
  children,
  countLabel,
  title,
}: {
  children: React.ReactNode;
  countLabel: string;
  title: string;
}) {
  return (
    <section className="search-results-section" aria-label={title}>
      <div className="search-results-section-header">
        <h2 className="search-results-section-title">{title}</h2>
        <span className="search-results-section-count">{countLabel}</span>
      </div>
      <div className="results-list">{children}</div>
    </section>
  );
}

function SkillResultRow({ result }: { result: UnifiedSkillResult }) {
  const skill = result.skill as unknown as PublicSkill;
  return <SkillListItem skill={skill} ownerHandle={result.ownerHandle} />;
}

function PluginResultRow({ result }: { result: UnifiedPluginResult }) {
  return <PluginListItem item={result.plugin} />;
}
