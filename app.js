/* ===============================
   STORAGE SETUP
================================ */

let shifts = JSON.parse(localStorage.getItem("shifts")) || [];
let vehicles = JSON.parse(localStorage.getItem("vehicles")) || [];

let settings = JSON.parse(localStorage.getItem("settings")) || {
  defaultStart: "",
  baseRate: 17.75,
  baseHours: 45,
  otWeekday: 1.25,
  otSaturday: 1.25,
  otSunday: 1.5,
  otBankHoliday: 2
};

let editingIndex = null;


/* ===============================
   COMPANIES (CRUD)
================================ */

// Load existing or start empty
let companies = JSON.parse(localStorage.getItem("companies")) || [];

// Ensure there’s always at least one company (helps migration & usability)
function ensureDefaultCompany() {
  if (companies.length > 0) return;

  const settings = JSON.parse(localStorage.getItem("settings")) || {
    defaultStart: "",
    baseRate: 17.75,
    baseHours: 45,
    otWeekday: 1.25,
    otSaturday: 1.25,
    otSunday: 1.5,
    otBankHoliday: 2
  };

  companies = [{
    id: "cmp_default",
    name: "Default",
	
	payMode: "weekly",
	dailyOTAfterWorkedHours: 0,
	minPaidShiftHours: 0,
    baseRate: settings.baseRate ?? 17.75,
    ot: {
      weekday: settings.otWeekday ?? 1.25,
      saturday: settings.otSaturday ?? 1.25,
      sunday: settings.otSunday ?? 1.5,
      bankHoliday: settings.otBankHoliday ?? 2
    },
    baseWeeklyHours: settings.baseHours ?? 45,
    baseDailyPaidHours: 0,      // only used if salaried
    standardShiftLength: 0,     // optional (e.g. 10)
    minPaidShiftHours: 0,       // optional (agency min)
    contactName: "",
    contactNumber: "",
    createdAt: Date.now()
  }];


  localStorage.setItem("companies", JSON.stringify(companies));
}
function getUserCompanies() {
  return companies.filter(c => c.id !== "cmp_default");
}

function getDefaultCompanyId() {
  return localStorage.getItem("defaultCompanyId") || "";
}

function setDefaultCompanyId(id) {
  localStorage.setItem("defaultCompanyId", id);
}

function getSelectableCompanies() {
  // If the user has created any companies, hide cmp_default entirely.
  const user = getUserCompanies();
  return user.length ? user : companies; // fallback to include default only if it's the only one
}

function saveCompanies() {
  localStorage.setItem("companies", JSON.stringify(companies));
}

function generateCompanyId() {
  return "cmp_" + Math.random().toString(36).slice(2, 9);
}

function getCompanyById(id) {
  const list = JSON.parse(localStorage.getItem("companies")) || companies || [];
  return list.find(c => c.id === id) || null;
}

