/* ===============================
   Drivers Logbook - app.js
================================ */

/* ===============================
   STORAGE
================================ */

const DATA_MODEL_VERSION = 10;
const DATA_VERSION_KEY = "dataVersion";
const FOUR_WEEK_BLOCK_ANCHOR = "2024-01-01";
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
  summaryPeriodMode: "month",
  summaryPeriodModeManuallySet: false
};

let shifts = JSON.parse(localStorage.getItem("shifts")) || [];
let vehicles = JSON.parse(localStorage.getItem("vehicles")) || [];
let companies = JSON.parse(localStorage.getItem("companies")) || [];

let settings = JSON.parse(localStorage.getItem("settings")) || { ...DEFAULT_SETTINGS };

let editingIndex = null;
let shiftsPageState = {
  initialized: false,
  monthValue: "",
  selectedDate: "",
  selectedShiftId: "",
  shouldFocusSelectedShift: false
};
const SHIFT_CALENDAR_RETURN_KEY = "shiftCalendarReturnState";

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
  out.summaryPeriodModeManuallySet = !!out.summaryPeriodModeManuallySet;
  return out;
}

function normalizeVehicles(src) {
  if (!Array.isArray(src)) return [];
  return [...new Set(src
    .map(v => String(v || "").toUpperCase().trim())
    .filter(Boolean)
  )];
}

function normalizeBonusRule(src) {
  const r = (src && typeof src === "object") ? src : {};
  const type = String(r.type || "none");

  if (type === "night_window") {
    const mode = String(r.mode || "per_hour");
    return {
      type: "night_window",
      mode: (mode === "per_hour" || mode === "per_shift" || mode === "per_week") ? mode : "per_hour",
      amount: Number(r.amount || 0),
      start: r.start || "22:00",
      end: r.end || "06:00",
      name: String(r.name || "Night-window bonus")
    };
  }

  if (type === "per_shift_flat") {
    return {
      type: "per_shift_flat",
      amount: Number(r.amount || 0),
      name: String(r.name || "Per-shift bonus")
    };
  }

  return { type: "none", amount: 0, name: "No bonus" };
}

function normalizeBreakRules(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source
    .map(item => {
      const rule = (item && typeof item === "object") ? item : {};
      return {
        afterWorkedHours: clamp0(rule.afterWorkedHours),
        breakHours: clamp0(rule.breakHours)
      };
    })
    .filter(rule => rule.afterWorkedHours > 0 && rule.breakHours >= 0)
    .sort((a, b) => a.afterWorkedHours - b.afterWorkedHours || a.breakHours - b.breakHours);
}

function normalizeOvertimeScheme(value, payMode = "weekly") {
  const mode = payMode === "daily" ? "daily" : "weekly";
  const raw = String(value || "");
  const allowed = mode === "daily"
    ? ["day_type", "flat_rate", "none"]
    : ["day_type", "flat_rate", "worked_day_sequence", "none"];
  return allowed.includes(raw) ? raw : "day_type";
}

function getOvertimeSchemeLabel(scheme) {
  if (scheme === "flat_rate") return "Flat OT Rate";
  if (scheme === "worked_day_sequence") return "Worked Day Sequence";
  if (scheme === "none") return "No Overtime";
  return "Day-Based Multipliers";
}

function getOvertimeSummaryText(company) {
  const c = company || {};
  const scheme = normalizeOvertimeScheme(c.overtimeScheme, c.payMode || "weekly");
  if (scheme === "none") return "OT: none";
  if (scheme === "flat_rate") {
    return `OT: x${Number(c.ot?.weekday || 1).toFixed(2)} • BH x${Number(c.ot?.bankHoliday || 1).toFixed(2)}`;
  }
  if (scheme === "worked_day_sequence") {
    return `OT: Days 1-5 x${Number(c.ot?.weekday || 1).toFixed(2)} • Day 6 x${Number(c.ot?.saturday || 1).toFixed(2)} • Day 7 x${Number(c.ot?.sunday || 1).toFixed(2)} • BH x${Number(c.ot?.bankHoliday || 1).toFixed(2)}`;
  }
  return `OT: Wkday x${Number(c.ot?.weekday || 1).toFixed(2)} • Sat x${Number(c.ot?.saturday || 1).toFixed(2)} • Sun x${Number(c.ot?.sunday || 1).toFixed(2)} • BH x${Number(c.ot?.bankHoliday || 1).toFixed(2)}`;
}

function toLegacyNightBonusFromRule(rule) {
  if (!rule || rule.type !== "night_window") {
    return { mode: "none", amount: 0, start: "22:00", end: "06:00" };
  }
  return {
    mode: rule.mode || "none",
    amount: Number(rule.amount || 0),
    start: rule.start || "22:00",
    end: rule.end || "06:00"
  };
}

function normalizeCompany(src, fallbackSettings = {}) {
  const c = (src && typeof src === "object") ? src : {};
  const fallback = normalizeSettings(fallbackSettings);
  const nightBonus = c.nightBonus || {};
  const rules = Array.isArray(c.bonusRules) ? c.bonusRules.map(normalizeBonusRule) : [];
  const activeRules = rules.filter(r => r.type !== "none");
  const migratedLegacy = normalizeBonusRule({
    type: "night_window",
    mode: nightBonus.mode || "none",
    amount: Number(nightBonus.amount || 0),
    start: nightBonus.start || "22:00",
    end: nightBonus.end || "06:00",
    name: "Night-window bonus"
  });
  const finalRules = activeRules.length
    ? activeRules
    : (migratedLegacy.mode !== "none" ? [migratedLegacy] : []);
  const legacyFromRule = toLegacyNightBonusFromRule(finalRules[0] || null);
  const payMode = (c.payMode === "daily") ? "daily" : "weekly";
  const breakRuleMode = c.breakRuleMode === "variable" ? "variable" : "fixed";
  const fixedBreakHours = Number.isFinite(Number(c.fixedBreakHours)) ? clamp0(c.fixedBreakHours) : 1;
  const breakRules = normalizeBreakRules(Array.isArray(c.breakRules) ? c.breakRules : []);

  return {
    ...c,
    id: String(c.id || generateCompanyId()),
    name: String(c.name || "Company"),
    baseRate: Number(c.baseRate || 0),
    payMode,
    overtimeScheme: normalizeOvertimeScheme(c.overtimeScheme, payMode),
    payCycle: (c.payCycle === "weekly" || c.payCycle === "month" || c.payCycle === "four_week") ? c.payCycle : "weekly",
    baseWeeklyHours: Number(c.baseWeeklyHours || 0),
    baseDailyPaidHours: Number(c.baseDailyPaidHours || 0),
    standardShiftLength: Number(c.standardShiftLength || 0),
    breakRuleMode,
    fixedBreakHours,
    breakRules,
    defaultStart: String(c.defaultStart ?? fallback.defaultStart ?? ""),
    defaultFinish: String(c.defaultFinish ?? fallback.defaultFinish ?? ""),
    annualLeaveAllowance: Number(c.annualLeaveAllowance ?? fallback.annualLeaveAllowance ?? 0),
    fourWeekCycleStart: /^\d{4}-\d{2}-\d{2}$/.test(String(c.fourWeekCycleStart || ""))
      ? String(c.fourWeekCycleStart)
      : FOUR_WEEK_BLOCK_ANCHOR,
    nightOutPay: Number(c.nightOutPay || 0),
    dailyOTAfterWorkedHours: Number(c.dailyOTAfterWorkedHours || 0),
    minPaidShiftHours: Number(c.minPaidShiftHours || 0),
    nightBonus: legacyFromRule,
    ot: {
      weekday: Number(c.ot?.weekday || 1),
      saturday: Number(c.ot?.saturday || 1),
      sunday: Number(c.ot?.sunday || 1),
      bankHoliday: Number(c.ot?.bankHoliday || 1)
    },
    showVehicleField: (c.showVehicleField !== false),
    showTrailerFields: (c.showTrailerFields !== false),
    showMileageFields: !!c.showMileageFields,
    bonusRules: finalRules,
    vehicleIds: Array.isArray(c.vehicleIds) ? c.vehicleIds : []
  };
}

function normalizeShift(src) {
  const s = (src && typeof src === "object") ? src : {};
  const expenses = s.expenses || {};
  const nightOutCountRaw = Number(s.nightOutCount || 0);
  const nightOutPayRaw = Number(s.nightOutPay || 0);
  const rawOverrides = (s.overrides && typeof s.overrides === "object") ? s.overrides : {};
  const normalizedOverrides = {};

  const copyNumericOverride = (key) => {
    const value = rawOverrides[key];
    if (value === "" || value === null || value === undefined) return;
    const num = Number(value);
    if (Number.isFinite(num)) normalizedOverrides[key] = num;
  };

  ["baseRate", "breakHours", "otWeekday", "otSaturday", "otSunday", "otBankHoliday", "dailyOTAfterWorkedHours", "minPaidShiftHours"].forEach(copyNumericOverride);
  if (rawOverrides.payMode === "daily" || rawOverrides.payMode === "weekly") {
    normalizedOverrides.payMode = rawOverrides.payMode;
  }
  const normalizedVehicleEntries = normalizeVehicleEntries(
    Array.isArray(s.vehicleEntries) && s.vehicleEntries.length
      ? s.vehicleEntries
      : buildLegacyVehicleEntries(s)
  );
  const normalizedTrailers = normalizeTrailerEntries(
    Array.isArray(s.trailers) && s.trailers.length
      ? s.trailers
      : buildLegacyTrailerEntries(s)
  );
  const vehicleLabel = normalizedVehicleEntries
    .map(entry => String(entry.vehicle || "").trim())
    .filter(Boolean)
    .join(" • ");
  const firstVehicleEntry = normalizedVehicleEntries[0] || {};
  const totalMileage = normalizedVehicleEntries.reduce((sum, entry) => sum + Number(entry.mileage || 0), 0);

  return {
    ...s,
    id: String(s.id || generateShiftId()),
    companyId: String(s.companyId || ""),
    date: String(s.date || ""),
    start: String(s.start || ""),
    finish: String(s.finish || ""),
    vehicle: vehicleLabel,
    trailer1: String(normalizedTrailers[0] || ""),
    trailer2: String(normalizedTrailers[1] || ""),
    trailers: normalizedTrailers,
    defects: String(s.defects || s.notes || ""),
    notes: String(s.notes || s.defects || ""),
    annualLeave: !!s.annualLeave,
    sickDay: !!s.sickDay,
    bankHoliday: !!s.bankHoliday,
    dayOffInLieu: !!(s.dayOffInLieu || s.toilDay || s.dayInLieu),
    startMileage: Number(firstVehicleEntry.startMileage || 0),
    finishMileage: Number(firstVehicleEntry.finishMileage || 0),
    mileage: Number(totalMileage || 0),
    shiftType: s.shiftType === "night" ? "night" : "day",
    expenses: {
      parking: Number(expenses.parking || 0),
      tolls: Number(expenses.tolls || 0)
    },
    nightOut: !!(s.nightOut || nightOutCountRaw > 0 || nightOutPayRaw > 0),
    nightOutCount: Math.max(0, nightOutCountRaw),
    nightOutPay: Math.max(0, nightOutPayRaw),
    overrides: normalizedOverrides,
    vehicleEntries: normalizedVehicleEntries
  };
}

function buildLegacyVehicleEntries(shift) {
  const s = (shift && typeof shift === "object") ? shift : {};
  const vehicleList = String(s.vehicle || "")
    .split("•")
    .map(v => String(v || "").toUpperCase().trim())
    .filter(Boolean);
  const startMileage = Number(s.startMileage || 0);
  const finishMileage = Number(s.finishMileage || 0);
  const explicitMileage = Number(s.mileage);
  const mileage = Number.isFinite(explicitMileage)
    ? Math.max(0, explicitMileage)
    : Math.max(0, finishMileage - startMileage);

  if (vehicleList.length > 1) {
    return vehicleList.map(vehicle => ({ vehicle, startMileage: 0, finishMileage: 0, mileage: 0 }));
  }

  if (vehicleList.length === 1 || startMileage > 0 || finishMileage > 0 || mileage > 0) {
    return [{
      vehicle: vehicleList[0] || "",
      startMileage,
      finishMileage,
      mileage
    }];
  }

  return [];
}

function normalizeVehicleEntries(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const normalized = source.map(item => {
    const entry = (item && typeof item === "object") ? item : {};
    const vehicle = String(entry.vehicle || "").toUpperCase().trim();
    const startMileage = Number(entry.startMileage || 0);
    const finishMileage = Number(entry.finishMileage || 0);
    const explicitMileage = Number(entry.mileage);
    const mileage = Number.isFinite(explicitMileage)
      ? Math.max(0, explicitMileage)
      : Math.max(0, finishMileage - startMileage);

    return {
      vehicle,
      startMileage,
      finishMileage,
      mileage
    };
  });

  return normalized.filter(entry =>
    entry.vehicle ||
    entry.startMileage > 0 ||
    entry.finishMileage > 0 ||
    entry.mileage > 0
  );
}

function buildLegacyTrailerEntries(shift) {
  const s = (shift && typeof shift === "object") ? shift : {};
  return [s.trailer1, s.trailer2]
    .map(value => String(value || "").toUpperCase().trim())
    .filter(Boolean);
}

function normalizeTrailerEntries(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source
    .map(value => String(value || "").toUpperCase().replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function migrateData(sourceVersion = getStoredDataVersion()) {
  const from = Number(sourceVersion || 1);
  if (!Array.isArray(shifts)) shifts = [];
  if (!Array.isArray(vehicles)) vehicles = [];
  if (!Array.isArray(companies)) companies = [];
  if (!settings || typeof settings !== "object") settings = {};

  settings = normalizeSettings(settings);
  shifts = shifts.map(normalizeShift);
  vehicles = normalizeVehicles(vehicles);
  companies = companies.map(c => normalizeCompany(c, settings));

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
  syncSummaryPeriodModeUI();
}

function isSummaryFourWeekAvailable() {
  return (getSummaryCycleCompany()?.payCycle || "weekly") === "four_week";
}

function getSummaryPeriodMode() {
  return getHomePeriodMode();
}

function getHomePeriodMode() {
  return isSummaryFourWeekAvailable() ? "four_week" : "month";
}

function syncSummaryPeriodModeUI() {
  const mode = getSummaryPeriodMode();
  const tabMonth = document.getElementById("tabMonth");
  const titleEl = document.getElementById("summaryPeriodLabel");
  const rangeEl = document.getElementById("summaryPeriodRange");
  const breakdownEl = document.getElementById("monthlyBreakdownSummary");
  const exportBtn = document.getElementById("exportSummaryPeriodBtn");
  const exportSimpleBtn = document.getElementById("exportSummaryPeriodSimpleBtn");
  const rangeText = getCurrentPeriodRangeLabel(mode);

  if (tabMonth) tabMonth.textContent = mode === "four_week" ? "Current 4-Week Block" : "Month";
  if (titleEl) titleEl.textContent = mode === "four_week" ? "Current 4-Week Block" : "Month";
  if (rangeEl) rangeEl.textContent = rangeText;
  if (breakdownEl) breakdownEl.textContent = mode === "four_week" ? "4-week block breakdown" : "Monthly breakdown";
  if (exportBtn) exportBtn.textContent = mode === "four_week" ? "Export 4-Week Block Payslip (PDF)" : "Export Month Payslip (PDF)";
  if (exportSimpleBtn) exportSimpleBtn.textContent = mode === "four_week" ? "Export 4-Week Block (Simple)" : "Export Monthly (Simple)";
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
    overtimeScheme: "day_type",
    baseWeeklyHours: settings.baseHours ?? 45,
    dailyOTAfterWorkedHours: 0,        // used only if payMode="daily"
    minPaidShiftHours: 0,              // agency minimum paid
    breakRuleMode: "fixed",
    fixedBreakHours: 1,
    breakRules: [],
    defaultStart: settings.defaultStart ?? "",
    defaultFinish: settings.defaultFinish ?? "",
    annualLeaveAllowance: settings.annualLeaveAllowance ?? 0,
    fourWeekCycleStart: FOUR_WEEK_BLOCK_ANCHOR,
    nightBonus: {
      mode: "none",                    // "none" | "per_hour" | "per_shift" | "per_week"
      amount: 0.50,
      start: "22:00",
      end: "06:00"
    },
    bonusRules: [],
    ot: {
      weekday: settings.otWeekday ?? 1.25,
      saturday: settings.otSaturday ?? 1.25,
      sunday: settings.otSunday ?? 1.5,
      bankHoliday: settings.otBankHoliday ?? 2
    },
    contactName: "",
    contactNumber: "",
    showVehicleField: true,
    showTrailerFields: true,
    showMileageFields: false,
    nightOutPay: 0,
    vehicleIds: [],
    createdAt: Date.now()
  }];

  saveAll();
}

