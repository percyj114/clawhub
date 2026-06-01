import { ConvexError } from "convex/values";
import { normalizeRepoPath } from "./githubImport";
import { normalizeSkillSlug } from "./skillSlugValidator";

export type GitHubWebhookVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-secret" | "missing-signature" | "malformed-signature" | "bad-signature";
    };

export type GitHubAppStatePayload = {
  publisherId: string;
  requestedByUserId: string;
  nonce: string;
  targetAccountId?: string;
  exp: number;
};

const DEFAULT_SETUP_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SYNC_ROOTS = 25;

export function normalizeGitHubRepoFullName(value: string) {
  const trimmed = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "");
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export function normalizeGitHubSyncRef(value: string | undefined | null, defaultBranch: string) {
  const raw = value?.trim() || defaultBranch.trim();
  if (!raw) throw new ConvexError("Sync ref is required");
  return raw.replace(/^refs\/heads\//, "");
}

export function normalizeGitHubSyncRoots(roots: string[] | undefined | null) {
  const normalized = new Set<string>();
  for (const root of roots?.length ? roots : [""]) {
    const trimmed = root.trim();
    if (!trimmed) {
      normalized.add("");
      continue;
    }
    const value = normalizeRepoPath(root);
    if (!value) throw new ConvexError("Invalid sync root");
    normalized.add(value);
    if (normalized.size > MAX_SYNC_ROOTS) throw new ConvexError("Too many sync roots");
  }
  return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

export function isPathUnderAnyRoot(path: string, roots: string[]) {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedRoots = normalizeGitHubSyncRoots(roots);
  if (normalizedRoots.includes("")) return true;
  return normalizedRoots.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(`${root}/`),
  );
}

export function deriveSlugFromCandidatePath(candidatePath: string, repoFullName: string) {
  const repoName = repoFullName.split("/").at(1) ?? repoFullName;
  const base = candidatePath ? (candidatePath.split("/").at(-1) ?? candidatePath) : repoName;
  return normalizeSkillSlug(
    base
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .replace(/--+/g, "-"),
  );
}

export function sourceLinkMatchesProvenance(params: {
  link: { repoFullName: string; path: string; status: string };
  sourceProvenance?: { kind: "github"; repo: string; path?: string } | null;
  sourceSync?: { sourceLinkId: string } | null;
  expectedSourceLinkId: string;
}) {
  if (params.link.status === "disabled") return false;
  if (params.sourceSync?.sourceLinkId !== params.expectedSourceLinkId) return false;
  const provenance = params.sourceProvenance;
  if (!provenance || provenance.kind !== "github") return false;
  return (
    normalizeGitHubRepoFullName(provenance.repo)?.toLowerCase() ===
      normalizeGitHubRepoFullName(params.link.repoFullName)?.toLowerCase() &&
    normalizeRepoPath(provenance.path ?? "") === normalizeRepoPath(params.link.path)
  );
}

export async function signGitHubAppState(
  payload: Omit<GitHubAppStatePayload, "exp"> & { exp?: number },
  secret: string,
  now = Date.now(),
) {
  const exp = payload.exp ?? now + DEFAULT_SETUP_STATE_TTL_MS;
  const body = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        publisherId: payload.publisherId,
        requestedByUserId: payload.requestedByUserId,
        nonce: payload.nonce,
        targetAccountId: payload.targetAccountId,
        exp,
      } satisfies GitHubAppStatePayload),
    ),
  );
  const signature = await hmacSha256Base64Url(secret, body);
  return `${body}.${signature}`;
}

