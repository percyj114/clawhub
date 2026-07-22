import { createFileRoute, notFound } from "@tanstack/react-router";
import { ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { InstallCopyButton } from "../../../../components/InstallCopyButton";
import { Container } from "../../../../components/layout/Container";
import { convexHttp } from "../../../../convex/client";

export const Route = createFileRoute("/skills-sh/$owner/$repo/$slug")({
  loader: async ({ params }) => {
    const entry = await convexHttp.query(api.skillsShCatalog.getPublicEntry, params);
    if (!entry) throw notFound();
    return entry;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.displayName ?? "Skill"} - ClawHub` },
      { name: "description", content: loaderData?.summary ?? "ClawHub verified skill" },
    ],
  }),
  component: SkillsShCatalogEntryPage,
});

function SkillsShCatalogEntryPage() {
  const entry = Route.useLoaderData();
  const installCommand = `openclaw skills install ${entry.ref}`;
  const suspicious = entry.security.verdict === "suspicious";
  const VerdictIcon = suspicious ? ShieldAlert : ShieldCheck;
  return (
    <main className="py-10 sm:py-14">
      <Container size="narrow">
        <div className="flex flex-col gap-5 border-b border-[color:var(--oc-border-subtle)] pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="break-all font-mono text-xs text-[color:var(--oc-text-muted)]">
              {entry.ref}
            </p>
            <h1 className="mt-2 font-display text-3xl font-black leading-tight text-[color:var(--oc-text-primary)] sm:text-4xl">
              {entry.displayName}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--oc-text-secondary)] sm:text-base">
              {entry.summary}
            </p>
          </div>
          <div
            className={`inline-flex min-h-8 shrink-0 items-center gap-2 self-start rounded-[var(--oc-radius-control)] border px-3 text-sm font-semibold ${
              suspicious
                ? "border-status-warning-fg/30 bg-status-warning-bg text-status-warning-fg"
                : "border-status-success-fg/30 bg-status-success-bg text-status-success-fg"
            }`}
          >
            <VerdictIcon aria-hidden="true" size={16} />
            ClawHub {entry.security.verdict}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-6 py-7 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">Owner</dt>
            <dd className="mt-1 min-w-0 text-sm text-[color:var(--oc-text-primary)]">
              <a
                className="inline-flex max-w-full items-center gap-1.5 hover:text-[color:var(--oc-accent-primary)]"
                href={entry.owner.githubUrl}
                target="_blank"
                rel="noreferrer"
              >
                {entry.owner.handle}
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">Repository</dt>
            <dd className="mt-1 break-all font-mono text-sm text-[color:var(--oc-text-primary)]">
              {entry.repository}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">Path</dt>
            <dd className="mt-1 break-all font-mono text-sm text-[color:var(--oc-text-primary)]">
              {entry.githubPath}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">Commit</dt>
            <dd className="mt-1 min-w-0">
              <code className="block break-all text-sm text-[color:var(--oc-text-primary)]">
                {entry.githubCommit}
              </code>
            </dd>
          </div>
        </dl>

        <section
          className="border-t border-[color:var(--oc-border-subtle)] pt-7"
          aria-labelledby="skills-sh-install-title"
        >
          <h2
            id="skills-sh-install-title"
            className="font-display text-lg font-bold text-[color:var(--oc-text-primary)]"
          >
            Install
          </h2>
          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-[var(--oc-radius-inset)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-surface)] p-2 pl-3">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-[color:var(--oc-text-primary)]">
              {installCommand}
            </code>
            <InstallCopyButton
              text={installCommand}
              ariaLabel="Copy OpenClaw install command"
              showLabel={false}
              variant="ghost"
              size="icon-sm"
            />
          </div>
        </section>
      </Container>
    </main>
  );
}
