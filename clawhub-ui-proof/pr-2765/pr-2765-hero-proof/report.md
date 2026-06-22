# ClawHub UI Proof

Status: pass

Scenario: Homepage hero polish after resolving PR #2765 merge conflicts.

Environment: local Vite at `http://127.0.0.1:3010/` with `VITE_CONVEX_URL=https://example.invalid`.

Evidence:

- Desktop hero shows `Equip Install Unleash` with no `BUILT BY THE COMMUNITY` eyebrow and no trailing punctuation on the rotating word.
- Mobile hero wraps the rotating word onto its own line, hides the final separator, and keeps the headline/subtitle readable.
- DOM observation confirms the headline trigger is a native `button`; route tests cover the focusable trigger and triple-click slot activation.

Notes:

- The local proof intentionally used a secretless invalid Convex URL, so catalog rows render fallback/loading states. The verified surface is the static homepage hero treatment.
- In-app browser keyboard Tab automation did not move focus reliably, so the focus-ring screenshot was not published. Source and tests verify the accessibility contract for the native headline button.
