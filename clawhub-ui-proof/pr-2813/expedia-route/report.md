# Top-level publisher route proof

Status: pass

Scenario: `/expedia` should only look for a publisher. If no publisher exists, the route should render the not-found page instead of redirecting to `/ivangdavila/skills/expedia`.

Evidence:

- Local ClawHub URL: `http://localhost:3001/expedia`
- Browser URL after navigation: `http://localhost:3001/expedia`
- Visible heading: `We couldn't find that page.`
- Canonical link: none
