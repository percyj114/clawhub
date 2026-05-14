import { describe, expect, it } from "vitest";
import {
  classifyPortOwners,
  parseArgs,
  parseGitWorktreeList,
  parseLsofListeners,
} from "./worktree-preflight";

describe("worktree-preflight helpers", () => {
  it("parses CLI options", () => {
    expect(parseArgs(["--json", "--port", "3999"])).toEqual({ json: true, port: "3999" });
    expect(parseArgs(["--port=4111"])).toEqual({ json: false, port: "4111" });
  });

  it("parses git worktree porcelain output", () => {
    expect(
      parseGitWorktreeList(`worktree /Users/me/Git/openclaw/clawhub
HEAD abc123
branch refs/heads/main

worktree /tmp/clawhub-feature
HEAD def456
branch refs/heads/pe/feature
`),
    ).toEqual(["/Users/me/Git/openclaw/clawhub", "/tmp/clawhub-feature"]);
  });

  it("parses lsof listener output", () => {
    expect(
      parseLsofListeners(`COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
bun     12345 me     42u  IPv4 0x123456789abcdef0      0t0  TCP 127.0.0.1:3000 (LISTEN)
node    67890 me     21u  IPv6 0x123456789abcdef1      0t0  TCP *:5173 (LISTEN)
`),
    ).toEqual([
      { command: "bun", pid: 12345, name: "127.0.0.1:3000 (LISTEN)" },
      { command: "node", pid: 67890, name: "*:5173 (LISTEN)" },
    ]);
  });

  it("passes when no process owns the dev port", () => {
    expect(classifyPortOwners("3000", [], "/repo/current")).toMatchObject({
      status: "pass",
    });
  });

  it("warns when the current checkout already owns the dev port", () => {
    expect(
      classifyPortOwners(
        "3000",
        [{ command: "bun", cwd: "/repo/current", name: "TCP 127.0.0.1:3000", pid: 123 }],
        "/repo/current",
      ),
    ).toMatchObject({
      status: "warn",
      fix: "Reuse http://127.0.0.1:3000 or stop pid 123 before restarting.",
    });
  });

  it("fails when another checkout owns the dev port", () => {
    expect(
      classifyPortOwners(
        "3000",
        [{ command: "bun", cwd: "/repo/other", name: "TCP 127.0.0.1:3000", pid: 123 }],
        "/repo/current",
      ),
    ).toMatchObject({
      status: "fail",
      fix: "Run bun run dev:worktree -- --port <free-port> or stop pid 123.",
    });
  });
});