export async function verifyGitHubAppState(
  state: string,
  secret: string,
  now = Date.now(),
): Promise<GitHubAppStatePayload> {
  const [body, signature, extra] = state.split(".");
  if (!body || !signature || extra) throw new ConvexError("Invalid GitHub setup state");
  const expected = await hmacSha256Base64Url(secret, body);
  if (!timingSafeEqual(signature, expected)) throw new ConvexError("Invalid GitHub setup state");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    throw new ConvexError("Invalid GitHub setup state");
  }
  const payload = parsed as Partial<GitHubAppStatePayload>;
  if (
    typeof payload.publisherId !== "string" ||
    typeof payload.requestedByUserId !== "string" ||
    typeof payload.nonce !== "string" ||
    (payload.targetAccountId !== undefined && typeof payload.targetAccountId !== "string") ||
    typeof payload.exp !== "number"
  ) {
    throw new ConvexError("Invalid GitHub setup state");
  }
  if (payload.exp < now) throw new ConvexError("GitHub setup state expired");
  return {
    publisherId: payload.publisherId,
    requestedByUserId: payload.requestedByUserId,
    nonce: payload.nonce,
    targetAccountId: payload.targetAccountId,
    exp: payload.exp,
  };
}

export async function hashGitHubAppState(state: string) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))),
  );
}

export async function verifyGitHubWebhookSignature(params: {
  body: ArrayBuffer;
  signatureHeader: string | null;
  secret: string | undefined;
}): Promise<GitHubWebhookVerificationResult> {
  const secret = params.secret?.trim();
  if (!secret) return { ok: false, reason: "missing-secret" };
  const signature = params.signatureHeader?.trim();
  if (!signature) return { ok: false, reason: "missing-signature" };
  if (!signature.startsWith("sha256=")) return { ok: false, reason: "malformed-signature" };
  const expected = `sha256=${await hmacSha256Hex(secret, params.body)}`;
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: "bad-signature" };
  return { ok: true };
}

export async function createGitHubAppJwt(params: {
  appId: string;
  privateKeyPem: string;
  now?: number;
}) {
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iat: nowSeconds - 60,
        exp: nowSeconds + 9 * 60,
        iss: params.appId,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(params.privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export function buildGitHubAppInstallUrl(params: {
  appSlug: string;
  state: string;
  targetId?: string;
}) {
  const url = new URL(`https://github.com/apps/${params.appSlug}/installations/new`);
  url.searchParams.set("state", params.state);
  if (params.targetId) url.searchParams.set("target_id", params.targetId);
  return url.toString();
}

async function importPrivateKey(privateKeyPem: string) {
  const normalized = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Match = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(
    normalized,
  );
  const pkcs1Match = /-----BEGIN RSA PRIVATE KEY-----([\s\S]+?)-----END RSA PRIVATE KEY-----/.exec(
    normalized,
  );
  const der = pkcs8Match
    ? base64Decode(pkcs8Match[1]?.replace(/\s+/g, "") ?? "")
    : pkcs1Match
      ? wrapPkcs1RsaPrivateKeyAsPkcs8(base64Decode(pkcs1Match[1]?.replace(/\s+/g, "") ?? ""))
      : base64Decode(normalized.replace(/\s+/g, ""));
  return await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function wrapPkcs1RsaPrivateKeyAsPkcs8(pkcs1Der: Uint8Array) {
  const rsaEncryptionOid = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const privateKey = derEncode(0x04, pkcs1Der);
  return derEncode(0x30, concatBytes([version, rsaEncryptionOid, privateKey]));
}

function derEncode(tag: number, value: Uint8Array) {
  return concatBytes([new Uint8Array([tag]), derLength(value.byteLength), value]);
}

function derLength(length: number) {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function hmacSha256Base64Url(secret: string, value: string) {
  const digest = await hmacSha256(secret, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, value: ArrayBuffer) {
  const digest = await hmacSha256(secret, value);
  return toHex(new Uint8Array(digest));
}

async function hmacSha256(secret: string, value: ArrayBuffer | Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", key, toArrayBuffer(value));
}

function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64Decode(padded);
}

function base64Decode(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(bytes: Uint8Array) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function toArrayBuffer(value: ArrayBuffer | Uint8Array) {
  if (value instanceof ArrayBuffer) return value;
  return new Uint8Array(value).buffer as ArrayBuffer;
}