function getCompanyFormSeedValues() {
  ensureDefaultCompany();

  const preferredId = getDefaultCompanyId();
  const preferred = getCompanyById(preferredId);
  const source = preferred || companies[0] || null;

  return {
    baseRate: Number(source?.baseRate || 0),
    baseWeeklyHours: Number(source?.baseWeeklyHours || 0),
    overtimeScheme: normalizeOvertimeScheme(source?.overtimeScheme, source?.payMode || "weekly"),
    standardShiftLength: Number(source?.standardShiftLength || 0),
    breakRuleMode: String(source?.breakRuleMode || "fixed"),
    fixedBreakHours: Number(source?.fixedBreakHours ?? 1),
    breakRules: normalizeBreakRules(Array.isArray(source?.breakRules) ? source.breakRules : []),
    defaultStart: String(source?.defaultStart || ""),
    defaultFinish: String(source?.defaultFinish || ""),
    annualLeaveAllowance: Number(source?.annualLeaveAllowance || 0),
    payCycle: String(source?.payCycle || "weekly"),
    fourWeekCycleStart: String(source?.fourWeekCycleStart || FOUR_WEEK_BLOCK_ANCHOR),
    otWeekday: Number(source?.ot?.weekday || 1),
    otSaturday: Number(source?.ot?.saturday || 1),
    otSunday: Number(source?.ot?.sunday || 1),
    otBankHoliday: Number(source?.ot?.bankHoliday || 1)
  };
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

function getPrimaryBonusRule(company) {
  const c = company || {};
  const rules = Array.isArray(c.bonusRules) ? c.bonusRules : [];
  const first = rules.find(r => r && r.type && r.type !== "none");
  if (first) return normalizeBonusRule(first);

  const nb = c.nightBonus || {};
  if ((nb.mode || "none") === "none") return { type: "none", amount: 0, name: "No bonus" };
  return normalizeBonusRule({
    type: "night_window",
    mode: nb.mode || "none",
    amount: Number(nb.amount || 0),
    start: nb.start || "22:00",
    end: nb.end || "06:00",
    name: "Night-window bonus"
  });
}

function getBonusSummaryText(company) {
  const rule = getPrimaryBonusRule(company);
  if (!rule || rule.type === "none") return "Bonus: none";
  if (rule.type === "per_shift_flat") {
    return `Bonus: £${Number(rule.amount || 0).toFixed(2)}/shift`;
  }
  if (rule.mode === "per_hour") {
    return `Bonus: £${Number(rule.amount || 0).toFixed(2)}/hr (${rule.start}-${rule.end})`;
  }
  if (rule.mode === "per_shift") {
    return `Bonus: £${Number(rule.amount || 0).toFixed(2)}/shift (${rule.start}-${rule.end})`;
  }
  if (rule.mode === "per_week") {
    return `Bonus: £${Number(rule.amount || 0).toFixed(2)}/week (${rule.start}-${rule.end})`;
  }
  return "Bonus: none";
}

function getCompanyAssignedVehicles(companyId) {
  const c = getCompanyById(companyId);
  const ids = Array.isArray(c?.vehicleIds) ? c.vehicleIds : [];
  const allowed = new Set(ids.map(v => String(v || "").toUpperCase().trim()).filter(Boolean));
  return vehicles
    .filter(v => allowed.has(v))
    .slice()
    .sort((a, b) => a.localeCompare(b));
}

function ensureVehicleAssignedToCompany(companyId, reg) {
  const c = getCompanyById(companyId);
  const value = String(reg || "").toUpperCase().trim();
  if (!c || !value) return;
  if (!Array.isArray(c.vehicleIds)) c.vehicleIds = [];
  if (!c.vehicleIds.includes(value)) c.vehicleIds.push(value);
}

function getSelectedVehicleIdsFromChecklist() {
  const wrap = document.getElementById("companyVehicleIdsWrap");
  if (!wrap) return [];
  return [...wrap.querySelectorAll("input[type='checkbox'][data-vehicle-id]:checked")]
    .map(el => String(el.getAttribute("data-vehicle-id") || "").toUpperCase().trim())
    .filter(Boolean);
}

function renderCompanyVehicleChecklist(selectedIds = []) {
  const wrap = document.getElementById("companyVehicleIdsWrap");
  if (!wrap) return;

  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : [])
    .map(v => String(v || "").toUpperCase().trim())
    .filter(Boolean)
  );

  if (!vehicles.length) {
    wrap.innerHTML = `<div class="small">No vehicles added yet. Add vehicles on the Vehicles page first.</div>`;
    return;
  }

  const rows = vehicles
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(v => `
      <label style="display:flex; align-items:center; gap:10px; margin-top:8px;">
        <input type="checkbox" data-vehicle-id="${escapeHtml(v)}" ${selected.has(v) ? "checked" : ""}>
        <span>${escapeHtml(v)}</span>
      </label>
    `)
    .join("");

  wrap.innerHTML = rows;
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

  applyCompanyShiftEntryVisibility(sel.value);
  renderVehicleMenuOptions(document.getElementById("vehicle")?.value || "");
  initNightOutBehavior();
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

    const nbText = getBonusSummaryText(c);
    const otText = getOvertimeSummaryText(c);
    const breakText = c.breakRuleMode === "variable"
      ? (normalizeBreakRules(c.breakRules).length
          ? normalizeBreakRules(c.breakRules).map(rule => `${rule.afterWorkedHours.toFixed(2)}h -> ${rule.breakHours.toFixed(2)}h`).join(" • ")
          : "Variable")
      : `${Number(c.fixedBreakHours ?? 1).toFixed(2)} hrs fixed`;

    return `
      <div class="shift-card">
        <strong>${escapeHtml(c.name)}</strong>
        ${isDefault ? `<span class="small" style="margin-left:8px;">(Default)</span>` : ""}
        <br>
		<div class="meta" style="margin-top:8px;">
          Pay mode: ${escapeHtml(c.payMode || "weekly")}<br>
          OT scheme: ${escapeHtml(getOvertimeSchemeLabel(c.overtimeScheme || "day_type"))}<br>
          Rate: £${Number(c.baseRate || 0).toFixed(2)}<br>
		  ${c.standardShiftLength ? `Std shift length: ${Number(c.standardShiftLength || 0).toFixed(2)} hrs<br>` : ""}
          ${(c.defaultStart || c.defaultFinish) ? `Defaults: ${escapeHtml(c.defaultStart || "--:--")} - ${escapeHtml(c.defaultFinish || "--:--")}<br>` : ""}
          Breaks: ${escapeHtml(breakText)}<br>
          Leave allowance: ${Number(c.annualLeaveAllowance || 0).toFixed(0)} days<br>
          Pay cycle: ${escapeHtml(c.payCycle === "four_week" ? "4-weekly" : (c.payCycle === "month" ? "Monthly" : "Weekly"))}<br>
          ${c.payCycle === "four_week" ? `4-week cycle start: ${escapeHtml(c.fourWeekCycleStart || FOUR_WEEK_BLOCK_ANCHOR)}<br>` : ""}
          Night out pay: £${Number(c.nightOutPay || 0).toFixed(2)}<br>
          Weekly base: ${Number(c.baseWeeklyHours || 0).toFixed(2)} hrs<br>
          ${(c.payMode === "daily")
		  ? `Daily OT after (worked): ${Number(c.dailyOTAfterWorkedHours || 0).toFixed(2)} hrs<br>` : ``}
          Min paid shift: ${Number(c.minPaidShiftHours || 0).toFixed(2)} hrs<br>
          ${escapeHtml(otText)}<br>
          ${escapeHtml(nbText)}<br>
          Fields: Vehicle ${c.showVehicleField !== false ? "on" : "off"} • Trailers ${c.showTrailerFields !== false ? "on" : "off"} • Mileage ${c.showMileageFields ? "on" : "off"}<br>
          Assigned vehicles: ${Array.isArray(c.vehicleIds) ? c.vehicleIds.length : 0}<br>
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
  const payCycle = document.getElementById("companyPayCycle")?.value || "weekly";
  const fourWeekCycleStart = String(document.getElementById("companyFourWeekCycleStart")?.value || "").trim() || FOUR_WEEK_BLOCK_ANCHOR;
  if (payCycle === "four_week") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fourWeekCycleStart)) return alert("Please enter a valid 4-week cycle start date.");
    if (dateOnlyToDate(fourWeekCycleStart).getDay() !== 1) return alert("4-week cycle start date must be a Monday.");
  }

  const bonusType = document.getElementById("bonusType")?.value || "none";
  const bonusMode = document.getElementById("bonusMode")?.value || "per_hour";
  const bonusAmount = Number(document.getElementById("bonusAmount")?.value) || 0;
  const bonusStart = document.getElementById("bonusStart")?.value || "22:00";
  const bonusEnd = document.getElementById("bonusEnd")?.value || "06:00";

  let bonusRules = [];
  if (bonusType === "night_window") {
    bonusRules = [normalizeBonusRule({
      type: "night_window",
      mode: bonusMode,
      amount: bonusAmount,
      start: bonusStart,
      end: bonusEnd,
      name: "Night-window bonus"
    })];
  } else if (bonusType === "per_shift_flat") {
    bonusRules = [normalizeBonusRule({
      type: "per_shift_flat",
      amount: bonusAmount,
      name: "Per-shift bonus"
    })];
  }
  const legacyNightBonus = toLegacyNightBonusFromRule(bonusRules[0] || null);
  const breakRuleMode = document.getElementById("breakRuleMode")?.value === "variable" ? "variable" : "fixed";
  const breakRules = breakRuleMode === "variable"
    ? readBreakRuleEntries()
    : [];
  const fixedBreakHours = breakRuleMode === "fixed"
    ? (Number(document.getElementById("fixedBreakHours")?.value) || 0)
    : 0;
  const payMode = document.getElementById("payMode")?.value || "weekly";
  const overtimeScheme = normalizeOvertimeScheme(document.getElementById("overtimeScheme")?.value || "day_type", payMode);

  const company = {
    id: id || generateCompanyId(),
    name,
    baseRate,

    payMode,
    overtimeScheme,
	payCycle,
	baseWeeklyHours: Number(document.getElementById("baseWeeklyHours")?.value) || 0,
	standardShiftLength: Number(document.getElementById("standardShiftLength")?.value) || 0,
	breakRuleMode,
	fixedBreakHours,
	breakRules,
	defaultStart: document.getElementById("companyDefaultStart")?.value || "",
	defaultFinish: document.getElementById("companyDefaultFinish")?.value || "",
	annualLeaveAllowance: Number(document.getElementById("companyAnnualLeaveAllowance")?.value) || 0,
	fourWeekCycleStart,
	nightOutPay: Number(document.getElementById("companyNightOutPay")?.value) || 0,
	dailyOTAfterWorkedHours: Number(document.getElementById("dailyOTAfterWorkedHours")?.value) || 0,
	minPaidShiftHours: Number(document.getElementById("minPaidShiftHours")?.value) || 0,

    ot: {
      weekday: Number(document.getElementById("otWeekday")?.value) || 1,
      saturday: Number(document.getElementById("otSaturday")?.value) || 1,
      sunday: Number(document.getElementById("otSunday")?.value) || 1,
      bankHoliday: Number(document.getElementById("otBankHoliday")?.value) || 1
    },

    nightBonus: legacyNightBonus,
    bonusRules,

    showVehicleField: !!document.getElementById("showVehicleField")?.checked,
    showTrailerFields: !!document.getElementById("showTrailerFields")?.checked,
    showMileageFields: !!document.getElementById("showMileageFields")?.checked,
    vehicleIds: getSelectedVehicleIdsFromChecklist(),

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
  setVal("overtimeScheme", normalizeOvertimeScheme(c.overtimeScheme, c.payMode || "weekly"));
  setVal("companyPayCycle", c.payCycle || "weekly");
  setVal("breakRuleMode", c.breakRuleMode || "fixed");

  // If you have UI logic to show/hide daily OT + bonus fields, call it here
  if (typeof updateCompanyFormVisibility === "function") {
    updateCompanyFormVisibility();
  } else {
    // Minimal fallback: show daily OT input only when daily mode
    const dailyWrap = document.getElementById("dailyOTAfterWorkedHours")?.closest(".field") || null;
    if (dailyWrap) dailyWrap.style.display = (c.payMode === "daily") ? "" : "none";
  }

  setVal("dailyOTAfterWorkedHours", c.dailyOTAfterWorkedHours);
  setVal("minPaidShiftHours", c.minPaidShiftHours);
  setVal("fixedBreakHours", c.fixedBreakHours ?? 1);
  setVal("companyDefaultStart", c.defaultStart);
  setVal("companyDefaultFinish", c.defaultFinish);
  setVal("companyAnnualLeaveAllowance", c.annualLeaveAllowance);
  setVal("companyFourWeekCycleStart", c.fourWeekCycleStart || FOUR_WEEK_BLOCK_ANCHOR);

  // Bonus
  const bonus = getPrimaryBonusRule(c);
  setVal("bonusType", bonus.type || "none");
  setVal("bonusMode", bonus.mode || "per_hour");
  setVal("bonusAmount", bonus.amount ?? 0);
  setVal("bonusStart", bonus.start || "22:00");
  setVal("bonusEnd", bonus.end || "06:00");
  updateCompanyFormVisibility();

  // OT multipliers
  setVal("otWeekday", c.ot?.weekday);
  setVal("otSaturday", c.ot?.saturday);
  setVal("otSunday", c.ot?.sunday);
  setVal("otBankHoliday", c.ot?.bankHoliday);

  // Hours rules
  setVal("baseWeeklyHours", c.baseWeeklyHours);
  setVal("standardShiftLength", c.standardShiftLength);
  setVal("companyNightOutPay", c.nightOutPay || 0);
  renderBreakRuleEntries(c.breakRuleMode === "variable" ? c.breakRules : getDefaultVariableBreakRules(), { preserveEmpty: true });

  // Contact
  setVal("contactName", c.contactName);
  setVal("contactNumber", c.contactNumber);

  const setCheck = (elId, checked) => {
    const el = document.getElementById(elId);
    if (el) el.checked = !!checked;
  };

  setCheck("showVehicleField", c.showVehicleField !== false);
  setCheck("showTrailerFields", c.showTrailerFields !== false);
  setCheck("showMileageFields", !!c.showMileageFields);
  renderCompanyVehicleChecklist(Array.isArray(c.vehicleIds) ? c.vehicleIds : []);

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
  const seed = getCompanyFormSeedValues();
  const ids = [
    "companyId", "companyName", "companyBaseRate",
    "payMode", "overtimeScheme", "companyPayCycle", "baseWeeklyHours", "dailyOTAfterWorkedHours", "minPaidShiftHours",
    "companyDefaultStart", "companyDefaultFinish", "companyAnnualLeaveAllowance", "fixedBreakHours",
    "companyFourWeekCycleStart",
    "otWeekday", "otSaturday", "otSunday", "otBankHoliday",
    "companyNightOutPay",
    "bonusType", "bonusMode", "bonusAmount", "bonusStart", "bonusEnd", "breakRuleMode",
    "contactName", "contactNumber"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // sensible defaults
  if (document.getElementById("companyBaseRate")) document.getElementById("companyBaseRate").value = seed.baseRate;
  if (document.getElementById("payMode")) document.getElementById("payMode").value = "weekly";
  if (document.getElementById("overtimeScheme")) document.getElementById("overtimeScheme").value = seed.overtimeScheme || "day_type";
  if (document.getElementById("companyPayCycle")) document.getElementById("companyPayCycle").value = seed.payCycle;
  if (document.getElementById("baseWeeklyHours")) document.getElementById("baseWeeklyHours").value = seed.baseWeeklyHours;
  if (document.getElementById("dailyOTAfterWorkedHours")) document.getElementById("dailyOTAfterWorkedHours").value = 0;
  if (document.getElementById("minPaidShiftHours")) document.getElementById("minPaidShiftHours").value = 0;
  if (document.getElementById("standardShiftLength")) document.getElementById("standardShiftLength").value = seed.standardShiftLength || 0;
  if (document.getElementById("breakRuleMode")) document.getElementById("breakRuleMode").value = seed.breakRuleMode || "fixed";
  if (document.getElementById("fixedBreakHours")) document.getElementById("fixedBreakHours").value = seed.fixedBreakHours ?? 1;
  if (document.getElementById("companyDefaultStart")) document.getElementById("companyDefaultStart").value = seed.defaultStart;
  if (document.getElementById("companyDefaultFinish")) document.getElementById("companyDefaultFinish").value = seed.defaultFinish;
  if (document.getElementById("companyAnnualLeaveAllowance")) document.getElementById("companyAnnualLeaveAllowance").value = seed.annualLeaveAllowance;
  if (document.getElementById("companyFourWeekCycleStart")) document.getElementById("companyFourWeekCycleStart").value = seed.fourWeekCycleStart;
  if (document.getElementById("companyNightOutPay")) document.getElementById("companyNightOutPay").value = 0;

  if (document.getElementById("otWeekday")) document.getElementById("otWeekday").value = seed.otWeekday;
  if (document.getElementById("otSaturday")) document.getElementById("otSaturday").value = seed.otSaturday;
  if (document.getElementById("otSunday")) document.getElementById("otSunday").value = seed.otSunday;
  if (document.getElementById("otBankHoliday")) document.getElementById("otBankHoliday").value = seed.otBankHoliday;

  if (document.getElementById("bonusType")) document.getElementById("bonusType").value = "none";
  if (document.getElementById("bonusMode")) document.getElementById("bonusMode").value = "per_hour";
  if (document.getElementById("bonusAmount")) document.getElementById("bonusAmount").value = 0.5;
  if (document.getElementById("bonusStart")) document.getElementById("bonusStart").value = "22:00";
  if (document.getElementById("bonusEnd")) document.getElementById("bonusEnd").value = "06:00";
  renderBreakRuleEntries(seed.breakRules?.length ? seed.breakRules : getDefaultVariableBreakRules(), { preserveEmpty: true });

  if (document.getElementById("showVehicleField")) document.getElementById("showVehicleField").checked = true;
  if (document.getElementById("showTrailerFields")) document.getElementById("showTrailerFields").checked = true;
  if (document.getElementById("showMileageFields")) document.getElementById("showMileageFields").checked = false;
  renderCompanyVehicleChecklist([]);
  
  updateCompanyFormVisibility();
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
  const removed = vehicles[i];
  vehicles.splice(i, 1);
  companies = companies.map(c => ({
    ...c,
    vehicleIds: Array.isArray(c.vehicleIds) ? c.vehicleIds.filter(v => v !== removed) : []
  }));
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
      const companyNames = getVehicleCompanyNames(v);
      const div = document.createElement("div");
      div.className = "shift-card";
      div.innerHTML = `
        <div>
          <strong>${escapeHtml(v)}</strong>
          <div class="small">${escapeHtml(companyNames.length ? companyNames.join(", ") : "Unassigned")}</div>
        </div>
        <button onclick="deleteVehicle(${i})">Delete</button>
      `;
      list.appendChild(div);
    }
  });

  // Keep combobox suggestions in sync on enter-shift page.
  renderVehicleMenuOptions((document.getElementById("vehicle")?.value || ""));

  // Keep company vehicle assignment checklist in sync on companies page.
  const selectedIds = getSelectedVehicleIdsFromChecklist();
  renderCompanyVehicleChecklist(selectedIds);
}

function getVehicleCompanyNames(vehicleId) {
  const target = String(vehicleId || "").toUpperCase().trim();
  if (!target) return [];
  return (companies || [])
    .filter(company => Array.isArray(company?.vehicleIds) && company.vehicleIds.includes(target))
    .map(company => String(company?.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function renderVehicleMenuOptions(filterText = "") {
  const menu = document.getElementById("vehicleMenu");
  if (!menu) return;

  const companyId = document.getElementById("company")?.value || "";
  const source = companyId ? getCompanyAssignedVehicles(companyId) : vehicles.slice();
  const filter = String(filterText || "").toUpperCase().trim();
  const options = source
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .filter(v => !filter || v.includes(filter));

  if (!options.length) {
    menu.innerHTML = `<div class="combo-empty">No assigned vehicles. Type a new registration.</div>`;
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
  const companyEl = document.getElementById("company");
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

  if (companyEl) {
    companyEl.addEventListener("change", () => {
      applyCompanyShiftEntryVisibility(companyEl.value);
      applyDefaultsToShiftEntry();
      renderVehicleMenuOptions(input.value);
      initNightOutBehavior();
    });
  }
}

function getCompanyShiftEntryDefaults(companyId) {
  const company = getCompanyById(companyId);
  return {
    defaultStart: String(company?.defaultStart || ""),
    defaultFinish: String(company?.defaultFinish || "")
  };
}

function getBreakHoursForWorked(workedHours, company = null) {
  const worked = clamp0(workedHours);
  const c = company || {};
  if (String(c.breakRuleMode || "fixed") === "variable") {
    const rules = normalizeBreakRules(c.breakRules);
    let matched = 0;
    rules.forEach(rule => {
      if (worked >= rule.afterWorkedHours) matched = rule.breakHours;
    });
    return clamp0(matched);
  }
  return clamp0(c.fixedBreakHours ?? 1);
}

function getLeavePaidHours(company) {
  const c = company || {};
  const standardLength = clamp0(c.standardShiftLength || 9);
  if (standardLength <= 0) return 0;
  const breakHours = getBreakHoursForWorked(standardLength, c);
  return Math.max(0, standardLength - breakHours);
}

/* ===============================
   HOURS + NIGHT HOURS
================================ */

function calculateHours(start, finish, isAL, isSick, options = {}) {
  const leavePaidHours = clamp0(options.leavePaidHours ?? 9);
  if (isAL || isSick) {
    const paid = clamp0(leavePaidHours || 9);
    return { worked: paid, breaks: 0, paid };
  }

  if (!start || !finish) return { worked: 0, breaks: 0, paid: 0 };

  let s = new Date("1970-01-01T" + start + ":00");
  let f = new Date("1970-01-01T" + finish + ":00");
  if (f < s) f.setDate(f.getDate() + 1);

  const worked = (f - s) / 1000 / 60 / 60;
  const breaks = clamp0(options.breakHours ?? 1);
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

  if (!shift.annualLeave && !shift.sickDay && minPaid > 0) {
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
  if (shift?.annualLeave || shift?.sickDay) {
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

  const companyId = document.getElementById("company")?.value || "";
  const defaults = getCompanyShiftEntryDefaults(companyId);

  if ((force || !startEl.value) && defaults.defaultStart) {
    startEl.value = defaults.defaultStart;
  }

  const finishEl = document.getElementById("finish");
  if (finishEl && (force || !finishEl.value) && defaults.defaultFinish) {
    finishEl.value = defaults.defaultFinish;
  }

  const dateEl = document.getElementById("date");
  if (dateEl && (force || !dateEl.value)) {
    const shiftType = document.getElementById("shiftType")?.value || "day";
    dateEl.value = getDefaultDateForShiftType(shiftType);
  }

  const companyEl = document.getElementById("company");
  if (companyEl && (force || !companyEl.value)) {
    renderCompanyDropdowns();
  }
}

function applyCompanyShiftEntryVisibility(companyId) {
  const vehicleRow = document.getElementById("shiftVehicleRow");
  const trailerRows = document.getElementById("shiftTrailerRows");
  if (!vehicleRow && !trailerRows) return;

  const c = getCompanyById(companyId);
  const showVehicle = c ? (c.showVehicleField !== false) : true;
  const showTrailers = c ? (c.showTrailerFields !== false) : true;
  const showMileage = c ? !!c.showMileageFields : false;

  if (vehicleRow) {
    vehicleRow.hidden = !(showVehicle || showMileage);
  }

  if (trailerRows) {
    trailerRows.hidden = !showTrailers;
    if (!showTrailers) {
      renderShiftTrailerEntries([], { preserveEmpty: false });
    }
  }

  renderAssignedVehicleOptions(companyId);
  renderShiftVehicleEntries(readShiftVehicleEntries(showMileage), { showVehicle, showMileage, preserveEmpty: true });
  renderShiftTrailerEntries(readShiftTrailerEntries(), { preserveEmpty: true });
}

function getDefaultDateForShiftType(type) {
  return new Date().toISOString().slice(0, 10);
}

function initShiftTypeBehavior() {
  const shiftTypeEl = document.getElementById("shiftType");
  if (!shiftTypeEl) return;

  shiftTypeEl.addEventListener("change", () => {
    const currentValue = String(shiftTypeEl.value || "day");
    if (currentValue !== "night" && currentValue !== "day") {
      shiftTypeEl.value = "day";
    }
  });
}

function renderAssignedVehicleOptions(companyId = document.getElementById("company")?.value || "") {
  const list = document.getElementById("assignedVehicleOptions");
  if (!list) return;
  const source = companyId ? getCompanyAssignedVehicles(companyId) : vehicles.slice();
  list.innerHTML = source
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(v => `<option value="${escapeHtml(v)}"></option>`)
    .join("");
}

function createVehicleEntry(entry = {}, showVehicle = true, showMileage = false, canRemove = true) {
  const vehicle = String(entry.vehicle || "").toUpperCase().trim();
  const startMileage = Number(entry.startMileage || 0);
  const finishMileage = Number(entry.finishMileage || 0);
  const mileage = Number(entry.mileage || Math.max(0, finishMileage - startMileage) || 0);

  return `
    <div class="shift-card vehicle-entry" style="margin-top:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
        <strong>Vehicle Entry</strong>
        ${canRemove ? `<button type="button" class="button-secondary vehicle-entry-remove" style="width:auto;">Remove</button>` : ""}
      </div>
      ${showVehicle ? `
        <label style="margin-top:0;">Vehicle</label>
        <input type="text" class="vehicle-entry-vehicle" list="assignedVehicleOptions" placeholder="Registration" autocomplete="off" value="${escapeHtml(vehicle)}">
      ` : ""}
      ${showMileage ? `
        <div class="grid">
          <div>
            <label>Start Mileage</label>
            <input type="number" class="vehicle-entry-start" min="0" step="1" placeholder="e.g. 124000" value="${startMileage > 0 ? escapeHtml(String(startMileage)) : ""}">
          </div>
          <div>
            <label>Finish Mileage</label>
            <input type="number" class="vehicle-entry-finish" min="0" step="1" placeholder="e.g. 124320" value="${finishMileage > 0 ? escapeHtml(String(finishMileage)) : ""}">
          </div>
        </div>
        <label>Mileage Done</label>
        <input type="number" class="vehicle-entry-mileage" min="0" step="1" readonly value="${(startMileage > 0 || finishMileage > 0 || mileage > 0) ? escapeHtml(String(mileage)) : ""}">
      ` : ""}
    </div>
  `;
}

function updateVehicleEntryMileageDone(row) {
  const startEl = row?.querySelector(".vehicle-entry-start");
  const finishEl = row?.querySelector(".vehicle-entry-finish");
  const doneEl = row?.querySelector(".vehicle-entry-mileage");
  if (!startEl || !finishEl || !doneEl) return;

  const start = Number(startEl.value || 0);
  const finish = Number(finishEl.value || 0);
  const miles = Math.max(0, finish - start);
  doneEl.value = (startEl.value || finishEl.value) ? String(miles) : "";
}

function readShiftVehicleEntries(showMileage = null) {
  const companyId = document.getElementById("company")?.value || "";
  const showMileageResolved = showMileage === null
    ? !!getCompanyById(companyId)?.showMileageFields
    : !!showMileage;
  const wrap = document.getElementById("shiftVehicleEntries");
  if (!wrap) return [];

  return normalizeVehicleEntries([...wrap.querySelectorAll(".vehicle-entry")].map(row => {
    const vehicle = String(row.querySelector(".vehicle-entry-vehicle")?.value || "").toUpperCase().trim();
    const startMileage = showMileageResolved ? Number(row.querySelector(".vehicle-entry-start")?.value || 0) : 0;
    const finishMileage = showMileageResolved ? Number(row.querySelector(".vehicle-entry-finish")?.value || 0) : 0;
    return {
      vehicle,
      startMileage,
      finishMileage,
      mileage: showMileageResolved ? Math.max(0, finishMileage - startMileage) : 0
    };
  }));
}

function renderShiftVehicleEntries(entries = [], options = {}) {
  const wrap = document.getElementById("shiftVehicleEntries");
  if (!wrap) return;
  const companyId = document.getElementById("company")?.value || "";
  const company = getCompanyById(companyId);
  const showVehicle = options.showVehicle ?? (company ? (company.showVehicleField !== false) : true);
  const showMileage = options.showMileage ?? !!company?.showMileageFields;
  let normalized = normalizeVehicleEntries(entries);
  const requestedCount = Math.max(
    Number(options.requestedCount || 0),
    normalized.length,
    options.preserveEmpty === false ? 0 : 1
  );
  while (normalized.length < requestedCount) normalized.push({});

  wrap.innerHTML = normalized
    .map((entry, index) => createVehicleEntry(entry, showVehicle, showMileage, normalized.length > 1 || index > 0))
    .join("");

  wrap.querySelectorAll(".vehicle-entry").forEach(updateVehicleEntryMileageDone);
}

function addVehicleEntry() {
  const companyId = document.getElementById("company")?.value || "";
  const company = getCompanyById(companyId);
  const showMileage = !!company?.showMileageFields;
  const entryCount = Math.max(document.querySelectorAll("#shiftVehicleEntries .vehicle-entry").length, 1) + 1;
  const entries = readShiftVehicleEntries(showMileage);
  renderShiftVehicleEntries(entries, {
    showVehicle: company ? (company.showVehicleField !== false) : true,
    showMileage,
    preserveEmpty: true,
    requestedCount: entryCount
  });
}

function createTrailerEntry(value = "", canRemove = true) {
  return `
    <div class="inline-row trailer-entry" style="margin-top:10px;">
      <input type="text" class="trailer-entry-value" placeholder="Trailer registration" autocomplete="off" value="${escapeHtml(String(value || "").toUpperCase().trim())}">
      ${canRemove ? `<button type="button" class="button-secondary trailer-entry-remove">Remove</button>` : ""}
    </div>
  `;
}

function readShiftTrailerEntries() {
  const wrap = document.getElementById("shiftTrailerEntries");
  if (!wrap) return [];
  return normalizeTrailerEntries(
    [...wrap.querySelectorAll(".trailer-entry-value")].map(input => input.value || "")
  );
}

function renderShiftTrailerEntries(entries = [], options = {}) {
  const wrap = document.getElementById("shiftTrailerEntries");
  if (!wrap) return;
  let normalized = normalizeTrailerEntries(entries);
  const requestedCount = Math.max(
    Number(options.requestedCount || 0),
    normalized.length,
    options.preserveEmpty === false ? 0 : 1
  );
  while (normalized.length < requestedCount) normalized.push("");

  wrap.innerHTML = normalized
    .map((entry, index) => createTrailerEntry(entry, normalized.length > 1 || index > 0))
    .join("");
}

function addTrailerEntry() {
  const entryCount = Math.max(document.querySelectorAll("#shiftTrailerEntries .trailer-entry").length, 1) + 1;
  renderShiftTrailerEntries(readShiftTrailerEntries(), {
    preserveEmpty: true,
    requestedCount: entryCount
  });
}

function initVehicleEntryBehavior() {
  const wrap = document.getElementById("shiftVehicleEntries");
  const trailerWrap = document.getElementById("shiftTrailerEntries");
  const companyEl = document.getElementById("company");
  if (!wrap) return;

  wrap.addEventListener("input", (e) => {
    if (e.target.matches(".vehicle-entry-vehicle")) {
      const start = e.target.selectionStart || 0;
      const end = e.target.selectionEnd || 0;
      e.target.value = (e.target.value || "").toUpperCase().replace(/\s+/g, " ").trimStart();
      e.target.setSelectionRange(start, end);
      return;
    }

    const row = e.target.closest(".vehicle-entry");
    if (!row) return;
    if (e.target.matches(".vehicle-entry-start, .vehicle-entry-finish")) {
      updateVehicleEntryMileageDone(row);
    }
  });

  wrap.addEventListener("change", (e) => {
    if (e.target.matches(".vehicle-entry-vehicle")) {
      e.target.value = (e.target.value || "").toUpperCase().trim();
    }
  });

  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".vehicle-entry-remove");
    if (!btn) return;
    const companyId = document.getElementById("company")?.value || "";
    const showMileage = !!getCompanyById(companyId)?.showMileageFields;
    const rows = [...wrap.querySelectorAll(".vehicle-entry")];
    const idx = rows.indexOf(btn.closest(".vehicle-entry"));
    if (idx < 0) return;
    const entries = readShiftVehicleEntries(showMileage);
    entries.splice(idx, 1);
    renderShiftVehicleEntries(entries, { preserveEmpty: true });
  });

  if (trailerWrap) {
    trailerWrap.addEventListener("input", (e) => {
      if (!e.target.matches(".trailer-entry-value")) return;
      const start = e.target.selectionStart || 0;
      const end = e.target.selectionEnd || 0;
      e.target.value = (e.target.value || "").toUpperCase().replace(/\s+/g, " ").trimStart();
      e.target.setSelectionRange(start, end);
    });

    trailerWrap.addEventListener("change", (e) => {
      if (!e.target.matches(".trailer-entry-value")) return;
      e.target.value = (e.target.value || "").toUpperCase().trim();
    });

    trailerWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".trailer-entry-remove");
      if (!btn) return;
      const rows = [...trailerWrap.querySelectorAll(".trailer-entry")];
      const idx = rows.indexOf(btn.closest(".trailer-entry"));
      if (idx < 0) return;
      const entries = readShiftTrailerEntries();
      entries.splice(idx, 1);
      renderShiftTrailerEntries(entries, { preserveEmpty: true });
    });
  }

  if (companyEl) {
    companyEl.addEventListener("change", () => {
      applyCompanyShiftEntryVisibility(companyEl.value);
      applyDefaultsToShiftEntry();
      initNightOutBehavior();
    });
  }
}

function initLeaveCheckboxBehavior() {
  const annualLeaveEl = document.getElementById("annualLeave");
  const sickDayEl = document.getElementById("sickDay");
  const lieuEl = document.getElementById("dayOffInLieu");
  if (!annualLeaveEl || !sickDayEl) return;

  annualLeaveEl.addEventListener("change", () => {
    if (annualLeaveEl.checked) {
      sickDayEl.checked = false;
      if (lieuEl) lieuEl.checked = false;
    }
  });
  sickDayEl.addEventListener("change", () => {
    if (sickDayEl.checked) {
      annualLeaveEl.checked = false;
      if (lieuEl) lieuEl.checked = false;
    }
  });
}

function initNightOutBehavior() {
  const nightOutEl = document.getElementById("nightOut");
  const infoEl = document.getElementById("nightOutPayInfo");
  const companyId = document.getElementById("company")?.value || "";
  if (!nightOutEl || !infoEl) return;

  const c = getCompanyById(companyId);
  const rate = Number(c?.nightOutPay || 0);
  infoEl.textContent = `Night Out Pay Rate (from company): £${rate.toFixed(2)} per night out.`;
}

function getOptionalNumberInputValue(id) {
  const raw = String(document.getElementById(id)?.value || "").trim();
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildShiftOverrides(existingOverrides = {}) {
  const overrides = { ...(existingOverrides && typeof existingOverrides === "object" ? existingOverrides : {}) };
  const formOverrideMap = {
    overrideBaseRate: "baseRate",
    overrideBreakHours: "breakHours",
    overrideOtWeekday: "otWeekday",
    overrideOtSaturday: "otSaturday",
    overrideOtSunday: "otSunday",
    overrideOtBankHoliday: "otBankHoliday"
  };

  Object.entries(formOverrideMap).forEach(([inputId, key]) => {
    const value = getOptionalNumberInputValue(inputId);
    if (value === null) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
  });

  return overrides;
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

  const company = getCompanyById(companyId);
  const showVehicle = company ? (company.showVehicleField !== false) : true;
  const showTrailers = company ? (company.showTrailerFields !== false) : true;
  const showMileage = company ? !!company.showMileageFields : false;
  const leavePaidHours = getLeavePaidHours(company);
  const defaultBreakHours = getBreakHoursForWorked(
    (() => {
      const start = document.getElementById("start")?.value || "";
      const finish = document.getElementById("finish")?.value || "";
      if (!start || !finish) return 0;
      let s = new Date(`1970-01-01T${start}:00`);
      let f = new Date(`1970-01-01T${finish}:00`);
      if (f < s) f.setDate(f.getDate() + 1);
      return (f - s) / 1000 / 60 / 60;
    })(),
    company
  );

  const vehicleEntries = readShiftVehicleEntries(showMileage);
  const trailers = showTrailers ? readShiftTrailerEntries() : [];
  const vehicle = vehicleEntries.map(entry => entry.vehicle).filter(Boolean).join(" • ");
  const startMileage = Number(vehicleEntries[0]?.startMileage || 0);
  const finishMileage = Number(vehicleEntries[0]?.finishMileage || 0);
  const mileage = vehicleEntries.reduce((sum, entry) => sum + Number(entry.mileage || 0), 0);
  const shiftType = document.getElementById("shiftType")?.value || "day";
  const isAnnualLeave = !!document.getElementById("annualLeave")?.checked;
  const isSickDay = !!document.getElementById("sickDay")?.checked;
  const hasDayOffInLieu = !!document.getElementById("dayOffInLieu")?.checked;
  const isNightOut = !!document.getElementById("nightOut")?.checked;
  const expenseParking = Number(document.getElementById("expenseParking")?.value || 0);
  const expenseTolls = Number(document.getElementById("expenseTolls")?.value || 0);
  const nightOutPayRate = Number(company?.nightOutPay || 0);
  const nightOutPay = isNightOut ? nightOutPayRate : 0;
  const defectsNotes = document.getElementById("defects")?.value || "";

  if (isAnnualLeave && isSickDay) {
    return alert("A shift can't be both Annual Leave and Sick Day.");
  }
  if ((isAnnualLeave || isSickDay) && hasDayOffInLieu) {
    return alert("Day off in lieu can only be added to worked shifts.");
  }

  vehicleEntries.forEach(entry => {
    if (entry.vehicle && !vehicles.includes(entry.vehicle)) {
      vehicles.push(entry.vehicle);
    }
    if (entry.vehicle) ensureVehicleAssignedToCompany(companyId, entry.vehicle);
  });
  const existingOverrides = (editingIndex !== null && shifts[editingIndex]?.overrides) ? shifts[editingIndex].overrides : {};
  const overrides = buildShiftOverrides(existingOverrides);

  const shift = {
    id: (editingIndex !== null && shifts[editingIndex]?.id) ? shifts[editingIndex].id : generateShiftId(),
    date,
    companyId,

    start: document.getElementById("start")?.value || "",
    finish: document.getElementById("finish")?.value || "",
    shiftType,
    vehicle,
    vehicleEntries,
    trailer1: trailers[0] || "",
    trailer2: trailers[1] || "",
    trailers,
    startMileage,
    finishMileage,
    mileage,
    defects: defectsNotes,
    notes: defectsNotes,
    annualLeave: isAnnualLeave,
    sickDay: isSickDay,
    bankHoliday: !!document.getElementById("bankHoliday")?.checked,
    dayOffInLieu: hasDayOffInLieu,
    expenses: {
      parking: Math.max(0, expenseParking),
      tolls: Math.max(0, expenseTolls)
    },
    nightOut: isNightOut,
    nightOutCount: isNightOut ? 1 : 0,
    nightOutPay: Math.max(0, nightOutPay),
    overrides,

    createdAt:
      (editingIndex !== null && shifts[editingIndex]?.createdAt)
        ? shifts[editingIndex].createdAt
        : Date.now()
  };

  // Hours
  const hrs = calculateHours(shift.start, shift.finish, shift.annualLeave, shift.sickDay, {
    leavePaidHours,
    breakHours: defaultBreakHours
  });
  shift.worked = hrs.worked;
  shift.breaks = hrs.breaks;
  shift.paid = hrs.paid;
  if (!shift.annualLeave && !shift.sickDay && Number.isFinite(shift.overrides?.breakHours)) {
    shift.breaks = Math.max(0, Number(shift.overrides.breakHours || 0));
    shift.paid = Math.max(0, Number(shift.worked || 0) - shift.breaks);
  }

  // Apply company rules (min paid, etc.)
  applyCompanyPaidRules(shift);

  // Store base/ot split for daily mode (weekly mode stays base=paid until weekly allocation)
  const split = splitPaidIntoBaseAndOT_DailyWorked(shift);
  shift.baseHours = split.baseHours;
  shift.otHours = split.otHours;

  const wasEditing = editingIndex !== null;

  if (wasEditing) {
    shifts[editingIndex] = shift;
    editingIndex = null;
  } else {
    shifts.push(shift);
  }

  saveAll();
  localStorage.setItem(SHIFT_CALENDAR_RETURN_KEY, JSON.stringify({
    action: wasEditing ? "updated" : "added",
    shiftId: shift.id,
    date: shift.date,
    monthValue: shift.date.slice(0, 7)
  }));
  window.location.href = "shifts.html";
}

function clearForm() {
  document.querySelectorAll("input, textarea").forEach(el => {
    if (el.type === "checkbox") el.checked = false;
    else if (el.type !== "file") el.value = "";
  });
  const shiftType = document.getElementById("shiftType");
  if (shiftType) shiftType.value = "day";

  // keep company selection if still selected; otherwise re-pick default
  const company = document.getElementById("company");
  if (!company || !company.value) renderCompanyDropdowns();
  else applyCompanyShiftEntryVisibility(company.value);

  renderAssignedVehicleOptions(company?.value || "");
  renderShiftVehicleEntries([{}], { preserveEmpty: true });

  // re-apply defaults (this fixes your “start time blank after reset” issue)
  applyDefaultsToShiftEntry();
  initNightOutBehavior();
}

/* ===============================
   PAY ENGINE
================================ */

function getShiftRateProfile(shift) {
  const c = getCompanyById(shift.companyId);

  const baseRate = Number(shift.overrides?.baseRate ?? c?.baseRate ?? 0);

  const ot = {
    weekday: Number(shift.overrides?.otWeekday ?? c?.ot?.weekday ?? 1),
    saturday: Number(shift.overrides?.otSaturday ?? c?.ot?.saturday ?? 1),
    sunday: Number(shift.overrides?.otSunday ?? c?.ot?.sunday ?? 1),
    bankHoliday: Number(shift.overrides?.otBankHoliday ?? c?.ot?.bankHoliday ?? 1)
  };

  return { baseRate, ot };
}

function getCompanyPayMode(companyId) {
  const c = getCompanyById(companyId);
  return c?.payMode || "weekly";
}

function getCompanyOvertimeScheme(companyId) {
  const c = getCompanyById(companyId);
  return normalizeOvertimeScheme(c?.overtimeScheme, c?.payMode || "weekly");
}

function getCompanyWeeklyBaseHours(companyId) {
  const c = getCompanyById(companyId);
  return Number(c?.baseWeeklyHours ?? 0);
}

function isWorkedShiftForDaySequence(shift) {
  return !!shift && !shift.annualLeave && !shift.sickDay && Number(shift.paid || 0) > 0;
}

function getShiftDayTypeOTMultiplier(shift, profile) {
  if (shift.bankHoliday) return profile.ot.bankHoliday;

  const day = new Date((shift.date || "") + "T00:00:00").getDay();
  if (day === 6) return profile.ot.saturday;
  if (day === 0) return profile.ot.sunday;
  return profile.ot.weekday;
}

function getShiftSchemeOTMultiplier(shift, profile, scheme = "day_type", dayIndex = 0) {
  if (scheme === "flat_rate") {
    return shift.bankHoliday ? profile.ot.bankHoliday : profile.ot.weekday;
  }
  if (scheme === "worked_day_sequence") {
    if (shift.bankHoliday) return profile.ot.bankHoliday;
    if (dayIndex >= 7) return profile.ot.sunday;
    if (dayIndex === 6) return profile.ot.saturday;
    return profile.ot.weekday;
  }
  return getShiftDayTypeOTMultiplier(shift, profile);
}

function allocateAgainstWeeklyBaseHours(paidHours, remainingBaseHours) {
  const paid = clamp0(paidHours);
  const remaining = clamp0(remainingBaseHours);
  const baseHours = Math.min(paid, remaining);
  const otHours = Math.max(0, paid - baseHours);
  return {
    baseHours,
    otHours,
    remainingBaseHours: Math.max(0, remaining - baseHours)
  };
}

function buildWorkedDayIndexByDate(shiftsForWeek) {
  const workedDates = [...new Set(
    shiftsForWeek
      .filter(isWorkedShiftForDaySequence)
      .map(s => String(s.date || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  return new Map(workedDates.map((date, index) => [date, index + 1]));
}

function buildWeeklyOvertimeAllocations(weekShifts, companyId) {
  const scheme = getCompanyOvertimeScheme(companyId);
  const sorted = (Array.isArray(weekShifts) ? weekShifts : [])
    .filter(s => String(s.companyId || "") === String(companyId || ""))
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.start || "").localeCompare(b.start || "") || String(a.id || "").localeCompare(String(b.id || "")));
  const allocations = new Map();
  const workedDayIndexByDate = buildWorkedDayIndexByDate(sorted);
  let remainingBaseHours = getCompanyWeeklyBaseHours(companyId);

  sorted.forEach(shift => {
    const paid = clamp0(shift.paid || 0);
    const profile = getShiftRateProfile(shift);
    const dayIndex = workedDayIndexByDate.get(String(shift.date || "")) || 0;

    if (shift.annualLeave || shift.sickDay) {
      allocations.set(shift.id, { baseHours: paid, otHours: 0, otMultiplier: 1, dayIndex });
      return;
    }

    if (scheme === "none") {
      allocations.set(shift.id, { baseHours: paid, otHours: 0, otMultiplier: 1, dayIndex });
      return;
    }

    if (scheme === "worked_day_sequence") {
      if (shift.bankHoliday || dayIndex >= 7) {
        allocations.set(shift.id, {
          baseHours: 0,
          otHours: paid,
          otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme, dayIndex),
          dayIndex
        });
        return;
      }

      if (dayIndex === 6) {
        allocations.set(shift.id, {
          baseHours: 0,
          otHours: paid,
          otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme, dayIndex),
          dayIndex
        });
        return;
      }

      const split = allocateAgainstWeeklyBaseHours(paid, remainingBaseHours);
      remainingBaseHours = split.remainingBaseHours;
      allocations.set(shift.id, {
        baseHours: split.baseHours,
        otHours: split.otHours,
        otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme, dayIndex),
        dayIndex
      });
      return;
    }

    if (shift.bankHoliday) {
      allocations.set(shift.id, {
        baseHours: 0,
        otHours: paid,
        otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme, dayIndex),
        dayIndex
      });
      return;
    }

    const split = allocateAgainstWeeklyBaseHours(paid, remainingBaseHours);
    remainingBaseHours = split.remainingBaseHours;
    allocations.set(shift.id, {
      baseHours: split.baseHours,
      otHours: split.otHours,
      otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme, dayIndex),
      dayIndex
    });
  });

  return allocations;
}

function getShiftPayAllocation(shift, weeklyAllocationMap = null) {
  const company = getCompanyById(shift.companyId);
  const payMode = shift?.overrides?.payMode ?? company?.payMode ?? "weekly";
  const scheme = normalizeOvertimeScheme(company?.overtimeScheme, payMode);
  const paid = clamp0(shift.paid || 0);
  const profile = getShiftRateProfile(shift);

  if (shift.annualLeave || shift.sickDay) {
    return { baseHours: paid, otHours: 0, otMultiplier: 1 };
  }

  if (scheme === "none") {
    return { baseHours: paid, otHours: 0, otMultiplier: 1 };
  }

  if (payMode === "daily") {
    if (shift.bankHoliday) {
      return {
        baseHours: 0,
        otHours: paid,
        otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme)
      };
    }

    const split = splitPaidIntoBaseAndOT_DailyWorked(shift);
    return {
      baseHours: Number(split.baseHours || 0),
      otHours: Number(split.otHours || 0),
      otMultiplier: getShiftSchemeOTMultiplier(shift, profile, scheme)
    };
  }

  if (weeklyAllocationMap && weeklyAllocationMap.has(shift.id)) {
    return weeklyAllocationMap.get(shift.id);
  }

  const weekStart = getWeekStartMonday(shift.date || "");
  const weekShifts = shifts.filter(s =>
    getWeekStartMonday(s.date || "") === weekStart &&
    String(s.companyId || "") === String(shift.companyId || "")
  );
  const fallbackMap = buildWeeklyOvertimeAllocations(weekShifts, shift.companyId);
  return fallbackMap.get(shift.id) || { baseHours: paid, otHours: 0, otMultiplier: 1 };
}

function calcBonusForShift(shift, company, weekPaidSet, perWeekKey = "") {
  const rule = getPrimaryBonusRule(company);
  if (!rule || rule.type === "none") return { bonusPay: 0, bonusHours: 0 };

  const isLeave = !!(shift.annualLeave || shift.sickDay);
  if (rule.type === "per_shift_flat") {
    if (!isLeave && Number(shift.paid || 0) > 0) {
      return { bonusPay: Number(rule.amount || 0), bonusHours: 0 };
    }
    return { bonusPay: 0, bonusHours: 0 };
  }

  if (rule.type === "night_window") {
    const nh = calcNightHoursForShift(
      shift.start,
      shift.finish,
      rule.start || "22:00",
      rule.end || "06:00",
      isLeave
    );
    if (rule.mode === "per_hour") {
      return { bonusPay: nh * Number(rule.amount || 0), bonusHours: nh };
    }
    if (rule.mode === "per_shift") {
      return { bonusPay: nh > 0 ? Number(rule.amount || 0) : 0, bonusHours: nh };
    }
    if (rule.mode === "per_week") {
      if (nh <= 0 || !perWeekKey) return { bonusPay: 0, bonusHours: nh };
      if (!weekPaidSet.has(perWeekKey)) {
        weekPaidSet.add(perWeekKey);
        return { bonusPay: Number(rule.amount || 0), bonusHours: nh };
      }
      return { bonusPay: 0, bonusHours: nh };
    }
    return { bonusPay: 0, bonusHours: nh };
  }

  return { bonusPay: 0, bonusHours: 0 };
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
    expenseTotal: (a.expenseTotal || 0) + (b.expenseTotal || 0),
    nightOutCount: (a.nightOutCount || 0) + (b.nightOutCount || 0),
    nightOutPay: (a.nightOutPay || 0) + (b.nightOutPay || 0),
    total: (a.total || 0) + (b.total || 0),
  };
}

function processMonthAsWeeks(monthShifts, modeForWeek = "overall") {
  if (!Array.isArray(monthShifts) || monthShifts.length === 0) {
    return { worked: 0, breaks: 0, paid: 0, otHours: 0, basePay: 0, otPay: 0, nightHours: 0, nightPay: 0, expenseTotal: 0, nightOutCount: 0, nightOutPay: 0, total: 0 };
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
      worked: 0, breaks: 0, paid: 0, otHours: 0, basePay: 0, otPay: 0, nightHours: 0, nightPay: 0, expenseTotal: 0, nightOutCount: 0, nightOutPay: 0, total: 0
    });
}

/**
 * mode:
 *  - "overall": aggregate all companies, but weekly OT thresholds still apply per company
 *  - "perCompany": weekly OT threshold applies per company (weekly-mode only)
 *  - "monthOverall": no weekly allocation (daily-mode still uses split; weekly-mode treated as base, BH as OT)
 */
function processShifts(group, mode = "overall") {
  const arr = Array.isArray(group) ? [...group] : [];

  let totalWorked = 0, totalBreaks = 0, totalPaid = 0;
  let totalOTHours = 0, basePay = 0, otPay = 0;

  let nightHoursTotal = 0;
  let nightPayTotal = 0;
  let expenseTotal = 0;
  let nightOutCountTotal = 0;
  let nightOutPayTotal = 0;
  const nightWeeklyPaid = new Set();
  const weeklyAllocationsByCompany = {};

  const weeklyCompanyIds = [...new Set(arr
    .filter(s => {
      const company = getCompanyById(s.companyId);
      const payMode = s?.overrides?.payMode ?? company?.payMode ?? "weekly";
      return payMode === "weekly";
    })
    .map(s => String(s.companyId || ""))
    .filter(Boolean)
  )];

  weeklyCompanyIds.forEach(companyId => {
    weeklyAllocationsByCompany[companyId] = buildWeeklyOvertimeAllocations(arr, companyId);
  });

  // Normalize + totals + recompute base/ot split to avoid stale stored values
  arr.forEach(s => {
    totalWorked += Number(s.worked || 0);
    totalBreaks += Number(s.breaks || 0);
    totalPaid += Number(s.paid || 0);
    expenseTotal += Number(s.expenses?.parking || 0) + Number(s.expenses?.tolls || 0);
    nightOutCountTotal += Number(s.nightOutCount || (s.nightOut ? 1 : 0) || 0);
    nightOutPayTotal += Number(s.nightOutPay || 0);
    const allocation = getShiftPayAllocation(s, weeklyAllocationsByCompany[String(s.companyId || "")]);
    s.baseHours = allocation.baseHours;
    s.otHours = allocation.otHours;
  });

  // Month mode = sum per-shift pricing (no weekly allocation across month)
  if (mode === "monthOverall") {
    const nightWeeklyPaidMonth = new Set();

    arr.forEach(s => {
      const profile = getShiftRateProfile(s);
      const allocation = getShiftPayAllocation(s, weeklyAllocationsByCompany[String(s.companyId || "")]);
      const company = getCompanyById(s.companyId);
      const wk = getWeekStartMonday(s.date || "");
      const key = `${wk}|${String(s.companyId || "")}`;
      const bonus = calcBonusForShift(s, company, nightWeeklyPaidMonth, key);
      nightHoursTotal += Number(bonus.bonusHours || 0);
      nightPayTotal += Number(bonus.bonusPay || 0);
      const baseH = Number(allocation.baseHours || 0);
      const otH = Number(allocation.otHours || 0);
      basePay += baseH * profile.baseRate;
      otPay += otH * profile.baseRate * Number(allocation.otMultiplier || 1);
      totalOTHours += otH;
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
      expenseTotal,
      nightOutCount: nightOutCountTotal,
      nightOutPay: nightOutPayTotal,
      total: basePay + otPay + nightPayTotal + nightOutPayTotal
    };
  }

  // Sort for predictable weekly allocation
  arr.sort((a, b) => {
    const ad = (a.date || "").localeCompare(b.date || "");
    if (ad !== 0) return ad;
    return (a.start || "").localeCompare(b.start || "");
  });

  arr.forEach(s => {
    const profile = getShiftRateProfile(s);
    const company = getCompanyById(s.companyId);
    const allocation = getShiftPayAllocation(s, weeklyAllocationsByCompany[String(s.companyId || "")]);

    const bonusWeekKey = String(s.companyId || "");
    const bonus = calcBonusForShift(s, company, nightWeeklyPaid, bonusWeekKey);
    nightHoursTotal += Number(bonus.bonusHours || 0);
    nightPayTotal += Number(bonus.bonusPay || 0);
    const baseH = Number(allocation.baseHours || 0);
    const otH = Number(allocation.otHours || 0);
    basePay += baseH * profile.baseRate;
    otPay += otH * profile.baseRate * Number(allocation.otMultiplier || 1);
    totalOTHours += otH;
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
    expenseTotal,
    nightOutCount: nightOutCountTotal,
    nightOutPay: nightOutPayTotal,
    total: basePay + otPay + nightPayTotal + nightOutPayTotal
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

function getCurrentFourWeekRange() {
  const anchor = dateOnlyToDate(getSummaryFourWeekCycleStart());
  anchor.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today - anchor) / (1000 * 60 * 60 * 24));
  const blockIndex = Math.floor(diffDays / 28);
  const start = addDays(anchor, blockIndex * 28);
  start.setHours(0, 0, 0, 0);

  const endExclusive = addDays(start, 28);
  endExclusive.setHours(0, 0, 0, 0);

  const endInclusive = addDays(start, 27);
  endInclusive.setHours(23, 59, 59, 999);

  return {
    start,
    endExclusive,
    endInclusive,
    startStr: start.toISOString().slice(0, 10),
    endStr: endInclusive.toISOString().slice(0, 10)
  };
}

function getCurrentPeriodRangeLabel(mode) {
  if (mode !== "four_week") return "";
  const r = getCurrentFourWeekRange();
  return `${formatUkDate(r.startStr)} to ${formatUkDate(r.endStr)}`;
}

function getSummaryCycleCompany() {
  ensureDefaultCompany();
  const defaultId = getDefaultCompanyId();
  return getCompanyById(defaultId) || getSelectableCompanies()[0] || companies[0] || null;
}

function getSummaryFourWeekCycleStart() {
  return String(getSummaryCycleCompany()?.fourWeekCycleStart || FOUR_WEEK_BLOCK_ANCHOR);
}

function validateCompanyCycleStartDate(input) {
  const el = input || document.getElementById("companyFourWeekCycleStart");
  if (!el) return true;
  if ((document.getElementById("companyPayCycle")?.value || "weekly") !== "four_week") return true;
  const value = String(el.value || "").trim();
  if (!value) return true;
  if (dateOnlyToDate(value).getDay() === 1) return true;
  alert("4-week cycle start date must be a Monday.");
  el.value = "";
  el.focus();
  return false;
}

const TILE_SPECS = {
  worked: { label: "Worked", type: "hours" },
  breaks: { label: "Breaks", type: "hours" },
  paid: { label: "Paid", type: "hours" },
  baseHours: { label: "Base Hours", type: "hours" },
  otHours: { label: "OT Hours", type: "hours" },
  basePay: { label: "Base Pay", type: "money" },
  otPay: { label: "OT Pay", type: "money" },
  nightPay: { label: "Bonus Pay", type: "money" },
  nightOutPay: { label: "Night Out Pay", type: "money" },
  expenseTotal: { label: "Expenses", type: "money" },
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
  const nightOutPay = Number(result.nightOutPay || 0);
  const expenseTotal = Number(result.expenseTotal || 0);
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
    nightOutPay,
    expenseTotal,
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
  if (isSummaryPage) syncSummaryPeriodModeUI();
  const currentPeriodMode = isSummaryPage ? getSummaryPeriodMode() : getHomePeriodMode();
  const weekOrder = isSummaryPage
    ? ["worked", "paid", "baseHours", "basePay", "otHours", "otPay", "breaks", "nightPay", "nightOutPay", "expenseTotal", "total"]
    : ["worked", "otHours", "basePay", "otPay", "nightPay", "total"];
  const monthOrder = isSummaryPage
    ? ["worked", "paid", "baseHours", "basePay", "otHours", "otPay", "breaks", "nightPay", "nightOutPay", "expenseTotal", "total"]
    : ["worked", "otHours", "basePay", "otPay", "nightPay", "total"];

  const weekStart = getCurrentWeekStartMonday();
  const weekEnd = addDays(weekStart, 7);

  const weekShifts = shifts.filter(s => {
    const d = dateOnlyToDate(s.date);
    return d >= weekStart && d < weekEnd;
  });

  const weekResult = processShifts(weekShifts, "overall");
  renderBreakdownTiles("thisWeekTiles", "", weekResult, weekOrder);

  let monthShifts = [];
  if (currentPeriodMode === "four_week") {
    const r = getCurrentFourWeekRange();
    monthShifts = shifts.filter(s => {
      const d = dateOnlyToDate(s.date);
      return d >= r.start && d < r.endExclusive;
    });
  } else {
    const ym = new Date().toISOString().slice(0, 7);
    monthShifts = shifts.filter(s => (s.date || "").slice(0, 7) === ym);
  }

  const monthResult = processMonthAsWeeks(monthShifts, "overall");
  renderBreakdownTiles("thisMonthTiles", "", monthResult, monthOrder);

  const homeHeading = document.getElementById("homeCurrentPeriodHeading");
  const homeRange = document.getElementById("homeCurrentPeriodRange");
  if (homeHeading) {
    homeHeading.textContent = currentPeriodMode === "four_week" ? "Current 4-Week Block" : "This Month";
  }
  if (homeRange) {
    homeRange.textContent = getCurrentPeriodRangeLabel(currentPeriodMode);
  }

  if (!isSummaryPage) {
    const annualTiles = document.getElementById("homeAnnualStatsTiles");
    const stats = getYearlyLeaveStats(new Date().getFullYear());
    const remainingText = getLeaveBalanceText(stats.remaining);
    if (annualTiles) {
      annualTiles.innerHTML = `
        <div class="tile"><div class="label">Leave Allowance</div><div class="value">${Number(stats.allowance || 0).toFixed(0)} days</div></div>
        <div class="tile"><div class="label">Lieu Earned</div><div class="value">${Number(stats.lieuDaysEarned || 0).toFixed(0)} days</div></div>
        <div class="tile"><div class="label">Leave Taken</div><div class="value">${Number(stats.annualLeaveTaken || 0).toFixed(0)} days</div></div>
        <div class="tile"><div class="label">Sick Days Taken</div><div class="value">${Number(stats.sickDaysTaken || 0).toFixed(0)} days</div></div>
        <div class="tile"><div class="label">Leave Balance</div><div class="value">${remainingText}</div></div>
      `;
    }
  }
}

function getYearlyLeaveStats(year = new Date().getFullYear()) {
  ensureDefaultCompany();
  const y = Number(year || new Date().getFullYear());
  const inYear = shifts.filter(s => Number((s.date || "").slice(0, 4)) === y);
  const annualLeaveTaken = inYear.filter(s => !!s.annualLeave).length;
  const sickDaysTaken = inYear.filter(s => !!s.sickDay).length;
  const lieuDaysEarned = inYear.filter(s => !!s.dayOffInLieu).length;
  const allowance = getSelectableCompanies()
    .reduce((sum, company) => sum + Number(company?.annualLeaveAllowance || 0), 0);
  const available = allowance + lieuDaysEarned;
  const remaining = available - annualLeaveTaken;

  return { year: y, annualLeaveTaken, sickDaysTaken, lieuDaysEarned, allowance, available, remaining };
}

function getLeaveBalanceText(balance) {
  const value = Number(balance || 0);
  return value >= 0
    ? `${value.toFixed(0)} days remaining`
    : `${Math.abs(value).toFixed(0)} days over allowance`;
}

function renderLeaveStats() {
  const el = document.getElementById("leaveStats");
  if (!el) return;

  const stats = getYearlyLeaveStats(new Date().getFullYear());
  const remText = getLeaveBalanceText(stats.remaining);

  el.innerHTML = `
    <div class="grid">
      <div class="tile"><div class="label">Year</div><div class="value">${stats.year}</div></div>
      <div class="tile"><div class="label">Annual Leave Allowance</div><div class="value">${Number(stats.allowance).toFixed(0)} days</div></div>
      <div class="tile"><div class="label">Lieu Days Earned</div><div class="value">${Number(stats.lieuDaysEarned || 0).toFixed(0)} days</div></div>
      <div class="tile"><div class="label">Annual Leave Taken</div><div class="value">${Number(stats.annualLeaveTaken).toFixed(0)} days</div></div>
      <div class="tile"><div class="label">Annual Leave Balance</div><div class="value">${escapeHtml(remText)}</div></div>
      <div class="tile"><div class="label">Sick Days Taken</div><div class="value">${Number(stats.sickDaysTaken).toFixed(0)} days</div></div>
    </div>
  `;
}

/* ===============================
   COMPANY SUMMARY (collapsible)
================================ */

function renderCompanySummary() {
  const container = document.getElementById("companySummary");
  if (!container) return;

  ensureDefaultCompany();
  const isSummaryPage = !!document.getElementById("panelWeek");
  const summaryMode = isSummaryPage ? getSummaryPeriodMode() : getHomePeriodMode();
  const monthLabel = summaryMode === "four_week" ? "Current 4-Week Block" : "This Month";
  const monthRangeLabel = getCurrentPeriodRangeLabel(summaryMode);
  const monthHeaderLabel = monthRangeLabel ? `${monthLabel} (${monthRangeLabel})` : monthLabel;

  const weekStart = getCurrentWeekStartMonday();
  const weekEnd = addDays(weekStart, 7);

  const weekShifts = shifts.filter(s => {
    const d = dateOnlyToDate(s.date);
    return d >= weekStart && d < weekEnd;
  });

  let monthShifts = [];
  if (summaryMode === "four_week") {
    const r = getCurrentFourWeekRange();
    monthShifts = shifts.filter(s => {
      const d = dateOnlyToDate(s.date);
      return d >= r.start && d < r.endExclusive;
    });
  } else {
    const ym = new Date().toISOString().slice(0, 7);
    monthShifts = shifts.filter(s => (s.date || "").slice(0, 7) === ym);
  }

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
    container.innerHTML = `<div class="shift-card">No company data yet for this week/${escapeHtml(monthLabel.toLowerCase())}.</div>`;
    return;
  }

  const line = (label, r) => {
    const paid = Number(r.paid || 0);
    const otH = Number(r.otHours || 0);
    const baseH = Math.max(0, paid - otH);

    return `
      <div class="shift-card" style="margin-top:12px;">
        <strong>${escapeHtml(label)}</strong>${monthRangeLabel && label === monthLabel ? `<div class="small" style="margin-top:4px;">${escapeHtml(monthRangeLabel)}</div>` : ""}<br>
        Worked: ${Number(r.worked || 0).toFixed(2)} hrs<br>
        Breaks: ${Number(r.breaks || 0).toFixed(2)} hrs<br>
        Paid: ${paid.toFixed(2)} hrs<br>
        Base Hours: ${baseH.toFixed(2)} hrs<br>
        OT Hours: ${otH.toFixed(2)} hrs<br>
        Bonus Pay: £${Number(r.nightPay || 0).toFixed(2)}<br>
        Night Out Pay: £${Number(r.nightOutPay || 0).toFixed(2)} (${Number(r.nightOutCount || 0).toFixed(0)} nights)<br>
        Expenses: £${Number(r.expenseTotal || 0).toFixed(2)}<br>
        Base Pay: £${Number(r.basePay || 0).toFixed(2)}<br>
        OT Pay: £${Number(r.otPay || 0).toFixed(2)}<br>
        Total: £${Number(r.total || 0).toFixed(2)}<br>
        Net After Expenses: £${(Number(r.total || 0) - Number(r.expenseTotal || 0)).toFixed(2)}
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
          <span class="small">Week £${Number(w.total || 0).toFixed(2)} • ${escapeHtml(monthHeaderLabel)} £${Number(m.total || 0).toFixed(2)}</span>
        </div>
        <div class="week-content" id="cmp-${cid}" style="display:none;">
          ${line("This Week", w)}
          ${line(monthLabel, m)}
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

