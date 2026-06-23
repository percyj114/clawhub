/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const scannerPath = join(repoRoot, "scripts/check-staged-secrets.mjs");
const tempRepos = [];

afterEach(() => {
  for (const path of tempRepos.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status, `${args.join(" ")}\n${result.stderr}`).toBe(0);
}

function createTempGitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "clawhub-secret-scan-"));
  tempRepos.push(cwd);
  runGit(cwd, ["init"]);
  return cwd;
}

describe("check-staged-secrets", () => {
  it("blocks staged secrets without printing reconstructable secret material", () => {
    const cwd = createTempGitRepo();
    const token = ["gh", "p_", "A".repeat(30)].join("");
    writeFileSync(join(cwd, "leak.txt"), `token=${token}\n`, "utf8");
    runGit(cwd, ["add", "leak.txt"]);

    const result = spawnSync("node", [scannerPath], { cwd, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Secret scan blocked this commit.");
    expect(result.stderr).toContain("- leak.txt: matched GitHub token");
    expect(result.stderr).toContain("[REDACTED]");
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).not.toContain("ghp_");
  });

  it("redacts secret material from blocked staged paths", () => {
    const cwd = createTempGitRepo();
    const token = ["gh", "p_", "B".repeat(30)].join("");
    const secretDir = `leaks-${token}`;
    mkdirSync(join(cwd, secretDir));
    writeFileSync(join(cwd, secretDir, ".env.local"), "SAFE=value\n", "utf8");
    runGit(cwd, ["add", join(secretDir, ".env.local")]);

    const result = spawnSync("node", [scannerPath], { cwd, encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`- leaks-[REDACTED]/.env.local`);
    expect(result.stderr).toContain("sensitive file type should not be committed");
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).not.toContain("ghp_");
  });
});
