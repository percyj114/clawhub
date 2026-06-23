/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createContentSecurityPolicy,
  isLocalDevelopmentRequestUrl,
} from "../src/lib/securityHeaders";

const repoRoot = resolve(import.meta.dirname, "..");
const bootstrapPath = resolve(repoRoot, "public/theme-bootstrap.js");

function getGlobalVercelHeaders() {
  const vercelConfig = JSON.parse(readFileSync(resolve(repoRoot, "vercel.json"), "utf8"));
  return vercelConfig.headers.find((entry) => entry.source === "/(.*)")?.headers ?? [];
}

function getCspHeader() {
  return createContentSecurityPolicy("test-nonce");
}

function getLocalDevelopmentCspHeader() {
  return createContentSecurityPolicy("test-nonce", { allowLocalDevelopment: true });
}

function getDirective(csp, name) {
  return (
    csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith(`${name} `)) ?? ""
  );
}

function getDirectiveTokens(csp, name) {
  return getDirective(csp, name).split(/\s+/u);
}

function runBootstrap() {
  window.eval(readFileSync(bootstrapPath, "utf8"));
}

describe("Vercel security headers", () => {
  afterEach(() => {
    window.localStorage.clear();
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
    }
    document.getElementById("clawhub-custom-theme-style")?.remove();
    document.getElementById("clawhub-custom-theme-fonts")?.remove();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeResolved;
    delete document.documentElement.dataset.themeMode;
    delete document.documentElement.dataset.themeFamily;
  });

  it("does not allow all inline scripts in the global CSP", () => {
    expect(getDirectiveTokens(getCspHeader(), "script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows the self-hosted theme bootstrap and nonce-tagged framework scripts", () => {
    expect(getDirectiveTokens(getCspHeader(), "script-src")).toEqual([
      "script-src",
      "'self'",
      "'nonce-test-nonce'",
      "'unsafe-eval'",
    ]);
  });

  it("documents the current eval allowance without reopening inline script execution", () => {
    const scriptTokens = getDirectiveTokens(getCspHeader(), "script-src");

    expect(scriptTokens).toContain("'unsafe-eval'");
    expect(scriptTokens).not.toContain("'unsafe-inline'");
  });

  it("does not emit a second static Vercel CSP that would block dynamic nonces", () => {
    expect(
      getGlobalVercelHeaders().some((header) => header.key === "Content-Security-Policy"),
    ).toBe(false);
  });

  it("keeps local Convex HTTP and WebSocket connections usable in local development", () => {
    const csp = getLocalDevelopmentCspHeader();
    const connectTokens = getDirectiveTokens(csp, "connect-src");

    expect(connectTokens).toEqual(["connect-src", "'self'", "https:", "wss:", "http:", "ws:"]);
    expect(csp).not.toContain("[::1]");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("keeps local docs auth form posts usable only in local development", () => {
    expect(getDirectiveTokens(getCspHeader(), "form-action")).toEqual([
      "form-action",
      "'self'",
      "https://clawhub.ai",
      "https://documentation.openclaw.ai",
      "https://docs.openclaw.ai",
    ]);

    expect(getDirectiveTokens(getLocalDevelopmentCspHeader(), "form-action")).toEqual([
      "form-action",
      "'self'",
      "https://clawhub.ai",
      "https://documentation.openclaw.ai",
      "https://docs.openclaw.ai",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
  });

  it("detects IPv4, IPv6, and localhost app origins as local development", () => {
    expect(isLocalDevelopmentRequestUrl("http://localhost:3000/")).toBe(true);
    expect(isLocalDevelopmentRequestUrl("http://127.0.0.1:3000/")).toBe(true);
    expect(isLocalDevelopmentRequestUrl("http://[::1]:3000/")).toBe(true);
    expect(isLocalDevelopmentRequestUrl("https://clawhub.ai/")).toBe(false);
  });

  it("loads the theme bootstrap as an external self-hosted script", () => {
    const rootRoute = readFileSync(resolve(repoRoot, "src/routes/__root.tsx"), "utf8");

    expect(rootRoute).toContain('src="/theme-bootstrap.js');
    expect(rootRoute).not.toContain("dangerouslySetInnerHTML");
  });

  it("applies the stored theme selection from the external bootstrap", () => {
    window.localStorage.setItem(
      "clawhub-theme-selection",
      JSON.stringify({ theme: "claw", mode: "dark" }),
    );

    runBootstrap();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeResolved).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.dataset.themeFamily).toBe("claw");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("cleans stale custom theme state from the external bootstrap", () => {
    window.localStorage.setItem(
      "clawhub-custom-theme",
      JSON.stringify({ light: { background: "red" }, dark: { background: "black" } }),
    );
    window.localStorage.setItem(
      "clawhub-theme-selection",
      JSON.stringify({ theme: "hub", mode: "dark" }),
    );
    window.localStorage.setItem("clawhub-theme", "dark");
    window.localStorage.setItem("clawhub-theme-name", "hub");
    window.localStorage.setItem(
      "clawhub-preferences",
      JSON.stringify({ layoutDensity: "compact" }),
    );
    document.cookie = "clawhub-custom-theme=1; path=/";
    document.cookie = "clawhub-preferences=1; path=/";

    const style = document.createElement("style");
    style.id = "clawhub-custom-theme-style";
    document.head.appendChild(style);
    const fonts = document.createElement("link");
    fonts.id = "clawhub-custom-theme-fonts";
    document.head.appendChild(fonts);
    document.documentElement.classList.add("theme-custom", "high-contrast", "reduce-motion");
    document.documentElement.dataset.density = "compact";
    document.documentElement.dataset.animation = "none";
    document.documentElement.style.setProperty("--code-font-size", "16px");

    runBootstrap();

    expect(window.localStorage.getItem("clawhub-custom-theme")).toBeNull();
    expect(window.localStorage.getItem("clawhub-preferences")).toBeNull();
    expect(window.localStorage.getItem("clawhub-theme")).toBe("system");
    expect(window.localStorage.getItem("clawhub-theme-name")).toBe("claw");
    expect(window.localStorage.getItem("clawhub-theme-selection")).toBe(
      JSON.stringify({ theme: "claw", mode: "system" }),
    );
    expect(document.cookie).not.toContain("clawhub-custom-theme");
    expect(document.cookie).not.toContain("clawhub-preferences");
    expect(document.getElementById("clawhub-custom-theme-style")).toBeNull();
    expect(document.getElementById("clawhub-custom-theme-fonts")).toBeNull();
    expect(document.documentElement.classList.contains("theme-custom")).toBe(false);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);
    expect(document.documentElement.dataset.density).toBeUndefined();
    expect(document.documentElement.dataset.animation).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--code-font-size")).toBe("");
    expect(document.documentElement.dataset.themeFamily).toBe("claw");
    expect(document.documentElement.dataset.themeMode).toBe("system");
  });
});
