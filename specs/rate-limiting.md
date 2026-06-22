# Rate Limiting

## Security Intent

All public HTTP routes, including legacy `/api/...` and `/api/cli/...` routes
kept for compatibility, must pass through `applyRateLimit` before doing
expensive work, auth parsing, publish mutations, upload ticket creation,
telemetry writes, delete/undelete mutations, or search queries.

Client IP headers are not trustworthy on direct Convex HTTP endpoints. Treat
`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, and `fly-client-ip` as
trusted only when the deployment explicitly enables trusted forwarded headers.
Do not enable that opt-in while the Convex `*.convex.site` HTTP origin remains
publicly reachable. Without the opt-in, anonymous traffic must use conservative
missing-IP fallback buckets scoped only by rate-limit kind. Missing-IP buckets
must not include user-controlled paths, dynamic path segments, query parameters,
package names, skill slugs, or artifact versions.
Artifact-specific download scoping is only safe after the caller has an
authenticated identity or a trusted client IP.

Rate limit sharding is an implementation detail, not a quota multiplier. Each
key/window shard has a bounded partition of the configured limit, and the sum
of all shard capacities must be no greater than the public rate limit. Hot
buckets must not funnel every allowed request through one shared counter row.
