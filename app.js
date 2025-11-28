/* Campus Fest Manager - Role-based (Admin/User) */

// ---------- Routes, Access, Session ----------
const routes = ["auth","events","register","tickets","scanner","announcements","map","analytics","settings"];
const ROUTE_ACCESS = {
  auth: ["guest"],
  events: ["admin","user"],
  register: ["user"],
  tickets: ["admin","user"],       // admin = search; user = my tickets
  scanner: ["admin"],
  announcements: ["admin","user"], // admin can post; user reads
  map: ["admin","user"],
  analytics: ["admin"],
  settings: ["admin"]
};
const SESSION_KEY = "cfm:user";
const ADMIN_INVITE = "CFM-ADMIN-2025"; // change this
const DEFAULT_ADMIN = { email: "admin@campus.test", name: "Admin", password: "Admin@123" };

let deferredPrompt = null;
let chart = null;
let mapInstance = null;
let mapMarkersLayer = null;
let scanStream = null;
let scanTimer = null;

// Sample campus markers
const mapMarkers = [
  { name: "Main Auditorium", lat: 12.9719, lng: 77.5937 },
  { name: "Library", lat: 12.9730, lng: 77.5940 },
  { name: "Cafeteria", lat: 12.9723, lng: 77.5950 }
];

// ---------- DB (IndexedDB via Dexie) ----------
const db = new Dexie("campusFestDB");
db.version(1).stores({
  events: "++id, title, date, location, capacity, track",
  registrations: "++id, ticketId, eventId, name, email, ticketType, notes, ts, checkedIn",
  checkins: "++id, ticketId, ts",
  announcements: "++id, title, body, ts"
});
db.version(2).stores({
  users: "++id,&email,role,name,passHash,createdAt"
});

