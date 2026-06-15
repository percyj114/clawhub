# PR 2581 prod-backed UI proof

Status: passed
Mode: feature
Backend: production Convex read data (`wry-manatee-359`).
Pages captured:
- `/skills?sort=installs&dir=desc` showing prod skill rows and install sort.
- `/search?q=swarm` showing prod search results.
- `/chair4ce/swarm` showing a prod-backed skill detail page.

Note: default `/plugins` was not used because this PR head can request `sort=recommended`, which requires matching backend code that is not deployed to prod yet.