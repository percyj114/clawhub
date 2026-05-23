const SKILL_CARD_FILE_PATH = "skill-card.md";

function isSkillCardPath(path: string) {
  return path.trim().toLowerCase() === SKILL_CARD_FILE_PATH;
}

export function selectSkillCardFile<T extends { path: string }>(files: T[]) {
  return files.find((file) => isSkillCardPath(file.path)) ?? null;
}

export function skillCardLoadKey(
  versionId: string | null | undefined,
  file: { path: string; sha256?: string | null } | null | undefined,
) {
  if (!versionId || !file) return null;
  return `${versionId}:${file.path.trim().toLowerCase()}:${file.sha256 ?? ""}`;
}
