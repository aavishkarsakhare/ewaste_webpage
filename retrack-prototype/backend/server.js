// RETRACK prototype server. No libraries: only Node's built-in modules.
// Run: node backend/server.js   then open http://localhost:3000
const http = require("http"), fs = require("fs"), path = require("path");
const DATA = path.join(__dirname, "..", "data", "batches.json");
const WEB = path.join(__dirname, "..", "frontend");
const PORT = 3000;

// ---- Lifecycle definition: edit this to change the workflow ----
const STAGES = ["Registered", "Sold/Distributed", "Collected", "Handed to Recycler", "Recycled", "Certified"];
// RULES[i] = who may move a batch INTO stage i, and what proof is required
const RULES = [
  { roles: ["Brand"], needs: [] },
  { roles: ["Brand"], needs: [] },
  { roles: ["Brand", "Recycler"], needs: [] },
  { roles: ["Brand", "Recycler"], needs: ["recycler"] },
  { roles: ["Recycler"], needs: ["recycledWeightKg"] },
  { roles: ["Regulator"], needs: ["certificateNo"] },
];
// Typical kg per unit [min, max] for the weight sanity check
const RANGE = { laptop: [1.2, 4], phone: [0.1, 0.3], tablet: [0.3, 1], tv: [4, 30] };

const load = () => JSON.parse(fs.readFileSync(DATA, "utf8"));
const save = (db) => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
const idx = (b) => STAGES.indexOf(b.currentStage);

// ---- Simple, explainable "AI" checks: each returns a reason string ----
function flagsFor(b, all) {
  const f = [];
  const r = RANGE[b.category], per = b.totalWeightKg / b.quantity;
  if (r && (per < r[0] || per > r[1]))
    f.push(`Weight per unit is ${per.toFixed(2)} kg; typical for ${b.category} is ${r[0]}-${r[1]} kg`);
  if (b.recycledWeightKg && Math.abs(b.recycledWeightKg - b.totalWeightKg) / b.totalWeightKg > 0.25)
    f.push(`Recycled weight (${b.recycledWeightKg} kg) differs by more than 25% from registered weight (${b.totalWeightKg} kg)`);
  if (b.certificateNo && all.some((o) => o.id !== b.id && o.certificateNo === b.certificateNo))
    f.push(`Certificate ${b.certificateNo} is used by another batch`);
  const reg = b.history.find((h) => h.stage === "Registered"), rec = b.history.find((h) => h.stage === "Recycled");
  if (reg && rec && new Date(rec.date) - new Date(reg.date) < 86400000)
    f.push("Registered and recycled within 24 hours, which is unusually fast");
  return f;
}
const withFlags = (b, all) => ({ ...b, flags: flagsFor(b, all) });

// ---- Helpers ----
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  try {
    if (url === "/api/meta") return send(res, 200, { stages: STAGES, rules: RULES });
    if (url === "/api/batches" && req.method === "GET") {
      const db = load();
      return send(res, 200, { targetPercent: db.targetPercent, batches: db.batches.map((b) => withFlags(b, db.batches)) });
    }
    let m = url.match(/^\/api\/batches\/([\w-]+)$/);
    if (m && req.method === "GET") {
      const db = load(), b = db.batches.find((x) => x.id === m[1]);
      return b ? send(res, 200, withFlags(b, db.batches)) : send(res, 404, { error: "Batch not found" });
    }
    if (url === "/api/batches" && req.method === "POST") {
      const d = await body(req), db = load();
      if (d.role !== "Brand") return send(res, 403, { error: "Only a Brand can register a batch" });
      if (!d.productName || !d.category || !(d.quantity > 0) || !(d.totalWeightKg > 0))
        return send(res, 400, { error: "Fill in all fields with valid positive numbers" });
      const b = {
        id: "B-" + (1001 + db.batches.length), brand: d.brand || "Demo Brand", productName: d.productName,
        category: d.category, quantity: Number(d.quantity), totalWeightKg: Number(d.totalWeightKg),
        currentStage: STAGES[0],
        history: [{ stage: STAGES[0], date: new Date().toISOString(), note: "Batch registered", recordedBy: d.role }],
      };
      db.batches.push(b); save(db);
      return send(res, 201, withFlags(b, db.batches));
    }
    m = url.match(/^\/api\/batches\/([\w-]+)\/advance$/);
    if (m && req.method === "POST") {
      const d = await body(req), db = load(), b = db.batches.find((x) => x.id === m[1]);
      if (!b) return send(res, 404, { error: "Batch not found" });
      const next = idx(b) + 1;
      if (next >= STAGES.length) return send(res, 400, { error: "Batch is already at the final stage" });
      const rule = RULES[next];
      if (!rule.roles.includes(d.role)) return send(res, 403, { error: `Only ${rule.roles.join(" or ")} can move a batch to "${STAGES[next]}"` });
      const missing = rule.needs.filter((k) => !d[k]);
      if (missing.length) return send(res, 400, { error: `Missing required proof: ${missing.join(", ")}` });
      rule.needs.forEach((k) => (b[k] = k === "recycledWeightKg" ? Number(d[k]) : d[k]));
      b.currentStage = STAGES[next];
      b.history.push({ stage: STAGES[next], date: new Date().toISOString(), note: d.note || "", recordedBy: d.role });
      save(db);
      return send(res, 200, withFlags(b, db.batches));
    }
    // Static files (the frontend)
    const file = path.join(WEB, url === "/" ? "index.html" : url);
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
    fs.createReadStream(file).pipe(res);
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`RETRACK running at http://localhost:${PORT}`));
