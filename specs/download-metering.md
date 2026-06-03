# Download Metering

## Intent

Download metrics are collected without storing raw IP addresses and without
rewriting historical download counts during the first observation period.

New skill and package downloads use one shared metering path. The path records
one counted download per target, identity kind, identity hash, and UTC day.

## Identity Hashing

The HMAC secret is stored in Convex as:

```text
DOWNLOAD_METERING_HMAC_SECRET
```

The HMAC input includes the identity kind:

```text
user:<user id>
ip:<client ip>
```

This keeps a user id and IP with the same visible string in separate hash
domains for dedupe and local diagnostics. If the secret is missing, new metering
fails closed inside the best-effort metric path. The download response still
succeeds, but no new download metric is counted.

## Counters

Daily metric rows are append-only after dedupe. Do not patch one target/day
document on each download; popular targets would turn that document into a hot
write point and can undercount during bursts.

Daily metric rows and weekly snapshots store one total counter:

```text
downloads
```

The legacy public `downloads` counters are still fed from the shared metering
path after dedupe. Existing historical counts are not estimated or rewritten in
this phase.

## Snapshots

Weekly snapshots are generated from append-only daily metric rows for the
previous complete UTC week. Snapshot generation reads source rows with paginated
Convex queries and upserts target/global weekly rows, so rerunning the same week
replaces the same snapshot values.
