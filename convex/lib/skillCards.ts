import { hashSkillFiles } from "./skills";

export const SKILL_CARD_FILE_PATH = "skill-card.md";

export type SkillCardFile = {
  path: string;
  size: number;
  storageId: unknown;
  sha256: string;
  contentType?: string;
};

export function isSkillCardPath(path: string) {
  return path.trim().toLowerCase() === SKILL_CARD_FILE_PATH;
}

export function selectSkillCardFile<T extends { path: string }>(files: T[]) {
  return files.find((file) => isSkillCardPath(file.path)) ?? null;
}

export async function buildBundleFingerprint(files: Array<{ path: string; sha256: string }>) {
  return await hashSkillFiles(files.map((file) => ({ path: file.path, sha256: file.sha256 })));
}

export async function replaceGeneratedSkillCardFile<T extends SkillCardFile>(
  files: T[],
  cardFile: T,
) {
  const replaced: T[] = [];
  let found = false;
  for (const file of files) {
    if (isSkillCardPath(file.path)) {
      if (!found) replaced.push(cardFile);
      found = true;
      continue;
    }
    replaced.push(file);
  }
  if (!found) replaced.push(cardFile);
  const bundleFingerprint = await buildBundleFingerprint(replaced);
  return { files: replaced, bundleFingerprint };
}

export function normalizeSkillCardSecurityStatus(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized === "clean" || normalized === "benign") return "clean";
  if (normalized === "suspicious" || normalized === "review") return "suspicious";
  if (normalized === "malicious") return "malicious";
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "completed") return "pending";
  return normalized;
}

export function hasSettledSkillCardInputs(version: {
  staticScan?: unknown;
  llmAnalysis?: { status?: string; verdict?: string };
}) {
  const status = normalizeSkillCardSecurityStatus(
    version.llmAnalysis?.verdict ?? version.llmAnalysis?.status,
  );
  return Boolean(version.staticScan && ["clean", "suspicious", "malicious"].includes(status));
}
