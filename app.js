/* ===============================
   HGV Work Log - app.js (FULL REWRITE)
   Replace your entire app.js with this.
================================ */

/* ===============================
   STORAGE
================================ */

const DATA_MODEL_VERSION = 3;
const DATA_VERSION_KEY = "dataVersion";
const DEFAULT_SETTINGS = {
  defaultStart: "",
  defaultFinish: "",
  baseRate: 17.75,
  baseHours: 45,
  otWeekday: 1.25,
  otSaturday: 1.25,
  otSunday: 1.5,
  otBankHoliday: 2,
  annualLeaveAllowance: 0,
  summaryPeriodMode: "month"
};

let shifts = JSON.parse(localStorage.getItem("shifts")) || [];
let vehicles = JSON.parse(localStorage.getItem("vehicles")) || [];
let companies = JSON.parse(localStorage.getItem("companies")) || [];

let settings = JSON.parse(localStorage.getItem("settings")) || { ...DEFAULT_SETTINGS };

let editingIndex = null;

/* ===============================
   SAFE HELPERS
================================ */

function clamp0(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [hh, mm] = String(t).split(":").map(Number);
  return (hh * 60) + (mm || 0);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveAll() {
  localStorage.setItem("shifts", JSON.stringify(shifts));
  localStorage.setItem("vehicles", JSON.stringify(vehicles));
  localStorage.setItem("companies", JSON.stringify(companies));
  localStorage.setItem("settings", JSON.stringify(settings));
  localStorage.setItem(DATA_VERSION_KEY, String(DATA_MODEL_VERSION));
}

function generateCompanyId() {
  return "cmp_" + Math.random().toString(36).slice(2, 9);
}

function generateShiftId() {
  return "shf_" + Math.random().toString(36).slice(2, 10);
}

function getStoredDataVersion() {
  const raw = Number(localStorage.getItem(DATA_VERSION_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function normalizeSettings(src) {
  const out = { ...DEFAULT_SETTINGS, ...(src && typeof src === "object" ? src : {}) };
  out.baseRate = Number(out.baseRate || 0);
  out.baseHours = Number(out.baseHours || 0);
  out.otWeekday = Number(out.otWeekday || 1);
  out.otSaturday = Number(out.otSaturday || 1);
  out.otSunday = Number(out.otSunday || 1);
  out.otBankHoliday = Number(out.otBankHoliday || 1);
  out.annualLeaveAllowance = Number(out.annualLeaveAllowance || 0);
  return out;
}

function normalizeVehicles(src) {
  if (!Array.isArray(src)) return [];
  return [...new Set(src
    .map(v => String(v || "").toUpperCase().trim())
    .filter(Boolean)
  )];
}

function normalizeCompany(src) {
  const c = (src && typeof src === "object") ? src : {};
  const nightBonus = c.nightBonus || {};

  return {
    ...c,
    id: String(c.id || generateCompanyId()),
    name: String(c.name || "Company"),
    baseRate: Number(c.baseRate || 0),
    payMode: (c.payMode === "daily") ? "daily" : "weekly",
    baseWeeklyHours: Number(c.baseWeeklyHours || 0),
    baseDailyPaidHours: Number(c.baseDailyPaidHours || 0),
    standardShiftLength: Number(c.standardShiftLength || 0),
    dailyOTAfterWorkedHours: Number(c.dailyOTAfterWorkedHours || 0),
    minPaidShiftHours: Number(c.minPaidShiftHours || 0),
    nightBonus: {
      mode: nightBonus.mode || "none",
      amount: Number(nightBonus.amount || 0),
      start: nightBonus.start || "22:00",
      end: nightBonus.end || "06:00"
    },
    ot: {
      weekday: Number(c.ot?.weekday || 1),
      saturday: Number(c.ot?.saturday || 1),
      sunday: Number(c.ot?.sunday || 1),
      bankHoliday: Number(c.ot?.bankHoliday || 1)
    },
    showVehicleField: (c.showVehicleField !== false),
    showTrailerFields: (c.showTrailerFields !== false),
    showMileageFields: !!c.showMileageFields,
    bonusRules: Array.isArray(c.bonusRules) ? c.bonusRules : [],
    vehicleIds: Array.isArray(c.vehicleIds) ? c.vehicleIds : []
  };
}

function normalizeShift(src) {
  const s = (src && typeof src === "object") ? src : {};
  const expenses = s.expenses || {};

  return {
    ...s,
    id: String(s.id || generateShiftId()),
    companyId: String(s.companyId || ""),
    date: String(s.date || ""),
    start: String(s.start || ""),
    finish: String(s.finish || ""),
    vehicle: String(s.vehicle || "").toUpperCase().trim(),
    trailer1: String(s.trailer1 || ""),
    trailer2: String(s.trailer2 || ""),
    defects: String(s.defects || s.notes || ""),
    notes: String(s.notes || s.defects || ""),
    annualLeave: !!s.annualLeave,
    sickDay: !!s.sickDay,
    bankHoliday: !!s.bankHoliday,
    startMileage: Number(s.startMileage || 0),
    finishMileage: Number(s.finishMileage || 0),
    mileage: Number(s.mileage || Math.max(0, Number(s.finishMileage || 0) - Number(s.startMileage || 0))),
    shiftType: s.shiftType === "night" ? "night" : "day",
    expenses: {
      parking: Number(expenses.parking || 0),
      tolls: Number(expenses.tolls || 0)
    },
    nightOutCount: Number(s.nightOutCount || 0),
    nightOutPay: Number(s.nightOutPay || 0)
  };
}

function migrateData(sourceVersion = getStoredDataVersion()) {
  const from = Number(sourceVersion || 1);
  if (!Array.isArray(shifts)) shifts = [];
  if (!Array.isArray(vehicles)) vehicles = [];
  if (!Array.isArray(companies)) companies = [];
  if (!settings || typeof settings !== "object") settings = {};

  shifts = shifts.map(normalizeShift);
  vehicles = normalizeVehicles(vehicles);
  companies = companies.map(normalizeCompany);
  settings = normalizeSettings(settings);

  if (from < DATA_MODEL_VERSION) {
    console.info(`Migrated data model: v${from} -> v${DATA_MODEL_VERSION}`);
  }
}

migrateData();
saveAll();


function setSummaryTab(which) {
  const panelWeek = document.getElementById("panelWeek");
  const panelMonth = document.getElementById("panelMonth");
  const tabWeek = document.getElementById("tabWeek");
  const tabMonth = document.getElementById("tabMonth");

  if (!panelWeek || !panelMonth || !tabWeek || !tabMonth) return;

  const isWeek = which === "week";

  panelWeek.style.display = isWeek ? "" : "none";
  panelMonth.style.display = isWeek ? "none" : "";

  tabWeek.classList.toggle("is-active", isWeek);
  tabMonth.classList.toggle("is-active", !isWeek);

  tabWeek.setAttribute("aria-selected", isWeek ? "true" : "false");
  tabMonth.setAttribute("aria-selected", !isWeek ? "true" : "false");

  // remember choice
  try { localStorage.setItem("summaryTab", isWeek ? "week" : "month"); } catch {}
}

function initSummaryTabs() {
  // only runs on summary page (panels exist)
  if (!document.getElementById("panelWeek") || !document.getElementById("panelMonth")) return;

  const saved = (() => {
    try { return localStorage.getItem("summaryTab"); } catch { return null; }
  })();

  setSummaryTab(saved === "month" ? "month" : "week");
}
/* ===============================
   DEFAULT COMPANY / DEFAULT SELECTION
================================ */

function getDefaultCompanyId() {
  return localStorage.getItem("defaultCompanyId") || "";
}
function setDefaultCompanyId(id) {
  localStorage.setItem("defaultCompanyId", id || "");
}

function ensureDefaultCompany() {
  // Create fallback only if *no* companies exist at all
  if (Array.isArray(companies) && companies.length > 0) return;

  companies = [{
    id: "cmp_default",
    name: "Default",
    baseRate: settings.baseRate ?? 17.75,
    payMode: "weekly",                 // "weekly" | "daily"
    baseWeeklyHours: settings.baseHours ?? 45,
    dailyOTAfterWorkedHours: 0,        // used only if payMode="daily"
    minPaidShiftHours: 0,              // agency minimum paid
    nightBonus: {
      mode: "none",                    // "none" | "per_hour" | "per_shift" | "per_week"
      amount: 0.50,
      start: "22:00",
      end: "06:00"
    },
    ot: {
      weekday: settings.otWeekday ?? 1.25,
      saturday: settings.otSaturday ?? 1.25,
      sunday: settings.otSunday ?? 1.5,
      bankHoliday: settings.otBankHoliday ?? 2
    },
    contactName: "",
    contactNumber: "",
    createdAt: Date.now()
  }];

  saveAll();
}

function getUserCompanies() {
  return companies.filter(c => c.id !== "cmp_default");
}

function getSelectableCompanies() {
  // Hide cmp_default if the user has created any companies
  const user = getUserCompanies();
  return user.length ? user : companies;
}

function getCompanyById(id) {
  if (!id) return null;
  return (companies || []).find(c => c.id === id) || null;
}

/* ===============================
   COMPANY DROPDOWN (index page)
================================ */

function renderCompanyDropdowns(selectedId = "") {
  const sel = document.getElementById("company");
  if (!sel) return;

  ensureDefaultCompany();

  const selectable = getSelectableCompanies();
  const storedDefault = getDefaultCompanyId();

  sel.innerHTML =
    `<option value="">Select Company</option>` +
    selectable
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");

  if (selectedId) sel.value = selectedId;
  else if (storedDefault && selectable.some(c => c.id === storedDefault)) sel.value = storedDefault;
  else if (selectable.length) sel.value = selectable[0].id;
}

/* ===============================
   COMPANIES PAGE (CRUD)
================================ */

function renderCompanies() {
  const list = document.getElementById("companyList");
  if (!list) return;

  ensureDefaultCompany();

  const selectable = getSelectableCompanies();
  const currentDefault = getDefaultCompanyId();

  const sorted = selectable.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  list.innerHTML = sorted.map(c => {
    const isDefault = currentDefault
      ? c.id === currentDefault
      : (getUserCompanies().length === 1 && c.id !== "cmp_default");

    const nb = c.nightBonus || { mode: "none", amount: 0, start: "22:00", end: "06:00" };
    const nbText =
      nb.mode === "none" ? "Night bonus: none" :
      nb.mode === "per_hour" ? `Night bonus: £${Number(nb.amount || 0).toFixed(2)}/hr (${nb.start}-${nb.end})` :
      nb.mode === "per_shift" ? `Night bonus: £${Number(nb.amount || 0).toFixed(2)}/shift (${nb.start}-${nb.end})` :
      `Night bonus: £${Number(nb.amount || 0).toFixed(2)}/week (${nb.start}-${nb.end})`;

    return `
      <div class="shift-card">
        <strong>${escapeHtml(c.name)}</strong>
        ${isDefault ? `<span class="small" style="margin-left:8px;">(Default)</span>` : ""}
        <br>
		<div class="meta" style="margin-top:8px;">
          Pay mode: ${escapeHtml(c.payMode || "weekly")}<br>
          Rate: £${Number(c.baseRate || 0).toFixed(2)}<br>
		  ${c.baseDailyPaidHours ? `Base daily paid (salaried): ${Number(c.baseDailyPaidHours || 0).toFixed(2)} hrs<br>` : ""}
		  ${c.standardShiftLength ? `Std shift length: ${Number(c.standardShiftLength || 0).toFixed(2)} hrs<br>` : ""}
          Weekly base: ${Number(c.baseWeeklyHours || 0).toFixed(2)} hrs<br>
          ${(c.payMode === "daily")
		  ? `Daily OT after (worked): ${Number(c.dailyOTAfterWorkedHours || 0).toFixed(2)} hrs<br>` : ``}
          Min paid shift: ${Number(c.minPaidShiftHours || 0).toFixed(2)} hrs<br>
          OT: Wkday x${Number(c.ot?.weekday || 1).toFixed(2)} • Sat x${Number(c.ot?.saturday || 1).toFixed(2)} • Sun x${Number(c.ot?.sunday || 1).toFixed(2)} • BH x${Number(c.ot?.bankHoliday || 1).toFixed(2)}<br>
          ${escapeHtml(nbText)}<br>
          ${(c.contactName || c.contactNumber) ? `Contact: ${escapeHtml(c.contactName || "")} ${escapeHtml(c.contactNumber || "")}` : ""}
        </div>

        <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
          <button class="button-secondary" style="width:auto;" onclick="editCompany('${c.id}')">Edit</button>
          <button class="button-secondary" style="width:auto;" onclick="setDefaultCompany('${c.id}')">Set Default</button>
          <button class="button-danger" style="width:auto;" onclick="deleteCompany('${c.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

function setDefaultCompany(id) {
  if (!id) return;

  // If user companies exist, don’t allow setting cmp_default as default (since it will be hidden)
  if (id === "cmp_default" && getUserCompanies().length) return;

  setDefaultCompanyId(id);
  renderCompanies();
  renderCompanyDropdowns(id);
}

function addOrUpdateCompany() {
  ensureDefaultCompany();

  const idEl = document.getElementById("companyId");
  const nameEl = document.getElementById("companyName");
  const baseRateEl = document.getElementById("companyBaseRate");

  if (!nameEl || !baseRateEl) return;

  const id = (idEl?.value || "").trim();
  const name = (nameEl.value || "").trim();
  const baseRate = Number(baseRateEl.value);

  if (!name) return alert("Please enter a company name");
  if (!Number.isFinite(baseRate)) return alert("Please enter a valid hourly rate");

  const company = {
    id: id || generateCompanyId(),
    name,
    baseRate,

    payMode: document.getElementById("payMode")?.value || "weekly",
	baseWeeklyHours: Number(document.getElementById("baseWeeklyHours")?.value) || 0,
	baseDailyPaidHours: Number(document.getElementById("baseDailyPaidHours")?.value) || 0,
	standardShiftLength: Number(document.getElementById("standardShiftLength")?.value) || 0,
	dailyOTAfterWorkedHours: Number(document.getElementById("dailyOTAfterWorkedHours")?.value) || 0,
	minPaidShiftHours: Number(document.getElementById("minPaidShiftHours")?.value) || 0,

    ot: {
      weekday: Number(document.getElementById("otWeekday")?.value) || 1,
      saturday: Number(document.getElementById("otSaturday")?.value) || 1,
      sunday: Number(document.getElementById("otSunday")?.value) || 1,
      bankHoliday: Number(document.getElementById("otBankHoliday")?.value) || 1
    },

    nightBonus: {
      mode: document.getElementById("nightBonusMode")?.value || "none",
      amount: Number(document.getElementById("nightBonusAmount")?.value) || 0,
      start: document.getElementById("nightBonusStart")?.value || "22:00",
      end: document.getElementById("nightBonusEnd")?.value || "06:00"
    },

    contactName: (document.getElementById("contactName")?.value || "").trim(),
    contactNumber: (document.getElementById("contactNumber")?.value || "").trim(),

    createdAt: id ? (getCompanyById(id)?.createdAt || Date.now()) : Date.now()
  };

  const idx = companies.findIndex(c => c.id === company.id);
  if (idx >= 0) companies[idx] = company;
  else companies.push(company);

  // If first user company created, make it default and hide "Default" by virtue of selectable list
  if (company.id !== "cmp_default") {
    const userCount = getUserCompanies().length;
    const currentDefault = getDefaultCompanyId();
    if (!currentDefault || userCount === 1) setDefaultCompanyId(company.id);
  }

  saveAll();
  resetCompanyForm();
  renderCompanies();
  renderCompanyDropdowns();
}

function openCompanyForm() {
  const wrap = document.getElementById("companyFormWrap");
  if (wrap) wrap.style.display = "block";
}

function editCompany(id) {
  openCompanyForm();
	
  const c = getCompanyById(id);
  if (!c) return;

  const setVal = (elId, val) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.value = (val ?? "");
  };

  setVal("companyId", c.id);
  setVal("companyName", c.name);
  setVal("companyBaseRate", c.baseRate);

  // Pay mode first (so UI can react)
  setVal("payMode", c.payMode || "weekly");

  // If you have UI logic to show/hide daily OT + night bonus fields, call it here
  if (typeof updateCompanyFormVisibility === "function") {
    updateCompanyFormVisibility();
  } else {
    // Minimal fallback: show daily OT input only when daily mode
    const dailyWrap = document.getElementById("dailyOTAfterWorkedHours")?.closest(".field") || null;
    if (dailyWrap) dailyWrap.style.display = (c.payMode === "daily") ? "" : "none";
  }

  setVal("dailyOTAfterWorkedHours", c.dailyOTAfterWorkedHours);
  setVal("minPaidShiftHours", c.minPaidShiftHours);

  // Night bonus
  const nb = c.nightBonus || {};
  setVal("nightBonusMode", nb.mode || "none");
  setVal("nightBonusAmount", nb.amount ?? 0);
  setVal("nightBonusStart", nb.start || "22:00");
  setVal("nightBonusEnd", nb.end || "06:00");

  // OT multipliers
  setVal("otWeekday", c.ot?.weekday);
  setVal("otSaturday", c.ot?.saturday);
  setVal("otSunday", c.ot?.sunday);
  setVal("otBankHoliday", c.ot?.bankHoliday);

  // Hours rules
  setVal("baseWeeklyHours", c.baseWeeklyHours);
  setVal("baseDailyPaidHours", c.baseDailyPaidHours);
  setVal("standardShiftLength", c.standardShiftLength);

  // Contact
  setVal("contactName", c.contactName);
  setVal("contactNumber", c.contactNumber);

  // If your companies page uses a collapsible form, open it automatically when editing
  if (typeof openCompanyForm === "function") openCompanyForm();
}

function deleteCompany(id) {
  ensureDefaultCompany();

  if (id === "cmp_default") {
    alert("The built-in Default company can't be deleted.");
    return;
  }

  const userCompanies = getUserCompanies();
  if (userCompanies.length <= 1) {
    alert("You must keep at least one company.");
    return;
  }

  const inUse = shifts.some(s => s.companyId === id);
  if (inUse) {
    alert("This company is used by existing shifts. Reassign or delete those shifts first.");
    return;
  }

  if (!confirm("Delete this company?")) return;

  companies = companies.filter(c => c.id !== id);

  // If deleting default, pick first remaining user company
  if (getDefaultCompanyId() === id) {
    const remaining = getUserCompanies();
    if (remaining.length) setDefaultCompanyId(remaining[0].id);
  }

  saveAll();
  renderCompanies();
  renderCompanyDropdowns();
}

function resetCompanyForm() {
  const ids = [
    "companyId", "companyName", "companyBaseRate",
    "payMode", "baseWeeklyHours", "dailyOTAfterWorkedHours", "minPaidShiftHours",
    "otWeekday", "otSaturday", "otSunday", "otBankHoliday",
    "nightBonusMode", "nightBonusAmount", "nightBonusStart", "nightBonusEnd",
    "contactName", "contactNumber"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // sensible defaults
  if (document.getElementById("companyBaseRate")) document.getElementById("companyBaseRate").value = settings.baseRate ?? 17.75;
  if (document.getElementById("payMode")) document.getElementById("payMode").value = "weekly";
  if (document.getElementById("baseWeeklyHours")) document.getElementById("baseWeeklyHours").value = settings.baseHours ?? 45;
  if (document.getElementById("dailyOTAfterWorkedHours")) document.getElementById("dailyOTAfterWorkedHours").value = 0;
  if (document.getElementById("minPaidShiftHours")) document.getElementById("minPaidShiftHours").value = 0;
  if (document.getElementById("baseDailyPaidHours")) document.getElementById("baseDailyPaidHours").value = 0;
  if (document.getElementById("standardShiftLength")) document.getElementById("standardShiftLength").value = 0;

  if (document.getElementById("otWeekday")) document.getElementById("otWeekday").value = settings.otWeekday ?? 1.25;
  if (document.getElementById("otSaturday")) document.getElementById("otSaturday").value = settings.otSaturday ?? 1.25;
  if (document.getElementById("otSunday")) document.getElementById("otSunday").value = settings.otSunday ?? 1.5;
  if (document.getElementById("otBankHoliday")) document.getElementById("otBankHoliday").value = settings.otBankHoliday ?? 2;

  if (document.getElementById("nightBonusMode")) document.getElementById("nightBonusMode").value = "none";
  if (document.getElementById("nightBonusAmount")) document.getElementById("nightBonusAmount").value = 0.5;
  if (document.getElementById("nightBonusStart")) document.getElementById("nightBonusStart").value = "22:00";
  if (document.getElementById("nightBonusEnd")) document.getElementById("nightBonusEnd").value = "06:00";
  
  updateCompanyFormVisibility();
}

/* ===============================
   SETTINGS PAGE
================================ */

function loadSettings() {
  if (!document.getElementById("baseRate")) return;

  document.getElementById("defaultStart").value = settings.defaultStart;
  document.getElementById("baseRate").value = settings.baseRate;
  document.getElementById("baseHours").value = settings.baseHours;
  document.getElementById("otWeekday").value = settings.otWeekday;
  document.getElementById("otSaturday").value = settings.otSaturday;
  document.getElementById("otSunday").value = settings.otSunday;
  document.getElementById("otBankHoliday").value = settings.otBankHoliday;
}

function saveSettings() {
  settings.defaultStart = document.getElementById("defaultStart")?.value || "";
  settings.baseRate = Number(document.getElementById("baseRate")?.value) || 0;
  settings.baseHours = Number(document.getElementById("baseHours")?.value) || 0;
  settings.otWeekday = Number(document.getElementById("otWeekday")?.value) || 1;
  settings.otSaturday = Number(document.getElementById("otSaturday")?.value) || 1;
  settings.otSunday = Number(document.getElementById("otSunday")?.value) || 1;
  settings.otBankHoliday = Number(document.getElementById("otBankHoliday")?.value) || 1;

  saveAll();
  alert("Settings saved");
}

/* ===============================
   VEHICLES
================================ */

function addVehicle() {
  const input = document.getElementById("newVehicle");
  if (!input) return;

  const reg = input.value.toUpperCase().trim();
  if (!reg) return;

  if (!vehicles.includes(reg)) vehicles.push(reg);

  saveAll();
  renderVehicles();
  input.value = "";
}

function deleteVehicle(i) {
  if (!Number.isInteger(i) || i < 0 || i >= vehicles.length) return;
  vehicles.splice(i, 1);
  saveAll();
  renderVehicles();
}

function renderVehicles() {
  const list = document.getElementById("vehicleList");
  const dropdown = document.getElementById("vehicle");

  if (list) list.innerHTML = "";
  if (dropdown && dropdown.tagName === "SELECT") {
    dropdown.innerHTML = "<option value=''>Select Vehicle</option>";
  }

  vehicles.forEach((v, i) => {
    if (dropdown && dropdown.tagName === "SELECT") {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      dropdown.appendChild(opt);
    }

    if (list) {
      const div = document.createElement("div");
      div.className = "shift-card";
      div.innerHTML = `${escapeHtml(v)} <button onclick="deleteVehicle(${i})">Delete</button>`;
      list.appendChild(div);
    }
  });

  // Keep combobox suggestions in sync on enter-shift page.
  renderVehicleMenuOptions((document.getElementById("vehicle")?.value || ""));
}

function renderVehicleMenuOptions(filterText = "") {
  const menu = document.getElementById("vehicleMenu");
  if (!menu) return;

  const filter = String(filterText || "").toUpperCase().trim();
  const options = vehicles
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .filter(v => !filter || v.includes(filter));

  if (!options.length) {
    menu.innerHTML = `<div class="combo-empty">No matches. Type a new registration.</div>`;
    return;
  }

  menu.innerHTML = options
    .map(v => `<button type="button" class="combo-option" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`)
    .join("");
}

function initVehicleCombobox() {
  const input = document.getElementById("vehicle");
  const menu = document.getElementById("vehicleMenu");
  const wrap = document.getElementById("vehicleComboWrap");
  if (!input || !menu || !wrap) return;

  const openMenu = () => {
    renderVehicleMenuOptions(input.value);
    menu.hidden = false;
  };
  const closeMenu = () => {
    menu.hidden = true;
  };

  input.addEventListener("focus", openMenu);
  input.addEventListener("click", openMenu);

  input.addEventListener("input", () => {
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    input.value = (input.value || "").toUpperCase().replace(/\s+/g, " ").trimStart();
    input.setSelectionRange(start, end);
    openMenu();
  });

  input.addEventListener("change", () => {
    input.value = (input.value || "").toUpperCase().trim();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // Keep focus in input when choosing an option.
  menu.addEventListener("mousedown", (e) => e.preventDefault());
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".combo-option");
    if (!btn) return;
    input.value = (btn.getAttribute("data-value") || "").toUpperCase().trim();
    closeMenu();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeMenu();
  });
}

/* ===============================
   HOURS + NIGHT HOURS
================================ */

function calculateHours(start, finish, isAL) {
  if (isAL) return { worked: 9, breaks: 0, paid: 9 };

  if (!start || !finish) return { worked: 0, breaks: 0, paid: 0 };

  let s = new Date("1970-01-01T" + start + ":00");
  let f = new Date("1970-01-01T" + finish + ":00");
  if (f < s) f.setDate(f.getDate() + 1);

  const worked = (f - s) / 1000 / 60 / 60;
  const breaks = 1;
  const paid = Math.max(0, worked - breaks);

  return { worked, breaks, paid };
}

function calcNightHoursForShift(start, finish, winStart, winEnd, isAnnualLeave) {
  if (isAnnualLeave) return 0;
  if (!start || !finish) return 0;

  let s = timeToMinutes(start);
  let f = timeToMinutes(finish);

  // cross midnight
  if (f <= s) f += 1440;

  const ws = timeToMinutes(winStart);
  const we = timeToMinutes(winEnd);

  const windows = [];
  if (we > ws) {
    windows.push([ws, we]);
    windows.push([ws + 1440, we + 1440]);
  } else {
    windows.push([ws, 1440]);
    windows.push([0, we]);
    windows.push([ws + 1440, 2880]);
    windows.push([1440, we + 1440]);
  }

  let minutes = 0;
  for (const [a, b] of windows) {
    minutes += overlapMinutes(s, f, a, b);
  }

  return minutes / 60;
}

/* ===============================
   SHIFT RULES (min paid etc.)
================================ */

function applyCompanyPaidRules(shift) {
  const c = getCompanyById(shift.companyId);
  const minPaid = clamp0(shift.overrides?.minPaidShiftHours ?? c?.minPaidShiftHours ?? 0);

  if (!shift.annualLeave && minPaid > 0) {
    shift.paid = Math.max(clamp0(shift.paid), minPaid);
  }
  return shift;
}

function splitPaidIntoBaseAndOT_DailyWorked(shift) {
  const c = getCompanyById(shift.companyId);

  const payMode = shift?.overrides?.payMode ?? c?.payMode ?? "weekly";

  // The user/shift/company may not have set this. We'll fall back sensibly.
  let thresholdWorked = clamp0(
    shift?.overrides?.dailyOTAfterWorkedHours ??
    c?.dailyOTAfterWorkedHours ??
    0
  );

  const paid = clamp0(shift?.paid);
  const worked = clamp0(shift?.worked);

  // Bank holiday: treat whole paid shift as OT hours for reporting/pricing
  if (shift?.bankHoliday) {
    return { baseHours: 0, otHours: paid };
  }

  // Annual leave: treat as base hours
  if (shift?.annualLeave) {
    return { baseHours: paid, otHours: 0 };
  }

  // Only daily mode uses daily OT threshold
  if (payMode !== "daily") {
    return { baseHours: paid, otHours: 0 };
  }

  // ✅ Fix: if daily mode is selected but threshold is missing/0,
  // fall back to a sensible default:
  // company standardShiftLength -> 10 hours
  if (thresholdWorked <= 0) {
    thresholdWorked = clamp0(c?.standardShiftLength ?? 10);
  }

  // If still 0 for any reason, treat as no daily OT rule
  if (thresholdWorked <= 0) {
    return { baseHours: paid, otHours: 0 };
  }

  // Overtime is based on WORKED hours, but paid hours are worked-break.
  // OT worked hours:
  const otWorked = Math.max(0, worked - thresholdWorked);

  // Map OT worked -> OT paid:
  // OT paid cannot exceed paid hours, and is capped by otWorked
  const otPaid = Math.min(paid, otWorked);

  return {
    baseHours: Math.max(0, paid - otPaid),
    otHours: otPaid
  };
}

/* ===============================
   DEFAULTS ON ENTRY PAGE
================================ */

function applyDefaultsToShiftEntry({ force = false } = {}) {
  const startEl = document.getElementById("start");
  if (!startEl) return;

  if (!force && editingIndex !== null) return;

  if ((force || !startEl.value) && settings?.defaultStart) {
    startEl.value = settings.defaultStart;
  }

  const dateEl = document.getElementById("date");
  if (dateEl && (force || !dateEl.value)) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }

  const companyEl = document.getElementById("company");
  if (companyEl && (force || !companyEl.value)) {
    renderCompanyDropdowns();
  }
}

/* ===============================
   ADD / UPDATE SHIFT
================================ */

function addOrUpdateShift() {
  const dateInput = document.getElementById("date");
  if (!dateInput) return;

  ensureDefaultCompany();

  const date = (dateInput.value || "").trim();
  if (!date) return alert("Select date");

  const companyEl = document.getElementById("company");
  if (!companyEl) return alert("Company dropdown not found (id='company').");

  const companyId = (companyEl.value || "").trim();
  if (!companyId) return alert("Select a company");

  const vehicleRaw = document.getElementById("vehicle")?.value || "";
  const vehicle = vehicleRaw.toUpperCase().trim();

  if (vehicle && !vehicles.includes(vehicle)) {
    vehicles.push(vehicle);
  }

  const shift = {
    id: (editingIndex !== null && shifts[editingIndex]?.id) ? shifts[editingIndex].id : generateShiftId(),
    date,
    companyId,

    start: document.getElementById("start")?.value || "",
    finish: document.getElementById("finish")?.value || "",
    vehicle,
    trailer1: document.getElementById("trailer1")?.value || "",
    trailer2: document.getElementById("trailer2")?.value || "",
    defects: document.getElementById("defects")?.value || "",
    annualLeave: !!document.getElementById("annualLeave")?.checked,
    bankHoliday: !!document.getElementById("bankHoliday")?.checked,

    createdAt:
      (editingIndex !== null && shifts[editingIndex]?.createdAt)
        ? shifts[editingIndex].createdAt
        : Date.now()
  };

  // Hours
  const hrs = calculateHours(shift.start, shift.finish, shift.annualLeave);
  shift.worked = hrs.worked;
  shift.breaks = hrs.breaks;
  shift.paid = hrs.paid;

  // Apply company rules (min paid, etc.)
  applyCompanyPaidRules(shift);

  // Store base/ot split for daily mode (weekly mode stays base=paid until weekly allocation)
  const split = splitPaidIntoBaseAndOT_DailyWorked(shift);
  shift.baseHours = split.baseHours;
  shift.otHours = split.otHours;

  if (editingIndex !== null) {
    shifts[editingIndex] = shift;
    editingIndex = null;
  } else {
    shifts.push(shift);
  }

  saveAll();
  clearForm();
  renderAll();
}

function clearForm() {
  document.querySelectorAll("input, textarea").forEach(el => {
    if (el.type === "checkbox") el.checked = false;
    else if (el.type !== "file") el.value = "";
  });

  const vehicle = document.getElementById("vehicle");
  if (vehicle) vehicle.value = "";

  // keep company selection if still selected; otherwise re-pick default
  const company = document.getElementById("company");
  if (!company || !company.value) renderCompanyDropdowns();

  // re-apply defaults (this fixes your “start time blank after reset” issue)
  applyDefaultsToShiftEntry();
}

/* ===============================
   PAY ENGINE
================================ */

function getShiftRateProfile(shift) {
  const c = getCompanyById(shift.companyId);

  const baseRate = Number(shift.overrides?.baseRate ?? c?.baseRate ?? settings.baseRate ?? 0);

  const ot = {
    weekday: Number(shift.overrides?.otWeekday ?? c?.ot?.weekday ?? settings.otWeekday ?? 1),
    saturday: Number(shift.overrides?.otSaturday ?? c?.ot?.saturday ?? settings.otSaturday ?? 1),
    sunday: Number(shift.overrides?.otSunday ?? c?.ot?.sunday ?? settings.otSunday ?? 1),
    bankHoliday: Number(shift.overrides?.otBankHoliday ?? c?.ot?.bankHoliday ?? settings.otBankHoliday ?? 1)
  };

  return { baseRate, ot };
}

function getShiftOTMultiplier(shift, profile) {
  if (shift.bankHoliday) return profile.ot.bankHoliday;

  const day = new Date((shift.date || "") + "T00:00:00").getDay();
  if (day === 6) return profile.ot.saturday;
  if (day === 0) return profile.ot.sunday;
  return profile.ot.weekday;
}

function getCompanyPayMode(companyId) {
  const c = getCompanyById(companyId);
  return c?.payMode || "weekly";
}

function getCompanyWeeklyBaseHours(companyId) {
  const c = getCompanyById(companyId);
  return Number(c?.baseWeeklyHours ?? settings.baseHours ?? 0);
}

function sumResults(a, b) {
  return {
    worked: (a.worked || 0) + (b.worked || 0),
    breaks: (a.breaks || 0) + (b.breaks || 0),
    paid: (a.paid || 0) + (b.paid || 0),
    otHours: (a.otHours || 0) + (b.otHours || 0),
    basePay: (a.basePay || 0) + (b.basePay || 0),
    otPay: (a.otPay || 0) + (b.otPay || 0),
    nightHours: (a.nightHours || 0) + (b.nightHours || 0),
    nightPay: (a.nightPay || 0) + (b.nightPay || 0),
    total: (a.total || 0) + (b.total || 0),
  };
}

function processMonthAsWeeks(monthShifts, modeForWeek = "overall") {
  if (!Array.isArray(monthShifts) || monthShifts.length === 0) {
    return { worked: 0, breaks: 0, paid: 0, otHours: 0, basePay: 0, otPay: 0, nightHours: 0, nightPay: 0, total: 0 };
  }

  const weeks = {};
  monthShifts.forEach(s => {
    const wk = getWeekStartMonday(s.date);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(s);
  });

  return Object.keys(weeks)
    .sort((a, b) => new Date(a) - new Date(b))
    .reduce((acc, wk) => sumResults(acc, processShifts(weeks[wk], modeForWeek)), {
      worked: 0, breaks: 0, paid: 0, otHours: 0, basePay: 0, otPay: 0, nightHours: 0, nightPay: 0, total: 0
    });
}

/**
 * mode:
 *  - "overall": weekly OT threshold applies to ALL weekly-mode companies combined (daily-mode stays daily)
 *  - "perCompany": weekly OT threshold applies per company (weekly-mode only)
 *  - "monthOverall": no weekly allocation (daily-mode still uses split; weekly-mode treated as base, BH as OT)
 */
function processShifts(group, mode = "overall") {
  const arr = Array.isArray(group) ? [...group] : [];

  let totalWorked = 0, totalBreaks = 0, totalPaid = 0;
  let totalOTHours = 0, basePay = 0, otPay = 0;

  let nightHoursTotal = 0;
  let nightPayTotal = 0;
  const nightWeeklyPaid = new Set();

  // Normalize + totals + ensure baseHours/otHours exist for daily-mode logic
  arr.forEach(s => {
    totalWorked += Number(s.worked || 0);
    totalBreaks += Number(s.breaks || 0);
    totalPaid += Number(s.paid || 0);

    if (typeof s.baseHours !== "number" || typeof s.otHours !== "number") {
      const split = splitPaidIntoBaseAndOT_DailyWorked(s);
      s.baseHours = split.baseHours;
      s.otHours = split.otHours;
    }
  });

  // Month mode = sum per-shift pricing (no weekly allocation across month)
  if (mode === "monthOverall") {
    const nightWeeklyPaidMonth = new Set();

    arr.forEach(s => {
      const profile = getShiftRateProfile(s);
      const mult = getShiftOTMultiplier(s, profile);
      const company = getCompanyById(s.companyId);
      const nb = company?.nightBonus || { mode: "none", amount: 0, start: "22:00", end: "06:00" };

      // Night bonus (per shift)
      const nh = calcNightHoursForShift(
        s.start,
        s.finish,
        nb.start || "22:00",
        nb.end || "06:00",
        !!s.annualLeave
      );
      nightHoursTotal += nh;

      if (nb.mode === "per_hour") {
        nightPayTotal += nh * (Number(nb.amount) || 0);
      } else if (nb.mode === "per_shift") {
        if (nh > 0) nightPayTotal += (Number(nb.amount) || 0);
      } else if (nb.mode === "per_week") {
        if (nh > 0) {
          const wk = getWeekStartMonday(s.date || "");
          const key = `${wk}|${String(s.companyId || "")}`;
          if (!nightWeeklyPaidMonth.has(key)) {
            nightWeeklyPaidMonth.add(key);
            nightPayTotal += (Number(nb.amount) || 0);
          }
        }
      }

      if (s.bankHoliday) {
        const paid = Number(s.paid || 0);
        otPay += paid * profile.baseRate * mult;
        totalOTHours += paid;
      } else if (s.annualLeave) {
        const paid = Number(s.paid || 0);
        basePay += paid * profile.baseRate;
      } else {
        const baseH = Number(s.baseHours || 0);
        const otH = Number(s.otHours || 0);
        basePay += baseH * profile.baseRate;
        otPay += otH * profile.baseRate * mult;
        totalOTHours += otH;
      }
    });

    return {
      worked: totalWorked,
      breaks: totalBreaks,
      paid: totalPaid,
      otHours: totalOTHours,
      basePay,
      otPay,
      nightHours: nightHoursTotal,
      nightPay: nightPayTotal,
      total: basePay + otPay + nightPayTotal
    };
  }

  // Sort for predictable weekly allocation
  arr.sort((a, b) => {
    const ad = (a.date || "").localeCompare(b.date || "");
    if (ad !== 0) return ad;
    return (a.start || "").localeCompare(b.start || "");
  });

  const weeklyCandidates = [];

  // First pass: price daily-mode shifts immediately, queue weekly-mode shifts
  arr.forEach(s => {
    const profile = getShiftRateProfile(s);
    const mult = getShiftOTMultiplier(s, profile);
    const company = getCompanyById(s.companyId);
    const payMode = company?.payMode || "weekly";

    // --- Night bonus calc (per shift, safe, inside loop)
    const nb = company?.nightBonus || { mode: "none", amount: 0, start: "22:00", end: "06:00" };
    if (typeof calcNightHoursForShift === "function") {
      const nh = calcNightHoursForShift(
        s.start,
        s.finish,
        nb.start || "22:00",
        nb.end || "06:00",
        !!s.annualLeave
      );
      nightHoursTotal += nh;

      if (nb.mode === "per_hour") {
        nightPayTotal += nh * (Number(nb.amount) || 0);
      } else if (nb.mode === "per_shift") {
        if (nh > 0) nightPayTotal += (Number(nb.amount) || 0);
      } else if (nb.mode === "per_week") {
        if (nh > 0) {
          const key = String(s.companyId || "");
          if (key && !nightWeeklyPaid.has(key)) {
            nightWeeklyPaid.add(key);
            nightPayTotal += (Number(nb.amount) || 0);
          }
        }
      }
    }

    // --- Bank holiday: whole paid shift is OT
    if (s.bankHoliday) {
      const paid = Number(s.paid || 0);
      otPay += paid * profile.baseRate * mult;
      totalOTHours += paid;
      return;
    }

    // --- Annual leave: base pay
    if (s.annualLeave) {
      const paid = Number(s.paid || 0);
      basePay += paid * profile.baseRate;
      return;
    }

    // --- Daily OT mode: use baseHours/otHours split
    if (payMode === "daily") {
      const baseH = Number(s.baseHours || 0);
      const otH = Number(s.otHours || 0);

      basePay += baseH * profile.baseRate;
      otPay += otH * profile.baseRate * mult;
      totalOTHours += otH;
      return;
    }

    // --- Weekly mode: defer OT allocation
    weeklyCandidates.push(s);
  });

  // Weekly allocation
  if (weeklyCandidates.length) {
    if (mode === "perCompany") {
      const remainingByCompany = {};

      weeklyCandidates.forEach(s => {
        if (!(s.companyId in remainingByCompany)) {
          remainingByCompany[s.companyId] = getCompanyWeeklyBaseHours(s.companyId);
        }

        const profile = getShiftRateProfile(s);
        const mult = getShiftOTMultiplier(s, profile);
        const paid = Number(s.paid || 0);

        let remaining = remainingByCompany[s.companyId];

        if (remaining > 0) {
          if (paid <= remaining) {
            basePay += paid * profile.baseRate;
            remainingByCompany[s.companyId] = remaining - paid;
          } else {
            basePay += remaining * profile.baseRate;
            const ot = paid - remaining;
            otPay += ot * profile.baseRate * mult;
            totalOTHours += ot;
            remainingByCompany[s.companyId] = 0;
          }
        } else {
          otPay += paid * profile.baseRate * mult;
          totalOTHours += paid;
        }
      });
    } else {
      // overall weekly threshold uses settings.baseHours
      let remainingBase = Number(settings.baseHours ?? 0);

      weeklyCandidates.forEach(s => {
        const profile = getShiftRateProfile(s);
        const mult = getShiftOTMultiplier(s, profile);
        const paid = Number(s.paid || 0);

        if (remainingBase > 0) {
          if (paid <= remainingBase) {
            basePay += paid * profile.baseRate;
            remainingBase -= paid;
          } else {
            basePay += remainingBase * profile.baseRate;
            const ot = paid - remainingBase;
            otPay += ot * profile.baseRate * mult;
            totalOTHours += ot;
            remainingBase = 0;
          }
        } else {
          otPay += paid * profile.baseRate * mult;
          totalOTHours += paid;
        }
      });
    }
  }

  return {
    worked: totalWorked,
    breaks: totalBreaks,
    paid: totalPaid,
    otHours: totalOTHours,
    basePay,
    otPay,
    nightHours: nightHoursTotal,
    nightPay: nightPayTotal,
    total: basePay + otPay + nightPayTotal
  };
}
/* ===============================
   SUMMARY: WEEK/MONTH TILES
================================ */

function getCurrentWeekStartMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  now.setDate(now.getDate() + diff);
  now.setHours(0, 0, 0, 0);
  return now;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateOnlyToDate(dateStr) {
  return new Date((dateStr || "") + "T00:00:00");
}

const TILE_SPECS = {
  worked: { label: "Worked", type: "hours" },
  breaks: { label: "Breaks", type: "hours" },
  paid: { label: "Paid", type: "hours" },
  baseHours: { label: "Base Hours", type: "hours" },
  otHours: { label: "OT Hours", type: "hours" },
  basePay: { label: "Base Pay", type: "money" },
  otPay: { label: "OT Pay", type: "money" },
  nightPay: { label: "Night Pay", type: "money" },
  total: { label: "Total", type: "money" }
};

function renderBreakdownTiles(targetId, titleLabel, result, order) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const worked = Number(result.worked || 0);
  const breaks = Number(result.breaks || 0);
  const paid = Number(result.paid || 0);
  const otHours = Number(result.otHours || 0);
  const baseHours = Math.max(0, paid - otHours);

  const basePay = Number(result.basePay || 0);
  const otPay = Number(result.otPay || 0);
  const nightPay = Number(result.nightPay || 0);
  const total = Number(result.total || 0);

  const values = {
    worked,
    breaks,
    paid,
    baseHours,
    otHours,
    basePay,
    otPay,
    nightPay,
    total
  };

  const fmt = (type, val) => {
    if (type === "money") return `£${Number(val || 0).toFixed(2)}`;
    return `${Number(val || 0).toFixed(2)} hrs`;
  };

  const list = Array.isArray(order) && order.length
    ? order
    : ["worked", "breaks", "paid", "baseHours", "otHours", "basePay", "otPay", "nightPay", "total"];

  const prefix = titleLabel ? `${titleLabel} ` : "";
  el.innerHTML = list.map(key => {
    const spec = TILE_SPECS[key];
    if (!spec) return "";
    const value = fmt(spec.type, values[key]);
    return `<div class="tile"><div class="label">${prefix}${spec.label}</div><div class="value">${value}</div></div>`;
  }).join("");
}

function renderCurrentPeriodTiles() {
  const weekTiles = document.getElementById("thisWeekTiles");
  const monthTiles = document.getElementById("thisMonthTiles");
  if (!weekTiles && !monthTiles) return;

  const isSummaryPage = !!document.getElementById("panelWeek");
  const order = isSummaryPage
    ? ["worked", "paid", "baseHours", "basePay", "otHours", "otPay", "breaks", "nightPay", "total"]
    : ["worked", "otHours", "basePay", "otPay", "nightPay", "total"];

  const weekStart = getCurrentWeekStartMonday();
  const weekEnd = addDays(weekStart, 7);

  const weekShifts = shifts.filter(s => {
    const d = dateOnlyToDate(s.date);
    return d >= weekStart && d < weekEnd;
  });

  const weekResult = processShifts(weekShifts, "overall");
  renderBreakdownTiles("thisWeekTiles", "", weekResult, order);

  const ym = new Date().toISOString().slice(0, 7);
  const monthShifts = shifts.filter(s => (s.date || "").slice(0, 7) === ym);

  const monthResult = processMonthAsWeeks(monthShifts, "overall");
  renderBreakdownTiles("thisMonthTiles", "", monthResult, order);
}

/* ===============================
   COMPANY SUMMARY (collapsible)
================================ */

function renderCompanySummary() {
  const container = document.getElementById("companySummary");
  if (!container) return;

  ensureDefaultCompany();

  const weekStart = getCurrentWeekStartMonday();
  const weekEnd = addDays(weekStart, 7);
  const ym = new Date().toISOString().slice(0, 7);

  const weekShifts = shifts.filter(s => {
    const d = dateOnlyToDate(s.date);
    return d >= weekStart && d < weekEnd;
  });

  const monthShifts = shifts.filter(s => (s.date || "").slice(0, 7) === ym);

  const groupByCompany = (arr) => {
    const out = {};
    arr.forEach(s => {
      const cid = s.companyId || "";
      if (!out[cid]) out[cid] = [];
      out[cid].push(s);
    });
    return out;
  };

  const weekBy = groupByCompany(weekShifts);
  const monthBy = groupByCompany(monthShifts);

  const ids = new Set([...Object.keys(weekBy), ...Object.keys(monthBy)]);
  ids.delete("");

  const ordered = [...ids].sort((a, b) => {
    const an = getCompanyById(a)?.name || "Unknown";
    const bn = getCompanyById(b)?.name || "Unknown";
    return an.localeCompare(bn);
  });

  if (!ordered.length) {
    container.innerHTML = `<div class="shift-card">No company data yet for this week/month.</div>`;
    return;
  }

  const line = (label, r) => {
    const paid = Number(r.paid || 0);
    const otH = Number(r.otHours || 0);
    const baseH = Math.max(0, paid - otH);

    return `
      <div class="shift-card" style="margin-top:12px;">
        <strong>${escapeHtml(label)}</strong><br>
        Worked: ${Number(r.worked || 0).toFixed(2)} hrs<br>
        Breaks: ${Number(r.breaks || 0).toFixed(2)} hrs<br>
        Paid: ${paid.toFixed(2)} hrs<br>
        Base Hours: ${baseH.toFixed(2)} hrs<br>
        OT Hours: ${otH.toFixed(2)} hrs<br>
        Night Pay: £${Number(r.nightPay || 0).toFixed(2)}<br>
        Base Pay: £${Number(r.basePay || 0).toFixed(2)}<br>
        OT Pay: £${Number(r.otPay || 0).toFixed(2)}<br>
        Total: £${Number(r.total || 0).toFixed(2)}
      </div>
    `;
  };

  container.innerHTML = ordered.map(cid => {
    const name = getCompanyById(cid)?.name || "Unknown Company";
    const w = processShifts(weekBy[cid] || [], "perCompany");
    const m = processMonthAsWeeks(monthBy[cid] || [], "perCompany");

    return `
      <div class="week-group">
        <div class="week-header" onclick="toggleCompanySummary('${cid}')">
          <span>${escapeHtml(name)}</span>
          <span class="small">Week £${Number(w.total || 0).toFixed(2)} • Month £${Number(m.total || 0).toFixed(2)}</span>
        </div>
        <div class="week-content" id="cmp-${cid}" style="display:none;">
          ${line("This Week", w)}
          ${line("This Month", m)}
        </div>
      </div>
    `;
  }).join("");
}

function toggleCompanySummary(companyId) {
  const el = document.getElementById(`cmp-${companyId}`);
  if (!el) return;
  el.style.display = (el.style.display === "none") ? "block" : "none";
}

function updateCompanyFormVisibility() {
  const payModeEl = document.getElementById("payMode");
  const nbModeEl = document.getElementById("nightBonusMode");
  if (!payModeEl && !nbModeEl) return; // not on companies page

  const dailyOTRow = document.getElementById("dailyOTRow");
  const nightWindow = document.getElementById("nightBonusWindow");

  if (dailyOTRow) {
    dailyOTRow.hidden = (payModeEl?.value !== "daily");
  }

  if (nightWindow) {
    nightWindow.hidden = (nbModeEl?.value === "none");
  }
}

document.addEventListener("change", (e) => {
  if (e.target?.id === "payMode" || e.target?.id === "nightBonusMode") {
    updateCompanyFormVisibility();
  }
});
/* ===============================
   WEEKLY + MONTHLY LISTS (legacy blocks)
   (kept minimal; your tiles + company summary are the “modern” bit)
================================ */

function getMonday(date) {
  let d = new Date(date + "T00:00:00");
  let day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  return d.toISOString().split("T")[0];
}

function renderWeekly() {
  const container = document.getElementById("weeklySummary");
  if (!container) return;

  const weeks = {};
  shifts.forEach(s => {
    const monday = getMonday(s.date);
    if (!weeks[monday]) weeks[monday] = [];
    weeks[monday].push(s);
  });

  const html = Object.keys(weeks)
    .sort((a, b) => new Date(b) - new Date(a))
    .map(week => {
      const r = processShifts(weeks[week], "overall");
      return `
        <div class="shift-card">
          <strong>Week Starting ${escapeHtml(week)}</strong><br>
          Worked: ${Number(r.worked || 0).toFixed(2)} hrs<br>
          Breaks: ${Number(r.breaks || 0).toFixed(2)} hrs<br>
          Paid: ${Number(r.paid || 0).toFixed(2)} hrs<br>
          OT Hours: ${Number(r.otHours || 0).toFixed(2)}<br>
          Night Pay: £${Number(r.nightPay || 0).toFixed(2)}<br>
          Base: £${Number(r.basePay || 0).toFixed(2)}<br>
          OT: £${Number(r.otPay || 0).toFixed(2)}<br>
          Total: £${Number(r.total || 0).toFixed(2)}
        </div>
      `;
    }).join("");

  container.innerHTML = html;
}

function renderMonthly() {
  const container = document.getElementById("monthlySummary");
  if (!container) return;

  const months = {};
  shifts.forEach(s => {
    const month = (s.date || "").slice(0, 7);
    if (!months[month]) months[month] = [];
    months[month].push(s);
  });

  const html = Object.keys(months)
    .sort((a, b) => b.localeCompare(a))
    .map(m => {
      const r = processMonthAsWeeks(months[m], "overall");
      return `
        <div class="shift-card">
          <strong>${escapeHtml(m)}</strong><br>
          Worked: ${Number(r.worked || 0).toFixed(2)} hrs<br>
          Breaks: ${Number(r.breaks || 0).toFixed(2)} hrs<br>
          Paid: ${Number(r.paid || 0).toFixed(2)} hrs<br>
          OT Hours: ${Number(r.otHours || 0).toFixed(2)}<br>
          Night Pay: £${Number(r.nightPay || 0).toFixed(2)}<br>
          Base: £${Number(r.basePay || 0).toFixed(2)}<br>
          OT: £${Number(r.otPay || 0).toFixed(2)}<br>
          Total: £${Number(r.total || 0).toFixed(2)}
        </div>
      `;
    }).join("");

  container.innerHTML = html;
}

/* ===============================
   SHIFTS PAGE: WEEKLY GROUPED VIEW
================================ */

function getWeekStartMonday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function formatShiftLine(s, index) {
  const companyName = getCompanyById(s.companyId)?.name || "Unknown Company";
  const flags = [s.annualLeave ? "AL" : "", s.bankHoliday ? "BH" : ""].filter(Boolean).join(" ");

  const defects = (s.defects || "").trim();
  const defectsPreview = defects.length > 80 ? defects.slice(0, 80) + "…" : defects;

  return `
    <div class="shift-card">
      <strong>${escapeHtml(s.date)}</strong> ${flags ? `(${escapeHtml(flags)})` : ""}<br>
      <div class="meta">
        <div>${escapeHtml(companyName)}</div>
        ${(s.start && s.finish) ? `<div>${escapeHtml(s.start)} – ${escapeHtml(s.finish)}</div>` : ""}
        ${s.vehicle ? `<div>Vehicle: ${escapeHtml(s.vehicle)}</div>` : ""}
        ${s.trailer1 ? `<div>Trailer 1: ${escapeHtml(s.trailer1)}</div>` : ""}
        ${s.trailer2 ? `<div>Trailer 2: ${escapeHtml(s.trailer2)}</div>` : ""}
        <div>Worked: ${Number(s.worked || 0).toFixed(2)} • Breaks: ${Number(s.breaks || 0).toFixed(2)} • Paid: ${Number(s.paid || 0).toFixed(2)}</div>
        ${defects ? `<div>Defects: ${escapeHtml(defectsPreview)}</div>` : ""}
        ${defects && defects.length > 80 ? `<details style="margin-top:8px;"><summary class="small">View full defects</summary><div style="margin-top:8px;">${escapeHtml(defects).replaceAll("\n","<br>")}</div></details>` : ""}
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="button-secondary" style="width:auto;" onclick="startEditShift(${index})">Edit</button>
        <button class="button-danger" style="width:auto;" onclick="deleteShift(${index})">Delete</button>
      </div>
    </div>
  `;
}

function renderWeeklyGroupedShifts() {
  const container = document.getElementById("shiftList");
  if (!container) return;

  if (!Array.isArray(shifts) || shifts.length === 0) {
    container.innerHTML = `<div class="shift-card">No shifts saved yet.</div>`;
    return;
  }

  const grouped = {};
  shifts.forEach((s, idx) => {
    const wk = getWeekStartMonday(s.date);
    if (!grouped[wk]) grouped[wk] = [];
    grouped[wk].push({ ...s, __index: idx });
  });

  const weeks = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

  container.innerHTML = weeks.map(weekStart => {
    grouped[weekStart].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.start || "").localeCompare(b.start || ""));

    const totals = grouped[weekStart].reduce((acc, s) => {
      acc.paid += Number(s.paid || 0);
      return acc;
    }, { paid: 0 });

    return `
      <div class="week-group">
        <div class="week-header" onclick="toggleWeek('${weekStart}')">
          <span>Week Starting ${escapeHtml(weekStart)}</span>
          <span>${totals.paid.toFixed(2)} hrs</span>
        </div>
        <div class="week-content" id="week-${weekStart}" style="display:none;">
          ${grouped[weekStart].map(s => formatShiftLine(s, s.__index)).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function toggleWeek(weekStart) {
  const el = document.getElementById(`week-${weekStart}`);
  if (!el) return;
  el.style.display = (el.style.display === "none") ? "block" : "none";
}

function deleteShift(index) {
  if (!Number.isInteger(index) || index < 0 || index >= shifts.length) return;
  if (!confirm("Delete this shift?")) return;

  shifts.splice(index, 1);
  saveAll();
  renderAll();
  renderWeeklyGroupedShifts();
}

function startEditShift(index) {
  if (!Number.isInteger(index) || index < 0 || index >= shifts.length) return;
  localStorage.setItem("editShiftIndex", String(index));
  window.location.href = "enter-shift.html";
}

function loadShiftForEditingIfRequested() {
  const idxRaw = localStorage.getItem("editShiftIndex");
  if (idxRaw === null) return;

  localStorage.removeItem("editShiftIndex");
  const idx = parseInt(idxRaw, 10);

  if (Number.isNaN(idx) || idx < 0 || idx >= shifts.length) return;

  editingIndex = idx;
  const s = shifts[idx];

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };
  const setCheck = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };

  setVal("date", s.date);
  setVal("start", s.start);
  setVal("finish", s.finish);
  setVal("vehicle", s.vehicle);
  setVal("trailer1", s.trailer1);
  setVal("trailer2", s.trailer2);
  setVal("company", s.companyId);

  const defectsEl = document.getElementById("defects");
  if (defectsEl) defectsEl.value = s.defects ?? "";

  setCheck("annualLeave", s.annualLeave);
  setCheck("bankHoliday", s.bankHoliday);
}

/* ===============================
   BACKUP / RESTORE
================================ */

function downloadBackup() {
  const data = {
    version: DATA_MODEL_VERSION,
    exportedAt: new Date().toISOString(),
    shifts,
    vehicles,
    companies,
    settings
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hgv_work_log_backup.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function restoreBackup(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const backupVersion = Number(data?.version || 1);

      shifts = Array.isArray(data.shifts) ? data.shifts : [];
      vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
      companies = Array.isArray(data.companies) ? data.companies : companies;
      settings = (data.settings && typeof data.settings === "object") ? data.settings : settings;

      migrateData(backupVersion);
      saveAll();

      alert("Backup restored successfully.");
      renderAll();
      renderCompanies();
      renderCompanyDropdowns();
      loadSettings();
      renderCompanySummary();
      renderCurrentPeriodTiles();
      if (typeof renderWeeklyGroupedShifts === "function") renderWeeklyGroupedShifts();
    } catch (err) {
      alert("That backup file looks invalid or corrupted.");
    }
  };

  reader.readAsText(file);
  event.target.value = "";
}

/* ===============================
   EXPORT PAYSLIP (PRINT TO PDF)
================================ */

function fmtMoney(n) {
  const x = Number(n || 0);
  return "£" + x.toFixed(2);
}
function fmtHours(n) {
  const x = Number(n || 0);
  return x.toFixed(2) + " hrs";
}

function getWeekRangeForDate(d = new Date()) {
  const now = new Date(d);
  const day = now.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  now.setDate(now.getDate() + diff);
  now.setHours(0, 0, 0, 0);

  const start = new Date(now);
  const end = new Date(now);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return {
    start,
    end,
    startStr: start.toISOString().slice(0, 10),
    endStr: end.toISOString().slice(0, 10)
  };
}

function getMonthRangeForDate(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);

  return {
    start,
    end,
    startStr: start.toISOString().slice(0, 10),
    endStr: end.toISOString().slice(0, 10),
    ym: start.toISOString().slice(0, 7)
  };
}

function groupByCompanyId(arr) {
  const out = {};
  arr.forEach(s => {
    const cid = s.companyId || "";
    if (!out[cid]) out[cid] = [];
    out[cid].push(s);
  });
  return out;
}

function buildPayslipHTML({ title, periodLabel, periodStart, periodEnd, overall, byCompany, rows }) {
  const css = `
    :root{ --ink:#111; --muted:#5b5b5b; --line:#e6e6e6; --card:#fafafa; }
    *{ box-sizing:border-box; }
    body{ font-family: "Segoe UI", Arial, sans-serif; color:var(--ink); margin:0; padding:24px; }
    .wrap{ max-width: 900px; margin:0 auto; }
    .top{ display:flex; justify-content:space-between; align-items:flex-start; gap:20px; }
    h1{ margin:0; font-size:20px; letter-spacing:.2px; }
    .meta{ color:var(--muted); font-size:12px; line-height:1.4; margin-top:6px; }
    .chip{ display:inline-block; padding:6px 10px; border:1px solid var(--line); border-radius:999px; font-size:12px; color:var(--muted); background:#fff; }
    .rule{ height:1px; background:var(--line); margin:16px 0; }
    .grid{ display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; }
    .kpi{ border:1px solid var(--line); background:var(--card); border-radius:12px; padding:12px; }
    .kpi .l{ font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.12em; }
    .kpi .v{ margin-top:6px; font-size:16px; font-weight:700; }
    h2{ margin:18px 0 8px; font-size:14px; color:var(--muted); letter-spacing:.08em; text-transform:uppercase; }
    table{ width:100%; border-collapse:collapse; font-size:12px; }
    th,td{ padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
    th{ text-align:left; color:var(--muted); font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:.10em; }
    .right{ text-align:right; }
    .small{ color:var(--muted); font-size:11px; }
    .totals{ margin-top:10px; display:flex; justify-content:flex-end; }
    .totals .box{ width:340px; border:1px solid var(--line); border-radius:12px; background:var(--card); padding:12px; }
    .row{ display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed var(--line); }
    .row:last-child{ border-bottom:none; }
    .row strong{ font-weight:800; }
    @media print{ body{ padding:0; } .wrap{ max-width:none; } }
  `;

  const baseHours = Math.max(0, Number(overall.paid || 0) - Number(overall.otHours || 0));

  const companyRows = Object.keys(byCompany || {})
    .filter(cid => cid)
    .sort((a, b) => (getCompanyById(a)?.name || "Unknown").localeCompare(getCompanyById(b)?.name || "Unknown"))
    .map(cid => {
      const r = byCompany[cid];
      const name = getCompanyById(cid)?.name || "Unknown Company";
      const baseH = Math.max(0, Number(r.paid || 0) - Number(r.otHours || 0));
      return `
        <tr>
          <td><strong>${escapeHtml(name)}</strong><div class="small">${escapeHtml(cid)}</div></td>
          <td class="right">${fmtHours(r.worked)}</td>
          <td class="right">${fmtHours(r.breaks)}</td>
          <td class="right">${fmtHours(r.paid)}</td>
          <td class="right">${fmtHours(baseH)}</td>
          <td class="right">${fmtHours(r.otHours)}</td>
          <td class="right">${fmtMoney(r.nightPay || 0)}</td>
          <td class="right">${fmtMoney(r.basePay)}</td>
          <td class="right">${fmtMoney(r.otPay)}</td>
          <td class="right"><strong>${fmtMoney(r.total)}</strong></td>
        </tr>
      `;
    }).join("");

  const shiftRows = rows.map(s => {
    const companyName = getCompanyById(s.companyId)?.name || "Unknown Company";
    const flags = [s.annualLeave ? "AL" : "", s.bankHoliday ? "BH" : ""].filter(Boolean).join(" ");
    return `
      <tr>
        <td><strong>${escapeHtml(s.date)}</strong>${flags ? `<div class="small">${escapeHtml(flags)}</div>` : ""}</td>
        <td>${escapeHtml(companyName)}</td>
        <td>${escapeHtml(s.start || "")}–${escapeHtml(s.finish || "")}</td>
        <td>${escapeHtml(s.vehicle || "")}</td>
        <td class="right">${fmtHours(s.worked)}</td>
        <td class="right">${fmtHours(s.breaks)}</td>
        <td class="right">${fmtHours(s.paid)}</td>
        <td class="right">${fmtMoney(s.__payTotal || 0)}</td>
      </tr>
    `;
  }).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>${css}</style>
      </head>
      <body>
        <div class="wrap">
          <div class="top">
            <div>
              <h1>${escapeHtml(title)}</h1>
              <div class="meta">
                <div><strong>Period:</strong> ${escapeHtml(periodLabel)} (${escapeHtml(periodStart)} → ${escapeHtml(periodEnd)})</div>
                <div><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
              </div>
            </div>
            <div class="chip">HGV Work Log</div>
          </div>

          <div class="rule"></div>

          <h2>Overall Summary</h2>
          <div class="grid">
            <div class="kpi"><div class="l">Worked</div><div class="v">${fmtHours(overall.worked)}</div></div>
            <div class="kpi"><div class="l">Breaks</div><div class="v">${fmtHours(overall.breaks)}</div></div>
            <div class="kpi"><div class="l">Paid</div><div class="v">${fmtHours(overall.paid)}</div></div>
            <div class="kpi"><div class="l">OT Hours</div><div class="v">${fmtHours(overall.otHours)}</div></div>

            <div class="kpi"><div class="l">Base Hours</div><div class="v">${fmtHours(baseHours)}</div></div>
            <div class="kpi"><div class="l">Night Pay</div><div class="v">${fmtMoney(overall.nightPay || 0)}</div></div>
            <div class="kpi"><div class="l">Base Pay</div><div class="v">${fmtMoney(overall.basePay)}</div></div>
            <div class="kpi"><div class="l">OT Pay</div><div class="v">${fmtMoney(overall.otPay)}</div></div>
          </div>

          <div class="totals">
            <div class="box">
              <div class="row"><span>Base Pay</span><span>${fmtMoney(overall.basePay)}</span></div>
              <div class="row"><span>Overtime Pay</span><span>${fmtMoney(overall.otPay)}</span></div>
              <div class="row"><span>Night Pay</span><span>${fmtMoney(overall.nightPay || 0)}</span></div>
              <div class="row"><strong>Total</strong><strong>${fmtMoney(overall.total)}</strong></div>
              <div class="small" style="margin-top:8px;">Note: Calculation summary only. Verify against payslips/invoices.</div>
            </div>
          </div>

          <h2>By Company</h2>
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th class="right">Worked</th>
                <th class="right">Breaks</th>
                <th class="right">Paid</th>
                <th class="right">Base Hrs</th>
                <th class="right">OT Hrs</th>
                <th class="right">Night Pay</th>
                <th class="right">Base Pay</th>
                <th class="right">OT Pay</th>
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${companyRows || `<tr><td colspan="10" class="small">No company data for this period.</td></tr>`}
            </tbody>
          </table>

          <h2>Shift Lines</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Company</th>
                <th>Time</th>
                <th>Vehicle</th>
                <th class="right">Worked</th>
                <th class="right">Breaks</th>
                <th class="right">Paid</th>
                <th class="right">Pay</th>
              </tr>
            </thead>
            <tbody>
              ${shiftRows || `<tr><td colspan="8" class="small">No shifts in this period.</td></tr>`}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function exportPayslip(period = "week") {
  ensureDefaultCompany();

  let periodLabel = "";
  let periodStart = "";
  let periodEnd = "";
  let periodShifts = [];
  let overall;

  if (period === "month") {
    const r = getMonthRangeForDate(new Date());
    periodLabel = "Month";
    periodStart = r.startStr;
    periodEnd = r.endStr;

    periodShifts = shifts.filter(s => (s.date || "").slice(0, 7) === r.ym);
    overall = processShifts(periodShifts, "monthOverall");
  } else {
    const r = getWeekRangeForDate(new Date());
    periodLabel = "Week (Mon–Sun)";
    periodStart = r.startStr;
    periodEnd = r.endStr;

    periodShifts = shifts.filter(s => {
      const d = dateOnlyToDate(s.date);
      return d >= r.start && d <= r.end;
    });
    overall = processShifts(periodShifts, "overall");
  }

  const byCompany = {};
  const grouped = groupByCompanyId(periodShifts);
  Object.keys(grouped).forEach(cid => {
    if (!cid) return;
    byCompany[cid] = (period === "month")
      ? processShifts(grouped[cid], "monthOverall")
      : processShifts(grouped[cid], "perCompany");
  });

  const rows = periodShifts
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.start || "").localeCompare(b.start || ""))
    .map(s => {
      const profile = getShiftRateProfile(s);
      const mult = getShiftOTMultiplier(s, profile);

      const paid = Number(s.paid || 0);
      let baseH = Number(s.baseHours);
      let otH = Number(s.otHours);

      if (!Number.isFinite(baseH) || !Number.isFinite(otH)) {
        const split = splitPaidIntoBaseAndOT_DailyWorked(s);
        baseH = split.baseHours;
        otH = split.otHours;
      }

      let linePay = 0;
      if (s.bankHoliday) {
        linePay = paid * profile.baseRate * mult;
      } else {
        linePay = (Number(baseH || 0) * profile.baseRate) + (Number(otH || 0) * profile.baseRate * mult);
      }

      // add night pay estimate on the line
      const company = getCompanyById(s.companyId);
      const nb = company?.nightBonus || { mode: "none", amount: 0, start: "22:00", end: "06:00" };
      const nh = calcNightHoursForShift(s.start, s.finish, nb.start, nb.end, !!s.annualLeave);
      if (nb.mode === "per_hour") linePay += nh * Number(nb.amount || 0);
      else if (nb.mode === "per_shift") { if (nh > 0) linePay += Number(nb.amount || 0); }
      // per_week can’t be reliably allocated per line, so we leave it out of shift line pay (it still appears in totals)

      return { ...s, __payTotal: linePay };
    });

  const html = buildPayslipHTML({
    title: `Payslip Summary`,
    periodLabel,
    periodStart,
    periodEnd,
    overall,
    byCompany,
    rows
  });

  const win = window.open("", "", "height=900,width=900");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for PDF export.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

/* ===============================
   RENDER ALL (safe across pages)
================================ */

function renderAll() {
  renderVehicles();
  renderWeekly();
  renderMonthly();
}

/* ===============================
   INIT
================================ */

document.addEventListener("DOMContentLoaded", () => {
  ensureDefaultCompany();

  // Basic lists
  renderCompanyDropdowns();
  renderCompanies();
  renderVehicles();

  // Settings page
  loadSettings();
  initSummaryTabs();

  // Shift entry page defaults + editing
  loadShiftForEditingIfRequested();
  applyDefaultsToShiftEntry();

  // Summary page
  renderCurrentPeriodTiles();
  renderCompanySummary();

  // General blocks
  renderAll();

  // Shifts page
  renderWeeklyGroupedShifts();
  
  // Companies page
  updateCompanyFormVisibility();

  initVehicleCombobox();
});

/* ===============================
   PWA: SERVICE WORKER + UPDATES
================================ */

let __swRegistration = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./service-worker.js");

      // ✅ Store registration globally
      __swRegistration = reg;

      // If update already waiting
      if (reg.waiting) showUpdateBanner(reg);

      // Detect new updates
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });

      // When new SW takes control, leave reload to user action
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        setUpdateStatus("Update ready. Refresh when you're ready.");
        showRefreshBanner();
      });

    } catch (err) {
      console.error("Service worker registration failed:", err);
    }
  });
}