function getDefaultVariableBreakRules() {
  return [
    { afterWorkedHours: 6, breakHours: 0.5 },
    { afterWorkedHours: 9, breakHours: 1 }
  ];
}

function createBreakRuleRow(rule = {}, canRemove = true) {
  const afterWorkedHours = clamp0(rule.afterWorkedHours);
  const breakHours = clamp0(rule.breakHours);
  return `
    <div class="grid break-rule-row" style="margin-top:10px;">
      <div>
        <label style="margin-top:0;">After Worked Hours</label>
        <input type="number" class="break-rule-threshold" step="0.25" min="0" value="${afterWorkedHours > 0 ? escapeHtml(String(afterWorkedHours)) : ""}" placeholder="e.g. 6">
      </div>
      <div>
        <label style="margin-top:0;">Break Hours</label>
        <input type="number" class="break-rule-hours" step="0.25" min="0" value="${breakHours > 0 ? escapeHtml(String(breakHours)) : ""}" placeholder="e.g. 0.5">
      </div>
      <div style="display:flex; align-items:end;">
        ${canRemove ? `<button type="button" class="button-secondary break-rule-remove" style="width:auto;">Remove</button>` : ""}
      </div>
    </div>
  `;
}

function readBreakRuleEntries() {
  const wrap = document.getElementById("breakRuleList");
  if (!wrap) return [];
  return normalizeBreakRules([...wrap.querySelectorAll(".break-rule-row")].map(row => ({
    afterWorkedHours: Number(row.querySelector(".break-rule-threshold")?.value || 0),
    breakHours: Number(row.querySelector(".break-rule-hours")?.value || 0)
  })));
}

