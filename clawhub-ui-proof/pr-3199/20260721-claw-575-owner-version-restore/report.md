# Owner Version Restore UI Proof

The isolated local-auth Playwright scenario passed against commit
`58a2fff13b9f5befa92b2ff41a96f37b97023702`.

It exercised both resource families through:

- visible historical version
- owner withdrawal confirmation
- unavailable public exact-version reads and downloads
- persisted owner-only Restore action
- restoration of the exact retained artifact
- available public exact-version reads and downloads after restore

The scenario also asserted that latest pointers, search digests, package metadata,
skill tags, package tags, and release dist-tags were not recreated or promoted.
