import { describe, expect, it } from "vitest";
import {
  renderPluginInspectorBlockedPublishEmail,
  renderPluginInspectorWarningsEmail,
} from "./packageInspectorEmailTemplates";

describe("package inspector email templates", () => {
  it("renders blocked publish copy with hard findings", () => {
    const email = renderPluginInspectorBlockedPublishEmail({
      packageName: "demo-plugin",
      version: "1.0.0",
      findings: [
        {
          code: "missing-expected-seam",
          message: "missing expected registration registerTool",
        },
      ],
    });

    expect(email.subject).toContain("demo-plugin");
    expect(email.text).toContain("blocked");
    expect(email.text).toContain("missing-expected-seam");
    expect(email.text).toContain("missing expected registration registerTool");
  });

  it("renders warning-only publish copy with non-blocking findings", () => {
    const email = renderPluginInspectorWarningsEmail({
      packageName: "demo-plugin",
      version: "1.0.0",
      warningUrl: "https://clawhub.ai/plugins/demo-plugin/settings#warnings",
      warnings: [
        {
          code: "legacy-before-agent-start",
          issueClass: "deprecation-warning",
          message: "legacy before_agent_start hook is deprecated",
        },
      ],
    });

    expect(email.subject).toContain("warnings");
    expect(email.text).toContain("published");
    expect(email.text).toContain("legacy-before-agent-start");
    expect(email.text).toContain("https://clawhub.ai/plugins/demo-plugin/settings#warnings");
  });
});
