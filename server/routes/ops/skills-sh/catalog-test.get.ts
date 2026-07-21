import { defineEventHandler } from "h3";
import { getSkillsShCatalogTestSourcePolicy } from "../../../skillsShCatalogSource";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default defineEventHandler(() => {
  if (!getSkillsShCatalogTestSourcePolicy(process.env).allowed) {
    return htmlResponse("Not found", 404);
  }
  return htmlResponse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CLAW-556 Test gate</title>
</head>
<body>
  <main>
    <form id="gate-form">
      <label>Operator token <input id="operator-token" type="password" required autocomplete="off"></label>
      <label>Allowlist <input id="allowlist" value="nvidia/skills/aiq-deploy"></label>
      <button type="submit">Run bounded gate</button>
    </form>
    <pre id="result" aria-live="polite"></pre>
  </main>
  <script>
    document.getElementById("gate-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const tokenInput = document.getElementById("operator-token");
      const result = document.getElementById("result");
      const authorization = "Bearer " + tokenInput.value;
      tokenInput.value = "";
      result.textContent = "Running...";
      const response = await fetch(location.pathname, {
        method: "POST",
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          allowlist: document.getElementById("allowlist").value
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          reason: "CLAW-556 bounded permanent Test proof"
        })
      });
      result.textContent = await response.text();
    });
  </script>
</body>
</html>`);
});