function renderBreakRuleEntries(entries = [], options = {}) {
  const wrap = document.getElementById("breakRuleList");
  if (!wrap) return;
  let normalized = normalizeBreakRules(entries);
  const requestedCount = Math.max(
    Number(options.requestedCount || 0),
    normalized.length,
    options.preserveEmpty === false ? 0 : (normalized.length ? normalized.length : getDefaultVariableBreakRules().length)
  );
  if (!normalized.length && options.preserveEmpty !== false) normalized = getDefaultVariableBreakRules();
  while (normalized.length < requestedCount) normalized.push({ afterWorkedHours: 0, breakHours: 0 });
  wrap.innerHTML = normalized
    .map((rule, index) => createBreakRuleRow(rule, normalized.length > 1 || index > 0))
    .join("");
}

function addBreakRuleEntry() {
  const entryCount = Math.max(document.querySelectorAll("#breakRuleList .break-rule-row").length, getDefaultVariableBreakRules().length) + 1;
  renderBreakRuleEntries(readBreakRuleEntries(), { preserveEmpty: true, requestedCount: entryCount });
}

function initBreakRuleBehavior() {
  const wrap = document.getElementById("breakRuleList");
  if (!wrap) return;
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".break-rule-remove");
    if (!btn) return;
    const rows = [...wrap.querySelectorAll(".break-rule-row")];
    const idx = rows.indexOf(btn.closest(".break-rule-row"));
    if (idx < 0) return;
    const entries = readBreakRuleEntries();
    entries.splice(idx, 1);
    renderBreakRuleEntries(entries, { preserveEmpty: true, requestedCount: Math.max(rows.length - 1, 1) });
    updateLeavePaidHoursPreview();
  });
}

