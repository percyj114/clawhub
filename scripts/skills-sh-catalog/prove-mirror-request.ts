export function buildMirrorProofHeaders(
  operatorAuthorization: string,
  vercelAutomationBypassSecret?: string,
) {
  return {
    Authorization: `Bearer ${operatorAuthorization}`,
    "Content-Type": "application/json",
    ...(vercelAutomationBypassSecret?.trim()
      ? { "x-vercel-protection-bypass": vercelAutomationBypassSecret.trim() }
      : {}),
  };
}
