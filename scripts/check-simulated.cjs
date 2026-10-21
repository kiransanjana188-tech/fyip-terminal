(async () => {
  const login = await fetch("http://localhost:3000/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@fyip.local", password: "ChangeMe!12345" }),
  });
  const cookie = login.headers.getSetCookie().join("; ");
  const res = await fetch("http://localhost:3000/api/v1/quotes", { headers: { cookie } });
  const json = await res.json();
  const quotes = json.quotes ?? [];
  const byStatus = {};
  let simulated = 0;
  for (const q of quotes) {
    byStatus[q.dataStatus] = (byStatus[q.dataStatus] ?? 0) + 1;
    if (q.dataStatus === "simulated") simulated++;
  }
  console.log("quotes:", quotes.length, "| simulated:", simulated, "| statuses:", JSON.stringify(byStatus));
})();