function getCompanyFormPreviewSource() {
  return {
    standardShiftLength: Number(document.getElementById("standardShiftLength")?.value || 0),
    breakRuleMode: document.getElementById("breakRuleMode")?.value === "variable" ? "variable" : "fixed",
    fixedBreakHours: Number(document.getElementById("fixedBreakHours")?.value || 0),
    breakRules: readBreakRuleEntries()
  };
}

function updateLeavePaidHoursPreview() {
  const el = document.getElementById("leavePaidHoursPreview");
  if (!el) return;
  const source = getCompanyFormPreviewSource();
  const standardShiftLength = clamp0(source.standardShiftLength);
  if (standardShiftLength <= 0) {
    el.textContent = "Current leave/sick paid hours: enter a standard shift length.";
    return;
  }
  const breakHours = getBreakHoursForWorked(standardShiftLength, source);
  const paidHours = getLeavePaidHours(source);
  el.textContent = `Current leave/sick paid hours: ${paidHours.toFixed(2)} hrs (${standardShiftLength.toFixed(2)} - ${breakHours.toFixed(2)} break).`;
}

function updateCompanyFormVisibility() {
  const payModeEl = document.getElementById("payMode");
  const overtimeSchemeEl = document.getElementById("overtimeScheme");
  const payCycleEl = document.getElementById("companyPayCycle");
  const bonusTypeEl = document.getElementById("bonusType");
  const breakRuleModeEl = document.getElementById("breakRuleMode");
  if (!payModeEl && !payCycleEl && !bonusTypeEl && !breakRuleModeEl && !overtimeSchemeEl) return; // not on companies page

  const dailyOTRow = document.getElementById("dailyOtFields") || document.getElementById("dailyOTRow");
  const fourWeekCycleWrap = document.getElementById("companyFourWeekCycleWrap");
  const bonusModeWrap = document.getElementById("bonusModeWrap");
  const bonusWindow = document.getElementById("bonusWindow");
  const bonusModeEl = document.getElementById("bonusMode");
  const bonusAmountLabel = document.getElementById("bonusAmountLabel");
  const fixedBreakWrap = document.getElementById("fixedBreakWrap");
  const variableBreakWrap = document.getElementById("variableBreakWrap");
  const overtimeHelpEl = document.getElementById("overtimeSchemeHelp");
  const overtimeHeadingEl = document.getElementById("overtimeMultipliersHeading");
  const overtimeGridEl = document.getElementById("overtimeMultipliersGrid");
  const otWeekdayField = document.getElementById("otWeekdayField");
  const otSaturdayField = document.getElementById("otSaturdayField");
  const otSundayField = document.getElementById("otSundayField");
  const otBankHolidayField = document.getElementById("otBankHolidayField");
  const otWeekdayLabel = document.getElementById("otWeekdayLabel");
  const otSaturdayLabel = document.getElementById("otSaturdayLabel");
  const otSundayLabel = document.getElementById("otSundayLabel");
  const otBankHolidayLabel = document.getElementById("otBankHolidayLabel");

  const setVisible = (el, isVisible) => {
    if (!el) return;
    el.hidden = !isVisible;
    el.style.display = isVisible ? "" : "none";
  };

  const payMode = payModeEl?.value === "daily" ? "daily" : "weekly";
  if (overtimeSchemeEl) {
    [...overtimeSchemeEl.options].forEach(option => {
      const isWorkedDaySequence = option.value === "worked_day_sequence";
      option.hidden = payMode === "daily" && isWorkedDaySequence;
    });
    overtimeSchemeEl.value = normalizeOvertimeScheme(overtimeSchemeEl.value, payMode);
  }
  const overtimeScheme = normalizeOvertimeScheme(overtimeSchemeEl?.value || "day_type", payMode);

  setVisible(dailyOTRow, payModeEl?.value === "daily" && overtimeScheme !== "none");
  setVisible(fourWeekCycleWrap, payCycleEl?.value === "four_week");

  const bonusType = bonusTypeEl?.value || "none";
  const bonusMode = bonusModeEl?.value || "per_hour";
  setVisible(bonusModeWrap, bonusType === "night_window");
  setVisible(bonusWindow, bonusType === "night_window" && bonusMode === "per_hour");
  const breakRuleMode = breakRuleModeEl?.value || "fixed";
  setVisible(fixedBreakWrap, breakRuleMode === "fixed");
  setVisible(variableBreakWrap, breakRuleMode === "variable");
  if (breakRuleMode === "variable" && variableBreakWrap && !document.querySelector("#breakRuleList .break-rule-row")) {
    renderBreakRuleEntries(getDefaultVariableBreakRules(), { preserveEmpty: true });
  }
  if (breakRuleMode === "fixed" && fixedBreakWrap && !String(document.getElementById("fixedBreakHours")?.value || "").trim()) {
    const fixedInput = document.getElementById("fixedBreakHours");
    if (fixedInput) fixedInput.value = "1";
  }
  setVisible(overtimeHeadingEl, overtimeScheme !== "none");
  setVisible(overtimeGridEl, overtimeScheme !== "none");
  setVisible(otWeekdayField, overtimeScheme !== "none");
  setVisible(otBankHolidayField, overtimeScheme !== "none");
  setVisible(otSaturdayField, overtimeScheme === "day_type" || overtimeScheme === "worked_day_sequence");
  setVisible(otSundayField, overtimeScheme === "day_type" || overtimeScheme === "worked_day_sequence");
  if (otWeekdayLabel) {
    otWeekdayLabel.textContent = overtimeScheme === "flat_rate"
      ? "OT Multiplier"
      : (overtimeScheme === "worked_day_sequence" ? "Days 1-5 OT" : "Mon–Fri");
  }
  if (otSaturdayLabel) {
    otSaturdayLabel.textContent = overtimeScheme === "worked_day_sequence" ? "Day 6" : "Saturday";
  }
  if (otSundayLabel) {
    otSundayLabel.textContent = overtimeScheme === "worked_day_sequence" ? "Day 7" : "Sunday";
  }
  if (otBankHolidayLabel) {
    otBankHolidayLabel.textContent = "Bank Holiday";
  }
  if (overtimeHelpEl) {
    if (overtimeScheme === "worked_day_sequence") {
      overtimeHelpEl.textContent = "Counts unique worked dates Monday to Sunday. Days 1-5 use weekly base-hour overtime, day 6 pays the whole shift at the Day 6 multiplier, and day 7 or bank holiday pays the whole shift at the Bank Holiday multiplier.";
    } else if (overtimeScheme === "flat_rate") {
      overtimeHelpEl.textContent = "All overtime hours use one multiplier, with a separate bank holiday multiplier if needed.";
    } else if (overtimeScheme === "none") {
      overtimeHelpEl.textContent = "No overtime premium is applied. All paid hours stay at base rate.";
    } else {
      overtimeHelpEl.textContent = "Uses separate overtime multipliers by weekday, Saturday, Sunday, and bank holiday.";
    }
  }
  if (bonusAmountLabel) {
    if (bonusType === "night_window" && bonusMode === "per_hour") {
      bonusAmountLabel.textContent = "Bonus Amount Per Hour (£)";
    } else {
      bonusAmountLabel.textContent = "Bonus Amount (£)";
    }
  }
  updateLeavePaidHoursPreview();
}