// ---------- Utils ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const online = () => navigator.onLine;
const toast = (el, msg, ok = true) => { el.textContent = msg; el.style.color = ok ? "#065F46" : "#b91c1c"; };
const fmtDate = (d) => new Date(d).toLocaleDateString();
const genTicketId = () => `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

async function hashPassword(pw){
  try{
    const enc = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  } catch {
    // Fallback (demo only)
    return btoa(pw);
  }
}

// Session helpers
function getUser(){
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function getRole(){ return getUser()?.role || "guest"; }
function setUser(u){
  localStorage.setItem(SESSION_KEY, JSON.stringify(u));
  updateHeaderAndNav();
  router();
}
function logout(){
  localStorage.removeItem(SESSION_KEY);
  updateHeaderAndNav();
  router();
}
function defaultRoute(role){
  if (role === "guest") return "auth";
  return "events";
}

// ---------- Seed ----------
async function seed() {
  // Default events / announcements
  if (await db.events.count() === 0) {
    await db.events.bulkAdd([
      {
        title: "Tech Fest ’25 - Keynotes",
        date: new Date().toISOString().slice(0,10),
        location: "Main Auditorium",
        capacity: 500,
        track: "Main",
        startTime: "10:00", endTime: "13:00",
        description: "Opening keynotes and welcome."
      },
      {
        title: "Workshops Day",
        date: new Date(Date.now()+86400000).toISOString().slice(0,10),
        location: "Lab Block",
        capacity: 200,
        track: "Workshops",
        startTime: "09:00", endTime: "16:00",
        description: "Hands-on sessions."
      }
    ]);
  }
  if (await db.announcements.count() === 0) {
    await db.announcements.add({
      title: "Welcome!",
      body: "Registration opens at 8:30 AM near Main Gate.",
      ts: Date.now()
    });
  }
  // Default admin
  if (await db.users.count() === 0) {
    const passHash = await hashPassword(DEFAULT_ADMIN.password);
    await db.users.add({
      email: DEFAULT_ADMIN.email,
      name: DEFAULT_ADMIN.name,
      role: "admin",
      passHash,
      createdAt: Date.now()
    });
  }
}

// ---------- Connectivity ----------
function updateStatus() {
  const dot = $("#statusDot");
  const txt = $("#statusText");
  if (online()) {
    dot.classList.remove("offline"); dot.classList.add("online");
    txt.textContent = "Online";
  } else {
    dot.classList.remove("online"); dot.classList.add("offline");
    txt.textContent = "Offline";
  }
}

// ---------- Install PWA ----------
function setupInstall() {
  const installBtn = $("#installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = "inline-flex";
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    installBtn.style.display = "none";
    deferredPrompt = null;
  });
}

// ---------- Header/Nav ----------
function updateHeaderAndNav(){
  const user = getUser();
  const role = getRole();

  // Auth UI
  const loginLink = $("#loginLink");
  const userBox = $("#userBox");
  if (role === "guest") {
    loginLink.style.display = "inline-flex";
    userBox.style.display = "none";
  } else {
    loginLink.style.display = "none";
    userBox.style.display = "inline-flex";
    $("#userName").textContent = user.name || user.email;
    const badge = $("#roleBadge");
    badge.textContent = role.toUpperCase();
    badge.classList.toggle("admin", role === "admin");
    badge.classList.toggle("user", role === "user");
  }

  // Nav visibility by role
  $$(".nav a").forEach(a => {
    const route = (a.getAttribute("href") || "").replace("#","");
    const allowed = ROUTE_ACCESS[route]?.includes(role);
    a.style.display = allowed ? "" : "none";
  });

  // Active class
  const current = (location.hash||"#"+defaultRoute(role));
  $$(".nav-link").forEach(a => a.classList.toggle("active", a.getAttribute("href") === current));
}

// ---------- Router ----------
function router() {
  const role = getRole();
  let hash = location.hash.replace("#","") || defaultRoute(role);
  const allowed = ROUTE_ACCESS[hash]?.includes(role);
  if (!allowed) {
    hash = defaultRoute(role);
    history.replaceState(null, "", "#"+hash);
  }

  // show current page
  $$(".page").forEach(sec => sec.classList.toggle("active", sec.dataset.route === hash));
  updateHeaderAndNav();

  // section-specific hooks
  if (hash === "auth") initAuth();
  if (hash === "events") { renderEvents(); applyRoleVisibility(); }
  if (hash === "register") initRegister();
  if (hash === "tickets") initTickets();
  if (hash === "scanner") stopScanner(); // start manually
  if (hash === "announcements") { renderAnnouncements(); applyRoleVisibility(); }
  if (hash === "map") initMap();
  if (hash === "analytics") renderAnalytics();
  if (hash === "settings") { /* nothing extra */ }
}

function applyRoleVisibility(){
  const role = getRole();
  const eventWrap = $("#eventFormWrap");
  const annWrap = $("#annFormWrap");
  if (eventWrap) eventWrap.style.display = role === "admin" ? "" : "none";
  if (annWrap) annWrap.style.display = role === "admin" ? "" : "none";
}

// ---------- Auth ----------
function initAuth(){
  const regRole = $("#regRole");
  const adminCodeWrap = $("#adminCodeWrap");
  regRole?.addEventListener("change", () => {
    adminCodeWrap.style.display = regRole.value === "admin" ? "" : "none";
  });
}

function handleAuthForms(){
  // Login
  $("#loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#loginMsg"); msg.textContent = "";
    const data = Object.fromEntries(new FormData(e.target).entries());
    const user = await db.users.where("email").equals(data.email.trim().toLowerCase()).first();
    if (!user) return toast(msg, "No account found for this email.", false);
    const h = await hashPassword(data.password);
    if (h !== user.passHash) return toast(msg, "Incorrect password.", false);
    setUser({ id: user.id, email: user.email, name: user.name, role: user.role });
    toast(msg, "Logged in. Redirecting…");
    setTimeout(()=>{ location.hash = "#"+defaultRoute(getRole()); }, 300);
  });

  // Register
  $("#signupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#signupMsg"); msg.textContent = "";
    const data = Object.fromEntries(new FormData(e.target).entries());
    const name = data.name.trim();
    const email = data.email.trim().toLowerCase();
    const role = data.role;
    const pass = data.password; const confirm = data.confirm;
    if (pass.length < 6) return toast(msg, "Password must be at least 6 characters.", false);
    if (pass !== confirm) return toast(msg, "Passwords do not match.", false);
    if (role === "admin" && data.adminCode !== ADMIN_INVITE) return toast(msg, "Invalid admin secret.", false);
    const exists = await db.users.where("email").equals(email).first();
    if (exists) return toast(msg, "Email already registered.", false);
    const passHash = await hashPassword(pass);
    const id = await db.users.add({ email, name, role: role === "admin" ? "admin" : "user", passHash, createdAt: Date.now() });
    toast(msg, "Account created. Logging in…");
    setUser({ id, email, name, role: role === "admin" ? "admin" : "user" });
    setTimeout(()=>{ location.hash = "#"+defaultRoute(getRole()); }, 300);
  });

  // Header auth buttons
  $("#loginLink")?.addEventListener("click", () => { location.hash = "#auth"; });
  $("#logoutBtn")?.addEventListener("click", logout);
}

// ---------- Events ----------
async function renderEvents() {
  const tbody = $("#eventsTable tbody");
  const rows = await db.events.orderBy("date").toArray();
  tbody.innerHTML = rows.map(e => `
    <tr>
      <td>${e.title}</td>
      <td>${fmtDate(e.date)}</td>
      <td>${(e.startTime||"")}–${(e.endTime||"")}</td>
      <td>${e.location}</td>
      <td>${e.capacity || "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No events yet</td></tr>`;
}

