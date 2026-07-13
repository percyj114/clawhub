# ClawHub UI Proof

Status: pass

The real ClawHub home page was exercised at a 1280 x 720 browser viewport against the candidate commit and an isolated local Convex runtime.

- With the summary backend unavailable, scrolling to Popular creators kept all ten static cards visible with neutral `Explore creator` copy.
- With the local NVIDIA fixture available, the same scroll hydrated only NVIDIA and changed its copy to `Explore 1 item`; the remaining nine cards retained their static fallback.
- Network inspection recorded zero publisher-summary requests above the fold, one request after a 700 px scroll, and no additional requests after repeated scrolling. The request contained all ten pinned handles. The one-result response contained 339 JSON bytes and 617 encoded transfer bytes.