function setUpdateStatus(msg) {
  const el = document.getElementById("updateStatus");
  if (el) el.textContent = msg;
}

function showRefreshBanner() {
  const existing = document.getElementById("refreshBanner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.id = "refreshBanner";
  banner.className = "update-banner";
  banner.setAttribute("role", "status");

  const msg = document.createElement("div");
  msg.textContent = "Update ready. Refresh to apply it.";

  const actions = document.createElement("div");
  actions.className = "update-actions";

  const btnRefresh = document.createElement("button");
  btnRefresh.className = "button-secondary";
  btnRefresh.textContent = "Refresh now";
  btnRefresh.onclick = () => window.location.reload();

  const btnLater = document.createElement("button");
  btnLater.className = "button-secondary";
  btnLater.textContent = "Later";
  btnLater.onclick = () => banner.remove();

  actions.appendChild(btnRefresh);
  actions.appendChild(btnLater);
  banner.appendChild(msg);
  banner.appendChild(actions);

  document.body.appendChild(banner);

  // Auto-dismiss after a reasonable window
  setTimeout(() => {
    banner.remove();
  }, 12000);
}

function showUpdateBanner(reg) {
  if (!reg?.waiting) return;

  // Remove any existing banner
  const existing = document.getElementById("updateBanner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.setAttribute("role", "status");
  banner.className = "update-banner";

  const msg = document.createElement("div");
  msg.textContent = "An update is available.";

  const actions = document.createElement("div");
  actions.className = "update-actions";

  const btnUpdate = document.createElement("button");
  btnUpdate.className = "button-secondary";
  btnUpdate.textContent = "Update now";
  btnUpdate.onclick = () => {
    setUpdateStatus("Updating...");
    banner.remove();
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
  };

  const btnLater = document.createElement("button");
  btnLater.className = "button-secondary";
  btnLater.textContent = "Later";
  btnLater.onclick = () => banner.remove();

  actions.appendChild(btnUpdate);
  actions.appendChild(btnLater);
  banner.appendChild(msg);
  banner.appendChild(actions);

  document.body.appendChild(banner);
}

async function checkForUpdates() {
  if (!("serviceWorker" in navigator)) {
    alert("Service workers not supported.");
    return;
  }

  const reg = __swRegistration || await navigator.serviceWorker.getRegistration();

  if (!reg) {
    alert("No service worker registered yet.");
    return;
  }

  setUpdateStatus("Checking for updates...");

  if (reg.waiting) {
    setUpdateStatus("Update available.");
    showUpdateBanner(reg);
    return;
  }

  await reg.update();

  setTimeout(() => {
    if (!reg.waiting) {
      setUpdateStatus("You're up to date.");
    }
  }, 2000);
}
