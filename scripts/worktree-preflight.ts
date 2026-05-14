#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findSource } from "./setup-worktree";

type Status = "pass" | "warn" | "fail";

type Check = {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
};

type Listener = {
  command: string;
  pid: number;
  name: string;
};

type PortOwner = Listener & {
  cwd: string | null;
};

type Options = {
  port: string;
  json: boolean;
};

const DEFAULT_PORT = "3000";

export function parseArgs(argv: string[]): Options {
  const options: Options = { port: DEFAULT_PORT, json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--port") {
      options.port = argv[index + 1] ?? options.port;
      index += 1;
    } else if (arg.startsWith("--port=")) {
      options.port = arg.slice("--port=".length);
    }
  }

  return options;
}

export function parseGitWorktreeList(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length).trim()))
    .filter(Boolean);
}

export function parseLsofListeners(text: string): Listener[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines
    .slice(1)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[1]);
      if (!Number.isSafeInteger(pid)) return null;
      return {
        command: parts[0] ?? "unknown",
        pid,
        name: parts.slice(8).join(" "),
      };
    })
    .filter((listener): listener is Listener => listener !== null);
}

export function classifyPortOwners(port: string, owners: PortOwner[], cwd: string): Check {
  if (owners.length === 0) {
    return {
      name: `dev port ${port}`,
      status: "pass",
      detail: "No listener is currently bound to the default Vite port.",
    };
  }

  const currentRoot = resolve(cwd);
  const ownedByCurrent = owners.filter((owner) => owner.cwd && resolve(owner.cwd) === currentRoot);
  if (ownedByCurrent.length > 0) {
    return {
      name: `dev port ${port}`,
      status: "warn",
      detail: `Port ${port} is already in use by this checkout (pid ${ownedByCurrent[0].pid}).`,
      fix: `Reuse http://127.0.0.1:${port} or stop pid ${ownedByCurrent[0].pid} before restarting.`,
    };
  }

  const knownOwner = owners.find((owner) => owner.cwd);
  if (knownOwner) {
    return {
      name: `dev port ${port}`,
      status: "fail",
      detail: `Port ${port} is owned by ${knownOwner.cwd} (pid ${knownOwner.pid}), not this checkout.`,
      fix: `Run bun run dev:worktree -- --port <free-port> or stop pid ${knownOwner.pid}.`,
    };
  }

  return {
    name: `dev port ${port}`,
    status: "warn",
    detail: `Port ${port} is in use, but the owning checkout could not be resolved.`,
    fix: `Run lsof -nP -iTCP:${port} -sTCP:LISTEN to inspect the owner.`,
  };
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function gitCheck(): Check {
  const branch = run("git", ["branch", "--show-current"]).output.trim() || "detached HEAD";
  const dirty = run("git", ["status", "--short"]).output.trim();
  if (dirty) {
    return {
      name: "git checkout",
      status: "warn",
      detail: `${branch} has uncommitted changes.`,
      fix: "Run git status --short before copying commands between worktrees.",
    };
  }

  return {
    name: "git checkout",
    status: "pass",
    detail: `${branch} is clean.`,
  };
}

function dependencyCheck(): Check {
  if (existsSync("node_modules/.bin/vite")) {
    return {
      name: "dependencies",
      status: "pass",
      detail: "node_modules is present and includes Vite.",
    };
  }

  if (existsSync("node_modules")) {
    return {
      name: "dependencies",
      status: "fail",
      detail: "node_modules exists but is missing node_modules/.bin/vite.",
      fix: "Run bun install to refresh a stale or incomplete dependency tree.",
    };
  }

  return {
    name: "dependencies",
    status: "fail",
    detail: "node_modules is missing in this checkout.",
    fix: "Run bun run setup:worktree or bun install.",
  };
}

function worktreeSourceCheck(cwd: string): Check {
  try {
    const source = findSource({ force: false, from: null, quiet: true }, cwd);
    const current = resolve(cwd);
    if (resolve(source.path) !== current) {
      return {
        name: "env and Convex state",
        status: "fail",
        detail: `A usable source exists at ${source.path}, but this checkout is not linked to it.`,
        fix: "Run bun run setup:worktree.",
      };
    }

    return {
      name: "env and Convex state",
      status: "pass",
      detail: ".env.local and .convex local config agree.",
    };
  } catch (error) {
    return {
      name: "env and Convex state",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      fix: "Run bun run setup:worktree -- --from <known-good-clawhub-checkout>.",
    };
  }
}

function listWorktrees() {
  const result = run("git", ["worktree", "list", "--porcelain"]);
  if (result.status !== 0) return [];
  return parseGitWorktreeList(result.output);
}

function readPidCwd(pid: number) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  const pathLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("n/"));
  return pathLine ? pathLine.slice(1) : null;
}

function portCheck(port: string, cwd: string): Check {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  const owners =
    result.status === 0 && typeof result.stdout === "string"
      ? parseLsofListeners(result.stdout).map((listener) => ({
          ...listener,
          cwd: readPidCwd(listener.pid),
        }))
      : [];

  return classifyPortOwners(port, owners, cwd);
}

function worktreeIdentityCheck(cwd: string): Check {
  const current = resolve(cwd);
  const worktrees = listWorktrees();
  const primary = worktrees[0];
  if (!primary || resolve(primary) === current) {
    return {
      name: "worktree identity",
      status: "pass",
      detail: "This checkout is the primary worktree.",
    };
  }

  return {
    name: "worktree identity",
    status: "warn",
    detail: `This is a linked worktree. Primary checkout: ${primary}.`,
    fix: "Prefer bun run dev:worktree in linked worktrees so env, Convex, and dependencies are prepared first.",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const checks = [
    worktreeIdentityCheck(cwd),
    gitCheck(),
    worktreeSourceCheck(cwd),
    dependencyCheck(),
    portCheck(options.port, cwd),
  ];

  if (options.json) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    console.log("ClawHub worktree preflight");
    for (const check of checks) {
      const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
      console.log(`\n[${marker}] ${check.name}`);
      console.log(`  ${check.detail}`);
      if (check.fix) console.log(`  Fix: ${check.fix}`);
    }
  }

  if (checks.some((check) => check.status === "fail")) process.exit(1);
}

if (import.meta.main) {
  await main();
}