function handleEventForm() {
  const form = $("#eventForm");
  const msg = $("#eventMsg");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await db.events.add({
        title: data.title.trim(),
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        location: data.location.trim(),
        capacity: Number(data.capacity || 0),
        track: (data.track || "").trim(),
        description: (data.description || "").trim()
      });
      toast(msg, "Event added.");
      form.reset();
      renderEvents();
      fillEventSelect();
    } catch(err){
      toast(msg, "Failed to add event.", false);
      console.error(err);
    }
  });

  $("#exportEventsBtn")?.addEventListener("click", async () => {
    const events = await db.events.toArray();
    const csv = ["Title,Date,Start,End,Location,Capacity,Track"];
    events.forEach(e => {
      csv.push([e.title, e.date, e.startTime||"", e.endTime||"", e.location, e.capacity||"", e.track||""]
        .map(s => `"${String(s).replace(/"/g,'""')}"`).join(","));
    });
    downloadBlob(new Blob([csv.join("\n")], {type:"text/csv"}), "events.csv");
  });
}

// ---------- Registration (User) ----------
async function fillEventSelect() {
  const events = await db.events.orderBy("date").toArray();
  const sel = $("#regEvent");
  if (!sel) return;
  sel.innerHTML = events.map(e => `<option value="${e.id}">${fmtDate(e.date)} — ${e.title}</option>`).join("");
}

function initRegister() {
  fillEventSelect();
  const user = getUser();
  const nameInput = $('#regForm [name="name"]');
  const emailInput = $('#regForm [name="email"]');
  if (user && nameInput && emailInput) {
    nameInput.value = user.name || "";
    emailInput.value = user.email || "";
    emailInput.readOnly = true; // keep user's email for ticket linkage
  }
}

function handleRegForm() {
  const form = $("#regForm");
  const msg = $("#regMsg");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = getUser();
    if (!user) { toast(msg, "Please login first.", false); location.hash = "#auth"; return; }
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const ticketId = genTicketId();
      const ts = Date.now();
      const rec = {
        ticketId,
        eventId: Number(data.eventId),
        name: (data.name||user.name).trim(),
        email: (data.email||user.email).trim().toLowerCase(),
        ticketType: data.ticketType,
        notes: (data.notes||"").trim(),
        checkedIn: false,
        ts
      };
      await db.registrations.add(rec);
      toast(msg, "Ticket created.");
      showLastTicket(rec);
      // don't reset email/name prefill
      form.reset();
      initRegister();
      location.hash = "#tickets"; // jump to tickets
    } catch(err) {
      toast(msg, "Failed to register.", false);
      console.error(err);
    }
  });
}

async function showLastTicket(rec) {
  const info = $("#lastTicketInfo");
  const qrWrap = $("#lastTicketQR");
  info.innerHTML = `
    <b>${rec.name}</b> • ${rec.email}<br>
    Ticket: <code>${rec.ticketId}</code><br>
    Event: ${await eventName(rec.eventId)} — ${rec.ticketType}
  `;
  qrWrap.innerHTML = "";
  new QRCode(qrWrap, { text: rec.ticketId, width: 200, height: 200 });
}

async function eventName(eventId) {
  const ev = await db.events.get(Number(eventId));
  return ev ? ev.title : "Unknown";
}

// ---------- Tickets (Admin/User) ----------
function initTickets() {
  const role = getRole();
  const form = $("#findTicketForm");
  const sub = $("#ticketsSub");
  const emailInput = $("#findEmail");
  const results = $("#ticketResults");
  const detail = $("#ticketDetail");
  const qr = $("#ticketQR"); const info = $("#ticketInfo");

  results.innerHTML = ""; detail.style.display = "none"; qr.innerHTML = ""; info.textContent = "";

  if (role === "user") {
    // User sees own tickets
    form.style.display = "none";
    sub.textContent = "Your tickets (show QR at the gate).";
    const user = getUser();
    if (user) renderTicketsForEmail(user.email);
  } else {
    // Admin search
    form.style.display = "";
    sub.textContent = "Admins can find tickets by email.";
    form.onsubmit = async (e) => {
      e.preventDefault();
      renderTicketsForEmail(emailInput.value.trim().toLowerCase());
    };
  }
}

