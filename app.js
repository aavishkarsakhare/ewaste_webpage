// RETRACK frontend: plain JavaScript, no libraries.
const app = document.getElementById("app");
const roleSel = document.getElementById("role");
let meta = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => new Date(d).toLocaleString();

async function api(path, method = "GET", data) {
  const res = await fetch("/api" + path, {
    method, headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify({ ...data, role: roleSel.value }) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Something went wrong");
  return json;
}

// ---------- Dashboard ----------
async function dashboard() {
  const { targetPercent, batches } = await api("/batches");
  const total = batches.reduce((n, b) => n + b.quantity, 0);
  const recycled = batches.filter((b) => meta.stages.indexOf(b.currentStage) >= 4).reduce((n, b) => n + b.quantity, 0);
  const pct = total ? Math.round((recycled / total) * 100) : 0;
  const flagged = batches.filter((b) => b.flags.length).length;
  app.innerHTML = `
    <div class="cards">
      <div class="card"><small>Units registered</small><div class="big">${total}</div></div>
      <div class="card"><small>Units recycled</small><div class="big">${recycled}</div></div>
      <div class="card"><small>Compliance (target ${targetPercent}%)</small>
        <div class="big ${pct >= targetPercent ? "ok" : "bad"}">${pct}%</div></div>
      <div class="card"><small>Batches flagged by AI checks</small><div class="big ${flagged ? "bad" : "ok"}">${flagged}</div></div>
    </div>
    <table>
      <tr><th>ID</th><th>Product</th><th>Qty</th><th>Stage</th><th>Checks</th></tr>
      ${batches.map((b) => `<tr>
        <td><a href="#/batch/${esc(b.id)}">${esc(b.id)}</a></td><td>${esc(b.productName)}</td><td>${b.quantity}</td>
        <td><span class="badge">${esc(b.currentStage)}</span></td>
        <td>${b.flags.length ? `<span class="badge flag">⚠ ${b.flags.length} flag(s)</span>` : "✓ OK"}</td></tr>`).join("")}
    </table>`;
}

// ---------- Register batch ----------
function newBatch() {
  app.innerHTML = `<div class="panel"><h2>Register a product batch</h2>
    <form id="f">
      <label>Product name</label><input name="productName" required>
      <label>Category</label>
      <select name="category"><option value="laptop">Laptop</option><option value="phone">Phone</option>
        <option value="tablet">Tablet</option><option value="tv">TV</option></select>
      <label>Quantity (units)</label><input name="quantity" type="number" min="1" required>
      <label>Total weight (kg)</label><input name="totalWeightKg" type="number" step="0.1" min="0.1" required>
      <button>Register batch</button><div class="error" id="err"></div>
    </form></div>`;
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { const b = await api("/batches", "POST", d); location.hash = "#/batch/" + b.id; }
    catch (err) { document.getElementById("err").textContent = err.message; }
  };
}

// ---------- Batch detail + lifecycle ----------
const LABELS = { recycler: "Recycler name", recycledWeightKg: "Recycled weight (kg)", certificateNo: "Certificate number" };

async function batchDetail(id) {
  const b = await api("/batches/" + id);
  const cur = meta.stages.indexOf(b.currentStage), next = cur + 1, rule = meta.rules[next];
  app.innerHTML = `
    <div class="panel">
      <h2>${esc(b.id)} · ${esc(b.productName)}</h2>
      <p>${b.quantity} units · ${b.totalWeightKg} kg · category: ${esc(b.category)}</p>
      <div class="timeline">${meta.stages.map((s, i) =>
        `<div class="step ${i < cur ? "done" : i === cur ? "current" : ""}">${i < cur ? "✓ " : ""}${esc(s)}</div>`).join("")}</div>
      ${b.flags.map((f) => `<div class="flagbox">⚠ ${esc(f)}</div>`).join("")}
      ${rule ? `<h3>Move to: ${esc(meta.stages[next])}</h3>
        <small>Allowed roles: ${rule.roles.join(", ")}</small>
        <form id="adv">
          ${rule.needs.map((k) => `<label>${LABELS[k]}</label><input name="${k}" ${k === "recycledWeightKg" ? 'type="number" step="0.1"' : ""}>`).join("")}
          <label>Note (optional)</label><input name="note">
          <button>Advance stage</button><div class="error" id="err"></div>
        </form>` : "<p class='ok'><b>This batch has completed its lifecycle.</b></p>"}
    </div>
    <div class="panel" style="margin-top:16px"><h3>History (append-only)</h3>
      <ul>${b.history.map((h) => `<li><b>${esc(h.stage)}</b> · ${fmt(h.date)} · by ${esc(h.recordedBy)} ${h.note ? "· " + esc(h.note) : ""}</li>`).join("")}</ul></div>`;
  const form = document.getElementById("adv");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/batches/${id}/advance`, "POST", Object.fromEntries(new FormData(form))); batchDetail(id); }
    catch (err) { document.getElementById("err").textContent = err.message; }
  };
}

// ---------- Tiny router ----------
async function route() {
  const h = location.hash || "#/";
  try {
    if (!meta) meta = await api("/meta");
    if (h.startsWith("#/batch/")) await batchDetail(h.split("/")[2]);
    else if (h === "#/new") newBatch();
    else await dashboard();
  } catch (err) { app.innerHTML = `<div class="panel error">Error: ${esc(err.message)}</div>`; }
}
window.addEventListener("hashchange", route);
roleSel.addEventListener("change", route);
route();