document.addEventListener("change", (e) => {
  if (e.target?.id === "payMode" || e.target?.id === "overtimeScheme" || e.target?.id === "companyPayCycle" || e.target?.id === "bonusType" || e.target?.id === "bonusMode" || e.target?.id === "breakRuleMode") {
    updateCompanyFormVisibility();
  }
});

document.addEventListener("input", (e) => {
  if (e.target?.id === "standardShiftLength" || e.target?.id === "fixedBreakHours" || e.target?.matches?.(".break-rule-threshold") || e.target?.matches?.(".break-rule-hours")) {
    updateLeavePaidHoursPreview();
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
          Bonus Pay: £${Number(r.nightPay || 0).toFixed(2)}<br>
          Night Out Pay: £${Number(r.nightOutPay || 0).toFixed(2)} (${Number(r.nightOutCount || 0).toFixed(0)} nights)<br>
          Expenses: £${Number(r.expenseTotal || 0).toFixed(2)}<br>
          Base: £${Number(r.basePay || 0).toFixed(2)}<br>
          OT: £${Number(r.otPay || 0).toFixed(2)}<br>
          Total: £${Number(r.total || 0).toFixed(2)}<br>
          Net: £${(Number(r.total || 0) - Number(r.expenseTotal || 0)).toFixed(2)}
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
          Bonus Pay: £${Number(r.nightPay || 0).toFixed(2)}<br>
          Night Out Pay: £${Number(r.nightOutPay || 0).toFixed(2)} (${Number(r.nightOutCount || 0).toFixed(0)} nights)<br>
          Expenses: £${Number(r.expenseTotal || 0).toFixed(2)}<br>
          Base: £${Number(r.basePay || 0).toFixed(2)}<br>
          OT: £${Number(r.otPay || 0).toFixed(2)}<br>
          Total: £${Number(r.total || 0).toFixed(2)}<br>
          Net: £${(Number(r.total || 0) - Number(r.expenseTotal || 0)).toFixed(2)}
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

function toDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildShiftDateMap() {
  const byDate = new Map();
  shifts.forEach((s, idx) => {
    const date = String(s.date || "");
    if (!date) return;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ shift: s, index: idx });
  });

  byDate.forEach((list) => {
    list.sort((a, b) => (a.shift.start || "").localeCompare(b.shift.start || ""));
  });
  return byDate;
}

function getDayStatusClass(entries) {
  const list = Array.isArray(entries) ? entries.map(e => e.shift || e) : [];
  if (!list.length) return "";
  if (list.some(s => s.sickDay)) return "day--sick";
  if (list.some(s => s.annualLeave)) return "day--leave";
  if (list.some(s => s.bankHoliday)) return "day--bank-holiday";
  return "day--work";
}

function syncShiftsPagePickers() {
  const monthEl = document.getElementById("shiftMonthPicker");
  if (monthEl) monthEl.value = shiftsPageState.monthValue;
}

function getFirstShiftDateInMonth(byDate, monthValue) {
  if (!/^\d{4}-\d{2}$/.test(String(monthValue || ""))) return "";
  const monthStart = dateOnlyToDate(`${monthValue}-01`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  for (let d = new Date(monthStart); d <= monthEnd; d = addDays(d, 1)) {
    const key = toDateKey(d);
    if ((byDate.get(key) || []).length) return key;
  }
  return toDateKey(monthStart);
}

function initShiftsCalendarPageControls() {
  const calendarEl = document.getElementById("shiftCalendar");
  if (!calendarEl || shiftsPageState.initialized) return;

  const today = new Date();
  const todayKey = toDateKey(today);
  const savedReturn = loadShiftCalendarReturnState();
  shiftsPageState.selectedDate = shiftsPageState.selectedDate || todayKey;
  shiftsPageState.monthValue = shiftsPageState.monthValue || todayKey.slice(0, 7);
  if (savedReturn) {
    shiftsPageState.monthValue = savedReturn.monthValue;
    shiftsPageState.selectedDate = savedReturn.date;
    shiftsPageState.selectedShiftId = savedReturn.shiftId;
    shiftsPageState.shouldFocusSelectedShift = !!savedReturn.shiftId;
    showShiftSaveBanner(savedReturn.action === "updated" ? "Shift Updated" : "Shift Added");
  }
  const monthEl = document.getElementById("shiftMonthPicker");

  if (monthEl) {
    monthEl.addEventListener("change", () => {
      const monthVal = String(monthEl.value || "");
      if (!/^\d{4}-\d{2}$/.test(monthVal)) return;
      shiftsPageState.monthValue = monthVal;
      shiftsPageState.selectedShiftId = "";
      shiftsPageState.shouldFocusSelectedShift = false;
      const byDate = buildShiftDateMap();
      shiftsPageState.selectedDate = getFirstShiftDateInMonth(byDate, shiftsPageState.monthValue);
      renderShiftsCalendarPage();
    });
  }

  shiftsPageState.initialized = true;
}

function loadShiftCalendarReturnState() {
  const raw = String(localStorage.getItem(SHIFT_CALENDAR_RETURN_KEY) || "").trim();
  if (!raw) return null;
  localStorage.removeItem(SHIFT_CALENDAR_RETURN_KEY);

  try {
    const data = JSON.parse(raw);
    const date = String(data?.date || "").trim();
    const monthValue = String(data?.monthValue || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!/^\d{4}-\d{2}$/.test(monthValue)) return null;
    return {
      action: (data?.action === "updated") ? "updated" : "added",
      shiftId: String(data?.shiftId || "").trim(),
      date,
      monthValue
    };
  } catch {
    return null;
  }
}

function showShiftSaveBanner(message) {
  const text = String(message || "").trim();
  if (!text) return;

  const existing = document.getElementById("shiftSaveBanner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "shiftSaveBanner";
  banner.setAttribute("role", "status");
  banner.className = "update-banner";

  const msg = document.createElement("div");
  msg.textContent = text;

  const actions = document.createElement("div");
  actions.className = "update-actions";

  const btnDismiss = document.createElement("button");
  btnDismiss.className = "button-secondary";
  btnDismiss.textContent = "OK";
  btnDismiss.onclick = () => banner.remove();

  actions.appendChild(btnDismiss);
  banner.appendChild(msg);
  banner.appendChild(actions);

  document.body.appendChild(banner);

  setTimeout(() => {
    banner.remove();
  }, 4000);
}

function renderShiftCalendarCell(dateStr, entries, isOutsideMonth = false) {
  const selected = shiftsPageState.selectedDate === dateStr;
  const today = toDateKey(new Date()) === dateStr;
  const statusClass = getDayStatusClass(entries);
  const num = Number(dateStr.slice(-2));

  return `
    <button type="button"
      class="shift-day ${statusClass} ${isOutsideMonth ? "is-outside" : ""} ${selected ? "is-selected" : ""} ${today ? "is-today" : ""}"
      onclick="selectShiftCalendarDate('${escapeHtml(dateStr)}')">
      <div class="shift-day-num">${num}</div>
    </button>
  `;
}

function renderShiftsCalendarGrid(byDate) {
  const calendarEl = document.getElementById("shiftCalendar");
  if (!calendarEl) return;

  const headers = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const headHtml = headers.map(h => `<div class="shift-calendar-head">${h}</div>`).join("");
  let dayHtml = "";

  const monthStart = dateOnlyToDate(`${shiftsPageState.monthValue}-01`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const startOffset = (monthStart.getDay() + 6) % 7; // Monday index
  const endOffset = 6 - ((monthEnd.getDay() + 6) % 7);
  const gridStart = addDays(monthStart, -startOffset);
  const gridEnd = addDays(monthEnd, endOffset);

  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
    const key = toDateKey(d);
    dayHtml += renderShiftCalendarCell(key, byDate.get(key) || [], d.getMonth() !== monthStart.getMonth());
  }

  calendarEl.innerHTML = `<div class="shift-calendar">${headHtml}${dayHtml}</div>`;
}

function renderSelectedShiftDateDetails(byDate) {
  const detailsEl = document.getElementById("shiftDayDetails");
  if (!detailsEl) return;

  const selected = shiftsPageState.selectedDate || toDateKey(new Date());
  const entries = byDate.get(selected) || [];
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(dateOnlyToDate(selected));

  if (!entries.length) {
    detailsEl.innerHTML = `
      <h2 style="margin-top:16px;">${escapeHtml(dateLabel)}</h2>
      <div class="shift-card">
        <div>No shifts stored for this date.</div>
        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="button-secondary" style="width:auto;" onclick="startNewShiftForDate('${escapeHtml(selected)}')">Add Shift For This Date</button>
          <button class="button-secondary" style="width:auto;" onclick="quickAddCalendarDay('${escapeHtml(selected)}', 'annualLeave')">Add Annual Leave</button>
          <button class="button-secondary" style="width:auto;" onclick="quickAddCalendarDay('${escapeHtml(selected)}', 'sickDay')">Add Sick Day</button>
        </div>
      </div>
    `;
    return;
  }

  detailsEl.innerHTML = `
    <div class="shift-day-details">
      <div style="margin-top:16px; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
        <h2 style="margin:0;">${escapeHtml(dateLabel)}</h2>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="button-secondary" style="width:auto;" onclick="startNewShiftForDate('${escapeHtml(selected)}')">Add Shift For This Date</button>
          <button class="button-secondary" style="width:auto;" onclick="quickAddCalendarDay('${escapeHtml(selected)}', 'annualLeave')">Add Annual Leave</button>
          <button class="button-secondary" style="width:auto;" onclick="quickAddCalendarDay('${escapeHtml(selected)}', 'sickDay')">Add Sick Day</button>
        </div>
      </div>
      ${entries.map(entry => formatShiftLine(entry.shift, entry.index)).join("")}
    </div>
  `;

  if (!shiftsPageState.selectedShiftId) return;

  const selectedCard = detailsEl.querySelector(`[data-shift-id="${CSS.escape(shiftsPageState.selectedShiftId)}"]`);
  if (!selectedCard) return;

  if (shiftsPageState.shouldFocusSelectedShift) {
    selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
    shiftsPageState.shouldFocusSelectedShift = false;
  }
}

function renderShiftsCalendarPage() {
  if (!document.getElementById("shiftCalendar")) return;
  initShiftsCalendarPageControls();
  const byDate = buildShiftDateMap();
  if (!String(shiftsPageState.selectedDate || "").startsWith(`${shiftsPageState.monthValue}-`)) {
    shiftsPageState.selectedDate = getFirstShiftDateInMonth(byDate, shiftsPageState.monthValue);
    shiftsPageState.selectedShiftId = "";
    shiftsPageState.shouldFocusSelectedShift = false;
  }

  syncShiftsPagePickers();
  renderShiftsCalendarGrid(byDate);
  renderSelectedShiftDateDetails(byDate);
}

function selectShiftCalendarDate(dateStr) {
  shiftsPageState.selectedDate = String(dateStr || "");
  shiftsPageState.selectedShiftId = "";
  shiftsPageState.shouldFocusSelectedShift = false;
  const d = dateOnlyToDate(shiftsPageState.selectedDate);
  if (!Number.isNaN(d.getTime())) {
    shiftsPageState.monthValue = shiftsPageState.selectedDate.slice(0, 7);
  }
  renderShiftsCalendarPage();
}

function formatUkDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return String(dateStr || "");
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(dateOnlyToDate(dateStr));
}

function getShiftBonusAllocation(shift) {
  const company = getCompanyById(shift.companyId);
  const rule = getPrimaryBonusRule(company);
  if (!rule || rule.type === "none") return { bonusPay: 0, bonusHours: 0 };

  if (!(rule.type === "night_window" && rule.mode === "per_week")) {
    const wk = getWeekStartMonday(shift.date || "");
    const key = `${wk}|${String(shift.companyId || "")}`;
    return calcBonusForShift(shift, company, new Set(), key);
  }

  const weekStart = getWeekStartMonday(shift.date || "");
  const weekShifts = shifts
    .filter(s => getWeekStartMonday(s.date || "") === weekStart && String(s.companyId || "") === String(shift.companyId || ""))
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.start || "").localeCompare(b.start || "") || String(a.id || "").localeCompare(String(b.id || "")));

  const paidSet = new Set();
  const key = `${weekStart}|${String(shift.companyId || "")}`;
  for (const item of weekShifts) {
    const result = calcBonusForShift(item, company, paidSet, key);
    if (item.id === shift.id) return result;
  }

  return { bonusPay: 0, bonusHours: 0 };
}

