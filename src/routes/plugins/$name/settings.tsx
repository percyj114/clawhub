import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Container } from "../../../components/layout/Container";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { buildPluginDetailHref } from "../../../lib/pluginRoutes";

type PluginInspectorWarning = {
  _id?: string;
  packageName: string;
  version: string;
  code: string;
  severity?: string;
  level?: string;
  issueClass?: string;
  compatStatus?: string;
  deprecated?: boolean;
  message: string;
  evidence?: string[];
  fixture?: string;
  decision?: string;
  createdAt?: number;
};

export const Route = createFileRoute("/plugins/$name/settings")({
  component: PluginSettingsRoute,
});

function PluginSettingsRoute() {
  const { name } = Route.useParams();
  return <PluginSettingsPage name={name} />;
}

export function PluginSettingsPage({ name }: { name: string }) {
  const manageContext = useQuery(api.packages.getManageContext, { name }) as
    | {
        package: { name: string; displayName?: string };
        latestRelease?: { version?: string } | null;
      }
    | null
    | undefined;
  const warnings = useQuery(
    api.packages.listPackageInspectorWarningsForManager,
    manageContext ? { name: manageContext.package.name, limit: 100 } : "skip",
  ) as PluginInspectorWarning[] | undefined;

  if (manageContext === undefined) {
    return (
      <main className="section">
        <Container>
          <Card>
            <CardHeader>
              <CardTitle>Plugin settings</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Loading plugin settings...</p>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  if (!manageContext) {
    return (
      <main className="section">
        <Container>
          <Card>
            <CardHeader>
              <CardTitle>Plugin settings unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Sign in with an owner or admin account to manage this plugin.
              </p>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  const packageName = manageContext.package.name;
  const displayName = manageContext.package.displayName || packageName;
  const warningItems = warnings ?? [];

  return (
    <main className="section">
      <Container>
        <div className="mb-6 flex flex-col gap-2">
          <a className="text-sm text-muted-foreground" href={buildPluginDetailHref(packageName)}>
            Back to plugin
          </a>
          <h1 className="section-title m-0">{displayName} Settings</h1>
        </div>

        <div className="tab-card">
          <div className="tab-header" role="tablist" aria-label="Plugin settings tabs">
            <a className="tab-button is-active" href="#warnings" role="tab" aria-selected="true">
              Warnings
            </a>
          </div>
          <section id="warnings" className="tab-body" aria-labelledby="plugin-warnings-heading">
            <h2
              id="plugin-warnings-heading"
              className="flex items-center gap-2 text-lg font-semibold text-[color:var(--ink)]"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Warnings
            </h2>
            {warnings === undefined ? (
              <p className="text-sm text-muted-foreground">Loading warnings...</p>
            ) : warningItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Plugin Inspector warnings have been recorded for this plugin.
              </p>
            ) : (
              <div className="space-y-3">
                {warningItems.map((warning, index) => (
                  <article
                    key={warning._id ?? `${warning.code}-${index}`}
                    className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">{warning.code}</Badge>
                      {warning.issueClass ? (
                        <Badge variant="compact">{warning.issueClass}</Badge>
                      ) : null}
                      {warning.severity ? (
                        <Badge variant="compact">{warning.severity}</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">v{warning.version}</span>
                    </div>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">{warning.message}</p>
                    {warning.evidence && warning.evidence.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {warning.evidence.slice(0, 4).map((entry) => (
                          <li key={entry} className="font-mono">
                            {entry}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
}