async function renderTicketsForEmail(email){
  const regs = await db.registrations.where("email").equals(email).toArray();
  const box = $("#ticketResults");
  if (regs.length === 0) {
    box.innerHTML = `<div class="help">No tickets found for ${email}</div>`;
    return;
  }
  box.innerHTML = regs.map(async r => `
    <div class="card" data-ticket="${r.ticketId}">
      <div><b>${r.name}</b> — ${r.email}</div>
      <div>Ticket: <code>${r.ticketId}</code> • ${r.ticketType}</div>
      <div>Event: ${await eventName(r.eventId)}</div>
      <div>Status: ${r.checkedIn ? "Checked-in ✅" : "Not checked-in ⏳"}</div>
      <button class="btn" data-show="${r.ticketId}">Show QR</button>
    </div>
  `).join("");

  box.querySelectorAll("[data-show]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ticketId = btn.dataset.show;
      const rec = regs.find(r => r.ticketId === ticketId);
      $("#ticketDetail").style.display = "grid";
      $("#ticketInfo").innerHTML = `
        <b>${rec.name}</b> • ${rec.email}<br>
        Ticket: <code>${rec.ticketId}</code><br>
        Event: ${await eventName(rec.eventId)} — ${rec.ticketType}
      `;
      const q = $("#ticketQR"); q.innerHTML = "";
      new QRCode(q, { text: rec.ticketId, width: 200, height: 200 });
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
  });
}

// ---------- Scanner (Admin) ----------
async function startScanner() {
  const video = $("#video");
  const canvas = $("#canvas");
  const scanMsg = $("#scanMsg");
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio:false });
    video.srcObject = scanStream;
    await video.play();
    scanMsg.textContent = "Scanner running… Show a ticket QR to the camera.";
    scanTimer = setInterval(() => scanFrame(video, canvas), 400);
  } catch(err) {
    scanMsg.textContent = "Camera error. Use https or localhost and allow camera.";
    console.error(err);
  }
}

function stopScanner() {
  const scanMsg = $("#scanMsg");
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  if (scanMsg) scanMsg.textContent = "Scanner idle.";
}

async function scanFrame(video, canvas) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const code = jsQR(img.data, w, h);
  if (code && code.data) {
    await handleScan(code.data.trim());
  }
}

let lastScanAt = 0;
async function handleScan(ticketId) {
  if (Date.now() - lastScanAt < 2000) return;
  lastScanAt = Date.now();

  const rec = await db.registrations.where("ticketId").equals(ticketId).first();
  if (!rec) {
    $("#scanResult").innerHTML = `Unknown ticket: <code>${ticketId}</code>`;
    return;
  }
  if (!rec.checkedIn) {
    await db.checkins.add({ ticketId, ts: Date.now() });
    await db.registrations.update(rec.id, { checkedIn: true });
  }
  $("#scanResult").innerHTML = `
    ✅ Checked-in: <b>${rec.name}</b><br>
    Ticket: <code>${ticketId}</code><br>
    Event: ${await eventName(rec.eventId)}
  `;
  if (navigator.vibrate) navigator.vibrate(80);
}

// ---------- Announcements ----------
async function renderAnnouncements() {
  const items = await db.announcements.orderBy("ts").reverse().toArray();
  const ul = $("#annList");
  ul.innerHTML = items.map(a => `
    <li>
      <b>${a.title}</b> <span class="muted">• ${new Date(a.ts).toLocaleString()}</span>
      <div>${a.body}</div>
    </li>
  `).join("") || `<li class="muted">No announcements yet</li>`;
}

function handleAnnForm() {
  const form = $("#annForm");
  const msg = $("#annMsg");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    await db.announcements.add({ title: data.title.trim(), body: data.body.trim(), ts: Date.now() });
    toast(msg, "Announcement posted.");
    form.reset();
    renderAnnouncements();
  });

  $("#notifyBtn")?.addEventListener("click", async () => {
    if (!("Notification" in window)) return alert("Notifications not supported");
    let perm = Notification.permission;
    if (perm !== "granted") perm = await Notification.requestPermission();
    if (perm === "granted") {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.showNotification("Campus Fest", {
        body: "Demo notification: Registration starts 8:30 AM!",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png"
      });
    }
  });
}