function renderCompanies() {
  const list = document.getElementById("companyList");
  if (!list) return;

  ensureDefaultCompany();

  const selectable = getSelectableCompanies(); // hides cmp_default if user has companies
  const currentDefault = getDefaultCompanyId();

  const sorted = [...selectable].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  list.innerHTML = sorted.map(c => {
    const isDefault = (currentDefault && c.id === currentDefault) || (!currentDefault && c.id !== "cmp_default" && getUserCompanies().length === 1);

    return `
      <div class="shift-card">
        <strong>${escapeHtml(c.name)}</strong>
        ${isDefault ? `<span class="small" style="margin-left:8px;">(Default)</span>` : ""}
        <br>

        <div class="meta">
          Rate: £${(Number(c.baseRate) || 0).toFixed(2)}<br>
          OT: Wkday x${fmt2(c.ot?.weekday)} • Sat x${fmt2(c.ot?.saturday)} • Sun x${fmt2(c.ot?.sunday)} • BH x${fmt2(c.ot?.bankHoliday)}<br>
          Base weekly: ${fmtHrs(c.baseWeeklyHours)} hrs
          ${c.baseDailyPaidHours ? `<br>Base daily paid (salaried): ${fmtHrs(c.baseDailyPaidHours)} hrs` : ""}
          ${c.standardShiftLength ? `<br>Std shift length: ${fmtHrs(c.standardShiftLength)} hrs` : ""}
          ${c.minPaidShiftHours ? `<br>Min paid shift: ${fmtHrs(c.minPaidShiftHours)} hrs` : ""}
          ${(c.contactName || c.contactNumber) ? `<br>Contact: ${escapeHtml(c.contactName || "")} ${escapeHtml(c.contactNumber || "")}` : ""}
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

function addOrUpdateCompany() {
  ensureDefaultCompany();

  const idEl = document.getElementById("companyId");
  const nameEl = document.getElementById("companyName");
  const baseRateEl = document.getElementById("companyBaseRate");

  if (!nameEl || !baseRateEl) return;

  const id = (idEl?.value || "").trim();
  const name = (nameEl.value || "").trim();
  const baseRate = parseFloat(baseRateEl.value);

  if (!name) return alert("Please enter a company name");
  if (!Number.isFinite(baseRate)) return alert("Please enter a valid base hourly rate");

  const company = {
    id: id || generateCompanyId(),
    name,
    baseRate,
    ot: {
      weekday: parseFloat(document.getElementById("otWeekday")?.value) || 1,
      saturday: parseFloat(document.getElementById("otSaturday")?.value) || 1,
      sunday: parseFloat(document.getElementById("otSunday")?.value) || 1,
      bankHoliday: parseFloat(document.getElementById("otBankHoliday")?.value) || 1
    },
    baseWeeklyHours: parseFloat(document.getElementById("baseWeeklyHours")?.value) || 0,
    baseDailyPaidHours: parseFloat(document.getElementById("baseDailyPaidHours")?.value) || 0,
    standardShiftLength: parseFloat(document.getElementById("standardShiftLength")?.value) || 0,
    minPaidShiftHours: parseFloat(document.getElementById("minPaidShiftHours")?.value) || 0,
    contactName: (document.getElementById("contactName")?.value || "").trim(),
    contactNumber: (document.getElementById("contactNumber")?.value || "").trim(),
    createdAt: id ? (getCompanyById(id)?.createdAt || Date.now()) : Date.now(),
	payMode: document.getElementById("payMode")?.value || "weekly",
	dailyOTAfterWorkedHours: parseFloat(document.getElementById("dailyOTAfterWorkedHours")?.value) || 0,
	minPaidShiftHours: parseFloat(document.getElementById("minPaidShiftHours")?.value) || 0,
  };

  const existingIndex = companies.findIndex(c => c.id === company.id);
  if (existingIndex >= 0) {
    companies[existingIndex] = company;
  } else {
    companies.push(company);
  }

  saveCompanies();
  resetCompanyForm();
  renderCompanies();
  // If this is the first user-created company, make it the default automatically
  if (company.id !== "cmp_default") {
    const userCount = getUserCompanies().length;
    const currentDefault = getDefaultCompanyId();
    if (!currentDefault || userCount === 1) {
      setDefaultCompanyId(company.id);
    }
  }
  // If other pages have company dropdowns later, this keeps them fresh
  if (typeof renderCompanyDropdowns === "function") renderCompanyDropdowns();
}

function editCompany(id) {
  const c = getCompanyById(id);
  if (!c) return;

  document.getElementById("companyId").value = c.id;
  document.getElementById("companyName").value = c.name;
  document.getElementById("companyBaseRate").value = c.baseRate ?? "";

  document.getElementById("otWeekday").value = c.ot?.weekday ?? "";
  document.getElementById("otSaturday").value = c.ot?.saturday ?? "";
  document.getElementById("otSunday").value = c.ot?.sunday ?? "";
  document.getElementById("otBankHoliday").value = c.ot?.bankHoliday ?? "";

  document.getElementById("baseWeeklyHours").value = c.baseWeeklyHours ?? "";
  document.getElementById("baseDailyPaidHours").value = c.baseDailyPaidHours ?? "";
  document.getElementById("standardShiftLength").value = c.standardShiftLength ?? "";
  document.getElementById("minPaidShiftHours").value = c.minPaidShiftHours ?? "";

  document.getElementById("contactName").value = c.contactName ?? "";
  document.getElementById("contactNumber").value = c.contactNumber ?? "";
  
  document.getElementById("payMode").value = c.payMode ?? "weekly";
  document.getElementById("dailyOTAfterWorkedHours").value = c.dailyOTAfterWorkedHours ?? "";
  document.getElementById("minPaidShiftHours").value = c.minPaidShiftHours ?? "";
}

function setDefaultCompany(id) {
  if (!id) return;
  if (id === "cmp_default" && getUserCompanies().length) return; // don't allow default when hidden
  setDefaultCompanyId(id);
  renderCompanies();
  renderCompanyDropdowns(id);
}

function deleteCompany(id) {
  ensureDefaultCompany();

  // Never delete the built-in fallback
  if (id === "cmp_default") {
    alert("The built-in Default company can't be deleted.");
    return;
  }

  const userCompanies = getUserCompanies();

  // Don’t allow deleting the last company
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

  // If they deleted the current default, pick another user company as default
  const currentDefault = getDefaultCompanyId();
  if (currentDefault === id) {
    const remaining = getUserCompanies();
    if (remaining.length) setDefaultCompanyId(remaining[0].id);
  }

  saveAll();
  renderCompanies();
  renderCompanyDropdowns();
}

function resetCompanyForm() {
  const ids = [
    "companyId","companyName","companyBaseRate",
    "otWeekday","otSaturday","otSunday","otBankHoliday",
    "baseWeeklyHours","baseDailyPaidHours","standardShiftLength","minPaidShiftHours",
    "contactName","contactNumber"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = "";
  });

  // sensible defaults when creating new
  const settings = JSON.parse(localStorage.getItem("settings")) || {};
  if (document.getElementById("companyBaseRate")) document.getElementById("companyBaseRate").value = settings.baseRate ?? 17.75;
  if (document.getElementById("otWeekday")) document.getElementById("otWeekday").value = settings.otWeekday ?? 1.25;
  if (document.getElementById("otSaturday")) document.getElementById("otSaturday").value = settings.otSaturday ?? 1.25;
  if (document.getElementById("otSunday")) document.getElementById("otSunday").value = settings.otSunday ?? 1.5;
  if (document.getElementById("otBankHoliday")) document.getElementById("otBankHoliday").value = settings.otBankHoliday ?? 2;
  if (document.getElementById("baseWeeklyHours")) document.getElementById("baseWeeklyHours").value = settings.baseHours ?? 45;
  document.getElementById("payMode").value = c.payMode ?? "weekly";
  document.getElementById("dailyOTAfterWorkedHours").value = c.dailyOTAfterWorkedHours ?? "";
  document.getElementById("minPaidShiftHours").value = c.minPaidShiftHours ?? "";
}

/* Helpers */
function fmt2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2).replace(/\.00$/, "") : "1";
}
function fmtHrs(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2).replace(/\.00$/, "") : "0";
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function clamp0(n){ n = Number(n || 0); return Number.isFinite(n) ? Math.max(0, n) : 0; }

function applyCompanyPaidRules(shift) {
  // Uses: shift.worked, shift.breaks, shift.paid
  const c = getCompanyById(shift.companyId);

  // Annual leave should already have paid=9 and breaks=0 in your calculateHours()
  // Now apply minimum paid shift rule (agency)
  const minPaid = clamp0(shift.overrides?.minPaidShiftHours ?? c?.minPaidShiftHours ?? 0);

  if (!shift.annualLeave && minPaid > 0) {
    shift.paid = Math.max(clamp0(shift.paid), minPaid);
  }

  // If you later add salaried rules, they'd go here.
  return shift;
}

function splitPaidIntoBaseAndOT_DailyWorked(shift) {
  const c = getCompanyById(shift.companyId);

  const payMode = shift.overrides?.payMode ?? c?.payMode ?? "weekly";
  const thresholdWorked = clamp0(shift.overrides?.dailyOTAfterWorkedHours ?? c?.dailyOTAfterWorkedHours ?? 0);

  const paid = clamp0(shift.paid);
  const worked = clamp0(shift.worked);

  // Bank holiday: treat whole paid shift as OT hours for reporting/pricing
  if (shift.bankHoliday) {
    return { baseHours: 0, otHours: paid };
  }

  // Annual leave: treat as base hours (and no breaks)
  if (shift.annualLeave) {
    return { baseHours: paid, otHours: 0 };
  }

  // Only daily mode uses daily OT threshold
  if (payMode !== "daily" || thresholdWorked <= 0) {
    return { baseHours: paid, otHours: 0 };
  }

  // Overtime is based on WORKED hours, but paid hours are worked-break.
  // OT worked hours:
  const otWorked = Math.max(0, worked - thresholdWorked);

  // Convert OT worked hours into OT paid hours (1 break hour should not “become OT”)
  // Simplest defensible mapping: OT paid hours cannot exceed paid hours, and is at most otWorked.
  const otPaid = Math.min(paid, otWorked);

  return {
    baseHours: Math.max(0, paid - otPaid),
    otHours: otPaid
  };
}

function renderCompanyDropdowns(selectedId = "") {
  const sel = document.getElementById("company");
  if (!sel) return;

  ensureDefaultCompany();

  const selectable = getSelectableCompanies(); // hides cmp_default once user companies exist
  const storedDefault = getDefaultCompanyId();

  sel.innerHTML =
    `<option value="">Select Company</option>` +
    selectable
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");

  // Priority: explicit selectedId -> stored default -> first company
  if (selectedId) sel.value = selectedId;
  else if (storedDefault && selectable.some(c => c.id === storedDefault)) sel.value = storedDefault;
  else if (selectable.length) sel.value = selectable[0].id;
}
/* ===============================
   SAVE HELPERS
================================ */

function saveAll() {
  localStorage.setItem("shifts", JSON.stringify(shifts));
  localStorage.setItem("vehicles", JSON.stringify(vehicles));
  localStorage.setItem("settings", JSON.stringify(settings));
  localStorage.setItem("companies", JSON.stringify(companies));
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
  settings.defaultStart = document.getElementById("defaultStart").value;
  settings.baseRate = parseFloat(document.getElementById("baseRate").value) || 0;
  settings.baseHours = parseFloat(document.getElementById("baseHours").value) || 0;
  settings.otWeekday = parseFloat(document.getElementById("otWeekday").value) || 1;
  settings.otSaturday = parseFloat(document.getElementById("otSaturday").value) || 1;
  settings.otSunday = parseFloat(document.getElementById("otSunday").value) || 1;
  settings.otBankHoliday = parseFloat(document.getElementById("otBankHoliday").value) || 1;

  saveAll();
  alert("Settings saved");
}

/* ===============================
   VEHICLES PAGE
================================ */

function addVehicle() {
  const input = document.getElementById("newVehicle");
  if (!input) return;

  const reg = input.value.toUpperCase().trim();
  if (!reg) return;

  if (!vehicles.includes(reg)) {
    vehicles.push(reg);
    saveAll();
    renderVehicles();
  }

  input.value = "";
}

function deleteVehicle(index) {
  vehicles.splice(index, 1);
  saveAll();
  renderVehicles();
}

function renderVehicles() {
  const list = document.getElementById("vehicleList");
  const dropdown = document.getElementById("vehicle");

  if (list) list.innerHTML = "";
  if (dropdown) dropdown.innerHTML = "<option value=''>Select Vehicle</option>";

  vehicles.forEach((v, i) => {

    if (dropdown) {
      const option = document.createElement("option");
      option.value = v;
      option.textContent = v;
      dropdown.appendChild(option);
    }

    if (list) {
      const div = document.createElement("div");
      div.className = "shift-card";
      div.innerHTML = `
        ${v}
        <button onclick="deleteVehicle(${i})">Delete</button>
      `;
      list.appendChild(div);
    }

  });
}

/* ===============================
   HOURS CALCULATION
================================ */

function calculateHours(start, finish, isAL) {

  if (isAL) {
    return { worked: 9, breaks: 0, paid: 9 };
  }

  if (!start || !finish) {
    return { worked: 0, breaks: 0, paid: 0 };
  }

  let s = new Date("1970-01-01T" + start + ":00");
  let f = new Date("1970-01-01T" + finish + ":00");

  if (f < s) {
    f.setDate(f.getDate() + 1);
  }

  let diff = (f - s) / 1000 / 60 / 60;

  return {
    worked: diff,
    breaks: 1,
    paid: diff - 1
  };
}

/* ===============================
   ADD / UPDATE SHIFT
================================ */

function addOrUpdateShift() {
  const dateInput = document.getElementById("date");
  if (!dateInput) return;

  ensureDefaultCompany();
  renderCompanyDropdowns(); // ensures dropdown exists/populated if page just loaded

  const date = (dateInput.value || "").trim();
  if (!date) return alert("Select date");

  const companyEl = document.getElementById("company");
  if (!companyEl) return alert("Company dropdown not found (id='company').");

  const companyId = (companyEl.value || "").trim();
  if (!companyId) return alert("Select a company");

  const shift = {
    date,
    companyId, // ✅ THIS is the critical bit

    start: document.getElementById("start")?.value || "",
    finish: document.getElementById("finish")?.value || "",
    vehicle: document.getElementById("vehicle")?.value || "",
    trailer1: document.getElementById("trailer1")?.value || "",
    trailer2: document.getElementById("trailer2")?.value || "",
    defects: document.getElementById("defects")?.value || "",
    annualLeave: document.getElementById("annualLeave")?.checked || false,
    bankHoliday: document.getElementById("bankHoliday")?.checked || false,

    createdAt:
      (editingIndex !== null && shifts[editingIndex]?.createdAt)
        ? shifts[editingIndex].createdAt
        : Date.now()
  };

  // optional overrides (if you have the advanced fields)
  if (typeof buildShiftOverridesFromForm === "function") {
    const overrides = buildShiftOverridesFromForm();
    if (overrides) shift.overrides = overrides;
  }

  // hours
  const hrs = calculateHours(shift.start, shift.finish, shift.annualLeave);

  // apply break override if set
  const ob = shift.overrides?.breakHours;
  if (!shift.annualLeave && typeof ob === "number" && Number.isFinite(ob)) {
    hrs.breaks = ob;
    hrs.paid = Math.max(0, hrs.worked - ob);
  }

  shift.worked = hrs.worked;
  shift.breaks = hrs.breaks;
  shift.paid = hrs.paid;

  /* ===============================
     APPLY COMPANY PAY RULES
  ================================ */

  // 1) Apply minimum paid shift rules (agency)
  applyCompanyPaidRules(shift);

  // 2) Split paid hours into base + OT (daily mode only)
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
    else el.value = "";
  });

  const vehicle = document.getElementById("vehicle");
  if (vehicle) vehicle.value = "";
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

/**
 * mode:
 *  - "overall": weekly OT threshold applies to ALL weekly-mode companies combined (daily-mode companies keep daily OT)
 *  - "perCompany": weekly OT threshold applies per company (weekly-mode only)
 *  - "monthOverall": no weekly allocation (daily-mode still uses its base/ot split; BH still OT)
 */
function processShifts(group, mode = "overall") {
  const arr = Array.isArray(group) ? [...group] : [];

  // totals
  let totalWorked = 0, totalBreaks = 0, totalPaid = 0;
  let totalOTHours = 0, basePay = 0, otPay = 0;

  // normalize stored shifts (in case old ones don’t have baseHours/otHours)
  arr.forEach(s => {
    totalWorked += Number(s.worked || 0);
    totalBreaks += Number(s.breaks || 0);
    totalPaid += Number(s.paid || 0);

    if (typeof s.baseHours !== "number" || typeof s.otHours !== "number") {
      // compute split on the fly
      const split = splitPaidIntoBaseAndOT_DailyWorked(s);
      s.baseHours = split.baseHours;
      s.otHours = split.otHours;
    }
  });

  // Month: no weekly allocation, just price per shift using baseHours/otHours (BH already included)
  if (mode === "monthOverall") {
    arr.forEach(s => {
      const profile = getShiftRateProfile(s);
      const mult = getShiftOTMultiplier(s, profile);

      // Bank holiday: whole paid shift treated as OT in our split func
      const bhOT = s.bankHoliday ? Number(s.paid || 0) : 0;

      const baseH = s.bankHoliday ? 0 : Number(s.baseHours || 0);
      const otH = s.bankHoliday ? bhOT : Number(s.otHours || 0);

      basePay += baseH * profile.baseRate;
      otPay += otH * profile.baseRate * mult;
      totalOTHours += otH;
    });

    return { worked: totalWorked, breaks: totalBreaks, paid: totalPaid, otHours: totalOTHours, basePay, otPay, total: basePay + otPay };
  }

  // Sort for predictable weekly OT allocation
  arr.sort((a, b) => {
    const ad = (a.date || "").localeCompare(b.date || "");
    if (ad !== 0) return ad;
    return (a.start || "").localeCompare(b.start || "");
  });

  // 1) First, pay DAILY-mode companies using their shift-level split (baseHours/otHours)
  // 2) Track WEEKLY-mode paid hours for later allocation

  const weeklyCandidates = []; // shifts that should be considered for weekly OT allocation (weekly pay mode)

  arr.forEach(s => {
    const profile = getShiftRateProfile(s);
    const mult = getShiftOTMultiplier(s, profile);
    const payMode = getCompanyPayMode(s.companyId);

    if (s.bankHoliday) {
      const paid = Number(s.paid || 0);
      otPay += paid * profile.baseRate * mult;
      totalOTHours += paid;
      return;
    }

    if (s.annualLeave) {
      // annual leave counts as base pay
      const paid = Number(s.paid || 0);
      basePay += paid * profile.baseRate;
      return;
    }

    if (payMode === "daily") {
      const baseH = Number(s.baseHours || 0);
      const otH = Number(s.otHours || 0);
      basePay += baseH * profile.baseRate;
      otPay += otH * profile.baseRate * mult;
      totalOTHours += otH;
    } else {
      // weekly mode: defer OT decision
      weeklyCandidates.push(s);
    }
  });

  // Now allocate weekly overtime for weekly-mode companies
  if (weeklyCandidates.length) {
    if (mode === "perCompany") {
      const remainingByCompany = {};
      weeklyCandidates.forEach(s => {
        if (!(s.companyId in remainingByCompany)) remainingByCompany[s.companyId] = getCompanyWeeklyBaseHours(s.companyId);

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
      // overall weekly threshold across weekly-mode companies only
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

  return { worked: totalWorked, breaks: totalBreaks, paid: totalPaid, otHours: totalOTHours, basePay, otPay, total: basePay + otPay };
}

/* ===============================
   "THIS WEEK" + "THIS MONTH" TILES
================================ */

function getCurrentWeekStartMonday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // back to Monday
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
  // Treat stored YYYY-MM-DD as local midnight
  return new Date(dateStr + "T00:00:00");
}

function renderBreakdownTiles(targetId, titleLabel, result) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const worked = Number(result.worked || 0);
  const breaks = Number(result.breaks || 0);
  const paid = Number(result.paid || 0);
  const otHours = Number(result.otHours || 0);
  const baseHours = Math.max(0, paid - otHours);

  const basePay = Number(result.basePay || 0);
  const otPay = Number(result.otPay || 0);
  const total = Number(result.total || 0);

  el.innerHTML = `
    <div class="tile"><div class="label">${titleLabel} Worked</div><div class="value">${worked.toFixed(2)} hrs</div></div>
    <div class="tile"><div class="label">${titleLabel} Breaks</div><div class="value">${breaks.toFixed(2)} hrs</div></div>
    <div class="tile"><div class="label">${titleLabel} Paid</div><div class="value">${paid.toFixed(2)} hrs</div></div>

    <div class="tile"><div class="label">${titleLabel} Base Hours</div><div class="value">${baseHours.toFixed(2)} hrs</div></div>
    <div class="tile"><div class="label">${titleLabel} OT Hours</div><div class="value">${otHours.toFixed(2)} hrs</div></div>

    <div class="tile"><div class="label">${titleLabel} Base Pay</div><div class="value">£${basePay.toFixed(2)}</div></div>
    <div class="tile"><div class="label">${titleLabel} OT Pay</div><div class="value">£${otPay.toFixed(2)}</div></div>
    <div class="tile"><div class="label">${titleLabel} Total Pay</div><div class="value">£${total.toFixed(2)}</div></div>
  `;
}

function renderCurrentPeriodTiles() {
  const weekTiles = document.getElementById("thisWeekTiles");
  const monthTiles = document.getElementById("thisMonthTiles");
  if (!weekTiles && !monthTiles) return;

  const weekStart = getCurrentWeekStartMonday();
  const weekEnd = addDays(weekStart, 7);

  const weekShifts = shifts.filter(s => {
    const d = dateOnlyToDate(s.date);
    return d >= weekStart && d < weekEnd;
  });

  // Overall week view (combined across companies for weekly-mode companies; daily-mode stays daily)
  const weekResult = processShifts(weekShifts, "overall");
  renderBreakdownTiles("thisWeekTiles", "This Week", weekResult);

  // Month view: no weekly allocation across a month (still respects BH + daily split)
  const ym = new Date().toISOString().slice(0, 7);
  const monthShifts = shifts.filter(s => (s.date || "").slice(0, 7) === ym);

  const monthResult = processShifts(monthShifts, "monthOverall");
  renderBreakdownTiles("thisMonthTiles", "This Month", monthResult);
}
/* ===============================
   WEEKLY SUMMARY
================================ */

function getMonday(date) {
  let d = new Date(date);
  let day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  return d.toISOString().split("T")[0];
}

function renderWeekly() {

  const container = document.getElementById("weeklySummary");
  if (!container) return;

  let weeks = {};

  shifts.forEach(s => {
    let monday = getMonday(s.date);
    if (!weeks[monday]) weeks[monday] = [];
    weeks[monday].push(s);
  });

  let html = "";

  Object.keys(weeks)
    .sort((a, b) => new Date(b) - new Date(a))
    .forEach(week => {

      let r = processShifts(weeks[week]);

      html += `
        <div class="shift-card">
          <strong>Week Starting ${week}</strong><br>
          Worked: ${r.worked.toFixed(2)} hrs<br>
          Breaks: ${r.breaks.toFixed(2)} hrs<br>
          OT Hours: ${r.otHours.toFixed(2)}<br>
          Base: £${r.basePay.toFixed(2)}<br>
          OT: £${r.otPay.toFixed(2)}<br>
          Total: £${r.total.toFixed(2)}
        </div>
      `;
    });

  container.innerHTML = html;
}

function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getWeekStartMondayDateObj() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  now.setDate(now.getDate() + diff);
  now.setHours(0, 0, 0, 0);
  return now;
}

function getWeekEndSundayDateObj() {
  const start = getWeekStartMondayDateObj();
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

function shiftInWeek(shift, weekStart, weekEnd) {
  const d = new Date((shift.date || "") + "T00:00:00");
  return d >= weekStart && d < weekEnd;
}

function groupShiftsByCompany(shiftsArr) {
  const grouped = {};
  shiftsArr.forEach(s => {
    const cid = s.companyId || "";
    if (!grouped[cid]) grouped[cid] = [];
    grouped[cid].push(s);
  });
  return grouped;
}

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
    const worked = Number(r.worked || 0);
    const breaks = Number(r.breaks || 0);
    const paid = Number(r.paid || 0);
    const otH = Number(r.otHours || 0);
    const baseH = Math.max(0, paid - otH);

    return `
      <div class="shift-card" style="margin-top:12px;">
        <strong>${label}</strong><br>
        Worked: ${worked.toFixed(2)} hrs<br>
        Breaks: ${breaks.toFixed(2)} hrs<br>
        Paid: ${paid.toFixed(2)} hrs<br>
        Base Hours: ${baseH.toFixed(2)} hrs<br>
        OT Hours: ${otH.toFixed(2)} hrs<br>
        Base Pay: £${Number(r.basePay || 0).toFixed(2)}<br>
        OT Pay: £${Number(r.otPay || 0).toFixed(2)}<br>
        Total: £${Number(r.total || 0).toFixed(2)}
      </div>
    `;
  };

  container.innerHTML = ordered.map(cid => {
    const name = getCompanyById(cid)?.name || "Unknown Company";

    // Per-company summaries should always use perCompany + monthOverall
    const w = processShifts(weekBy[cid] || [], "perCompany");
    const m = processShifts(monthBy[cid] || [], "monthOverall");

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

function toggleCompanySummary(companyId) {
  const el = document.getElementById(`cmp-${companyId}`);
  if (!el) return;
  el.style.display = (el.style.display === "none") ? "block" : "none";
}
/* ===============================
   MONTHLY SUMMARY
================================ */

function renderMonthly() {

  const container = document.getElementById("monthlySummary");
  if (!container) return;

  let months = {};

  shifts.forEach(s => {
    let month = s.date.slice(0, 7);
    if (!months[month]) months[month] = [];
    months[month].push(s);
  });

  let html = "";

  Object.keys(months)
    .sort((a, b) => b.localeCompare(a))
    .forEach(month => {

      let r = processShifts(months[month]);

      html += `
        <div class="shift-card">
          <strong>${month}</strong><br>
          Worked: ${r.worked.toFixed(2)} hrs<br>
          Breaks: ${r.breaks.toFixed(2)} hrs<br>
          OT Hours: ${r.otHours.toFixed(2)}<br>
          Base: £${r.basePay.toFixed(2)}<br>
          OT: £${r.otPay.toFixed(2)}<br>
          Total: £${r.total.toFixed(2)}
        </div>
      `;
    });

  container.innerHTML = html;
}

/* ===============================
   EXPORT (Print to PDF)
================================ */

function fmtMoney(n){
  const x = Number(n || 0);
  return "£" + x.toFixed(2);
}
function fmtHours(n){
  const x = Number(n || 0);
  return x.toFixed(2) + " hrs";
}
function esc(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getWeekRangeForDate(d = new Date()){
  const now = new Date(d);
  const day = now.getDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  now.setDate(now.getDate() + diff);
  now.setHours(0,0,0,0);
  const start = new Date(now);
  const end = new Date(now); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999);
  const startStr = start.toISOString().slice(0,10);
  const endStr = end.toISOString().slice(0,10);
  return { start, end, startStr, endStr };
}

function getMonthRangeForDate(d = new Date()){
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0,0,0,0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setHours(23,59,59,999);
  const startStr = start.toISOString().slice(0,10);
  const endStr = end.toISOString().slice(0,10);
  return { start, end, startStr, endStr, ym: start.toISOString().slice(0,7) };
}

function dateOnlyToLocalDate(dateStr){
  // stored as YYYY-MM-DD
  return new Date((dateStr || "") + "T00:00:00");
}

function groupByCompanyId(arr){
  const out = {};
  arr.forEach(s=>{
    const cid = s.companyId || "";
    if(!out[cid]) out[cid] = [];
    out[cid].push(s);
  });
  return out;
}

function buildPayslipHTML({ title, periodLabel, periodStart, periodEnd, overall, byCompany, rows }) {
  // Lightweight print CSS – professional and readable
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
    .totals .box{ width:320px; border:1px solid var(--line); border-radius:12px; background:var(--card); padding:12px; }
    .row{ display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed var(--line); }
    .row:last-child{ border-bottom:none; }
    .row strong{ font-weight:800; }
    @media print{
      body{ padding:0; }
      .wrap{ max-width: none; margin:0; }
      a{ color:inherit; text-decoration:none; }
    }
  `;

  const baseHours = Math.max(0, Number(overall.paid||0) - Number(overall.otHours||0));

  const companyRows = Object.keys(byCompany || {})
    .sort((a,b)=>{
      const an = getCompanyById(a)?.name || "Unknown";
      const bn = getCompanyById(b)?.name || "Unknown";
      return an.localeCompare(bn);
    })
    .map(cid=>{
      const r = byCompany[cid];
      const name = getCompanyById(cid)?.name || "Unknown Company";
      const baseH = Math.max(0, Number(r.paid||0) - Number(r.otHours||0));
      return `
        <tr>
          <td><strong>${esc(name)}</strong><div class="small">${esc(cid)}</div></td>
          <td class="right">${fmtHours(r.worked)}</td>
          <td class="right">${fmtHours(r.breaks)}</td>
          <td class="right">${fmtHours(r.paid)}</td>
          <td class="right">${fmtHours(baseH)}</td>
          <td class="right">${fmtHours(r.otHours)}</td>
          <td class="right">${fmtMoney(r.basePay)}</td>
          <td class="right">${fmtMoney(r.otPay)}</td>
          <td class="right"><strong>${fmtMoney(r.total)}</strong></td>
        </tr>
      `;
    }).join("");

  const shiftRows = rows.map(s=>{
    const companyName = getCompanyById(s.companyId)?.name || "Unknown Company";
    const flags = [
      s.annualLeave ? "AL" : "",
      s.bankHoliday ? "BH" : ""
    ].filter(Boolean).join(" ");

    return `
      <tr>
        <td><strong>${esc(s.date)}</strong>${flags ? `<div class="small">${esc(flags)}</div>` : ""}</td>
        <td>${esc(companyName)}</td>
        <td>${esc(s.start || "")}–${esc(s.finish || "")}</td>
        <td>${esc(s.vehicle || "")}</td>
        <td class="right">${fmtHours(s.worked)}</td>
        <td class="right">${fmtHours(s.breaks)}</td>
        <td class="right">${fmtHours(s.paid)}</td>
        <td class="right">${fmtMoney((s.__payTotal || 0))}</td>
      </tr>
    `;
  }).join("");

  return `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${esc(title)}</title>
        <style>${css}</style>
      </head>
      <body>
        <div class="wrap">
          <div class="top">
            <div>
              <h1>${esc(title)}</h1>
              <div class="meta">
                <div><strong>Period:</strong> ${esc(periodLabel)} (${esc(periodStart)} → ${esc(periodEnd)})</div>
                <div><strong>Generated:</strong> ${esc(new Date().toLocaleString())}</div>
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
            <div class="kpi"><div class="l">Base Pay</div><div class="v">${fmtMoney(overall.basePay)}</div></div>
            <div class="kpi"><div class="l">OT Pay</div><div class="v">${fmtMoney(overall.otPay)}</div></div>
            <div class="kpi"><div class="l">Total Pay</div><div class="v">${fmtMoney(overall.total)}</div></div>
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
                <th class="right">Base Pay</th>
                <th class="right">OT Pay</th>
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${companyRows || `<tr><td colspan="9" class="small">No company data for this period.</td></tr>`}
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

          <div class="totals">
            <div class="box">
              <div class="row"><span>Base Pay</span><span>${fmtMoney(overall.basePay)}</span></div>
              <div class="row"><span>Overtime Pay</span><span>${fmtMoney(overall.otPay)}</span></div>
              <div class="row"><strong>Total</strong><strong>${fmtMoney(overall.total)}</strong></div>
              <div class="small" style="margin-top:8px;">
                Note: This is a calculation summary from HGV Work Log. Verify against payslips/invoices.
              </div>
            </div>
          </div>

        </div>
      </body>
    </html>
  `;
}

function exportPayslip(period = "week") {
  ensureDefaultCompany();

  // Decide the set of shifts for the period
  let periodLabel = "";
  let periodStart = "";
  let periodEnd = "";
  let periodShifts = [];

  if (period === "month") {
    const r = getMonthRangeForDate(new Date());
    periodLabel = "Month";
    periodStart = r.startStr;
    periodEnd = r.endStr;

    periodShifts = shifts.filter(s => (s.date || "").slice(0,7) === r.ym);

    // Month totals: no weekly threshold allocation across the month
    // (still respects BH and daily OT split)
    var overall = processShifts(periodShifts, "monthOverall");
  } else {
    const r = getWeekRangeForDate(new Date());
    periodLabel = "Week (Mon–Sun)";
    periodStart = r.startStr;
    periodEnd = r.endStr;

    periodShifts = shifts.filter(s => {
      const d = dateOnlyToLocalDate(s.date);
      return d >= r.start && d <= r.end;
    });

    // Week totals: overall combined logic
    var overall = processShifts(periodShifts, "overall");
  }

  // By company breakdown
  const byCompany = {};
  const grouped = groupByCompanyId(periodShifts);
  Object.keys(grouped).forEach(cid=>{
    if(!cid) return;
    // per-company view should be perCompany for week, monthOverall for month
    byCompany[cid] = (period === "month")
      ? processShifts(grouped[cid], "monthOverall")
      : processShifts(grouped[cid], "perCompany");
  });

  // Itemised lines: estimate per-shift pay so the line table has a "Pay" column.
  // We calculate per shift: baseHours + otHours (daily), BH full shift at BH multiplier.
  const rows = periodShifts
    .slice()
    .sort((a,b)=> (a.date||"").localeCompare(b.date||"") || (a.start||"").localeCompare(b.start||""))
    .map(s=>{
      const profile = getShiftRateProfile(s);
      const mult = getShiftOTMultiplier(s, profile);

      // base/ot split: prefer stored, else compute
      const paid = Number(s.paid || 0);
      let baseH = Number(s.baseHours);
      let otH = Number(s.otHours);

      if (!Number.isFinite(baseH) || !Number.isFinite(otH)) {
        const split = splitPaidIntoBaseAndOT_DailyWorked(s);
        baseH = split.baseHours;
        otH = split.otHours;
      }

      // bank holiday: whole paid treated as OT
      let linePay = 0;
      if (s.bankHoliday) {
        linePay = paid * profile.baseRate * mult;
      } else {
        linePay = (Number(baseH||0) * profile.baseRate) + (Number(otH||0) * profile.baseRate * mult);
      }

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

  // Print dialog = Save as PDF (desktop) / Save to Files (iOS)
  win.print();
}

/* ===============================
   BACKUP / RESTORE
================================ */

function downloadBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    shifts,
    vehicles,
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

      // Backwards compatible restore (if you ever exported without version/settings)
      shifts = Array.isArray(data.shifts) ? data.shifts : [];
      vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
      settings = data.settings && typeof data.settings === "object" ? data.settings : settings;

      saveAll();
      renderAll();
      loadSettings();

      alert("Backup restored successfully.");
    } catch (err) {
      alert("That backup file looks invalid or corrupted.");
    }
  };
  reader.readAsText(file);

  // allow restoring the same file again later
  event.target.value = "";
}

/* ===============================
   SHIFT LIST (Weekly Grouped / Collapsible)
================================ */

function getWeekStartMonday(dateStr) {
  // dateStr expected as YYYY-MM-DD
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

function formatShiftLine(s, index) {
  const flags = [
    s.annualLeave ? "AL" : "",
    s.bankHoliday ? "BH" : ""
  ].filter(Boolean).join(" ");

  const companyName = getCompanyById(s.companyId)?.name || "Unknown Company";

  const defects = (s.defects || "").trim();
  const defectsPreview = defects.length > 80 ? defects.slice(0, 80) + "…" : defects;

  return `
    <div class="shift-card">
      <strong>${escapeHtml(s.date)}</strong> ${flags ? `(${flags})` : ""}<br>
      <div class="meta">
        <div>${escapeHtml(companyName)}</div>
        ${(s.start && s.finish) ? `<div>${escapeHtml(s.start)} – ${escapeHtml(s.finish)}</div>` : ""}
        ${s.vehicle ? `<div>Vehicle: ${escapeHtml(s.vehicle)}</div>` : ""}
        ${s.trailer1 ? `<div>Trailer 1: ${escapeHtml(s.trailer1)}</div>` : ""}
        ${s.trailer2 ? `<div>Trailer 2: ${escapeHtml(s.trailer2)}</div>` : ""}
        <div>Worked: ${(s.worked ?? 0).toFixed(2)} hrs • Breaks: ${(s.breaks ?? 0).toFixed(2)} hrs • Paid: ${(s.paid ?? 0).toFixed(2)} hrs</div>
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

  // Group shifts by Monday start
  const grouped = {};
  shifts.forEach(s => {
    const wk = getWeekStartMonday(s.date);
    if (!grouped[wk]) grouped[wk] = [];
    grouped[wk].push(s);
  });

  // Render newest week first
  const weeks = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

  let html = "";

  weeks.forEach(weekStart => {
    // Sort shifts inside week oldest -> newest
    grouped[weekStart].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Quick totals for header (worked/breaks/paid)
    const totals = grouped[weekStart].reduce((acc, s) => {
      acc.worked += (s.worked || 0);
      acc.breaks += (s.breaks || 0);
      acc.paid += (s.paid || 0);
      return acc;
    }, { worked: 0, breaks: 0, paid: 0 });

    html += `
      <div class="week-group">
        <div class="week-header" onclick="toggleWeek('${weekStart}')">
          <span>Week Starting ${weekStart}</span>
          <span>${totals.paid.toFixed(2)} hrs</span>
        </div>
        <div class="week-content" id="week-${weekStart}" style="display:none;">
          ${grouped[weekStart].map(formatShiftLine).join("")}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
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

  // Store which shift to edit, then jump to main entry page
  localStorage.setItem("editShiftIndex", String(index));
  window.location.href = "index.html";
}

function applyDefaultsToShiftEntry() {
  const startEl = document.getElementById("start");
  if (!startEl) return; // not on index page

  // Only set default if the field is empty (don't overwrite user input or edits)
  if (!startEl.value && settings.defaultStart) {
    startEl.value = settings.defaultStart;
  }
}
/* ===============================
   RENDER ALL
================================ */

function renderAll() {
  renderVehicles();
  renderWeekly();
  renderMonthly();
}

function loadShiftForEditingIfRequested() {
  const idxRaw = localStorage.getItem("editShiftIndex");
  if (idxRaw === null) return;

  localStorage.removeItem("editShiftIndex");
  const idx = parseInt(idxRaw, 10);

  if (Number.isNaN(idx) || idx < 0 || idx >= shifts.length) return;

  editingIndex = idx;
  const s = shifts[idx];

  // Only fill fields that exist on this page
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
  const defectsEl = document.getElementById("defects");
  if (defectsEl) defectsEl.value = s.defects ?? "";
  setCheck("annualLeave", s.annualLeave);
  setCheck("bankHoliday", s.bankHoliday);
}




/* ===============================
   INIT
================================ */

document.addEventListener("DOMContentLoaded", () => {
  ensureDefaultCompany();
  renderCompanyDropdowns();
  renderCompanies();
  renderVehicles();

  loadSettings();
  loadShiftForEditingIfRequested();
  applyDefaultsToShiftEntry();
  renderCompanySummary();
  renderCurrentPeriodTiles();
  renderAll();

  // If on shifts page
  if (typeof renderWeeklyGroupedShifts === "function") {
    renderWeeklyGroupedShifts();
  }
});