function getShiftCompensationDetails(shift) {
  const company = getCompanyById(shift.companyId);
  const profile = getShiftRateProfile(shift);
  const paid = Number(shift.paid || 0);
  const worked = Number(shift.worked || 0);
  const breaks = Number(shift.breaks || 0);
  const weekStart = getWeekStartMonday(shift.date || "");
  const weekShifts = shifts.filter(s =>
    getWeekStartMonday(s.date || "") === weekStart &&
    String(s.companyId || "") === String(shift.companyId || "")
  );
  const weeklyAllocationMap = buildWeeklyOvertimeAllocations(weekShifts, shift.companyId);
  const allocation = getShiftPayAllocation(shift, weeklyAllocationMap);
  const baseHours = Number(allocation.baseHours || 0);
  const otHours = Number(allocation.otHours || 0);
  const otMultiplier = Number(allocation.otMultiplier || 1);

  const basePay = baseHours * profile.baseRate;
  const otPay = otHours * profile.baseRate * otMultiplier;
  const bonus = getShiftBonusAllocation(shift);
  const bonusPay = Number(bonus.bonusPay || 0);
  const expenseParking = Number(shift.expenses?.parking || 0);
  const expenseTolls = Number(shift.expenses?.tolls || 0);
  const expenses = expenseParking + expenseTolls;
  const nightOutPay = Number(shift.nightOutPay || 0);
  const totalEarned = basePay + otPay + bonusPay + nightOutPay;

  return {
    worked,
    paid,
    breaks,
    baseHours,
    basePay,
    otHours,
    otPay,
    bonusPay,
    nightOutPay,
    expenseParking,
    expenseTolls,
    expenses,
    totalEarned
  };
}

function getVehicleEntriesForDisplay(shift) {
  const directEntries = normalizeVehicleEntries(Array.isArray(shift?.vehicleEntries) ? shift.vehicleEntries : []);
  return directEntries.length ? directEntries : normalizeVehicleEntries(buildLegacyVehicleEntries(shift));
}

function getTrailerEntriesForDisplay(shift) {
  const directEntries = normalizeTrailerEntries(Array.isArray(shift?.trailers) ? shift.trailers : []);
  return directEntries.length ? directEntries : normalizeTrailerEntries(buildLegacyTrailerEntries(shift));
}

function formatVehicleEntryLabel(entry) {
  const vehicle = String(entry?.vehicle || "").trim();
  const mileage = Number(entry?.mileage || 0);
  const startMileage = Number(entry?.startMileage || 0);
  const finishMileage = Number(entry?.finishMileage || 0);
  const hasMileage = mileage > 0 || startMileage > 0 || finishMileage > 0;

  if (!hasMileage) return vehicle;

  const detail = (startMileage > 0 || finishMileage > 0)
    ? `Mileage: ${startMileage.toFixed(0)} -> ${finishMileage.toFixed(0)}. Total: ${mileage.toFixed(0)}`
    : `Mileage: ${mileage.toFixed(0)}`;

  return vehicle ? `${vehicle}: ${detail}` : detail;
}