// ---------- Map ----------
function initMap() {
  if (!mapInstance) {
    mapInstance = L.map("map").setView([12.9719, 77.5937], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapInstance);
    mapMarkersLayer = L.layerGroup().addTo(mapInstance);
  }
  mapMarkersLayer.clearLayers();
  mapMarkers.forEach(m => L.marker([m.lat, m.lng]).addTo(mapMarkersLayer).bindPopup(m.name));
}

// ---------- Analytics (Admin) ----------
async function renderAnalytics() {
  const events = await db.events.orderBy("date").toArray();
  const regs = await db.registrations.toArray();
  const checks = await db.checkins.toArray();

  const byEvent = (arr) => arr.reduce((acc, r) => {
    const k = r.eventId || (regs.find(x=>x.ticketId===r.ticketId)?.eventId);
    if (!k) return acc;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const regCounts = byEvent(regs);
  const checkCounts = byEvent(checks);

  const labels = events.map(e => e.title);
  const regData = events.map(e => regCounts[e.id] || 0);
  const checkData = events.map(e => checkCounts[e.id] || 0);

  const ctx = $("#regChart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Registrations", data: regData, backgroundColor: "rgba(37,99,235,.7)" },
        { label: "Check-ins", data: checkData, backgroundColor: "rgba(16,185,129,.7)" }
      ]
    },
    options: {
      responsive:true,
      scales: { y: { beginAtZero:true, ticks:{ precision:0 } } }
    }
  });
}

// ---------- Settings / Export ----------
function handleSettings() {
  $("#exportJSONBtn")?.addEventListener("click", async () => {
    const dump = {
      events: await db.events.toArray(),
      registrations: await db.registrations.toArray(),
      checkins: await db.checkins.toArray(),
      announcements: await db.announcements.toArray(),
      users: await db.users.toArray()
    };
    downloadBlob(new Blob([JSON.stringify(dump, null, 2)], {type:"application/json"}), "campus-fest-data.json");
  });

  $("#exportRegsCSVBtn")?.addEventListener("click", async () => {
    const regs = await db.registrations.toArray();
    const csv = ["TicketId,EventId,Name,Email,TicketType,CheckedIn,Timestamp"];
    regs.forEach(r => {
      csv.push([r.ticketId, r.eventId, r.name, r.email, r.ticketType, r.checkedIn, new Date(r.ts).toISOString()]
        .map(s => `"${String(s).replace(/"/g,'""')}"`).join(","));
    });
    downloadBlob(new Blob([csv.join("\n")], {type:"text/csv"}), "registrations.csv");
  });

  $("#importJSONInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await db.transaction("rw", db.events, db.registrations, db.checkins, db.announcements, db.users, async () => {
        if (Array.isArray(data.events)) await db.events.clear().then(()=>db.events.bulkAdd(data.events));
        if (Array.isArray(data.registrations)) await db.registrations.clear().then(()=>db.registrations.bulkAdd(data.registrations));
        if (Array.isArray(data.checkins)) await db.checkins.clear().then(()=>db.checkins.bulkAdd(data.checkins));
        if (Array.isArray(data.announcements)) await db.announcements.clear().then(()=>db.announcements.bulkAdd(data.announcements));
        if (Array.isArray(data.users)) await db.users.clear().then(()=>db.users.bulkAdd(data.users));
      });
      alert("Imported. Reloading…");
      location.reload();
    } catch(err) {
      alert("Import failed. Invalid JSON.");
      console.error(err);
    }
  });

  $("#clearDBBtn")?.addEventListener("click", async () => {
    if (!confirm("This will erase all local data. Continue?")) return;
    await db.delete();
    location.reload();
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

// ---------- Init ----------
async function init() {
  updateStatus();
  setupInstall();
  await seed();
  handleAuthForms();
  handleEventForm();
  handleRegForm();
  handleAnnForm();
  handleSettings();
  router();

  window.addEventListener("hashchange", router);
  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);

  $$(".nav-link").forEach(a => a.addEventListener("click", () => a.blur()));

  $("#startScanBtn")?.addEventListener("click", () => {
    if (getRole() !== "admin") return;
    startScanner();
  });
  $("#stopScanBtn")?.addEventListener("click", stopScanner);
}

document.addEventListener("DOMContentLoaded", init);
