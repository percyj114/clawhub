type EmailFinding = {
  code: string;
  issueClass?: string;
  message: string;
};

type InspectorEmail = {
  subject: string;
  text: string;
};

export function renderPluginInspectorBlockedPublishEmail(args: {
  packageName: string;
  version: string;
  findings: EmailFinding[];
}): InspectorEmail {
  return {
    subject: `Plugin publish blocked for ${args.packageName}@${args.version}`,
    text: [
      `Your ClawHub publish for ${args.packageName}@${args.version} was blocked by Plugin Inspector.`,
      "",
      "Fix the hard findings below and publish again:",
      "",
      ...formatFindings(args.findings),
    ].join("\n"),
  };
}

export function renderPluginInspectorWarningsEmail(args: {
  packageName: string;
  version: string;
  warningUrl: string;
  warnings: EmailFinding[];
}): InspectorEmail {
  return {
    subject: `Plugin Inspector warnings for ${args.packageName}@${args.version}`,
    text: [
      `Your ClawHub publish for ${args.packageName}@${args.version} was published, but Plugin Inspector found non-blocking warnings.`,
      "",
      "Review the warnings:",
      args.warningUrl,
      "",
      ...formatFindings(args.warnings),
    ].join("\n"),
  };
}

function formatFindings(findings: EmailFinding[]) {
  if (findings.length === 0) return ["- No findings were included."];
  return findings.map((finding) => {
    const label = finding.issueClass ? `${finding.code} (${finding.issueClass})` : finding.code;
    return `- ${label}: ${finding.message}`;
  });
}