function formatShiftLine(s, index) {
  const companyName = getCompanyById(s.companyId)?.name || "Unknown Company";
  const flags = [s.shiftType === "night" ? "NIGHT" : "", s.annualLeave ? "AL" : "", s.sickDay ? "SICK" : "", s.bankHoliday ? "BH" : "", s.dayOffInLieu ? "TOIL" : ""].filter(Boolean).join(" ");
  const details = getShiftCompensationDetails(s);
  const isSelectedShift = String(shiftsPageState.selectedShiftId || "") === String(s.id || "");
  const defects = (s.defects || "").trim();
  const trailerInfo = getTrailerEntriesForDisplay(s).join(" • ");
  const shiftTypeLabel = s.shiftType === "night" ? "Night" : "Day";
  const timeRange = (s.start && s.finish) ? `${s.start} - ${s.finish}` : "";
  const vehicleEntries = getVehicleEntriesForDisplay(s);
  const vehicleInfoHtml = vehicleEntries.length
    ? vehicleEntries.map(entry => `<div>${escapeHtml(formatVehicleEntryLabel(entry))}</div>`).join("")
    : "";
  const optionalInfo = [
    vehicleInfoHtml ? `<div>Vehicles:${vehicleInfoHtml}</div>` : "",
    trailerInfo ? `<div>Trailers: ${escapeHtml(trailerInfo)}</div>` : "",
    defects ? `<div>Defects/Notes: ${escapeHtml(defects).replaceAll("\n", "<br>")}</div>` : ""
  ].filter(Boolean).join("");

  return `
    <div class="shift-card ${isSelectedShift ? "shift-card-selected" : ""}" data-shift-id="${escapeHtml(String(s.id || ""))}">
      <strong>${escapeHtml(formatUkDate(s.date))}</strong>${flags ? ` <span class="small">(${escapeHtml(flags)})</span>` : ""}
      <div class="meta">
        <div>${escapeHtml(companyName)}</div>
        <div>Shift Type: ${escapeHtml(shiftTypeLabel)}</div>
        ${timeRange ? `<div>Start / Finish: ${escapeHtml(timeRange)}</div>` : ""}
        <div>Worked Hours: ${details.worked.toFixed(2)}</div>
        <div>Paid Hours: ${details.paid.toFixed(2)}</div>
        <div>Hours @ Base Rate: ${details.baseHours.toFixed(2)}</div>
        <div>Pay @ Base Rate: £${details.basePay.toFixed(2)}</div>
        <div>Hours @ Overtime Rate: ${details.otHours.toFixed(2)}</div>
        <div>Pay @ Overtime Rate: £${details.otPay.toFixed(2)}</div>
        <div>Unpaid Break Hrs: ${details.breaks.toFixed(2)}</div>
        <div>Bonus Pay: £${details.bonusPay.toFixed(2)}</div>
        ${details.nightOutPay > 0 ? `<div>Night Out Pay: £${details.nightOutPay.toFixed(2)}</div>` : ""}
        ${details.expenses > 0 ? `<div>Expenses: £${details.expenses.toFixed(2)}${details.expenseParking > 0 || details.expenseTolls > 0 ? ` (Parking £${details.expenseParking.toFixed(2)} • Tolls £${details.expenseTolls.toFixed(2)})` : ""}</div>` : ""}
        <div>Total Earned: £${details.totalEarned.toFixed(2)}</div>
        ${optionalInfo ? `<div style="margin-top:8px;">${optionalInfo}</div>` : ""}
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
  renderShiftsCalendarPage();
}

function startNewShiftForDate(dateStr) {
  const value = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  localStorage.setItem("newShiftDate", value);
  window.location.href = "enter-shift.html";
}

function getDefaultCompanyForCalendarQuickAdd() {
  ensureDefaultCompany();
  const defaultId = getDefaultCompanyId();
  return getCompanyById(defaultId) || getSelectableCompanies()[0] || companies[0] || null;
}

function quickAddCalendarDay(dateStr, kind) {
  const date = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const company = getDefaultCompanyForCalendarQuickAdd();
  if (!company?.id) {
    alert("Add a company first.");
    return;
  }

  const isAnnualLeave = kind === "annualLeave";
  const isSickDay = kind === "sickDay";
  if (!isAnnualLeave && !isSickDay) return;

  const duplicate = shifts.some(s =>
    String(s.date || "") === date &&
    String(s.companyId || "") === String(company.id) &&
    !!s[isAnnualLeave ? "annualLeave" : "sickDay"]
  );
  if (duplicate) {
    alert(isAnnualLeave ? "Annual leave is already recorded for this company on that date." : "A sick day is already recorded for this company on that date.");
    return;
  }

  const leavePaidHours = getLeavePaidHours(company);
  const shift = normalizeShift({
    id: generateShiftId(),
    date,
    companyId: company.id,
    start: "",
    finish: "",
    shiftType: "day",
    vehicleEntries: [],
    trailers: [],
    trailer1: "",
    trailer2: "",
    defects: "",
    notes: "",
    annualLeave: isAnnualLeave,
    sickDay: isSickDay,
    bankHoliday: false,
    dayOffInLieu: false,
    expenses: { parking: 0, tolls: 0 },
    nightOut: false,
    nightOutCount: 0,
    nightOutPay: 0,
    overrides: {},
    createdAt: Date.now()
  });

  const hrs = calculateHours("", "", shift.annualLeave, shift.sickDay, { leavePaidHours });
  shift.worked = hrs.worked;
  shift.breaks = hrs.breaks;
  shift.paid = hrs.paid;
  applyCompanyPaidRules(shift);
  const split = splitPaidIntoBaseAndOT_DailyWorked(shift);
  shift.baseHours = split.baseHours;
  shift.otHours = split.otHours;

  shifts.push(shift);
  saveAll();

  shiftsPageState.monthValue = date.slice(0, 7);
  shiftsPageState.selectedDate = date;
  shiftsPageState.selectedShiftId = shift.id;
  shiftsPageState.shouldFocusSelectedShift = true;
  renderShiftsCalendarPage();
  showShiftSaveBanner(isAnnualLeave ? "Annual Leave Added" : "Sick Day Added");
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
  setVal("shiftType", s.shiftType || "day");
  setVal("expenseParking", s.expenses?.parking || 0);
  setVal("expenseTolls", s.expenses?.tolls || 0);
  setVal("overrideBaseRate", s.overrides?.baseRate);
  setVal("overrideBreakHours", s.overrides?.breakHours);
  setVal("overrideOtWeekday", s.overrides?.otWeekday);
  setVal("overrideOtSaturday", s.overrides?.otSaturday);
  setVal("overrideOtSunday", s.overrides?.otSunday);
  setVal("overrideOtBankHoliday", s.overrides?.otBankHoliday);
  setVal("company", s.companyId);
  applyCompanyShiftEntryVisibility(s.companyId);
  renderAssignedVehicleOptions(s.companyId);
  renderShiftVehicleEntries(s.vehicleEntries, { preserveEmpty: true });
  renderShiftTrailerEntries(s.trailers, { preserveEmpty: true });

  const defectsEl = document.getElementById("defects");
  if (defectsEl) defectsEl.value = (s.defects ?? s.notes ?? "");

  setCheck("annualLeave", s.annualLeave);
  setCheck("sickDay", s.sickDay);
  setCheck("bankHoliday", s.bankHoliday);
  setCheck("dayOffInLieu", s.dayOffInLieu);
  setCheck("nightOut", s.nightOut || Number(s.nightOutCount || 0) > 0 || Number(s.nightOutPay || 0) > 0);
  initNightOutBehavior();
}

function loadShiftDateForNewEntryIfRequested() {
  if (editingIndex !== null) return;

  const date = String(localStorage.getItem("newShiftDate") || "").trim();
  if (!date) return;
  localStorage.removeItem("newShiftDate");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const dateEl = document.getElementById("date");
  if (dateEl) dateEl.value = date;
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
      renderCompanySummary();
      renderCurrentPeriodTiles();
      renderLeaveStats();
      if (typeof renderWeeklyGroupedShifts === "function") renderWeeklyGroupedShifts();
      if (typeof renderShiftsCalendarPage === "function") renderShiftsCalendarPage();
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
          <td class="right">${fmtMoney(r.nightOutPay || 0)}</td>
          <td class="right">${fmtMoney(r.expenseTotal || 0)}</td>
          <td class="right">${fmtMoney(r.basePay)}</td>
          <td class="right">${fmtMoney(r.otPay)}</td>
          <td class="right"><strong>${fmtMoney(r.total)}</strong><div class="small">Net ${fmtMoney((Number(r.total || 0) - Number(r.expenseTotal || 0)))}</div></td>
        </tr>
      `;
    }).join("");

  const shiftRows = rows.map(s => {
    const companyName = getCompanyById(s.companyId)?.name || "Unknown Company";
    const flags = [s.annualLeave ? "AL" : "", s.sickDay ? "SICK" : "", s.bankHoliday ? "BH" : "", s.dayOffInLieu ? "TOIL" : ""].filter(Boolean).join(" ");
    const expenses = Number(s.expenses?.parking || 0) + Number(s.expenses?.tolls || 0);
    const vehicleEntries = getVehicleEntriesForDisplay(s);
    const vehicleCell = vehicleEntries.length
      ? vehicleEntries.map(entry => `<div>${escapeHtml(formatVehicleEntryLabel(entry))}</div>`).join("")
      : "";
    return `
      <tr>
        <td><strong>${escapeHtml(s.date)}</strong>${flags ? `<div class="small">${escapeHtml(flags)}</div>` : ""}</td>
        <td>${escapeHtml(companyName)}</td>
        <td>${escapeHtml(s.start || "")}–${escapeHtml(s.finish || "")}</td>
        <td>${vehicleCell}</td>
        <td class="right">${fmtHours(s.worked)}</td>
        <td class="right">${fmtHours(s.breaks)}</td>
        <td class="right">${fmtHours(s.paid)}</td>
        <td class="right">${fmtMoney(s.nightOutPay || 0)}</td>
        <td class="right">${fmtMoney(expenses)}</td>
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
            <div class="chip">Drivers Logbook</div>
          </div>

          <div class="rule"></div>

          <h2>Overall Summary</h2>
          <div class="grid">
            <div class="kpi"><div class="l">Worked</div><div class="v">${fmtHours(overall.worked)}</div></div>
            <div class="kpi"><div class="l">Breaks</div><div class="v">${fmtHours(overall.breaks)}</div></div>
            <div class="kpi"><div class="l">Paid</div><div class="v">${fmtHours(overall.paid)}</div></div>
            <div class="kpi"><div class="l">OT Hours</div><div class="v">${fmtHours(overall.otHours)}</div></div>

            <div class="kpi"><div class="l">Base Hours</div><div class="v">${fmtHours(baseHours)}</div></div>
            <div class="kpi"><div class="l">Bonus Pay</div><div class="v">${fmtMoney(overall.nightPay || 0)}</div></div>
            <div class="kpi"><div class="l">Night Out Pay</div><div class="v">${fmtMoney(overall.nightOutPay || 0)}</div></div>
            <div class="kpi"><div class="l">Expenses</div><div class="v">${fmtMoney(overall.expenseTotal || 0)}</div></div>
            <div class="kpi"><div class="l">Base Pay</div><div class="v">${fmtMoney(overall.basePay)}</div></div>
            <div class="kpi"><div class="l">OT Pay</div><div class="v">${fmtMoney(overall.otPay)}</div></div>
          </div>

          <div class="totals">
            <div class="box">
              <div class="row"><span>Base Pay</span><span>${fmtMoney(overall.basePay)}</span></div>
              <div class="row"><span>Overtime Pay</span><span>${fmtMoney(overall.otPay)}</span></div>
              <div class="row"><span>Bonus Pay</span><span>${fmtMoney(overall.nightPay || 0)}</span></div>
              <div class="row"><span>Night Out Pay</span><span>${fmtMoney(overall.nightOutPay || 0)}</span></div>
              <div class="row"><span>Expenses</span><span>${fmtMoney(overall.expenseTotal || 0)}</span></div>
              <div class="row"><strong>Total</strong><strong>${fmtMoney(overall.total)}</strong></div>
              <div class="row"><strong>Net</strong><strong>${fmtMoney(Number(overall.total || 0) - Number(overall.expenseTotal || 0))}</strong></div>
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
                <th class="right">Bonus Pay</th>
                <th class="right">Night Out Pay</th>
                <th class="right">Expenses</th>
                <th class="right">Base Pay</th>
                <th class="right">OT Pay</th>
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${companyRows || `<tr><td colspan="12" class="small">No company data for this period.</td></tr>`}
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
                <th class="right">Night Out</th>
                <th class="right">Expenses</th>
                <th class="right">Pay</th>
              </tr>
            </thead>
            <tbody>
              ${shiftRows || `<tr><td colspan="10" class="small">No shifts in this period.</td></tr>`}
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
    if (getSummaryPeriodMode() === "four_week") {
      const r = getCurrentFourWeekRange();
      periodLabel = "Current 4-Week Block";
      periodStart = r.startStr;
      periodEnd = r.endStr;

      periodShifts = shifts.filter(s => {
        const d = dateOnlyToDate(s.date);
        return d >= r.start && d < r.endExclusive;
      });
      overall = processMonthAsWeeks(periodShifts, "overall");
    } else {
      const r = getMonthRangeForDate(new Date());
      periodLabel = "Month";
      periodStart = r.startStr;
      periodEnd = r.endStr;

      periodShifts = shifts.filter(s => (s.date || "").slice(0, 7) === r.ym);
      overall = processMonthAsWeeks(periodShifts, "overall");
    }
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
      ? processMonthAsWeeks(grouped[cid], "perCompany")
      : processShifts(grouped[cid], "perCompany");
  });

  const rows = periodShifts
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.start || "").localeCompare(b.start || ""))
    .map(s => {
      const details = getShiftCompensationDetails(s);
      return { ...s, __payTotal: Number(details.totalEarned || 0) };
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
  initNavMenu();
  ensureDefaultCompany();

  // Basic lists
  renderCompanyDropdowns();
  renderCompanies();
  renderVehicles();
  initSummaryTabs();

  // Shift entry page defaults + editing
  loadShiftForEditingIfRequested();
  loadShiftDateForNewEntryIfRequested();
  initShiftTypeBehavior();
  initVehicleEntryBehavior();
  initLeaveCheckboxBehavior();
  initNightOutBehavior();
  applyDefaultsToShiftEntry();
  if (editingIndex === null) {
    renderAssignedVehicleOptions();
    renderShiftVehicleEntries([{}], { preserveEmpty: true });
    renderShiftTrailerEntries([""], { preserveEmpty: true });
  }

  // Summary page
  renderCurrentPeriodTiles();
  renderCompanySummary();
  renderLeaveStats();

  // General blocks
  renderAll();

  // Shifts page
  renderWeeklyGroupedShifts();
  renderShiftsCalendarPage();
  
  // Companies page
  updateCompanyFormVisibility();
  resetCompanyForm();
  initBreakRuleBehavior();

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

function initNavMenu() {
  const nav = document.querySelector(".nav");
  const btn = document.getElementById("navMenuBtn");
  const menu = document.getElementById("navMenu");
  if (!nav || !btn || !menu) return;

  const closeMenu = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const openMenu = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };
  const toggleMenu = () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  };

  btn.addEventListener("click", toggleMenu);
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}
