/**
 * @file script.js
 * @description Main application logic for my-mf-dashboard
 * @author Pabitra Swain https://github.com/the-sdet
 * @license MIT
 */

// ============================================
// GLOBAL STATE
// ============================================

let portfolioData = null;
let lastUploadedFileInfo = null;
let chart = null;
let currentTab = "growth";
let currentPeriod = "6M";
let fundWiseData = {};
const allTimeFlows = [];
const activeFlows = [];
let isSummaryCAS = false;
let currentUser = null;
let allUsers = [];
let familyDashboardCache = null;
let familyDashboardCacheTimestamp = null;
let familyDashboardInitialized = false;
const showViewDetailsForPast = true;
let mfStats = {};
let capitalGainsData = {
  byYear: {},
  currentYear: {},
  allTime: {
    equity: { stcg: 0, ltcg: 0, redeemed: 0 },
    debt: { stcg: 0, ltcg: 0, redeemed: 0 },
    hybrid: { stcg: 0, ltcg: 0, redeemed: 0 },
  },
};

// PORTFOLIO BENCHMARKS
const PORTFOLIO_BENCHMARKS = {
  nifty500: {
    isin: "INF247L01957",
    name: "Nifty 500",
  },
  nifty50: {
    isin: "INF247L01AE7",
    name: "Nifty 50",
  },
};

// Chart instances
let projectionChartInstance = null;

const default6M = 10000;
const default12M = 7000;

// Compact dashboard state
let compactDisplayMode = "xirr";
let compactSortMode = "currentValue";
let compactPastSortMode = "returns";

// Folio management
let pendingFolioChanges = {};

// Tab history
let tabHistory = ["main"];
let historyPointer = 0;

function getInitialTabFromHash() {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) return "main";

  const summaryDisabledTabs = [
    "charts",
    "transactions",
    "capital-gains",
    "past-holding",
  ];
  const validTabIds = Array.from(
    dashboard.querySelectorAll(":scope > section[id]"),
  )
    .map((s) => s.id)
    .filter((id) => !isSummaryCAS || !summaryDisabledTabs.includes(id));

  const requestedTab = window.location.hash.slice(1);
  return requestedTab && validTabIds.includes(requestedTab)
    ? requestedTab
    : "main";
}

// Backend configuration
const BACKEND_SERVER =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://my-mf-dashboard-backend.onrender.com";

console.log("🔧 Backend Server:", BACKEND_SERVER);
const DEBUG_MODE = false;

// Bump this whenever a new field is added to mfStats that requires a fresh
// full stats pull (i.e. data that won't exist in users' cached IndexedDB
// copies). Bumping this forces an immediate full update — bypassing the
// 6 AM gate and the 7-day cadence — the next time the app loads, and also
// resets the 7-day weekly-update counter.
const STATS_SCHEMA_VERSION = 1;
const STATS_SCHEMA_VERSION_KEY = "statsSchemaVersion";

// Distinct color palette for composition bars and charts
// Two variants: light mode (deeper, richer) and dark mode (brighter, more vivid)
const CHART_COLORS_LIGHT = [
  "#2563ae", // blue
  "#16a34a", // green
  "#d97706", // amber
  "#dc2626", // red
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#be185d", // pink
  "#65a30d", // lime
  "#9f580a", // orange-brown
  "#1d4ed8", // indigo
  "#059669", // emerald
  "#b45309", // warm amber
];

const CHART_COLORS_DARK = [
  "#60a5fa", // blue-400
  "#4ade80", // green-400
  "#fbbf24", // amber-400
  "#f87171", // red-400
  "#a78bfa", // violet-400
  "#22d3ee", // cyan-400
  "#f472b6", // pink-400
  "#a3e635", // lime-400
  "#fb923c", // orange-400
  "#818cf8", // indigo-400
  "#34d399", // emerald-400
  "#fcd34d", // yellow-300
];

function isDarkMode() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function getCompositionColor(index, total) {
  const palette = isDarkMode() ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
  return palette[index % palette.length];
}

// Colours that match the tbc-fill CSS nth-child palette used by
// Fund House, Sector, and Holdings text-bar charts.  Asset Allocation
// and Market Cap bars use this so all four panels share the same hues.
const TBC_COLORS = [
  "#7086FF",
  "#B388FF",
  "#4DA3FF",
  "#5EDB8A",
  "#FF7AA8",
  "#FFD166",
  "#9B8CFF",
  "#FF6E6E",
  "#4FD1C5",
  "#F6C453",
];

const TBC_COLORS_LIGHT = [
  "#818CF8",
  "#A78BFA",
  "#60A5FA",
  "#86EFAC",
  "#FB7185",
  "#FCD34D",
  "#C4B5FD",
  "#F87171",
  "#6EE7B7",
  "#FBBF24",
];

const TBC_COLORS_DARK = [
  "#7086FF",
  "#B388FF",
  "#4DA3FF",
  "#5EDB8A",
  "#FF7AA8",
  "#FFD166",
  "#9B8CFF",
  "#FF6E6E",
  "#4FD1C5",
  "#F6C453",
];

function getDoughnutColors(count, labels = []) {
  const isDark = isDarkMode();

  const palette = isDark ? TBC_COLORS_DARK : TBC_COLORS_LIGHT;

  return Array.from({ length: count }, (_, i) => {
    if (labels[i]?.toLowerCase() === "others") {
      return isDark ? "#FF6E6E" : "#F87171";
    }
    return palette[i % palette.length];
  });
}

function getTbcColor(index) {
  return TBC_COLORS[index % TBC_COLORS.length];
}

// Apply distinct color palette to a Chart.js bar chart instance
function applyColorToBarChart(chartInstance) {
  if (!chartInstance || !chartInstance.data) return;
  const count = chartInstance.data.labels?.length || 0;
  if (count === 0) return;
  const palette = isDarkMode() ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
  const colors = Array.from(
    { length: count },
    (_, i) => palette[i % palette.length],
  );
  chartInstance.data.datasets.forEach((ds) => {
    ds.backgroundColor = colors;
    ds.borderColor = colors;
    ds.borderWidth = 0;
    ds.borderRadius = 4;
  });
  chartInstance.update("none");
}

// ============================================
// MAIN FUNCTIONS (keep in script.js)
// ============================================

// DEBUG & FILE LOADING
async function loadLocalDebugData() {
  try {
    const casResponse = await fetch("./debug/parsed-cas.json");
    const statsResponse = await fetch("./debug/mf-stats.json");

    if (!casResponse.ok || !statsResponse.ok) {
      throw new Error("Failed to load debug files");
    }

    const casData = await casResponse.json();
    const statsData = await statsResponse.json();

    return { casData, statsData };
  } catch (err) {
    console.error("❌ Debug mode error:", err);
    showToast("Failed to load debug files from ./debug/ folder", "error");
    return null;
  }
}

function debugCASFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const label = document.getElementById("debugCASFileName");
  if (label) label.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    const textarea = document.getElementById("debugCASJsonInput");
    if (textarea) textarea.value = e.target.result;
    loadParsedCASJson();
  };
  reader.onerror = () => showToast("Failed to read file", "error");
  reader.readAsText(file);
}

function debugCASClear() {
  const textarea = document.getElementById("debugCASJsonInput");
  const fileInput = document.getElementById("debugCASFileInput");
  const label = document.getElementById("debugCASFileName");
  if (textarea) textarea.value = "";
  if (fileInput) fileInput.value = "";
  if (label) label.textContent = "Upload JSON file…";
}

async function loadParsedCASJson() {
  const textarea = document.getElementById("debugCASJsonInput");
  const rawValue = textarea?.value?.trim();

  if (!rawValue) {
    showToast("Please paste a parsed CAS JSON first", "warning");
    return;
  }

  let casData;
  try {
    casData = JSON.parse(rawValue);
  } catch (err) {
    showToast("Invalid JSON — could not parse input: " + err.message, "error");
    console.error("❌ JSON parse error:", err);
    return;
  }

  // Support both casData.folios (raw CAS) and casData.data.folios (wrapped export)
  if (casData?.data?.folios && Array.isArray(casData.data.folios)) {
    console.log("📦 Detected wrapped CAS structure — unwrapping casData.data");
    casData = casData.data;
  }

  if (!casData?.folios || !Array.isArray(casData.folios)) {
    showToast(
      "Invalid CAS structure — expected a 'folios' array at root or under 'data'",
      "error",
    );
    return;
  }

  console.log(
    "🐛 DEBUG: Loading injected parsed CAS JSON —",
    casData.folios?.length,
    "folios",
  );

  showProcessingSplash();

  try {
    portfolioData = casData;
    isSummaryCAS = portfolioData.cas_type === "SUMMARY";

    // Unwrap mfStats if it's the {fileName, data, timestamp} wrapper rather than ISIN map
    if (
      mfStats?.data &&
      typeof mfStats.data === "object" &&
      !mfStats.data.folios
    ) {
      console.warn("⚠️ mfStats was a wrapper object — unwrapping .data");
      mfStats = mfStats.data;
    }

    console.log(
      "CAS Type:",
      isSummaryCAS ? "SUMMARY" : "DETAILED",
      "— Folios:",
      portfolioData.folios?.length,
    );

    // Determine if we need to fetch MF stats (empty or missing)
    const statsMissing = !mfStats || Object.keys(mfStats).length === 0;
    if (statsMissing) {
      console.log("📊 mfStats not loaded — fetching from backend (initial)...");
      updateProcessingProgress(40, "Pulling MF stats…");
      await fetchOrUpdateMFStats("initial");
      if (isSummaryCAS) {
        updateProcessingProgress(90, "Rendering dashboard…");
        processSummaryCAS();
      } else {
        enableSummaryIncompatibleTabs();
      }
    } else {
      console.log(
        `✅ mfStats already present (${Object.keys(mfStats).length} funds) — skipping fetch.`,
      );
      if (isSummaryCAS) {
        updateProcessingProgress(90, "Rendering dashboard…");
        processSummaryCAS();
      } else {
        updateProcessingProgress(90, "Rendering dashboard…");
        await processPortfolio();
        enableSummaryIncompatibleTabs();
      }
    }

    // Build user key from investor name in the JSON
    const toProperCase = (str) =>
      str.replace(
        /\w\S*/g,
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
      );

    const fullInvestorName = toProperCase(
      portfolioData.investor_info?.name?.trim() || "DebugUser",
    );
    const firstNameFromCAS =
      fullInvestorName.split(" ")[0]?.trim() || "DebugUser";

    const existingUserWithSameName = allUsers.find((user) => {
      const storedName = getStoredInvestorName(user);
      return storedName.toLowerCase() === fullInvestorName.toLowerCase();
    });

    if (existingUserWithSameName) {
      currentUser = existingUserWithSameName;
      console.log(`♻️ Overwriting existing user: ${currentUser}`);
    } else {
      const existingUsersWithFirstName = allUsers.filter((user) => {
        const storedName = getStoredInvestorName(user);
        const storedFirstName = storedName.split(" ")[0]?.trim() || storedName;
        return storedFirstName.toLowerCase() === firstNameFromCAS.toLowerCase();
      });

      if (existingUsersWithFirstName.length > 0) {
        let counter = 1;
        let newUserName = `${firstNameFromCAS}_${counter}`;
        while (allUsers.includes(newUserName)) {
          counter++;
          newUserName = `${firstNameFromCAS}_${counter}`;
        }
        currentUser = newUserName;
      } else {
        currentUser = firstNameFromCAS;
      }
      console.log(`✨ Debug JSON user: ${currentUser}`);
    }

    localStorage.setItem("lastActiveUser", currentUser);
    localStorage.removeItem(`hiddenFolios_${currentUser}`);

    await storageManager.savePortfolioData(
      portfolioData,
      mfStats,
      true,
      currentUser,
    );

    localStorage.setItem(`investorName_${currentUser}`, fullInvestorName);

    allUsers = storageManager.getAllUsers();
    populateUserList(allUsers);
    updateCurrentUserDisplay();

    const dashboard = document.getElementById("dashboard");
    dashboard.classList.remove("disabled");
    enableAllTabs();

    hideProcessingSplash();

    // Show update-stats / update-nav, hide instructions-card
    ["update-stats", "update-nav"].forEach((cls) => {
      const el = document.querySelector("." + cls);
      if (el) el.classList.remove("hidden");
    });
    const instrEl = document.querySelector(".instructions-card");
    if (instrEl) instrEl.classList.add("hidden");

    showToast(
      `Debug CAS JSON loaded successfully for ${currentUser}!`,
      "success",
    );
    updateFooterInfo();
    invalidateFamilyDashboardCache();
    switchDashboardTab("main");
  } catch (err) {
    hideProcessingSplash();
    console.error("❌ loadParsedCASJson error:", err);
    showToast("Failed to process injected CAS JSON: " + err.message, "error");
  }
}
async function loadFileFromTab() {
  const fileInput = document.getElementById("fileInputTab");
  const passwordInput = document.getElementById("filePasswordTab");
  const password = passwordInput.value;
  const file = fileInput.files[0];

  if (!file) {
    showToast("Please select a file", "error");
    return;
  }

  try {
    const fileSignature = await getFileSignature(file);
    console.log("🔒 File signature:", fileSignature);

    // Check if THIS EXACT FILE was already uploaded for ANY user
    let fileAlreadyUploadedForUser = null;
    allUsers.forEach((user) => {
      const userFileInfo = localStorage.getItem(`lastCASFileInfo_${user}`);
      if (userFileInfo === fileSignature) {
        fileAlreadyUploadedForUser = user;
      }
    });

    if (fileAlreadyUploadedForUser) {
      showToast(
        `This file has already been uploaded for user: ${fileAlreadyUploadedForUser}`,
        "warning",
      );
      fileInput.value = "";
      return;
    }

    showProcessingSplash();

    const formData = new FormData();
    formData.append("file", file);
    formData.append("password", password);
    formData.append("output", "json");

    const response = await fetch(BACKEND_SERVER + "/api/parse-cas", {
      method: "POST",
      body: formData,
    });

    console.log("Backend response received, status:", response.status);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log("Result parsed:", result.success ? "SUCCESS" : "FAILED");

    if (!result.success) {
      showToast("CAS parsing failed: " + result.error, "error");
      hideProcessingSplash();
      return;
    }

    portfolioData = result.data;
    updateProcessingProgress(20, "CAS read");

    // Detect CAS type
    isSummaryCAS = portfolioData.cas_type === "SUMMARY";

    console.log(
      "CAS Type:",
      isSummaryCAS ? "SUMMARY" : "DETAILED",
      " - Folios Fetched: ",
      portfolioData.folios?.length,
    );

    if (isSummaryCAS) {
      updateProcessingProgress(40, "Pulling MF stats…");
      await fetchOrUpdateMFStats("initial");
      processSummaryCAS();
    } else {
      updateProcessingProgress(40, "Pulling MF stats…");
      await fetchOrUpdateMFStats("initial");
      enableSummaryIncompatibleTabs();
    }

    // Extract investor info from CAS
    const fullInvestorName =
      portfolioData.investor_info?.name?.trim() || "User";
    const firstNameFromCAS = fullInvestorName.split(" ")[0]?.trim() || "User";

    // Check if user with same FULL investor name exists (regardless of CAS type)
    const existingUserWithSameName = allUsers.find((user) => {
      const storedName = getStoredInvestorName(user);
      return storedName.toLowerCase() === fullInvestorName.toLowerCase();
    });

    if (existingUserWithSameName) {
      // Same investor - overwrite automatically
      currentUser = existingUserWithSameName;
      console.log(
        `♻️ Overwriting existing user: ${currentUser} (same investor: ${fullInvestorName})`,
      );
    } else {
      // Different investor - check if first name with increment exists
      const existingUsersWithFirstName = allUsers.filter((user) => {
        const storedName = getStoredInvestorName(user);
        const storedFirstName = storedName.split(" ")[0]?.trim() || storedName;
        return storedFirstName.toLowerCase() === firstNameFromCAS.toLowerCase();
      });

      if (existingUsersWithFirstName.length > 0) {
        // Find next available increment
        let counter = 1;
        let newUserName = `${firstNameFromCAS}_${counter}`;
        while (allUsers.includes(newUserName)) {
          counter++;
          newUserName = `${firstNameFromCAS}_${counter}`;
        }
        currentUser = newUserName;
        console.log(
          `✨ Creating new user with increment: ${currentUser} (different investor: ${fullInvestorName})`,
        );
      } else {
        // First name doesn't exist - use first name
        currentUser = firstNameFromCAS;
        console.log(
          `✨ Creating new user: ${currentUser} (new investor: ${fullInvestorName})`,
        );
      }
    }

    localStorage.setItem("lastActiveUser", currentUser);

    const hiddenFoliosKey = `hiddenFolios_${currentUser}`;
    localStorage.removeItem(hiddenFoliosKey);

    // Save to IndexedDB BEFORE updating UI
    await storageManager.savePortfolioData(
      portfolioData,
      mfStats,
      true,
      currentUser,
    );

    // Store the file signature for this user
    lastUploadedFileInfo = fileSignature;
    localStorage.setItem(`lastCASFileInfo_${currentUser}`, fileSignature);
    localStorage.setItem(`investorName_${currentUser}`, fullInvestorName); // Store full name

    allUsers = storageManager.getAllUsers();

    // Update user list and display
    populateUserList(allUsers);
    updateCurrentUserDisplay();

    const dashboard = document.getElementById("dashboard");
    dashboard.classList.remove("disabled");

    enableAllTabs();

    try {
      fileInput.value = "";
      passwordInput.value = "";
    } catch (err) {}

    hideProcessingSplash();

    const showCards = ["update-stats", "update-nav"];
    const hideCard = "instructions-card";

    showCards.forEach((e) => {
      const element = document.querySelector("." + e);
      if (element) element.classList.remove("hidden");
    });

    const hideElement = document.querySelector("." + hideCard);
    if (hideElement) hideElement.classList.add("hidden");

    showToast(`Portfolio loaded for ${currentUser}!`, "success");
    updateFooterInfo();

    invalidateFamilyDashboardCache();

    switchDashboardTab("main");
  } catch (err) {
    hideProcessingSplash();
    console.error("ERROR:", err);
    showToast(
      "Could NOT process CAS. Please check the file/password and try again.",
      "error",
    );
  }
}
async function getSearchKeys() {
  try {
    const response = await fetch("./data/search-key.json");
    if (!response.ok) {
      throw new Error(`Failed to load search-key.json: ${response.status}`);
    }

    const searchKeys = await response.json();

    const dataHash =
      Object.keys(searchKeys).length + "_" + JSON.stringify(searchKeys).length;
    const cachedHash = localStorage.getItem(
      ManifestManager.SEARCH_KEYS_VERSION_KEY,
    );
    const cachedKeys = ManifestManager.getSearchKeys();

    if (cachedKeys && cachedHash === dataHash) {
      return cachedKeys;
    }

    console.log(
      cachedKeys
        ? "🔄 Search keys changed, updating cache..."
        : "📥 Loading search keys for first time...",
      Object.keys(searchKeys).length,
    );

    ManifestManager.saveSearchKeys(searchKeys, dataHash);

    return searchKeys;
  } catch (err) {
    console.error("Error loading search-key.json:", err);

    const cachedKeys = ManifestManager.getSearchKeys();
    if (cachedKeys) {
      return cachedKeys;
    }

    return {};
  }
}

// PORTFOLIO PROCESSING
async function processPortfolio(skipAnalytics = false) {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) {
    console.warn("Dashboard element not found");
    return;
  }
  dashboard.classList.add("active");

  aggregateFundWiseData();

  const summary = calculateSummary();
  updateSummaryCards(summary);

  requestAnimationFrame(() => {
    updateFundBreakdown();
    if (!skipAnalytics) {
      calculateAndDisplayPortfolioAnalytics();
    }
    displayCapitalGains();
    initializeTransactionSections();
    updateCompactDashboard();
    updateCompactPastDashboard();
    switchDashboardTab(getInitialTabFromHash());
  });

  // Calculate daily valuations asynchronously (non-blocking)
  requestIdleCallback(
    async () => {
      const portfolioValuation = await calculatePortfolioDailyValuation();

      window.portfolioValuationHistory = portfolioValuation;

      initializeCharts();

      if (currentTab === "growth") {
        updateChart();
      }
    },
    { timeout: 2000 },
  );
  loadFamilyDashboard();
}

function getPortfolioBenchmarks() {
  const getReturns = (isin) => {
    const stats = mfStats?.[isin]?.return_stats || {};

    return {
      return1y: stats.return1y ?? null,
      return3y: stats.return3y ?? null,
      return5y: stats.return5y ?? null,
    };
  };

  return {
    nifty50: {
      ...PORTFOLIO_BENCHMARKS.nifty50,
      ...getReturns(PORTFOLIO_BENCHMARKS.nifty50.isin),
    },
    nifty500: {
      ...PORTFOLIO_BENCHMARKS.nifty500,
      ...getReturns(PORTFOLIO_BENCHMARKS.nifty500.isin),
    },
  };
}

function calculatePortfolioAlpha(weightedReturns, benchmarks) {
  const diff = (a, b) =>
    a != null && b != null
      ? Math.round((a - b + Number.EPSILON) * 100) / 100
      : null;
  return {
    vsNifty50: {
      alpha1y: diff(weightedReturns.return1y, benchmarks.nifty50.return1y),
      alpha3y: diff(weightedReturns.return3y, benchmarks.nifty50.return3y),
      alpha5y: diff(weightedReturns.return5y, benchmarks.nifty50.return5y),
    },
    vsNifty500: {
      alpha1y: diff(weightedReturns.return1y, benchmarks.nifty500.return1y),
      alpha3y: diff(weightedReturns.return3y, benchmarks.nifty500.return3y),
      alpha5y: diff(weightedReturns.return5y, benchmarks.nifty500.return5y),
    },
  };
}

function aggregateFundWiseData() {
  if (isSummaryCAS) {
    console.log("⏭️ Skipping aggregateFundWiseData for Summary CAS");
    return fundWiseData;
  }

  fundWiseData = {};

  // Get hidden folios for current user
  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  portfolioData.folios.forEach((folio) => {
    if (!folio.schemes || !Array.isArray(folio.schemes)) {
      console.warn("Folio missing schemes array:", folio.folio);
      return;
    }

    folio.schemes.forEach((scheme) => {
      const schemeLower = scheme.scheme.toLowerCase();
      if (
        !schemeLower.includes("fund") &&
        !schemeLower.includes("fof") &&
        !schemeLower.includes("etf")
      )
        return;

      if (
        !Array.isArray(scheme.transactions) ||
        scheme.transactions.length === 0
      )
        return;

      // Create unique key for folio + scheme combination
      const uniqueKey = `${folio.folio}|${scheme.scheme}`;

      // Skip if this folio+scheme combination is hidden
      if (hiddenFolios.includes(uniqueKey)) {
        console.log(`⏭️ Skipping hidden folio+scheme: ${uniqueKey}`);
        return;
      }

      const key = getFundKey(scheme);
      const extendedData = scheme.isin ? mfStats[scheme.isin] : null;
      const amcName =
        extendedData?.amc?.trim() ||
        scheme.amc?.trim() ||
        folio.amc?.trim() ||
        "Unknown AMC";
      const latestNav = extendedData?.latest_nav || 0;
      const navHistory = extendedData?.nav_history || [];
      const meta = extendedData?.meta || {};
      const sip_return = extendedData?.sip_return || {};
      const simple_return = extendedData?.simple_return || {};
      const return_stats = extendedData?.return_stats || {};
      const benchmark = extendedData?.benchmark;
      const holdings = extendedData?.holdings || [];

      if (!fundWiseData[key]) {
        fundWiseData[key] = {
          scheme: scheme.scheme,
          schemeDisplay: sanitizeSchemeName(scheme.scheme),
          isin: scheme.isin,
          amc: amcName,
          type: scheme.type,
          folios: [],
          transactions: [],
          valuations: [],
          navHistory: navHistory,
          latestNav: latestNav,
          meta: meta,
          benchmark: benchmark,
          sip_return: sip_return,
          simple_return: simple_return,
          rta: extendedData?.rta,
          manager: extendedData?.manager,
          meta_desc: extendedData?.meta_desc,
          launch_date: extendedData?.launch_date,
          portfolio_turnover: extendedData?.portfolio_turnover,
          return_stats: return_stats,
          tax_impact: extendedData?.tax_impact,
          holdings: holdings,
        };
      }

      // Track folio only once per fund
      if (!fundWiseData[key].folios.includes(folio.folio)) {
        fundWiseData[key].folios.push(folio.folio);
      }

      //Add transactions, filtering out tax and misc entries
      //Exlude description, dividend_rate and add folio
      //Normalise transaction type
      const excludedTypes = ["STAMP_DUTY_TAX", "STT_TAX", "MISC"];

      const typeMap = {
        PURCHASE: "PURCHASE",
        PURCHASE_SIP: "PURCHASE",
        SWITCH_IN: "PURCHASE",
        DIVIDEND_REINVEST: "PURCHASE",
        REDEMPTION: "REDEMPTION",
        SWITCH_OUT: "REDEMPTION",
        OTHER: "PURCHASE",
      };

      // Pre-compute a Set of "date|units" keys for SIP Purchase Reversal redemptions.
      // The paired corrective PURCHASE on the same date for the same units must also
      // be excluded — otherwise the re-issued purchase gets double-counted in FIFO.
      const reversalKeys = new Set(
        scheme.transactions
          .filter(
            (t) =>
              t.type === "REDEMPTION" &&
              typeof t.description === "string" &&
              /reversal/i.test(t.description) &&
              /sip\s*purchase/i.test(t.description),
          )
          .map((t) => `${t.date}|${parseFloat(t.units || 0)}`),
      );

      const filteredTxns = scheme.transactions
        .filter((t) => {
          if (["STAMP_DUTY_TAX", "STT_TAX", "MISC"].includes(t.type))
            return false;
          if (t.type === "OTHER") {
            // Only include OTHER if it has real units and nav (it's a SIP/purchase)
            const units = parseFloat(t.units || 0);
            const nav = parseFloat(t.nav || 0);
            return units > 0 && nav > 0;
          }
          // Skip SIP Purchase Reversal transactions typed as REDEMPTION.
          // These are always paired with a corrective PURCHASE entry that follows,
          // so including them as redemptions would corrupt FIFO cost basis and unit counts.
          if (
            t.type === "REDEMPTION" &&
            typeof t.description === "string" &&
            /reversal/i.test(t.description) &&
            /sip\s*purchase/i.test(t.description)
          ) {
            return false;
          }
          // Skip the corrective PURCHASE that was issued alongside a reversal.
          // It shares the same date and unit count as the reversal redemption.
          if (
            t.type === "PURCHASE" &&
            reversalKeys.has(`${t.date}|${parseFloat(t.units || 0)}`)
          ) {
            return false;
          }
          return true;
        })
        .map(({ description, dividend_rate, ...rest }) => ({
          ...rest,
          folio: folio.folio,
          type: typeMap[rest.type] || rest.type, // normalize transaction type
        }));

      fundWiseData[key].transactions.push(...filteredTxns);

      // Add valuation if it exists
      if (scheme.valuation) {
        fundWiseData[key].valuations.push(scheme.valuation);
      }
    });
  });

  Object.keys(fundWiseData).forEach((key) => {
    const fund = fundWiseData[key];
    const extendedData = fund.isin ? mfStats[fund.isin] : null;

    // Calculate total units from transactions for valuation
    let totalUnits = 0;
    fund.transactions.forEach((tx) => {
      const units = parseFloat(tx.units || 0);
      if (tx.type === "PURCHASE") {
        totalUnits += units;
      } else if (tx.type === "REDEMPTION") {
        totalUnits -= Math.abs(units);
      }
    });

    const latestNAV = parseFloat(extendedData?.latest_nav || 0);

    if (latestNAV > 0 && totalUnits > 0) {
      const totalValue = latestNAV * totalUnits;
      const totalCost = 0; // Will be calculated in FIFO metrics later

      fund.valuation = {
        date: extendedData?.latest_nav_date || new Date().toISOString(),
        nav: latestNAV,
        value: totalValue,
        cost: totalCost, // Placeholder - will be set in calculateSummary
      };
    } else if (fund.valuations.length > 0) {
      // Fallback – use the valuation parsed from CAS
      let totalValue = 0;
      let totalCost = 0;

      fund.valuations.forEach((val) => {
        totalValue += parseFloat(val.value || 0);
        totalCost += parseFloat(val.cost || 0);
      });

      const latestValuation = fund.valuations.reduce((latest, current) =>
        new Date(current.date) > new Date(latest.date) ? current : latest,
      );

      fund.valuation = {
        date: latestValuation.date,
        value: totalValue,
        cost: totalCost,
        nav: latestValuation.nav,
      };
    } else {
      // No Data
      fund.valuation = {
        date: null,
        nav: 0,
        value: 0,
        cost: 0,
      };
    }

    // Cleanup
    delete fund.valuations;
  });

  const benchmarkSummary = aggregateBenchmarkReturns(fundWiseData);

  Object.values(fundWiseData).forEach((fund) => {
    if (!fund.benchmark) return (fund.benchmark_returns = null);

    const bmKey = normalizeBenchmarkName(fund.benchmark);

    fund.benchmark_returns = benchmarkSummary[
      normalizeBenchmarkName(fund.benchmark)
    ]
      ? {
          return1y: benchmarkSummary[bmKey]["1Y"],
          return3y: benchmarkSummary[bmKey]["3Y"],
          return5y: benchmarkSummary[bmKey]["5Y"],
        }
      : null;
  });

  console.log("Fund Wise Data:", fundWiseData);
  return fundWiseData;
}
function processSummaryCAS() {
  // Disable tabs that are not relevant for summary
  disableSummaryIncompatibleTabs();

  // Build fundWiseData from summary folios
  fundWiseData = {};

  // Get hidden folios for current user
  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  portfolioData.folios.forEach((folio) => {
    // Skip if folio is hidden
    if (hiddenFolios.includes(folio.folio)) {
      console.log(`⏭️ Skipping hidden folio: ${folio.folio}`);
      return;
    }

    const key = getFundKey(folio);
    const extendedData = folio.isin ? mfStats[folio.isin] : null;

    const amcName =
      extendedData?.amc?.trim() || folio.amc?.trim() || "Unknown AMC";

    const latestNav = extendedData?.latest_nav
      ? parseFloat(extendedData.latest_nav)
      : parseFloat(folio.nav || 0);

    const navHistory = extendedData?.nav_history || [];
    const meta = extendedData?.meta || {};
    const return_stats = extendedData?.return_stats || {};
    const benchmark = extendedData?.benchmark;
    const holdings = extendedData?.holdings || [];

    const units = parseFloat(folio.units || 0);
    const cost = parseFloat(folio.cost || 0);
    const currentValue =
      units > 0 && latestNav > 0
        ? units * latestNav
        : parseFloat(folio.current_value || 0);
    const unrealizedGain = currentValue - cost;
    const unrealizedGainPercentage =
      cost > 0 ? parseFloat(((unrealizedGain / cost) * 100).toFixed(2)) : 0;

    folio.current_value = currentValue;
    folio.nav = latestNav;
    folio.nav_date = extendedData?.latest_nav_date || folio.nav_date;

    if (fundWiseData[key]) {
      // Merge subsequent folios of the same scheme into the existing entry
      const existing = fundWiseData[key];
      const m = existing.advancedMetrics;
      existing.folios.push(folio.folio);
      m.totalInvested += cost;
      m.remainingCost += cost;
      m.currentValue += currentValue;
      m.unrealizedGain += unrealizedGain;
      m.totalUnitsRemaining += units;
      m.unrealizedGainPercentage =
        m.remainingCost > 0
          ? parseFloat(((m.unrealizedGain / m.remainingCost) * 100).toFixed(2))
          : 0;
      m.averageRemainingCostPerUnit =
        m.totalUnitsRemaining > 0
          ? (m.remainingCost / m.totalUnitsRemaining).toFixed(3)
          : 0;
      existing.valuation.value = m.currentValue;
      existing.valuation.cost = m.remainingCost;
    } else {
      fundWiseData[key] = {
        scheme: folio.scheme,
        schemeDisplay: sanitizeSchemeName(folio.scheme),
        isin: folio.isin,
        amc: amcName,
        type: extendedData?.category || "Unknown",
        category: extendedData?.category || "Unknown",
        folios: [folio.folio],
        transactions: [],
        navHistory: navHistory,
        latestNav: latestNav,
        meta: meta,
        benchmark: benchmark,
        return_stats: return_stats,
        holdings: holdings,
        valuation: {
          date:
            extendedData?.latest_nav_date ||
            folio.nav_date ||
            new Date().toISOString(),
          nav: latestNav,
          value: currentValue,
          cost: cost,
        },
        advancedMetrics: {
          totalInvested: cost,
          totalWithdrawn: 0,
          realizedGain: 0,
          realizedGainPercentage: 0,
          unrealizedGain: unrealizedGain,
          unrealizedGainPercentage: unrealizedGainPercentage,
          remainingCost: cost,
          currentValue: currentValue,
          totalUnitsRemaining: units,
          averageRemainingCostPerUnit:
            units > 0 ? (cost / units).toFixed(3) : 0,
          averageHoldingDays: 0,
          category: getTaxCategory(extendedData, {
            scheme: folio.scheme,
            type: extendedData?.category || "",
          }),
          capitalGains: {
            stcg: 0,
            ltcg: 0,
            stcgRedeemed: 0,
            ltcgRedeemed: 0,
            byYear: {},
          },
          folioSummaries: {},
          dailyValuation: [],
        },
      };
    }
  });
  console.log("Fund Wise Data:", fundWiseData);

  const benchmarkSummary = aggregateBenchmarkReturns(fundWiseData);
  Object.values(fundWiseData).forEach((fund) => {
    if (!fund.benchmark) return (fund.benchmark_returns = null);
    const bmKey = normalizeBenchmarkName(fund.benchmark);
    fund.benchmark_returns = benchmarkSummary[bmKey]
      ? {
          return1y: benchmarkSummary[bmKey]["1Y"],
          return3y: benchmarkSummary[bmKey]["3Y"],
          return5y: benchmarkSummary[bmKey]["5Y"],
        }
      : null;
  });

  portfolioData.current_value = portfolioData.folios.reduce(
    (sum, folio) => sum + parseFloat(folio.current_value || 0),
    0,
  );

  const summary = calculateSummarySummary();
  updateSummaryCards(summary);

  requestAnimationFrame(() => {
    updateSummaryFundBreakdown();
    calculateAndDisplayPortfolioAnalytics();
    updateCompactDashboard();
    updateCompactPastDashboard();
    switchDashboardTab(getInitialTabFromHash());
  });
}

// ============================================
// TAX CATEGORY CLASSIFICATION
// Single source of truth for fund tax category.
//
// Rules:
//   Equity - International              → hybrid
//   Equity - (anything else)            → equity
//   Debt   - Short/Long/Medium Duration → debt
//   Debt   - (anything else)            → debt
//   Commodities - Gold / Silver         → hybrid
//   Commodities - (anything else)       → hybrid
//   Hybrid - second_category=Equity      → equity (equity-oriented, 1Y threshold)
//   Hybrid - second_category=Debt        → debt   (debt-oriented, 2Y threshold)
//   Hybrid - second_category=null/other  → hybrid (true hybrid, 2Y threshold)
//   Unknown / no stats / fallback        → equity (safe default for index/thematic funds)
// ============================================
function getTaxCategory(extendedData, fund) {
  const scheme = fund?.scheme || "";
  const ft = (fund?.type || "").toLowerCase();
  const logResult = (result, source, cat, subCat, secCat) => {
    // console.log(
    //   `${scheme} - ${ft} - ${cat} - ${subCat} - ${secCat} = ${result} [${source}]`,
    // );
    return result;
  };

  if (!extendedData?.category) {
    // No stats data for this fund - infer from fund.type, then fund name
    const name = scheme.toLowerCase();

    if (ft.includes("equity")) return logResult("equity", "type", "", "", "");
    if (
      ft.includes("debt") ||
      ft.includes("income") ||
      ft.includes("liquid") ||
      ft.includes("gilt") ||
      ft.includes("overnight") ||
      ft.includes("money market")
    )
      return logResult("debt", "type", "", "", "");

    // Name-based heuristics for funds missing from stats
    if (
      name.includes("overnight") ||
      name.includes("liquid") ||
      name.includes("money market") ||
      name.includes("short duration") ||
      name.includes("long duration") ||
      name.includes("medium duration") ||
      name.includes("gilt") ||
      name.includes("corporate bond") ||
      name.includes("banking and psu") ||
      name.includes("credit risk")
    )
      return logResult("debt", "name", "", "", "");
    if (
      name.includes("international") ||
      name.includes("s&p 500") ||
      name.includes("s and p 500") ||
      name.includes("nasdaq") ||
      name.includes("global")
    )
      return logResult("hybrid", "name", "", "", "");

    // Default unknown funds to equity (most index/thematic funds without stats are equity)
    return logResult("equity", "default", "", "", "");
  }

  const cat = extendedData.category.toLowerCase();
  const subCat = (extendedData.sub_category || "").toLowerCase();
  const secCat = (extendedData.second_category || "").toLowerCase();

  if (cat === "equity" || cat === "elss") {
    // Equity - International sub_category -> taxed as Hybrid (2Y threshold, no Rs1.25L exemption)
    if (subCat === "international")
      return logResult("hybrid", "int'l equity", cat, subCat, secCat);
    return logResult("equity", "cat", cat, subCat, secCat);
  }

  if (
    cat === "debt" ||
    cat === "income" ||
    cat === "liquid" ||
    cat === "gilt"
  ) {
    return logResult("debt", "cat", cat, subCat, secCat);
  }

  if (cat === "commodities") {
    // Gold/Silver ETF FoFs -> taxed as Hybrid
    return logResult("hybrid", "commodities", cat, subCat, secCat);
  }

  if (cat === "hybrid" || cat === "balanced") {
    // Use second_category as the authoritative equity/debt orientation signal:
    // "Equity" -> equity-oriented hybrid (1Y LTCG, 20% STCG, 12.5% LTCG with Rs1.25L exemption)
    // "Debt"   -> debt-oriented hybrid   (2Y LTCG, slab STCG, slab LTCG)
    // null/other -> true hybrid          (2Y LTCG, slab STCG, 12.5% LTCG no exemption)
    if (secCat === "equity")
      return logResult("equity", "hybrid/2nd-cat", cat, subCat, secCat);
    if (secCat === "debt")
      return logResult("debt", "hybrid/2nd-cat", cat, subCat, secCat);
    return logResult("hybrid", "hybrid/2nd-cat", cat, subCat, secCat);
  }

  // Anything unrecognised -> hybrid
  return logResult("hybrid", "unrecognised", cat, subCat, secCat);
}

// CALCULATIONS
function calculateadvancedMetrics(fund) {
  let totalInvested = 0;
  let totalWithdrawn = 0;
  let realizedGain = 0;

  const gains = {
    stcg: 0,
    ltcg: 0,
    stcgRedeemed: 0,
    ltcgRedeemed: 0,
    byYear: {},
  };

  const extendedData = fund.isin ? mfStats[fund.isin] : null;
  const category = getTaxCategory(extendedData, fund);

  const stcgThreshold = category === "equity" ? 365 : 730;

  // Get hidden folios for current user
  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  // Filter out transactions from hidden folios
  const visibleTransactions = fund.transactions.filter((tx) => {
    const txFolio = tx.folio || "unknown";

    // For detailed CAS, check if folio+scheme combination is hidden
    const uniqueKey = `${txFolio}|${fund.scheme}`;

    // Check both simple folio and folio+scheme combination
    return !hiddenFolios.includes(txFolio) && !hiddenFolios.includes(uniqueKey);
  });

  // Group by folio for proper FIFO - use filtered transactions
  const folioGroups = {};
  visibleTransactions.forEach((tx) => {
    const folio = tx.folio || "default";
    if (!folioGroups[folio]) folioGroups[folio] = [];
    folioGroups[folio].push(tx);
  });

  const remainingUnitsAllFolios = [];
  const folioSummaries = {};
  const folioCashflows = {};

  // Try to get a reliable NAV-per-unit from valuation
  const valuation = fund.valuation || {};
  let globalNavPerUnit = 0;
  if (valuation.nav && !isNaN(parseFloat(valuation.nav))) {
    globalNavPerUnit = parseFloat(valuation.nav);
  } else if (valuation.navPerUnit && !isNaN(parseFloat(valuation.navPerUnit))) {
    globalNavPerUnit = parseFloat(valuation.navPerUnit);
  } else if (
    valuation.value &&
    fund.totalUnits &&
    !isNaN(parseFloat(valuation.value)) &&
    !isNaN(parseFloat(fund.totalUnits)) &&
    parseFloat(fund.totalUnits) > 0
  ) {
    globalNavPerUnit =
      parseFloat(valuation.value) / parseFloat(fund.totalUnits);
  } else {
    globalNavPerUnit = 0; // fallback
  }

  Object.entries(folioGroups).forEach(([folio, transactions]) => {
    const unitQueue = [];
    transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Init folio-level trackers
    folioCashflows[folio] = [];
    let folioInvested = 0;
    let folioWithdrawn = 0;
    let folioRealizedGain = 0;
    let folioUnitsPurchased = 0;
    let folioUnitsRedeemed = 0;

    transactions.forEach((tx) => {
      const units = parseFloat(tx.units || 0);
      const nav = parseFloat(tx.nav || 0);
      const amount = units * nav;

      // Record cashflow
      if (!isNaN(amount) && amount !== 0) {
        if (tx.type === "PURCHASE") {
          folioCashflows[folio].push({
            type: "Buy",
            amount: -Math.abs(amount),
            date: tx.date,
            nav,
            units: Math.abs(units),
          });
        } else if (tx.type === "REDEMPTION") {
          folioCashflows[folio].push({
            type: "Sell",
            amount: Math.abs(amount),
            date: tx.date,
            nav,
            units: Math.abs(units),
          });
        }
      }

      // --- FIFO processing ---
      if (tx.type === "PURCHASE") {
        if (units > 0 && nav > 0) {
          const purchaseAmount = units * nav;
          totalInvested += purchaseAmount;
          folioInvested += purchaseAmount;
          folioUnitsPurchased += units;

          unitQueue.push({
            units: units,
            nav: nav,
            date: tx.date,
            purchaseDate: new Date(tx.date),
          });
        } else if (units > 0) {
          folioUnitsPurchased += units;
        }
      } else if (tx.type === "REDEMPTION") {
        const unitsToSell = Math.abs(units);
        const saleNAV = nav;
        const saleDate = new Date(tx.date);
        const saleFY = getFinancialYear(saleDate);

        const saleAmount = unitsToSell * saleNAV;
        totalWithdrawn += saleAmount;
        folioWithdrawn += saleAmount;
        folioUnitsRedeemed += unitsToSell;

        let remainingUnits = unitsToSell;
        let stcgAmount = 0;
        let ltcgAmount = 0;
        let stcgRedeemedAmount = 0;
        let ltcgRedeemedAmount = 0;

        while (remainingUnits > 0.0001 && unitQueue.length > 0) {
          const batch = unitQueue[0];
          const holdingDays = Math.floor(
            (saleDate - batch.purchaseDate) / (1000 * 60 * 60 * 24),
          );

          let unitsFromBatch = 0;
          if (batch.units <= remainingUnits + 0.0001) {
            unitsFromBatch = batch.units;
            remainingUnits -= batch.units;
            unitQueue.shift();
          } else {
            unitsFromBatch = remainingUnits;
            batch.units -= remainingUnits;
            remainingUnits = 0;
          }

          const costFromBatch = unitsFromBatch * batch.nav;
          const saleFromBatch = unitsFromBatch * saleNAV;
          const gainFromBatch = saleFromBatch - costFromBatch;

          if (holdingDays < stcgThreshold) {
            stcgAmount += gainFromBatch;
            stcgRedeemedAmount += saleFromBatch;
          } else {
            ltcgAmount += gainFromBatch;
            ltcgRedeemedAmount += saleFromBatch;
          }
        }

        realizedGain += stcgAmount + ltcgAmount;
        folioRealizedGain += stcgAmount + ltcgAmount;
        gains.stcg += stcgAmount;
        gains.ltcg += ltcgAmount;
        gains.stcgRedeemed += stcgRedeemedAmount;
        gains.ltcgRedeemed += ltcgRedeemedAmount;

        if (!gains.byYear[saleFY]) {
          gains.byYear[saleFY] = {
            stcg: 0,
            ltcg: 0,
            stcgRedeemed: 0,
            ltcgRedeemed: 0,
          };
        }
        gains.byYear[saleFY].stcg += stcgAmount;
        gains.byYear[saleFY].ltcg += ltcgAmount;
        gains.byYear[saleFY].stcgRedeemed += stcgRedeemedAmount;
        gains.byYear[saleFY].ltcgRedeemed += ltcgRedeemedAmount;
      }
    });

    // --- Folio summary calculations ---
    const folioRemainingUnits = unitQueue.reduce((sum, u) => sum + u.units, 0);
    const folioRemainingCost = unitQueue.reduce(
      (sum, u) => sum + u.units * u.nav,
      0,
    );

    // Use reliable NAV per unit
    const navPerUnit =
      valuation && (valuation.nav || valuation.navPerUnit)
        ? parseFloat(valuation.nav || valuation.navPerUnit)
        : globalNavPerUnit || 0;

    // FIX: Check if remaining units are effectively zero
    let folioCurrentValue = 0;
    if (folioRemainingUnits > 0.001) {
      // Only calculate if units > 0.001
      if (navPerUnit > 0) {
        folioCurrentValue = navPerUnit * folioRemainingUnits;
      } else if (
        valuation.value &&
        fund.totalUnits &&
        parseFloat(fund.totalUnits) > 0
      ) {
        const proportion = folioRemainingUnits / parseFloat(fund.totalUnits);
        folioCurrentValue = proportion * parseFloat(valuation.value);
      }
    }
    const folioUnrealizedGain = folioCurrentValue - folioRemainingCost;
    const folioUnrealizedGainPercentage =
      folioRemainingCost > 0
        ? (folioUnrealizedGain / folioRemainingCost) * 100
        : 0;
    const today = new Date();
    const folioAverageHoldingDays =
      folioRemainingUnits > 0.001
        ? unitQueue.reduce(
            (sum, u) =>
              sum +
              u.units *
                Math.floor((today - u.purchaseDate) / (1000 * 60 * 60 * 24)),
            0,
          ) / folioRemainingUnits
        : 0;

    folioSummaries[folio] = {
      folio,
      invested: folioInvested,
      withdrawn: folioWithdrawn,
      realizedGain: folioRealizedGain,
      totalUnitsPurchased: folioUnitsPurchased,
      totalUnitsRedeemed: folioUnitsRedeemed,
      remainingUnits: folioRemainingUnits > 0.001 ? folioRemainingUnits : 0,
      remainingCost: folioRemainingUnits > 0.001 ? folioRemainingCost : 0,
      currentValue: folioCurrentValue,
      unrealizedGain: folioUnrealizedGain,
      unrealizedGainPercentage: folioUnrealizedGainPercentage,
      averageHoldingDays: folioAverageHoldingDays,
      cashflows: folioCashflows[folio],
    };

    if (folioRemainingUnits > 0.001) {
      remainingUnitsAllFolios.push(
        ...unitQueue.map((b) => ({
          units: b.units,
          nav: b.nav,
          purchaseDate: b.purchaseDate,
          date: b.date,
        })),
      );
    }
  });

  const remainingCost = remainingUnitsAllFolios.reduce(
    (sum, batch) => sum + batch.units * batch.nav,
    0,
  );

  const totalUnitsRemaining = remainingUnitsAllFolios.reduce(
    (sum, batch) => sum + batch.units,
    0,
  );

  const averageRemainingCostPerUnit =
    totalUnitsRemaining > 0.001 ? remainingCost / totalUnitsRemaining : 0;

  let currentValue = 0;
  if (totalUnitsRemaining > 0.001) {
    // Prefer NAV × FIFO-remaining units for accuracy.
    // fund.valuation.value is computed as latestNAV × all-net-units which is wrong
    // when units have been partially redeemed and reinvested across the holding period.
    if (globalNavPerUnit > 0) {
      currentValue = globalNavPerUnit * totalUnitsRemaining;
    } else {
      currentValue = fund.valuation ? parseFloat(fund.valuation.value || 0) : 0;
    }
  }

  const unrealizedGain = currentValue - remainingCost;
  const unrealizedGainPercentage =
    remainingCost > 0 ? (unrealizedGain / remainingCost) * 100 : 0;
  const investedAmountForRealized =
    totalInvested - (remainingCost > 0 ? remainingCost : 0);

  const realizedGainPercentage =
    investedAmountForRealized > 0
      ? (realizedGain / investedAmountForRealized) * 100
      : 0;

  const today = new Date();
  const averageHoldingDays =
    totalUnitsRemaining > 0.001
      ? remainingUnitsAllFolios.reduce(
          (sum, batch) =>
            sum +
            batch.units *
              Math.floor((today - batch.purchaseDate) / (1000 * 60 * 60 * 24)),
          0,
        ) / totalUnitsRemaining
      : 0;

  const dailyValuation = calculateDailyValuationHistory(fund);
  return {
    totalInvested,
    totalWithdrawn,
    realizedGain,
    realizedGainPercentage,
    unrealizedGain,
    unrealizedGainPercentage,
    remainingCost: totalUnitsRemaining > 0.001 ? remainingCost : 0,
    currentValue,
    totalUnitsRemaining: totalUnitsRemaining > 0.001 ? totalUnitsRemaining : 0,
    averageRemainingCostPerUnit,
    averageHoldingDays,
    category,
    capitalGains: gains,
    folioSummaries,
    dailyValuation,
  };
}

function calculateDailyValuationHistory(fund) {
  const navHistory = fund.navHistory || [];

  if (
    navHistory.length === 0 ||
    !fund.transactions ||
    fund.transactions.length === 0
  ) {
    return [];
  }

  // Parse and sort NAV history
  const navMap = new Map();
  const sortedNavDates = [];

  navHistory.forEach((entry) => {
    const date = parseDate(entry.date);
    if (date) {
      const dateStr = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      navMap.set(dateStr, parseFloat(entry.nav));
      sortedNavDates.push(dateStr);
    }
  });

  sortedNavDates.sort();
  if (sortedNavDates.length === 0) return [];

  // Pre-process transactions
  const txByDate = new Map();
  fund.transactions.forEach((tx) => {
    const txDate = new Date(tx.date);
    const dateStr = `${txDate.getFullYear()}-${String(
      txDate.getMonth() + 1,
    ).padStart(2, "0")}-${String(txDate.getDate()).padStart(2, "0")}`;
    if (!txByDate.has(dateStr)) {
      txByDate.set(dateStr, []);
    }
    txByDate.get(dateStr).push(tx);
  });

  const firstTxDate = new Date(
    Math.min(...fund.transactions.map((tx) => new Date(tx.date))),
  );

  // Use today's date to include current valuation
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Get latest NAV from fund extended data
  const extendedData = fund.isin ? mfStats[fund.isin] : null;
  const latestNavValue = extendedData?.latest_nav
    ? parseFloat(extendedData.latest_nav)
    : null;

  // If we have latest NAV and it's not in navMap, add it
  if (latestNavValue && !navMap.has(todayStr)) {
    const latestNavDate = extendedData?.latest_nav_date || todayStr;
    navMap.set(latestNavDate, latestNavValue);
    sortedNavDates.push(latestNavDate);
    sortedNavDates.sort();
  }

  const latestDate = today;

  const dailyValuation = [];
  let unitQueue = [];
  let lastNav = null;

  // Process ALL dates from first transaction to today
  for (
    let d = new Date(firstTxDate);
    d <= latestDate;
    d.setDate(d.getDate() + 1)
  ) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(d.getDate()).padStart(2, "0")}`;

    // Process transactions for this date
    const txs = txByDate.get(dateStr) || [];
    txs.forEach((tx) => {
      const units = parseFloat(tx.units || 0);
      const nav = parseFloat(tx.nav || 0);

      if (tx.type === "PURCHASE") {
        unitQueue.push({
          units: units,
          purchaseNav: nav,
        });
      } else if (tx.type === "REDEMPTION") {
        let unitsToRemove = Math.abs(units);
        while (unitsToRemove > 0.0001 && unitQueue.length > 0) {
          const batch = unitQueue[0];
          if (batch.units <= unitsToRemove + 0.0001) {
            unitsToRemove -= batch.units;
            unitQueue.shift();
          } else {
            batch.units -= unitsToRemove;
            unitsToRemove = 0;
          }
        }
      }
    });

    // Get NAV - use current or carry forward
    const nav = navMap.get(dateStr) || lastNav;
    if (nav) lastNav = nav;

    const currentUnits = unitQueue.reduce((sum, batch) => sum + batch.units, 0);
    const currentCost = unitQueue.reduce(
      (sum, batch) => sum + batch.units * batch.purchaseNav,
      0,
    );

    if (nav && currentUnits > 0.001) {
      dailyValuation.push({
        date: dateStr,
        units: parseFloat(currentUnits.toFixed(4)),
        nav: nav,
        value: parseFloat((currentUnits * nav).toFixed(2)),
        cost: parseFloat(currentCost.toFixed(2)),
      });
    }
  }

  return dailyValuation;
}
function calculateSummary() {
  // Summary CAS has no transactions — delegate to the summary-specific path
  // so every call site gets correct data without needing its own isSummaryCAS check
  if (isSummaryCAS) return calculateSummarySummary();

  let totalInvested = 0;
  let totalWithdrawn = 0;
  let currentValue = 0;
  let totalRealizedGain = 0;
  let totalUnrealizedGain = 0;
  let totalRemainingCost = 0;

  allTimeFlows.length = 0;
  activeFlows.length = 0;

  // Reset capital gains
  capitalGainsData = {
    byYear: {},
    currentYear: {
      equity: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
      debt: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
      hybrid: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
    },
    allTime: {
      equity: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
      debt: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
      hybrid: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
    },
  };

  const currentFY = getFinancialYear(new Date());

  // Get hidden folios
  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  Object.entries(fundWiseData).forEach(([key, fund]) => {
    const fifo = calculateadvancedMetrics(fund);

    totalInvested += fifo.totalInvested;
    totalWithdrawn += fifo.totalWithdrawn;
    currentValue += fifo.currentValue;
    totalRealizedGain += fifo.realizedGain;
    totalUnrealizedGain += fifo.unrealizedGain;
    totalRemainingCost += fifo.remainingCost;

    fund.advancedMetrics = fifo;

    // Aggregate capital gains
    const category = fifo.category;
    capitalGainsData.allTime[category].stcg += fifo.capitalGains.stcg;
    capitalGainsData.allTime[category].ltcg += fifo.capitalGains.ltcg;
    capitalGainsData.allTime[category].stcgRedeemed +=
      fifo.capitalGains.stcgRedeemed;
    capitalGainsData.allTime[category].ltcgRedeemed +=
      fifo.capitalGains.ltcgRedeemed;

    // Aggregate by Financial Year
    Object.entries(fifo.capitalGains.byYear).forEach(([fy, yearData]) => {
      if (!capitalGainsData.byYear[fy]) {
        capitalGainsData.byYear[fy] = {
          equity: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
          debt: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
          hybrid: { stcg: 0, ltcg: 0, stcgRedeemed: 0, ltcgRedeemed: 0 },
        };
      }
      capitalGainsData.byYear[fy][category].stcg += yearData.stcg;
      capitalGainsData.byYear[fy][category].ltcg += yearData.ltcg;
      capitalGainsData.byYear[fy][category].stcgRedeemed +=
        yearData.stcgRedeemed;
      capitalGainsData.byYear[fy][category].ltcgRedeemed +=
        yearData.ltcgRedeemed;

      // Track current FY separately
      if (fy === currentFY) {
        capitalGainsData.currentYear[category].stcg += yearData.stcg;
        capitalGainsData.currentYear[category].ltcg += yearData.ltcg;
        capitalGainsData.currentYear[category].stcgRedeemed +=
          yearData.stcgRedeemed;
        capitalGainsData.currentYear[category].ltcgRedeemed +=
          yearData.ltcgRedeemed;
      }
    });

    // Build cashflows from advancedMetrics.folioSummaries
    const fundCurrentValue = fifo.currentValue;
    const isActiveFund = fundCurrentValue > 0;

    Object.values(fifo.folioSummaries).forEach((folioSummary) => {
      // Skip hidden folios in cashflow calculations
      const folioNum = folioSummary.folio;
      const uniqueKey = `${folioNum}|${fund.scheme}`;

      if (hiddenFolios.includes(folioNum) || hiddenFolios.includes(uniqueKey)) {
        console.log(`⭐️ Skipping hidden folio in cashflows: ${folioNum}`);
        return;
      }

      folioSummary.cashflows.forEach((cf) => {
        const enriched = {
          scheme: fund.schemeDisplay || fund.scheme,
          folio: folioSummary.folio,
          type: cf.type === "Buy" ? "PURCHASE" : "REDEMPTION",
          date: new Date(cf.date),
          amount: parseFloat(cf.amount), // Ensure it's a number
          nav: cf.nav,
          units: cf.units,
        };

        // Add ALL cashflows to allTimeFlows (both purchases and redemptions)
        allTimeFlows.push(enriched);

        // For active funds, add to activeFlows
        if (isActiveFund) {
          activeFlows.push(enriched);
        }
      });
    });
  });

  if (currentValue > 0) {
    const valuationFlow = {
      scheme: "Portfolio Valuation",
      folio: "Current",
      type: "VALUATION",
      date: new Date(),
      amount: parseFloat(currentValue),
      nav: null,
      units: null,
    };
    allTimeFlows.push(valuationFlow);
    activeFlows.push(valuationFlow);
  }

  allTimeFlows.sort((a, b) => a.date - b.date);
  activeFlows.sort((a, b) => a.date - b.date);

  const overallGain = totalRealizedGain + totalUnrealizedGain;

  let allTimeXirr = null;
  if (allTimeFlows.length >= 2) {
    const cashFlowsSimple = allTimeFlows.map((cf) => ({
      date: cf.date instanceof Date ? cf.date : new Date(cf.date),
      amount: cf.amount,
    }));
    allTimeXirr = calculatePortfolioXIRR(cashFlowsSimple);
  }

  let activeXirr = null;
  if (activeFlows.length >= 2) {
    const cashFlowsSimple = activeFlows.map((cf) => ({
      date: cf.date instanceof Date ? cf.date : new Date(cf.date),
      amount: cf.amount,
    }));
    activeXirr = calculatePortfolioXIRR(cashFlowsSimple);
  }

  updatePortfolioDataWithActiveStatus();

  return {
    totalInvested,
    totalWithdrawn,
    currentValue,
    overallGain,
    realizedGain: totalRealizedGain,
    unrealizedGain: totalUnrealizedGain,
    costPrice: totalRemainingCost,
    allTimeXirr,
    activeXirr,
  };
}
function calculateSummarySummary() {
  let totalInvested = 0;
  let totalWithdrawn = 0;
  let currentValue = 0;
  let totalRealizedGain = 0;
  let totalUnrealizedGain = 0;
  let totalRemainingCost = 0;

  Object.values(fundWiseData).forEach((fund) => {
    totalInvested += fund.advancedMetrics.totalInvested;
    currentValue += fund.advancedMetrics.currentValue;
    totalUnrealizedGain += fund.advancedMetrics.unrealizedGain;
    totalRemainingCost += fund.advancedMetrics.remainingCost;
  });

  const overallGain = totalRealizedGain + totalUnrealizedGain;

  return {
    totalInvested,
    totalWithdrawn,
    currentValue,
    overallGain,
    realizedGain: totalRealizedGain,
    unrealizedGain: totalUnrealizedGain,
    costPrice: totalRemainingCost,
    allTimeXirr: null,
    activeXirr: null,
  };
}
function calculateWeightedHoldingDays() {
  let totalWeightedDays = 0;
  let totalValue = 0;

  Object.entries(fundWiseData).forEach(([key, fund]) => {
    const fifo = fund.advancedMetrics;

    // Skip if data missing or invalid
    if (!fifo || fifo.currentValue == null || fifo.averageHoldingDays == null)
      return;

    totalWeightedDays += fifo.currentValue * fifo.averageHoldingDays;
    totalValue += fifo.currentValue;
  });

  if (totalValue === 0) return 0;

  return parseFloat(totalWeightedDays / totalValue).toFixed(1);
}
function calculatePortfolioXIRR(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) {
    console.log("Failed: cashFlows length < 2:", cashFlows?.length);
    return null;
  }

  const hasOutflow = cashFlows.some((cf) => cf.amount < 0);
  const hasInflow = cashFlows.some((cf) => cf.amount > 0);

  if (!hasOutflow || !hasInflow) {
    console.log(
      "Failed: missing outflow or inflow. Outflow:",
      hasOutflow,
      "Inflow:",
      hasInflow,
    );
    return null;
  }

  // Sort cashflows by date to ensure chronological order
  const sortedCashFlows = [...cashFlows].sort((a, b) => a.date - b.date);

  const calc = new XIRRCalculator();

  sortedCashFlows.forEach((cf) => {
    const type = cf.amount < 0 ? "buy" : "sell";
    calc.addTransaction(type, cf.date, Math.abs(cf.amount));
  });

  try {
    const xirr = calc.calculateXIRR();

    // Validate result - reject unrealistic values
    if (xirr && !isNaN(xirr) && Math.abs(xirr) < 10000) {
      return xirr;
    }

    console.log("XIRR calculation returned unrealistic value:", xirr);
    return null;
  } catch (error) {
    console.log("XIRR calculation failed:", error.message);
    return null;
  }
}
function calculateOverlapAnalysis() {
  const overlapData = {
    fundPairs: [],
    topOverlaps: [],
    commonHoldings: {},
  };

  const activeFunds = Object.entries(fundWiseData)
    .filter(([, fund]) => fund.advancedMetrics?.currentValue > 0)
    .map(([key, fund]) => ({ key, ...fund }));

  if (activeFunds.length < 2) {
    return { error: "Need at least 2 active funds to analyze overlap" };
  }

  // Calculate pairwise overlap
  for (let i = 0; i < activeFunds.length; i++) {
    for (let j = i + 1; j < activeFunds.length; j++) {
      const fund1 = activeFunds[i];
      const fund2 = activeFunds[j];

      if (!fund1.holdings || !fund2.holdings) continue;

      const holdings1 = new Map(
        fund1.holdings.map((h) => [
          h.company_name,
          parseFloat(h.corpus_per || 0),
        ]),
      );
      const holdings2 = new Map(
        fund2.holdings.map((h) => [
          h.company_name,
          parseFloat(h.corpus_per || 0),
        ]),
      );

      let overlapPercentage = 0;
      const commonStocks = [];

      holdings1.forEach((percent1, company) => {
        if (holdings2.has(company)) {
          const percent2 = holdings2.get(company);
          const minPercent = Math.min(percent1, percent2);
          overlapPercentage += minPercent;
          commonStocks.push({
            company,
            fund1Percent: percent1,
            fund2Percent: percent2,
          });
        }
      });

      if (overlapPercentage > 0) {
        overlapData.fundPairs.push({
          fund1: fund1.schemeDisplay || fund1.scheme,
          fund2: fund2.schemeDisplay || fund2.scheme,
          fund1Key: fund1.key,
          fund2Key: fund2.key,
          overlapPercent: overlapPercentage.toFixed(2),
          commonStocks: commonStocks.sort(
            (a, b) =>
              Math.min(b.fund1Percent, b.fund2Percent) -
              Math.min(a.fund1Percent, a.fund2Percent),
          ),
        });
      }
    }
  }

  // Sort by overlap percentage
  overlapData.fundPairs.sort((a, b) => b.overlapPercent - a.overlapPercent);

  // Return pairs with overlapping > 5%
  overlapData.topOverlaps = overlapData.fundPairs.filter(
    (pair) => pair.overlapPercent > 5,
  );

  // Find most common holdings across all funds
  const holdingCounts = new Map();
  activeFunds.forEach((fund) => {
    if (!fund.holdings) return;
    const fundName = fund.schemeDisplay || fund.scheme;
    const processedCompanies = new Set();

    fund.holdings.forEach((holding) => {
      const company = holding.company_name;

      if (processedCompanies.has(company)) return;
      processedCompanies.add(company);

      if (!holdingCounts.has(company)) {
        holdingCounts.set(company, {
          count: 0,
          funds: [],
          fundWeights: [],
          totalWeight: 0,
        });
      }
      const data = holdingCounts.get(company);
      data.count++;
      data.funds.push(fundName);
      const weight = parseFloat(holding.corpus_per || 0);
      data.fundWeights.push({ fund: fundName, weight });
      data.totalWeight += weight;
    });
  });

  // Find stocks in 3+ funds
  overlapData.commonHoldings = Array.from(holdingCounts.entries())
    .filter(
      ([company, data]) =>
        data.count >= 3 && !company.toUpperCase().includes("GOI"),
    )
    .map(([company, data]) => ({
      company,
      fundCount: data.count,
      funds: data.funds,
      fundWeights: data.fundWeights.sort((a, b) => b.weight - a.weight),
      avgWeight: (data.totalWeight / data.count).toFixed(2),
    }))
    .sort((a, b) => b.fundCount - a.fundCount)
    .slice(0, 20);

  return overlapData;
}
function calculatePairOverlap(fundKey1, fundKey2) {
  const fund1 = fundWiseData[fundKey1];
  const fund2 = fundWiseData[fundKey2];

  if (!fund1 || !fund2 || fundKey1 === fundKey2) return null;
  if (!fund1.holdings || !fund2.holdings) return null;

  const holdings1 = new Map(
    fund1.holdings.map((h) => [h.company_name, parseFloat(h.corpus_per || 0)]),
  );
  const holdings2 = new Map(
    fund2.holdings.map((h) => [h.company_name, parseFloat(h.corpus_per || 0)]),
  );

  let overlapPercentage = 0;
  const commonStocks = [];

  holdings1.forEach((percent1, company) => {
    if (holdings2.has(company)) {
      const percent2 = holdings2.get(company);
      overlapPercentage += Math.min(percent1, percent2);
      commonStocks.push({
        company,
        fund1Percent: percent1,
        fund2Percent: percent2,
      });
    }
  });

  commonStocks.sort(
    (a, b) =>
      Math.min(b.fund1Percent, b.fund2Percent) -
      Math.min(a.fund1Percent, a.fund2Percent),
  );

  return {
    fund1Key: fundKey1,
    fund2Key: fundKey2,
    fund1: fund1.schemeDisplay || fund1.scheme,
    fund2: fund2.schemeDisplay || fund2.scheme,
    overlapPercent: Math.max(0, overlapPercentage).toFixed(2),
    commonStocks,
  };
}
function getOverlapLevelInfo(overlapPercent) {
  const pct = parseFloat(overlapPercent);
  if (pct > 50) {
    return {
      levelLabel: "High Overlap",
      diversificationLabel: "Poor Diversification",
      description:
        "Funds show high overlap, indicating poor diversification between both funds.",
      cls: "loss",
    };
  }
  if (pct > 25) {
    return {
      levelLabel: "Medium Overlap",
      diversificationLabel: "Limited Diversification",
      description:
        "Funds show medium overlap, indicating limited diversification between both funds.",
      cls: "warning",
    };
  }
  return {
    levelLabel: "Low Overlap",
    diversificationLabel: "Good Diversification",
    description:
      "Funds show low overlap, indicating good diversification between both funds.",
    cls: "gain",
  };
}
function calculateExpenseImpact() {
  const result = {
    totalExpenseRatio: 0,
    weightedExpenseRatio: 0,
    annualCost: 0,
    lifetimeCost: 0,
    funds: [],
  };

  let totalValue = 0;
  let weightedER = 0;

  Object.values(fundWiseData).forEach((fund) => {
    const value = fund.advancedMetrics?.currentValue || 0;
    if (value <= 0) return;

    const extendedData = mfStats[fund.isin];
    const expenseRatio = parseFloat(extendedData?.expense_ratio || 0);
    const holdingDays = fund.advancedMetrics?.averageHoldingDays || 0;
    const holdingYears = holdingDays / 365;

    const annualCost = (value * expenseRatio) / 100;
    const lifetimeCost = annualCost * Math.max(holdingYears, 1);

    result.funds.push({
      name: fund.schemeDisplay || fund.scheme,
      value: value,
      expenseRatio: expenseRatio,
      annualCost: annualCost,
      lifetimeCost: lifetimeCost,
      holdingYears: holdingYears,
    });

    totalValue += value;
    weightedER += expenseRatio * (value / 1); // Will normalize later
    result.annualCost += annualCost;
    result.lifetimeCost += lifetimeCost;
  });

  if (totalValue > 0) {
    result.weightedExpenseRatio = weightedER / totalValue;
  }

  result.funds.sort((a, b) => b.annualCost - a.annualCost);

  return result;
}
function calculateHealthScore() {
  const scores = {
    diversification: 0,
    expenseRatio: 0,
    performance: 0,
    overlap: 0,
    overall: 0,
    details: {},
  };

  const activeFunds = Object.values(fundWiseData).filter(
    (f) => f.advancedMetrics?.currentValue > 0,
  );

  if (activeFunds.length === 0) {
    return { error: "No active funds to analyze" };
  }

  // 1. Diversification Score (25 points)
  const fundCount = activeFunds.length;
  if (fundCount >= 8) scores.diversification = 25;
  else if (fundCount >= 5) scores.diversification = 20;
  else if (fundCount >= 3) scores.diversification = 15;
  else scores.diversification = 10;

  scores.details.diversification = {
    score: scores.diversification,
    max: 25,
    message: `You have ${fundCount} active funds`,
  };

  // 2. Expense Ratio Score (25 points)
  let totalValue = 0;
  let weightedER = 0;

  activeFunds.forEach((fund) => {
    const value = fund.advancedMetrics.currentValue;
    const er = parseFloat(mfStats[fund.isin]?.expense_ratio || 0);
    totalValue += value;
    weightedER += er * value;
  });

  const avgER = totalValue > 0 ? weightedER / totalValue : 0;

  if (avgER < 0.6) scores.expenseRatio = 25;
  else if (avgER < 1.0) scores.expenseRatio = 20;
  else if (avgER < 1.5) scores.expenseRatio = 15;
  else if (avgER < 2.0) scores.expenseRatio = 10;
  else scores.expenseRatio = 5;

  scores.details.expenseRatio = {
    score: scores.expenseRatio,
    max: 25,
    message: `Weighted expense ratio: ${avgER.toFixed(2)}%`,
  };

  // 3. Performance Score (25 points)
  let outperformers = 0;
  let benchmarkComparisons = 0;

  activeFunds.forEach((fund) => {
    const extended = mfStats[fund.isin];
    if (!extended?.return_stats) return;

    const fundReturn = extended.return_stats.return3y;
    const benchmarkReturn = fund?.benchmark_returns?.return3y;

    if (fundReturn != null && benchmarkReturn != null) {
      benchmarkComparisons++;
      if (fundReturn > benchmarkReturn) outperformers++;
    }
  });

  if (benchmarkComparisons === 0) {
    activeFunds.forEach((fund) => {
      const extended = mfStats[fund.isin];
      if (!extended?.return_stats) return;

      const fundReturn = extended.return_stats.return3y;
      const categoryReturn = extended.return_stats.cat_return3y;

      if (fundReturn != null && categoryReturn != null) {
        benchmarkComparisons++;
        if (fundReturn > categoryReturn) outperformers++;
      }
    });
  }

  const outperformRatio =
    benchmarkComparisons > 0 ? outperformers / benchmarkComparisons : 0.5; // Default to 50% if no data

  if (outperformRatio >= 0.7) scores.performance = 25;
  else if (outperformRatio >= 0.5) scores.performance = 20;
  else if (outperformRatio >= 0.3) scores.performance = 15;
  else scores.performance = 10;

  scores.details.performance = {
    score: scores.performance,
    max: 25,
    message:
      benchmarkComparisons > 0
        ? `${outperformers}/${benchmarkComparisons} funds beating benchmark`
        : "Insufficient benchmark data available",
  };

  // 4. Overlap Score (25 points)
  const overlapData = calculateOverlapAnalysis();

  if (overlapData.error) {
    scores.overlap = 20;
    scores.details.overlap = {
      score: 20,
      max: 25,
      message: "Not enough funds to assess overlap",
    };
  } else {
    const highOverlaps = overlapData.fundPairs.filter(
      (p) => p.overlapPercent > 50,
    ).length;
    const mediumOverlaps = overlapData.fundPairs.filter(
      (p) => p.overlapPercent > 25 && p.overlapPercent <= 50,
    ).length;

    if (highOverlaps === 0 && mediumOverlaps === 0) scores.overlap = 25;
    else if (highOverlaps === 0) scores.overlap = 20;
    else if (highOverlaps <= 2) scores.overlap = 15;
    else scores.overlap = 10;

    scores.details.overlap = {
      score: scores.overlap,
      max: 25,
      message: `${highOverlaps} high overlap pairs, ${mediumOverlaps} medium`,
    };
  }

  scores.overall =
    scores.diversification +
    scores.expenseRatio +
    scores.performance +
    scores.overlap;

  return scores;
}
function calculateMonthlySummary() {
  if (!fundWiseData || Object.keys(fundWiseData).length === 0) {
    return null;
  }

  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  // Get all transactions
  const allTransactions = [];
  Object.values(fundWiseData).forEach((fund) => {
    fund.transactions.forEach((tx) => {
      const txFolio = tx.folio || "unknown";
      const uniqueKey = `${txFolio}|${fund.scheme}`;

      // Skip hidden folios
      if (hiddenFolios.includes(txFolio) || hiddenFolios.includes(uniqueKey)) {
        return;
      }

      allTransactions.push({
        date: new Date(tx.date),
        type: tx.type,
        amount: Math.abs(parseFloat(tx.nav * tx.units) || 0),
      });
    });
  });

  if (allTransactions.length === 0) {
    return null;
  }

  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), 1);

  function calculateAveragesForPeriod(periodMonths) {
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - periodMonths + 1);

    // Create monthly buckets (same as netinvest chart)
    const monthlyData = {};
    const current = new Date(startDate);

    while (current <= endDate) {
      const key = current.toLocaleDateString("en-IN", {
        year: "2-digit",
        month: "short",
      });
      monthlyData[key] = { investment: 0, withdrawal: 0 };
      current.setMonth(current.getMonth() + 1);
    }

    // Fill in transaction data
    allTransactions.forEach((tx) => {
      if (tx.date >= startDate && tx.date <= now) {
        const key = tx.date.toLocaleDateString("en-IN", {
          year: "2-digit",
          month: "short",
        });

        if (monthlyData[key]) {
          if (tx.type === "PURCHASE") {
            monthlyData[key].investment += tx.amount;
          } else if (tx.type === "REDEMPTION") {
            monthlyData[key].withdrawal += tx.amount;
          }
        }
      }
    });

    // Calculate totals and averages
    let totalBuy = 0;
    let totalSell = 0;

    Object.values(monthlyData).forEach((data) => {
      totalBuy += data.investment;
      totalSell += data.withdrawal;
    });

    const monthCount = Object.keys(monthlyData).length;
    const avgNetInflow = (totalBuy - totalSell) / monthCount;
    const inflow =
      avgNetInflow < 0
        ? monthCount == 6
          ? default6M
          : default12M
        : avgNetInflow;

    return {
      avgBuy: totalBuy / monthCount,
      avgSell: totalSell / monthCount,
      avgNetInflow: avgNetInflow,
      inflow: inflow,
    };
  }

  const summary6M = calculateAveragesForPeriod(6);
  const summary12M = calculateAveragesForPeriod(12);

  return {
    sixMonths: summary6M,
    twelveMonths: summary12M,
  };
}

// PORTFOLIO ANALYTICS
function calculateAndDisplayPortfolioAnalytics() {
  try {
    document.getElementById("assetAllocationCard")?.classList.add("loading");
    document.getElementById("marketCapCard")?.classList.add("loading");
    document.getElementById("debtDistributionCard")?.classList.add("loading");
    document.getElementById("sectorCard")?.classList.add("loading");
    document.getElementById("debtSectorCard")?.classList.add("loading");
    document.getElementById("amcCard")?.classList.add("loading");
    document.getElementById("holdingsCard")?.classList.add("loading");

    // Restore canvas elements if a previous render swapped them out for an
    // "empty" / "DATA NOT AVAILABLE" placeholder, so buildDoughnutChart has
    // a <canvas> to attach to.
    const ensureCanvas = (cardId, canvasId) => {
      const card = document.getElementById(cardId);
      if (!card) return;
      const wrapper = card.querySelector(".chart-wrapper");
      if (wrapper && !wrapper.querySelector(`#${canvasId}`)) {
        wrapper.innerHTML = `<canvas id="${canvasId}"></canvas>`;
      }
    };
    ensureCanvas("assetAllocationCard", "assetAllocationChart");
    ensureCanvas("marketCapCard", "marketCapChart");
    ensureCanvas("debtDistributionCard", "debtDistributionChart");

    setTimeout(() => {
      const analytics = calculatePortfolioAnalytics();

      setTimeout(() => {
        displayAssetAllocation(analytics.assetAllocation);
        displayMarketCapSplit(
          analytics.marketCap,
          analytics.assetAllocation,
          analytics.totalValue,
        );
        displayDebtDistribution(
          analytics.debtDistribution,
          analytics.assetAllocation,
          analytics.totalValue,
        );
      }, 200);

      setTimeout(() => {
        displayAMCSplit(analytics.amc, analytics.totalValue);
      }, 100);

      setTimeout(() => {
        displaySectorSplit(
          analytics.sector,
          analytics.assetAllocation,
          analytics.totalValue,
        );
      }, 100);

      setTimeout(() => {
        displayDebtSectorSplit(
          analytics.debtSector,
          analytics.assetAllocation,
          analytics.totalValue,
        );
      }, 100);

      setTimeout(() => {
        displayHoldingsSplit(
          analytics.holdings,
          analytics.assetAllocation,
          analytics.totalValue,
        );
      }, 100);

      setTimeout(() => {
        displayWeightedReturns(
          analytics.weightedReturns,
          "weightedReturnsContainer",
        );
      }, 100);
    }, 100);
  } catch (err) {
    console.error("Portfolio analytics failed:", err);
    document.getElementById("assetAllocationCard")?.classList.remove("loading");
    document.getElementById("marketCapCard")?.classList.remove("loading");
    document
      .getElementById("debtDistributionCard")
      ?.classList.remove("loading");
    document.getElementById("sectorCard")?.classList.remove("loading");
    document.getElementById("debtSectorCard")?.classList.remove("loading");
    document.getElementById("amcCard")?.classList.remove("loading");
    document.getElementById("holdingsCard")?.classList.remove("loading");
  }
}

// ============================================================
// ASSET CLASS CLASSIFICATION (per holding from fund holdings)
// ============================================================
function getAssetClass(holding) {
  const instrument = (holding.instrument_name || "").toLowerCase().trim();
  const company = (holding.company_name || "").toLowerCase().trim();
  const nature = (holding.nature_name || "").toLowerCase().trim();

  // Gold
  if (company.includes("gold etf") || instrument.includes("gold")) {
    return "Gold";
  }
  // Silver
  if (company.includes("silver etf") || instrument.includes("silver")) {
    return "Silver";
  }
  // REITs + InvITs
  if (
    nature === "realest" ||
    instrument.includes("reit") ||
    instrument.includes("real estate investment trust") ||
    instrument.includes("invit")
  ) {
    return "Real Estate";
  }
  // Hedged Equity (Futures)
  if (instrument === "futures") {
    return "Hedged Equity";
  }
  // Global Equity (Foreign Equity)
  if (
    instrument.includes("foreign") ||
    instrument.includes("forgn") ||
    instrument === "ads/adr" ||
    instrument === "foreign mf"
  ) {
    return "Global Equity";
  }
  // Debt
  if (
    nature === "debt" ||
    [
      "certificate of deposit",
      "commercial paper",
      "treasury bills",
      "goi sec",
      "sdl",
      "debenture",
    ].includes(instrument)
  ) {
    return "Debt";
  }
  // Cash & cash equivalents
  if (
    nature === "cash" ||
    ["reverse repo", "cash margin", "net payables"].includes(instrument)
  ) {
    return "Cash";
  }
  // Domestic Equity
  if (["equity", "eq"].includes(nature) && instrument === "equity") {
    return "Domestic Equity";
  }
  // Everything else: Mutual Funds, ETFs, Futures, Derivatives, Unknown
  return "Other";
}

/**
 * Canonical asset-allocation resolver.
 *
 * Derives a flat bucket map from a fund's portfolio_stats.asset_allocation
 * object, using the fund's holdings array only for two targeted splits:
 *
 *   • "equity" key  → split into "domestic equity" / "global equity" by
 *     filtering holdings where nature_name === "EQUITY" and checking
 *     whether instrument_name === "Foreign - Equity" (→ Global) or not
 *     (→ Domestic).  Falls back to 100 % Domestic when no EQUITY holdings
 *     are found.
 *
 *   • "commodities" key → split into "gold" / "silver" by checking whether
 *     instrument_name (case-insensitive) contains "gold" or "silver".
 *     Falls back to 100 % gold when no commodity holdings are found.
 *
 *   • All other keys (debt, cash, real estate, reit, other, …) are mapped
 *     directly to their canonical lowercase label without touching holdings.
 *
 * @param  {Object} fundAsset  portfolio_stats.asset_allocation  (key → %)
 * @param  {Array}  holdings   fund holdings array (may be empty / null)
 * @param  {number} weight     portfolio weight of this fund (0–1); each
 *                             bucket value is expressed as weight × alloc %
 * @returns {Object}  e.g. { "domestic equity": 18.4, "global equity": 3.1,
 *                            "gold": 2.0, "debt": 12.5, … }
 */
function resolveAssetAllocation(fundAsset, holdings, weight) {
  const buckets = {};
  const safeHoldings = Array.isArray(holdings) ? holdings : [];

  Object.entries(fundAsset).forEach(([key, value]) => {
    const val = parseFloat(value);
    if (val == null || isNaN(val)) return;

    // Contribution of this key to the overall portfolio (in %).
    // Note: negative values (e.g. cash: -0.7) are intentionally kept so
    // that the bucket totals stay proportional to the API's own sum.
    // We only skip truly absent / NaN entries, not negatives.
    const allocPct = (val / 100) * weight * 100;
    const keyLower = key.trim().toLowerCase();

    // Negative allocations (e.g. net-payable cash) are passed through as
    // negative buckets so callers can decide whether to display them.
    // The guard below drops them from display buckets only for non-cash
    // asset classes where a negative makes no semantic sense.
    const isNegative = val < 0;
    // For cash, allow negative through — it represents net payables.
    // For everything else, skip negatives (they are data artefacts).
    if (isNegative && !keyLower.includes("cash")) return;

    // ── HEDGED EQUITY: pass through directly — must be checked before the
    //    generic "equity" branch so "hedged equity" isn't caught by it. ───
    if (keyLower.includes("hedged")) {
      buckets["hedged equity"] = (buckets["hedged equity"] || 0) + allocPct;
      return;
    }

    // ── EQUITY: split Domestic vs Global via holdings ──────────────────────
    if (keyLower.includes("equity")) {
      const equityHoldings = safeHoldings.filter(
        (h) => (h.nature_name || "").toUpperCase() === "EQUITY",
      );

      if (equityHoldings.length === 0) {
        // No granular data — treat everything as domestic
        buckets["domestic equity"] =
          (buckets["domestic equity"] || 0) + allocPct;
        return;
      }

      let globalCorpus = 0;
      let domesticCorpus = 0;

      equityHoldings.forEach((h) => {
        const corpus = parseFloat(h.corpus_per || 0);
        if (corpus <= 0) return;
        if (h.instrument_name === "Foreign - Equity") {
          globalCorpus += corpus;
        } else {
          domesticCorpus += corpus;
        }
      });

      const equityTotal = domesticCorpus + globalCorpus;

      if (equityTotal === 0) {
        buckets["domestic equity"] =
          (buckets["domestic equity"] || 0) + allocPct;
        return;
      }

      if (domesticCorpus > 0) {
        buckets["domestic equity"] =
          (buckets["domestic equity"] || 0) +
          (domesticCorpus / equityTotal) * allocPct;
      }
      if (globalCorpus > 0) {
        buckets["global equity"] =
          (buckets["global equity"] || 0) +
          (globalCorpus / equityTotal) * allocPct;
      }
      return;
    }

    // ── COMMODITIES: split Gold vs Silver via holdings ──────────────────────
    if (keyLower.includes("commodit")) {
      const commodityHoldings = safeHoldings.filter((h) => {
        const inst = (h.instrument_name || "").toLowerCase();
        return inst.includes("gold") || inst.includes("silver");
      });

      if (commodityHoldings.length === 0) {
        // No granular data — treat everything as gold (conservative fallback)
        buckets["gold"] = (buckets["gold"] || 0) + allocPct;
        return;
      }

      let goldCorpus = 0;
      let silverCorpus = 0;

      commodityHoldings.forEach((h) => {
        const corpus = parseFloat(h.corpus_per || 0);
        if (corpus <= 0) return;
        const inst = (h.instrument_name || "").toLowerCase();
        if (inst.includes("silver")) {
          silverCorpus += corpus;
        } else {
          goldCorpus += corpus;
        }
      });

      const commTotal = goldCorpus + silverCorpus;

      if (commTotal === 0) {
        buckets["gold"] = (buckets["gold"] || 0) + allocPct;
        return;
      }

      if (goldCorpus > 0) {
        buckets["gold"] =
          (buckets["gold"] || 0) + (goldCorpus / commTotal) * allocPct;
      }
      if (silverCorpus > 0) {
        buckets["silver"] =
          (buckets["silver"] || 0) + (silverCorpus / commTotal) * allocPct;
      }
      return;
    }

    // ── ALL OTHER KEYS: direct label mapping ────────────────────────────────
    const label = _mapAssetKeyToLabel(keyLower);
    buckets[label] = (buckets[label] || 0) + allocPct;
  });

  return buckets;
}

/** Map a raw portfolio_stats.asset_allocation key to its canonical label. */
function _mapAssetKeyToLabel(keyLower) {
  if (keyLower.includes("hedged")) return "hedged equity";
  if (keyLower.includes("real estate") || keyLower.includes("reit"))
    return "real estate";
  if (keyLower.includes("debt")) return "debt";
  if (keyLower.includes("cash")) return "cash";
  if (keyLower.includes("gold")) return "gold";
  if (keyLower.includes("silver")) return "silver";
  return "other";
}

/**
 * Thin shim kept for any call-site that still passes a single (key, allocPct,
 * holdings) triple.  Internally delegates to resolveAssetAllocation so that
 * the splitting logic remains in one place.
 *
 * @deprecated  Prefer resolveAssetAllocation(fundAsset, holdings, weight).
 */
function splitAssetKeyByHoldings(key, allocPct, holdings) {
  // Reconstruct a minimal fundAsset map and weight=1 so that allocPct passes
  // through unchanged.
  const pseudoFundAsset = { [key]: allocPct }; // allocPct is already scaled %
  // resolveAssetAllocation multiplies (val/100)*weight*100 = val when weight=1
  return resolveAssetAllocation(pseudoFundAsset, holdings, 1);
}

/**
 * Derives debt instrument breakdown from a fund's holdings array.
 * Filters to holdings where nature_name === "DEBT" and groups by
 * instrument_name, returning corpus_per-weighted bucket percentages
 * scaled by the fund's portfolio weight.
 *
 * Canonical instrument_name groups (title-cased for display):
 *   Government Securities, State Dev. Loans, Treasury Bills,
 *   Certificate of Deposit, Commercial Paper, Debenture, Others
 *
 * @param  {Array}  holdings  fund holdings array
 * @param  {number} weight    portfolio weight of this fund (0–1)
 * @returns {Object}  e.g. { "Government Securities": 4.2, "Debenture": 8.1, … }
 */
function resolveDebtDistribution(holdings, weight) {
  const buckets = {};
  if (!Array.isArray(holdings) || holdings.length === 0) return buckets;

  const debtHoldings = holdings.filter(
    (h) => (h.nature_name || "").toUpperCase() === "DEBT",
  );
  if (debtHoldings.length === 0) return buckets;

  let debtCorpusTotal = 0;
  const rawBuckets = {};

  debtHoldings.forEach((h) => {
    const corpus = parseFloat(h.corpus_per || 0);
    if (corpus <= 0) return;
    const label = _normalizeDebtInstrumentLabel(h.instrument_name || "Others");
    rawBuckets[label] = (rawBuckets[label] || 0) + corpus;
    debtCorpusTotal += corpus;
  });

  if (debtCorpusTotal === 0) return buckets;

  // Scale each bucket to the fund's portfolio weight
  Object.entries(rawBuckets).forEach(([label, corpus]) => {
    buckets[label] = (corpus / debtCorpusTotal) * weight * 100;
  });

  return buckets;
}

/** Normalize a raw instrument_name into a clean display label for debt. */
function _normalizeDebtInstrumentLabel(raw) {
  const s = raw.trim().toLowerCase();
  if (
    s.includes("goi") ||
    s.includes("government") ||
    s.includes("g-sec") ||
    s.includes("gsec")
  )
    return "Government Securities";
  if (s.includes("sdl") || s.includes("state dev")) return "State Dev. Loans";
  if (s.includes("treasury") || s.includes("t-bill") || s.includes("tbill"))
    return "Treasury Bills";
  if (s.includes("certificate of deposit") || s === "cd")
    return "Certificate of Deposit";
  if (s.includes("commercial paper") || s === "cp") return "Commercial Paper";
  if (s.includes("debenture") || s.includes("ncd")) return "Debenture / NCD";
  if (s.includes("repo")) return "Repo";
  if (s.includes("floating") || s.includes("frb")) return "Floating Rate Bonds";
  if (s.includes("zero coupon") || s.includes("zcb"))
    return "Zero Coupon Bonds";
  if (s === "" || s === "others" || s === "other") return "Others";
  // Title-case the raw value as a catch-all
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function applyGroupedMarketCapLegend(canvasId, labels, data, totalValue) {
  const wrapper = document.getElementById(canvasId)?.closest(".chart-wrapper");

  const labelsContainer = wrapper?.querySelector(".donut-labels");

  if (!labelsContainer) return;

  const colors = labels.map((_, i) => getTbcColor(i));

  renderMarketCapGroupedLegend(
    labelsContainer,
    labels,
    data,
    totalValue,
    colors,
  );
}

function renderMarketCapGroupedLegend(
  container,
  labels,
  data,
  totalValue,
  colors,
) {
  const domestic = [];
  const other = [];

  labels.forEach((label, i) => {
    const item = {
      label,
      pct: data[i],
      rupees: Math.round((totalValue * data[i]) / 100),
      color: colors[i],
    };

    if (label === "Large" || label === "Mid" || label === "Small") {
      domestic.push(item);
    } else {
      other.push(item);
    }
  });

  const renderItems = (items) =>
    items
      .map(
        (item) => `
        <div class="donut-label-item">
          <span class="donut-label-color"
                style="background:${item.color}">
          </span>
          <span class="donut-label-name">${item.label}</span>
          <span class="donut-label-value">
            ₹${formatNumber(item.rupees)}
            (${item.pct.toFixed(2)}%)
          </span>
        </div>
      `,
      )
      .join("");

  container.innerHTML = `
    <div class="donut-section-title">Domestic</div>
    ${renderItems(domestic)}

    ${
      other.length
        ? `
      <div class="donut-section-title">Other</div>
      ${renderItems(other)}
    `
        : ""
    }
  `;
}

function calculatePortfolioAnalytics() {
  const result = {
    totalValue: 0,
    assetAllocation: {},
    marketCap: { global: 0, large: 0, mid: 0, small: 0 },
    debtDistribution: {},
    sector: {},
    debtSector: {},
    amc: {},
    holdings: {},
    weightedReturns: { return1y: null, return3y: null, return5y: null },
  };

  // ✅ After — use advancedMetrics.currentValue, same source used everywhere else
  Object.values(fundWiseData).forEach((fund) => {
    const value = parseFloat(fund.advancedMetrics?.currentValue || 0);
    if (value > 0) result.totalValue += value;
  });

  if (result.totalValue === 0) return result;

  Object.values(fundWiseData).forEach((fund) => {
    const value = parseFloat(fund.advancedMetrics.currentValue || 0);
    if (!(value > 0)) return;

    const weight = value / result.totalValue;
    const extended = fund.isin ? mfStats[fund.isin] : null;

    const fundAsset = extended?.portfolio_stats?.asset_allocation;
    let fundDomesticEquity = 0;
    let fundGlobalEquity = 0;
    let fundHedgedEquity = 0;

    if (fundAsset) {
      // Use resolveAssetAllocation: equity split via nature_name=EQUITY +
      // instrument_name; commodities split via instrument_name gold/silver.
      const splits = resolveAssetAllocation(
        fundAsset,
        extended?.holdings,
        weight,
      );
      Object.entries(splits).forEach(([label, pct]) => {
        result.assetAllocation[label] =
          (result.assetAllocation[label] || 0) + pct;
        if (label === "domestic equity") fundDomesticEquity += pct;
        else if (label === "global equity") fundGlobalEquity += pct;
        else if (label === "hedged equity") fundHedgedEquity += pct;
      });
    } else {
      // Fallback: no portfolio_stats — classify by fund category
      const category = (fund.type || fund.category || "").toLowerCase();
      if (category.includes("equity")) {
        result.assetAllocation["domestic equity"] =
          (result.assetAllocation["domestic equity"] || 0) + weight * 100;
        fundDomesticEquity += weight * 100;
      } else if (category.includes("debt") || category.includes("income")) {
        result.assetAllocation["debt"] =
          (result.assetAllocation["debt"] || 0) + weight * 100;
      } else {
        result.assetAllocation["other"] =
          (result.assetAllocation["other"] || 0) + weight * 100;
      }
    }

    // ── DEBT DISTRIBUTION: group DEBT holdings by instrument_name ──────────
    const debtSplits = resolveDebtDistribution(extended?.holdings, weight);
    Object.entries(debtSplits).forEach(([label, pct]) => {
      result.debtDistribution[label] =
        (result.debtDistribution[label] || 0) + pct;
    });

    const ps = extended?.portfolio_stats;
    let l = 0,
      m = 0,
      s = 0,
      capTotal = 0;

    if (
      ps?.large_cap !== undefined ||
      ps?.mid_cap !== undefined ||
      ps?.small_cap !== undefined
    ) {
      l = parseFloat(ps.large_cap || 0);
      m = parseFloat(ps.mid_cap || 0);
      s = parseFloat(ps.small_cap || 0);
      capTotal = l + m + s;
    } else if (ps?.market_cap_per) {
      const mp = ps.market_cap_per;
      l = parseFloat(mp.large || 0);
      m = parseFloat(mp.mid || 0);
      s = parseFloat(mp.small || 0);
      capTotal = l + m + s;
    }

    if (capTotal > 0 && fundDomesticEquity > 0) {
      // l/m/s are % of this fund's domestic equity — scale to portfolio-wide %
      result.marketCap.large += (l / capTotal) * fundDomesticEquity;
      result.marketCap.mid += (m / capTotal) * fundDomesticEquity;
      result.marketCap.small += (s / capTotal) * fundDomesticEquity;
    } else if (fundDomesticEquity > 0) {
      // No cap-size breakdown available — classify by fund name
      const name = (fund.scheme || "").toLowerCase();
      if (name.includes("small") || name.includes("smallcap")) {
        result.marketCap.small += fundDomesticEquity;
      } else if (name.includes("mid") || name.includes("midcap")) {
        result.marketCap.mid += fundDomesticEquity;
      } else {
        result.marketCap.large += fundDomesticEquity;
      }
    }

    // Hedged equity (index futures) treated as large-cap exposure
    // result.marketCap.large += fundHedgedEquity;
    result.marketCap.hedged = (result.marketCap.hedged || 0) + fundHedgedEquity;
    // Global Equity component
    result.marketCap.global += fundGlobalEquity;

    if (ps?.equity_sector_per && Object.keys(ps.equity_sector_per).length > 0) {
      Object.entries(ps.equity_sector_per).forEach(([sectorName, pct]) => {
        if (pct == null) return;
        const cleaned = sectorName.trim();
        result.sector[cleaned] =
          (result.sector[cleaned] || 0) +
          (parseFloat(pct) / 100) * weight * 100;
      });
    } else {
      result.sector["Unclassified"] =
        (result.sector["Unclassified"] || 0) + weight * 100;
    }

    if (ps?.debt_sector_per && Object.keys(ps.debt_sector_per).length > 0) {
      Object.entries(ps.debt_sector_per).forEach(([sectorName, pct]) => {
        if (pct == null) return;
        const cleaned = sectorName.trim();
        result.debtSector[cleaned] =
          (result.debtSector[cleaned] || 0) +
          (parseFloat(pct) / 100) * weight * 100;
      });
    }

    const amcName = standardizeTitle(
      extended?.amc ?? fund.amc ?? "Unknown AMC",
    );
    result.amc[amcName] = (result.amc[amcName] || 0) + weight * 100;

    if (
      fund.holdings &&
      Array.isArray(fund.holdings) &&
      fund.holdings.length > 0
    ) {
      // Only include EQUITY holdings — debt/cash instruments (Reverse Repo,
      // Net Current Assets, Repo etc.) are already captured in debtDistribution
      // and would cause the holdings total to exceed the portfolio value.
      const equityHoldings = fund.holdings.filter(
        (h) =>
          (h.nature_name || "").toUpperCase() === "EQUITY" &&
          parseFloat(h.corpus_per || 0) > 0,
      );

      // Sum only equity corpus to compute correct portfolio weights
      let equityCorpusTotal = equityHoldings.reduce(
        (sum, h) => sum + parseFloat(h.corpus_per || 0),
        0,
      );

      // Fall back to all holdings if no EQUITY nature tag found
      let holdingsToProcess = equityHoldings;
      if (equityHoldings.length === 0) {
        holdingsToProcess = fund.holdings.filter(
          (h) => parseFloat(h.corpus_per || 0) > 0,
        );
        equityCorpusTotal = holdingsToProcess.reduce(
          (sum, h) => sum + parseFloat(h.corpus_per || 0),
          0,
        );
      }

      // The equity allocation % for this fund (portfolio-wide)
      const fundEquityPct = fundDomesticEquity + fundGlobalEquity;

      holdingsToProcess.forEach((holding) => {
        const companyName = holding.company_name || "Unknown";
        const holdingCorpus = parseFloat(holding.corpus_per || 0);
        if (holdingCorpus <= 0) return;

        // Scale: this holding's share of fund equity × fund's equity portfolio weight
        const portfolioWeight =
          equityCorpusTotal > 0
            ? (holdingCorpus / equityCorpusTotal) * fundEquityPct
            : (holdingCorpus / 100) * weight * 100;

        if (!result.holdings[companyName]) {
          result.holdings[companyName] = {
            percentage: 0,
            nature: holding.nature_name || "Unknown",
            sector: holding.sector_name || "Unknown",
            instrument: holding.instrument_name || "Unknown",
          };
        }
        result.holdings[companyName].percentage += portfolioWeight;
      });
    }

    if (extended?.return_stats) {
      const rs = extended.return_stats;
      const r1 = rs.return1y ?? rs.cat_return1y ?? null;
      const r3 = rs.return3y ?? rs.cat_return3y ?? null;
      const r5 = rs.return5y ?? rs.cat_return5y ?? null;

      if (r1 != null)
        result.weightedReturns.return1y =
          (result.weightedReturns.return1y || 0) + parseFloat(r1) * weight;
      if (r3 != null)
        result.weightedReturns.return3y =
          (result.weightedReturns.return3y || 0) + parseFloat(r3) * weight;
      if (r5 != null)
        result.weightedReturns.return5y =
          (result.weightedReturns.return5y || 0) + parseFloat(r5) * weight;
    }
  });

  // Ensure all standard keys are initialised (new granular schema)
  result.assetAllocation["domestic equity"] =
    result.assetAllocation["domestic equity"] || 0;
  result.assetAllocation["global equity"] =
    result.assetAllocation["global equity"] || 0;
  result.assetAllocation["hedged equity"] =
    result.assetAllocation["hedged equity"] || 0;
  result.assetAllocation["debt"] = result.assetAllocation["debt"] || 0;
  result.assetAllocation["gold"] = result.assetAllocation["gold"] || 0;
  result.assetAllocation["silver"] = result.assetAllocation["silver"] || 0;
  result.assetAllocation["cash"] = result.assetAllocation["cash"] || 0;
  result.assetAllocation["real estate"] =
    result.assetAllocation["real estate"] || 0;
  result.assetAllocation["other"] = result.assetAllocation["other"] || 0;

  // Rest of the function remains the same...
  const mcSum =
    result.marketCap.large +
    result.marketCap.mid +
    result.marketCap.small +
    result.marketCap.global +
    (result.marketCap.hedged || 0);
  if (mcSum > 0) {
    result.marketCap.large = (result.marketCap.large / mcSum) * 100;
    result.marketCap.mid = (result.marketCap.mid / mcSum) * 100;
    result.marketCap.small = (result.marketCap.small / mcSum) * 100;
    result.marketCap.global = (result.marketCap.global / mcSum) * 100;
    result.marketCap.hedged = (result.marketCap.hedged / mcSum) * 100;
  }

  const sectorEntries = Object.entries(result.sector).sort(
    (a, b) => b[1] - a[1],
  );
  const sectorTop = sectorEntries.slice(0, 10);
  const sectorTopObj = {};
  let sectorOthers = 0;
  sectorEntries.slice(10).forEach(([, v]) => (sectorOthers += v));
  sectorTop.forEach(([k, v]) => (sectorTopObj[k] = v));
  if (sectorOthers > 0) sectorTopObj["Others"] = sectorOthers;
  result.sector = sectorTopObj;

  function roundMap(m) {
    const out = {};
    Object.entries(m).forEach(([k, v]) => {
      if (k === "_breakdown") {
        // Don't round the breakdown object itself
        out[k] = v;
      } else {
        out[k] = Math.round((v + Number.EPSILON) * 100) / 100;
      }
    });
    return out;
  }

  // result.assetAllocation = roundMap(result.assetAllocation);
  // result.marketCap = roundMap(result.marketCap);
  // result.sector = roundMap(result.sector);
  // result.debtSector = roundMap(result.debtSector);
  // result.amc = roundMap(result.amc);

  ["return1y", "return3y", "return5y"].forEach((k) => {
    if (result.weightedReturns[k] != null) {
      result.weightedReturns[k] =
        Math.round((result.weightedReturns[k] + Number.EPSILON) * 100) / 100;
    }
  });

  Object.keys(result.holdings).forEach((company) => {
    result.holdings[company].percentage =
      Math.round(
        (result.holdings[company].percentage + Number.EPSILON) * 1000000,
      ) / 1000000;
  });

  return result;
}
async function calculatePortfolioDailyValuation() {
  // Process funds in chunks to avoid blocking UI
  const funds = Object.entries(fundWiseData);
  const chunkSize = 5;
  const allDailyValuations = {};

  for (let i = 0; i < funds.length; i += chunkSize) {
    const chunk = funds.slice(i, i + chunkSize);

    // Process chunk
    await new Promise((resolve) => {
      requestIdleCallback(
        () => {
          chunk.forEach(([fundKey, fund]) => {
            if (fund.advancedMetrics) {
              fund.advancedMetrics.dailyValuation =
                calculateDailyValuationHistory(fund);
              allDailyValuations[fundKey] = fund.advancedMetrics.dailyValuation;
            }
          });
          resolve();
        },
        { timeout: 100 },
      );
    });

    // Update progress indicator
    const progress = Math.round(((i + chunkSize) / funds.length) * 100);
    updateProcessingProgress(progress, "Calculating valuation history...");
  }

  // Aggregate all fund valuations into portfolio-wide daily valuation
  const portfolioValuation = aggregateDailyValuations(allDailyValuations);

  return portfolioValuation;
}
function aggregateDailyValuations(allDailyValuations) {
  const portfolioMap = new Map();

  // Collect all unique dates from actual data
  const allDates = new Set();
  Object.values(allDailyValuations).forEach((valuations) => {
    valuations.forEach((v) => allDates.add(v.date));
  });

  const sortedDates = Array.from(allDates).sort();

  // For each date, sum up values and costs from all funds that have data
  sortedDates.forEach((date) => {
    let totalValue = 0;
    let totalCost = 0;
    let fundsWithData = 0;

    Object.entries(allDailyValuations).forEach(([fundKey, valuations]) => {
      const dayData = valuations.find((v) => v.date === date);
      if (dayData) {
        totalValue += dayData.value;
        totalCost += dayData.cost;
        fundsWithData++;
      }
    });

    // Only add if we have data from at least some funds
    if (totalValue > 0 && fundsWithData > 0) {
      portfolioMap.set(date, {
        date,
        value: parseFloat(totalValue.toFixed(2)),
        cost: parseFloat(totalCost.toFixed(2)),
        unrealizedGain: parseFloat((totalValue - totalCost).toFixed(2)),
        unrealizedGainPercent:
          totalCost > 0
            ? parseFloat(
                (((totalValue - totalCost) / totalCost) * 100).toFixed(2),
              )
            : 0,
        funds: fundsWithData,
      });
    }
  });

  return Array.from(portfolioMap.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );
}

// DISPLAY FUNCTIONS - ANALYTICS
function displayAssetAllocation(assetAllocation) {
  const preferred = [
    "domestic equity",
    "global equity",
    "hedged equity",
    "debt",
    "gold",
    "silver",
    "real estate",
    "cash",
    "other",
  ];

  const labels = [];
  const data = [];

  // Title-case helper for multi-word keys like "domestic equity", "reits"
  const toLabel = (k) => k.replace(/\b\w/g, (c) => c.toUpperCase());

  // Preferred order first
  preferred.forEach((k) => {
    const val = parseFloat(assetAllocation[k]);
    if (!isNaN(val) && val > 0) {
      labels.push(toLabel(k));
      data.push(val);
    }
  });

  // Any extra asset types (excluding _breakdown)
  Object.keys(assetAllocation).forEach((k) => {
    if (!preferred.includes(k) && k !== "_breakdown") {
      const val = parseFloat(assetAllocation[k]);
      if (!isNaN(val) && val > 0) {
        labels.push(toLabel(k));
        data.push(val);
      }
    }
  });

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    const container = document.getElementById("assetAllocationCard");
    if (!container) return;

    const chartCanvas = document.getElementById("assetAllocationChart");
    if (!chartCanvas) return;

    if (sortedLabels.length === 0) {
      const wrapper = chartCanvas.closest(".chart-wrapper");
      if (wrapper) {
        wrapper.innerHTML = `
          <canvas id="assetAllocationChart"></canvas>
          <div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>
        `;
      }
      container.classList.remove("loading");
      return;
    }

    // Total value from funds
    let totalValue = Object.values(fundWiseData).reduce(
      (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
      0,
    );

    buildDoughnutChart(
      "assetAllocationChart",
      sortedLabels,
      sortedData,
      totalValue,
    );

    container.classList.remove("loading");
  }, 50);
}

function displayMarketCapSplit(marketCap, assetAllocation, totalValue) {
  const marketCapCard = document.getElementById("marketCapCard");
  const domesticEquityPct = assetAllocation["domestic equity"] || 0;

  if (domesticEquityPct <= 0) {
    marketCapCard.classList.add("hidden");
    return;
  }

  marketCapCard.classList.remove("hidden");
  const order = [
    { label: "Global Equity", key: "global" },
    { label: "Hedged Equity", key: "hedged" },
    { label: "Large", key: "large" },
    { label: "Mid", key: "mid" },
    { label: "Small", key: "small" },
  ];
  const labels = [];
  const data = [];
  order.forEach(({ label, key }) => {
    const val = marketCap[key];
    if (val !== undefined && parseFloat(val) > 0) {
      labels.push(label);
      data.push(val);
    }
  });

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    const container = document.getElementById("marketCapCard");
    if (!container) return;

    const chartCanvas = document.getElementById("marketCapChart");
    if (!chartCanvas) return;

    if (sortedLabels.length === 0) {
      const wrapper = chartCanvas.closest(".chart-wrapper");
      if (wrapper) {
        wrapper.innerHTML = `
          <canvas id="marketCapChart"></canvas>
          <div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>
        `;
      }
      container.classList.remove("loading");
      return;
    }

    // marketCap values are already within-equity percentages (sum to 100).
    // Compute equity rupee sub-total from the asset allocation equity share.
    const equityPct =
      (assetAllocation["domestic equity"] || 0) +
      (assetAllocation["global equity"] || 0) +
      (assetAllocation["hedged equity"] || 0);
    const equityRupees = totalValue * (equityPct / 100);

    buildDoughnutChart(
      "marketCapChart",
      sortedLabels,
      sortedData,
      equityRupees,
    );

    applyGroupedMarketCapLegend(
      "marketCapChart",
      sortedLabels,
      sortedData,
      equityRupees,
    );

    setTimeout(() => {
      container.classList.remove("loading");
    }, 150);
  }, 50);
}

/**
 * Renders the portfolio-level Debt Distribution bar + legend.
 * Mirrors displayMarketCapSplit — groups are sorted largest first.
 * @param {Object} debtDist   { "Government Securities": 4.2, … } (portfolio-weighted %)
 * @param {number} totalValue portfolio rupee value for tooltip
 */
function displayDebtDistribution(debtDist, assetAllocation, totalValue) {
  const container = document.getElementById("debtDistributionCard");
  if (!container) return;

  let entries = Object.entries(debtDist)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const top = entries.slice(0, 7);
  const rest = entries.slice(7);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const labels = top.map(([k]) => k);
  const rawData = top.map(([, v]) => v);

  if (othersValue > 0) {
    labels.push("Others");
    rawData.push(othersValue);
  }

  if (labels.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");

  const wrapper = container.querySelector(".chart-wrapper");
  if (wrapper && !wrapper.querySelector("#debtDistributionChart")) {
    wrapper.innerHTML = '<canvas id="debtDistributionChart"></canvas>';
  }

  // Derive debt rupee total from assetAllocation (source of truth)
  const debtPct = assetAllocation["debt"] || 0;
  const debtRupees = totalValue * (debtPct / 100);

  // Normalize raw portfolio-wide weights to within-debt percentages
  const rawSum = rawData.reduce((s, v) => s + v, 0);
  const normalisedData = rawData.map((v) => (v / rawSum) * 100);

  buildDoughnutChart(
    "debtDistributionChart",
    labels,
    normalisedData,
    debtRupees,
  );

  container.classList.remove("loading");
}

/**
 * Family-dashboard equivalent of displayDebtDistribution.
 */
function displayFamilyDebtDistribution(metrics) {
  const container = document.getElementById("familyDebtDistributionCard");
  if (!container) return;

  let entries = Object.entries(metrics.debtDistribution || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const top = entries.slice(0, 7);
  const rest = entries.slice(7);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const labels = top.map(([k]) => k);
  const rawData = top.map(([, v]) => v);

  if (othersValue > 0) {
    labels.push("Others");
    rawData.push(othersValue);
  }

  if (labels.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");

  const wrapper = container.querySelector(".chart-wrapper");
  if (wrapper && !wrapper.querySelector("#familyDebtDistributionChart")) {
    wrapper.innerHTML = '<canvas id="familyDebtDistributionChart"></canvas>';
  }

  // Derive debt rupee total from assetAllocation (source of truth)
  const debtPct = metrics.assetAllocation?.["debt"] || 0;
  const debtRupees = metrics.totalCurrentValue * (debtPct / 100);

  // Normalize raw portfolio-wide weights to within-debt percentages
  const rawSum = rawData.reduce((s, v) => s + v, 0);
  const normalisedData = rawData.map((v) => (v / rawSum) * 100);

  buildDoughnutChart(
    "familyDebtDistributionChart",
    labels,
    normalisedData,
    debtRupees,
  );

  container.classList.remove("loading");
}

function displayFamilyDebtSectorSplit(metrics) {
  const card = document.getElementById("familyDebtSectorCard");
  if (!card) return;

  let entries = Object.entries(metrics.debtSector || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const top = entries.slice(0, 7);
  const rest = entries.slice(7);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const filteredTop = top.filter(([, value]) => value >= 1);
  const labels = filteredTop.map(([name]) => name);
  const data = filteredTop.map(([, val]) => val);

  const [sortedLabels, sortedData] = sortData(labels, data);

  if (othersValue > 0) {
    sortedLabels.push("Others");
    sortedData.push(othersValue);
  }

  if (
    entries.filter(([, v]) => v > 0).length === 0 ||
    sortedData.length === 0
  ) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");

  // Derive debt rupee total from assetAllocation (source of truth)
  const debtPct = metrics.assetAllocation?.["debt"] || 0;
  const debtSectorRupees = metrics.totalCurrentValue * (debtPct / 100);

  // Normalize raw portfolio-wide weights to within-debt percentages
  const rawSumDS = sortedData.reduce((s, v) => s + v, 0);
  const normalisedDS = sortedData.map((v) => (v / rawSumDS) * 100);
  buildDoughnutChart(
    "familyDebtSectorChart",
    sortedLabels,
    normalisedDS,
    debtSectorRupees,
  );
  card.classList.remove("loading");
}

function displayFamilyHoldingsSplit(metrics) {
  const holdingsCard = document.getElementById("familyHoldingsCard");
  if (!holdingsCard) return;

  const domesticEquityPct = metrics.assetAllocation?.["domestic equity"] || 0;

  if (domesticEquityPct <= 0) {
    holdingsCard.classList.add("hidden");
    return;
  }

  holdingsCard.classList.remove("hidden");
  let entries = Object.entries(metrics.holdings || {})
    .filter(([company]) => company !== "Cash Equivalents")
    .map(([company, data]) => [company, data.percentage])
    .sort((a, b) => b[1] - a[1]);

  const top = entries.slice(0, 15);
  const rest = entries.slice(15);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const labels = top.map(([name]) => name);
  const rawData = top.map(([, val]) => val);

  const [sortedLabels, sortedRaw] = sortData(labels, rawData);

  if (othersValue > 0) {
    sortedLabels.push("Others");
    sortedRaw.push(othersValue);
  }

  // Derive equity rupee total from assetAllocation (source of truth)
  const equityPct =
    (metrics.assetAllocation?.["domestic equity"] || 0) +
    (metrics.assetAllocation?.["global equity"] || 0) +
    (metrics.assetAllocation?.["hedged equity"] || 0);
  const equityRupees = metrics.totalCurrentValue * (equityPct / 100);

  // Normalize raw family-wide weights to within-equity percentages
  const rawSum = sortedRaw.reduce((s, v) => s + v, 0);
  const normalisedData =
    rawSum > 0 ? sortedRaw.map((v) => (v / rawSum) * 100) : sortedRaw;

  buildDoughnutChart(
    "familyHoldingsChart",
    sortedLabels,
    normalisedData,
    equityRupees,
  );
  holdingsCard.classList.remove("loading");
}

function displaySectorSplit(sectorObj, assetAllocation, totalValue) {
  let entries = Object.entries(sectorObj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7);
  const rest = entries.slice(7);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const filteredTop = top.filter(([, value]) => value >= 1);

  const labels = filteredTop.map(([name]) => name);
  const rawData = filteredTop.map(([, val]) => val);

  const [sortedLabels, sortedRaw] = sortData(labels, rawData);

  if (othersValue > 0) {
    sortedLabels.push("Others");
    sortedRaw.push(othersValue);
  }

  const sectorCard = document.getElementById("sectorCard");
  if (!sectorCard) return;

  const nonZeroEntries = entries.filter(([, v]) => v > 0);
  const onlyUnclassified =
    nonZeroEntries.length === 1 &&
    nonZeroEntries[0][0].toLowerCase() === "unclassified";

  if (onlyUnclassified || sortedRaw.length === 0) {
    sectorCard.classList.add("hidden");
    return;
  }

  sectorCard.classList.remove("hidden");

  // Derive equity rupee total from assetAllocation (source of truth)
  const equityPct =
    (assetAllocation["domestic equity"] || 0) +
    (assetAllocation["global equity"] || 0) +
    (assetAllocation["hedged equity"] || 0);
  const equityRupees = totalValue * (equityPct / 100);

  // Normalize raw portfolio-wide weights to within-equity percentages
  const rawSum = sortedRaw.reduce((s, v) => s + v, 0);
  const normalisedData = sortedRaw.map((v) => (v / rawSum) * 100);

  buildDoughnutChart("sectorChart", sortedLabels, normalisedData, equityRupees);
  sectorCard.classList.remove("loading");
}

function displayDebtSectorSplit(debtSectorObj, assetAllocation, totalValue) {
  const card = document.getElementById("debtSectorCard");
  if (!card) return;

  let entries = Object.entries(debtSectorObj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7);
  const rest = entries.slice(7);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const filteredTop = top.filter(([, value]) => value >= 1);
  const labels = filteredTop.map(([name]) => name);
  const rawData = filteredTop.map(([, val]) => val);

  const [sortedLabels, sortedRaw] = sortData(labels, rawData);

  if (othersValue > 0) {
    sortedLabels.push("Others");
    sortedRaw.push(othersValue);
  }

  if (entries.filter(([, v]) => v > 0).length === 0 || sortedRaw.length === 0) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");

  // Derive debt rupee total from assetAllocation (source of truth)
  const debtPct = assetAllocation["debt"] || 0;
  const debtRupees = totalValue * (debtPct / 100);

  // Normalize raw portfolio-wide weights to within-debt percentages
  const rawSum = sortedRaw.reduce((s, v) => s + v, 0);
  const normalisedData = sortedRaw.map((v) => (v / rawSum) * 100);

  buildDoughnutChart(
    "debtSectorChart",
    sortedLabels,
    normalisedData,
    debtRupees,
  );
  card.classList.remove("loading");
}

function displayAMCSplit(amcObj, totalValue) {
  let entries = Object.entries(amcObj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7); //limit-bar-chart
  const rest = entries.slice(7);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const cleaned = top.map(([name, value]) => {
    let shortName = name
      .replace(/mutual\s*fund/gi, "")
      .replace(/\bmf\b/gi, "")
      .trim();
    return [shortName, value];
  });

  const labels = cleaned.map(([n]) => n);
  const data = cleaned.map(([, v]) => v);

  const [sortedLabels, sortedData] = sortData(labels, data);

  // Append Others at the end after sorting so it's always last
  if (othersValue > 0) {
    sortedLabels.push("Others");
    sortedData.push(othersValue);
  }

  buildDoughnutChart("amcChart", sortedLabels, sortedData, totalValue);
  document.getElementById("amcCard")?.classList.remove("loading");
}
function displayHoldingsSplit(holdingsObj, assetAllocation, totalValue) {
  const holdingsCard = document.getElementById("holdingsCard");
  if (!holdingsCard) return;

  const domesticEquityPct = assetAllocation["domestic equity"] || 0;

  if (domesticEquityPct <= 0) {
    holdingsCard.classList.add("hidden");
    return;
  }

  holdingsCard.classList.remove("hidden");
  let entries = Object.entries(holdingsObj)
    .filter(([company]) => company !== "Cash Equivalents")
    .map(([company, data]) => [company, data.percentage])
    .sort((a, b) => b[1] - a[1]);

  const top = entries.slice(0, 15);
  const rest = entries.slice(15);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);

  const labels = top.map(([name]) => name);
  const rawData = top.map(([, val]) => val);

  const [sortedLabels, sortedRaw] = sortData(labels, rawData);

  if (othersValue > 0) {
    sortedLabels.push("Others");
    sortedRaw.push(othersValue);
  }

  // Derive equity rupee total from assetAllocation (source of truth)
  const equityPct =
    (assetAllocation["domestic equity"] || 0) +
    (assetAllocation["global equity"] || 0) +
    (assetAllocation["hedged equity"] || 0);
  const equityRupees = totalValue * (equityPct / 100);

  // Normalize raw portfolio-wide weights to within-equity percentages
  const rawSum = sortedRaw.reduce((s, v) => s + v, 0);
  const normalisedData =
    rawSum > 0 ? sortedRaw.map((v) => (v / rawSum) * 100) : sortedRaw;

  buildDoughnutChart(
    "holdingsChart",
    sortedLabels,
    normalisedData,
    equityRupees,
  );
  document.getElementById("holdingsCard")?.classList.remove("loading");
}

function displayWeightedReturns(wr, containerId = "weightedReturnsContainer") {
  const benchmarks = getPortfolioBenchmarks();
  const alpha = calculatePortfolioAlpha(wr, benchmarks);
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`${containerId} not found`);
    return;
  }
  container.innerHTML = "";
  const periods = [
    {
      label: "1Y",
      portfolioVal: wr.return1y,
      n50Val: benchmarks.nifty50.return1y,
      n500Val: benchmarks.nifty500.return1y,
      alphaN50: alpha.vsNifty50.alpha1y,
      alphaN500: alpha.vsNifty500.alpha1y,
    },
    {
      label: "3Y",
      portfolioVal: wr.return3y,
      n50Val: benchmarks.nifty50.return3y,
      n500Val: benchmarks.nifty500.return3y,
      alphaN50: alpha.vsNifty50.alpha3y,
      alphaN500: alpha.vsNifty500.alpha3y,
    },
    {
      label: "5Y",
      portfolioVal: wr.return5y,
      n50Val: benchmarks.nifty50.return5y,
      n500Val: benchmarks.nifty500.return5y,
      alphaN50: alpha.vsNifty50.alpha5y,
      alphaN500: alpha.vsNifty500.alpha5y,
    },
  ];
  const fmt = (v) => (v == null || isNaN(v) ? null : v);
  const fmtDisplay = (v) => (v == null ? "--" : `${parseFloat(v).toFixed(2)}%`);
  const fmtAlpha = (v) => {
    if (v == null) return null;
    const sign = v >= 0 ? "+" : "";
    return `${sign}${parseFloat(v).toFixed(2)}%`;
  };
  const allVals = periods.flatMap((p) =>
    [p.portfolioVal, p.n50Val, p.n500Val]
      .map(fmt)
      .filter((v) => v != null && v > 0),
  );
  const maxVal = allVals.length ? Math.max(...allVals) : 100;
  const barPct = (v) => {
    const n = fmt(v);
    if (n == null || maxVal === 0) return 0;
    return Math.max(0, Math.min(100, (n / maxVal) * 90));
  };
  const rows = [
    {
      name: "Portfolio",
      color: "var(--wr-portfolio-color)",
      valKey: "portfolioVal",
    },
    { name: "Nifty 50", color: "var(--wr-n50-color)", valKey: "n50Val" },
    { name: "Nifty 500", color: "var(--wr-n500-color)", valKey: "n500Val" },
  ];
  periods.forEach((p, i) => {
    const isLast = i === periods.length - 1;
    const portfolioFmt = fmtDisplay(fmt(p.portfolioVal));
    const portfolioCls =
      p.portfolioVal == null
        ? ""
        : p.portfolioVal >= 0
          ? "positive"
          : "negative";
    const barsHtml = rows
      .map((r) => {
        const v = fmt(p[r.valKey]);
        const pct = barPct(p[r.valKey]);
        return ` <div class="wr-bar-row"> <span class="wr-bar-label">${r.name}</span> <div class="wr-bar-track"> <div class="wr-bar-fill" style="width:${pct}%; background:${r.color};"> </div> </div> <span class="wr-bar-pct" style="color:${r.color};"> ${fmtDisplay(v)} </span> </div> `;
      })
      .join("");
    const alphaN50Str = fmtAlpha(p.alphaN50);
    const alphaN500Str = fmtAlpha(p.alphaN500);
    const alphaPill = (val, str) => {
      if (str == null) {
        return `<span class="wr-alpha-pill wr-alpha-na">N/A</span>`;
      }
      const cls = val >= 0 ? "wr-alpha-pos" : "wr-alpha-neg";
      const arrow = val >= 0 ? "▲" : "▼";
      return ` <span class="wr-alpha-pill ${cls}"> ${arrow} ${str} </span> `;
    };
    const card = document.createElement("div");
    card.className = "wr-period-card" + (isLast ? " wr-period-card--last" : "");
    card.innerHTML = ` <div class="wr-period-header"> <span class="wr-period-label"> ${p.label} Weighted Return </span> <span class="return-value ${portfolioCls} wr-portfolio-val"> ${portfolioFmt} </span> </div> <div class="wr-bars"> ${barsHtml} </div> <div class="wr-divider"></div> <div class="wr-alpha-rows"> <div class="wr-alpha-row"> <span class="wr-alpha-label">vs Nifty 50</span> ${alphaPill(p.alphaN50, alphaN50Str)} </div> <div class="wr-alpha-row"> <span class="wr-alpha-label">vs Nifty 500</span> ${alphaPill(p.alphaN500, alphaN500Str)} </div> </div> `;
    container.appendChild(card);
  });
  const legend = document.createElement("div");
  legend.className = "wr-legend";
  legend.innerHTML = ` <span class="wr-legend-item"> <span class="wr-legend-dot" style="background:var(--wr-portfolio-color);"> </span> Portfolio </span> <span class="wr-legend-item"> <span class="wr-legend-dot" style="background:var(--wr-n50-color);"> </span> Nifty 50 </span> <span class="wr-legend-item"> <span class="wr-legend-dot" style="background:var(--wr-n500-color);"> </span> Nifty 500 </span> <span class="wr-legend-sep"></span> <span class="wr-legend-item"> <span class="wr-alpha-pill wr-alpha-pos" style="font-size:11px;"> ▲ +X% </span> &nbsp;Outperformance (alpha) </span> `;
  container.appendChild(legend);
}

function displayCapitalGains() {
  const container = document.getElementById("capitalGainsContent");
  if (!container) return;

  const currentFY = getFinancialYear(new Date());
  const hasCurrentYearData = Object.values(capitalGainsData.currentYear).some(
    (cat) =>
      cat.stcg !== 0 ||
      cat.ltcg !== 0 ||
      cat.stcgRedeemed !== 0 ||
      cat.ltcgRedeemed !== 0,
  );

  let html = ``;

  // Get all transactions
  const allTransactions = getCapitalGainsTransactions();

  // Financial Year-wise breakdown with transactions
  const years = Object.keys(capitalGainsData.byYear).sort((a, b) => {
    const aNum = parseInt(a.split(" ")[1].split("-")[0]);
    const bNum = parseInt(b.split(" ")[1].split("-")[0]);
    return bNum - aNum;
  });

  // Determine which FY to show by default.
  // Prefer current FY when it has data; otherwise fall back to the most recent
  // previous FY that has data.  If no previous FY exists either, keep current FY.
  let defaultFY = currentFY;
  if (!hasCurrentYearData && years.length > 0) {
    // Find the most recent FY that is not the current FY and has data
    const prevFY = years.find((fy) => fy !== currentFY);
    if (prevFY) defaultFY = prevFY;
  }

  // Always show the FY section; include current FY pill even if no data
  const allPillYears = years.includes(currentFY)
    ? years
    : [currentFY, ...years];

  html += `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>📅 Financial Year-wise Breakdown</h3>
        <p class="section-subtitle">Historical capital gains across all financial years</p>
      </div>
      <div class="cg-pill-bar" id="capitalGainsYearPills">
  `;

  allPillYears.forEach((fy) => {
    const hasData = years.includes(fy);
    html += `
      <button class="cg-pill ${fy === defaultFY ? "active" : ""} ${!hasData ? "cg-pill--no-data" : ""}"
              onclick="showYearGainsWithTransactions('${fy}')">
        ${fy}
      </button>
    `;
  });

  html += `</div><div id="yearGainsDisplay"></div></div>`;

  // All-time summary
  const hasAllTimeData = Object.values(capitalGainsData.allTime).some(
    (cat) =>
      cat.stcg !== 0 ||
      cat.ltcg !== 0 ||
      cat.stcgRedeemed !== 0 ||
      cat.ltcgRedeemed !== 0,
  );

  html += `
    <div class="capital-gains-section alltime-section">
      <div class="section-header">
        <h3>🏆 All-Time Summary</h3>
        <p class="section-subtitle">Complete history of capital gains</p>
      </div>`;

  if (!hasAllTimeData) {
    html += `<p class="no-data">No redemptions made yet</p></div>`;
  } else {
    // Compute overall totals for hero row
    let atTotalSTCG = 0,
      atTotalLTCG = 0,
      atTotalRedeemed = 0;
    ["equity", "debt", "hybrid"].forEach((cat) => {
      const d = capitalGainsData.allTime[cat];
      atTotalSTCG += d.stcg || 0;
      atTotalLTCG += d.ltcg || 0;
      atTotalRedeemed += (d.stcgRedeemed || 0) + (d.ltcgRedeemed || 0);
    });
    const atTotalGains = atTotalSTCG + atTotalLTCG;

    html += `
      <div class="cg-alltime-hero">
        <div class="folio-card-hero">
          <div class="folio-card-hero-cell ${atTotalLTCG >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Long Term</span>
            <span class="folio-card-hero-value ${atTotalLTCG >= 0 ? "gain" : "loss"}">₹${formatNumber(Math.abs(atTotalLTCG))}</span>
            <span class="folio-card-hero-sub">LTCG</span>
          </div>
          <div class="folio-card-hero-cell ${atTotalSTCG >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Short Term</span>
            <span class="folio-card-hero-value ${atTotalSTCG >= 0 ? "gain" : "loss"}">₹${formatNumber(Math.abs(atTotalSTCG))}</span>
            <span class="folio-card-hero-sub">STCG</span>
          </div>
          <div class="folio-card-hero-cell ${atTotalGains >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Total Gains</span>
            <span class="folio-card-hero-value ${atTotalGains >= 0 ? "gain" : "loss"}">₹${formatNumber(Math.abs(atTotalGains))}</span>
            <span class="folio-card-hero-sub">All time</span>
          </div>
          <div class="folio-card-hero-cell folio-card-hero-cell--xirr">
            <span class="folio-card-hero-label">Total Redeemed</span>
            <span class="folio-card-hero-value">₹${formatNumber(atTotalRedeemed)}</span>
            <span class="folio-card-hero-sub">All categories</span>
          </div>
        </div>
      </div>
      <div class="gains-summary-grid alltime-summary-grid">`;

    ["equity", "debt", "hybrid"].forEach((cat) => {
      const data = capitalGainsData.allTime[cat];
      const totalGains = data.stcg + data.ltcg;
      const totalRedeemed = data.stcgRedeemed + data.ltcgRedeemed;
      if (totalGains !== 0 || totalRedeemed !== 0) {
        const catIcons = { equity: "📈", debt: "🏦", hybrid: "⚖️" };
        html += `
        <div class="gains-summary-card folio-card">
          <div class="folio-card-header">
            <span class="folio-card-name-header">${catIcons[cat]} ${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
          </div>
          <div class="folio-card-hero">
            <div class="folio-card-hero-cell ${data.ltcg >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
              <span class="folio-card-hero-label">LTCG</span>
              <span class="folio-card-hero-value ${data.ltcg >= 0 ? "gain" : "loss"}">₹${formatNumber(Math.abs(data.ltcg))}</span>
            </div>
            <div class="folio-card-hero-cell ${data.stcg >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
              <span class="folio-card-hero-label">STCG</span>
              <span class="folio-card-hero-value ${data.stcg >= 0 ? "gain" : "loss"}">₹${formatNumber(Math.abs(data.stcg))}</span>
            </div>
            <div class="folio-card-hero-cell ${totalGains >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
              <span class="folio-card-hero-label">Total Gains</span>
              <span class="folio-card-hero-value ${totalGains >= 0 ? "gain" : "loss"}">₹${formatNumber(Math.abs(totalGains))}</span>
            </div>
          </div>
          <div class="folio-card-chips-row">
            <div class="folio-card-meta-chip">
              <span class="folio-card-meta-label">Redeemed</span>
              <span class="folio-card-meta-value">₹${formatNumber(totalRedeemed)}</span>
            </div>
            <div class="folio-card-meta-chip">
              <span class="folio-card-meta-label">STCG Redeemed</span>
              <span class="folio-card-meta-value">₹${formatNumber(data.stcgRedeemed)}</span>
            </div>
            <div class="folio-card-meta-chip">
              <span class="folio-card-meta-label">LTCG Redeemed</span>
              <span class="folio-card-meta-value">₹${formatNumber(data.ltcgRedeemed)}</span>
            </div>
          </div>
        </div>
      `;
      }
    });

    html += `
        </div>
      </div>
    `;
  }

  // All-time detailed transactions
  if (allTransactions.length > 0) {
    html += `
      <div class="capital-gains-section">
        <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
          <div>
            <h3>📋 All-Time Detailed Transactions</h3>
            <p class="section-subtitle">Complete breakdown of all redemption transactions</p>
          </div>
          <button class="cg-dl-btn" onclick="downloadCapitalGainsReport()">
            <i class="fa-solid fa-download"></i> Download All
          </button>
        </div>
        ${createFYTransactionTable(allTransactions)}
      </div>
    `;
  }

  html += `
    <div class="tax-disclaimer">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>Tax calculations are estimates only and should not be considered professional advice; please verify the results independently before making financial decisions.</span>
    </div>
  `;

  container.innerHTML = html;

  // Always show defaultFY (current FY even if no data, falls back gracefully)
  showYearGainsWithTransactions(defaultFY);
}
function showYearGains(fy) {
  const yearData = capitalGainsData.byYear[fy];
  if (!yearData) return;

  // Update button states
  document.querySelectorAll(".year-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.textContent.trim() === fy) {
      btn.classList.add("active");
    }
  });

  const display = document.getElementById("yearGainsDisplay");

  let html = `
    <div class="gains-table-wrapper">
      <h4>STCG for ${fy}</h4>
      <table class="gains-table gain-summary">
        <thead>
          <tr>
            <th>Category</th>
            <th>Gains</th>
            <th>Redeemed</th>
            <th>Tax Rate</th>
          </tr>
        </thead>
        <tbody>
  `;

  ["equity", "debt", "hybrid"].forEach((cat) => {
    const data = yearData[cat];
    if (data.stcg !== 0 || data.stcgRedeemed !== 0) {
      const taxRate = cat === "equity" ? "20%" : "As per slab";
      const holdingPeriod = cat === "equity" ? "< 1Y" : "< 2Y";
      html += `
        <tr>
          <td>${
            cat.charAt(0).toUpperCase() + cat.slice(1)
          } (${holdingPeriod})</td>
          <td class="${data.stcg >= 0 ? "gain" : "loss"}">₹${formatNumber(
            Math.abs(data.stcg),
          )}</td>
          <td>₹${formatNumber(data.stcgRedeemed)}</td>
          <td>${taxRate}</td>
        </tr>
      `;
    }
  });

  html += `
        </tbody>
      </table>

      <h4>LTCG for ${fy}</h4>
      <table class="gains-table gain-summary">
        <thead>
          <tr>
            <th>Category</th>
            <th>Gains</th>
            <th>Redeemed</th>
            <th>Tax Rate</th>
          </tr>
        </thead>
        <tbody>
  `;

  ["equity", "debt", "hybrid"].forEach((cat) => {
    const data = yearData[cat];
    if (data.ltcg !== 0 || data.ltcgRedeemed !== 0) {
      const taxRate =
        cat === "debt"
          ? "As per slab"
          : cat === "hybrid"
            ? "12.5%"
            : "12.5% (>₹1.25L)";
      const holdingPeriod = cat === "equity" ? "≥ 1Y" : "≥ 2Y";
      html += `
        <tr>
          <td>${
            cat.charAt(0).toUpperCase() + cat.slice(1)
          } (${holdingPeriod})</td>
          <td class="${data.ltcg >= 0 ? "gain" : "loss"}">₹${formatNumber(
            Math.abs(data.ltcg),
          )}</td>
          <td>₹${formatNumber(data.ltcgRedeemed)}</td>
          <td>${taxRate}</td>
        </tr>
      `;
    }
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  display.innerHTML = html;
}
function showYearGainsWithTransactions(fy) {
  const yearData = capitalGainsData.byYear[fy];

  // Update button states
  document.querySelectorAll(".cg-pill").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.textContent.trim() === fy) {
      btn.classList.add("active");
    }
  });

  if (!yearData) {
    const display = document.getElementById("yearGainsDisplay");
    if (display) {
      display.innerHTML = `
        <div class="cg-no-data-banner">
          <i class="fa-solid fa-calendar-xmark"></i>
          <span>DATA NOT AVAILABLE</span>
          <p>No redemption transactions found for ${fy}</p>
        </div>`;
    }
    return;
  }

  const display = document.getElementById("yearGainsDisplay");

  // Get transactions for this FY
  const allTransactions = getCapitalGainsTransactions();
  const fyTransactions = allTransactions.filter((tx) => tx.fy === fy);

  // Compute totals for hero row
  let totalSTCG = 0,
    totalLTCG = 0,
    totalRedeemed = 0;
  ["equity", "debt", "hybrid"].forEach((cat) => {
    const d = yearData[cat];
    totalSTCG += d.stcg || 0;
    totalLTCG += d.ltcg || 0;
    totalRedeemed += (d.stcgRedeemed || 0) + (d.ltcgRedeemed || 0);
  });
  const totalGains = totalSTCG + totalLTCG;

  const gainsClass = totalGains >= 0 ? "gain" : "loss";
  const stcgClass = totalSTCG >= 0 ? "gain" : "loss";
  const ltcgClass = totalLTCG >= 0 ? "gain" : "loss";

  // Build category cards
  const catMeta = {
    equity: {
      icon: "📈",
      stcgPeriod: "< 1Y",
      ltcgPeriod: "≥ 1Y",
      stcgTax: "20%",
      ltcgTax: "12.5% (>₹1.25L)",
    },
    debt: {
      icon: "🏦",
      stcgPeriod: "< 2Y",
      ltcgPeriod: "≥ 2Y",
      stcgTax: "As per slab",
      ltcgTax: "As per slab",
    },
    hybrid: {
      icon: "⚖️",
      stcgPeriod: "< 2Y",
      ltcgPeriod: "≥ 2Y",
      stcgTax: "As per slab",
      ltcgTax: "12.5%",
    },
  };

  let categoryCardsHtml = "";
  ["equity", "debt", "hybrid"].forEach((cat) => {
    const d = yearData[cat];
    const m = catMeta[cat];
    const catSTCG = d.stcg || 0;
    const catLTCG = d.ltcg || 0;
    const catTotal = catSTCG + catLTCG;
    const catRedeemed = (d.stcgRedeemed || 0) + (d.ltcgRedeemed || 0);
    const hasAny = catTotal !== 0 || catRedeemed !== 0;

    if (!hasAny) return;

    const catTotalClass = catTotal >= 0 ? "gain" : "loss";
    const stcgHasData = d.stcg !== 0 || d.stcgRedeemed !== 0;
    const ltcgHasData = d.ltcg !== 0 || d.ltcgRedeemed !== 0;

    categoryCardsHtml += `
      <div class="cg-year-cat-card">
        <div class="folio-card-header">
          <span class="folio-card-name-header">${m.icon} ${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
        </div>
        <div class="folio-card-hero">
          <div class="folio-card-hero-cell ${catLTCG >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">LTCG ${m.ltcgPeriod}</span>
            <span class="folio-card-hero-value ${ltcgHasData ? (catLTCG >= 0 ? "gain" : "loss") : ""}">₹${formatNumber(Math.abs(ltcgHasData ? catLTCG : 0))}</span>
            <span class="folio-card-hero-sub">Tax: ${m.ltcgTax}</span>
          </div>
          <div class="folio-card-hero-cell ${catSTCG >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">STCG ${m.stcgPeriod}</span>
            <span class="folio-card-hero-value ${stcgHasData ? (catSTCG >= 0 ? "gain" : "loss") : ""}">₹${formatNumber(Math.abs(stcgHasData ? catSTCG : 0))}</span>
            <span class="folio-card-hero-sub">Tax: ${m.stcgTax}</span>
          </div>
          <div class="folio-card-hero-cell ${catTotal >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Total Gains</span>
            <span class="folio-card-hero-value ${catTotalClass}">₹${formatNumber(Math.abs(catTotal))}</span>
            <span class="folio-card-hero-sub">Redeemed ₹${formatNumber(catRedeemed)}</span>
          </div>
        </div>
      </div>
    `;
  });

  let html = `
    <div class="cg-year-display">
      <div class="cg-year-hero">
        <div class="folio-card-hero">
          <div class="folio-card-hero-cell ${totalLTCG >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Long Term</span>
            <span class="folio-card-hero-value ${ltcgClass}">₹${formatNumber(Math.abs(totalLTCG))}</span>
            <span class="folio-card-hero-sub">LTCG</span>
          </div>
          <div class="folio-card-hero-cell ${totalSTCG >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Short Term</span>
            <span class="folio-card-hero-value ${stcgClass}">₹${formatNumber(Math.abs(totalSTCG))}</span>
            <span class="folio-card-hero-sub">STCG</span>
          </div>
          <div class="folio-card-hero-cell ${totalGains >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
            <span class="folio-card-hero-label">Total Gains</span>
            <span class="folio-card-hero-value ${gainsClass}">₹${formatNumber(Math.abs(totalGains))}</span>
            <span class="folio-card-hero-sub">STCG + LTCG</span>
          </div>
          <div class="folio-card-hero-cell folio-card-hero-cell--xirr">
            <span class="folio-card-hero-label">Total Redeemed</span>
            <span class="folio-card-hero-value">₹${formatNumber(totalRedeemed)}</span>
            <span class="folio-card-hero-sub">All categories</span>
          </div>
        </div>
      </div>
      <div class="cg-year-cat-grid">
        ${categoryCardsHtml || `<p class="no-data">No redemptions in ${fy}</p>`}
      </div>
    </div>
  `;

  // Add detailed transactions table for this FY
  if (fyTransactions.length > 0) {
    html += `
    <div class="cg-year-transactions">
      <div class="cg-year-tx-header">
        <span class="cg-year-tx-title">Detailed Transactions — ${fy}</span>
        <button class="cg-dl-btn" onclick="downloadFYCapitalGainsReport('${fy}')">
          <i class="fa-solid fa-download"></i> Download ${fy}
        </button>
      </div>
      ${createFYTransactionTable(fyTransactions)}
    </div>
  `;
  }

  display.innerHTML = html;
}
function getCapitalGainsTransactions() {
  const transactions = [];

  // Get hidden folios
  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  Object.entries(fundWiseData).forEach(([key, fund]) => {
    const fifo = fund.advancedMetrics;
    if (!fifo) return;

    const category = fifo.category;
    const unitQueue = [];

    // Holding period thresholds (in days)
    const stcgThreshold = category === "equity" ? 365 : 730;

    fund.transactions
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach((tx) => {
        // Skip transactions from hidden folios
        const txFolio = tx.folio || "unknown";
        const uniqueKey = `${txFolio}|${fund.scheme}`;

        if (
          hiddenFolios.includes(txFolio) ||
          hiddenFolios.includes(uniqueKey)
        ) {
          return;
        }

        if (tx.type === "PURCHASE") {
          const units = parseFloat(tx.units || 0);
          const nav = parseFloat(tx.nav || 0);
          const amount = nav * units;
          if (units > 0 && amount > 0) {
            unitQueue.push({
              units: units,
              nav: nav,
              date: tx.date,
              purchaseDate: new Date(tx.date),
              folio: tx.folio,
            });
          }
        } else if (tx.type === "REDEMPTION") {
          const unitsToSell = Math.abs(parseFloat(tx.units || 0));
          const nav = parseFloat(tx.nav || 0);
          const saleDate = new Date(tx.date);

          let remainingUnits = unitsToSell;

          while (remainingUnits > 0.001 && unitQueue.length > 0) {
            const batch = unitQueue[0];
            const holdingDays = Math.floor(
              (saleDate - batch.purchaseDate) / (1000 * 60 * 60 * 24),
            );

            let unitsFromBatch = 0;
            if (batch.units <= remainingUnits + 0.001) {
              unitsFromBatch = batch.units;
              remainingUnits -= batch.units;
              unitQueue.shift();
            } else {
              unitsFromBatch = remainingUnits;
              batch.units -= remainingUnits;
              remainingUnits = 0;
            }

            const costFromBatch = unitsFromBatch * batch.nav;
            const saleFromBatch = unitsFromBatch * nav;
            const gainFromBatch = saleFromBatch - costFromBatch;

            const isSTCG = holdingDays < stcgThreshold;

            const purchaseValue = unitsFromBatch * batch.nav;
            const redemptionValue = unitsFromBatch * nav;

            transactions.push({
              scheme: fund.schemeDisplay || fund.scheme,
              folio: tx.folio || batch.folio || "Unknown",
              category: category.charAt(0).toUpperCase() + category.slice(1),
              qty: unitsFromBatch,
              purchaseDate: batch.date,
              purchaseNav: batch.nav,
              redemptionDate: tx.date,
              redemptionNav: nav,
              purchaseValue: purchaseValue,
              redemptionValue: redemptionValue,
              stcg: isSTCG ? gainFromBatch : 0,
              ltcg: isSTCG ? 0 : gainFromBatch,
              holdingDays: holdingDays,
              fy: getFinancialYear(saleDate),
            });
          }
        }
      });
  });

  // Sort by redemption date descending (newest first)
  transactions.sort(
    (a, b) => new Date(b.redemptionDate) - new Date(a.redemptionDate),
  );

  return transactions;
}
function createFYTransactionTable(transactions) {
  if (transactions.length === 0) return "";

  let html = `
    <div class="gains-table-wrapper">
      <div class="gains-trans">
        <table class="gains-table">
          <thead>
            <tr>
              <th data-sort="scheme">Scheme Name</th>
              <th data-sort="folio">Folio</th>
              <th data-sort="category">Category</th>
              <th data-sort="qty">Qty</th>
              <th data-sort="purchaseDate">Purchase Date</th>
              <th data-sort="purchaseNav">Purchase NAV</th>
              <th data-sort="redemptionDate">Redemption Date</th>
              <th data-sort="redemptionNav">Redemption NAV</th>
              <th data-sort="purchaseNav">Purchase Value</th>
              <th data-sort="redemptionNav">Redemption Value</th>
              <th data-sort="holdingDays">Holding (Days)</th>
              <th data-sort="stcg">STCG</th>
              <th data-sort="ltcg">LTCG</th>
            </tr>
          </thead>
          <tbody>
  `;

  transactions.forEach((tx) => {
    const stcgClass = tx.stcg >= 0 ? "gain" : "loss";
    const ltcgClass = tx.ltcg >= 0 ? "gain" : "loss";

    html += `
      <tr>
        <td>${tx.scheme}</td>
        <td>${tx.folio}</td>
        <td>${tx.category}</td>
        <td>${tx.qty.toFixed(3)}</td>
        <td>${tx.purchaseDate}</td>
        <td>₹${tx.purchaseNav.toFixed(4)}</td>
        <td>${tx.redemptionDate}</td>
        <td>₹${tx.redemptionNav.toFixed(4)}</td>
        <td>₹${tx.purchaseValue.toFixed(4)}</td>
        <td>₹${tx.redemptionValue.toFixed(4)}</td>
        <td>${tx.holdingDays}</td>
        <td class="${stcgClass}">${
          "₹" + formatNumber(tx.stcg !== 0 ? tx.stcg : 0)
        }</td>
        <td class="${ltcgClass}">${
          "₹" + formatNumber(tx.ltcg !== 0 ? tx.ltcg : 0)
        }</td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  return html;
}
function downloadCapitalGainsReport() {
  const transactions = getCapitalGainsTransactions();

  if (transactions.length === 0) {
    showToast("No capital gains transactions to download", "warning");
    return;
  }

  // Group transactions by financial year
  const groupedByFY = transactions.reduce((acc, tx) => {
    if (!acc[tx.fy]) acc[tx.fy] = [];
    acc[tx.fy].push(tx);
    return acc;
  }, {});

  const wb = XLSX.utils.book_new();

  Object.keys(groupedByFY).forEach((fy) => {
    const data = groupedByFY[fy].map((tx) => ({
      // "Financial Year": tx.fy,
      "Scheme Name": tx.scheme,
      Folio: tx.folio,
      Category: tx.category,
      Quantity: parseFloat(tx.qty.toFixed(3)),
      "Purchase Date": new Date(tx.purchaseDate),
      "Purchase NAV": parseFloat(tx.purchaseNav.toFixed(4)),
      "Redemption Date": new Date(tx.redemptionDate),
      "Redemption NAV": parseFloat(tx.redemptionNav.toFixed(4)),
      "Holding Days": tx.holdingDays,
      "Purchase Value": parseFloat(tx.purchaseValue.toFixed(4)),
      "Redemption Value": parseFloat(tx.redemptionValue.toFixed(4)),
      STCG: tx.stcg !== 0 ? parseFloat(tx.stcg.toFixed(2)) : 0,
      LTCG: tx.ltcg !== 0 ? parseFloat(tx.ltcg.toFixed(2)) : 0,
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths
    ws["!cols"] = [
      { wch: 40 }, // Scheme Name
      { wch: 15 }, // Folio
      { wch: 12 }, // Category
      { wch: 12 }, // Quantity
      { wch: 15 }, // Purchase Date
      { wch: 15 }, // Purchase NAV
      { wch: 15 }, // Redemption Date
      { wch: 15 }, // Redemption NAV
      { wch: 12 }, // Holding Days
      { wch: 15 }, // Purchase Value
      { wch: 15 }, // Redemption Value
      { wch: 15 }, // STCG
      { wch: 15 }, // LTCG
    ];

    const sheetName = fy.toLowerCase().replace(/[\s-]+/g, "_");

    // Add sheet for each financial year
    XLSX.utils.book_append_sheet(wb, ws, `${sheetName}`);
  });

  const filename = `capital_gains_report_${
    new Date().toISOString().split("T")[0]
  }.xlsx`;
  XLSX.writeFile(wb, filename);

  showToast("Capital gains report downloaded successfully!", "success");
}

function downloadFYCapitalGainsReport(fy) {
  const allTransactions = getCapitalGainsTransactions();
  const fyTransactions = allTransactions.filter((tx) => tx.fy === fy);

  if (fyTransactions.length === 0) {
    showToast(`No transactions for ${fy}`, "warning");
    return;
  }

  const data = fyTransactions.map((tx) => ({
    // "Financial Year": tx.fy,
    "Scheme Name": tx.scheme,
    Folio: tx.folio,
    Category: tx.category,
    Quantity: parseFloat(tx.qty.toFixed(3)),
    "Purchase Date": new Date(tx.purchaseDate),
    "Purchase NAV": parseFloat(tx.purchaseNav.toFixed(4)),
    "Redemption Date": new Date(tx.redemptionDate),
    "Redemption NAV": parseFloat(tx.redemptionNav.toFixed(4)),
    "Holding Days": tx.holdingDays,
    "Purchase Value": parseFloat(tx.purchaseValue.toFixed(4)),
    "Redemption Value": parseFloat(tx.redemptionValue.toFixed(4)),
    STCG: tx.stcg !== 0 ? parseFloat(tx.stcg.toFixed(2)) : 0,
    LTCG: tx.ltcg !== 0 ? parseFloat(tx.ltcg.toFixed(2)) : 0,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 40 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
  ];

  const sheetName = fy.toLowerCase().replace(/[\s-]+/g, "_");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const filename = `capital_gains_${sheetName}_${
    new Date().toISOString().split("T")[0]
  }.xlsx`;
  XLSX.writeFile(wb, filename);

  showToast(`${fy} capital gains report downloaded!`, "success");
}

// DISPLAY FUNCTIONS - ANALYSIS TABS
function getOverlapCalculatorFundOptions() {
  return Object.entries(fundWiseData)
    .filter(
      ([, fund]) =>
        fund.holdings &&
        fund.holdings.length > 0 &&
        fund.advancedMetrics?.currentValue > 0,
    )
    .map(([key, fund]) => ({
      key,
      name: fund.schemeDisplay || fund.scheme,
      isin: fund.isin,
      amc: fund.amc,
      logo_url: mfStats?.[fund.isin]?.logo_url || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function renderOverlapVennSVG(overlapPercent) {
  const pct = Math.max(0, Math.min(100, parseFloat(overlapPercent) || 0));
  const r = 50;
  const centerX = 128;
  const cy = 70;
  // Ensure circles always visibly overlap, even at very low percentages,
  // by using sqrt scaling and capping the max separation below 2r.
  const maxDist = 92; // slight overlap at 0%
  const minDist = 18; // heavy overlap at 100%
  const factor = Math.sqrt(pct / 100);
  const distance = maxDist - factor * (maxDist - minDist);
  const cx1 = centerX - distance / 2;
  const cx2 = centerX + distance / 2;
  return `
    <svg viewBox="0 0 256 140" class="overlap-venn-svg" xmlns="http://www.w3.org/2000/svg">
      <circle class="overlap-venn-circle circle-a overlap-venn-start" cx="${cx1}" cy="${cy}" r="${r}" fill="#3b82f6" opacity="0.55"></circle>
      <circle class="overlap-venn-circle circle-b overlap-venn-start" cx="${cx2}" cy="${cy}" r="${r}" fill="#93c5fd" opacity="0.55"></circle>
    </svg>`;
}
function renderOverlapCalculatorResult(pairData) {
  window._overlapCalcPairData = pairData;

  if (!pairData) {
    return `<div class="cg-empty"><i class="fa-solid fa-circle-info"></i><span>Please select two different funds to compare.</span></div>`;
  }

  if (pairData.commonStocks.length === 0) {
    return `<div class="cg-empty"><i class="fa-solid fa-circle-check" style="color:var(--success);opacity:0.8;"></i><span>No common holdings between these two funds.</span></div>`;
  }

  const levelInfo = getOverlapLevelInfo(pairData.overlapPercent);
  const venn = renderOverlapVennSVG(pairData.overlapPercent);
  const top5 = pairData.commonStocks.slice(0, 5);

  const rows = top5
    .map(
      (stock) => `
        <div class="overlap-detail-stock-row">
          <span class="overlap-detail-stock-name">${stock.company}</span>
          <span class="overlap-detail-stock-pct">${stock.fund1Percent.toFixed(2)}%</span>
          <span class="overlap-detail-stock-pct fund-b">${stock.fund2Percent.toFixed(2)}%</span>
        </div>`,
    )
    .join("");

  return `
    <div class="overlap-calc-venn">${venn}</div>
    <div class="overlap-calc-details">
      <div class="overlap-calc-pct ${levelInfo.cls}">${pairData.overlapPercent}% <span>Overlap</span></div>
      <div class="overlap-calc-badges">
        <span class="overlap-calc-badge ${levelInfo.cls}">${levelInfo.levelLabel}</span>
        <span class="overlap-calc-badge">${levelInfo.diversificationLabel}</span>
      </div>
      <p class="overlap-calc-description">${levelInfo.description}</p>
      <div class="overlap-detail-table overlap-calc-table">
        <div class="overlap-detail-table-header">
          <span class="overlap-detail-stock-name">Common Stocks</span>
          <span class="overlap-detail-stock-pct">Fund A</span>
          <span class="overlap-detail-stock-pct fund-b">Fund B</span>
        </div>
        ${rows}
      </div>
      ${
        pairData.commonStocks.length > 5
          ? `<button class="overlap-calc-viewall-btn" onclick="showCalculatorOverlapModal()">View All ${pairData.commonStocks.length} Stocks</button>`
          : ""
      }
    </div>`;
}
function playOverlapVennAnimation(resultEl) {
  if (!resultEl) return;
  const circles = resultEl.querySelectorAll(".overlap-venn-circle");
  const details = resultEl.querySelector(".overlap-calc-details");

  // Double rAF so the "start" (separated) position is painted first,
  // then transitions to its resting position.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      circles.forEach((c) => c.classList.remove("overlap-venn-start"));
    });
  });

  if (details) {
    setTimeout(() => {
      details.classList.add("visible");
    }, 2000);
  }
}
function updateOverlapCalculator() {
  const resultEl = document.getElementById("overlapCalcResult");
  if (!resultEl || !_overlapFundA || !_overlapFundB) return;

  const pairData = calculatePairOverlap(_overlapFundA, _overlapFundB);

  resultEl.classList.add("overlap-calc-result-fade");
  setTimeout(() => {
    resultEl.innerHTML = renderOverlapCalculatorResult(pairData);
    requestAnimationFrame(() => {
      resultEl.classList.remove("overlap-calc-result-fade");
    });
    playOverlapVennAnimation(resultEl);
  }, 300);
}
// ── Overlap Calculator: selected fund keys (replaces hidden <select>) ──
let _overlapFundA = null;
let _overlapFundB = null;

function _getOverlapFundName(key) {
  const opts = getOverlapCalculatorFundOptions();
  return opts.find((f) => f.key === key)?.name || key;
}

function _getOverlapFundLogo(key) {
  const opts = getOverlapCalculatorFundOptions();
  return opts.find((f) => f.key === key)?.logo_url || null;
}

function _overlapFundAvatarHTML(logo, name, cls) {
  if (logo) {
    return `<img class="ocd-avatar ${cls}" src="${logo}" alt="" onerror="this.outerHTML='<span class=\'ocd-avatar ocd-avatar--text ${cls}\'>${(name || "?")[0].toUpperCase()}</span>'">`;
  }
  return `<span class="ocd-avatar ocd-avatar--text ${cls}">${(name || "?")[0].toUpperCase()}</span>`;
}

function renderOverlapCalculatorSection(data) {
  const fundOptions = getOverlapCalculatorFundOptions();
  if (fundOptions.length < 2) return "";

  let defaultKey1 = fundOptions[0].key;
  let defaultKey2 = fundOptions[1].key;
  const topPair = data.topOverlaps && data.topOverlaps[0];
  if (topPair && topPair.fund1Key && topPair.fund2Key) {
    defaultKey1 = topPair.fund1Key;
    defaultKey2 = topPair.fund2Key;
  }

  _overlapFundA = defaultKey1;
  _overlapFundB = defaultKey2;

  const pairData = calculatePairOverlap(defaultKey1, defaultKey2);

  const nameA = _getOverlapFundName(defaultKey1);
  const nameB = _getOverlapFundName(defaultKey2);
  const logoA = _getOverlapFundLogo(defaultKey1);
  const logoB = _getOverlapFundLogo(defaultKey2);

  return `
    <div class="cg-section">
      <div class="cg-section-head">
        <div class="cg-section-title"><i class="fa-solid fa-circle-half-stroke"></i><h3>Overlap Calculator</h3></div>
        <span class="cg-section-subtitle">Common holdings in two funds</span>
      </div>
      <div class="overlap-calc-body">
        <div class="overlap-calc-selectors">
          <div class="overlap-calc-select-card" onclick="openOverlapFundSheet('A')">
            <label class="overlap-detail-fund-label">Fund A</label>
            <div class="overlap-calc-select-wrap">
              <div class="ocd-trigger" id="overlapTriggerA">
                ${_overlapFundAvatarHTML(logoA, nameA, "ocd-avatar--a")}
                <span class="ocd-trigger-name">${nameA}</span>
                <i class="fa-solid fa-chevron-down ocd-chevron"></i>
              </div>
            </div>
          </div>
          <div class="overlap-calc-select-card" onclick="openOverlapFundSheet('B')">
            <label class="overlap-detail-fund-label fund-b">Fund B</label>
            <div class="overlap-calc-select-wrap">
              <div class="ocd-trigger" id="overlapTriggerB">
                ${_overlapFundAvatarHTML(logoB, nameB, "ocd-avatar--b")}
                <span class="ocd-trigger-name">${nameB}</span>
                <i class="fa-solid fa-chevron-down ocd-chevron"></i>
              </div>
            </div>
          </div>
        </div>
        <div id="overlapCalcResult">${renderOverlapCalculatorResult(pairData)}</div>
      </div>
    </div>`;
}

// ── Dispatcher: bottom sheet on mobile, compact dropdown on desktop ──
function openOverlapFundSheet(slot) {
  if (window.innerWidth <= 768) {
    _openOverlapFundSheetMobile(slot);
  } else {
    if (_ocdDDJustClosed) return;
    const triggerEl = document.getElementById(
      slot === "A" ? "overlapTriggerA" : "overlapTriggerB",
    );
    const cardEl = triggerEl
      ? triggerEl.closest(".overlap-calc-select-card")
      : null;
    openOverlapFundDropdown(slot, cardEl);
  }
}

// ─────────────────────────────────────────────
//  OCD Desktop Dropdown
// ─────────────────────────────────────────────

let _ocdDDSlot = null;
let _ocdDDEl = null;
let _ocdDDFocusIdx = -1;
let _ocdDDAnchorEl = null;
let _ocdDDJustClosed = false;

function openOverlapFundDropdown(slot, anchorEl) {
  closeOverlapFundDropdown();

  _ocdDDSlot = slot;
  _ocdDDFocusIdx = -1;

  const fundOptions = getOverlapCalculatorFundOptions();
  const currentKey = slot === "A" ? _overlapFundA : _overlapFundB;
  const otherKey = slot === "A" ? _overlapFundB : _overlapFundA;

  if (anchorEl) anchorEl.classList.add("overlap-calc-select-card--active");

  const dd = document.createElement("div");
  dd.className = "ocd-dd";
  dd.id = "ocdDesktopDropdown";

  dd.innerHTML = `
    <div class="ocd-dd-header">
      <span class="ocd-dd-title">
        ${
          slot === "A"
            ? '<span class="ocd-slot-badge ocd-slot-badge--a">A</span> Fund A'
            : '<span class="ocd-slot-badge ocd-slot-badge--b">B</span> Fund B'
        }
      </span>
      <button class="ocd-dd-close" onclick="closeOverlapFundDropdown()" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="ocd-dd-search-wrap">
      <i class="fa-solid fa-magnifying-glass ocd-dd-search-icon"></i>
      <input class="ocd-dd-search" id="ocdDDSearch" placeholder="Search funds\u2026"
        autocomplete="off" spellcheck="false"
        oninput="_ocdDDFilter()" onkeydown="_ocdDDKeyNav(event)">
    </div>
    <div class="ocd-dd-list" id="ocdDDList">
      ${_ocdDDBuildList(fundOptions, currentKey, otherKey)}
    </div>`;

  document.body.appendChild(dd);
  _ocdDDEl = dd;

  _ocdDDPosition(anchorEl);

  requestAnimationFrame(() => dd.classList.add("ocd-dd--open"));

  setTimeout(() => {
    const inp = document.getElementById("ocdDDSearch");
    if (inp) inp.focus();
  }, 60);

  _ocdDDAnchorEl = anchorEl || null;

  setTimeout(() => {
    document.addEventListener("mousedown", _ocdDDOutsideClick, {
      capture: true,
    });
    document.addEventListener("keydown", _ocdDDEscKey, { capture: true });
    window.addEventListener("scroll", _ocdDDOnScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", _ocdDDOnScroll, { passive: true });
  }, 80);
}

function _ocdDDBuildList(fundOptions, currentKey, otherKey) {
  return fundOptions
    .map((f, idx) => {
      const isOther = f.key === otherKey;
      const isChosen = f.key === currentKey;
      const logo = f.logo_url;
      const avatarHTML = logo
        ? `<img class="ocd-item-avatar" src="${logo}" alt="" onerror="this.outerHTML='<span class=\\'ocd-item-avatar ocd-item-avatar--text\\'>${f.name[0].toUpperCase()}</span>'">`
        : `<span class="ocd-item-avatar ocd-item-avatar--text">${f.name[0].toUpperCase()}</span>`;

      if (isOther) {
        return `
        <div class="ocd-item ocd-item--disabled" data-idx="${idx}">
          ${avatarHTML}
          <div class="ocd-item-text">
            <span class="ocd-item-name">${f.name}</span>
            <span class="ocd-item-sub">Already selected</span>
          </div>
          <span class="ocd-radio ocd-radio--disabled"></span>
        </div>`;
      }
      return `
      <div class="ocd-item${isChosen ? " ocd-item--selected" : ""}"
           data-key="${f.key}" data-idx="${idx}"
           onclick="_ocdDDSelect('${f.key}')"
           onmouseenter="_ocdDDSetFocus(${idx})">
        ${avatarHTML}
        <div class="ocd-item-text">
          <span class="ocd-item-name">${f.name}</span>
        </div>
        ${
          isChosen
            ? '<span class="ocd-radio ocd-radio--checked"><i class="fa-solid fa-check"></i></span>'
            : '<span class="ocd-radio"></span>'
        }
      </div>`;
    })
    .join("");
}

function _ocdDDPosition(anchorEl) {
  const dd = _ocdDDEl;
  if (!dd) return;
  const MARGIN = 6;
  const DDW = 320;
  dd.style.position = "fixed";
  dd.style.visibility = "hidden";
  dd.style.width = `${DDW}px`;

  const rect = anchorEl
    ? anchorEl.getBoundingClientRect()
    : {
        bottom: 120,
        top: 80,
        left: window.innerWidth / 2 - DDW / 2,
        width: DDW,
      };

  const vp = { w: window.innerWidth, h: window.innerHeight };
  const ddH = Math.min(dd.scrollHeight, 420);
  const spaceBelow = vp.h - rect.bottom - MARGIN;
  const spaceAbove = rect.top - MARGIN;
  const placeAbove = spaceBelow < ddH && spaceAbove > spaceBelow;

  let left = rect.left;
  if (left + DDW > vp.w - 8) left = vp.w - DDW - 8;
  if (left < 8) left = 8;

  dd.style.left = `${left}px`;
  dd.style.top = placeAbove
    ? `${rect.top - ddH - MARGIN}px`
    : `${rect.bottom + MARGIN}px`;
  dd.style.visibility = "";

  // Anchor the scale animation to the trigger's horizontal midpoint
  // so the dropdown appears to open from the trigger rather than floating.
  const anchorMidX = rect.left + rect.width / 2;
  const originX = Math.round(anchorMidX - left);
  const originY = placeAbove ? "100%" : "0%";
  dd.style.transformOrigin = `${originX}px ${originY}`;

  dd.classList.toggle("ocd-dd--above", placeAbove);
  dd.classList.toggle("ocd-dd--below", !placeAbove);
}

function _ocdDDFilter() {
  const q = (document.getElementById("ocdDDSearch")?.value || "")
    .toLowerCase()
    .trim();
  const items = document.querySelectorAll("#ocdDDList .ocd-item");
  let visible = [];
  items.forEach((item) => {
    const name =
      item.querySelector(".ocd-item-name")?.textContent?.toLowerCase() || "";
    const matches = !q || name.includes(q);
    item.style.display = matches ? "" : "none";
    if (matches && !item.classList.contains("ocd-item--disabled"))
      visible.push(item);
  });
  const listEl = document.getElementById("ocdDDList");
  const emptyEl = listEl?.querySelector(".ocd-dd-empty");
  if (q && visible.length === 0) {
    if (!emptyEl)
      listEl.insertAdjacentHTML(
        "beforeend",
        `<div class="ocd-dd-empty">No funds found</div>`,
      );
  } else {
    if (emptyEl) emptyEl.remove();
  }
  _ocdDDFocusIdx = -1;
}

function _ocdDDKeyNav(e) {
  const items = Array.from(
    document.querySelectorAll("#ocdDDList .ocd-item:not(.ocd-item--disabled)"),
  ).filter((el) => el.style.display !== "none");
  if (!items.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    _ocdDDFocusIdx = (_ocdDDFocusIdx + 1) % items.length;
    _ocdDDApplyFocus(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    _ocdDDFocusIdx = (_ocdDDFocusIdx - 1 + items.length) % items.length;
    _ocdDDApplyFocus(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (_ocdDDFocusIdx >= 0 && items[_ocdDDFocusIdx]) {
      const key = items[_ocdDDFocusIdx].dataset.key;
      if (key) _ocdDDSelect(key);
    }
  }
}

function _ocdDDSetFocus(idx) {
  _ocdDDFocusIdx = idx;
  const items = Array.from(
    document.querySelectorAll("#ocdDDList .ocd-item:not(.ocd-item--disabled)"),
  );
  _ocdDDApplyFocus(items);
}

function _ocdDDApplyFocus(items) {
  document
    .querySelectorAll("#ocdDDList .ocd-item")
    .forEach((el) => el.classList.remove("ocd-item--focused"));
  if (_ocdDDFocusIdx >= 0 && items[_ocdDDFocusIdx]) {
    items[_ocdDDFocusIdx].classList.add("ocd-item--focused");
    items[_ocdDDFocusIdx].scrollIntoView({ block: "nearest" });
  }
}

function _ocdDDSelect(key) {
  selectOverlapFund(_ocdDDSlot, key);
  closeOverlapFundDropdown();
}

function closeOverlapFundDropdown() {
  document.removeEventListener("mousedown", _ocdDDOutsideClick, {
    capture: true,
  });
  document.removeEventListener("keydown", _ocdDDEscKey, { capture: true });
  window.removeEventListener("scroll", _ocdDDOnScroll, { capture: true });
  window.removeEventListener("resize", _ocdDDOnScroll);
  _ocdDDAnchorEl = null;
  document
    .querySelectorAll(".overlap-calc-select-card--active")
    .forEach((el) => el.classList.remove("overlap-calc-select-card--active"));
  const dd = document.getElementById("ocdDesktopDropdown");
  if (!dd) return;
  dd.classList.remove("ocd-dd--open");
  setTimeout(() => {
    dd.remove();
  }, 180);
  _ocdDDEl = null;
  _ocdDDSlot = null;
}

function _ocdDDOnScroll() {
  if (!_ocdDDEl || !_ocdDDAnchorEl) return;
  const rect = _ocdDDAnchorEl.getBoundingClientRect();
  // If the anchor has scrolled completely out of the viewport, close
  if (
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth
  ) {
    closeOverlapFundDropdown();
    return;
  }
  _ocdDDPosition(_ocdDDAnchorEl);
}

function _ocdDDOutsideClick(e) {
  const dd = document.getElementById("ocdDesktopDropdown");
  if (!dd) return;
  if (dd.contains(e.target)) return;
  if (e.target.closest(".overlap-calc-select-card")) {
    _ocdDDJustClosed = true;
    setTimeout(() => {
      _ocdDDJustClosed = false;
    }, 300);
  }
  closeOverlapFundDropdown();
}

function _ocdDDEscKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeOverlapFundDropdown();
  }
}

// ── Mobile bottom sheet (original logic, self-contained) ──
function _openOverlapFundSheetMobile(slot) {
  const fundOptions = getOverlapCalculatorFundOptions();
  const currentKey = slot === "A" ? _overlapFundA : _overlapFundB;
  const otherKey = slot === "A" ? _overlapFundB : _overlapFundA;

  // If a sheet is already open (switching slot A -> B), just remove the old
  // DOM immediately — do NOT touch history here. We'll only push once below.
  const existingOverlay = document.getElementById("overlapFundSheetOverlay");
  const alreadyHasHistoryEntry =
    existingOverlay &&
    window.history.state &&
    window.history.state.sheet === "ocd";
  if (existingOverlay) {
    existingOverlay.remove();
  }
  lockBodyScroll();

  const overlay = document.createElement("div");
  overlay.className = "ocd-overlay";
  overlay.id = "overlapFundSheetOverlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) closeOverlapFundSheet();
  };

  const sheet = document.createElement("div");
  sheet.className = "ocd-sheet";

  const listHTML = fundOptions
    .map((f) => {
      const isAlreadySelected = f.key === otherKey;
      const isCurrentlyChosen = f.key === currentKey;
      const logo = f.logo_url;
      const avatarHTML = logo
        ? `<img class="ocd-item-avatar" src="${logo}" alt="" onerror="this.outerHTML='<span class=\\'ocd-item-avatar ocd-item-avatar--text\\'>${f.name[0].toUpperCase()}</span>'">`
        : `<span class="ocd-item-avatar ocd-item-avatar--text">${f.name[0].toUpperCase()}</span>`;

      if (isAlreadySelected) {
        return `
        <div class="ocd-item ocd-item--disabled">
          ${avatarHTML}
          <div class="ocd-item-text">
            <span class="ocd-item-name">${f.name}</span>
            <span class="ocd-item-sub">Already Selected</span>
          </div>
          <span class="ocd-radio ocd-radio--disabled"></span>
        </div>`;
      }
      return `
      <div class="ocd-item${isCurrentlyChosen ? " ocd-item--selected" : ""}" onclick="selectOverlapFund('${slot}','${f.key}')">
        ${avatarHTML}
        <div class="ocd-item-text">
          <span class="ocd-item-name">${f.name}</span>
        </div>
        ${
          isCurrentlyChosen
            ? '<span class="ocd-radio ocd-radio--checked"><i class="fa-solid fa-check"></i></span>'
            : '<span class="ocd-radio"></span>'
        }
      </div>`;
    })
    .join("");

  sheet.innerHTML = `
    <div class="ocd-drag-pill"></div>
    <div class="ocd-sheet-header">
      <span class="ocd-sheet-title">Select Fund ${slot === "A" ? '<span class="ocd-slot-badge ocd-slot-badge--a">A</span>' : '<span class="ocd-slot-badge ocd-slot-badge--b">B</span>'}</span>
    </div>
    <div class="ocd-search-wrap">
      <i class="fa-solid fa-magnifying-glass ocd-search-icon"></i>
      <input class="ocd-search-input" id="overlapFundSearch" placeholder="Search for any mutual fund" oninput="filterOverlapFundSheet()" autocomplete="off">
    </div>
    <div class="ocd-list" id="overlapFundList">${listHTML}</div>`;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  let startY = 0;
  sheet.addEventListener(
    "touchstart",
    (e) => {
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  sheet.addEventListener(
    "touchmove",
    (e) => {
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    },
    { passive: true },
  );
  sheet.addEventListener("touchend", (e) => {
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) {
      closeOverlapFundSheet();
    } else {
      sheet.style.transform = "";
    }
  });

  overlay.dataset.slot = slot;
  requestAnimationFrame(() => sheet.classList.add("ocd-sheet--open"));

  // Dedicated history entry for the sheet — only push if we don't already
  // have one (i.e. this isn't a slot A->B switch while the sheet was open).
  if (!alreadyHasHistoryEntry) {
    window.history.pushState({ sheet: "ocd" }, "", window.location.href);
  }
}

function filterOverlapFundSheet() {
  const query = (
    document.getElementById("overlapFundSearch")?.value || ""
  ).toLowerCase();
  const items = document.querySelectorAll("#overlapFundList .ocd-item");
  items.forEach((item) => {
    const name =
      item.querySelector(".ocd-item-name")?.textContent?.toLowerCase() || "";
    item.style.display = name.includes(query) ? "" : "none";
  });
}

function selectOverlapFund(slot, key) {
  if (slot === "A") {
    _overlapFundA = key;
  } else {
    _overlapFundB = key;
  }
  closeOverlapFundSheet();
  _refreshOverlapTriggers();
  updateOverlapCalculator();
}

function _refreshOverlapTriggers() {
  const nameA = _getOverlapFundName(_overlapFundA);
  const nameB = _getOverlapFundName(_overlapFundB);
  const logoA = _getOverlapFundLogo(_overlapFundA);
  const logoB = _getOverlapFundLogo(_overlapFundB);

  const trigA = document.getElementById("overlapTriggerA");
  const trigB = document.getElementById("overlapTriggerB");

  if (trigA)
    trigA.innerHTML = `
    ${_overlapFundAvatarHTML(logoA, nameA, "ocd-avatar--a")}
    <span class="ocd-trigger-name">${nameA}</span>
    <i class="fa-solid fa-chevron-down ocd-chevron"></i>`;

  if (trigB)
    trigB.innerHTML = `
    ${_overlapFundAvatarHTML(logoB, nameB, "ocd-avatar--b")}
    <span class="ocd-trigger-name">${nameB}</span>
    <i class="fa-solid fa-chevron-down ocd-chevron"></i>`;
}

function closeOverlapFundSheet(fromPopState) {
  const overlay = document.getElementById("overlapFundSheetOverlay");
  if (!overlay) return;
  const sheet = overlay.querySelector(".ocd-sheet");
  if (sheet) {
    sheet.classList.remove("ocd-sheet--open");
    sheet.style.transform = "";
  }
  setTimeout(() => {
    overlay.remove();
    unlockBodyScroll();
  }, 280);

  // If closed via UI (tap outside / select fund), not via back button,
  // pop the dedicated {sheet:"ocd"} entry we pushed when it opened.
  if (
    !fromPopState &&
    window.history.state &&
    window.history.state.sheet === "ocd"
  ) {
    window.history.back();
  }
}
function displayOverlapAnalysis() {
  const container = document.getElementById("overlapContent");
  const data = calculateOverlapAnalysis();

  const sectionHead = `
    <div class="cg-section-head">
      <div class="cg-section-title"><i class="fa-solid fa-layer-group"></i><h3>Fund Overlap Analysis</h3></div>
      <span class="cg-section-subtitle">Identify duplicate holdings (> 5%)</span>
    </div>`;

  if (data.error) {
    container.innerHTML = `<div class="cg-section">${sectionHead}<div class="cg-empty"><i class="fa-solid fa-layer-group"></i><span>${data.error}</span></div></div>`;
    return;
  }

  const hasOverlapData = data.topOverlaps && data.topOverlaps.length > 0;
  const hasCommonHoldings =
    data.commonHoldings && data.commonHoldings.length > 0;

  if (!hasOverlapData && !hasCommonHoldings) {
    container.innerHTML = `<div class="cg-section">${sectionHead}<div class="cg-empty"><i class="fa-solid fa-circle-check" style="color:var(--success);opacity:0.8;"></i><span>No overlap found — great diversification!</span></div></div>`;
    return;
  }

  let html = `<div class="cg-section">${sectionHead}`;

  // Hero strip: summary counts
  if (hasOverlapData) {
    const highOverlap = data.topOverlaps.filter(
      (p) => p.overlapPercent > 50,
    ).length;
    const medOverlap = data.topOverlaps.filter(
      (p) => p.overlapPercent > 25 && p.overlapPercent <= 50,
    ).length;
    const lowOverlap = data.topOverlaps.filter(
      (p) => p.overlapPercent <= 25,
    ).length;

    html += `
      <div class="cg-hero-strip">
        <div class="cg-hero-cell${highOverlap ? " loss-cell" : ""}">
          <span class="cg-hero-label">High Overlap (&gt;50%)</span>
          <span class="cg-hero-value${highOverlap ? " loss" : ""}">${highOverlap}</span>
          <span class="cg-hero-sub">fund pairs</span>
        </div>
        <div class="cg-hero-cell${medOverlap ? " accent-cell" : ""}">
          <span class="cg-hero-label">Medium (25–50%)</span>
          <span class="cg-hero-value${medOverlap ? " accent" : ""}">${medOverlap}</span>
          <span class="cg-hero-sub">fund pairs</span>
        </div>
        <div class="cg-hero-cell${lowOverlap ? " gain-cell" : ""}">
          <span class="cg-hero-label">Low (&lt;25%)</span>
          <span class="cg-hero-value${lowOverlap ? " gain" : ""}">${lowOverlap}</span>
          <span class="cg-hero-sub">fund pairs</span>
        </div>
        ${
          hasCommonHoldings
            ? `
        <div class="cg-hero-cell accent-cell">
          <span class="cg-hero-label">Common Stocks</span>
          <span class="cg-hero-value accent">${data.commonHoldings.length}</span>
          <span class="cg-hero-sub">across funds</span>
        </div>`
            : ""
        }
      </div>`;

    // Fund pair rows
    html += `<div class="cg-sub-title">Highest Overlapping Fund Pairs</div>`;

    // Cache for the detail modal lookups
    window._overlapPairsData = data.topOverlaps;

    const visiblePairs = data.topOverlaps.slice(0, 5);

    visiblePairs.forEach((pair, pairIndex) => {
      const pctClass =
        pair.overlapPercent > 50
          ? "loss"
          : pair.overlapPercent > 25
            ? "warning"
            : "gain";
      html += `
        <div class="overlap-pair-row overlap-row-clickable" onclick="showOverlapDetailModal(${pairIndex})">
          <div class="overlap-fund-names">
            <div class="overlap-fund-name">${pair.fund1}</div>
            <div class="overlap-fund-name secondary">${pair.fund2}</div>
          </div>
          <div class="overlap-pct-cell">
            <span class="overlap-pct-val ${pctClass}">${pair.overlapPercent}%</span>
            <span class="overlap-pct-label">overlap</span>
          </div>
          <div class="overlap-stocks-cell">
            <span class="overlap-stocks-num">${pair.commonStocks.length}</span>
            <span class="overlap-stocks-label">stocks</span>
          </div>
        </div>`;
    });

    if (data.topOverlaps.length > 5) {
      html += `<button class="overlap-calc-viewall-btn no-top-radius" onclick="showAllOverlapPairsModal()">View All ${data.topOverlaps.length} Fund Pairs</button>`;
    }
  }

  html += `</div>`;

  // Common holdings — separate section
  if (hasCommonHoldings) {
    // Cache for the detail modal lookups
    window._commonHoldingsData = data.commonHoldings;

    const commonHoldingsSectionHead = `
      <div class="cg-section-head">
        <div class="cg-section-title"><i class="fa-solid fa-building-columns"></i><h3>Stocks Common Across Multiple Funds</h3></div>
        <span class="cg-section-subtitle">Held by 3 or more of your funds</span>
      </div>`;

    html += `<div class="cg-section">${commonHoldingsSectionHead}`;

    data.commonHoldings.slice(0, 5).forEach((holding, holdingIndex) => {
      html += `
        <div class="overlap-pair-row overlap-row-clickable" onclick="showCommonHoldingDetailModal(${holdingIndex})">
          <div class="overlap-fund-names">
            <div class="overlap-fund-name">${holding.company}</div>
          </div>
          <div class="overlap-pct-cell">
            <span class="overlap-pct-val accent">${holding.avgWeight}%</span>
            <span class="overlap-pct-label">avg weight</span>
          </div>
          <div class="overlap-stocks-cell">
            <span class="overlap-stocks-num">${holding.fundCount}</span>
            <span class="overlap-stocks-label">funds</span>
          </div>
        </div>`;
    });

    if (data.commonHoldings.length > 5) {
      html += `<button class="overlap-calc-viewall-btn no-top-radius" onclick="showAllCommonHoldingsModal()">View All ${data.commonHoldings.length} Stocks</button>`;
    }

    html += `</div>`;
  }

  // Overlap Calculator — pick any two funds to compare
  html += renderOverlapCalculatorSection(data);

  container.innerHTML = html;

  playOverlapVennAnimation(document.getElementById("overlapCalcResult"));
}
function displayExpenseImpact() {
  const container = document.getElementById("expenseContent");
  const data = calculateExpenseImpact();

  const erClass =
    data.weightedExpenseRatio > 1.5
      ? "loss"
      : data.weightedExpenseRatio > 1
        ? "warning"
        : "gain";

  let html = `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3><i class="fa-solid fa-receipt" style="margin-right:6px;color:#667eea;"></i>Expense Ratio Impact</h3>
        <p class="section-subtitle">Fund management fees on your portfolio</p>
      </div>

      <div class="gains-summary-grid">
        <div class="gains-summary-card">
          <h4>Weighted Expense Ratio</h4>
          <div class="summary-row">
            <span>Your Portfolio</span>
            <span class="${erClass}">${data.weightedExpenseRatio.toFixed(3)}%</span>
          </div>
        </div>
        <div class="gains-summary-card">
          <h4>Annual Cost</h4>
          <div class="summary-row">
            <span>Total Fees/Year</span>
            <span class="loss">₹${formatNumber(data.annualCost)}</span>
          </div>
        </div>
        <div class="gains-summary-card">
          <h4>Lifetime Cost</h4>
          <div class="summary-row">
            <span>Total Paid</span>
            <span class="loss">₹${formatNumber(data.lifetimeCost)}</span>
          </div>
        </div>
      </div>

      <div class="gains-table-wrapper" style="margin-top: 0;">
        <h4>Fund-wise Expense Breakdown</h4>
        <table class="gains-table">
          <thead>
            <tr>
              <th>Fund Name</th>
              <th>Current Value</th>
              <th>Expense Ratio</th>
              <th>Annual Cost</th>
              <th>Lifetime Cost</th>
            </tr>
          </thead>
          <tbody>
  `;

  data.funds.forEach((fund) => {
    const erClass =
      fund.expenseRatio > 1.5
        ? "loss"
        : fund.expenseRatio > 1
          ? "warning"
          : "gain";

    html += `
      <tr>
        <td>${fund.name}</td>
        <td>₹${formatNumber(fund.value)}</td>
        <td class="${erClass}">${fund.expenseRatio.toFixed(2)}%</td>
        <td>₹${formatNumber(fund.annualCost)}</td>
        <td>₹${formatNumber(fund.lifetimeCost)}</td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
}
function displayHealthScore() {
  const container = document.getElementById("healthScoreContent");
  const scores = calculateHealthScore();

  if (scores.error) {
    container.innerHTML = `
      <div class="cg-section">
        <div class="cg-section-head">
          <div class="cg-section-title"><i class="fa-solid fa-heart-pulse"></i><h3>Portfolio Health Score</h3></div>
        </div>
        <div class="cg-empty"><i class="fa-solid fa-heart-pulse"></i><span>${scores.error}</span></div>
      </div>
    `;
    return;
  }

  const getGrade = (score) => {
    if (score >= 85)
      return {
        grade: "A+",
        color: "#10b981",
        bg: "rgba(16,185,129,0.12)",
        message: "Excellent",
      };
    if (score >= 75)
      return {
        grade: "A",
        color: "#10b981",
        bg: "rgba(16,185,129,0.1)",
        message: "Great",
      };
    if (score >= 65)
      return {
        grade: "B+",
        color: "#3b82f6",
        bg: "rgba(59,130,246,0.12)",
        message: "Good",
      };
    if (score >= 55)
      return {
        grade: "B",
        color: "#3b82f6",
        bg: "rgba(59,130,246,0.1)",
        message: "Above Average",
      };
    if (score >= 45)
      return {
        grade: "C",
        color: "#f59e0b",
        bg: "rgba(245,158,11,0.12)",
        message: "Average",
      };
    return {
      grade: "D",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.12)",
      message: "Needs Improvement",
    };
  };

  const getDetailColor = (pct) =>
    pct >= 80
      ? "#10b981"
      : pct >= 60
        ? "#3b82f6"
        : pct >= 40
          ? "#f59e0b"
          : "#ef4444";

  const detailIcons = {
    diversification: "fa-solid fa-sitemap",
    performance: "fa-solid fa-chart-line",
    overlap: "fa-solid fa-layer-group",
    expense: "fa-solid fa-receipt",
    consistency: "fa-solid fa-calendar-check",
    rebalancing: "fa-solid fa-sliders",
  };

  const result = getGrade(scores.overall);

  let html = `
    <div class="cg-section">
      <div class="cg-section-head">
        <div class="cg-section-title">
          <i class="fa-solid fa-heart-pulse"></i>
          <h3>Portfolio Health Score</h3>
        </div>
        <span class="cg-section-subtitle">Data-driven assessment</span>
      </div>

      <!-- Hero circle -->
      <div class="health-hero-wrap">
        <div class="health-score-circle" style="border-color:${result.color}; background:${result.bg}; color:${result.color};">
          <span class="health-score-num">${scores.overall}</span>
          <span class="health-score-denom">/100</span>
        </div>
        <span class="health-grade-badge" style="background:${result.bg}; color:${result.color};">Grade ${result.grade}</span>
        <span class="health-grade-label">${result.message}</span>
      </div>

      <!-- Detail rows -->
  `;

  Object.entries(scores.details).forEach(([key, detail]) => {
    const pct = (detail.score / detail.max) * 100;
    const color = getDetailColor(pct);
    const icon = detailIcons[key] || "fa-solid fa-circle-check";

    html += `
      <div class="health-detail-row">
        <div class="health-detail-icon" style="background:${color};">
          <i class="${icon}"></i>
        </div>
        <div class="health-detail-info">
          <div class="health-detail-name">${key}</div>
          <div class="health-detail-msg">${detail.message}</div>
        </div>
        <div class="health-detail-right">
          <span class="health-detail-score" style="color:${color};">${detail.score}<span style="font-size:10px;font-weight:600;opacity:0.6;">/${detail.max}</span></span>
          <div class="health-progress-bar">
            <div class="health-progress-fill" style="width:${pct}%; background:${color};"></div>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// TRANSACTION CALENDAR
function renderTransactionCalendar() {
  const section = document.getElementById("transactionCalendarSection");
  if (!section) return;

  if (!allTimeFlows || allTimeFlows.length === 0) {
    section.innerHTML = "";
    return;
  }

  const allCount = (allTimeFlows || []).filter(
    (f) => f.type !== "VALUATION",
  ).length;
  const activeCount = (activeFlows || []).filter(
    (f) => f.type !== "VALUATION",
  ).length;

  // Build a map: "YYYY-MM-DD" -> { invested: number, withdrawn: number }
  const dayMap = {};
  allTimeFlows.forEach((flow) => {
    if (flow.type !== "PURCHASE" && flow.type !== "REDEMPTION") return;
    const d = flow.date;
    if (!(d instanceof Date) || isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!dayMap[key]) dayMap[key] = { invested: 0, withdrawn: 0 };
    if (flow.type === "PURCHASE") dayMap[key].invested += Math.abs(flow.amount);
    else dayMap[key].withdrawn += Math.abs(flow.amount);
  });

  // Determine year range
  const years = [
    ...new Set(Object.keys(dayMap).map((k) => parseInt(k.slice(0, 4)))),
  ].sort();
  if (years.length === 0) {
    section.innerHTML = "";
    return;
  }

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  function buildYearCalendar(year) {
    let html = `<div class="txcal-year"><div class="txcal-year-label">${year}</div><div class="txcal-months">`;
    for (let m = 0; m < 12; m++) {
      const firstDay = new Date(year, m, 1).getDay(); // 0=Sun
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      html += `<div class="txcal-month"><div class="txcal-month-name">${MONTH_NAMES[m]}</div><div class="txcal-grid">`;
      // Day-of-week headers
      DAY_NAMES.forEach((d) => {
        html += `<div class="txcal-dow">${d[0]}</div>`;
      });
      // Empty cells before first day
      for (let i = 0; i < firstDay; i++)
        html += `<div class="txcal-day txcal-day--empty"></div>`;
      // Days
      for (let day = 1; day <= daysInMonth; day++) {
        const key = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const data = dayMap[key];
        let cls = "txcal-day";
        let title = "";
        if (data) {
          if (data.invested > 0 && data.withdrawn > 0) {
            cls += " txcal-day--both";
            title = `Invested ₹${Math.round(data.invested).toLocaleString("en-IN")} · Withdrawn ₹${Math.round(data.withdrawn).toLocaleString("en-IN")}`;
          } else if (data.invested > 0) {
            cls += " txcal-day--invest";
            title = `Invested ₹${Math.round(data.invested).toLocaleString("en-IN")}`;
          } else if (data.withdrawn > 0) {
            cls += " txcal-day--redeem";
            title = `Withdrawn ₹${Math.round(data.withdrawn).toLocaleString("en-IN")}`;
          }
        }
        html += `<div class="${cls}" title="${title}">${day}</div>`;
      }
      html += `</div></div>`;
    }
    html += `</div></div>`;
    return html;
  }

  // Default to most recent year
  const defaultYear = years[years.length - 1];
  const useDropdown = years.length > 12;

  const yearSelectorHtml = useDropdown
    ? `<div class="txcal-year-dropdown-wrap">
        <select class="txcal-year-select" onchange="switchCalendarYear(parseInt(this.value))">
          ${years.map((y) => `<option value="${y}"${y === defaultYear ? " selected" : ""}>${y}</option>`).join("")}
        </select>
      </div>`
    : `<div class="txcal-year-tabs">
        ${years.map((y) => `<button class="txcal-year-tab${y === defaultYear ? " active" : ""}" onclick="switchCalendarYear(${y})">${y}</button>`).join("")}
      </div>`;

  const calendarsHtml = years
    .map(
      (y) =>
        `<div class="txcal-year-panel" id="txcal-year-${y}" style="display:${y === defaultYear ? "block" : "none"}">${buildYearCalendar(y)}</div>`,
    )
    .join("");
  section.innerHTML = "";

  const calander = `
    <div class="monthly-summary-container">
      <div class="section-header section-header--with-pills">
        <div class="section-header-left">
          <h3>📅 Transaction Calendar</h3>
          <p class="section-subtitle">Days you invested (green) or withdrew (red)</p>
        </div>
        <div class="section-header-pills">
          <span class="tx-stat-pill tx-stat-pill--total">Total ${allCount}</span>
          <span class="tx-stat-pill tx-stat-pill--active">Active ${activeCount}</span>
        </div>
      </div>
      ${yearSelectorHtml}
      <div class="txcal-legend">
        <span class="txcal-legend-dot txcal-legend-dot--invest"></span><span>Invested</span>
        <span class="txcal-legend-dot txcal-legend-dot--redeem"></span><span>Withdrawn</span>
        <span class="txcal-legend-dot txcal-legend-dot--both"></span><span>Both</span>
      </div>
      ${calendarsHtml}
    </div>
  `;

  section.insertAdjacentHTML("beforeend", calander);
}

window.switchCalendarYear = function (year) {
  document
    .querySelectorAll(".txcal-year-panel")
    .forEach((p) => (p.style.display = "none"));
  const panel = document.getElementById(`txcal-year-${year}`);
  if (panel) panel.style.display = "block";
  // Update pills if present
  document.querySelectorAll(".txcal-year-tab").forEach((b) => {
    b.classList.toggle("active", b.textContent == year);
  });
  // Update dropdown if present
  const sel = document.querySelector(".txcal-year-select");
  if (sel) sel.value = year;
};

// DISPLAY FUNCTIONS - MONTHLY SUMMARY & PROJECTIONS
function displayMonthlySummaryAndProjections() {
  const container = document.getElementById("monthlySummarySection");
  if (!container) return;

  const summary = calculateMonthlySummary();

  if (!summary) {
    container.innerHTML =
      '<p class="no-data">No transaction data available for monthly summary</p>';
    return;
  }

  const currentValue = Object.values(fundWiseData).reduce(
    (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
    0,
  );

  const defaultCAGR = 12;
  const defaultStepup = 0;
  const defaultCustomSIP =
    Math.ceil(
      Math.max(summary.sixMonths.inflow, summary.twelveMonths.inflow) / 10000,
    ) * 10000;

  const projections6M = calculateProjections(
    currentValue,
    summary.sixMonths.inflow,
    defaultCAGR,
    defaultStepup,
  );
  const projections12M = calculateProjections(
    currentValue,
    summary.twelveMonths.inflow,
    defaultCAGR,
    defaultStepup,
  );
  const projectionsCustom = calculateProjections(
    currentValue,
    defaultCustomSIP,
    defaultCAGR,
    defaultStepup,
  );

  let html = `
    <div class="monthly-summary-container">
      <div class="section-header">
        <h3>📊 Average Monthly Summary</h3>
        <p class="section-subtitle">Your investment patterns over recent months</p>
      </div>

      <div class="gains-summary-grid alltime-summary-grid monthly-summary-cards">

        <div class="gains-summary-card folio-card">
          <div class="folio-card-header">
            <span class="folio-card-name-header">📅 Last 6 Months</span>
          </div>
          <div class="folio-card-hero">
            <div class="folio-card-hero-cell folio-card-hero-cell--pnl-gain">
              <span class="folio-card-hero-label">Avg Buy</span>
              <span class="folio-card-hero-value">₹${formatNumber(Math.round(summary.sixMonths.avgBuy))}</span>
            </div>
            <div class="folio-card-hero-cell folio-card-hero-cell--pnl-loss">
              <span class="folio-card-hero-label">Avg Sell</span>
              <span class="folio-card-hero-value">₹${formatNumber(Math.round(summary.sixMonths.avgSell))}</span>
            </div>
            <div class="folio-card-hero-cell ${summary.sixMonths.avgNetInflow >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
              <span class="folio-card-hero-label">Avg Net Inflow</span>
              <span class="folio-card-hero-value ${summary.sixMonths.avgNetInflow >= 0 ? "gain" : "loss"}">
                ${summary.sixMonths.avgNetInflow >= 0 ? "" : "-"}₹${formatNumber(Math.round(Math.abs(summary.sixMonths.avgNetInflow)))}
              </span>
            </div>
          </div>
          <div class="folio-card-chips-row">
            <div class="folio-card-meta-chip">
              <span class="folio-card-meta-label">Used for Projection</span>
              <span class="folio-card-meta-value">₹${formatNumber(Math.round(summary.sixMonths.inflow))}/mo</span>
            </div>
          </div>
        </div>

        <div class="gains-summary-card folio-card">
          <div class="folio-card-header">
            <span class="folio-card-name-header">📅 Last 12 Months</span>
          </div>
          <div class="folio-card-hero">
            <div class="folio-card-hero-cell folio-card-hero-cell--pnl-gain">
              <span class="folio-card-hero-label">Avg Buy</span>
              <span class="folio-card-hero-value">₹${formatNumber(Math.round(summary.twelveMonths.avgBuy))}</span>
            </div>
            <div class="folio-card-hero-cell folio-card-hero-cell--pnl-loss">
              <span class="folio-card-hero-label">Avg Sell</span>
              <span class="folio-card-hero-value">₹${formatNumber(Math.round(summary.twelveMonths.avgSell))}</span>
            </div>
            <div class="folio-card-hero-cell ${summary.twelveMonths.avgNetInflow >= 0 ? "folio-card-hero-cell--pnl-gain" : "folio-card-hero-cell--pnl-loss"}">
              <span class="folio-card-hero-label">Avg Net Inflow</span>
              <span class="folio-card-hero-value ${summary.twelveMonths.avgNetInflow >= 0 ? "gain" : "loss"}">
                ${summary.twelveMonths.avgNetInflow >= 0 ? "" : "-"}₹${formatNumber(Math.round(Math.abs(summary.twelveMonths.avgNetInflow)))}
              </span>
            </div>
          </div>
          <div class="folio-card-chips-row">
            <div class="folio-card-meta-chip">
              <span class="folio-card-meta-label">Used for Projection</span>
              <span class="folio-card-meta-value">₹${formatNumber(Math.round(summary.twelveMonths.inflow))}/mo</span>
            </div>
          </div>
        </div>

      </div>

      <div class="section-header" style="margin-top: 40px;">
        <h3>🚀 Portfolio Projection</h3>
        <p class="section-subtitle">Future value based on your average monthly investment pattern</p>
      </div>

      <div class="projection-controls">
        <div class="cagr-selector">
          <label for="cagrInput">Expected Annual Returns (CAGR):</label>
          <div class="cagr-input-group">
            <input 
              type="number" 
              id="cagrInput" 
              value="${defaultCAGR}" 
              min="1" 
              max="30" 
              step="0.5"
              onchange="updateProjections()"
            />
            <span class="cagr-suffix">%</span>
          </div>
        </div>

        <div class="cagr-selector">
          <label for="stepupInput">Annual Step-up:</label>
          <div class="cagr-input-group">
            <input 
              type="number" 
              id="stepupInput" 
              value="0" 
              min="0" 
              max="20" 
              step="1"
              onchange="updateProjections()"
            />
            <span class="cagr-suffix">%</span>
          </div>
        </div>

        <div class="cagr-selector">
          <label for="customSipInput">Custom SIP Amount:</label>
          <div class="cagr-input-group">
            <span class="cagr-prefix">₹</span>
            <input 
              type="text" 
              id="customSipInput" 
              value="${formatNumber(defaultCustomSIP)}" 
              oninput="formatSipInput(this)"
              onchange="updateProjections()"
            />
          </div>
        </div>
      </div>

      <div class="projection-chart-container">
        <canvas id="projectionChart"></canvas>
      </div>

      <div class="projection-tables" id="projectionTablesContainer">
        <div class="projection-table-card">
          <h4>Based on 6M Average (₹${formatNumber(
            Math.round(summary.sixMonths.inflow),
          )}/month)</h4>
          <table class="gains-table" id="projection6MTable">
            <thead>
              <tr>
                <th>Years</th>
                <th>Future Value</th>
                <th>Total Invested</th>
                <th>Gains</th>
                <th>Returns %</th>
              </tr>
            </thead>
            <tbody>
  `;

  projections6M.forEach((p) => {
    html += `
      <tr>
        <td><strong>${p.year} Years</strong></td>
        <td class="gain">₹${formatNumber(p.futureValue)}</td>
        <td>₹${formatNumber(p.totalInvested)}</td>
        <td class="gain">₹${formatNumber(p.gains)}</td>
        <td class="gain">${p.gainsPercent}%</td>
      </tr>
    `;
  });

  html += `
            </tbody>
          </table>
        </div>

        <div class="projection-table-card">
          <h4>Based on 12M Average (₹${formatNumber(
            Math.round(summary.twelveMonths.inflow),
          )}/month)</h4>
          <table class="gains-table" id="projection12MTable">
            <thead>
              <tr>
                <th>Years</th>
                <th>Future Value</th>
                <th>Total Invested</th>
                <th>Gains</th>
                <th>Returns %</th>
              </tr>
            </thead>
            <tbody>
  `;

  projections12M.forEach((p) => {
    html += `
      <tr>
        <td><strong>${p.year} Years</strong></td>
        <td class="gain">₹${formatNumber(p.futureValue)}</td>
        <td>₹${formatNumber(p.totalInvested)}</td>
        <td class="gain">₹${formatNumber(p.gains)}</td>
        <td class="gain">${p.gainsPercent}%</td>
      </tr>
    `;
  });

  html += `
              </tbody>
            </table>
          </div>
        </div>
        <div class="projection-table-card custom-sip-projection">
          <h4>Custom SIP (₹${formatNumber(
            Math.round(defaultCustomSIP),
          )}/month)</h4>
          <table class="gains-table" id="projectionCustomTable">
            <thead>
              <tr>
                <th>Years</th>
                <th>Future Value</th>
                <th>Total Invested</th>
                <th>Gains</th>
                <th>Returns %</th>
              </tr>
            </thead>
            <tbody>
  `;

  projectionsCustom.forEach((p) => {
    html += `
      <tr>
        <td><strong>${p.year} Years</strong></td>
        <td class="gain">₹${formatNumber(p.futureValue)}</td>
        <td>₹${formatNumber(p.totalInvested)}</td>
        <td class="gain">₹${formatNumber(p.gains)}</td>
        <td class="gain">${p.gainsPercent}%</td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Store summary data globally for updates
  window.monthlySummaryData = summary;

  // Render projection chart
  renderProjectionChart(
    projections6M,
    projections12M,
    projectionsCustom,
    summary,
    defaultCustomSIP,
  );
}
function renderProjectionChart(
  projections6M,
  projections12M,
  projectionsCustom,
  summary,
  customSIP,
) {
  const canvas = document.getElementById("projectionChart");
  if (!canvas) return;

  // Destroy existing chart
  if (projectionChartInstance) {
    projectionChartInstance.destroy();
  }

  const colors = getChartTheme();
  const ctx = canvas.getContext("2d");

  // Get current portfolio value
  const currentValue = Object.values(fundWiseData).reduce(
    (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
    0,
  );

  // Add 0Y data point at the beginning
  const labels = ["0Y", ...projections6M.map((p) => `${p.year}Y`)];

  // Prepend current value to all datasets
  const data6M = [currentValue, ...projections6M.map((p) => p.futureValue)];
  const data12M = [currentValue, ...projections12M.map((p) => p.futureValue)];
  const dataCustom = [
    currentValue,
    ...projectionsCustom.map((p) => p.futureValue),
  ];

  function formatLegendLabel(amount, suffix) {
    const isMobile = window.innerWidth <= 768;
    suffix = isMobile ? "" : " " + suffix;

    if (!isMobile) {
      return `₹${formatNumber(Math.round(amount))}/month` + suffix;
    }

    // Mobile formatting
    if (amount >= 100000) {
      return `₹${(amount / 100000).toFixed(2)}L/month` + suffix;
    } else if (amount >= 1000) {
      return `₹${(amount / 1000).toFixed(2)}K/month` + suffix;
    } else {
      return `₹${Math.round(amount)}/month` + suffix;
    }
  }

  projectionChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: `${formatLegendLabel(summary.sixMonths.inflow, "(6M Avg)")}`,
          data: data6M,
          borderColor: "#667eea",
          backgroundColor: "rgba(102, 126, 234, 0.1)",
          fill: false,
          tension: 0.4,
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: `${formatLegendLabel(
            summary.twelveMonths.inflow,
            "(12M Avg)",
          )}`,
          data: data12M,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          fill: false,
          tension: 0.4,
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: `${formatLegendLabel(customSIP, "(Custom)")}`,
          data: dataCustom,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          fill: false,
          tension: 0.4,
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            usePointStyle: true,
            pointStyle: "line",
            font: { size: window.innerWidth <= 768 ? 10 : 12, weight: "600" },
            color: colors.textColor,
            padding: window.innerWidth <= 768 ? 10 : 15,
          },
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 2,
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 12,
          titleFont: { size: 13, weight: "bold" },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => {
              const label = items[0].label;
              return label === "0Y"
                ? "Current Value"
                : `After ${label.replace("Y", " Years")}`;
            },
            label: (ctx) => {
              const value = ctx.parsed.y;
              if (ctx.dataIndex === 0) {
                return `Current: ₹${formatNumber(value)}`;
              }
              return `${ctx.dataset.label}: ₹${formatNumber(value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11, weight: "600" },
            color: colors.textColor,
          },
        },
        y: {
          beginAtZero: false,
          grid: {
            display: true,
            color: colors.gridColor,
          },
          ticks: {
            font: { size: 11 },
            color: colors.textColor,
            callback: (value) => {
              if (value >= 10000000)
                return "₹" + (value / 10000000).toFixed(1) + "Cr";
              if (value >= 100000)
                return "₹" + (value / 100000).toFixed(1) + "L";
              if (value >= 1000) return "₹" + (value / 1000).toFixed(0) + "K";
              return "₹" + value;
            },
          },
        },
      },
    },
  });
}

function updateProjections() {
  const cagrInput = document.getElementById("cagrInput");
  const stepupInput = document.getElementById("stepupInput");
  const customSipInput = document.getElementById("customSipInput");

  if (
    !cagrInput ||
    !stepupInput ||
    !customSipInput ||
    !window.monthlySummaryData
  )
    return;

  const cagr = parseFloat(cagrInput.value) || 12;
  const stepup = parseFloat(stepupInput.value) || 0;
  const customSIP = parseFloat(customSipInput.value.replace(/,/g, "")) || 0;

  // Validate inputs
  if (cagr < 1 || cagr > 30) {
    showToast("Please enter a CAGR between 1% and 30%", "warning");
    cagrInput.value = 12;
    return;
  }

  if (stepup < 0 || stepup > 20) {
    showToast("Please enter a step-up between 0% and 20%", "warning");
    stepupInput.value = 0;
    return;
  }

  if (customSIP < 0) {
    showToast("Custom SIP cannot be negative", "warning");
    customSipInput.value = 0;
    return;
  }

  const summary = window.monthlySummaryData;
  const currentValue = Object.values(fundWiseData).reduce(
    (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
    0,
  );

  const projections6M = calculateProjections(
    currentValue,
    summary.sixMonths.inflow,
    cagr,
    stepup,
  );
  const projections12M = calculateProjections(
    currentValue,
    summary.twelveMonths.inflow,
    cagr,
    stepup,
  );
  const projectionsCustom = calculateProjections(
    currentValue,
    customSIP,
    cagr,
    stepup,
  );

  // Update tables
  const table6M = document.getElementById("projection6MTable");
  const table12M = document.getElementById("projection12MTable");
  const tableCustom = document.getElementById("projectionCustomTable");

  if (table6M) {
    const tbody = table6M.querySelector("tbody");
    tbody.innerHTML = "";
    projections6M.forEach((p) => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${p.year} Years</strong></td>
          <td class="gain">₹${formatNumber(p.futureValue)}</td>
          <td>₹${formatNumber(p.totalInvested)}</td>
          <td class="gain">₹${formatNumber(p.gains)}</td>
          <td class="gain">${p.gainsPercent}%</td>
        </tr>
      `;
    });
  }

  if (table12M) {
    const tbody = table12M.querySelector("tbody");
    tbody.innerHTML = "";
    projections12M.forEach((p) => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${p.year} Years</strong></td>
          <td class="gain">₹${formatNumber(p.futureValue)}</td>
          <td>₹${formatNumber(p.totalInvested)}</td>
          <td class="gain">₹${formatNumber(p.gains)}</td>
          <td class="gain">${p.gainsPercent}%</td>
        </tr>
      `;
    });
  }

  if (tableCustom) {
    const tbody = tableCustom.querySelector("tbody");
    tbody.innerHTML = "";
    projectionsCustom.forEach((p) => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${p.year} Years</strong></td>
          <td class="gain">₹${formatNumber(p.futureValue)}</td>
          <td>₹${formatNumber(p.totalInvested)}</td>
          <td class="gain">₹${formatNumber(p.gains)}</td>
          <td class="gain">${p.gainsPercent}%</td>
        </tr>
      `;
    });

    // Update table header with new custom SIP value
    const customTableCard = tableCustom.closest(".projection-table-card");
    if (customTableCard) {
      const header = customTableCard.querySelector("h4");
      if (header) {
        header.textContent = `Custom SIP (₹${formatNumber(
          Math.round(customSIP),
        )}/month)`;
      }
    }
  }

  // Update chart
  renderProjectionChart(
    projections6M,
    projections12M,
    projectionsCustom,
    summary,
    customSIP,
  );
}

// SUMMARY CARDS
function updateSummaryCards(summary) {
  const combinedValue = summary.currentValue;

  // summaryCardsContainer is absent on mobile (compact dashboard has no #main .summary-cards)
  const summaryCardsContainer = document.querySelector("#main .summary-cards");
  const firstCard = summaryCardsContainer?.querySelector(".card:first-child");
  if (!summaryCardsContainer || !firstCard) {
    // Mobile view — update compact dashboard values and bail out of desktop card logic
    updateCompactDashboard();
    return;
  }

  // Show Current Value card
  firstCard.innerHTML = `
      <h3>Current Value</h3>
      <div class="value">₹<span id="currentValue">${formatNumber(
        summary.currentValue,
      )}</span></div>
      <div class="subtext" id="currentValueSubtext"></div>
    `;

  // Update all other cards (existing code)
  document.getElementById("totalInvested").textContent = formatNumber(
    summary.totalInvested,
  );
  document.getElementById("currentValue").textContent = formatNumber(
    summary.currentValue,
  );
  document.getElementById("costBasis").textContent = formatNumber(
    summary.costPrice,
  );

  const overallPercent =
    summary.totalInvested > 0
      ? ((summary.overallGain / summary.totalInvested) * 100).toFixed(2)
      : 0;
  updateGainCard(
    "overallGain",
    "overallGainPercent",
    summary.overallGain,
    overallPercent,
    summary.allTimeXirr,
  );

  const realizedPercent =
    summary.totalInvested - summary.costPrice > 0
      ? (
          (summary.realizedGain / (summary.totalInvested - summary.costPrice)) *
          100
        ).toFixed(2)
      : 0;
  updateGainCard(
    "realizedGain",
    "realizedGainPercent",
    summary.realizedGain,
    realizedPercent,
    null,
  );

  const unrealizedPercent =
    summary.costPrice > 0
      ? ((summary.unrealizedGain / summary.costPrice) * 100).toFixed(2)
      : 0;
  updateGainCard(
    "unrealizedGain",
    "unrealizedGainPercent",
    summary.unrealizedGain,
    unrealizedPercent,
    summary.activeXirr,
  );

  const activeFundCount = Object.values(fundWiseData).filter(
    (fund) => (fund.advancedMetrics?.currentValue || 0) > 0,
  ).length;

  document.getElementById("totalHoldings").textContent = activeFundCount;

  if (isSummaryCAS) {
    const avgHoldingDaysCard =
      document.getElementById("avgHoldingDays").parentElement;
    avgHoldingDaysCard.classList.add("hidden");

    const extendedElements = document.querySelectorAll(".extra-card");
    extendedElements.forEach((el) => el.classList.add("hidden"));
  } else {
    const avgHoldingDaysCard =
      document.getElementById("avgHoldingDays").parentElement;
    avgHoldingDaysCard.classList.remove("hidden");
    document.getElementById("avgHoldingDays").textContent =
      calculateWeightedHoldingDays();
  }

  updateCurrentValue1DIndicator();
}

function updateCurrentValue1DIndicator() {
  const subtext = document.getElementById("currentValueSubtext");
  if (!subtext) return;

  const oneDayReturns = calculateOneDayReturns();
  const value = oneDayReturns.value;
  const isPositive = value >= 0;
  const sign = isPositive ? "+" : "-";
  const triangle = isPositive ? "▲" : "▼";
  const absRupees = formatNumber(Math.abs(Math.round(value)));
  const prevTotal =
    Object.values(fundWiseData).reduce(
      (s, f) => s + (f.advancedMetrics?.currentValue || 0),
      0,
    ) - value;
  const absPct =
    prevTotal !== 0 ? Math.abs((value / prevTotal) * 100).toFixed(2) : "0.00";

  const existing = subtext.querySelector(".one-day-subtext");
  if (existing) existing.remove();
  const tag = document.createElement("span");
  tag.className =
    "one-day-subtext " +
    (isPositive ? "one-day-subtext--pos" : "one-day-subtext--neg");
  tag.textContent = `${triangle} ₹${absRupees} (${sign}${absPct}%) today`;
  subtext.appendChild(tag);
}

function updateGainCard(valueId, percentId, gain, percent, xirr) {
  const el = document.getElementById(valueId);
  el.textContent = (gain >= 0 ? "₹" : "-₹") + formatNumber(Math.abs(gain));
  el.parentElement.classList.remove(gain < 0 ? "positive" : "negative");
  el.parentElement.classList.add(gain >= 0 ? "positive" : "negative");

  const xirrText = xirr !== null ? `XIRR: ${xirr.toFixed(2)}%` : "XIRR: --";

  let text = "";

  // Special case for overallGainPercent → show ONLY XIRR
  if (percentId === "overallGainPercent") {
    text = xirrText;
  }
  // Summary CAS case
  else if (isSummaryCAS) {
    text = "Absolute: " + (gain >= 0 ? "+" : "") + percent + "%";
  }
  // Normal case
  else {
    text =
      "Absolute: " +
      (gain >= 0 ? "+" : "") +
      percent +
      "%" +
      (percentId === "realizedGainPercent" ? "" : " | " + xirrText);
  }

  document.getElementById(percentId).textContent = text;
}

// FUND BREAKDOWN
function updateFundBreakdown() {
  const currentGrid = document.getElementById("currentFolioGrid");
  const pastGrid = document.getElementById("pastFolioGrid");
  const pastSection = document.getElementById("show-past");
  const pastSectionMobile = document.getElementById("show-past-mobile");
  currentGrid.innerHTML = "";
  pastGrid.innerHTML = "";
  let hasPast = false;

  const fundsArray = Object.entries(fundWiseData);
  fundsArray.sort((a, b) => {
    const aVal = a[1].valuation ? parseFloat(a[1].valuation.value || 0) : 0;
    const bVal = b[1].valuation ? parseFloat(b[1].valuation.value || 0) : 0;
    return bVal - aVal;
  });

  const pastFunds = [];

  let curInvested = 0,
    curValue = 0,
    curGain = 0,
    curCount = 0;
  let pastInvested = 0,
    pastWithdrawn = 0,
    pastGain = 0,
    pastCount = 0;

  fundsArray.forEach(([fundKey, fund]) => {
    const totalInvested = fund.transactions
      .filter((t) => t.type === "PURCHASE")
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    if (totalInvested === 0) return;

    // Collect all folios for this fund
    const allFolios = [];

    fund.folios.forEach((folioNum) => {
      const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
      if (!folioSummary) return;

      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return;

      const schemeInFolio = folioData.schemes.find(
        (s) => getFundKey(s) === getFundKey(fund),
      );

      if (!schemeInFolio) return;

      allFolios.push({ folioNum, folioData: schemeInFolio });
    });

    // A fund is "current" if ANY folio still holds units; otherwise it goes to past
    const fundIsActive = fund.advancedMetrics?.currentValue > 0;

    if (fundIsActive) {
      // Show all folios (active + redeemed ones) under current holdings
      const currentCard = createFundCardForFolios(
        fund,
        fundKey,
        allFolios,
        true,
        "active",
      );
      currentGrid.appendChild(currentCard);

      curInvested += fund.advancedMetrics?.remainingCost || 0;
      curValue += fund.advancedMetrics?.currentValue || 0;
      curGain += fund.advancedMetrics?.unrealizedGain || 0;
      curCount++;
    } else {
      // All folios fully exited — goes to past
      if (allFolios.length > 0) {
        pastFunds.push({ fundKey, fund, folios: allFolios });
        hasPast = true;
      }
    }
  });

  // Show message if no current holdings
  if (currentGrid.children.length === 0) {
    currentGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 20px;">💼</div>
        <h3 style="margin-bottom: 10px; color: var(--text-primary);">No Current Holdings</h3>
        <p style="color: var(--text-tertiary);">You don't have any active mutual fund holdings.</p>
      </div>
    `;
  }

  renderHoldingsToolbar(currentGrid, "current", {
    count: curCount,
    invested: curInvested,
    value: curValue,
    gain: curGain,
  });

  // Build past holdings section
  if (hasPast) {
    pastSection?.classList.remove("hidden");
    pastSectionMobile?.classList.remove("hidden");

    const pastSection2 = document.createElement("div");
    pastSection2.innerHTML = `
      <div class="folio-grid" id="pastRedeemedGrid"></div>
    `;
    pastGrid.appendChild(pastSection2);

    const pastRedeemedGrid = document.getElementById("pastRedeemedGrid");
    pastFunds.forEach(({ fundKey, fund, folios }) => {
      const card = createFundCardForFolios(
        fund,
        fundKey,
        folios,
        false,
        "full",
      );
      pastRedeemedGrid.appendChild(card);

      const folioNumbers = folios.map((f) => f.folioNum);
      Object.values(fund.advancedMetrics?.folioSummaries || {}).forEach(
        (fs) => {
          if (!folioNumbers.includes(fs.folio)) return;
          const redeemedCost = (fs.invested || 0) - (fs.remainingCost || 0);
          pastInvested += redeemedCost;
          pastWithdrawn += fs.withdrawn || 0;
          pastGain += fs.realizedGain || 0;
        },
      );
      pastCount++;
    });

    renderHoldingsToolbar(pastGrid, "past", {
      count: pastCount,
      invested: pastInvested,
      value: pastWithdrawn,
      gain: pastGain,
    });
  } else {
    pastSection?.classList.remove("hidden");
    pastSectionMobile?.classList.remove("hidden");

    pastGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 20px;">📋</div>
        <h3 style="margin-bottom: 10px; color: var(--text-primary);">No Past Holdings</h3>
        <p style="color: var(--text-tertiary);">You don't have any fully redeemed funds yet.</p>
      </div>
    `;
  }
}

// Build (or refresh) the minimal summary + search toolbar above a holdings grid.
// Desktop/Tablet only — hidden via CSS on mobile (compact dashboard handles mobile).
function renderHoldingsToolbar(gridEl, type, totals) {
  if (!gridEl) return;
  const wrapId = `holdingsToolbar-${type}`;
  let toolbar = document.getElementById(wrapId);

  const gainClass = totals.gain >= 0 ? "gain" : "loss";
  const gainSign = totals.gain >= 0 ? "+" : "-";
  const valueLabel = type === "current" ? "Current Value" : "Withdrawn";
  const gainLabel = type === "current" ? "Unrealized P&L" : "Realized P&L";

  const summaryHTML = `
    <div class="holdings-summary">
      <div class="holdings-summary-item">
        <span class="holdings-summary-label">Funds</span>
        <span class="holdings-summary-value">${totals.count}</span>
      </div>
      <div class="holdings-summary-item">
        <span class="holdings-summary-label">Invested</span>
        <span class="holdings-summary-value">₹${formatNumber(Math.round(totals.invested))}</span>
      </div>
      <div class="holdings-summary-item">
        <span class="holdings-summary-label">${valueLabel}</span>
        <span class="holdings-summary-value">₹${formatNumber(Math.round(totals.value))}</span>
      </div>
      <div class="holdings-summary-item">
        <span class="holdings-summary-label">${gainLabel}</span>
        <span class="holdings-summary-value ${gainClass}">${gainSign}₹${formatNumber(Math.abs(Math.round(totals.gain)))}</span>
      </div>
    </div>`;

  const searchHTML = `
    <div class="holdings-search-wrap">
      <i class="fa-solid fa-magnifying-glass holdings-search-icon"></i>
      <input type="text" class="holdings-search-input" id="holdingsSearch-${type}"
        placeholder="Search ${type === "current" ? "current" : "past"} holdings…"
        oninput="filterHoldingsGrid('${type}')" autocomplete="off">
    </div>`;

  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = wrapId;
    toolbar.className = "holdings-toolbar";
    gridEl.parentNode.insertBefore(toolbar, gridEl);
  }

  toolbar.innerHTML = summaryHTML + searchHTML;

  // Re-apply any active search filter after the grid is rebuilt
  filterHoldingsGrid(type);
}

// Filter fund cards in a holdings grid by name based on the toolbar search input.
function filterHoldingsGrid(type) {
  const input = document.getElementById(`holdingsSearch-${type}`);
  const gridEl = document.getElementById(
    type === "current" ? "currentFolioGrid" : "pastFolioGrid",
  );

  if (!input || !gridEl) return;

  const terms = normalizeSearchText(input.value).split(" ").filter(Boolean);

  const cards = gridEl.querySelectorAll(".folio-card");

  cards.forEach((card) => {
    const name = normalizeSearchText(card.dataset.fundName || "");

    const matches =
      terms.length === 0 || terms.every((term) => name.includes(term));

    card.style.display = matches ? "" : "none";
  });
}

function updateSummaryFundBreakdown() {
  const currentGrid = document.getElementById("currentFolioGrid");
  const pastGrid = document.getElementById("pastFolioGrid");
  const pastSection = document.getElementById("show-past");
  const pastSectionMobile = document.getElementById("show-past-mobile");

  currentGrid.innerHTML = "";
  pastGrid.innerHTML = "";

  pastSection?.classList.add("hidden");
  pastSectionMobile?.classList.add("hidden");

  const fundsArray = Object.entries(fundWiseData);
  fundsArray.sort((a, b) => {
    const aVal = a[1].valuation ? parseFloat(a[1].valuation.value || 0) : 0;
    const bVal = b[1].valuation ? parseFloat(b[1].valuation.value || 0) : 0;
    return bVal - aVal;
  });

  let curInvested = 0,
    curValue = 0,
    curGain = 0,
    curCount = 0;

  fundsArray.forEach(([fundKey, fund]) => {
    const card = createSummaryFundCard(fund, fundKey);
    currentGrid.appendChild(card);

    curInvested += fund.advancedMetrics?.remainingCost || 0;
    curValue += fund.advancedMetrics?.currentValue || 0;
    curGain += fund.advancedMetrics?.unrealizedGain || 0;
    curCount++;
  });

  renderHoldingsToolbar(currentGrid, "current", {
    count: curCount,
    invested: curInvested,
    value: curValue,
    gain: curGain,
  });
}
function createFundCardForFolios(
  fund,
  fundKey,
  folios,
  isActive,
  redemptionStatus = "active",
) {
  const folioNumbers = folios.map((f) => f.folioNum);

  // Calculate metrics based on whether this is active or past
  let invested = 0;
  let withdrawn = 0;
  let current = 0;
  let cost = 0;
  let realizedGain = 0;
  let unrealizedGain = 0;
  let remainingUnits = 0;
  let averageHoldingDays = 0;
  let averageRemainingCostPerUnit = 0;

  const advancedMetrics = fund.advancedMetrics;
  const targetFolioSummaries = [];

  Object.values(advancedMetrics.folioSummaries).forEach((folioSummary) => {
    if (folioNumbers.includes(folioSummary.folio)) {
      targetFolioSummaries.push(folioSummary);

      if (isActive) {
        // For current holdings - show only active data
        invested += folioSummary.remainingCost;
        current += folioSummary.currentValue;
        cost += folioSummary.remainingCost;
        unrealizedGain += folioSummary.unrealizedGain;
        remainingUnits += folioSummary.remainingUnits;

        if (folioSummary.remainingUnits > 0) {
          averageHoldingDays +=
            folioSummary.averageHoldingDays * folioSummary.remainingUnits;
        }
      } else {
        // For past holdings - calculate invested based on FIFO (what was actually sold)
        // invested = total invested - remaining cost (what's still held)
        const totalInvestedInFolio = folioSummary.invested;
        const remainingCostInFolio = folioSummary.remainingCost;
        const redeemedCost = totalInvestedInFolio - remainingCostInFolio;

        invested += redeemedCost;
        withdrawn += folioSummary.withdrawn;
        realizedGain += folioSummary.realizedGain;
      }
    }
  });

  // Calculate averages for active holdings
  if (isActive && remainingUnits > 0) {
    averageRemainingCostPerUnit = (cost / remainingUnits).toFixed(3);
    averageHoldingDays = (averageHoldingDays / remainingUnits).toFixed(1);
  }

  const overallGain = isActive ? unrealizedGain : realizedGain;
  const gainPercentage = isActive
    ? cost > 0
      ? ((unrealizedGain / cost) * 100).toFixed(2)
      : 0
    : invested > 0
      ? ((realizedGain / invested) * 100).toFixed(2)
      : 0;

  // Calculate XIRR using cashflows from folioSummaries
  let xirr = null;
  try {
    const calc = new XIRRCalculator();

    if (isActive) {
      // For active holdings - include all cashflows and add current value
      targetFolioSummaries.forEach((folioSummary) => {
        folioSummary.cashflows.forEach((cf) => {
          calc.addTransaction(cf.type, cf.date, Math.abs(cf.amount));
        });
      });

      if (current > 0) {
        calc.addTransaction(
          "Sell",
          new Date().toISOString().split("T")[0] + "T00:00:00.000Z",
          current,
        );
      }
    } else {
      // For past holdings - only include redemption cashflows
      targetFolioSummaries.forEach((folioSummary) => {
        folioSummary.cashflows.forEach((cf) => {
          if (cf.type === "Sell") {
            // Only include sell transactions for past holdings XIRR
            calc.addTransaction(cf.type, cf.date, Math.abs(cf.amount));
          }
        });
      });

      // For partially redeemed, we need to include the purchases that were sold (FIFO)
      // We need to reconstruct which purchases correspond to the redemptions
      targetFolioSummaries.forEach((folioSummary) => {
        const buyCashflows = folioSummary.cashflows.filter(
          (cf) => cf.type === "Buy",
        );
        const sellCashflows = folioSummary.cashflows.filter(
          (cf) => cf.type === "Sell",
        );

        // Calculate total units sold
        const totalSoldUnits = sellCashflows.reduce(
          (sum, cf) => sum + cf.units,
          0,
        );

        // Use FIFO to determine which purchases were sold
        let unitsSoldSoFar = 0;
        for (const buyCf of buyCashflows) {
          if (unitsSoldSoFar >= totalSoldUnits) break;

          const unitsToInclude = Math.min(
            buyCf.units,
            totalSoldUnits - unitsSoldSoFar,
          );
          const amountToInclude =
            (unitsToInclude / buyCf.units) * Math.abs(buyCf.amount);

          calc.addTransaction("Buy", buyCf.date, amountToInclude);
          unitsSoldSoFar += unitsToInclude;
        }
      });
    }

    xirr = calc.calculateXIRR();
  } catch (e) {
    console.debug("XIRR calculation failed for", fundKey, e);
  }

  const xirrText =
    xirr == null || isNaN(xirr) ? "--" : `${parseFloat(xirr.toFixed(2))}%`;

  const statusLabel = "";

  const modifiedFund = {
    ...fund,
    folios: folioNumbers,
  };

  return createFundCardWithTransactions(
    modifiedFund,
    fundKey,
    Math.round(invested),
    Math.round(withdrawn),
    Math.round(current),
    Math.round(cost),
    Math.round(overallGain),
    Math.round(realizedGain),
    gainPercentage,
    Math.round(unrealizedGain),
    gainPercentage,
    remainingUnits.toFixed(3),
    averageRemainingCostPerUnit,
    averageHoldingDays,
    xirrText,
    statusLabel,
    isActive,
  );
}
function createFundCardWithTransactions(
  fund,
  fundKey,
  invested,
  withdrawn,
  current,
  remainingCost,
  overallGain,
  realizedGain,
  realizedGainPercentage,
  unrealizedGain,
  unrealizedGainPercentage,
  remainingUnits,
  averageRemainingCostPerUnit,
  averageHoldingDays,
  xirrText,
  statusLabel,
  isActive = true,
) {
  const card = document.createElement("div");
  card.className = "folio-card";
  card.dataset.fundName = (
    fund.schemeDisplay ||
    fund.scheme ||
    ""
  ).toLowerCase();

  const extendedData = mfStats[fund.isin];
  // Sort folios by current value desc (active first, redeemed last) for chip display
  const _folioSummariesForSort = fund.advancedMetrics?.folioSummaries;
  const displayFolios = [...fund.folios].sort((a, b) => {
    const sa = _folioSummariesForSort?.[a];
    const sb = _folioSummariesForSort?.[b];
    return (sb?.currentValue || 0) - (sa?.currentValue || 0);
  });

  const displayName = fund.schemeDisplay || fund.scheme;
  const pnl = isActive ? unrealizedGain : realizedGain;
  const pnlPct = isActive ? unrealizedGainPercentage : realizedGainPercentage;
  const pnlClass = pnl >= 0 ? "gain" : "loss";
  const pnlHeroClass =
    pnl >= 0
      ? "folio-card-hero-cell--pnl-gain"
      : "folio-card-hero-cell--pnl-loss";
  const pnlSign = pnl >= 0 ? "+" : "-";
  const pnlSub = `${pnl >= 0 ? "▲" : "▼"} ${pnl >= 0 ? "+" : "-"}${Math.abs(pnlPct)}%`;

  const MAX_FOLIO_PILLS = 2;
  const visibleFolios = displayFolios.slice(0, MAX_FOLIO_PILLS);
  const extraFolioCount = displayFolios.length - MAX_FOLIO_PILLS;
  const chipHTML =
    visibleFolios
      .map(
        (f) => `<span class="folio-card-chip">${f.split("/")[0].trim()}</span>`,
      )
      .join("") +
    (extraFolioCount > 0
      ? `<span class="folio-card-chip folio-card-chip--more">+${extraFolioCount}</span>`
      : "");

  const amcShortName = standardizeTitle(fund.amc).replace(
    /\bMutual Fund\b/gi,
    "MF",
  );

  // Hero: primary value / P&L / XIRR
  const heroValueLabel = isActive ? "Current Value" : "Withdrawn";
  const heroValueAmt = isActive ? current : withdrawn;

  const oneDayReturn = isActive ? calculate1DayReturn(fund) : null;
  const odPositive = !oneDayReturn || oneDayReturn.percent >= 0;
  const odSign = odPositive ? "+" : "-";
  const oneDaySubHTML = oneDayReturn
    ? `<span class="folio-card-hero-sub folio-1d-sub ${odPositive ? "folio-1d-sub--pos" : "folio-1d-sub--neg"}">${odPositive ? "▲" : "▼"} ₹${formatNumber(Math.abs(Math.round(oneDayReturn.rupees)))} (${odSign}${Math.abs(oneDayReturn.percent.toFixed(2))}%)</span>`
    : "";
  const oneDayTriangleHTML = "";

  // Secondary chips
  const investedLabel = isActive ? "Invested" : "Invested";
  let secondaryChips = `
    <div class="folio-card-meta-chip">
      <span class="folio-card-meta-label">${investedLabel}</span>
      <span class="folio-card-meta-value">₹${formatNumber(isActive ? remainingCost : invested)}</span>
    </div>`;

  if (isActive) {
    secondaryChips += `
    <div class="folio-card-meta-chip">
      <span class="folio-card-meta-label">Units</span>
      <span class="folio-card-meta-value">${parseFloat(remainingUnits).toFixed(3)}</span>
    </div>
    <div class="folio-card-meta-chip">
      <span class="folio-card-meta-label">Avg NAV</span>
      <span class="folio-card-meta-value">${averageRemainingCostPerUnit || "--"}</span>
    </div>
    <div class="folio-card-meta-chip">
      <span class="folio-card-meta-label">Avg Hold</span>
      <span class="folio-card-meta-value">${averageHoldingDays != null && averageHoldingDays > 0 ? Math.round(averageHoldingDays) + "D" : "--"}</span>
    </div>`;
  }

  const actionsHTML =
    isActive && current > 0
      ? `<div class="fund-card-actions">
        <button class="fund-action-btn primary" onclick="showFundDetailsModal('${fundKey}', false)">
          <i class="fa-solid fa-chart-line"></i> View Details
        </button>
        <button class="fund-action-btn secondary hidden" onclick="event.stopPropagation(); showFundHoldings('${fundKey}')">
          <i class="fa-solid fa-eye"></i> Holdings (${fund.holdings.length})
        </button>
      </div>`
      : showViewDetailsForPast
        ? `<div class="fund-card-actions">
          <button class="fund-action-btn primary" onclick="showFundDetailsModal('${fundKey}', true, ['${fund.folios.join("','")}'])">
            <i class="fa-solid fa-chart-line"></i> View Details
          </button>
        </div>`
        : "";

  card.innerHTML = `
    <div class="folio-card-header">
      ${extendedData?.logo_url ? `<img class="folio-card-logo" src="${extendedData.logo_url}" alt="" onerror="this.style.display='none'">` : ""}
      <span class="folio-card-name-header" title="${displayName}">${displayName}</span>
    </div>
    <div class="folio-card-sub-header">
      <span class="folio-card-amc">${amcShortName}</span>
      <div class="folio-card-chips">${chipHTML}</div>
    </div>
    <div class="folio-card-hero">
      <div class="folio-card-hero-cell">
        <span class="folio-card-hero-label">${heroValueLabel}</span>
        <span class="folio-card-hero-value">₹${formatNumber(heroValueAmt)}</span>
        ${oneDaySubHTML}
      </div>
      <div class="folio-card-hero-cell ${pnlHeroClass}">
        <span class="folio-card-hero-label">P&amp;L</span>
        <span class="folio-card-hero-value ${pnlClass}">₹${formatNumber(Math.abs(pnl))}</span>
        <span class="folio-card-hero-sub">${pnlSub}</span>
      </div>
      <div class="folio-card-hero-cell folio-card-hero-cell--xirr">
        <span class="folio-card-hero-label">XIRR</span>
        <span class="folio-card-hero-value">${xirrText}</span>
      </div>
    </div>
    <div class="folio-card-chips-row">${secondaryChips}</div>
    ${actionsHTML}
  `;

  return card;
}
function createSummaryFundCard(fund, fundKey) {
  // Summary CAS has no transaction history — derive display values from advancedMetrics
  // and delegate to the same modern card used for detailed CAS.
  const m = fund.advancedMetrics;
  const currentValue = Math.round(m.currentValue || 0);
  const cost = Math.round(m.remainingCost || 0);
  const unrealizedGain = Math.round(m.unrealizedGain || 0);
  const unrealizedPct = m.unrealizedGainPercentage || 0;
  const units = parseFloat(m.totalUnitsRemaining || 0).toFixed(3);
  const avgNav = m.averageRemainingCostPerUnit || "--";

  return createFundCardWithTransactions(
    fund,
    fundKey,
    cost, // invested
    0, // withdrawn
    currentValue, // current
    cost, // remainingCost
    unrealizedGain, // overallGain
    0, // realizedGain
    0, // realizedGainPercentage
    unrealizedGain, // unrealizedGain
    unrealizedPct, // unrealizedGainPercentage
    units, // remainingUnits
    avgNav, // averageRemainingCostPerUnit
    0, // averageHoldingDays (not available in summary CAS)
    "--", // xirrText (no transactions = no XIRR)
    "", // statusLabel
    true, // isActive
  );
}

// MODAL FUNCTIONS - FUND DETAILS
function showFundDetailsModal(
  fundKey,
  isPastHolding = false,
  specificFolios = null,
) {
  const fund = fundWiseData[fundKey];
  if (!fund) return;

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "fundDetailsModal";

  const extendedData = mfStats[fund.isin];
  const displayName = fund.schemeDisplay || fund.scheme;
  const summaryCls = isPastHolding ? "past-summary" : "current-summary";

  // Determine which folios to display and calculate metrics for
  let targetFolios = specificFolios || fund.folios;
  let displayFolios,
    cost,
    unrealizedGain,
    unrealizedGainPercentage,
    units,
    avgNav,
    avgHoldingDays,
    current;

  if (isPastHolding && !specificFolios) {
    // For past holdings, only show inactive folios
    displayFolios = fund.folios.filter((folioNum) => {
      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return false;
      const schemeInFolio = folioData.schemes.find(
        (s) => getFundKey(s) === getFundKey(fund),
      );
      return (
        schemeInFolio && parseFloat(schemeInFolio.valuation?.value || 0) === 0
      );
    });
    targetFolios = displayFolios;
  } else if (specificFolios) {
    displayFolios = specificFolios;
  } else {
    // For current holdings, show all folios sorted by currentValue desc (active first)
    const _fs = fund.advancedMetrics?.folioSummaries;
    displayFolios = [...fund.folios].sort(
      (a, b) => (_fs?.[b]?.currentValue || 0) - (_fs?.[a]?.currentValue || 0),
    );
  }

  // Calculate metrics for target folios only
  if (isPastHolding) {
    // For past holdings, use folio summaries
    cost = 0;
    unrealizedGain = 0;
    units = 0;
    let totalHoldingDays = 0;
    let totalCostTimesUnits = 0;
    current = 0;

    targetFolios.forEach((folioNum) => {
      const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
      if (folioSummary) {
        cost += folioSummary.invested || 0;
        unrealizedGain += folioSummary.realizedGain || 0; // For past holdings, show realized gain
        units += folioSummary.totalUnitsPurchased || 0;
        totalHoldingDays +=
          (folioSummary.averageHoldingDays || 0) *
          (folioSummary.remainingUnits || 0);
        totalCostTimesUnits += folioSummary.remainingCost || 0;
      }
    });

    avgNav = units > 0 ? (cost / units).toFixed(3) : 0;
    avgHoldingDays = units > 0 ? (totalHoldingDays / units).toFixed(1) : 0;
    unrealizedGainPercentage =
      cost > 0 ? ((unrealizedGain / cost) * 100).toFixed(2) : 0;
  } else if (isSummaryCAS) {
    // Summary CAS: read directly from advancedMetrics (no folioSummaries)
    const m = fund.advancedMetrics;
    cost = m.remainingCost || 0;
    unrealizedGain = m.unrealizedGain || 0;
    units = m.totalUnitsRemaining || 0;
    current = m.currentValue || 0;
    avgNav = m.averageRemainingCostPerUnit || 0;
    avgHoldingDays = 0;
    unrealizedGainPercentage = m.unrealizedGainPercentage || 0;
    displayFolios = fund.folios;
  } else {
    // For current holdings, calculate from folio summaries of active folios
    cost = 0;
    unrealizedGain = 0;
    units = 0;
    current = 0;
    let totalHoldingDays = 0;
    let totalCostTimesUnits = 0;

    targetFolios.forEach((folioNum) => {
      const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
      if (folioSummary) {
        cost += folioSummary.remainingCost || 0;
        unrealizedGain += folioSummary.unrealizedGain || 0;
        units += folioSummary.remainingUnits || 0;
        current += folioSummary.currentValue || 0;
        totalHoldingDays +=
          (folioSummary.averageHoldingDays || 0) *
          (folioSummary.remainingUnits || 0);
        totalCostTimesUnits += folioSummary.remainingCost || 0;
      }
    });

    avgNav = units > 0 ? (cost / units).toFixed(3) : 0;
    avgHoldingDays = units > 0 ? (totalHoldingDays / units).toFixed(1) : 0;
    unrealizedGainPercentage =
      cost > 0 ? ((unrealizedGain / cost) * 100).toFixed(2) : 0;
  }

  // Calculate XIRR
  let xirr = null;
  try {
    const calc = new XIRRCalculator();
    if (fund.advancedMetrics?.folioSummaries) {
      Object.values(fund.advancedMetrics.folioSummaries).forEach(
        (folioSummary) => {
          folioSummary.cashflows.forEach((cf) => {
            calc.addTransaction(cf.type, cf.date, Math.abs(cf.amount));
          });
        },
      );
    }
    if (current > 0) {
      calc.addTransaction(
        "Sell",
        new Date().toISOString().split("T")[0] + "T00:00:00.000Z",
        current,
      );
    }
    if (calc.transactions.length >= 2) {
      xirr = calc.calculateXIRR();
    }
  } catch (e) {
    console.debug("XIRR calculation failed for", fund.scheme, e);
  }

  const xirrText =
    xirr == null || isNaN(xirr) ? "--" : `${parseFloat(xirr.toFixed(2))}%`;

  function roundValue(val) {
    if (val === null || val === undefined) return "--";
    if (typeof val === "number") return Math.round(val * 100) / 100;
    return val;
  }

  function roundValueOrDash(val, noVal) {
    if (val === null || val === undefined || Number(val) === 0) {
      return noVal;
    }

    if (typeof val === "number") {
      return Math.round(val * 100) / 100;
    }

    return val;
  }

  // Build Folios section HTML before modal.innerHTML (avoids nested template literal issues)
  let foliosSectionHTML = "";
  const _folioSummaries = fund.advancedMetrics?.folioSummaries;

  // For Summary CAS build a simple per-folio table from the raw CAS folio data
  if (isSummaryCAS && fund.folios.length >= 1) {
    const summaryRows = fund.folios
      .map((folioNum) => {
        const folioData = portfolioData.folios.find(
          (f) => f.folio === folioNum,
        );
        if (!folioData) return "";
        const fUnits = parseFloat(folioData.units || 0);
        const fCost = parseFloat(folioData.cost || 0);
        const fValue = parseFloat(folioData.current_value || 0);
        const fPnl = fValue - fCost;
        const fPnlPct = fCost > 0 ? ((fPnl / fCost) * 100).toFixed(2) : "0.00";
        const pnlClass = fPnl >= 0 ? "gain" : "loss";
        const fPct =
          current > 0 ? ((fValue / current) * 100).toFixed(1) + "%" : "--";
        const folioDisplay = folioNum.split("/")[0].trim();
        return (
          '<div class="folio-compact-row">' +
          '<div class="folio-compact-id">' +
          '<span class="folio-compact-number">' +
          folioDisplay +
          "</span>" +
          '<span class="folio-compact-badge folio-compact-badge--active">Active</span>' +
          "</div>" +
          '<div class="folio-compact-cell"><span class="folio-compact-cell-label">Invested</span>' +
          '<span class="folio-compact-cell-value">₹' +
          formatNumber(fCost) +
          "</span></div>" +
          '<div class="folio-compact-cell"><span class="folio-compact-cell-label">Cur. Value</span>' +
          '<span class="folio-compact-cell-value">₹' +
          formatNumber(fValue) +
          "</span></div>" +
          '<div class="folio-compact-cell"><span class="folio-compact-cell-label">Units</span>' +
          '<span class="folio-compact-cell-value">' +
          fUnits.toFixed(3) +
          "</span></div>" +
          '<div class="folio-compact-cell"><span class="folio-compact-cell-label">P&L</span>' +
          '<span class="folio-compact-cell-value ' +
          pnlClass +
          '">' +
          "₹" +
          formatNumber(Math.abs(fPnl)) +
          ' <span class="folio-compact-pct">(' +
          (fPnl >= 0 ? "+" : "-") +
          Math.abs(parseFloat(fPnlPct)) +
          "%)</span></span></div>" +
          '<div class="folio-compact-cell folio-compact-cell--pct"><span class="folio-compact-cell-label">% of Fund</span>' +
          '<span class="folio-compact-cell-value">' +
          fPct +
          "</span></div>" +
          "</div>"
        );
      })
      .join("");

    foliosSectionHTML =
      '<div class="folio-compact-section">' +
      '<div class="folio-compact-header">' +
      '<span class="folio-compact-header-icon">🗂️</span>' +
      '<span class="folio-compact-header-title">Folios</span>' +
      '<span class="folio-compact-count">' +
      fund.folios.length +
      " folios</span>" +
      "</div>" +
      '<div class="folio-compact-table">' +
      summaryRows +
      "</div>" +
      "</div>";
  } else if (_folioSummaries && displayFolios.length >= 1) {
    const _sorted = [...displayFolios].sort((a, b) => {
      const sa = _folioSummaries[a];
      const sb = _folioSummaries[b];
      if (!sa) return 1;
      if (!sb) return -1;
      const aActive = (sa.currentValue || 0) > 0;
      const bActive = (sb.currentValue || 0) > 0;
      if (aActive !== bActive) return bActive - aActive;
      return (sb.currentValue || 0) - (sa.currentValue || 0);
    });

    const _rows = _sorted
      .map((folioNum) => {
        const fs = _folioSummaries[folioNum];
        if (!fs) return "";

        const isActive = (fs.currentValue || 0) > 0;
        // Use per-folio active state, not fund-level isPastHolding,
        // so redeemed folios inside a current fund show correct realized values.
        const folioIsPast = !isActive;
        const invested = folioIsPast
          ? fs.invested || 0
          : fs.remainingCost || fs.invested || 0;
        const currentVal = fs.currentValue || 0;
        const pnl = folioIsPast ? fs.realizedGain || 0 : fs.unrealizedGain || 0;
        const pnlPct = folioIsPast
          ? fs.invested > 0
            ? ((fs.realizedGain / fs.invested) * 100).toFixed(2)
            : "0.00"
          : (fs.unrealizedGainPercentage || 0).toFixed(2);
        const units = folioIsPast
          ? fs.totalUnitsPurchased || 0
          : fs.remainingUnits || 0;
        const holdingDays = fs.averageHoldingDays
          ? Math.round(fs.averageHoldingDays)
          : "--";
        const pnlClass = pnl >= 0 ? "gain" : "loss";
        const folioDisplay = folioNum.split("/")[0].trim();
        const valueDisplay = folioIsPast
          ? "₹" + formatNumber(fs.withdrawn || 0)
          : "₹" + formatNumber(currentVal);
        const folioPctOfFund =
          !folioIsPast && current > 0
            ? ((currentVal / current) * 100).toFixed(1) + "%"
            : null;

        return (
          '<div class="folio-compact-row' +
          (isActive ? "" : " folio-compact-row--redeemed") +
          '">' +
          '<div class="folio-compact-id">' +
          '<span class="folio-compact-number">' +
          folioDisplay +
          "</span>" +
          (isActive
            ? '<span class="folio-compact-badge folio-compact-badge--active">Active</span>'
            : '<span class="folio-compact-badge folio-compact-badge--redeemed">Redeemed</span>') +
          "</div>" +
          '<div class="folio-compact-cell">' +
          '<span class="folio-compact-cell-label">' +
          (folioIsPast ? "Invested" : "Invested") +
          "</span>" +
          '<span class="folio-compact-cell-value">₹' +
          formatNumber(invested) +
          "</span>" +
          "</div>" +
          '<div class="folio-compact-cell">' +
          '<span class="folio-compact-cell-label">' +
          (folioIsPast ? "Withdrawn" : "Cur. Value") +
          "</span>" +
          '<span class="folio-compact-cell-value">' +
          valueDisplay +
          "</span>" +
          "</div>" +
          '<div class="folio-compact-cell">' +
          '<span class="folio-compact-cell-label">Units</span>' +
          '<span class="folio-compact-cell-value">' +
          (+units).toFixed(3) +
          "</span>" +
          "</div>" +
          '<div class="folio-compact-cell">' +
          '<span class="folio-compact-cell-label">' +
          "P&L" +
          "</span>" +
          '<span class="folio-compact-cell-value ' +
          pnlClass +
          '">' +
          "₹" +
          formatNumber(Math.abs(pnl)) +
          ' <span class="folio-compact-pct">(' +
          (pnl >= 0 ? "+" : "-") +
          Math.abs(parseFloat(pnlPct)) +
          "%)</span>" +
          "</span>" +
          "</div>" +
          (!isPastHolding
            ? '<div class="folio-compact-cell folio-compact-cell--hold">' +
              '<span class="folio-compact-cell-label">Avg Hold</span>' +
              '<span class="folio-compact-cell-value">' +
              (holdingDays != null && holdingDays > 0
                ? holdingDays + "D"
                : "--") +
              "</span>" +
              "</div>"
            : "") +
          '<div class="folio-compact-cell folio-compact-cell--pct">' +
          '<span class="folio-compact-cell-label">% of Fund</span>' +
          '<span class="folio-compact-cell-value">' +
          (folioPctOfFund ?? "0%") +
          "</span>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    foliosSectionHTML =
      '<div class="folio-compact-section">' +
      '<div class="folio-compact-header">' +
      '<span class="folio-compact-header-icon">🗂️</span>' +
      '<span class="folio-compact-header-title">Folios</span>' +
      '<span class="folio-compact-count">' +
      _sorted.length +
      " folios</span>" +
      "</div>" +
      '<div class="folio-compact-table">' +
      _rows +
      "</div>" +
      "</div>";
  }

  modal.innerHTML = `
    <div class="transaction-modal fund-details-modal">
      <div class="modal-header">
        <div class="modal-header-fund-title">
          ${extendedData?.logo_url ? `<img class="modal-fund-logo" src="${extendedData.logo_url}" alt="" onerror="this.style.display='none'">` : ""}
          <h2>${displayName}</h2>
        </div>
        <button class="modal-close" onclick="closeFundDetailsModal()">✕</button>
      </div>
      <div class="modal-content fund-details-content">
        
        <!-- Summary Stats Section (Compact Redesign) -->
        <div class="fund-summary-compact ${summaryCls}">

          <!-- Meta bar: Portfolio % (left) + Riskometer (right) -->
          <div class="fund-summary-meta-bar">
            <div class="fund-summary-meta-bar-left">
              ${
                !isPastHolding && current > 0
                  ? (() => {
                      const totalPfValue = Object.values(fundWiseData).reduce(
                        (s, f) => s + (f.advancedMetrics?.currentValue || 0),
                        0,
                      );
                      const pct =
                        totalPfValue > 0
                          ? ((current / totalPfValue) * 100).toFixed(2)
                          : null;
                      return pct !== null
                        ? `<div class="fund-summary-meta-item">
                <span class="fund-summary-meta-label">Portfolio</span>
                <span class="fund-summary-portfolio-pct">${pct}% <span class="fund-summary-portfolio-pct-sub">of Total</span></span>
              </div>`
                        : "";
                    })()
                  : ""
              }
            </div>
            <div class="fund-summary-meta-bar-right">
              ${(() => {
                const riskNumeric =
                  extendedData?.return_stats?.risk_rating ?? null;
                const riskLevels = [
                  "Low",
                  "Low to Moderate",
                  "Moderate",
                  "Moderately High",
                  "High",
                  "Very High",
                ];
                const riskLevel =
                  riskNumeric !== null && !isNaN(parseInt(riskNumeric))
                    ? (riskLevels[parseInt(riskNumeric) - 1] ?? null)
                    : null;
                if (!riskLevel) return "";
                const riskColors = [
                  "#10b981",
                  "#84cc16",
                  "#f59e0b",
                  "#fb923c",
                  "#ef4444",
                  "#dc2626",
                ];
                const activeIdx = riskLevels.findIndex(
                  (r) => r.toLowerCase() === riskLevel.toLowerCase(),
                );
                const riskoDots = riskLevels
                  .map((r, i) => {
                    const isActive = i === activeIdx;
                    const isPast = i < activeIdx;
                    const dotColor = isActive
                      ? riskColors[i]
                      : isPast
                        ? riskColors[i] + "80"
                        : "rgba(102,126,234,0.15)";
                    return `<span class="riskometer-dot ${isActive ? "riskometer-dot--active" : ""}" style="background:${dotColor};box-shadow:${isActive ? "0 0 6px " + riskColors[i] : "none"}" title="${r}"></span>`;
                  })
                  .join("");
                const riskLabelColor =
                  activeIdx >= 0
                    ? riskColors[activeIdx]
                    : "var(--text-secondary)";
                return `<div class="riskometer">
                  <div class="riskometer-track">${riskoDots}</div>
                  <span class="riskometer-label" style="color:${riskLabelColor}">${riskLevel}</span>
                </div>`;
              })()}
            </div>
          </div>

          <!-- Hero row: 3 primary financial metrics -->
          <div class="fund-summary-hero-row">
            <div class="fund-summary-hero-card">
              <span class="fund-summary-hero-label">${isPastHolding ? "Total Withdrawn" : "Current Value"}</span>
              <span class="fund-summary-hero-value">₹${formatNumber(isPastHolding ? cost + unrealizedGain : current)}</span>
              ${(() => {
                if (isPastHolding) return "";
                const od = calculate1DayReturn(fund);
                if (!od) return "";
                const pos = od.percent >= 0;
                const s = pos ? "+" : "-";
                return `<span class="fund-summary-hero-sub fund-summary-1d-sub ${pos ? "fund-summary-1d-sub--pos" : "fund-summary-1d-sub--neg"}">${pos ? "▲" : "▼"} ₹${formatNumber(Math.abs(Math.round(od.rupees)))} (${s}${Math.abs(od.percent.toFixed(2))}%)</span>`;
              })()}
            </div>
            <div class="fund-summary-hero-card fund-summary-hero-card--pnl ${unrealizedGain >= 0 ? "gain" : "loss"}">
              <span class="fund-summary-hero-label">P&amp;L</span>
              <span class="fund-summary-hero-value">
                ₹${formatNumber(Math.abs(unrealizedGain))}
              </span>
              <span class="fund-summary-hero-sub">${unrealizedGain >= 0 ? "▲" : "▼"} ${unrealizedGain >= 0 ? "+" : "-"}${Math.abs(unrealizedGainPercentage)}%</span>
            </div>
            <div class="fund-summary-hero-card fund-summary-hero-card--xirr">
              <span class="fund-summary-hero-label">XIRR</span>
              <span class="fund-summary-hero-value">${xirrText}</span>
            </div>
          </div>

          <!-- Secondary metrics: compact chips -->
          <div class="fund-summary-chips-row">
            <div class="fund-summary-chip">
              <span class="fund-summary-chip-label">${isPastHolding ? "Total Invested" : "Invested"}</span>
              <span class="fund-summary-chip-value">₹${formatNumber(cost)}</span>
            </div>
            <div class="fund-summary-chip">
              <span class="fund-summary-chip-label">Units</span>
              <span class="fund-summary-chip-value">${roundValue(units)}</span>
            </div>
            <div class="fund-summary-chip">
              <span class="fund-summary-chip-label">Curr. NAV</span>
              <span class="fund-summary-chip-value">
                ${extendedData?.latest_nav ? `₹${roundValue(parseFloat(extendedData.latest_nav))}` : "--"}
                ${extendedData?.latest_nav_date ? `<span class="fund-summary-chip-sub">${extendedData.latest_nav_date}</span>` : ""}
              </span>
            </div>
            <div class="fund-summary-chip">
              <span class="fund-summary-chip-label">Avg NAV</span>
              <span class="fund-summary-chip-value">${roundValue(avgNav)}</span>
            </div>
            ${
              !isPastHolding
                ? `
            <div class="fund-summary-chip">
              <span class="fund-summary-chip-label">Avg Hold</span>
              <span class="fund-summary-chip-value">
                ${
                  avgHoldingDays != null && avgHoldingDays > 0
                    ? roundValue(avgHoldingDays) + "D"
                    : "--"
                }
              </span>
            </div>`
                : ""
            }
          </div>

        </div>

        <!-- Folios Section -->
        ${foliosSectionHTML}

        <!-- Charts Row - Side by side on desktop, stacked on mobile -->
        <div class="fund-details-charts-row">

          <!-- Valuation History (hidden for Summary CAS — no nav history without transaction dates) -->
          <div class="fund-chart-card" ${isSummaryCAS ? 'style="display:none"' : ""}>
            <div class="fund-chart-card-header">
              <span class="fund-chart-card-icon">📈</span>
              <span class="fund-chart-card-title">Valuation History</span>
              <div class="fund-chart-legend-pills">
                <span class="fund-chart-legend-pill" style="--pill-color:#667eea">Value</span>
                <span class="fund-chart-legend-pill fund-chart-legend-pill--dashed" style="--pill-color:#ef4444">Cost</span>
              </div>
              <div class="fund-chart-period-tabs" id="valuationPeriodTabs">
                <button class="fund-chart-period-btn" data-period="1M" onclick="filterValuationChart('1M', '${fundKey}')">1M</button>
                <button class="fund-chart-period-btn active" data-period="3M" onclick="filterValuationChart('3M', '${fundKey}')">3M</button>
                <button class="fund-chart-period-btn" data-period="6M" onclick="filterValuationChart('6M', '${fundKey}')">6M</button>
                <button class="fund-chart-period-btn" data-period="1Y" onclick="filterValuationChart('1Y', '${fundKey}')">1Y</button>
                <button class="fund-chart-period-btn" data-period="ALL" onclick="filterValuationChart('ALL', '${fundKey}')">All</button>
              </div>
            </div>
            <div id="valuationPeriodStat" class="fund-chart-period-stat"></div>
            <div class="fund-chart-canvas-wrapper">
              <canvas id="modalFundValuationChart"></canvas>
            </div>
          </div>

          ${
            extendedData
              ? (() => {
                  const rs = extendedData.return_stats || {};
                  const br = fund.benchmark_returns || {};
                  const sipR = extendedData.sip_return || {};

                  function fmtR(val) {
                    if (val === null || val === undefined || val === "")
                      return "--";
                    const n = parseFloat(val);
                    if (isNaN(n)) return "--";
                    return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
                  }
                  function fmtOut(fundV, benchV) {
                    if (fundV === null || fundV === undefined || fundV === "")
                      return "--";
                    if (
                      benchV === null ||
                      benchV === undefined ||
                      benchV === ""
                    )
                      return "--";
                    const diff = parseFloat(fundV) - parseFloat(benchV);
                    if (isNaN(diff)) return "--";
                    return (diff >= 0 ? "+" : "") + diff.toFixed(2) + "%";
                  }
                  function colorCls(val) {
                    if (val === null || val === undefined || val === "")
                      return "";
                    const n = parseFloat(val);
                    if (isNaN(n)) return "";
                    return n >= 0 ? "perf-val--gain" : "perf-val--loss";
                  }
                  function outColorCls(fundV, benchV) {
                    if (
                      fundV === null ||
                      fundV === undefined ||
                      benchV === null ||
                      benchV === undefined
                    )
                      return "";
                    const diff = parseFloat(fundV) - parseFloat(benchV);
                    if (isNaN(diff)) return "";
                    return diff >= 0 ? "perf-val--gain" : "perf-val--loss";
                  }

                  const simpleR = extendedData.simple_return || {};

                  const periods = [
                    {
                      label: "3M",
                      fund: rs.return3m,
                      sip: sipR.return3m,
                      abs: simpleR.return3m,
                      cat: rs.cat_return3m,
                      bench: null,
                    },
                    {
                      label: "6M",
                      fund: rs.return6m,
                      sip: sipR.return6m,
                      abs: simpleR.return6m,
                      cat: rs.cat_return6m,
                      bench: null,
                    },
                    {
                      label: "1Y",
                      fund: rs.return1y,
                      sip: sipR.return1y,
                      abs: simpleR.return1y,
                      cat: rs.cat_return1y,
                      bench: br.return1y ?? null,
                    },
                    {
                      label: "3Y",
                      fund: rs.return3y,
                      sip: sipR.return3y,
                      abs: simpleR.return3y,
                      cat: rs.cat_return3y,
                      bench: br.return3y ?? null,
                    },
                    {
                      label: "5Y",
                      fund: rs.return5y,
                      sip: sipR.return5y,
                      abs: simpleR.return5y,
                      cat: rs.cat_return5y,
                      bench: br.return5y ?? null,
                    },
                    {
                      label: "10Y",
                      fund: rs.return10y,
                      sip: sipR.return10y,
                      abs: simpleR.return10y,
                      cat: rs.cat_return10y,
                      bench: null,
                    },
                  ];

                  const rows = periods
                    .map(
                      (p) => `
                    <tr class="perf-row">
                      <td class="perf-cell perf-cell--period">${p.label}</td>
                      <td class="perf-cell perf-val ${colorCls(p.fund)}">${fmtR(p.fund)}</td>
                      <td class="perf-cell perf-val ${colorCls(p.sip)}">${fmtR(p.sip)}</td>
                      <td class="perf-cell perf-val perf-cell--desktop ${colorCls(p.abs)}">${fmtR(p.abs)}</td>
                      <td class="perf-cell perf-val ${colorCls(p.cat)}">${fmtR(p.cat)}</td>
                      <td class="perf-cell perf-val ${p.bench !== null && p.bench !== undefined ? colorCls(p.bench) : ""}">${p.bench !== null && p.bench !== undefined ? fmtR(p.bench) : "--"}</td>
                      <td class="perf-cell perf-val perf-cell--out perf-cell--desktop ${outColorCls(p.fund, p.bench)}">${fmtOut(p.fund, p.bench)}</td>
                    </tr>`,
                    )
                    .join("");

                  const sinceCreated = rs.return_since_created;
                  const sinceRow =
                    sinceCreated !== null && sinceCreated !== undefined
                      ? `<div class="perf-since-row"><span class="perf-since-label">Return Since Inception</span><span class="perf-since-val ${colorCls(sinceCreated)}">${fmtR(sinceCreated)}</span></div>`
                      : "";

                  return `
          <!-- Returns Performance Card -->
          <div class="fund-chart-card fund-perf-card">
            <div class="fund-chart-card-header">
              <span class="fund-chart-card-icon">📈</span>
              <span class="fund-chart-card-title">Returns</span>
            </div>
            <div class="perf-table-wrapper">
              <table class="perf-table">
                <thead>
                  <tr class="perf-head-row">
                    <th class="perf-th perf-th--period">Period</th>
                    <th class="perf-th">Fund</th>
                    <th class="perf-th">SIP</th>
                    <th class="perf-th perf-th--desktop">Abs.</th>
                    <th class="perf-th">Category</th>
                    <th class="perf-th">Benchmark</th>
                    <th class="perf-th perf-th--out perf-th--desktop">Outperform</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ${sinceRow}
          </div>`;
                })()
              : ""
          }
        </div>

        <!-- Composition Charts Section -->
        ${
          extendedData
            ? `
        <div class="fund-composition-card">
          <div class="fund-composition-card-header">
            <span class="fund-chart-card-icon">🧩</span>
            <span class="fund-chart-card-title">Fund Composition</span>
          </div>
          <div class="fund-composition-cols">
            <div class="fund-composition-col">
              <div class="fund-composition-col-label">Asset Allocation</div>
              <div class="fund-composition-col-body">
                <div id="modalAssetAllocationBar" class="donut-chart-wrap"><canvas id="modalAssetAllocationChart"></canvas></div>
              </div>
            </div>
            <div class="fund-composition-col-divider"></div>
            <div class="fund-composition-col">
              <div class="fund-composition-col-label">Equity Split</div>
              <div class="fund-composition-col-body">
                <div id="modalMarketCapBar" class="donut-chart-wrap"><canvas id="modalMarketCapChart"></canvas></div>
              </div>
            </div>
            <div class="fund-composition-col-divider" id="modalDebtColDivider" style="display:none"></div>
            <div class="fund-composition-col" id="modalDebtCol" style="display:none">
              <div class="fund-composition-col-label">Debt Split</div>
              <div class="fund-composition-col-body">
                <div id="modalDebtBar" class="donut-chart-wrap"><canvas id="modalDebtChart"></canvas></div>
              </div>
            </div>
            <div class="fund-composition-col-divider" id="modalEquitySectorColDivider" style="display:none"></div>
            <div class="fund-composition-col" id="modalEquitySectorCol" style="display:none">
              <div class="fund-composition-col-label">Equity Sectors</div>
              <div class="fund-composition-col-body">
                <div id="modalEquitySectorBar" class="donut-chart-wrap"><canvas id="modalEquitySectorChart"></canvas></div>
              </div>
            </div>
            <div class="fund-composition-col-divider" id="modalDebtSectorColDivider" style="display:none"></div>
            <div class="fund-composition-col" id="modalDebtSectorCol" style="display:none">
              <div class="fund-composition-col-label">Debt Sectors</div>
              <div class="fund-composition-col-body">
                <div id="modalDebtSectorBar" class="donut-chart-wrap"><canvas id="modalDebtSectorChart"></canvas></div>
              </div>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <!-- Extended Stats Section -->
        ${
          extendedData
            ? `
        <div class="fund-stats-compact">

          <!-- Section header -->
          <div class="fund-stats-header">
            <span class="fund-stats-header-icon">📐</span>
            <span class="fund-stats-header-title">Fund Risk Metrics</span>
            <div class="fund-stats-header-badges">
              ${extendedData.groww_rating ? `<span class="fund-stats-rating-badge">★ ${roundValue(extendedData.groww_rating)}</span>` : ""}
              ${extendedData.expense_ratio ? `<span class="fund-stats-expense-badge">Exp: ${roundValue(extendedData.expense_ratio)}%</span>` : ""}
              ${extendedData.aum ? `<span class="fund-stats-aum-badge">AUM ₹${formatNumber(roundValue(extendedData.aum))}Cr</span>` : ""}
            </div>
          </div>

          <!-- Risk ratios row -->
          <div class="fund-stats-group fund-stats-group--risk">
            <div class="fund-stats-group-label">Metrics</div>
            <div class="fund-stats-group-cells">
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Alpha</span>
                <span class="fund-stats-cell-value">${roundValueOrDash(extendedData.return_stats?.alpha, "-")}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Beta</span>
                <span class="fund-stats-cell-value">${roundValueOrDash(extendedData.return_stats?.beta, "-")}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Sharpe</span>
                <span class="fund-stats-cell-value">${roundValueOrDash(extendedData.return_stats?.sharpe_ratio, "-")}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Sortino</span>
                <span class="fund-stats-cell-value">${roundValueOrDash(extendedData.return_stats?.sortino_ratio, "-")}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Info Ratio</span>
                <span class="fund-stats-cell-value">${roundValueOrDash(extendedData.return_stats?.information_ratio, "-")}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Std Dev</span>
                <span class="fund-stats-cell-value">${roundValueOrDash(extendedData.return_stats?.standard_deviation, "-")}</span>
              </div>
              ${(() => {
                const portfolioTurnover =
                  extendedData.portfolio_turnover ??
                  extendedData.return_stats?.portfolio_turnover ??
                  null;

                return portfolioTurnover !== null
                  ? `<div class="fund-stats-cell">
                      <span class="fund-stats-cell-label">Turnover</span>
                      <span class="fund-stats-cell-value">${
                        roundValueOrDash(portfolioTurnover, "-") === "-"
                          ? "-"
                          : roundValue(portfolioTurnover) + "%"
                      }</span>
                    </div>`
                  : "";
              })()}
              ${
                extendedData?.portfolio_stats?.pe != null
                  ? `
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">P/E</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.portfolio_stats.pe)}</span>
              </div>`
                  : ""
              }
              ${
                extendedData?.portfolio_stats?.pb != null
                  ? `
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">P/B</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.portfolio_stats.pb)}</span>
              </div>`
                  : ""
              }
            </div>
          </div>

        </div>
        `
            : ""
        }

        <!-- Investment Limits Section -->
        ${
          extendedData
            ? `
        <div class="fund-meta-section inv-limit-section">
          <div class="fund-stats-header">
            <span class="fund-stats-header-icon">💰</span>
            <span class="fund-stats-header-title">Investment Limits</span>
          </div>
          <div class="fund-meta-grid">
            <div class="fund-meta-item">
              <span class="fund-meta-label">Min SIP</span>
              <span class="fund-meta-value">
                ${
                  extendedData.min_sip != null
                    ? `₹${Number(extendedData.min_sip).toLocaleString("en-IN")}`
                    : "-"
                }
              </span>
            </div>

            <div class="fund-meta-item">
              <span class="fund-meta-label">Min 1st Investment</span>
              <span class="fund-meta-value">
                ${
                  extendedData.min_first_investment != null
                    ? `₹${Number(
                        extendedData.min_first_investment,
                      ).toLocaleString("en-IN")}`
                    : "-"
                }
              </span>
            </div>

            <div class="fund-meta-item">
              <span class="fund-meta-label">Min Add. Investment</span>
              <span class="fund-meta-value">
                ${
                  extendedData.min_second_investment != null
                    ? `₹${Number(
                        extendedData.min_second_investment,
                      ).toLocaleString("en-IN")}`
                    : "-"
                }
              </span>
            </div>

            <div class="fund-meta-item">
              <span class="fund-meta-label">Min SWP</span>
              <span class="fund-meta-value">
                ${
                  extendedData.min_swp != null
                    ? `₹${Number(extendedData.min_swp).toLocaleString("en-IN")}`
                    : "-"
                }
              </span>
            </div>

            <div class="fund-meta-item">
              <span class="fund-meta-label">Min STP</span>
              <span class="fund-meta-value">
                ${
                  extendedData.min_stp != null
                    ? `₹${Number(extendedData.min_stp).toLocaleString("en-IN")}`
                    : "-"
                }
              </span>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <!-- Meta Section -->
        ${
          extendedData
            ? `
        <div class="fund-meta-section">
          <div class="fund-stats-header">
            <span class="fund-stats-header-icon">🏷️</span>
            <span class="fund-stats-header-title">Fund Info</span>
          </div>
          <div class="fund-meta-grid">
            <div class="fund-meta-item">
              <span class="fund-meta-label">AMC</span>
              <span class="fund-meta-value">${standardizeTitle(fund.amc) || "--"}</span>
            </div>
            <div class="fund-meta-item">
              <span class="fund-meta-label">Launch Date</span>
              <span class="fund-meta-value">${extendedData.launch_date || "--"}</span>
            </div>
            <div class="fund-meta-item">
              <span class="fund-meta-label">ISIN</span>
              <span class="fund-meta-value fund-meta-value--mono">${extendedData.isin || "--"}</span>
            </div>
            <div class="fund-meta-item">
              <span class="fund-meta-label">Scheme Code</span>
              <span class="fund-meta-value fund-meta-value--mono">${extendedData.scheme_code || "--"}</span>
            </div>
            <div class="fund-meta-item">
              <span class="fund-meta-label">Category</span>
              <span class="fund-meta-value">${
                extendedData.meta?.scheme_category
                  ? extendedData.meta.scheme_category
                      .replace(/\bFund\b/gi, "")
                      .replace(/\bScheme\b(?=\s*[-–])/gi, "")
                      .replace(/\s{2,}/g, " ")
                      .trim()
                  : "--"
              }</span>
            </div>
            <div class="fund-meta-item">
              <span class="fund-meta-label">RTA</span>
              <span class="fund-meta-value">${extendedData.rta || "--"}</span>
            </div>
            <div class="fund-meta-item">
              <span class="fund-meta-label">Benchmark</span>
              <span class="fund-meta-value">
                ${
                  extendedData.benchmark?.toUpperCase() === "GROWWDB"
                    ? "--"
                    : extendedData.benchmark || "--"
                }
              </span>
            </div>

            <!-- Managers -->
            <div class="fund-meta-item fund-meta-item--managers">
              <span class="fund-meta-label">Fund Manager(s)</span>
              <span class="fund-meta-value">${(() => {
                const mgr = extendedData.manager || fund.manager;
                if (!mgr) return "--";
                if (Array.isArray(mgr)) return mgr.join(", ") || "--";
                return mgr;
              })()}</span>
            </div>
          </div>

          <!-- Taxation row -->
          <div class="fund-meta-row-full">
            <div class="fund-meta-item fund-meta-item--full">
              <span class="fund-meta-label">Taxation</span>
              <span class="fund-meta-value fund-meta-value--tax">${extendedData.tax_impact || "--"}</span>
            </div>
          </div>
          
          <!-- Exit Load row -->
          <div class="fund-meta-row-full">
            <div class="fund-meta-item fund-meta-item--full">
              <span class="fund-meta-label">Exit Load</span>
              <span class="fund-meta-value fund-meta-value--tax">${extendedData.exit_load || "--"}</span>
            </div>
          </div>

          <!-- About the Fund -->
          ${
            extendedData.meta_desc
              ? `
          <!-- Fund Description row -->
          <div class="fund-meta-row-full">
            <div class="fund-meta-item fund-meta-item--full fund-meta-item--desc">
              <span class="fund-meta-label">About this Fund</span>
              <p class="fund-meta-desc">${extendedData.meta_desc}</p>
            </div>
          </div>`
              : ""
          }
        </div>
        `
            : ""
        }

        <!-- Quick Actions Section -->
        <div class="fund-quick-actions-card">
          <div class="fund-quick-actions-header">
            <span class="fund-chart-card-icon">⚡</span>
            <span class="fund-chart-card-title">Quick Actions</span>
          </div>
          <div class="fund-quick-actions-body">
            <button class="fund-quick-action-btn" onclick="showFundHoldings('${fundKey}')">
              <i class="fa-solid fa-eye"></i>
              <span>View Holdings</span>
              <span class="fund-quick-action-badge">${fund.holdings?.length || 0}</span>
            </button>
            <button class="fund-quick-action-btn${isSummaryCAS ? " fund-quick-action-btn--disabled" : ""}"
              ${isSummaryCAS ? 'disabled title="Not available for Summary CAS"' : `onclick="showFundTransactions('${fundKey}', '${fund.folios.join(",")}')"`}>
              <i class="fa-solid fa-exchange-alt"></i>
              <span>View Transactions</span>
              ${isSummaryCAS ? '<span class="fund-quick-action-badge" style="opacity:0.5">N/A</span>' : ""}
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "fundDetails" },
    "",
    window.location.pathname,
  );

  // Render charts after modal is in DOM
  setTimeout(() => {
    renderModalFundValuationChart(fundKey, "3M");
    if (extendedData) {
      renderModalCompositionCharts(fundKey, extendedData, current);
    }
  }, 50);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFundDetailsModal();
  });
}
function closeFundDetailsModal() {
  const modal = document.getElementById("fundDetailsModal");
  if (modal) {
    // Destroy all charts in the modal to prevent memory leaks
    const charts = modal.querySelectorAll("canvas");
    charts.forEach((canvas) => {
      const chartInstance = Chart.getChart(canvas);
      if (chartInstance) {
        chartInstance.destroy();
      }
    });
    modal.remove();
  }
  unlockBodyScroll();
}
function showOverlapDetailModal(pairIndex) {
  const pair = (window._overlapPairsData || [])[pairIndex];
  if (!pair) return;
  renderOverlapDetailModal(pair);
}
function showCalculatorOverlapModal() {
  const pair = window._overlapCalcPairData;
  if (!pair) return;
  renderOverlapDetailModal(pair);
}
function renderOverlapDetailModal(pair) {
  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "overlapDetailModal";

  const pctClass =
    pair.overlapPercent > 50
      ? "loss"
      : pair.overlapPercent > 25
        ? "warning"
        : "gain";

  const stockRows = pair.commonStocks
    .map(
      (stock) => `
        <div class="overlap-detail-stock-row">
          <span class="overlap-detail-stock-name">${stock.company}</span>
          <span class="overlap-detail-stock-pct">${stock.fund1Percent.toFixed(2)}%</span>
          <span class="overlap-detail-stock-pct">${stock.fund2Percent.toFixed(2)}%</span>
        </div>`,
    )
    .join("");

  modal.innerHTML = `
    <div class="transaction-modal overlap-detail-modal">
      <div class="modal-header">
        <h2>Fund Overlap</h2>
        <button class="modal-close" onclick="closeOverlapDetailModal()">✕</button>
      </div>
      <div class="modal-content overlap-detail-content">
        <div class="overlap-detail-fund-cards">
          <div class="overlap-detail-fund-card">
            <div class="overlap-detail-fund-label">Fund A</div>
            <div class="overlap-detail-fund-name">${pair.fund1}</div>
          </div>
          <div class="overlap-detail-fund-card">
            <div class="overlap-detail-fund-label fund-b">Fund B</div>
            <div class="overlap-detail-fund-name">${pair.fund2}</div>
          </div>
        </div>

        <div class="overlap-detail-summary">
          <span class="overlap-detail-summary-count">${pair.commonStocks.length} common stocks</span>
          <span class="overlap-detail-summary-pct ${pctClass}">${pair.overlapPercent}% overlap</span>
        </div>

        <div class="overlap-detail-table">
          <div class="overlap-detail-table-header">
            <span class="overlap-detail-stock-name">Common Stocks</span>
            <span class="overlap-detail-stock-pct">Fund A</span>
            <span class="overlap-detail-stock-pct fund-b">Fund B</span>
          </div>
          ${stockRows}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "overlapDetail" },
    "",
    window.location.pathname,
  );

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeOverlapDetailModal();
  });
}
function closeOverlapDetailModal() {
  const modal = document.getElementById("overlapDetailModal");
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}
function showCommonHoldingDetailModal(holdingIndex) {
  const holding = (window._commonHoldingsData || [])[holdingIndex];
  if (!holding) return;

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "commonHoldingDetailModal";

  const fundRows = holding.fundWeights
    .map(
      (fw) => `
        <div class="overlap-detail-stock-row">
          <span class="overlap-detail-stock-name">${fw.fund}</span>
          <span class="overlap-detail-stock-pct">${fw.weight.toFixed(2)}%</span>
        </div>`,
    )
    .join("");

  modal.innerHTML = `
    <div class="transaction-modal overlap-detail-modal">
      <div class="modal-header">
        <h2>Stock Overlap</h2>
        <button class="modal-close" onclick="closeCommonHoldingDetailModal()">✕</button>
      </div>
      <div class="modal-content overlap-detail-content">
        <div class="overlap-detail-fund-cards">
          <div class="overlap-detail-fund-card overlap-detail-fund-card-full">
            <div class="overlap-detail-fund-label">Stock</div>
            <div class="overlap-detail-fund-name">${holding.company}</div>
          </div>
        </div>

        <div class="overlap-detail-summary">
          <span class="overlap-detail-summary-count">Held by ${holding.fundCount} funds</span>
          <span class="overlap-detail-summary-pct gain">${holding.avgWeight}% avg weight</span>
        </div>

        <div class="overlap-detail-table two-col">
          <div class="overlap-detail-table-header">
            <span class="overlap-detail-stock-name">Fund</span>
            <span class="overlap-detail-stock-pct">Weight</span>
          </div>
          ${fundRows}
          <div class="overlap-detail-stock-row overlap-detail-avg-row">
            <span class="overlap-detail-stock-name">Average Weight</span>
            <span class="overlap-detail-stock-pct">${holding.avgWeight}%</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "commonHoldingDetail" },
    "",
    window.location.pathname,
  );

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeCommonHoldingDetailModal();
  });
}
function closeCommonHoldingDetailModal() {
  const modal = document.getElementById("commonHoldingDetailModal");
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}
function showAllOverlapPairsModal() {
  const pairs = window._overlapPairsData || [];
  if (!pairs.length) return;

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "allOverlapPairsModal";

  const rows = pairs
    .map((pair, pairIndex) => {
      const pctClass =
        pair.overlapPercent > 50
          ? "loss"
          : pair.overlapPercent > 25
            ? "warning"
            : "gain";
      return `
        <div class="overlap-pair-row overlap-row-clickable" onclick="closeAllOverlapPairsModal(); showOverlapDetailModal(${pairIndex})">
          <div class="overlap-fund-names">
            <div class="overlap-fund-name">${pair.fund1}</div>
            <div class="overlap-fund-name secondary">${pair.fund2}</div>
          </div>
          <div class="overlap-pct-cell">
            <span class="overlap-pct-val ${pctClass}">${pair.overlapPercent}%</span>
            <span class="overlap-pct-label">overlap</span>
          </div>
          <div class="overlap-stocks-cell">
            <span class="overlap-stocks-num">${pair.commonStocks.length}</span>
            <span class="overlap-stocks-label">stocks</span>
          </div>
        </div>`;
    })
    .join("");

  modal.innerHTML = `
    <div class="transaction-modal overlap-detail-modal">
      <div class="modal-header">
        <h2>Overlapping Fund Pairs</h2>
        <button class="modal-close" onclick="closeAllOverlapPairsModal()">✕</button>
      </div>
      <div class="modal-content overlap-detail-content">
        ${rows}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "allOverlapPairs" },
    "",
    window.location.pathname,
  );

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeAllOverlapPairsModal();
  });
}
function closeAllOverlapPairsModal() {
  const modal = document.getElementById("allOverlapPairsModal");
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}
function showAllCommonHoldingsModal() {
  const holdings = window._commonHoldingsData || [];
  if (!holdings.length) return;

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "allCommonHoldingsModal";

  const rows = holdings
    .map(
      (holding, holdingIndex) => `
        <div class="overlap-pair-row overlap-row-clickable" onclick="closeAllCommonHoldingsModal(); showCommonHoldingDetailModal(${holdingIndex})">
          <div class="overlap-fund-names">
            <div class="overlap-fund-name">${holding.company}</div>
          </div>
          <div class="overlap-pct-cell">
            <span class="overlap-pct-val accent">${holding.avgWeight}%</span>
            <span class="overlap-pct-label">avg weight</span>
          </div>
          <div class="overlap-stocks-cell">
            <span class="overlap-stocks-num">${holding.fundCount}</span>
            <span class="overlap-stocks-label">funds</span>
          </div>
        </div>`,
    )
    .join("");

  modal.innerHTML = `
    <div class="transaction-modal overlap-detail-modal">
      <div class="modal-header">
        <h2>Common Stock Holdings</h2>
        <button class="modal-close" onclick="closeAllCommonHoldingsModal()">✕</button>
      </div>
      <div class="modal-content overlap-detail-content">
        ${rows}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "allCommonHoldings" },
    "",
    window.location.pathname,
  );

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeAllCommonHoldingsModal();
  });
}
function closeAllCommonHoldingsModal() {
  const modal = document.getElementById("allCommonHoldingsModal");
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
}
function renderModalFundValuationChart(fundKey, initialPeriod = "ALL") {
  const fund = fundWiseData[fundKey];
  const dailyValuation = fund.advancedMetrics?.dailyValuation;

  if (!dailyValuation || dailyValuation.length === 0) return;

  const canvas = document.getElementById("modalFundValuationChart");
  if (!canvas) return;

  const colors = getChartTheme();
  const ctx = canvas.getContext("2d");

  const allData = dailyValuation;

  // Slice to initialPeriod upfront — avoids the Chart.getChart() race
  const cutoffs = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, ALL: Infinity };
  const days = cutoffs[initialPeriod] ?? Infinity;
  const now = new Date(allData[allData.length - 1].date);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const initialData =
    initialPeriod === "ALL"
      ? allData
      : allData.filter((d) => new Date(d.date) >= cutoff);

  const labels = initialData.map((d) => {
    const date = new Date(d.date);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });

  const values = initialData.map((d) => d.value);
  const costs = initialData.map((d) => d.cost);

  // Populate initial period stat strip
  const statEl = document.getElementById("valuationPeriodStat");
  if (statEl && initialData.length >= 2) {
    const first = initialData[0].value;
    const last = initialData[initialData.length - 1].value;
    const change = last - first;
    const changePct = first > 0 ? ((change / first) * 100).toFixed(2) : "0.00";
    const isGain = change >= 0;
    statEl.innerHTML =
      `<span class="fund-chart-stat-label">Period change</span>` +
      `<span class="fund-chart-stat-value ${isGain ? "gain" : "loss"}">` +
      `${isGain ? "+" : "-"}₹${Math.abs(change).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ` +
      `<span class="fund-chart-stat-pct">(${isGain ? "+" : "-"}${Math.abs(changePct)}%)</span>` +
      `</span>`;
  }

  // Mark the correct period button as active
  document.querySelectorAll(".fund-chart-period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === initialPeriod);
  });

  new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Value",
          data: values,
          borderColor: "#667eea",
          backgroundColor: "rgba(102, 126, 234, 0.1)",
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Cost",
          data: costs,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.05)",
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 0,
          borderWidth: 1,
          borderDash: [3, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.8,
      interaction: { intersect: false, mode: "index", axis: "x" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 2,
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 8,
          titleFont: { size: 12 },
          bodyFont: { size: 11 },
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const date = new Date(allData[idx].date);
              return date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              });
            },
            label: (ctx) =>
              ctx.datasetIndex === 0
                ? `Value: ₹${ctx.parsed.y.toLocaleString("en-IN")}`
                : `Cost: ₹${ctx.parsed.y.toLocaleString("en-IN")}`,
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: {
            maxTicksLimit: 8,
            font: { size: 10 },
            color: colors.textColor,
          },
        },
        y: {
          display: true,
          grid: { display: true, color: colors.gridColor },
          ticks: {
            font: { size: 10 },
            color: colors.textColor,
            callback: (value) => {
              if (value >= 100000)
                return "₹" + (value / 100000).toFixed(1) + "L";
              if (value >= 1000) return "₹" + (value / 1000).toFixed(0) + "K";
              return "₹" + value;
            },
          },
        },
      },
    },
  });
}

function renderModalFundPerformanceChart(
  fundKey,
  extendedData,
  benchmark_returns,
) {
  const ctx = document.getElementById("modalFundPerformanceChart");
  if (!ctx) return;

  const colors = getChartTheme();
  const labels = ["1Y", "3Y", "5Y"];
  const safeRound = (val) =>
    typeof val === "number" && !isNaN(val) ? Math.round(val * 100) / 100 : null;

  const stats = extendedData.return_stats || {};
  const fundData = [stats.return1y, stats.return3y, stats.return5y].map(
    safeRound,
  );
  const categoryData = [
    stats.cat_return1y,
    stats.cat_return3y,
    stats.cat_return5y,
  ].map(safeRound);
  const benchmarkData = [
    benchmark_returns?.return1y,
    benchmark_returns?.return3y,
    benchmark_returns?.return5y,
  ].map(safeRound);

  const datasets = [];

  if (fundData.some((v) => v !== null))
    datasets.push({
      label: "Fund",
      data: fundData,
      backgroundColor: "#3b82f6",
      borderRadius: 6,
      barThickness: 20,
    });

  if (categoryData.some((v) => v !== null))
    datasets.push({
      label: "Category",
      data: categoryData,
      backgroundColor: "#10b981",
      borderRadius: 6,
      barThickness: 20,
    });

  if (benchmarkData.some((v) => v !== null))
    datasets.push({
      label: "Benchmark",
      data: benchmarkData,
      backgroundColor: "#f59e0b",
      borderRadius: 6,
      barThickness: 20,
    });

  new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.8,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 2,
          titleColor: "#fff",
          bodyColor: "#fff",
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            color: colors.textColor,
          },
        },
        y: {
          beginAtZero: true,
          grid: { display: true, color: colors.gridColor },
          ticks: {
            font: { size: 11 },
            color: colors.textColor,
            callback: (val) => `${val}%`,
          },
        },
      },
    },
  });
}

function filterValuationChart(period, fundKey) {
  const fund = fundWiseData[fundKey];
  const allData = fund?.advancedMetrics?.dailyValuation;
  if (!allData || allData.length === 0) return;

  // Update active tab button
  document.querySelectorAll(".fund-chart-period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === period);
  });

  // Slice data by period
  const now = new Date(allData[allData.length - 1].date);
  const cutoffs = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, ALL: Infinity };
  const days = cutoffs[period] || Infinity;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const sliced =
    period === "ALL"
      ? allData
      : allData.filter((d) => new Date(d.date) >= cutoff);

  const labels = sliced.map((d) => {
    const date = new Date(d.date);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });
  const values = sliced.map((d) => d.value);
  const costs = sliced.map((d) => d.cost);

  // Update period stat strip
  const statEl = document.getElementById("valuationPeriodStat");
  if (statEl && sliced.length >= 2) {
    const first = sliced[0].value;
    const last = sliced[sliced.length - 1].value;
    const change = last - first;
    const changePct = first > 0 ? ((change / first) * 100).toFixed(2) : "0.00";
    const isGain = change >= 0;
    statEl.innerHTML =
      `<span class="fund-chart-stat-label">Period change</span>` +
      `<span class="fund-chart-stat-value ${isGain ? "gain" : "loss"}">` +
      `${isGain ? "+" : "-"}₹${Math.abs(change).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ` +
      `<span class="fund-chart-stat-pct">(${isGain ? "+" : "-"}${Math.abs(changePct)}%)</span>` +
      `</span>`;
  }

  // Update chart data
  const canvas = document.getElementById("modalFundValuationChart");
  if (!canvas) return;
  const chartInstance = Chart.getChart(canvas);
  if (!chartInstance) return;
  chartInstance.data.labels = labels;
  chartInstance.data.datasets[0].data = values;
  chartInstance.data.datasets[1].data = costs;
  chartInstance.update("none");
}

function renderModalCompositionCharts(fundKey, extendedData, currentValue = 0) {
  const ps = extendedData?.portfolio_stats;
  if (!ps) return;

  // Resolve asset-class buckets once — used by multiple charts below.
  // resolveAssetAllocation returns fund-level percentages (sum ≈ 100).
  const resolvedBuckets = resolveAssetAllocation(
    ps.asset_allocation || {},
    extendedData?.holdings,
    1,
  );

  // Derive per-class rupee sub-totals from currentValue (mirrors dashboard logic)
  const equityPct =
    (resolvedBuckets["domestic equity"] || 0) +
    (resolvedBuckets["global equity"] || 0) +
    (resolvedBuckets["hedged equity"] || 0);
  const debtPct = resolvedBuckets["debt"] || 0;

  const equityRupees = currentValue * (equityPct / 100);
  const debtRupees = currentValue * (debtPct / 100);

  // ============ ASSET ALLOCATION CHART (Doughnut) ============
  const assetBarEl = document.getElementById("modalAssetAllocationBar");
  if (assetBarEl) {
    const buckets = resolvedBuckets;

    const preferredOrder = [
      "domestic equity",
      "global equity",
      "hedged equity",
      "debt",
      "gold",
      "silver",
      "real estate",
      "cash",
      "other",
    ];
    const toLabel = (k) => k.replace(/\b\w/g, (c) => c.toUpperCase());

    // Use the raw API sum (including any negative buckets like cash: -0.7)
    // as the denominator so positive segments display at their true API %.
    const allBucketsTotal = Object.values(buckets).reduce(
      (sum, v) => sum + v,
      0,
    );
    const displayTotal = allBucketsTotal > 0 ? allBucketsTotal : 100;

    const segments = [];
    preferredOrder.forEach((k) => {
      if ((buckets[k] || 0) > 0)
        segments.push({ label: toLabel(k), value: buckets[k] });
    });
    Object.keys(buckets).forEach((k) => {
      if (!preferredOrder.includes(k) && (buckets[k] || 0) > 0) {
        segments.push({ label: toLabel(k), value: buckets[k] });
      }
    });
    segments.sort((a, b) => b.value - a.value);

    if (segments.length > 0) {
      const normalized = segments.map((s) => ({
        ...s,
        value: (s.value / displayTotal) * 100,
      }));
      buildDoughnutChart(
        "modalAssetAllocationChart",
        normalized.map((s) => s.label),
        normalized.map((s) => s.value),
        currentValue,
      );
    } else {
      assetBarEl.innerHTML =
        '<div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>';
    }
  }

  // ============ MARKET CAP / EQUITY SPLIT CHART (Doughnut) ============
  // totalValue = equityRupees (mirrors dashboard displayMarketCapSplit)
  const mcapBarEl = document.getElementById("modalMarketCapBar");
  if (mcapBarEl) {
    let large = 0,
      mid = 0,
      small = 0;

    if (
      ps.large_cap !== undefined ||
      ps.mid_cap !== undefined ||
      ps.small_cap !== undefined
    ) {
      large = parseFloat(ps.large_cap || 0);
      mid = parseFloat(ps.mid_cap || 0);
      small = parseFloat(ps.small_cap || 0);
    } else if (ps.market_cap_per) {
      large = parseFloat(ps.market_cap_per.large || 0);
      mid = parseFloat(ps.market_cap_per.mid || 0);
      small = parseFloat(ps.market_cap_per.small || 0);
    }

    const domesticEquity = resolvedBuckets["domestic equity"] || 0;
    const globalEquity = resolvedBuckets["global equity"] || 0;
    const hedgedEquity = resolvedBuckets["hedged equity"] || 0;

    const capTotal = large + mid + small;
    let largeFund = 0,
      midFund = 0,
      smallFund = 0;

    if (capTotal > 0 && domesticEquity > 0) {
      largeFund = (large / capTotal) * domesticEquity;
      midFund = (mid / capTotal) * domesticEquity;
      smallFund = (small / capTotal) * domesticEquity;
    } else if (domesticEquity > 0) {
      largeFund = domesticEquity;
    }

    const total = largeFund + midFund + smallFund + hedgedEquity + globalEquity;

    if (total > 0) {
      const segments = [
        { label: "Large", value: (largeFund / total) * 100 },
        { label: "Mid", value: (midFund / total) * 100 },
        { label: "Small", value: (smallFund / total) * 100 },
        { label: "Hedged Equity", value: (hedgedEquity / total) * 100 },
        { label: "Global Equity", value: (globalEquity / total) * 100 },
      ].filter((s) => s.value > 0);

      segments.sort((a, b) => b.value - a.value);

      const mcapLabels = segments.map((s) => s.label);
      const mcapData = segments.map((s) => s.value);

      buildDoughnutChart(
        "modalMarketCapChart",
        mcapLabels,
        mcapData,
        equityRupees,
      );

      // Apply the same grouped legend (Domestic / Other) as the Dashboard
      const mcapLabelsEl = mcapBarEl.querySelector(".donut-labels");
      if (mcapLabelsEl) {
        const mcapColors = mcapLabels.map((_, i) => getTbcColor(i));
        renderMarketCapGroupedLegend(
          mcapLabelsEl,
          mcapLabels,
          mcapData,
          equityRupees,
          mcapColors,
        );
      }
    } else {
      mcapBarEl.innerHTML =
        '<div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>';
    }
  }

  // ============ DEBT DISTRIBUTION CHART (Doughnut) ============
  // totalValue = debtRupees (mirrors dashboard displayDebtDistribution)
  const debtCol = document.getElementById("modalDebtCol");
  const debtColDivider = document.getElementById("modalDebtColDivider");
  if (debtCol && debtColDivider) {
    const debtBuckets = resolveDebtDistribution(extendedData?.holdings, 1);
    const debtEntries = Object.entries(debtBuckets)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    if (debtEntries.length > 0) {
      debtCol.style.display = "";
      debtColDivider.style.display = "";

      const debtTotal = debtEntries.reduce((sum, [, v]) => sum + v, 0);
      buildDoughnutChart(
        "modalDebtChart",
        debtEntries.map(([label]) => label),
        debtEntries.map(([, val]) => (val / debtTotal) * 100),
        debtRupees,
      );
    } else {
      debtCol.style.display = "none";
      debtColDivider.style.display = "none";
    }
  }

  // ============ EQUITY SECTOR SPLIT CHART (Doughnut) ============
  // totalValue = equityRupees (mirrors dashboard displaySectorSplit)
  const equitySectorCol = document.getElementById("modalEquitySectorCol");
  const equitySectorColDivider = document.getElementById(
    "modalEquitySectorColDivider",
  );

  if (equitySectorCol && equitySectorColDivider) {
    const equitySectorPer = ps?.equity_sector_per;
    const domesticEquityPct = parseFloat(ps?.asset_allocation?.equity ?? 0);
    const hedgedEquityPct = parseFloat(
      ps?.asset_allocation?.["Hedged Equity"] ?? 0,
    );
    const totalEquityPct = domesticEquityPct + hedgedEquityPct;

    const equitySectorEntries =
      equitySectorPer && totalEquityPct > 0
        ? Object.entries(equitySectorPer)
            .filter(([, v]) => v != null && parseFloat(v) > 0)
            .map(([label, v]) => [
              label.trim(),
              (parseFloat(v) / 100) * totalEquityPct,
            ])
            .sort((a, b) => b[1] - a[1])
        : [];

    if (equitySectorEntries.length > 0) {
      equitySectorCol.style.display = "";
      equitySectorColDivider.style.display = "";

      const equitySectorTotal = equitySectorEntries.reduce(
        (sum, [, v]) => sum + v,
        0,
      );

      buildDoughnutChart(
        "modalEquitySectorChart",
        equitySectorEntries.map(([label]) => label),
        equitySectorEntries.map(([, val]) => (val / equitySectorTotal) * 100),
        equityRupees,
      );
    } else {
      equitySectorCol.style.display = "none";
      equitySectorColDivider.style.display = "none";
    }
  }

  // ============ DEBT SECTOR SPLIT CHART (Doughnut) ============
  // totalValue = debtRupees (mirrors dashboard displayDebtSectorSplit)
  const debtSectorCol = document.getElementById("modalDebtSectorCol");
  const debtSectorColDivider = document.getElementById(
    "modalDebtSectorColDivider",
  );
  if (debtSectorCol && debtSectorColDivider) {
    const debtSectorPer = ps?.debt_sector_per;
    const debtAllocPct = parseFloat(
      ps?.asset_allocation?.debt ?? ps?.asset_allocation?.Debt ?? 0,
    );

    const debtSectorEntries =
      debtSectorPer && debtAllocPct > 0
        ? Object.entries(debtSectorPer)
            .filter(([, v]) => v != null && parseFloat(v) > 0)
            .map(([label, v]) => [
              label.trim(),
              (parseFloat(v) / 100) * debtAllocPct,
            ])
            .sort((a, b) => b[1] - a[1])
        : [];

    if (debtSectorEntries.length > 0) {
      debtSectorCol.style.display = "";
      debtSectorColDivider.style.display = "";

      const debtSectorTotal = debtSectorEntries.reduce(
        (sum, [, v]) => sum + v,
        0,
      );

      buildDoughnutChart(
        "modalDebtSectorChart",
        debtSectorEntries.map(([label]) => label),
        debtSectorEntries.map(([, val]) => (val / debtSectorTotal) * 100),
        debtRupees,
      );
    } else {
      debtSectorCol.style.display = "none";
      debtSectorColDivider.style.display = "none";
    }
  }
}

// MODAL FUNCTIONS - HOLDINGS
function showAllPortfolioHoldings() {
  const analytics = calculatePortfolioAnalytics();
  const holdingsObj = analytics.holdings;

  if (!holdingsObj || Object.keys(holdingsObj).length === 0) {
    alert("No holdings data available.");
    return;
  }

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "portfolioHoldingsModal";

  // Sort and limit to 200 items
  let entries = Object.entries(holdingsObj).sort(
    (a, b) => b[1].percentage - a[1].percentage,
  );
  const top200 = entries.slice(0, 200);
  const rest = entries.slice(200);

  let othersPercentage = 0;
  if (rest.length > 0) {
    othersPercentage = rest.reduce((sum, [, data]) => sum + data.percentage, 0);
  }

  modal.innerHTML = `
    <div class="transaction-modal">
      <div class="modal-header">
        <h2>Top Equity Holdings (Top ${top200.length}${
          rest.length > 0 ? " + Others" : ""
        })</h2>
        <button class="modal-close" onclick="closePortfolioHoldingsModal()">✕</button>
      </div>
      <div class="modal-content" id="portfolioHoldingsContent"></div>
      <div class="modal-footer">
        <button onclick="downloadPortfolioHoldings()">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "portfolioHoldings" },
    "",
    window.location.pathname,
  );

  const content = document.getElementById("portfolioHoldingsContent");
  content.appendChild(createHoldingsTable(top200, othersPercentage));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closePortfolioHoldingsModal();
  });
}

function closePortfolioHoldingsModal() {
  const modal = document.getElementById("portfolioHoldingsModal");
  if (modal) modal.remove();
  unlockBodyScroll();
}
function showAllFamilyHoldings() {
  if (!familyDashboardCache || !familyDashboardCache.holdings) {
    alert("No holdings data available.");
    return;
  }
  const holdingsObj = familyDashboardCache.holdings;

  if (Object.keys(holdingsObj).length === 0) {
    alert("No holdings data available.");
    return;
  }

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "familyHoldingsModal";

  // Sort and limit to 200 items
  let entries = Object.entries(holdingsObj).sort(
    (a, b) => b[1].percentage - a[1].percentage,
  );
  const top200 = entries.slice(0, 200);
  const rest = entries.slice(200);

  let othersPercentage = 0;
  if (rest.length > 0) {
    othersPercentage = rest.reduce((sum, [, data]) => sum + data.percentage, 0);
  }

  modal.innerHTML = `
    <div class="transaction-modal">
      <div class="modal-header">
        <h2>Family Top Equity Holdings (Top ${top200.length}${
          rest.length > 0 ? " + Others" : ""
        })</h2>
        <button class="modal-close" onclick="closeFamilyHoldingsModal()">✕</button>
      </div>
      <div class="modal-content" id="familyHoldingsContent"></div>
      <div class="modal-footer">
        <button onclick="downloadFamilyHoldings()">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "familyHoldings" },
    "",
    window.location.pathname,
  );

  const content = document.getElementById("familyHoldingsContent");
  content.appendChild(createHoldingsTable(top200, othersPercentage));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFamilyHoldingsModal();
  });
}

function closeFamilyHoldingsModal() {
  const modal = document.getElementById("familyHoldingsModal");
  if (modal) modal.remove();
  unlockBodyScroll();
}

function downloadFamilyHoldings() {
  if (!familyDashboardCache || !familyDashboardCache.holdings) {
    showToast("No holdings data available.", "warning");
    return;
  }
  const holdingsObj = familyDashboardCache.holdings;

  const allEntries = Object.entries(holdingsObj).sort(
    (a, b) => b[1].percentage - a[1].percentage,
  );

  const mainHoldings = allEntries.filter(
    ([company, info]) => info.percentage >= 0.01,
  );
  const smallHoldings = allEntries.filter(
    ([company, info]) => info.percentage < 0.01,
  );

  const data = mainHoldings.map(([company, info]) => ({
    "Company Name": company,
    "% of Family Portfolio": parseFloat(info.percentage.toFixed(2)),
    Nature: info.nature,
    Sector: info.sector,
  }));

  // Add "Others" row if there are small holdings
  if (smallHoldings.length > 0) {
    const othersTotal = smallHoldings.reduce(
      (sum, [, info]) => sum + info.percentage,
      0,
    );
    data.push({
      "Company Name": "Others (< 0.01% each)",
      "% of Family Portfolio": parseFloat(othersTotal.toFixed(2)),
      Nature: "Mixed",
      Sector: "Mixed",
    });
  }

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Family Top Equity Holdings");

  const filename = `family_portfolio_holdings_${
    new Date().toISOString().split("T")[0]
  }.xlsx`;
  XLSX.writeFile(wb, filename);

  showToast("Family holdings downloaded successfully!", "success");
}
function showFundHoldings(fundKey) {
  const fund = fundWiseData[fundKey];

  if (!fund || !fund.holdings || fund.holdings.length === 0) {
    alert("No holdings data available for this fund.");
    return;
  }

  // Check if fund details modal is open
  const fundDetailsModal = document.getElementById("fundDetailsModal");
  const hasPreviousModal = fundDetailsModal !== null;

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "fundHoldingsModal";
  modal.dataset.hasPreviousModal = hasPreviousModal;

  // Calculate total holdings percentage
  let totalHoldingsPercentage = 0;
  fund.holdings.forEach((holding) => {
    totalHoldingsPercentage += parseFloat(holding.corpus_per || 0);
  });

  const sortedHoldings = [...fund.holdings].sort(
    (a, b) => parseFloat(b.corpus_per || 0) - parseFloat(a.corpus_per || 0),
  );

  // Add Cash equivalent if holdings < 100%
  const holdingsWithCash = [...sortedHoldings];
  if (totalHoldingsPercentage < 100 && totalHoldingsPercentage > 0) {
    const cashPercentage = 100 - totalHoldingsPercentage;
    holdingsWithCash.push({
      company_name: "Cash Equivalents",
      corpus_per: cashPercentage.toFixed(2),
      nature_name: "Debt",
      sector_name: "Cash",
    });
  }

  modal.innerHTML = `
    <div class="transaction-modal">
      <div class="modal-header">
        <h2>${fund.schemeDisplay || fund.scheme} - Holdings (${
          holdingsWithCash.length
        })</h2>
        <button class="modal-close" onclick="closeFundHoldingsModal()">✕</button>
      </div>
      <div class="modal-content" id="fundHoldingsContent"></div>
      <div class="modal-footer">
        <button onclick="downloadFundHoldings('${fundKey}')">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState(
    { modal: "fundHoldings" },
    "",
    window.location.pathname,
  );

  const content = document.getElementById("fundHoldingsContent");
  content.appendChild(createFundHoldingsTable(holdingsWithCash));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFundHoldingsModal();
  });
}
function closeFundHoldingsModal() {
  const modal = document.getElementById("fundHoldingsModal");
  if (modal) {
    const hasPreviousModal = modal.dataset.hasPreviousModal === "true";
    modal.remove();

    if (!hasPreviousModal) {
      unlockBodyScroll();
    }
  }
}
function createHoldingsTable(holdings, othersPercentage = 0) {
  const table = document.createElement("table");
  table.className = "transaction-table";

  const header = document.createElement("thead");
  header.innerHTML = `
    <tr>
      <th>Company Name</th>
      <th>% of Portfolio</th>
      <th>Nature</th>
      <th>Instrument</th>
    </tr>
  `;
  table.appendChild(header);

  const body = document.createElement("tbody");

  holdings
    .filter(([company, data]) => data.percentage >= 0.01) // Filter here too
    .forEach(([company, data]) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${company}</td>
        <td>${data.percentage.toFixed(2)}%</td>
        <td>${data.nature}</td>
        <td>
        ${(() => {
          const isCashOrMf = ["CASH", "MF"].includes(data.nature);

          return (
            (isCashOrMf ? "" : data.sector) +
              (data.instrument === "Equity"
                ? ""
                : (isCashOrMf ? "" : " - ") + data.instrument) || "Unknown"
          );
        })()}
      </td>
      `;
      body.appendChild(row);
    });

  // Add Others row if exists
  if (othersPercentage > 0) {
    const othersRow = document.createElement("tr");
    othersRow.style.fontWeight = "600";
    othersRow.innerHTML = `
      <td>Others</td>
      <td>${othersPercentage.toFixed(2)}%</td>
      <td>Mixed</td>
      <td>Mixed</td>
    `;
    body.appendChild(othersRow);
  }

  table.appendChild(body);
  return table;
}
function createFundHoldingsTable(holdings) {
  const table = document.createElement("table");
  table.className = "transaction-table";

  const header = document.createElement("thead");
  header.innerHTML = `
    <tr>
      <th>Company Name</th>
      <th>% of Fund</th>
      <th>Nature</th>
      <th>Instrument</th>
    </tr>
  `;
  table.appendChild(header);

  const body = document.createElement("tbody");

  holdings.forEach((holding) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${holding.company_name || "Unknown"}</td>
      <td>${parseFloat(holding.corpus_per || 0).toFixed(2)}%</td>
      <td>${holding.nature_name || "Unknown"}</td>
      <td>
        ${(() => {
          const isCashOrMf = ["CASH", "MF"].includes(holding.nature_name);

          return (
            (isCashOrMf ? "" : holding.sector_name) +
              (holding.instrument_name === "Equity"
                ? ""
                : (isCashOrMf ? "" : " - ") + holding.instrument_name) ||
            "Unknown"
          );
        })()}
      </td>
    `;
    body.appendChild(row);
  });

  table.appendChild(body);
  return table;
}
function downloadPortfolioHoldings() {
  const analytics = calculatePortfolioAnalytics();
  const holdingsObj = analytics.holdings;

  const allEntries = Object.entries(holdingsObj).sort(
    (a, b) => b[1].percentage - a[1].percentage,
  );

  const mainHoldings = allEntries.filter(
    ([company, info]) => info.percentage >= 0.01,
  );
  const smallHoldings = allEntries.filter(
    ([company, info]) => info.percentage < 0.01,
  );

  const data = mainHoldings.map(([company, info]) => ({
    "Company Name": company,
    "% of Portfolio": parseFloat(info.percentage.toFixed(2)),
    Nature: info.nature,
    Sector: info.sector,
  }));

  // Add "Others" row if there are small holdings
  if (smallHoldings.length > 0) {
    const othersTotal = smallHoldings.reduce(
      (sum, [, info]) => sum + info.percentage,
      0,
    );
    data.push({
      "Company Name": "Others (< 0.01% each)",
      "% of Portfolio": parseFloat(othersTotal.toFixed(2)),
      Nature: "Mixed",
      Sector: "Mixed",
    });
  }

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Top Equity Holdings");

  const filename = `portfolio_holdings_${
    new Date().toISOString().split("T")[0]
  }.xlsx`;
  XLSX.writeFile(wb, filename);

  showToast("Portfolio holdings downloaded successfully!", "success");
}

function downloadFundHoldings(fundKey) {
  const fund = fundWiseData[fundKey];

  if (!fund || !fund.holdings) return;

  // Calculate total holdings percentage
  let totalHoldingsPercentage = 0;
  fund.holdings.forEach((holding) => {
    totalHoldingsPercentage += parseFloat(holding.corpus_per || 0);
  });

  const holdingsWithCash = [...fund.holdings];

  // Add Cash equivalent if holdings < 100%
  if (totalHoldingsPercentage < 100 && totalHoldingsPercentage > 0) {
    const cashPercentage = 100 - totalHoldingsPercentage;
    holdingsWithCash.push({
      company_name: "Cash Equivalents",
      corpus_per: cashPercentage, // Keep as number
      nature_name: "Debt",
      sector_name: "Cash",
    });
  }

  const data = holdingsWithCash
    .sort(
      (a, b) => parseFloat(b.corpus_per || 0) - parseFloat(a.corpus_per || 0),
    )
    .map((holding) => ({
      "Company Name": holding.company_name || "Unknown",
      "% of Fund": parseFloat((holding.corpus_per || 0).toFixed(2)),
      Nature: holding.nature_name || "Unknown",
      Sector: holding.sector_name || "Unknown",
    }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Fund Holdings");

  const filename = `${fund.scheme.replace(/\s+/g, "_")}_holdings.xlsx`;
  XLSX.writeFile(wb, filename);

  showToast("Fund holdings downloaded successfully!", "success");
}

// MODAL FUNCTIONS - TRANSACTIONS
function showAllTimeTransactions() {
  if (!allTimeFlows || allTimeFlows.length === 0) {
    alert("No All-Time transactions available.");
    return;
  }

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "allTimeTransactionsModal";

  modal.innerHTML = `
    <div class="transaction-modal">
      <div class="modal-header">
        <h2>All-Time Transactions</h2>
        <button class="modal-close" onclick="closeAllTimeTransactions()">✕</button>
      </div>
      <div class="modal-content" id="allTimeTxContent"></div>
      <div class="modal-footer">
        <button onclick="generateExcelReport(allTimeFlows, 'all_time_holdings_transactions.xlsx')">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState({ modal: "allTime" }, "", window.location.pathname);

  const allTimeContent = document.getElementById("allTimeTxContent");
  allTimeContent.appendChild(
    createTransactionTable(allTimeFlows, "allTimeTable"),
  );

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeAllTimeTransactions();
  });
}

function closeAllTimeTransactions() {
  const modal = document.getElementById("allTimeTransactionsModal");
  if (modal) modal.remove();
  unlockBodyScroll();
}

function showActiveTransactions() {
  if (!activeFlows || activeFlows.length === 0) {
    alert("No Active transactions available.");
    return;
  }

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "activeTransactionsModal";

  modal.innerHTML = `
    <div class="transaction-modal">
      <div class="modal-header">
        <h2>Active Holdings Transactions</h2>
        <button class="modal-close" onclick="closeActiveTransactions()">✕</button>
      </div>
      <div class="modal-content" id="activeTxContent"></div>
      <div class="modal-footer">
        <button onclick="generateExcelReport(activeFlows, 'active_holdings_transactions.xlsx')">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState({ modal: "active" }, "", window.location.pathname);
  const activeContent = document.getElementById("activeTxContent");
  activeContent.appendChild(createTransactionTable(activeFlows, "activeTable"));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeActiveTransactions();
  });
}

function closeActiveTransactions() {
  const modal = document.getElementById("activeTransactionsModal");
  if (modal) modal.remove();
  unlockBodyScroll();
}

function showFundTransactions(fundKey, folioNumbersStr) {
  const fund = fundWiseData[fundKey];
  if (!fund || !fund.advancedMetrics) {
    console.error("Fund or advancedMetrics not found with key:", fundKey);
    return;
  }

  const targetFolios = folioNumbersStr.split(",").map((f) => f.trim());

  // Check if fund details modal is open
  const fundDetailsModal = document.getElementById("fundDetailsModal");
  const hasPreviousModal = fundDetailsModal !== null;

  // Don't remove existing modals, just hide them temporarily
  if (!hasPreviousModal) {
    const existingModals = document.querySelectorAll(".transaction-modal");
    existingModals.forEach((e) => e.remove());
  }

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "fundTransactionModal";
  modal.dataset.hasPreviousModal = hasPreviousModal;

  // Use cashflows from advancedMetrics
  const transactions = [];
  Object.values(fund.advancedMetrics.folioSummaries).forEach((folioSummary) => {
    if (targetFolios.includes(folioSummary.folio)) {
      folioSummary.cashflows.forEach((cf) => {
        transactions.push({
          scheme: fund.schemeDisplay || fund.scheme,
          folio: folioSummary.folio,
          type: cf.type === "Buy" ? "PURCHASE" : "REDEMPTION",
          date: new Date(cf.date),
          amount: Math.abs(cf.amount),
          nav: cf.nav,
          units: cf.units,
        });
      });
    }
  });

  transactions.sort((a, b) => b.date - a.date);

  modal.innerHTML = `
    <div class="transaction-modal">
      <div class="modal-header">
        <h2>${fund.schemeDisplay || fund.scheme}</h2>
        <div class="modal-header-right">
          <label class="fund-tx-folio-label" title="View transactions grouped by folio">
            <span class="fund-tx-folio-label-text">Folio Wise</span>
            <div class="fund-tx-toggle-pill">
              <input type="checkbox" id="folioWiseToggle" onchange="toggleFolioWiseView('${fundKey}', '${folioNumbersStr}', this.checked)">
              <span class="fund-tx-toggle-track"></span>
            </div>
          </label>
          <button class="modal-close" onclick="closeFundTransactionModal()">✕</button>
        </div>
      </div>
      <div class="modal-content" id="fundTxContent"></div>
      <div class="modal-footer">
        <button onclick="downloadFundTransactions('${fundKey}', '${folioNumbersStr}')">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }
  window.history.pushState({ modal: "fundTx" }, "", window.location.pathname);
  document
    .getElementById("fundTxContent")
    .appendChild(createFundTransactionTable(transactions));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFundTransactionModal();
  });
}

function closeFundTransactionModal() {
  const modal = document.getElementById("fundTransactionModal");
  if (modal) {
    const hasPreviousModal = modal.dataset.hasPreviousModal === "true";
    modal.remove();

    if (!hasPreviousModal) {
      unlockBodyScroll();
    }
  }
}

function toggleFolioWiseView(fundKey, folioNumbersStr, isFolioWise) {
  const fund = fundWiseData[fundKey];
  if (!fund || !fund.advancedMetrics) return;

  const targetFolios = folioNumbersStr.split(",").map((f) => f.trim());
  const contentEl = document.getElementById("fundTxContent");
  if (!contentEl) return;

  contentEl.innerHTML = "";

  if (isFolioWise) {
    contentEl.appendChild(createFolioWiseTransactionView(fund, targetFolios));
  } else {
    const transactions = [];
    Object.values(fund.advancedMetrics.folioSummaries).forEach(
      (folioSummary) => {
        if (targetFolios.includes(folioSummary.folio)) {
          folioSummary.cashflows.forEach((cf) => {
            transactions.push({
              scheme: fund.schemeDisplay || fund.scheme,
              folio: folioSummary.folio,
              type: cf.type === "Buy" ? "PURCHASE" : "REDEMPTION",
              date: new Date(cf.date),
              amount: Math.abs(cf.amount),
              nav: cf.nav,
              units: cf.units,
            });
          });
        }
      },
    );
    transactions.sort((a, b) => b.date - a.date);
    contentEl.appendChild(createFundTransactionTable(transactions));
  }
}

function createFolioWiseTransactionView(fund, targetFolios) {
  const wrapper = document.createElement("div");
  wrapper.className = "folio-wise-wrapper";

  // Build folio groups, each with their latest transaction date
  const folioGroups = [];
  Object.values(fund.advancedMetrics.folioSummaries).forEach((folioSummary) => {
    if (!targetFolios.includes(folioSummary.folio)) return;

    const txns = folioSummary.cashflows
      .filter((cf) => cf.type !== "VALUATION")
      .map((cf) => ({
        scheme: fund.schemeDisplay || fund.scheme,
        folio: folioSummary.folio,
        type: cf.type === "Buy" ? "PURCHASE" : "REDEMPTION",
        date: new Date(cf.date),
        amount: Math.abs(cf.amount),
        nav: cf.nav,
        units: cf.units,
      }));

    if (txns.length === 0) return;

    txns.sort((a, b) => b.date - a.date);
    const latestDate = txns[0].date;
    const currentValue = folioSummary.currentValue || 0;
    const remainingUnits = folioSummary.remainingUnits || 0;

    folioGroups.push({
      folio: folioSummary.folio,
      txns,
      latestDate,
      currentValue,
      remainingUnits,
    });
  });

  // Sort groups so folio with latest transaction appears first
  folioGroups.sort((a, b) => b.latestDate - a.latestDate);

  if (folioGroups.length === 0) {
    const noDataMsg = document.createElement("p");
    noDataMsg.style.cssText =
      "text-align: center; color: #9ca3af; padding: 20px;";
    noDataMsg.textContent = "No transactions available";
    wrapper.appendChild(noDataMsg);
    return wrapper;
  }

  // Use a SINGLE table so columns stay perfectly aligned across all folios
  const table = document.createElement("table");
  table.className = "transaction-table folio-wise-table";

  const header = document.createElement("thead");
  header.innerHTML = `
    <tr>
      <th>Type</th>
      <th>Date</th>
      <th>NAV</th>
      <th>Units</th>
      <th>Amount</th>
    </tr>
  `;
  table.appendChild(header);

  folioGroups.forEach(
    ({ folio, txns, currentValue, remainingUnits }, groupIndex) => {
      // Folio separator row — spans all 5 columns
      const separatorBody = document.createElement("tbody");
      separatorBody.className = "folio-group-separator";

      const sepRow = document.createElement("tr");
      sepRow.className = "folio-group-header-row";

      const valueDisplay =
        currentValue > 0
          ? `<span class="folio-tx-current-value">| Value: ₹${currentValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`
          : `<span class="folio-tx-current-value folio-tx-redeemed">| Fully Redeemed</span>`;

      sepRow.innerHTML = `
      <td colspan="5" class="folio-group-header-cell">
        <span class="folio-tx-label">Folio</span>
        <span class="folio-tx-number">${folio.split("/")[0].trim()}</span>
        ${valueDisplay}
      </td>
    `;
      separatorBody.appendChild(sepRow);
      table.appendChild(separatorBody);

      // Transaction rows for this folio
      const body = document.createElement("tbody");
      body.className = "folio-group-body";

      txns.forEach((cf) => {
        const row = document.createElement("tr");
        const txType = getTransactionDisplayType(cf.type);
        const amountColor = txType === "Buy" ? "#10b981" : "#ef4444";

        row.innerHTML = `
        <td><span class="tx-type">${txType}</span></td>
        <td>${cf.date.toISOString().split("T")[0]}</td>
        <td>₹${cf.nav ? cf.nav.toFixed(4) : "N/A"}</td>
        <td>${cf.units ? cf.units.toFixed(3) : "N/A"}</td>
        <td class="amount" style="color: ${amountColor};">₹${Math.abs(cf.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      `;
        body.appendChild(row);
      });

      table.appendChild(body);
    },
  );

  wrapper.appendChild(table);
  return wrapper;
}

function downloadFundTransactions(fundKey, folioNumbersStr) {
  const fund = fundWiseData[fundKey];
  if (!fund || !fund.advancedMetrics) return;

  const targetFolios = folioNumbersStr.split(",").map((f) => f.trim());

  // Use cashflows from advancedMetrics
  const transactions = [];
  Object.values(fund.advancedMetrics.folioSummaries).forEach((folioSummary) => {
    if (targetFolios.includes(folioSummary.folio)) {
      folioSummary.cashflows.forEach((cf) => {
        transactions.push({
          scheme: fund.scheme,
          folio: folioSummary.folio,
          type: cf.type === "Buy" ? "PURCHASE" : "REDEMPTION",
          date: new Date(cf.date),
          amount: Math.abs(cf.amount),
          nav: cf.nav,
          units: cf.units,
        });
      });
    }
  });

  const filename = `${fund.scheme.replace(/\s+/g, "_")}_transactions.xlsx`;
  generateExcelReport(transactions, filename);
}
function initializeTransactionSections() {
  const excelContainer = document.querySelector(".excel");
  if (!excelContainer) {
    console.warn("Excel container not found");
    return;
  }

  const existingWrapper = document.getElementById("transactionSectionsWrapper");
  if (existingWrapper) existingWrapper.remove();

  const allCount = (allTimeFlows || []).filter(
    (f) => f.type !== "VALUATION",
  ).length;
  const activeCount = (activeFlows || []).filter(
    (f) => f.type !== "VALUATION",
  ).length;

  const wrapper = document.createElement("div");
  wrapper.id = "transactionSectionsWrapper";
  wrapper.className = "tx-page-wrapper";

  wrapper.innerHTML = `
    <div class="tx-section">
      <div class="tx-section-header">
        <div class="tx-section-left">
          <span class="tx-section-icon">💼</span>
          <span class="tx-section-title">Active Holdings Transactions</span>
          <span class="tx-count-badge">${activeCount}</span>
        </div>
        <div class="tx-section-actions">
          <input class="tx-search tx-search-active" type="text" placeholder="Find by fund…"
                 oninput="filterTxTable('activeTxTable', this.value)" />
          <button class="tx-dl-btn" onclick="generateExcelReport(activeFlows, 'active_holdings_transactions.xlsx')">
            <i class="fa-solid fa-download"></i> Excel
          </button>
        </div>
      </div>
      <div class="tx-table-wrap" id="activeTxTableWrap"></div>
    </div>

    <div class="tx-section">
      <div class="tx-section-header">
        <div class="tx-section-left">
          <span class="tx-section-icon">📊</span>
          <span class="tx-section-title">All-Time Transactions</span>
          <span class="tx-count-badge">${allCount}</span>
        </div>
        <div class="tx-section-actions">
          <input class="tx-search tx-search-alltime" type="text" placeholder="Find by fund…"
                 oninput="filterTxTable('allTxTable', this.value)" />
          <button class="tx-dl-btn" onclick="generateExcelReport(allTimeFlows, 'all_time_holdings_transactions.xlsx')">
            <i class="fa-solid fa-download"></i> Excel
          </button>
        </div>
      </div>
      <div class="tx-table-wrap" id="allTxTableWrap"></div>
    </div>
  `;

  excelContainer.innerHTML = "";
  excelContainer.appendChild(wrapper);

  // Render tables inline — Active first, All-Time second
  const activeWrap = document.getElementById("activeTxTableWrap");
  activeWrap.appendChild(createTransactionTable(activeFlows, "activeTxTable"));

  const allWrap = document.getElementById("allTxTableWrap");
  allWrap.appendChild(createTransactionTable(allTimeFlows, "allTxTable"));
}

function normalizeSearchText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bmid\s+cap\b/g, "midcap")
    .replace(/\bsmall\s+cap\b/g, "smallcap")
    .replace(/\blarge\s+cap\b/g, "largecap")
    .replace(/\s+/g, " ")
    .trim();
}

function filterTxTable(tableId, query) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const terms = normalizeSearchText(query).split(" ").filter(Boolean);

  table.querySelectorAll("tbody tr").forEach((row) => {
    const scheme = normalizeSearchText(row.cells[0]?.textContent || "");

    const matches =
      terms.length === 0 || terms.every((term) => scheme.includes(term));

    row.style.display = matches ? "" : "none";
  });
}

function createTransactionTable(cashFlows, tableId) {
  const filteredFlows = cashFlows.filter((cf) => cf.type !== "VALUATION");

  if (filteredFlows.length === 0) {
    const noDataMsg = document.createElement("p");
    noDataMsg.style.cssText =
      "text-align: center; color: #9ca3af; padding: 20px;";
    noDataMsg.textContent = "No transactions available";
    return noDataMsg;
  }

  // Sort by date descending (newest first)
  filteredFlows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const table = document.createElement("table");
  table.className = "transaction-table";
  table.id = tableId;

  const header = document.createElement("thead");
  header.innerHTML = `
    <tr>
      <th>Scheme</th>
      <th>Folio No</th>
      <th>Type</th>
      <th>Date</th>
      <th>NAV</th>
      <th>Units</th>
      <th>Amount</th>
    </tr>
  `;
  table.appendChild(header);

  const body = document.createElement("tbody");
  filteredFlows.forEach((cf) => {
    const row = document.createElement("tr");
    const txType = getTransactionDisplayType(cf.type);
    const amountColor = txType === "Buy" ? "#10b981" : "#ef4444";

    row.innerHTML = `
      <td>${cf.schemeDisplay || cf.scheme || "Unknown"}</td>
      <td>${cf.folio ? cf.folio.split("/")[0].trim() : "Unknown"}</td>
      <td><span class="tx-type">${txType}</span></td>
      <td>${cf.date.toISOString().split("T")[0]}</td>
      <td>₹${cf.nav ? cf.nav.toFixed(4) : "N/A"}</td>
      <td>${cf.units ? cf.units.toFixed(3) : "N/A"}</td>
      <td class="amount" style="color: ${amountColor};">₹${Math.abs(
        cf.amount,
      ).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</td>
    `;
    body.appendChild(row);
  });
  table.appendChild(body);

  return table;
}

function createFundTransactionTable(cashFlows) {
  const filteredFlows = cashFlows.filter((cf) => cf.type !== "VALUATION");

  if (filteredFlows.length === 0) {
    const noDataMsg = document.createElement("p");
    noDataMsg.style.cssText =
      "text-align: center; color: #9ca3af; padding: 20px;";
    noDataMsg.textContent = "No transactions available";
    return noDataMsg;
  }

  // Sort by date descending (newest first)
  filteredFlows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const table = document.createElement("table");
  table.className = "transaction-table";

  const header = document.createElement("thead");
  header.innerHTML = `
    <tr>
      <th>Folio No</th>
      <th>Type</th>
      <th>Date</th>
      <th>NAV</th>
      <th>Units</th>
      <th>Amount</th>
    </tr>
  `;
  table.appendChild(header);

  const body = document.createElement("tbody");
  filteredFlows.forEach((cf) => {
    const row = document.createElement("tr");
    const txType = getTransactionDisplayType(cf.type);
    const amountColor = txType === "Buy" ? "#10b981" : "#ef4444";

    row.innerHTML = `
      <td>${cf.folio ? cf.folio.split("/")[0].trim() : "Unknown"}</td>
      <td><span class="tx-type">${txType}</span></td>
      <td>${cf.date.toISOString().split("T")[0]}</td>
      <td>₹${cf.nav ? cf.nav.toFixed(4) : "N/A"}</td>
      <td>${cf.units ? cf.units.toFixed(3) : "N/A"}</td>
      <td class="amount" style="color: ${amountColor};">₹${Math.abs(
        cf.amount,
      ).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</td>
    `;
    body.appendChild(row);
  });
  table.appendChild(body);

  return table;
}
function getTransactionDisplayType(type) {
  if (type === "REDEMPTION") {
    return "Sell";
  } else return "Buy"; // Default to Buy
}

function generateExcelReport(cashFlows, filename) {
  const data = cashFlows
    .filter((cf) => cf.type !== "VALUATION")
    .map((cf) => ({
      Scheme: cf.scheme || "Unknown",
      "Folio No": cf.folio || "Unknown",
      Type: getTransactionDisplayType(cf.type),
      Date: cf.date.toISOString().split("T")[0],
      NAV: cf.nav ? parseFloat(cf.nav.toFixed(4)) : "N/A",
      Units: cf.units ? parseFloat(cf.units.toFixed(3)) : "N/A",
      Amount: Math.abs(cf.amount),
    }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 40 }, // Scheme
    { wch: 15 }, // Folio No
    { wch: 12 }, // Type
    { wch: 12 }, // Date
    { wch: 12 }, // NAV
    { wch: 12 }, // Units
    { wch: 15 }, // Amount
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  XLSX.writeFile(wb, filename);
}

// CHARTS
function initializeCharts() {
  const periods = getPeriods();
  const timeFilter = document.getElementById("timeFilter");
  if (!timeFilter) return;
  timeFilter.innerHTML = "";

  // Default: 6M if available, otherwise "All"
  const defaultPeriod = periods.includes("6M") ? "6M" : "All";
  currentPeriod = defaultPeriod;

  periods.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "time-btn" + (p === defaultPeriod ? " active" : "");
    btn.textContent = p;

    // Add data attribute to identify 1M button
    if (p === "1M") {
      btn.setAttribute("data-period", "1M");
    }

    btn.onclick = () => {
      document
        .querySelectorAll(".time-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPeriod = p;
      updateChart();
    };
    timeFilter.appendChild(btn);
  });

  updateChart();
}
function showChartLoadingState(canvas) {
  if (chart) {
    chart.destroy();
    chart = null;
  }
  const container = canvas.parentNode;
  if (!container) return;
  container.style.position = container.style.position || "relative";

  let overlay = container.querySelector(".chart-loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "chart-loading-overlay";
    overlay.style.cssText =
      "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;";
    overlay.innerHTML =
      '<div class="chart-spinner"></div><span style="font-size:13px;opacity:0.7;">Calculating portfolio growth…</span>';
    container.appendChild(overlay);
  }
  overlay.style.display = "flex";
  canvas.style.visibility = "hidden";
}

function hideChartLoadingState(canvas) {
  const container = canvas.parentNode;
  const overlay =
    container && container.querySelector(".chart-loading-overlay");
  if (overlay) overlay.style.display = "none";
  canvas.style.visibility = "visible";
}

function updateChart() {
  const canvas = document.getElementById("portfolioChart");
  if (!canvas) return;

  // The Growth tab depends on window.portfolioValuationHistory, which is
  // computed asynchronously (in chunks, via requestIdleCallback) after CAS
  // upload and can take a couple of seconds for larger portfolios. If the
  // user opens the Charts tab before that finishes, getChartData() silently
  // falls back to a different data shape (no `.costs`), which previously
  // fell through into the bar-chart branch below and rendered something
  // that looks just like the Investment chart. Show a loading state instead
  // and bail out — the pending calculation already triggers a follow-up
  // updateChart() call once portfolioValuationHistory is populated.
  if (
    currentTab === "growth" &&
    !(
      window.portfolioValuationHistory &&
      window.portfolioValuationHistory.length > 0
    )
  ) {
    showChartLoadingState(canvas);
    return;
  }
  hideChartLoadingState(canvas);

  const data = getChartData();

  if (chart) {
    chart.destroy();
    chart = null;
  }

  const ctx = canvas.getContext("2d");

  // === GROWTH CHART ===
  if (currentTab === "growth" && data.costs) {
    // Add today's data point if not already there
    const lastDataDate = data.rawData[data.rawData.length - 1].date;
    const today = new Date().toISOString().split("T")[0];

    if (lastDataDate !== today) {
      const currentValue = Object.values(fundWiseData).reduce(
        (sum, fund) => sum + (fund.valuation?.value || 0),
        0,
      );

      const lastCost = data.rawData[data.rawData.length - 1].cost;

      data.rawData.push({
        date: today,
        value: currentValue,
        cost: lastCost,
        unrealizedGain: currentValue - lastCost,
        unrealizedGainPercent:
          lastCost > 0 ? ((currentValue - lastCost) / lastCost) * 100 : 0,
      });

      const todayLabel = new Date().toLocaleDateString("en-IN", {
        month: "short",
        year: "2-digit",
      });

      data.labels.push(todayLabel);
      data.values.push(currentValue);
      data.costs.push(lastCost);
    }

    const colors = getChartTheme();

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "Portfolio Value",
            data: data.values,
            borderColor: colors.growthValuation,
            fill: false,
            tension: 0.3,
            borderWidth: window.innerWidth <= 768 ? 1.5 : 2,
            pointRadius: 0,
            pointHoverRadius: window.innerWidth <= 768 ? 4 : 6,
            pointHoverBackgroundColor: colors.growthValuation,
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: window.innerWidth <= 768 ? 1 : 1.5,
          },
          {
            label: "Total Invested",
            data: data.costs,
            borderColor: colors.growthCost,
            borderDash: [6, 4],
            fill: false,
            tension: 0.3,
            borderWidth: window.innerWidth <= 768 ? 1.5 : 2,
            pointRadius: 0,
            pointHoverRadius: window.innerWidth <= 768 ? 4 : 6,
            pointHoverBackgroundColor: colors.growthCost,
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: window.innerWidth <= 768 ? 1 : 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0,
          easing: "easeInOutQuart",
        },
        interaction: { intersect: false, mode: "index", axis: "x" },
        events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
        onClick: (evt, activeEls, chart) => {
          if (!activeEls.length) {
            chart.tooltip.setActiveElements([], { x: 0, y: 0 });
            chart.update();
          }
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              usePointStyle: true,
              pointStyle: "line",
              font: { size: 13, weight: "600" },
              color: colors.textColor,
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 2,
            cornerRadius: 8,
            titleFont: { size: 13, weight: "bold" },
            bodyFont: { size: 12 },
            titleColor: "#fff",
            bodyColor: "#fff",
            displayColors: false,
            mode: "index",
            intersect: false,
            callbacks: {
              title: (items) => {
                const dateStr = data.rawData[items[0].dataIndex].date;
                const [y, m, d] = dateStr.split("-").map(Number);
                return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                });
              },
              label: (ctx) =>
                `${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`,
              afterLabel: (ctx) => {
                if (ctx.datasetIndex === 1) {
                  const p = data.rawData[ctx.dataIndex];
                  const gain = p.unrealizedGain;
                  const gainPct = p.unrealizedGainPercent;
                  const sign = gain >= 0 ? "+" : "";
                  return [
                    "",
                    `Gain: ${sign}₹${Math.abs(gain).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`,
                    `Return: ${sign}${gainPct.toFixed(2)}%`,
                  ];
                }
              },
            },
          },
        },
        scales: {
          x: {
            display: true,
            grid: {
              display: false,
              drawBorder: false,
              color: colors.gridColor,
              borderColor: colors.borderColor,
              borderWidth: 2,
            },
            ticks: {
              display: true,
              color: colors.textColor,
              font: { size: 11 },
              maxRotation: 45, // Changed from 0
              minRotation: 0,
              autoSkip: true,
              autoSkipPadding: 15, // Added padding
              maxTicksLimit: window.innerWidth <= 768 ? 6 : 12, // Increased limits
              callback: function (value, index, ticks) {
                const label = this.getLabelForValue(value);
                const dataLength = this.chart.data.labels.length;

                // Always show first and last
                if (index === 0 || index === ticks.length - 1) {
                  return label;
                }

                // Show evenly spaced labels based on data density
                const interval = Math.ceil(
                  dataLength / (window.innerWidth <= 768 ? 6 : 12),
                );
                if (index % interval === 0) {
                  return label;
                }

                return null;
              },
            },
          },
          y: {
            display: true,
            grid: {
              display: true,
              drawBorder: true,
              color: colors.gridColor,
              borderColor: colors.borderColor,
              borderWidth: 2,
            },
            ticks: {
              display: true,
              color: colors.textColor,
              font: { size: 11 },
              callback: (value) => {
                if (value >= 10000000) {
                  return "₹" + (value / 10000000).toFixed(1) + "Cr";
                }
                if (value >= 100000) {
                  return "₹" + (value / 100000).toFixed(1) + "L";
                }
                if (value >= 1000) {
                  return "₹" + (value / 1000).toFixed(0) + "K";
                }
                return "₹" + value;
              },
            },
          },
        },
      },
    });

    if (window.innerWidth <= 1024) {
      canvas.addEventListener("touchend", function () {
        setTimeout(() => {
          if (chart && chart.tooltip) {
            chart.tooltip.setActiveElements([], { x: 0, y: 0 });
            chart.update("none");
          }
        }, 100);
      });
    }

    updateStatsForGrowth(data);
    return;
  }

  // === OTHER TABS ===
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, "#8799f4");
  gradient.addColorStop(0.5, "#667eea");
  gradient.addColorStop(1, "#5a6ed1");

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [
        {
          label: currentTab.charAt(0).toUpperCase() + currentTab.slice(1),
          data: data.values,
          backgroundColor: gradient,
          borderColor: "#667eea",
          hoverBackgroundColor: "#764ba2",
          borderWidth: 0,
          borderRadius: 4,
          barThickness: "flex",
          maxBarThickness: 60,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0,
        easing: "easeInOutQuart",
      },
      interaction: { intersect: false, mode: "index", axis: "x" },
      events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
      onClick: (evt, activeEls, chart) => {
        if (!activeEls.length) {
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.update();
        }
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "end",
          color: getChartTheme().textColor,
          font: { weight: "bold", size: 10 },
          padding: { top: 6, bottom: 0 },
          display: function (context) {
            const width = window.innerWidth;
            const isMobile = width <= 500;
            const totalBars = context.chart.data.labels.length;
            if (currentPeriod === "1Y" && isMobile) return false;
            return totalBars <= 36;
          },
          formatter: function (value) {
            if (value >= 100000) return (value / 100000).toFixed(1) + "L";
            else if (value >= 1000) return (value / 1000).toFixed(0) + "K";
            else if (value <= -100000) return (value / 100000).toFixed(1) + "L";
            else if (value <= -1000) return (value / 1000).toFixed(0) + "K";
            return value.toFixed(0);
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: getChartTheme().tooltipBg,
          borderColor: getChartTheme().tooltipBorder,
          borderWidth: 2,
          titleColor: "#fff",
          bodyColor: "#fff",
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString("en-IN")}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(...data.values) * 1.1,
          ticks: { display: false },
          grid: { drawTicks: false, drawBorder: false, display: false },
        },
        x: {
          ticks: {
            autoSkip: true,
            autoSkipPadding: 10,
            maxTicksLimit: 15,
            maxRotation: 0,
            minRotation: 0,
            color: getChartTheme().textColor,
          },
          grid: { drawTicks: false, drawBorder: false, display: false },
        },
      },
    },
    plugins: [ChartDataLabels],
  });

  adjustXAxisLabels(chart);
}
function switchTab(tab) {
  currentTab = tab;
  document
    .querySelectorAll(".tab-btn")
    .forEach((btn) => btn.classList.remove("active"));
  event.target.classList.add("active");

  // Show/hide 1M button based on tab
  const oneMonthBtn = document.querySelector('.time-btn[data-period="1M"]');
  if (oneMonthBtn) {
    if (tab === "growth") {
      oneMonthBtn.style.display = "inline-block";
    } else {
      oneMonthBtn.style.display = "none";
      // If 1M was selected, switch to 3M for other tabs
      if (currentPeriod === "1M") {
        currentPeriod = "3M";
        document.querySelectorAll(".time-btn").forEach((btn) => {
          btn.classList.remove("active");
          if (btn.textContent === "3M") {
            btn.classList.add("active");
          }
        });
      }
    }
  }

  updateChart();
}
function getChartData() {
  // For Portfolio Growth tab, use the daily valuation history
  if (
    currentTab === "growth" &&
    window.portfolioValuationHistory &&
    window.portfolioValuationHistory.length > 0
  ) {
    return getPortfolioGrowthData();
  }

  const now = new Date();
  const periodMonths = getPeriodMonths(currentPeriod);
  const isYearlyPeriod = periodMonths > 12 || periodMonths === Infinity;

  const width = window.innerWidth;
  const isMobile = width <= 500;
  const isTab = width > 500 && width <= 885;

  let aggregationMode = "monthly";
  if (isYearlyPeriod) {
    if (isMobile) aggregationMode = "yearly";
    else if (isTab) aggregationMode = "quarterly";
  }

  // Get hidden folios
  const hiddenFolios = currentUser ? getHiddenFolios(currentUser) : [];

  // Pre-calculate earliest date once
  let earliestDate = now;
  const allTransactions = Object.values(fundWiseData).flatMap((fund) =>
    // Filter transactions from hidden folios
    fund.transactions.filter((tx) => {
      const txFolio = tx.folio || "unknown";
      const uniqueKey = `${txFolio}|${fund.scheme}`;
      return (
        !hiddenFolios.includes(txFolio) && !hiddenFolios.includes(uniqueKey)
      );
    }),
  );

  allTransactions.forEach((tx) => {
    const txDate = new Date(tx.date);
    if (txDate < earliestDate) earliestDate = txDate;
  });

  earliestDate = new Date(
    earliestDate.getFullYear(),
    earliestDate.getMonth(),
    1,
  );
  const endDate = new Date(now.getFullYear(), now.getMonth(), 1);

  // Generate keys (same as before)
  const fullKeys = [];
  const fullData = {};

  if (aggregationMode === "monthly") {
    const current = new Date(earliestDate);
    while (current <= endDate) {
      const key = current.toLocaleDateString("en-IN", {
        year: "2-digit",
        month: "short",
      });
      fullKeys.push(key);
      fullData[key] = { investment: 0, withdrawal: 0, cumulative: 0 };
      current.setMonth(current.getMonth() + 1);
    }
  } else if (aggregationMode === "quarterly") {
    const startYear = earliestDate.getFullYear();
    const startQuarter = Math.floor(earliestDate.getMonth() / 3) + 1;
    const endYear = endDate.getFullYear();
    const endQuarter = Math.floor(endDate.getMonth() / 3) + 1;

    for (let y = startYear; y <= endYear; y++) {
      const qStart = y === startYear ? startQuarter : 1;
      const qEnd = y === endYear ? endQuarter : 4;
      for (let q = qStart; q <= qEnd; q++) {
        const key = `${y} Q${q}`;
        fullKeys.push(key);
        fullData[key] = { investment: 0, withdrawal: 0, cumulative: 0 };
      }
    }
  } else {
    const startYear = earliestDate.getFullYear();
    const endYear = endDate.getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      const key = `${y}`;
      fullKeys.push(key);
      fullData[key] = { investment: 0, withdrawal: 0, cumulative: 0 };
    }
  }

  // Single pass through all transactions
  allTransactions.forEach((tx) => {
    const txDate = new Date(tx.date);
    let key;

    if (aggregationMode === "monthly") {
      key = txDate.toLocaleDateString("en-IN", {
        year: "2-digit",
        month: "short",
      });
    } else if (aggregationMode === "quarterly") {
      const quarter = Math.floor(txDate.getMonth() / 3) + 1;
      key = `${txDate.getFullYear()} Q${quarter}`;
    } else {
      key = txDate.getFullYear().toString();
    }

    if (fullData[key] !== undefined) {
      const amount = parseFloat(tx.nav * tx.units) || 0;
      if (tx.type === "PURCHASE") {
        fullData[key].investment += amount;
      } else if (tx.type === "REDEMPTION") {
        fullData[key].withdrawal += Math.abs(amount);
      }
    }
  });

  // Compute cumulative
  let cumulative = 0;
  fullKeys.forEach((k) => {
    cumulative += (fullData[k].investment || 0) - (fullData[k].withdrawal || 0);
    fullData[k].cumulative = cumulative;
  });

  const currentValue = Object.values(fundWiseData).reduce(
    (sum, fund) => sum + (fund.valuation?.value || 0),
    0,
  );
  fullData[fullKeys[fullKeys.length - 1]].cumulative = currentValue;

  // Filter for selected period
  let expectedKeys;

  if (periodMonths === Infinity) {
    // Show all data
    expectedKeys = fullKeys;
  } else {
    const startDatePeriod = new Date(endDate);
    startDatePeriod.setMonth(startDatePeriod.getMonth() - periodMonths + 1);

    expectedKeys = fullKeys.filter((k) => {
      if (aggregationMode === "yearly") {
        return parseInt(k) >= startDatePeriod.getFullYear();
      } else if (aggregationMode === "quarterly") {
        const [yearStr] = k.split(" Q");
        return parseInt(yearStr) >= startDatePeriod.getFullYear();
      } else {
        const [monthStr, yearStr] = k.split(" ");
        const month = new Date("01 " + monthStr + " 2000").getMonth();
        const year = 2000 + parseInt(yearStr);
        const keyDate = new Date(year, month, 1);
        return keyDate >= startDatePeriod;
      }
    });
  }

  const labels = expectedKeys;
  let values = [];
  if (currentTab === "growth")
    values = labels.map((l) => fullData[l].cumulative);
  else if (currentTab === "investment")
    values = labels.map((l) => fullData[l].investment || 0);
  else if (currentTab === "withdrawal")
    values = labels.map((l) => fullData[l].withdrawal || 0);
  else if (currentTab === "netinvest")
    values = labels.map(
      (l) => (fullData[l].investment || 0) - (fullData[l].withdrawal || 0),
    );

  return { labels, values };
}
function getPortfolioGrowthData() {
  if (
    !window.portfolioValuationHistory ||
    window.portfolioValuationHistory.length === 0
  ) {
    return { labels: [], values: [], costs: [] };
  }

  const periodMonths = getPeriodMonths(currentPeriod);
  const endDate = new Date();

  let filteredData;

  if (periodMonths === Infinity) {
    // Show all data
    filteredData = window.portfolioValuationHistory;
  } else {
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - periodMonths);

    // Filter data for selected period
    filteredData = window.portfolioValuationHistory.filter((item) => {
      const itemDate = new Date(item.date + "T12:00:00"); // Add time to avoid timezone issues
      return itemDate >= startDate && itemDate <= endDate;
    });
  }

  // Use original filtered data for actual calculations
  const dataToUse = filteredData;

  // Ensure we have today's data
  const lastDate = dataToUse[dataToUse.length - 1]?.date;
  const today = new Date().toISOString().split("T")[0];

  if (lastDate !== today) {
    const currentValue = Object.values(fundWiseData).reduce(
      (sum, fund) => sum + (fund.valuation?.value || 0),
      0,
    );

    const lastCost = dataToUse[dataToUse.length - 1]?.cost || 0;

    dataToUse.push({
      date: today,
      value: currentValue,
      cost: lastCost,
      unrealizedGain: currentValue - lastCost,
      unrealizedGainPercent:
        lastCost > 0 ? ((currentValue - lastCost) / lastCost) * 100 : 0,
    });
  }

  // Generate consistent labels - all in "MMM YY" format
  const labels = dataToUse.map((item) => {
    const [year, month, day] = item.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    });
  });

  const values = dataToUse.map((item) => item.value);
  const costs = dataToUse.map((item) => item.cost);

  return { labels, values, costs, rawData: dataToUse };
}
function getPeriods() {
  const periods = new Set();
  const now = new Date();
  let earliestDate = now;

  Object.values(fundWiseData).forEach((fund) => {
    fund.transactions.forEach((tx) => {
      const txDate = new Date(tx.date);
      if (txDate < earliestDate) earliestDate = txDate;
    });
  });

  const monthsDiff = (now - earliestDate) / (1000 * 60 * 60 * 24 * 30);

  if (monthsDiff >= 1) periods.add("1M");
  if (monthsDiff >= 3) periods.add("3M");
  if (monthsDiff >= 6) periods.add("6M");
  if (monthsDiff >= 12) periods.add("1Y");
  if (monthsDiff >= 24) periods.add("2Y");
  if (monthsDiff >= 36) periods.add("3Y");
  if (monthsDiff >= 48) periods.add("4Y");
  if (monthsDiff >= 60) periods.add("5Y");
  if (monthsDiff >= 84) periods.add("7Y");
  if (monthsDiff >= 120) periods.add("10Y");

  periods.add("All");

  const order = [
    "1M",
    "3M",
    "6M",
    "1Y",
    "2Y",
    "3Y",
    "4Y",
    "5Y",
    "7Y",
    "10Y",
    "All",
  ];
  return order.filter((p) => periods.has(p));
}
function getPeriodMonths(period) {
  if (period === "All") return Infinity;

  const map = {
    "1M": 1,
    "3M": 3,
    "6M": 6,
    "1Y": 12,
    "2Y": 24,
    "3Y": 36,
    "4Y": 48,
    "5Y": 60,
    "7Y": 84,
    "10Y": 120,
  };
  return map[period] || 12;
}
function updateStatsForGrowth(data) {
  if (!data.rawData || data.rawData.length === 0) {
    document.getElementById("statsGrid").innerHTML = "";
    return;
  }

  const latest = data.rawData[data.rawData.length - 1];
  const earliest = data.rawData[0];

  const totalGain = latest.value - earliest.value;
  const totalGainPercent =
    earliest.value > 0 ? ((totalGain / earliest.value) * 100).toFixed(2) : 0;

  document.getElementById("statsGrid").innerHTML = `
    <div class="stat-item">
      <h4>Current Value</h4>
      <div class="value">₹${formatNumber(latest.value)}</div>
    </div>
    <div class="stat-item">
      <h4>Current Cost</h4>
      <div class="value">₹${formatNumber(latest.cost)}</div>
    </div>
    <div class="stat-item">
      <h4>Current P&L</h4>
      <div class="value ${
        latest.unrealizedGain >= 0 ? "green" : "red"
      }">₹${formatNumber(Math.abs(latest.unrealizedGain))}</div>
    </div>
    <div class="stat-item">
      <h4>Returns</h4>
      <div class="value ${
        latest.unrealizedGainPercent >= 0 ? "green" : "red"
      }">${latest.unrealizedGainPercent.toFixed(2)}%</div>
    </div>
  `;
}
function createFundValuationChart(fund, fundKey) {
  const dailyValuation = fund.advancedMetrics?.dailyValuation;

  if (!dailyValuation || dailyValuation.length === 0) {
    return '<div style="padding: 10px; text-align: center; color: #9ca3af; font-size: 11px;">No valuation history available</div>';
  }

  const chartId = `fundChart_${fundKey.replace(/\s+/g, "_")}`;
  const containerId = `fundChartContainer_${fundKey.replace(/\s+/g, "_")}`;

  return `
    <div class="folio-stat fund-card-separator-header"><span class="label">Valuation History (All Time): </span><span></span></div>
    <div class="fund-card-separator loading" id="${containerId}" style="padding: 10px 0; height: 120px; position: relative;">
      <canvas id="${chartId}" style="width: 100%; height: 120px;"></canvas>
    </div>
  `;
}

function createFundPerformanceChart(
  fund,
  fundKey,
  extendedData,
  benchmark_returns,
) {
  const chartId = `fundPerfChart_${fundKey.replace(/\s+/g, "_")}`;
  const containerId = `fundPerfChartContainer_${fundKey.replace(/\s+/g, "_")}`;

  const {
    return1y,
    return3y,
    return5y,
    cat_return1y,
    cat_return3y,
    cat_return5y,
  } = extendedData.return_stats || {};

  const index_return1y = benchmark_returns?.["return1y"] ?? null;
  const index_return3y = benchmark_returns?.["return3y"] ?? null;
  const index_return5y = benchmark_returns?.["return5y"] ?? null;

  const valid = [
    return1y,
    return3y,
    return5y,
    cat_return1y,
    cat_return3y,
    cat_return5y,
    index_return1y,
    index_return3y,
    index_return5y,
  ].some((v) => v !== null && v !== undefined);

  if (!valid)
    return '<div style="padding:10px;text-align:center;color:#9ca3af;font-size:11px;">No performance data available</div>';

  extendedData.return_stats = {
    ...extendedData.return_stats,
    index_return1y,
    index_return3y,
    index_return5y,
  };

  return `
    <div class="folio-stat fund-card-separator-header">
      <span class="label">Performance (Fund vs Category vs Benchmark):</span><span></span>
    </div>
    <div class="fund-card-separator loading" id="${containerId}" style="padding: 10px 0; height: 150px; position: relative;">
      <canvas id="${chartId}" style="width:100%;height:150px;"></canvas>
    </div>
  `;
}

function renderFundValuationChart(fundKey, canvasId) {
  const fund = fundWiseData[fundKey];
  const dailyValuation = fund.advancedMetrics?.dailyValuation;

  if (!dailyValuation || dailyValuation.length === 0) return;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const containerId = `fundChartContainer_${fundKey.replace(/\s+/g, "_")}`;
  const container = document.getElementById(containerId);

  const colors = getChartTheme();
  const ctx = canvas.getContext("2d");

  const allData = dailyValuation;
  const labels = allData.map((d) => {
    const date = new Date(d.date);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });

  const values = allData.map((d) => d.value);
  const costs = allData.map((d) => d.cost);

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Value",
          data: values,
          borderColor: "#667eea",
          backgroundColor: "rgba(102, 126, 234, 0.1)",
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Cost",
          data: costs,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.05)",
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 1,
          borderDash: [3, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index", axis: "x" },
      events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
      onClick: (evt, activeEls, chart) => {
        if (!activeEls.length) {
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.update();
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 2,
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 8,
          titleFont: { size: 10 },
          bodyFont: { size: 10 },
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const date = new Date(allData[idx].date);
              return date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              });
            },
            label: (ctx) =>
              ctx.datasetIndex === 0
                ? `Value: ₹${ctx.parsed.y.toLocaleString("en-IN")}`
                : `Cost: ₹${ctx.parsed.y.toLocaleString("en-IN")}`,
          },
        },
      },
      scales: {
        x: {
          display: false,
          grid: { display: false },
          ticks: {
            maxTicksLimit: 5,
            font: { size: 9 },
            color: colors.textColor,
          },
        },
        y: {
          display: true,
          grid: { display: false },
          ticks: {
            font: { size: 9 },
            color: colors.textColor,
            callback: (value) => {
              if (value >= 100000)
                return "₹" + (value / 100000).toFixed(1) + "L";
              if (value >= 1000) return "₹" + (value / 1000).toFixed(0) + "K";
              return "₹" + value;
            },
          },
        },
      },
      animation: {
        duration: 0,
        onComplete: () => {
          canvas.classList.add("chart-ready");
          if (container) container.classList.remove("loading");
        },
      },
    },
  });

  if (window.innerWidth <= 1024) {
    canvas.addEventListener("touchend", function () {
      setTimeout(() => {
        if (chart && chart.tooltip) {
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.update("none");
        }
      }, 100);
    });
  }
}

function renderFundPerformanceChart(canvasId, extendedData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const fundKey = canvasId.replace("fundPerfChart_", "");
  const containerId = `fundPerfChartContainer_${fundKey}`;
  const container = document.getElementById(containerId);

  const colors = getChartTheme();
  const labels = ["1Y", "3Y", "5Y"];
  const safeRound = (val) =>
    typeof val === "number" && !isNaN(val) ? Math.round(val * 100) / 100 : null;

  const stats = extendedData.return_stats || {};
  const fundData = [stats.return1y, stats.return3y, stats.return5y].map(
    safeRound,
  );
  const categoryData = [
    stats.cat_return1y,
    stats.cat_return3y,
    stats.cat_return5y,
  ].map(safeRound);
  const benchmarkData = [
    stats.index_return1y,
    stats.index_return3y,
    stats.index_return5y,
  ].map(safeRound);

  const datasets = [];

  if (fundData.some((v) => v !== null))
    datasets.push({
      label: "Fund",
      data: fundData,
      backgroundColor: "#3b82f6",
      borderRadius: 6,
      barThickness: 14,
    });

  if (categoryData.some((v) => v !== null))
    datasets.push({
      label: "Category",
      data: categoryData,
      backgroundColor: "#10b981",
      borderRadius: 6,
      barThickness: 14,
    });

  if (benchmarkData.some((v) => v !== null))
    datasets.push({
      label: "Benchmark",
      data: benchmarkData,
      backgroundColor: "#f59e0b",
      borderRadius: 6,
      barThickness: 14,
    });

  if (datasets.length === 0) {
    ctx.parentElement.innerHTML =
      '<div style="padding:10px;text-align:center;color:#9ca3af;font-size:11px;">No performance data available</div>';
    if (container) container.classList.remove("loading");
    return;
  }

  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index", axis: "x" },
      events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
      onClick: (evt, activeEls, chart) => {
        if (!activeEls.length) {
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.update();
        }
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            boxWidth: 10,
            font: { size: 9 },
            color: colors.textColor,
          },
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 2,
          titleColor: "#fff",
          bodyColor: "#fff",
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            color: colors.textColor,
          },
        },
        y: {
          beginAtZero: true,
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            color: colors.textColor,
            callback: (val) => `${val}%`,
          },
        },
      },
      animation: {
        duration: 0,
        onComplete: () => {
          ctx.classList.add("chart-ready");
          if (container) container.classList.remove("loading");
        },
      },
    },
  });

  if (window.innerWidth <= 1024) {
    ctx.addEventListener("touchend", function () {
      setTimeout(() => {
        if (chart && chart.tooltip) {
          chart.tooltip.setActiveElements([], { x: 0, y: 0 });
          chart.update("none");
        }
      }, 100);
    });
  }
}

// COMPACT DASHBOARD
function updateCompactDashboard() {
  if (!portfolioData || !fundWiseData) return;

  const summary = calculateSummary();
  const activeFunds = Object.values(fundWiseData).filter(
    (f) => f.advancedMetrics?.currentValue > 0,
  );

  const elements = {
    compactHoldingsCount: document.getElementById("compactHoldingsCount"),
    compactTotalValue: document.getElementById("compactTotalValue"),
    compactInvested: document.getElementById("compactInvested"),
    compactXIRR: document.getElementById("compactXIRR"),
    compactAlpha: document.getElementById("compactAlpha"),
    compactTotalReturns: document.getElementById("compactTotalReturns"),
    compactTotalReturnsPct: document.getElementById("compactTotalReturnsPct"),
    compact1DReturns: document.getElementById("compact1DReturns"),
  };

  const missingEls = Object.entries(elements)
    .filter(([k, v]) => v === null && k !== "compactAlpha")
    .map(([k]) => k);
  if (missingEls.length > 0) {
    console.warn(
      "Compact dashboard elements not found:",
      missingEls.join(", "),
    );
    return;
  }

  const mfValue = summary.currentValue;

  elements.compactHoldingsCount.textContent = activeFunds.length;
  elements.compactTotalValue.textContent = formatNumber(mfValue);

  elements.compactInvested.textContent = "₹" + formatNumber(summary.costPrice);
  elements.compactXIRR.textContent =
    summary.activeXirr !== null ? summary.activeXirr.toFixed(2) + "%" : "--";
  elements.compactXIRR.className =
    "stat-value " + (summary.activeXirr >= 0 ? "positive" : "negative");

  const compactXIRRRow = document.getElementById("compactXIRRRow");
  const compactAlphaRow = document.getElementById("compactAlphaRow");
  if (compactXIRRRow) compactXIRRRow.style.display = isSummaryCAS ? "none" : "";
  if (compactAlphaRow)
    compactAlphaRow.style.display = isSummaryCAS ? "none" : "";

  // Populate 3Y alpha vs Nifty 500
  if (elements.compactAlpha) {
    const benchmarks = getPortfolioBenchmarks();
    const analytics = calculatePortfolioAnalytics();
    const alpha3y = calculatePortfolioAlpha(
      analytics.weightedReturns,
      benchmarks,
    ).vsNifty500.alpha3y;
    if (alpha3y == null || isNaN(alpha3y)) {
      elements.compactAlpha.textContent = "--";
      elements.compactAlpha.className = "stat-value";
    } else {
      const sign = alpha3y >= 0 ? "+" : "";
      elements.compactAlpha.textContent = `${sign}${parseFloat(alpha3y).toFixed(2)}%`;
      elements.compactAlpha.className =
        "stat-value " + (alpha3y >= 0 ? "positive" : "negative");
    }
  }

  // Rebalance grid: last visible row spans full width if total visible count is odd
  const compactStats = document.querySelector(".compact-stats");
  if (compactStats) {
    const visibleRows = Array.from(
      compactStats.querySelectorAll(".compact-stat-row"),
    ).filter((el) => el.style.display !== "none");
    visibleRows.forEach((el, i) => {
      el.classList.toggle(
        "compact-stat-row--full",
        visibleRows.length % 2 !== 0 && i === visibleRows.length - 1,
      );
    });
  }

  const totalReturnPercent =
    summary.totalInvested > 0
      ? ((summary.unrealizedGain / summary.costPrice) * 100).toFixed(2)
      : 0;

  const pnlSign = summary.unrealizedGain >= 0 ? "+" : "-";
  const pnlClass = summary.unrealizedGain >= 0 ? "positive" : "negative";
  elements.compactTotalReturns.textContent = `₹${formatNumber(Math.abs(summary.unrealizedGain))}`;
  elements.compactTotalReturns.className = "stat-value " + pnlClass;
  if (elements.compactTotalReturnsPct) {
    elements.compactTotalReturnsPct.textContent = `(${pnlSign}${Math.abs(totalReturnPercent)}%)`;
    elements.compactTotalReturnsPct.className = "stat-sub " + pnlClass;
  }

  const oneDayReturns = calculateOneDayReturns();
  const odSign = oneDayReturns.value >= 0 ? "▲ " : "▼ ";
  const odClass = oneDayReturns.value >= 0 ? "positive" : "negative";
  elements.compact1DReturns.textContent = `${odSign}${oneDayReturns.text} today`;
  elements.compact1DReturns.className = "compact-1d-change " + odClass;

  // Update the compact header subtitle to show breakdown
  updateCompactHeaderSubtitle(mfValue);

  populateCompactHoldings(activeFunds);
}
function updateCompactPastDashboard() {
  if (!portfolioData || !fundWiseData) return;
  // Summary CAS has no transaction history — past holdings tab not applicable
  if (isSummaryCAS) return;

  const container = document.getElementById("compactPastDashboard");
  if (!container) return;

  // Use fund-level active check: fund is past only if it has no remaining units
  const pastFunds = [];

  Object.entries(fundWiseData).forEach(([fundKey, fund]) => {
    const totalInvested = fund.transactions
      .filter((t) => t.type === "PURCHASE")
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    if (totalInvested === 0) return;

    const fundIsActive = fund.advancedMetrics?.currentValue > 0;
    if (fundIsActive) return; // active funds shown in current holdings, not here

    // Collect all folios for this past fund
    const allFolios = [];
    fund.folios.forEach((folioNum) => {
      const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
      if (!folioSummary) return;

      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return;

      const schemeInFolio = folioData.schemes.find(
        (s) => getFundKey(s) === getFundKey(fund),
      );
      if (!schemeInFolio) return;

      allFolios.push({ folioNum, folioData: schemeInFolio });
    });

    if (allFolios.length > 0) {
      pastFunds.push({ fundKey, fund, folios: allFolios });
    }
  });

  const hasPast = pastFunds.length > 0;

  if (!hasPast) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 20px;">📋</div>
        <h3 style="margin-bottom: 10px; color: var(--text-primary);">No Past Holdings</h3>
        <p style="color: var(--text-tertiary);">You don't have any fully redeemed funds yet.</p>
      </div>
    `;
    return;
  }

  container.style.display = "block";

  // Calculate metrics for each past fund
  const pastFundsWithMetrics = pastFunds.map(({ fundKey, fund, folios }) => {
    const folioNumbers = folios.map((f) => f.folioNum);

    let invested = 0;
    let withdrawn = 0;
    let realizedGain = 0;

    Object.values(fund.advancedMetrics.folioSummaries).forEach(
      (folioSummary) => {
        if (folioNumbers.includes(folioSummary.folio)) {
          invested += folioSummary.invested;
          withdrawn += folioSummary.withdrawn;
          realizedGain += folioSummary.realizedGain;
        }
      },
    );

    return {
      fundKey,
      fund,
      invested,
      withdrawn,
      realizedGain,
    };
  });

  // Calculate totals
  let totalInvested = 0;
  let totalWithdrawn = 0;
  let totalRealizedGain = 0;

  pastFundsWithMetrics.forEach((fundData) => {
    totalInvested += fundData.invested;
    totalWithdrawn += fundData.withdrawn;
    totalRealizedGain += fundData.realizedGain;
  });

  const realizedGainPercent =
    totalInvested > 0
      ? parseFloat((totalRealizedGain / totalInvested) * 100).toFixed(2)
      : 0;

  const totalFunds = pastFunds.length;

  const pastPnlClass = totalRealizedGain >= 0 ? "positive" : "negative";
  const pastPnlSign = totalRealizedGain >= 0 ? "+" : "-";
  container.innerHTML = `
    <div class="compact-summary-card">
      <div class="compact-header">
        <h3>Past holdings · ${totalFunds} funds</h3>
        <h2 class="compact-total-value">₹${formatNumber(totalWithdrawn)}</h2>
        <div class="compact-1d-change" style="color:var(--text-tertiary);">Total withdrawn</div>
      </div>
      <div class="compact-stats">
        <div class="compact-stat-row">
          <span class="stat-label">Invested</span>
          <span class="stat-value">₹${formatNumber(totalInvested)}</span>
        </div>
        <div class="compact-stat-row">
          <span class="stat-label">Realised P&amp;L</span>
          <div class="stat-value-line">
            <span class="stat-value ${pastPnlClass}">₹${formatNumber(Math.abs(totalRealizedGain))}</span>
            <span class="stat-sub ${pastPnlClass}">(${pastPnlSign}${Math.abs(parseFloat(realizedGainPercent).toFixed(2))}%)</span>
          </div>
        </div>
      </div>
    </div>

    <div class="compact-controls past-sort">
      <button class="compact-filter-btn" onclick="toggleCompactPastSort()">
        <i class="fa-solid fa-sort"></i>
        <span>Returns</span>
      </button>
    </div>
  `;

  if (pastFundsWithMetrics.length > 0) {
    container.innerHTML += `
    <div class="compact-holdings-list" id="compactPastFundsList"></div>
  `;
    const pastList = document.getElementById("compactPastFundsList");
    populateCompactPastHoldings(pastFundsWithMetrics, pastList);
  }
}
function updateCompactHeaderSubtitle(mfValue) {
  // Find or create subtitle element in compact dashboard
  const compactHeader = document.querySelector(
    "#compactDashboard .compact-header",
  );
  if (!compactHeader) return;

  // Remove existing subtitle if present
  let subtitle = compactHeader.querySelector(".compact-subtitle");

  if (subtitle) {
    subtitle.remove();
  }
}

function populateCompactHoldings(funds) {
  const list = document.getElementById("compactHoldingsList");
  if (!list) return;
  list.innerHTML = "";

  const fundsWithMetrics = funds.map((fund) => {
    const currentValue = fund.advancedMetrics?.currentValue || 0;
    let xirr = null;

    try {
      const calc = new XIRRCalculator();

      if (fund.advancedMetrics?.folioSummaries) {
        Object.values(fund.advancedMetrics.folioSummaries).forEach(
          (folioSummary) => {
            folioSummary.cashflows.forEach((cf) => {
              calc.addTransaction(cf.type, cf.date, Math.abs(cf.amount));
            });
          },
        );
      }

      if (currentValue > 0) {
        calc.addTransaction(
          "Sell",
          new Date().toISOString().split("T")[0] + "T00:00:00.000Z",
          currentValue,
        );
      }

      if (calc.transactions.length >= 2) {
        xirr = calc.calculateXIRR();
      }
    } catch (e) {
      console.debug("XIRR calculation failed for", fund.scheme, e);
    }

    const oneDayReturn = calculate1DayReturn(fund);
    return {
      ...fund,
      calculatedXIRR: xirr,
      oneDayReturn: oneDayReturn,
    };
  });

  let sortedFunds;
  switch (compactSortMode) {
    case "xirr":
      sortedFunds = [...fundsWithMetrics].sort((a, b) => {
        const xirrA = a.calculatedXIRR ?? -Infinity;
        const xirrB = b.calculatedXIRR ?? -Infinity;
        return xirrB - xirrA;
      });
      break;

    case "abs":
      sortedFunds = [...fundsWithMetrics].sort((a, b) => {
        const absA = a.advancedMetrics?.unrealizedGainPercentage || -Infinity;
        const absB = b.advancedMetrics?.unrealizedGainPercentage || -Infinity;
        return absB - absA;
      });
      break;

    case "1day":
      sortedFunds = [...fundsWithMetrics].sort((a, b) => {
        const returnA = a.oneDayReturn?.percent ?? -Infinity;
        const returnB = b.oneDayReturn?.percent ?? -Infinity;
        return returnB - returnA;
      });
      break;

    case "currentValue":
    default:
      sortedFunds = [...fundsWithMetrics].sort((a, b) => {
        const valueA = a.advancedMetrics?.currentValue || 0;
        const valueB = b.advancedMetrics?.currentValue || 0;
        return valueB - valueA;
      });
      break;
  }

  sortedFunds.forEach((fund) => {
    const currentValue = fund.advancedMetrics?.currentValue || 0;
    const invested = fund.advancedMetrics?.remainingCost || 0;
    const returns = fund.advancedMetrics?.unrealizedGain || 0;
    const returnsPercent = parseFloat(
      fund.advancedMetrics?.unrealizedGainPercentage || 0,
    );
    const isProfit = returns >= 0;

    const xirr = fund.calculatedXIRR;
    const xirrVal = xirr == null || isNaN(xirr) ? 0 : xirr;
    const xirrText = xirrVal === 0 ? "--" : `${parseFloat(xirr.toFixed(2))}%`;

    const returnsSign = returns >= 0 ? "+" : "-";
    const returnsPercentText =
      returnsPercent === 0
        ? "--"
        : `₹${formatNumber(Math.abs(returns))} (${returnsSign}${Math.abs(returnsPercent.toFixed(2))}%)`;

    const oneDayReturn = fund.oneDayReturn;
    const oneDayPositive = !oneDayReturn || oneDayReturn.percent >= 0;
    const odSign = oneDayPositive ? "+" : "-";
    const oneDayText = oneDayReturn
      ? `₹${formatNumber(Math.abs(oneDayReturn.rupees))} (${odSign}${Math.abs(oneDayReturn.percent.toFixed(2))}%)`
      : "--";

    const item = document.createElement("div");
    item.className = "compact-holding-item chi-hero";
    const fundKey = getFundKey(fund);
    item.onclick = () => {
      showFundDetailsModal(fundKey, false);
    };

    item.innerHTML = `
      <div class="chi-accent ${isProfit ? "chi-accent--gain" : "chi-accent--loss"}"></div>
      <div class="chi-body">
        <div class="chi-top">
          <div class="chi-left">
            <div class="chi-name">${fund.schemeDisplay || fund.scheme}</div>
            <div class="chi-stats-line">
              <span class="chi-stat-pill ${oneDayPositive ? "chi-stat-pill--pos" : "chi-stat-pill--neg"}">
                <span class="chi-stat-label">1D</span>
                <span class="chi-stat-value">${oneDayText}</span>
              </span>
              ${
                !isSummaryCAS
                  ? `<span class="chi-stat-pill ${xirrVal < 0 ? "chi-stat-pill--neg" : "chi-stat-pill--pos"}">
                <span class="chi-stat-label">XIRR</span>
                <span class="chi-stat-value">${xirrText}</span>
              </span>`
                  : ""
              }
            </div>
          </div>
          <div class="chi-right">
            <div class="chi-current ${isProfit ? "chi-current--gain" : "chi-current--loss"}">₹${formatNumber(currentValue)}</div>
            <div class="chi-invested">₹${formatNumber(invested)}</div>
            <div class="chi-returns ${isProfit ? "chi-returns--gain" : "chi-returns--loss"}">${returnsPercentText}</div>
          </div>
        </div>
      </div>
      <div class="chi-chevron"><i class="fa-solid fa-chevron-right"></i></div>
    `;

    list.appendChild(item);
  });
}
function populateCompactPastHoldings(fundsWithMetrics, listElement = null) {
  const list =
    listElement || document.getElementById("compactPastHoldingsList");
  if (!list) return;

  list.innerHTML = "";

  if (fundsWithMetrics.length === 0) {
    list.innerHTML =
      '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">No past holdings data available</div>';
    return;
  }

  // Sort based on current mode
  let sortedFunds;
  switch (compactPastSortMode) {
    case "invested":
      sortedFunds = [...fundsWithMetrics].sort(
        (a, b) => b.invested - a.invested,
      );
      break;
    case "returns":
      sortedFunds = [...fundsWithMetrics].sort(
        (a, b) => b.realizedGain - a.realizedGain,
      );
      break;
    case "withdrawn":
    default:
      sortedFunds = [...fundsWithMetrics].sort(
        (a, b) => b.withdrawn - a.withdrawn,
      );
      break;
  }

  sortedFunds.forEach((fundData) => {
    const { fundKey, fund, invested, withdrawn, realizedGain } = fundData;

    const isProfit = realizedGain >= 0;
    const gainSign = isProfit ? "+" : "-";
    const realizedGainPercent =
      invested > 0
        ? parseFloat((realizedGain / invested) * 100).toFixed(2)
        : "0.00";
    const gainText = `₹${formatNumber(Math.abs(realizedGain))} (${gainSign}${Math.abs(realizedGainPercent)}%)`;

    const item = document.createElement("div");
    item.className = "compact-holding-item chi-hero chi-hero--past";
    item.onclick = () => {
      showFundDetailsModal(fundKey, true);
    };

    item.innerHTML = `
      <div class="chi-accent ${isProfit ? "chi-accent--gain" : "chi-accent--loss"}"></div>
      <div class="chi-body">
        <div class="chi-top">
          <div class="chi-left">
            <div class="chi-name">${fund.schemeDisplay || fund.scheme}</div>
            <div class="chi-stats-line">
              <span class="chi-stat-pill ${isProfit ? "chi-stat-pill--pos" : "chi-stat-pill--neg"}">
                <span class="chi-stat-label">P&L</span>
                <span class="chi-stat-value">${gainText}</span>
              </span>
            </div>
          </div>
          <div class="chi-right">
            <div class="chi-current ${isProfit ? "chi-current--gain" : "chi-current--loss"}">₹${formatNumber(withdrawn)}</div>
            <div class="chi-invested">₹${formatNumber(invested)}</div>
          </div>
        </div>
      </div>
    `;

    list.appendChild(item);
  });
}
function toggleCompactXIRR(displayMode) {
  const xirrElements = document.querySelectorAll(".compact-holding-xirr");
  const absElements = document.querySelectorAll(".compact-holding-abs");
  const oneDayElements = document.querySelectorAll(".compact-holding-1day");

  if (displayMode === undefined) {
    if (compactDisplayMode === "xirr") {
      compactDisplayMode = "abs";
    } else if (compactDisplayMode === "abs") {
      compactDisplayMode = "1day";
    } else {
      compactDisplayMode = "xirr";
    }
  } else {
    compactDisplayMode = displayMode;
  }

  xirrElements.forEach((el) => el.classList.add("hidden"));
  absElements.forEach((el) => el.classList.add("hidden"));
  oneDayElements.forEach((el) => el.classList.add("hidden"));

  switch (compactDisplayMode) {
    case "xirr":
      xirrElements.forEach((el) => el.classList.remove("hidden"));
      break;
    case "abs":
      absElements.forEach((el) => el.classList.remove("hidden"));
      break;
    case "1day":
      oneDayElements.forEach((el) => el.classList.remove("hidden"));
      break;
  }

  const toggleBtn = document.querySelector(".compact-sort-btn span");
  if (toggleBtn) {
    switch (compactDisplayMode) {
      case "xirr":
        toggleBtn.textContent = "XIRR %";
        break;
      case "abs":
        toggleBtn.textContent = "Returns %";
        break;
      case "1day":
        toggleBtn.textContent = "1D Returns %";
        break;
    }
  }
}

function toggleCompactSort() {
  let display;
  if (compactSortMode === "currentValue") {
    compactSortMode = "abs";
    display = "abs";
  } else if (compactSortMode === "abs") {
    compactSortMode = "xirr";
    display = "xirr";
  } else if (compactSortMode === "xirr") {
    compactSortMode = "1day";
    display = "1day";
  } else if (compactSortMode === "1day") {
    compactSortMode = "currentValue";
    display = "1day";
  }

  const sortBtn = document.querySelector(".compact-filter-btn");
  if (sortBtn) {
    const btnText = sortBtn.querySelector("span");
    if (btnText) {
      switch (compactSortMode) {
        case "currentValue":
          btnText.textContent = "Current Value";
          break;
        case "xirr":
          btnText.textContent = "XIRR %";
          break;
        case "abs":
          btnText.textContent = "Returns %";
          break;
        case "1day":
          btnText.textContent = "1D Returns %";
          break;
      }
    }
  }

  const activeFunds = Object.values(fundWiseData).filter(
    (f) => f.advancedMetrics?.currentValue > 0,
  );
  populateCompactHoldings(activeFunds);
  toggleCompactXIRR(display);
}
function toggleCompactPastSort() {
  // Cycle through sort modes
  if (compactPastSortMode === "returns") {
    compactPastSortMode = "invested";
  } else if (compactPastSortMode === "invested") {
    compactPastSortMode = "withdrawn";
  } else {
    compactPastSortMode = "returns";
  }

  // Update button text
  const sortBtn = document.querySelector(
    "#compactPastDashboard .compact-filter-btn",
  );
  if (sortBtn) {
    const btnText = sortBtn.querySelector("span");
    if (btnText) {
      switch (compactPastSortMode) {
        case "withdrawn":
          btnText.textContent = "Withdrawn";
          break;
        case "invested":
          btnText.textContent = "Invested";
          break;
        case "returns":
          btnText.textContent = "Returns";
          break;
      }
    }
  }

  // Re-collect past funds (fully exited funds only) with metrics
  const pastFunds = [];

  Object.entries(fundWiseData).forEach(([fundKey, fund]) => {
    const totalInvested = fund.transactions
      .filter((t) => t.type === "PURCHASE")
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    if (totalInvested === 0) return;

    const fundIsActive = fund.advancedMetrics?.currentValue > 0;
    if (fundIsActive) return;

    const allFolios = [];
    fund.folios.forEach((folioNum) => {
      const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
      if (!folioSummary) return;

      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return;

      const schemeInFolio = folioData.schemes.find(
        (s) => getFundKey(s) === getFundKey(fund),
      );

      if (!schemeInFolio) return;

      allFolios.push({ folioNum, folioData: schemeInFolio });
    });

    if (allFolios.length > 0) {
      pastFunds.push({ fundKey, fund, folios: allFolios });
    }
  });

  // Calculate metrics for past funds
  const pastFundsWithMetrics = pastFunds.map(({ fundKey, fund, folios }) => {
    const folioNumbers = folios.map((f) => f.folioNum);
    let invested = 0;
    let withdrawn = 0;
    let realizedGain = 0;

    Object.values(fund.advancedMetrics.folioSummaries).forEach(
      (folioSummary) => {
        if (folioNumbers.includes(folioSummary.folio)) {
          invested += folioSummary.invested;
          withdrawn += folioSummary.withdrawn;
          realizedGain += folioSummary.realizedGain;
        }
      },
    );

    return { fundKey, fund, invested, withdrawn, realizedGain };
  });

  // Re-populate the unified past list with sorted data
  if (pastFundsWithMetrics.length > 0) {
    const pastList = document.getElementById("compactPastFundsList");
    if (pastList) {
      populateCompactPastHoldings(pastFundsWithMetrics, pastList);
    }
  }
}
function calculateOneDayReturns() {
  let totalOneDayChange = 0;
  let totalPreviousDayValue = 0;
  let fundsWithData = 0;

  Object.values(fundWiseData).forEach((fund) => {
    const currentValue = fund.advancedMetrics?.currentValue || 0;
    if (currentValue <= 0) return;

    const oneDayReturn = calculate1DayReturn(fund);
    if (oneDayReturn && oneDayReturn.rupees) {
      totalOneDayChange += oneDayReturn.rupees;
      const previousValue = currentValue - oneDayReturn.rupees;
      totalPreviousDayValue += previousValue;
      fundsWithData++;
    }
  });

  if (fundsWithData === 0 || totalPreviousDayValue === 0) {
    return { text: "₹0 (0%)", value: 0 };
  }

  const percentChange = (totalOneDayChange / totalPreviousDayValue) * 100;

  const odSign = totalOneDayChange >= 0 ? "+" : "-";
  return {
    text: `₹${formatNumber(Math.abs(Math.round(totalOneDayChange)))} (${odSign}${Math.abs(percentChange).toFixed(2)}%)`,
    value: totalOneDayChange,
  };
}
function calculate1DayReturn(fund) {
  const navHistory = fund.navHistory || [];
  const totalUnits = fund.advancedMetrics?.totalUnitsRemaining || 0;

  if (!navHistory || navHistory.length < 2 || totalUnits <= 0) {
    return null;
  }

  const latestNavEntry = navHistory[0];
  const previousNavEntry = navHistory[1];

  if (!latestNavEntry || !previousNavEntry) {
    return null;
  }

  const latestNav = parseFloat(latestNavEntry.nav);
  const previousNav = parseFloat(previousNavEntry.nav);

  if (isNaN(latestNav) || isNaN(previousNav) || previousNav === 0) {
    return null;
  }

  const oneDayReturnPercent = ((latestNav - previousNav) / previousNav) * 100;

  const oneDayReturnRupees = (latestNav - previousNav) * totalUnits;

  return {
    percent: oneDayReturnPercent,
    rupees: oneDayReturnRupees,
    latestNav: latestNav,
    previousNav: previousNav,
    latestDate: latestNavEntry.date,
    previousDate: previousNavEntry.date,
  };
}

// FAMILY DASHBOARD
async function loadFamilyDashboard() {
  const users = storageManager.getAllUsers();

  if (users.length < 2) {
    const container = document.getElementById("familySummaryCards");
    container.innerHTML = `
      <div class="card" style="grid-column: 1 / -1; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 20px;">🔒</div>
        <h3 style="margin-bottom: 10px; color: var(--text-secondary);">Family Dashboard Locked</h3>
        <p style="color: var(text-secondary);">Upload CAS files for at least 2 family members to unlock this feature.</p>
      </div>
    `;

    document.getElementById("familyWeightedReturnsContainer").innerHTML = "";
    document.getElementById("familyUserBreakdown").innerHTML = "";

    const analyticsSection = document.querySelector(
      "#family-dashboard .portfolio-analytics-section",
    );
    if (analyticsSection) analyticsSection.style.display = "none";

    const holdingsSection = document.querySelector(
      "#family-dashboard .folio-section",
    );
    if (holdingsSection) holdingsSection.style.display = "none";

    return;
  }

  const analyticsSection = document.querySelector(
    "#family-dashboard .portfolio-analytics-section",
  );
  if (analyticsSection) analyticsSection.style.display = "block";

  const holdingsSection = document.querySelector(
    "#family-dashboard .folio-section",
  );
  if (holdingsSection) holdingsSection.style.display = "block";

  if (familyDashboardInitialized && familyDashboardCache) {
    displayFamilySummaryCards(familyDashboardCache);
    displayFamilyAnalytics(familyDashboardCache);
    displayFamilyUserBreakdown(familyDashboardCache.userBreakdown);
    updateCompactFamilyDashboard(familyDashboardCache);
    return;
  }

  if (!familyDashboardInitialized) {
    const summaryCards = document.getElementById("familySummaryCards");
    summaryCards.innerHTML = `
      <div class="card" style="grid-column: 1 / -1; text-align: center;">
        <div style="font-size: 24px; color: #667eea;">
          <i class="fa-solid fa-spinner fa-spin"></i> Loading family data...
        </div>
      </div>
    `;
  }

  try {
    const allUserData = {};
    for (const user of users) {
      const data = await storageManager.loadPortfolioData(user);
      if (data) {
        allUserData[user] = data;
      }
    }

    const familyMetrics = calculateFamilyMetrics(allUserData);
    console.log("Family Metrics: ", familyMetrics);

    familyDashboardCache = familyMetrics;
    familyDashboardCacheTimestamp = Date.now();
    familyDashboardInitialized = true;

    displayFamilySummaryCards(familyMetrics);
    displayFamilyAnalytics(familyMetrics);
    displayFamilyUserBreakdown(familyMetrics.userBreakdown);
    updateCompactFamilyDashboard(familyMetrics);
  } catch (err) {
    console.error("Error loading family dashboard:", err);
    showToast("Failed to load family dashboard", "error");
  }
}
function calculateFamilyMetrics(allUserData) {
  const metrics = {
    totalCurrentValue: 0,
    totalCost: 0,
    totalInvested: 0,
    totalWithdrawn: 0,
    totalUnrealizedGain: 0,
    totalHoldings: 0,
    userBreakdown: {},
    combinedFundData: {},
    assetAllocation: {},
    marketCap: { global: 0, large: 0, mid: 0, small: 0 },
    debtDistribution: {},
    sector: {},
    debtSector: {},
    amc: {},
    holdings: {},
    weightedReturns: { return1y: null, return3y: null, return5y: null },
  };

  // Accumulators for family-level 1D change (populated inside the per-user loop below)
  let family1DChange = 0;
  let family1DPrevValue = 0;
  let family1DFundsWithData = 0;

  // Per-user 1D accumulators (keyed by userName, populated inside the loop)
  const user1DChange = {};
  const user1DPrevValue = {};
  const user1DFundsWithData = {};

  Object.entries(allUserData).forEach(
    ([userName, { casData, mfStats: userMfStats }]) => {
      const userFundWiseData = {};

      // Get hidden folios for this user
      const hiddenFolios = getHiddenFolios(userName);

      if (casData.cas_type === "SUMMARY") {
        casData.folios.forEach((folio) => {
          // Skip if folio is hidden
          if (hiddenFolios.includes(folio.folio)) {
            return;
          }
          const key = getFundKey(folio);
          const extendedData = folio.isin ? userMfStats[folio.isin] : null;

          const units = parseFloat(folio.units || 0);
          const cost = parseFloat(folio.cost || 0);
          const latestNav = extendedData?.latest_nav
            ? parseFloat(extendedData.latest_nav)
            : parseFloat(folio.nav || 0);
          const currentValue =
            units > 0 && latestNav > 0
              ? units * latestNav
              : parseFloat(folio.current_value || 0);
          const unrealizedGain = currentValue - cost;

          userFundWiseData[key] = {
            scheme: folio.scheme,
            isin: folio.isin,
            currentValue: currentValue,
            cost: cost,
            unrealizedGain: unrealizedGain,
            units: units,
            holdings: extendedData?.holdings || [],
            navHistory: extendedData?.nav_history || [],
            advancedMetrics: {
              currentValue: currentValue,
              remainingCost: cost,
              unrealizedGain: unrealizedGain,
              totalUnitsRemaining: units,
            },
          };
        });
      } else {
        // Detailed CAS
        casData.folios.forEach((folio) => {
          if (!folio.schemes || !Array.isArray(folio.schemes)) return;

          folio.schemes.forEach((scheme) => {
            const schemeLower = scheme.scheme.toLowerCase();
            if (
              !schemeLower.includes("fund") &&
              !schemeLower.includes("fof") &&
              !schemeLower.includes("etf")
            )
              return;

            if (
              !Array.isArray(scheme.transactions) ||
              scheme.transactions.length === 0
            )
              return;

            // Create unique key for folio + scheme combination
            const uniqueKey = `${folio.folio}|${scheme.scheme}`;

            // Skip if this folio+scheme combination is hidden
            if (hiddenFolios.includes(uniqueKey)) {
              return;
            }

            const key = getFundKey(scheme);
            const extendedData = scheme.isin ? userMfStats[scheme.isin] : null;

            if (!userFundWiseData[key]) {
              userFundWiseData[key] = {
                scheme: scheme.scheme,
                isin: scheme.isin,
                holdings: extendedData?.holdings || [],
                transactions: [],
              };
            }

            const excludedTypes = ["STAMP_DUTY_TAX", "STT_TAX", "MISC"];
            const typeMap = {
              PURCHASE: "PURCHASE",
              PURCHASE_SIP: "PURCHASE",
              SWITCH_IN: "PURCHASE",
              DIVIDEND_REINVEST: "PURCHASE",
              REDEMPTION: "REDEMPTION",
              SWITCH_OUT: "REDEMPTION",
              OTHER: "PURCHASE",
            };

            // Pre-compute a Set of "date|units" keys for SIP Purchase Reversal redemptions.
            // The paired corrective PURCHASE on the same date for the same units must also
            // be excluded — otherwise the re-issued purchase gets double-counted in FIFO.
            const reversalKeys = new Set(
              scheme.transactions
                .filter(
                  (t) =>
                    t.type === "REDEMPTION" &&
                    typeof t.description === "string" &&
                    /reversal/i.test(t.description) &&
                    /sip\s*purchase/i.test(t.description),
                )
                .map((t) => `${t.date}|${parseFloat(t.units || 0)}`),
            );

            const filteredTxns = scheme.transactions
              .filter((t) => {
                if (["STAMP_DUTY_TAX", "STT_TAX", "MISC"].includes(t.type))
                  return false;
                if (t.type === "OTHER") {
                  // Only include OTHER if it has real units and nav (it's a SIP/purchase)
                  const units = parseFloat(t.units || 0);
                  const nav = parseFloat(t.nav || 0);
                  return units > 0 && nav > 0;
                }
                // Skip SIP Purchase Reversal transactions typed as REDEMPTION.
                // These are always paired with a corrective PURCHASE entry that follows,
                // so including them as redemptions would corrupt FIFO cost basis and unit counts.
                if (
                  t.type === "REDEMPTION" &&
                  typeof t.description === "string" &&
                  /reversal/i.test(t.description) &&
                  /sip\s*purchase/i.test(t.description)
                ) {
                  return false;
                }
                // Skip the corrective PURCHASE that was issued alongside a reversal.
                // It shares the same date and unit count as the reversal redemption.
                if (
                  t.type === "PURCHASE" &&
                  reversalKeys.has(`${t.date}|${parseFloat(t.units || 0)}`)
                ) {
                  return false;
                }
                return true;
              })
              .map(({ description, dividend_rate, ...rest }) => ({
                ...rest,
                folio: folio.folio,
                type: typeMap[rest.type] || rest.type,
              }));

            userFundWiseData[key].transactions.push(...filteredTxns);
          });
        });

        Object.keys(userFundWiseData).forEach((key) => {
          const fund = userFundWiseData[key];
          const extendedData = fund.isin ? userMfStats[fund.isin] : null;

          let totalUnits = 0;
          let totalCost = 0;
          const unitQueue = [];

          fund.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

          fund.transactions.forEach((tx) => {
            const units = parseFloat(tx.units || 0);
            const nav = parseFloat(tx.nav || 0);
            const amount = units * nav;

            if (tx.type === "PURCHASE") {
              totalUnits += units;
              totalCost += amount;
              unitQueue.push({ units, nav, amount });
            } else if (tx.type === "REDEMPTION") {
              const unitsToSell = Math.abs(units);
              totalUnits -= unitsToSell;

              let remainingToSell = unitsToSell;
              while (remainingToSell > 0.0001 && unitQueue.length > 0) {
                const batch = unitQueue[0];
                if (batch.units <= remainingToSell + 0.0001) {
                  totalCost -= batch.amount;
                  remainingToSell -= batch.units;
                  unitQueue.shift();
                } else {
                  const costReduction =
                    (remainingToSell / batch.units) * batch.amount;
                  totalCost -= costReduction;
                  batch.units -= remainingToSell;
                  batch.amount -= costReduction;
                  remainingToSell = 0;
                }
              }
            }
          });

          const latestNav = extendedData?.latest_nav
            ? parseFloat(extendedData.latest_nav)
            : 0;
          const currentValue =
            totalUnits > 0.001 && latestNav > 0 ? totalUnits * latestNav : 0;
          const remainingCost = totalUnits > 0.001 ? totalCost : 0;
          const unrealizedGain = currentValue - remainingCost;

          fund.currentValue = currentValue;
          fund.cost = remainingCost;
          fund.unrealizedGain = unrealizedGain;
          fund.units = totalUnits;
          fund.advancedMetrics = {
            currentValue: currentValue,
            remainingCost: remainingCost,
            unrealizedGain: unrealizedGain,
            totalUnitsRemaining: totalUnits,
          };
          fund.navHistory = extendedData?.nav_history || [];
        });
      }

      let userCurrentValue = 0;
      let userCost = 0;
      let userHoldings = 0;

      Object.entries(userFundWiseData).forEach(([fundKey, fund]) => {
        if (fund.currentValue > 0 && fund.units > 0.001) {
          userCurrentValue += fund.currentValue;
          userCost += fund.cost;
          userHoldings++;

          if (!metrics.combinedFundData[fundKey]) {
            metrics.combinedFundData[fundKey] = {
              scheme: fund.scheme,
              isin: fund.isin,
              totalValue: 0,
              totalCost: 0,
              totalUnits: 0,
              holdings: fund.holdings,
              users: [],
            };
          }

          metrics.combinedFundData[fundKey].totalValue += fund.currentValue;
          metrics.combinedFundData[fundKey].totalCost += fund.cost;
          metrics.combinedFundData[fundKey].totalUnits += fund.units;
          metrics.combinedFundData[fundKey].users.push(userName);

          // Accumulate 1D change using navHistory + totalUnitsRemaining already on this fund
          const od = calculate1DayReturn(fund);
          if (od && od.rupees != null) {
            family1DChange += od.rupees;
            family1DPrevValue += fund.currentValue - od.rupees;
            family1DFundsWithData++;
            // Per-user accumulation
            user1DChange[userName] = (user1DChange[userName] || 0) + od.rupees;
            user1DPrevValue[userName] =
              (user1DPrevValue[userName] || 0) +
              (fund.currentValue - od.rupees);
            user1DFundsWithData[userName] =
              (user1DFundsWithData[userName] || 0) + 1;
          }
        }
      });

      const userOD =
        (user1DFundsWithData[userName] || 0) > 0 &&
        (user1DPrevValue[userName] || 0) > 0
          ? {
              rupees: user1DChange[userName],
              percent:
                (user1DChange[userName] / user1DPrevValue[userName]) * 100,
            }
          : null;

      metrics.userBreakdown[userName] = {
        currentValue: userCurrentValue,
        cost: userCost,
        unrealizedGain: userCurrentValue - userCost,
        holdings: userHoldings,
        oneDayChange: userOD,
      };

      metrics.totalCurrentValue += userCurrentValue;
      metrics.totalCost += userCost;
      metrics.totalHoldings += userHoldings;
    },
  );

  metrics.totalUnrealizedGain = metrics.totalCurrentValue - metrics.totalCost;
  metrics.totalHoldings = Object.keys(metrics.combinedFundData).length;
  metrics.total1DChange =
    family1DFundsWithData > 0 && family1DPrevValue > 0
      ? {
          rupees: family1DChange,
          percent: (family1DChange / family1DPrevValue) * 100,
        }
      : null;

  const totalValue = metrics.totalCurrentValue;

  if (totalValue === 0) return metrics;

  Object.entries(metrics.combinedFundData).forEach(([fundKey, fund]) => {
    const weight = fund.totalValue / totalValue;

    let extendedData = null;
    if (fund.isin) {
      for (const userData of Object.values(allUserData)) {
        if (userData.mfStats[fund.isin]) {
          extendedData = userData.mfStats[fund.isin];
          break;
        }
      }
    }

    if (extendedData) {
      const fundAsset = extendedData.portfolio_stats?.asset_allocation;
      let fundDomesticEquity = 0;
      let fundGlobalEquity = 0;
      let fundHedgedEquity = 0;

      if (fundAsset) {
        // Use resolveAssetAllocation: equity split via nature_name=EQUITY +
        // instrument_name; commodities split via instrument_name gold/silver.
        const splits = resolveAssetAllocation(
          fundAsset,
          extendedData?.holdings,
          weight,
        );
        Object.entries(splits).forEach(([label, pct]) => {
          metrics.assetAllocation[label] =
            (metrics.assetAllocation[label] || 0) + pct;
          if (label === "domestic equity") fundDomesticEquity += pct;
          else if (label === "global equity") fundGlobalEquity += pct;
          else if (label === "hedged equity") fundHedgedEquity += pct;
        });
      } else {
        const category = (extendedData.category || "").toLowerCase();
        if (category.includes("equity")) {
          metrics.assetAllocation["domestic equity"] =
            (metrics.assetAllocation["domestic equity"] || 0) + weight * 100;
          fundDomesticEquity += weight * 100;
        } else if (category.includes("debt") || category.includes("income")) {
          metrics.assetAllocation["debt"] =
            (metrics.assetAllocation["debt"] || 0) + weight * 100;
        } else {
          metrics.assetAllocation["other"] =
            (metrics.assetAllocation["other"] || 0) + weight * 100;
        }
      }

      // ── DEBT DISTRIBUTION: group DEBT holdings by instrument_name ──────────
      const debtSplits = resolveDebtDistribution(
        extendedData?.holdings,
        weight,
      );
      Object.entries(debtSplits).forEach(([label, pct]) => {
        metrics.debtDistribution[label] =
          (metrics.debtDistribution[label] || 0) + pct;
      });

      const ps = extendedData.portfolio_stats;
      let l = 0,
        m = 0,
        s = 0,
        capTotal = 0;

      if (
        ps?.large_cap !== undefined ||
        ps?.mid_cap !== undefined ||
        ps?.small_cap !== undefined
      ) {
        l = parseFloat(ps.large_cap || 0);
        m = parseFloat(ps.mid_cap || 0);
        s = parseFloat(ps.small_cap || 0);
        capTotal = l + m + s;
      } else if (ps?.market_cap_per) {
        const mp = ps.market_cap_per;
        l = parseFloat(mp.large || 0);
        m = parseFloat(mp.mid || 0);
        s = parseFloat(mp.small || 0);
        capTotal = l + m + s;
      }

      if (capTotal > 0 && fundDomesticEquity > 0) {
        // l/m/s are % of this fund's domestic equity — scale to family-wide %
        metrics.marketCap.large += (l / capTotal) * fundDomesticEquity;
        metrics.marketCap.mid += (m / capTotal) * fundDomesticEquity;
        metrics.marketCap.small += (s / capTotal) * fundDomesticEquity;
      } else if (fundDomesticEquity > 0) {
        // No cap-size breakdown available — classify by fund name
        const name = (fund.scheme || "").toLowerCase();
        if (name.includes("small") || name.includes("smallcap")) {
          metrics.marketCap.small += fundDomesticEquity;
        } else if (name.includes("mid") || name.includes("midcap")) {
          metrics.marketCap.mid += fundDomesticEquity;
        } else {
          metrics.marketCap.large += fundDomesticEquity;
        }
      }

      // Hedged Equity component
      metrics.marketCap.hedged =
        (metrics.marketCap.hedged || 0) + fundHedgedEquity;

      // Global Equity component
      metrics.marketCap.global += fundGlobalEquity;

      if (
        ps?.equity_sector_per &&
        Object.keys(ps.equity_sector_per).length > 0
      ) {
        Object.entries(ps.equity_sector_per).forEach(([sectorName, pct]) => {
          if (pct == null) return;
          const cleaned = sectorName.trim();
          metrics.sector[cleaned] =
            (metrics.sector[cleaned] || 0) +
            (parseFloat(pct) / 100) * weight * 100;
        });
      } else {
        metrics.sector["Unclassified"] =
          (metrics.sector["Unclassified"] || 0) + weight * 100;
      }

      if (ps?.debt_sector_per && Object.keys(ps.debt_sector_per).length > 0) {
        Object.entries(ps.debt_sector_per).forEach(([sectorName, pct]) => {
          if (pct == null) return;
          const cleaned = sectorName.trim();
          metrics.debtSector[cleaned] =
            (metrics.debtSector[cleaned] || 0) +
            (parseFloat(pct) / 100) * weight * 100;
        });
      }

      const amcName = standardizeTitle(extendedData.amc || "Unknown AMC");
      metrics.amc[amcName] = (metrics.amc[amcName] || 0) + weight * 100;

      if (
        fund.holdings &&
        Array.isArray(fund.holdings) &&
        fund.holdings.length > 0
      ) {
        // Only include EQUITY holdings — debt/cash instruments (Reverse Repo,
        // Net Current Assets, Repo etc.) are already captured in debtDistribution
        // and would cause the holdings total to exceed the portfolio value.
        const equityHoldings = fund.holdings.filter(
          (h) =>
            (h.nature_name || "").toUpperCase() === "EQUITY" &&
            parseFloat(h.corpus_per || 0) > 0,
        );

        // Sum only equity corpus to compute correct portfolio weights
        let equityCorpusTotal = equityHoldings.reduce(
          (sum, h) => sum + parseFloat(h.corpus_per || 0),
          0,
        );

        // Fall back to all holdings if no EQUITY nature tag found
        let holdingsToProcess = equityHoldings;
        if (equityHoldings.length === 0) {
          holdingsToProcess = fund.holdings.filter(
            (h) => parseFloat(h.corpus_per || 0) > 0,
          );
          equityCorpusTotal = holdingsToProcess.reduce(
            (sum, h) => sum + parseFloat(h.corpus_per || 0),
            0,
          );
        }

        // The equity allocation % for this fund (family-wide)
        const fundEquityPct = fundDomesticEquity + fundGlobalEquity;

        holdingsToProcess.forEach((holding) => {
          const companyName = holding.company_name || "Unknown";
          const holdingCorpus = parseFloat(holding.corpus_per || 0);
          if (holdingCorpus <= 0) return;

          // Scale: this holding's share of fund equity × fund's equity portfolio weight
          const portfolioWeight =
            equityCorpusTotal > 0
              ? (holdingCorpus / equityCorpusTotal) * fundEquityPct
              : (holdingCorpus / 100) * weight * 100;

          if (!metrics.holdings[companyName]) {
            metrics.holdings[companyName] = {
              percentage: 0,
              nature: holding.nature_name || "Unknown",
              sector: holding.sector_name || "Unknown",
              instrument: holding.instrument_name || "Unknown",
            };
          }
          metrics.holdings[companyName].percentage += portfolioWeight;
        });
      }

      if (extendedData.return_stats) {
        const rs = extendedData.return_stats;
        const r1 = rs.return1y ?? rs.cat_return1y ?? null;
        const r3 = rs.return3y ?? rs.cat_return3y ?? null;
        const r5 = rs.return5y ?? rs.cat_return5y ?? null;

        if (r1 != null)
          metrics.weightedReturns.return1y =
            (metrics.weightedReturns.return1y || 0) + parseFloat(r1) * weight;
        if (r3 != null)
          metrics.weightedReturns.return3y =
            (metrics.weightedReturns.return3y || 0) + parseFloat(r3) * weight;
        if (r5 != null)
          metrics.weightedReturns.return5y =
            (metrics.weightedReturns.return5y || 0) + parseFloat(r5) * weight;
      }
    }
  });

  const totalAssetPercent = Object.entries(metrics.assetAllocation)
    .filter(([key]) => key !== "_breakdown")
    .reduce((sum, [, val]) => sum + val, 0);

  if (totalAssetPercent > 0 && Math.abs(totalAssetPercent - 100) > 0.01) {
    const scaleFactor = 100 / totalAssetPercent;
    Object.keys(metrics.assetAllocation).forEach((key) => {
      if (key !== "_breakdown") {
        metrics.assetAllocation[key] *= scaleFactor;

        // Scale breakdown too
        if (
          metrics.assetAllocation._breakdown &&
          metrics.assetAllocation._breakdown[key]
        ) {
          metrics.assetAllocation._breakdown[key].mf *= scaleFactor;
          metrics.assetAllocation._breakdown[key].physical *= scaleFactor;
        }
      }
    });
  }

  const mcSum =
    metrics.marketCap.large +
    metrics.marketCap.mid +
    metrics.marketCap.small +
    metrics.marketCap.global +
    (metrics.marketCap.hedged || 0);
  if (mcSum > 0) {
    metrics.marketCap.large = (metrics.marketCap.large / mcSum) * 100;
    metrics.marketCap.mid = (metrics.marketCap.mid / mcSum) * 100;
    metrics.marketCap.small = (metrics.marketCap.small / mcSum) * 100;
    metrics.marketCap.global = (metrics.marketCap.global / mcSum) * 100;
    metrics.marketCap.hedged = ((metrics.marketCap.hedged || 0) / mcSum) * 100;
  }

  const sectorEntries = Object.entries(metrics.sector).sort(
    (a, b) => b[1] - a[1],
  );
  const sectorTop = sectorEntries.slice(0, 10);
  const sectorTopObj = {};
  let sectorOthers = 0;
  sectorEntries.slice(10).forEach(([, v]) => (sectorOthers += v));
  sectorTop.forEach(([k, v]) => (sectorTopObj[k] = v));
  if (sectorOthers > 0) sectorTopObj["Others"] = sectorOthers;
  metrics.sector = sectorTopObj;

  function roundMap(m) {
    const out = {};
    Object.entries(m).forEach(([k, v]) => {
      const rounded = Math.round((v + Number.EPSILON) * 100) / 100;
      if (rounded > 0) {
        out[k] = rounded;
      }
    });
    return out;
  }

  metrics.assetAllocation = roundMap(metrics.assetAllocation);
  metrics.marketCap = roundMap(metrics.marketCap);
  metrics.sector = roundMap(metrics.sector);
  metrics.amc = roundMap(metrics.amc);

  ["return1y", "return3y", "return5y"].forEach((k) => {
    if (metrics.weightedReturns[k] != null) {
      metrics.weightedReturns[k] =
        Math.round((metrics.weightedReturns[k] + Number.EPSILON) * 100) / 100;
    }
  });

  Object.keys(metrics.holdings).forEach((company) => {
    metrics.holdings[company].percentage =
      Math.round(
        (metrics.holdings[company].percentage + Number.EPSILON) * 1000000,
      ) / 1000000;
  });

  return metrics;
}

function displayFamilySummaryCards(metrics) {
  const container = document.getElementById("familySummaryCards");
  if (!container) return;
  const combinedFamilyValue = metrics.totalCurrentValue;

  const unrealizedGainPercent =
    metrics.totalCost > 0
      ? ((metrics.totalUnrealizedGain / metrics.totalCost) * 100).toFixed(2)
      : 0;

  // Build 1D change subtext
  const od = metrics.total1DChange;
  const odSign = od && od.rupees >= 0 ? "+" : "-";
  const odTriangle = od && od.rupees >= 0 ? "▲" : "▼";
  const odClass =
    od && od.rupees >= 0 ? "one-day-subtext--pos" : "one-day-subtext--neg";
  const odSubtextHTML = od
    ? `<span class="one-day-subtext ${odClass}">${odTriangle} ₹${formatNumber(Math.abs(Math.round(od.rupees)))} (${odSign}${Math.abs(od.percent).toFixed(2)}%) today</span>`
    : `<span class="one-day-subtext" style="color:var(--text-tertiary)">Combined Portfolio Value</span>`;

  container.innerHTML = `
      <div class="card">
        <h3>Total Family Value</h3>
        <div class="value">₹${formatNumber(metrics.totalCurrentValue)}</div>
        <div class="subtext">${odSubtextHTML}</div>
      </div>
      <div class="card">
        <h3>Total Cost</h3>
        <div class="value">₹${formatNumber(metrics.totalCost)}</div>
        <div class="subtext">Combined Investment</div>
      </div>
      <div class="card ${
        metrics.totalUnrealizedGain >= 0 ? "positive" : "negative"
      }">
        <h3>Total P&L</h3>
        <div class="value">${
          metrics.totalUnrealizedGain >= 0 ? "₹" : "-₹"
        }${formatNumber(Math.abs(metrics.totalUnrealizedGain))}</div>
        <div class="subtext">Absolute: ${
          metrics.totalUnrealizedGain >= 0 ? "+" : ""
        }${unrealizedGainPercent}%</div>
      </div>
      <div class="card">
        <h3>Total Unique Holdings</h3>
        <div class="value">${metrics.totalHoldings}</div>
        <div class="subtext">Across ${
          Object.keys(metrics.userBreakdown).length
        } Family Members</div>
      </div>
    `;
}
function displayFamilyAnalytics(metrics) {
  window.familyDashboardCache = metrics;

  // If a prior "DATA NOT AVAILABLE" render blanked the AMC wrapper, restore
  // the canvas so buildDoughnutChart has something to render into.
  const familyAmcCard = document.getElementById("familyAmcCard");
  if (familyAmcCard) {
    const amcWrapper = familyAmcCard.querySelector(".chart-wrapper");
    if (amcWrapper && !amcWrapper.querySelector("#familyAmcChart")) {
      amcWrapper.innerHTML =
        '<div class="chart-loading"><div class="chart-spinner"></div></div><canvas id="familyAmcChart"></canvas>';
    }
  }

  setTimeout(() => {
    displayFamilyAssetAllocation(metrics);
    displayFamilyMarketCapSplit(metrics);
    displayFamilyDebtDistribution(metrics);
    displayFamilyDebtSectorSplit(metrics);
  }, 200);

  const nonZeroEntries = Object.entries(metrics.sector).filter(
    ([_, v]) => v > 0,
  );
  const onlyUnclassified =
    nonZeroEntries.length === 1 &&
    nonZeroEntries[0][0].toLowerCase() === "unclassified";

  const sectorCard = document.getElementById("familySectorCard");

  if (onlyUnclassified || nonZeroEntries.length === 0) {
    sectorCard.classList.add("hidden");
  } else {
    sectorCard.classList.remove("hidden");
    const sortedEntries = nonZeroEntries.sort((a, b) => b[1] - a[1]);
    const topSector = sortedEntries.slice(0, 7);
    const restSector = sortedEntries.slice(7);
    const sectorOthers = restSector.reduce((sum, [, v]) => sum + v, 0);
    const sectorLabels = topSector.map(([n]) => n);
    const sectorData = topSector.map(([, v]) => v);
    const [sortedLabels, sortedData] = sortData(sectorLabels, sectorData);
    // Append Others at the end after sorting so it's always last
    if (sectorOthers > 0) {
      sortedLabels.push("Others");
      sortedData.push(sectorOthers);
    }
    // Derive equity rupee total from assetAllocation (source of truth)
    const equityPctFam =
      (metrics.assetAllocation?.["domestic equity"] || 0) +
      (metrics.assetAllocation?.["global equity"] || 0) +
      (metrics.assetAllocation?.["hedged equity"] || 0);
    const sectorRupees = metrics.totalCurrentValue * (equityPctFam / 100);

    // Normalize raw portfolio-wide weights to within-equity percentages
    const rawSumSec = sortedData.reduce((s, v) => s + v, 0);
    const normalisedSec = sortedData.map((v) => (v / rawSumSec) * 100);
    buildDoughnutChart(
      "familySectorChart",
      sortedLabels,
      normalisedSec,
      sectorRupees,
    );
    sectorCard.classList.remove("loading");
  }

  const amcEntries = Object.entries(metrics.amc)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => {
      const shortName = name
        .replace(/mutual\s*fund/gi, "")
        .replace(/\bmf\b/gi, "")
        .trim();
      return [shortName, value];
    });

  if (amcEntries.length > 0) {
    const topAmc = amcEntries.slice(0, 7);
    const restAmc = amcEntries.slice(7);
    const amcOthers = restAmc.reduce((sum, [, v]) => sum + v, 0);
    const amcLabels = topAmc.map(([n]) => n);
    const amcData = topAmc.map(([, v]) => v);
    const [sortedLabels, sortedData] = sortData(amcLabels, amcData);
    // Append Others at the end after sorting so it's always last
    if (amcOthers > 0) {
      sortedLabels.push("Others");
      sortedData.push(amcOthers);
    }
    buildDoughnutChart(
      "familyAmcChart",
      sortedLabels,
      sortedData,
      metrics.totalCurrentValue,
    );
    document.getElementById("familyAmcCard")?.classList.remove("loading");
  } else {
    const amcCard = document.getElementById("familyAmcCard");
    const amcWrapper = amcCard?.querySelector(".chart-wrapper");
    if (amcWrapper) {
      amcWrapper.innerHTML =
        '<p style="text-align: center; color: #9ca3af; padding: 20px;">DATA NOT AVAILABLE</p>';
    }
  }

  displayFamilyHoldingsSplit(metrics);

  displayWeightedReturns(
    metrics.weightedReturns,
    "familyWeightedReturnsContainer",
  );
}

function displayFamilyAssetAllocation(metrics) {
  const preferred = [
    "domestic equity",
    "global equity",
    "hedged equity",
    "debt",
    "gold",
    "silver",
    "real estate",
    "cash",
    "other",
  ];

  const assetLabels = [];
  const assetData = [];

  // Title-case helper for multi-word keys like "domestic equity", "reits"
  const toLabel = (k) => k.replace(/\b\w/g, (c) => c.toUpperCase());

  // Preferred order first
  preferred.forEach((k) => {
    const val = parseFloat(metrics.assetAllocation?.[k]);
    if (!isNaN(val) && val > 0) {
      assetLabels.push(toLabel(k));
      assetData.push(val);
    }
  });

  // Any extra asset types (excluding _breakdown)
  Object.keys(metrics.assetAllocation || {}).forEach((k) => {
    if (!preferred.includes(k) && k !== "_breakdown") {
      const val = parseFloat(metrics.assetAllocation[k]);
      if (!isNaN(val) && val > 0) {
        assetLabels.push(toLabel(k));
        assetData.push(val);
      }
    }
  });

  const assetCard = document.getElementById("familyAssetAllocationCard");
  if (!assetCard) return;

  assetCard.classList.remove("loading");

  const wrapper = assetCard.querySelector(".chart-wrapper");

  if (assetData.length === 0) {
    if (wrapper)
      wrapper.innerHTML =
        '<p style="text-align: center; color: #9ca3af; padding: 20px;">DATA NOT AVAILABLE</p>';
    return;
  }

  if (wrapper && !wrapper.querySelector("#familyAssetAllocationChart")) {
    wrapper.innerHTML = '<canvas id="familyAssetAllocationChart"></canvas>';
  }

  const [sortedLabels, sortedData] = sortData(assetLabels, assetData);

  // Calculate total value
  const users = storageManager.getAllUsers();
  let totalValue = metrics.totalCurrentValue || 0;

  buildDoughnutChart(
    "familyAssetAllocationChart",
    sortedLabels,
    sortedData,
    totalValue,
  );
}

function displayFamilyMarketCapSplit(metrics) {
  const order = [
    { label: "Global Equity", key: "global" },
    { label: "Hedged Equity", key: "hedged" },
    { label: "Large", key: "large" },
    { label: "Mid", key: "mid" },
    { label: "Small", key: "small" },
  ];
  const mcLabels = [];
  const mcData = [];

  order.forEach(({ label, key }) => {
    const val = parseFloat(metrics.marketCap?.[key]);
    if (!isNaN(val) && val > 0) {
      mcLabels.push(label);
      mcData.push(val);
    }
  });

  const mcCard = document.getElementById("familyMarketCapCard");
  if (!mcCard) return;

  const domesticEquityPct = metrics.assetAllocation?.["domestic equity"] || 0;

  if (domesticEquityPct <= 0) {
    mcCard.classList.add("hidden");
    return;
  }

  mcCard.classList.remove("hidden");

  mcCard.classList.remove("loading");

  const wrapper = mcCard.querySelector(".chart-wrapper");

  if (mcData.length === 0) {
    if (wrapper)
      wrapper.innerHTML =
        '<p style="text-align: center; color: #9ca3af; padding: 20px;">DATA NOT AVAILABLE</p>';
    return;
  }

  if (wrapper && !wrapper.querySelector("#familyMarketCapChart")) {
    wrapper.innerHTML = '<canvas id="familyMarketCapChart"></canvas>';
  }

  const [sortedLabels, sortedData] = sortData(mcLabels, mcData);

  // marketCap values already sum to 100 (within-equity %).
  // Derive the equity rupee sub-total from the family asset allocation.
  const equityPct =
    (metrics.assetAllocation?.["domestic equity"] || 0) +
    (metrics.assetAllocation?.["global equity"] || 0) +
    (metrics.assetAllocation?.["hedged equity"] || 0);
  const equityRupees = metrics.totalCurrentValue * (equityPct / 100);

  buildDoughnutChart(
    "familyMarketCapChart",
    sortedLabels,
    sortedData,
    equityRupees,
  );

  applyGroupedMarketCapLegend(
    "familyMarketCapChart",
    sortedLabels,
    sortedData,
    equityRupees,
  );
}

function displayFamilyUserBreakdown(userBreakdown) {
  const container = document.getElementById("familyUserBreakdown");
  if (!container) return;
  container.innerHTML = "";

  const sortedUsers = Object.entries(userBreakdown).sort(
    (a, b) => b[1].currentValue - a[1].currentValue,
  );

  sortedUsers.forEach(([userName, data]) => {
    const gainPercent =
      data.cost > 0 ? ((data.unrealizedGain / data.cost) * 100).toFixed(2) : 0;
    const gainClass = data.unrealizedGain >= 0 ? "gain" : "loss";
    const displayName = getStoredInvestorName(userName).split(" ")[0];

    const card = document.createElement("div");
    card.className = "family-user-card";

    const pnlClass = data.unrealizedGain >= 0 ? "pnl-gain" : "pnl-loss";
    const od = data.oneDayChange;
    const odRowHTML = od
      ? (() => {
          const odSign = od.rupees >= 0 ? "+" : "-";
          const odTriangle = od.rupees >= 0 ? "▲" : "▼";
          const odClass = od.rupees >= 0 ? "gain" : "loss";
          return `
        <div class="family-stat-row oneday-${odClass}">
          <span class="label">1D Change</span>
          <span class="value ${odClass}" style="font-size:11px;">
            ${odTriangle} ₹${formatNumber(Math.abs(Math.round(od.rupees)))}
          </span>
          <span class="sub-value ${odClass}">${odSign}${Math.abs(od.percent).toFixed(2)}%</span>
        </div>`;
        })()
      : "";
    card.innerHTML = `
      <h4>
        <i class="fa-solid fa-user"></i> ${displayName}
        <span class="family-holdings-pill">${data.holdings} fund${data.holdings === 1 ? "" : "s"}</span>
      </h4>
      <div class="family-user-stats">
        <div class="family-stat-row">
          <span class="label">Current Value</span>
          <span class="value">₹${formatNumber(data.currentValue)}</span>
        </div>
        <div class="family-stat-row">
          <span class="label">Invested</span>
          <span class="value">₹${formatNumber(data.cost)}</span>
        </div>
        <div class="family-stat-row ${pnlClass}">
          <span class="label">P&L</span>
          <span class="value ${gainClass}">
            ₹${formatNumber(Math.abs(data.unrealizedGain))}
          </span>
          <span class="sub-value">${data.unrealizedGain >= 0 ? "+" : "-"}${Math.abs(gainPercent)}%</span>
        </div>
        ${odRowHTML}
      </div>
    `;

    container.appendChild(card);
  });
}
function updateCompactFamilyDashboard(metrics) {
  if (!metrics || window.innerWidth > 500) return;

  const container = document.getElementById("compactFamilyDashboard");
  if (!container) return;

  const combinedFamilyValue = metrics.totalCurrentValue;

  const unrealizedGainPercent =
    metrics.totalCost > 0
      ? ((metrics.totalUnrealizedGain / metrics.totalCost) * 100).toFixed(2)
      : 0;

  const displayValue = metrics.totalCurrentValue;

  const familyMemberCount = Object.keys(metrics.userBreakdown).length;
  const pnlSign = metrics.totalUnrealizedGain >= 0 ? "+" : "-";
  const pnlClass = metrics.totalUnrealizedGain >= 0 ? "positive" : "negative";
  const od = metrics.total1DChange;
  const odLine = od
    ? `<div class="compact-1d-change ${od.rupees >= 0 ? "positive" : "negative"}">${od.rupees >= 0 ? "▲ " : "▼ "}₹${formatNumber(Math.abs(Math.round(od.rupees)))} today (${od.rupees >= 0 ? "+" : ""}${od.percent.toFixed(2)}%)</div>`
    : "";

  // Calculate 3Y alpha vs Nifty 500 for family
  let familyAlphaText = "--";
  let familyAlphaClass = "stat-value";
  if (metrics.weightedReturns) {
    const benchmarks = getPortfolioBenchmarks();
    const alpha3y = calculatePortfolioAlpha(metrics.weightedReturns, benchmarks)
      .vsNifty500.alpha3y;
    if (alpha3y != null && !isNaN(alpha3y)) {
      const sign = alpha3y >= 0 ? "+" : "";
      familyAlphaText = `${sign}${parseFloat(alpha3y).toFixed(2)}%`;
      familyAlphaClass =
        "stat-value " + (alpha3y >= 0 ? "positive" : "negative");
    }
  }

  container.innerHTML = `
    <div class="compact-summary-card">
      <div class="compact-header">
        <h3>Family portfolio · ${familyMemberCount} members</h3>
        <h2 class="compact-total-value">₹${formatNumber(displayValue)}</h2>
        ${odLine}
      </div>

      <div class="compact-stats">
        <div class="compact-stat-row">
          <span class="stat-label">Invested</span>
          <span class="stat-value">₹${formatNumber(metrics.totalCost)}</span>
        </div>
        <div class="compact-stat-row">
          <span class="stat-label">Total P&amp;L</span>
          <div class="stat-value-line">
            <span class="stat-value ${pnlClass}">₹${formatNumber(Math.abs(metrics.totalUnrealizedGain))}</span>
            <span class="stat-sub ${pnlClass}">(${pnlSign}${unrealizedGainPercent}%)</span>
          </div>
        </div>
        <div class="compact-stat-row" id="compactFamilyXIRRRow">
          <span class="stat-label">Total Unique Holdings</span>
          <span class="stat-value">${metrics.totalHoldings}</span>
        </div>
        <div class="compact-stat-row" id="compactFamilyAlphaRow">
          <span class="stat-label">Alpha · 3Y vs N500</span>
          <span class="${familyAlphaClass}" id="compactFamilyAlpha">${familyAlphaText}</span>
        </div>
      </div>

      <div class="compact-members" id="compactFamilyBreakdown"></div>
    </div>
  `;

  const breakdownContainer = document.getElementById("compactFamilyBreakdown");
  const sortedUsers = Object.entries(metrics.userBreakdown).sort(
    (a, b) => b[1].currentValue - a[1].currentValue,
  );

  const totalFamilyValue = metrics.totalCurrentValue || 1;

  // Avatar background colours cycling through accent palette
  const avatarStyles = [
    { bg: "rgba(102,126,234,0.15)", color: "#534AB7" },
    { bg: "rgba(16,185,129,0.15)", color: "#065f46" },
    { bg: "rgba(245,158,11,0.15)", color: "#92400e" },
    { bg: "rgba(239,68,68,0.12)", color: "#991b1b" },
    { bg: "rgba(118,75,162,0.15)", color: "#6b21a8" },
  ];

  sortedUsers.forEach(([userName, data], idx) => {
    const gainPercent =
      data.cost > 0 ? ((data.unrealizedGain / data.cost) * 100).toFixed(2) : 0;
    const displayName = getStoredInvestorName(userName).split(" ")[0];
    const initials = displayName.slice(0, 2).toUpperCase();
    const isProfit = data.unrealizedGain >= 0;
    const pnlClass = isProfit ? "positive" : "negative";
    const pnlSign = isProfit ? "+" : "-";
    const barWidth = Math.max(
      4,
      Math.round((data.currentValue / totalFamilyValue) * 100),
    );
    const av = avatarStyles[idx % avatarStyles.length];

    const item = document.createElement("div");
    item.className = "compact-member-row";
    item.innerHTML = `
      <div class="compact-member-avatar" style="background:${av.bg};color:${av.color};">${initials}</div>
      <div class="compact-member-info">
        <div class="compact-member-name">${displayName}</div>
        <div class="compact-member-bar-track">
          <div class="compact-member-bar-fill" style="width:${barWidth}%"></div>
        </div>
      </div>
      <div class="compact-member-value">
        <div class="compact-member-amt">₹${formatNumber(data.currentValue)}</div>
        <div class="compact-member-pnl ${pnlClass}">${pnlSign}${Math.abs(gainPercent)}%</div>
      </div>
    `;
    breakdownContainer.appendChild(item);
  });
}
function invalidateFamilyDashboardCache() {
  familyDashboardCache = null;
  familyDashboardCacheTimestamp = null;
  familyDashboardInitialized = false;
  toggleFamilyDashboard();
}

// USER MANAGEMENT
function setDataManagementButtons(hasUsers) {
  const ids = [
    "deleteAllUsersBtn",
    "updateNavBtn",
    "updateStatsBtn",
    "clearCacheBtn",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === "deleteAllUsersBtn") {
      el.style.display = hasUsers ? "" : "none";
    } else {
      el.disabled = !hasUsers;
    }
  });
}

function initializeUserManagement() {
  const users = storageManager.getAllUsers();
  allUsers = users;

  const container = document.getElementById("userListContainer");

  if (users.length > 0) {
    const lastUser = localStorage.getItem("lastActiveUser");
    if (lastUser && users.includes(lastUser)) {
      currentUser = lastUser;
    } else {
      currentUser = users[0];
    }

    populateUserList(users);

    updateCurrentUserDisplay();

    toggleFamilyDashboard();
    return true;
  } else {
    if (container) {
      container.innerHTML =
        '<div style="text-align: right; padding: 20px; color: var(--text-tertiary); font-size:12px">No users found. Upload a CAS file to get started.</div>';
    }

    setDataManagementButtons(false);

    const display = document.getElementById("currentUserDisplay");
    if (display) {
      display.style.display = "none";
    }

    return false;
  }
}

function populateUserList(users) {
  const container = document.getElementById("userListContainer");
  if (!container) {
    console.warn("userListContainer not found");
    return;
  }

  container.innerHTML = "";

  if (users.length === 0) {
    container.innerHTML =
      '<div style="text-align: right; padding: 20px; color: var(--text-tertiary); font-size:12px">No users found. Upload a CAS file to get started.</div>';
    setDataManagementButtons(false);
    return;
  }

  setDataManagementButtons(true);

  users.forEach((user) => {
    const investorName = getStoredInvestorName(user);
    const isActive = user === currentUser;

    const userItem = document.createElement("div");
    userItem.className = `user-item ${isActive ? "active" : ""}`;

    userItem.onclick = (e) => {
      if (
        e.target.closest(".user-item-delete") ||
        e.target.closest(".user-item-settings")
      )
        return;
      switchToUser(user);
    };

    userItem.innerHTML = `
      <div class="user-item-info">
        <div class="user-item-name">${investorName}</div>
        <div class="user-item-email">${user}</div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="user-item-settings" onclick="event.stopPropagation(); showFolioManagementModal('${user}')" title="Manage Folios">
          <i class="fa-solid fa-gear"></i>
        </button>
        <button class="user-item-delete" onclick="event.stopPropagation(); deleteSingleUser('${user}')" title="Delete User">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    container.appendChild(userItem);
  });
}

// Resets the URL hash to #main before a reload, so the user lands on the
// main tab instead of restoring whatever tab was active before the reload
// (which may no longer be valid/relevant after a user switch, delete, or
// data import).
function resetHashToMain() {
  if (window.location.hash && window.location.hash !== "#main") {
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + "#main",
    );
  }
}

function switchToUser(userName) {
  if (!userName || userName === currentUser) return;

  const investorName = getStoredInvestorName(userName);
  const confirmSwitch = confirm(`Switch to user: ${investorName}?`);
  if (!confirmSwitch) return;

  currentUser = userName;
  localStorage.setItem("lastActiveUser", currentUser);

  console.log("Switching to user:", userName);

  showSimpleSplash(`Switching to ${investorName}…`);

  toggleFamilyDashboard();

  // Reset the hash so the reload lands on #main for the newly switched-to
  // user, rather than restoring whatever tab the previous user was on.
  resetHashToMain();

  setTimeout(() => {
    location.reload();
  }, 500);
}
function populateUserSelector(users) {
  const selector = document.getElementById("userSelector");

  users.forEach((user) => {
    const option = document.createElement("option");
    option.value = user;
    option.textContent = user;
    selector.appendChild(option);
  });
}
async function deleteSingleUser(userName) {
  if (!userName) {
    showToast("No user specified", "warning");
    return;
  }

  const investorName = getStoredInvestorName(userName);
  const confirmDelete = confirm(
    `Are you sure you want to delete user "${investorName}" and all their data? This cannot be undone.`,
  );

  if (!confirmDelete) return;

  showSimpleSplash("Deleting user…");

  try {
    const wasCurrentUser = userName === currentUser;

    await storageManager.deleteUser(userName);

    const hiddenFoliosKey = `hiddenFolios_${userName}`;
    localStorage.removeItem(hiddenFoliosKey);
    console.log(`🗑️ Cleared hidden folios for deleted user: ${userName}`);

    const investorNameKey = `investorName_${userName}`;
    localStorage.removeItem(investorNameKey);
    console.log(`🗑️ Cleared investor name for deleted user: ${userName}`);

    allUsers = storageManager.getAllUsers();

    // If deleted user was current user, switch to another user
    if (wasCurrentUser) {
      if (allUsers.length > 0) {
        currentUser = allUsers[0];
        localStorage.setItem("lastActiveUser", currentUser);

        // Load the new current user's data BEFORE updating UI
        const stored = await storageManager.loadPortfolioData(currentUser);

        if (stored) {
          portfolioData = stored.casData;
          mfStats = stored.mfStats;
          isSummaryCAS = portfolioData.cas_type === "SUMMARY";

          console.log(`🔄 Switched to user: ${currentUser}`);
        }
      } else {
        currentUser = null;
        localStorage.removeItem("lastActiveUser");
        portfolioData = null;
        mfStats = {};
      }
    }

    populateUserList(allUsers);
    updateCurrentUserDisplay();

    toggleFamilyDashboard();
    invalidateFamilyDashboardCache();

    // Reload if current user was deleted
    if (wasCurrentUser || allUsers.length === 0) {
      if (currentUser) {
        showSimpleSplash(`Switching to ${getStoredInvestorName(currentUser)}…`);
      } else {
        showSimpleSplash("Reloading…");
      }
      showToast(`User ${investorName} deleted successfully`, "success");
      resetHashToMain();
      setTimeout(() => {
        location.reload();
      }, 1000);
    } else {
      setTimeout(() => {
        hideSimpleSplash();
      }, 1000);
      showToast(`User ${investorName} deleted successfully`, "success");
    }
  } catch (err) {
    hideSimpleSplash();
    console.error("Error deleting user:", err);
    showToast("Failed to delete user", "error");
  }
}
async function deleteAllUsers() {
  if (allUsers.length === 0) {
    showToast("No users to delete", "info");
    return;
  }

  const confirmDelete = confirm(
    `⚠️ WARNING: This will delete ALL users (${allUsers.length}) and ALL their data permanently.\n\nThis action CANNOT be undone!\n\nAre you absolutely sure?`,
  );

  if (!confirmDelete) return;

  const doubleConfirm = confirm(
    "This is your last chance!\n\nClick OK to permanently delete all user data.",
  );

  if (!doubleConfirm) return;

  showSimpleSplash("Deleting all users…");

  try {
    await storageManager.deleteAllUsers();

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("hiddenFolios_")) {
        keysToRemove.push(key);
      }

      if (key && key.startsWith("investorName_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    console.log(
      `🗑️ Cleared hidden folios, and investor names for all users (${keysToRemove.length} entries)`,
    );

    hideSimpleSplash();
    showToast("All users deleted...", "success");

    invalidateFamilyDashboardCache();

    showSimpleSplash("Reloading…");
    resetHashToMain();
    setTimeout(() => {
      location.reload();
    }, 500);
  } catch (err) {
    hideSimpleSplash();
    console.error("Error deleting all users:", err);
    showToast("Failed to delete all users: " + err.message, "error");
  }
}
async function clearAllCacheAndReload() {
  const confirmed = confirm(
    "⚠️ This will permanently wipe ALL local data:\n\n" +
      "  • localStorage\n" +
      "  • sessionStorage\n" +
      "  • IndexedDB\n" +
      "  • Cache Storage (PWA / service worker caches)\n" +
      "  • Cookies for this domain\n" +
      "  • Service Worker registrations\n\n" +
      "The page will hard-reload afterwards.\n\nContinue?",
  );
  if (!confirmed) return;

  showSimpleSplash("Clearing all data…");

  try {
    // 1. localStorage
    localStorage.clear();
    console.log("🗑️ localStorage cleared");

    // 2. sessionStorage
    sessionStorage.clear();
    console.log("🗑️ sessionStorage cleared");

    // 3. IndexedDB — delete every database the browser knows about
    if (indexedDB?.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map(
          (db) =>
            new Promise((resolve, reject) => {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = resolve;
              req.onerror = reject;
              req.onblocked = resolve; // don't hang if blocked
            }),
        ),
      );
      console.log(`🗑️ IndexedDB: deleted ${dbs.length} database(s)`);
    } else {
      // Fallback: try to delete the known app DB by name
      indexedDB.deleteDatabase("myMFDashboard");
      console.log("🗑️ IndexedDB: deleted myMFDashboard (fallback)");
    }

    // 4. Cache Storage
    if (window.caches) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      console.log(`🗑️ Cache Storage: deleted ${cacheNames.length} cache(s)`);
    }

    // 5. Cookies for this domain
    document.cookie.split(";").forEach((cookie) => {
      const name = cookie.split("=")[0].trim();
      // Expire on root path and current path
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${window.location.pathname}`;
    });
    console.log("🗑️ Cookies cleared");

    // 6. Service Worker registrations
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
      console.log(`🗑️ Service Workers: unregistered ${registrations.length}`);
    }

    console.log("✅ All cache cleared — hard reloading");
    // Hard reload bypassing cache (also strip any #hash so we land on #main)
    window.location.href =
      window.location.href.split("?")[0].split("#")[0] +
      "?nocache=" +
      Date.now();
  } catch (err) {
    hideSimpleSplash();
    console.error("❌ Clear cache error:", err);
    showToast("Cache clear failed: " + err.message, "error");
  }
}

// ── Backup Export ────────────────────────────────────────────────────────────

async function exportBackup() {
  const users = storageManager.getAllUsers();
  if (users.length === 0) {
    showToast("No data to export — upload a CAS first.", "warning");
    return;
  }

  showSimpleSplash("Preparing backup…");
  try {
    await storageManager.downloadBackup();
    hideSimpleSplash();
    showToast("Backup downloaded successfully!", "success");
  } catch (err) {
    hideSimpleSplash();
    console.error("Export backup error:", err);
    showToast("Export failed: " + err.message, "error");
  }
}

// ── Backup Import ────────────────────────────────────────────────────────────

function importBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";

  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmed = confirm(
      `⚠️ Importing a backup will merge data into the current app.\n\nExisting data for matching users will be overwritten.\n\nContinue with "${file.name}"?`,
    );
    if (!confirmed) return;

    showSimpleSplash("Importing backup…");
    try {
      await storageManager.importBackupFile(file);
      hideSimpleSplash();
      showToast("Backup imported! Reloading…", "success");
      resetHashToMain();
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      hideSimpleSplash();
      console.error("Import backup error:", err);
      showToast("Import failed: " + err.message, "error");
    }
  };

  input.click();
}

function updateCurrentUserDisplay() {
  if (!currentUser) {
    const display = document.getElementById("currentUserDisplay");
    if (display) {
      display.style.display = "none";
    }
    return;
  }

  console.log("Current User:", currentUser);

  const display = document.getElementById("currentUserDisplay");
  if (display) {
    const investorName = getStoredInvestorName(currentUser);
    display.textContent = `Current User: ${investorName}`;
    display.style.display = "block";
  }

  const allUserItems = document.querySelectorAll(".user-item");

  if (allUserItems.length === 0) {
    console.warn("No user items found in DOM");
    return;
  }

  allUserItems.forEach((item) => {
    const userNameElement = item.querySelector(".user-item-email");
    if (!userNameElement) return;

    const userName = userNameElement.textContent.trim();

    if (userName === currentUser) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
}
function getStoredInvestorName(userName) {
  const toProperCase = (str) =>
    str.replace(
      /\w\S*/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );

  const stored = localStorage.getItem(`investorName_${userName}`);
  const raw = stored || userName.replace(/_\d+$/, "");
  return toProperCase(raw);
}

// FOLIO MANAGEMENT
function getHiddenFolios(userName) {
  const key = `hiddenFolios_${userName}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
}

function saveHiddenFolios(userName, hiddenFolios) {
  const key = `hiddenFolios_${userName}`;
  localStorage.setItem(key, JSON.stringify(hiddenFolios));
}

function isFolioHidden(userName, folioNumber) {
  const hiddenFolios = getHiddenFolios(userName);
  return hiddenFolios.includes(folioNumber);
}

function toggleFolioInPending(userName, folioNumber) {
  if (!pendingFolioChanges[userName]) {
    pendingFolioChanges[userName] = getHiddenFolios(userName);
  }

  const index = pendingFolioChanges[userName].indexOf(folioNumber);

  if (index > -1) {
    // Currently hidden, show it
    pendingFolioChanges[userName].splice(index, 1);
  } else {
    // Currently visible, hide it
    pendingFolioChanges[userName].push(folioNumber);
  }

  // Update UI - only toggle the switch, not the parent item
  const toggleSwitch = document.querySelector(`[data-folio="${folioNumber}"]`);
  if (toggleSwitch) {
    const isHidden = pendingFolioChanges[userName].includes(folioNumber);
    if (isHidden) {
      toggleSwitch.classList.remove("active");
      // Don't add 'hidden' class to parent
    } else {
      toggleSwitch.classList.add("active");
      // Don't remove 'hidden' class from parent
    }
  }
}

function toggleAllFoliosInAMC(userName, amcName, category) {
  if (!pendingFolioChanges[userName]) {
    pendingFolioChanges[userName] = getHiddenFolios(userName);
  }

  // Find the specific AMC group by both AMC name and category
  const amcGroups = document.querySelectorAll(".amc-group");
  let amcGroup = null;

  amcGroups.forEach((group) => {
    const bulkToggle = group.querySelector(".amc-bulk-toggle-switch");
    if (
      bulkToggle &&
      bulkToggle.dataset.amc === amcName &&
      bulkToggle.dataset.category === category
    ) {
      amcGroup = group;
    }
  });

  if (!amcGroup) return;

  const folioSwitches = amcGroup.querySelectorAll(".folio-toggle-switch");

  // Check if all are currently active
  let allActive = true;
  folioSwitches.forEach((toggle) => {
    const folioKey = toggle.dataset.folio;
    if (pendingFolioChanges[userName].includes(folioKey)) {
      allActive = false;
    }
  });

  // Toggle all folios in this AMC
  folioSwitches.forEach((toggle) => {
    const folioKey = toggle.dataset.folio;
    const isCurrentlyHidden = pendingFolioChanges[userName].includes(folioKey);

    if (allActive) {
      // Hide all
      if (!isCurrentlyHidden) {
        pendingFolioChanges[userName].push(folioKey);
        toggle.classList.remove("active");
        toggle.closest(".folio-toggle-item").classList.add("will-hide");
      }
    } else {
      // Show all
      if (isCurrentlyHidden) {
        const index = pendingFolioChanges[userName].indexOf(folioKey);
        pendingFolioChanges[userName].splice(index, 1);
        toggle.classList.add("active");
        toggle.closest(".folio-toggle-item").classList.remove("will-hide");
      }
    }
  });

  // Update bulk toggle button appearance
  const bulkToggle = amcGroup.querySelector(".amc-bulk-toggle-switch");

  // Check new state - if any folio is hidden, mark bulk toggle as inactive
  let anyHidden = false;
  folioSwitches.forEach((toggle) => {
    const folioKey = toggle.dataset.folio;
    if (pendingFolioChanges[userName].includes(folioKey)) {
      anyHidden = true;
    }
  });

  if (anyHidden) {
    bulkToggle.classList.remove("active");
  } else {
    bulkToggle.classList.add("active");
  }
}

function saveFolioChanges(userName) {
  if (!pendingFolioChanges[userName]) {
    closeFolioManagementModal();
    return;
  }

  saveHiddenFolios(userName, pendingFolioChanges[userName]);

  showToast("Folio changes saved!", "success");

  closeFolioManagementModal();

  // If current user, reload portfolio
  if (userName === currentUser) {
    resetHashToMain();
    setTimeout(() => {
      location.reload();
    }, 500);
  }
}

function showFolioManagementModal(userName) {
  lockBodyScroll();

  pendingFolioChanges = {};

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "folioManagementModal";

  modal.innerHTML = `
    <div class="folio-management-modal">
      <div class="modal-header">
        <h2><i class="fa-solid fa-gear"></i> Manage Folios - ${getStoredInvestorName(
          userName,
        )}</h2>
        <button class="modal-close" onclick="closeFolioManagementModal()">✕</button>
      </div>
      <div class="folio-management-content" id="folioManagementContent">
        <div style="text-align: center; padding: 40px;">
          <div class="chart-spinner"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary-btn" onclick="closeFolioManagementModal()">Cancel</button>
        <button class="primary-btn" onclick="saveFolioChanges('${userName}')">
          <i class="fa-solid fa-save"></i> Save Changes
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.innerWidth <= 1024) {
    initializeModalSwipe(modal);
  }

  // Load folio data
  loadFolioManagementData(userName);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFolioManagementModal();
  });
}

function closeFolioManagementModal() {
  const modal = document.getElementById("folioManagementModal");
  if (modal) {
    modal.remove();
  }
  unlockBodyScroll();
  pendingFolioChanges = {};
}

async function loadFolioManagementData(userName) {
  const content = document.getElementById("folioManagementContent");

  try {
    const stored = await storageManager.loadPortfolioData(userName);

    if (!stored) {
      content.innerHTML = `
        <div class="folio-management-empty">
          <i class="fa-solid fa-folder-open"></i>
          <p>No data found for this user</p>
        </div>
      `;
      return;
    }

    const casData = stored.casData;
    const mfStatsUser = stored.mfStats;
    const hiddenFolios = getHiddenFolios(userName);

    // Initialize pending changes with current state
    pendingFolioChanges[userName] = [...hiddenFolios];

    // Group folios by AMC and fund
    const activeFoliosByAMC = {};
    const pastFoliosByAMC = {};

    casData.folios.forEach((folio) => {
      if (casData.cas_type === "SUMMARY") {
        const totalValue = parseFloat(folio.current_value || 0);
        const extendedData = folio.isin ? mfStatsUser[folio.isin] : null;
        const fundDisplayName = sanitizeSchemeName(folio.scheme);

        const amcName =
          extendedData?.amc?.trim() || folio.amc?.trim() || "Unknown AMC";

        const folioInfo = {
          folioNumber: folio.folio,
          amc: amcName,
          fundName: fundDisplayName,
          value: totalValue,
          isHidden: hiddenFolios.includes(folio.folio),
        };

        if (totalValue > 0) {
          if (!activeFoliosByAMC[amcName]) activeFoliosByAMC[amcName] = [];
          activeFoliosByAMC[amcName].push(folioInfo);
        } else {
          if (!pastFoliosByAMC[amcName]) pastFoliosByAMC[amcName] = [];
          pastFoliosByAMC[amcName].push(folioInfo);
        }
      } else {
        // Detailed CAS - handle multiple schemes per folio
        if (folio.schemes && Array.isArray(folio.schemes)) {
          folio.schemes.forEach((scheme) => {
            const schemeLower = scheme.scheme.toLowerCase();
            if (
              !schemeLower.includes("fund") &&
              !schemeLower.includes("fof") &&
              !schemeLower.includes("etf")
            )
              return;

            if (
              !Array.isArray(scheme.transactions) ||
              scheme.transactions.length === 0
            )
              return;

            // Skip schemes with no real PURCHASE activity (e.g. segregated
            // portfolio spin-offs whose only transactions are "OTHER" unit
            // transfers) — mirrors the totalInvested filter used to build
            // the Current/Past Holdings tabs.
            const hasPurchase = scheme.transactions.some(
              (t) => t.type === "PURCHASE",
            );
            if (!hasPurchase) return;

            const schemeValue = scheme.valuation
              ? parseFloat(scheme.valuation.value || 0)
              : 0;
            const fundDisplayName = sanitizeSchemeName(scheme.scheme);
            const extendedData = scheme.isin ? mfStatsUser[scheme.isin] : null;

            const amcName =
              extendedData?.amc?.trim() ||
              scheme.amc?.trim() ||
              folio.amc?.trim() ||
              "Unknown AMC";

            const uniqueKey = `${folio.folio}|${scheme.scheme}`;

            const folioInfo = {
              folioNumber: folio.folio,
              uniqueKey: uniqueKey,
              amc: amcName,
              fundName: fundDisplayName,
              value: schemeValue,
              isHidden: hiddenFolios.includes(uniqueKey),
            };

            // A folio belongs to "current" if the fund (any folio of same scheme)
            // has active units anywhere — mirrors how updateFundBreakdown works.
            // Only send to "past" if the entire fund is fully exited.
            const fundHasActiveUnits = casData.folios.some((f) =>
              f.schemes.some(
                (s) =>
                  getFundKey(s) === getFundKey(scheme) &&
                  parseFloat(s.valuation?.value || 0) > 0,
              ),
            );

            if (fundHasActiveUnits) {
              if (!activeFoliosByAMC[amcName]) activeFoliosByAMC[amcName] = [];
              activeFoliosByAMC[amcName].push(folioInfo);
            } else {
              if (!pastFoliosByAMC[amcName]) pastFoliosByAMC[amcName] = [];
              pastFoliosByAMC[amcName].push(folioInfo);
            }
          });
        }
      }
    });

    // Sort AMCs by total value
    const sortedActiveAMCs = Object.keys(activeFoliosByAMC).sort((a, b) => {
      const totalA = activeFoliosByAMC[a].reduce((sum, f) => sum + f.value, 0);
      const totalB = activeFoliosByAMC[b].reduce((sum, f) => sum + f.value, 0);
      return totalB - totalA;
    });

    const sortedPastAMCs = Object.keys(pastFoliosByAMC).sort();

    // Sort folios within each AMC by value (descending)
    sortedActiveAMCs.forEach((amc) => {
      activeFoliosByAMC[amc].sort((a, b) => b.value - a.value);
    });

    let html = "";

    if (sortedActiveAMCs.length > 0) {
      const totalCurrentFolios = sortedActiveAMCs.reduce(
        (sum, amc) => sum + activeFoliosByAMC[amc].length,
        0,
      );
      const totalCurrentValue = sortedActiveAMCs.reduce(
        (sum, amc) =>
          sum + activeFoliosByAMC[amc].reduce((s, f) => s + f.value, 0),
        0,
      );

      html += `
      <div class="folio-category collapsible-section">
        <div class="folio-category-header" onclick="toggleFolioSection('currentHoldings')">
          <div class="folio-category-title">
            <i class="fa-solid fa-briefcase"></i>
            <h4>Current Holdings</h4>
            <span class="folio-count-badge">${totalCurrentFolios} Holdings • ₹${formatNumber(
              totalCurrentValue,
            )}</span>
          </div>
          <i class="fa-solid fa-chevron-down collapse-icon rotated" id="currentHoldingsIcon"></i>
        </div>
        <div class="folio-category-content" id="currentHoldingsContent">
      `;

      sortedActiveAMCs.forEach((amc) => {
        const folios = activeFoliosByAMC[amc];
        const totalValue = folios.reduce((sum, f) => sum + f.value, 0);

        html += `
        <div class="amc-group" data-category="current">
          <div class="amc-group-header">
            <div class="amc-header-left">
              <span class="amc-name">${standardizeTitle(amc)}</span>
              <span class="amc-total">₹${formatNumber(totalValue)}</span>
            </div>
            <div class="amc-bulk-toggle-switch active" 
                 data-amc="${amc.replace(/"/g, "&quot;")}"
                 data-category="current"
                 onclick="event.stopPropagation(); toggleAllFoliosInAMC('${userName}', '${amc.replace(
                   /'/g,
                   "\\'",
                 )}', 'current')">
            </div>
          </div>
          <div class="amc-folios">
      `;

        folios.forEach((folio) => {
          const folioKey = folio.uniqueKey || folio.folioNumber;
          html += `
          <div class="folio-toggle-item ${folio.isHidden ? "will-hide" : ""}">
            <div class="folio-toggle-info">
              <div class="folio-toggle-name">${folio.fundName}</div>
              <div class="folio-toggle-meta">${
                folio.folioNumber
              } • ₹${formatNumber(folio.value)}</div>
            </div>
            <div class="folio-toggle-switch ${!folio.isHidden ? "active" : ""}" 
                 data-folio="${folioKey}"
                 onclick="toggleFolioInPending('${userName}', '${folioKey}')">
            </div>
          </div>
        `;
        });

        html += `
          </div>
        </div>
      `;
      });

      html += `
        </div>
      </div>
      `;
    }

    if (sortedPastAMCs.length > 0) {
      const totalPastFolios = sortedPastAMCs.reduce(
        (sum, amc) => sum + pastFoliosByAMC[amc].length,
        0,
      );

      html += `
      <div class="folio-category collapsible-section">
        <div class="folio-category-header" onclick="toggleFolioSection('pastHoldings')">
          <div class="folio-category-title">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <h4>Past Holdings</h4>
            <span class="folio-count-badge">${totalPastFolios} Holdings • Fully Redeemed</span>
          </div>
          <i class="fa-solid fa-chevron-down collapse-icon" id="pastHoldingsIcon"></i>
        </div>
        <div class="folio-category-content collapsed" id="pastHoldingsContent">
      `;

      sortedPastAMCs.forEach((amc) => {
        const folios = pastFoliosByAMC[amc];

        html += `
        <div class="amc-group" data-category="past">
          <div class="amc-group-header">
            <div class="amc-header-left">
              <span class="amc-name">${standardizeTitle(amc)}</span>
              <span class="amc-total">Fully Redeemed</span>
            </div>
            <div class="amc-bulk-toggle-switch active" 
                 data-amc="${amc.replace(/"/g, "&quot;")}"
                 data-category="past"
                 onclick="event.stopPropagation(); toggleAllFoliosInAMC('${userName}', '${amc.replace(
                   /'/g,
                   "\\'",
                 )}', 'past')">
            </div>
          </div>
          <div class="amc-folios">
      `;

        folios.forEach((folio) => {
          const folioKey = folio.uniqueKey || folio.folioNumber;
          html += `
          <div class="folio-toggle-item ${folio.isHidden ? "will-hide" : ""}">
            <div class="folio-toggle-info">
              <div class="folio-toggle-name">${folio.fundName}</div>
              <div class="folio-toggle-meta">${folio.folioNumber}</div>
            </div>
            <div class="folio-toggle-switch ${!folio.isHidden ? "active" : ""}" 
                 data-folio="${folioKey}"
                 onclick="toggleFolioInPending('${userName}', '${folioKey}')">
            </div>
          </div>
        `;
        });

        html += `
          </div>
        </div>
      `;
      });

      html += `
        </div>
      </div>
      `;
    }

    if (sortedActiveAMCs.length === 0 && sortedPastAMCs.length === 0) {
      html = `
        <div class="folio-management-empty">
          <i class="fa-solid fa-folder-open"></i>
          <p>No folios found for this user</p>
        </div>
      `;
    }

    setTimeout(() => {
      document
        .querySelectorAll(".amc-bulk-toggle-switch")
        .forEach((bulkToggle) => {
          const amcGroup = bulkToggle.closest(".amc-group");
          const folioSwitches = amcGroup.querySelectorAll(
            ".folio-toggle-switch",
          );

          let anyHidden = false;
          folioSwitches.forEach((toggle) => {
            if (!toggle.classList.contains("active")) {
              anyHidden = true;
            }
          });

          if (anyHidden) {
            bulkToggle.classList.remove("active");
          } else {
            bulkToggle.classList.add("active");
          }
        });
    }, 100);

    content.innerHTML = html;
  } catch (err) {
    console.error("Error loading folio data:", err);
    content.innerHTML = `
      <div class="folio-management-empty">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p style="color: var(--danger);">Error loading folio data</p>
      </div>
    `;
  }
}

function toggleFolioSection(sectionId) {
  const content = document.getElementById(`${sectionId}Content`);
  const icon = document.getElementById(`${sectionId}Icon`);

  if (!content || !icon) return;

  content.classList.toggle("collapsed");
  icon.classList.toggle("rotated");
}

// TAX PLANNING
function displayTaxPlanning() {
  const container = document.getElementById("taxPlanningContent");
  if (!container) return;

  if (isSummaryCAS) {
    container.innerHTML = `
      <div class="tax-planning-container">
        <div class="section-header">
          <h3>📊 Tax Planning</h3>
          <p class="section-subtitle">Not available for Summary CAS</p>
        </div>
        <p class="no-data">Tax planning features require a Detailed CAS with transaction history.</p>
      </div>
    `;
    return;
  }

  const taxData = calculateTaxPlanningData();
  let html = `
    <div class="tax-planning-container">
      <div class="section-header">
        <h3>📊 Tax Planning Dashboard</h3>
        <p class="section-subtitle">Optimize your tax liability with strategic holding management</p>
      </div>

      <div class="tax-summary-cards">
        <div class="tax-summary-card">
          <h4>Long-Term Holdings</h4>
          <div class="tax-summary-value">₹${formatNumber(
            taxData.ltHoldings.totalValue,
          )}</div>
          <div class="tax-summary-subtext">${
            taxData.ltHoldings.count
          } funds • ${taxData.ltHoldings.percentage.toFixed(
            1,
          )}% of portfolio</div>
        </div>

        <div class="tax-summary-card">
          <h4>Short-Term Holdings</h4>
          <div class="tax-summary-value">₹${formatNumber(
            taxData.stHoldings.totalValue,
          )}</div>
          <div class="tax-summary-subtext">${
            taxData.stHoldings.count
          } funds • ${taxData.stHoldings.percentage.toFixed(
            1,
          )}% of portfolio</div>
        </div>

        <div class="tax-summary-card">
          <h4>Unrealized LTCG</h4>
          <div class="tax-summary-value ${
            taxData.unrealizedLTCG >= 0 ? "gain" : "loss"
          }">
  ${taxData.unrealizedLTCG >= 0 ? "₹" : "-₹"}${formatNumber(
    Math.abs(taxData.unrealizedLTCG),
  )}
        </div>
                <div class="tax-summary-subtext">Tax liability: ~₹${formatNumber(
                  Math.abs(taxData.ltcgTaxLiability),
                )}</div>
                </div>

                <div class="tax-summary-card">
        <h4>Unrealized STCG</h4>
        <div class="tax-summary-value ${
          taxData.unrealizedSTCG >= 0 ? "gain" : "loss"
        }">
    ${taxData.unrealizedSTCG >= 0 ? "₹" : "-₹"}${formatNumber(
      Math.abs(taxData.unrealizedSTCG),
    )}
  </div>
  <div class="tax-summary-subtext" style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
    ${
      taxData.stcgEquityAmount !== 0
        ? `<div>Equity: <span class="${
            taxData.stcgEquityAmount >= 0 ? "gain" : "loss"
          }">${taxData.stcgEquityAmount >= 0 ? "+" : "-"}₹${formatNumber(
            Math.abs(taxData.stcgEquityAmount),
          )}</span> (Tax: ${
            taxData.stcgEquityAmount > 0
              ? "~₹" + formatNumber(Math.round(taxData.stcgEquityTax))
              : "₹0"
          })</div>`
        : ""
    }
    ${
      taxData.stcgDebtAmount !== 0
        ? `<div>Debt: <span class="${
            taxData.stcgDebtAmount >= 0 ? "gain" : "loss"
          }">${taxData.stcgDebtAmount >= 0 ? "+" : ""}₹${formatNumber(
            Math.abs(taxData.stcgDebtAmount),
          )}</span> (As per slab)</div>`
        : ""
    }
    ${
      taxData.stcgEquityAmount === 0 && taxData.stcgDebtAmount === 0
        ? "<div>No short-term holdings</div>"
        : ""
    }
  </div>
</div>
      </div>
  `;

  // Long-Term Holdings Section
  html += `
    <div class="holdings-split-section">
      <div class="holdings-split-header" onclick="toggleHoldingsSplit('longTerm')">
        <div class="holdings-split-title">
          <i class="fa-solid fa-chart-line"></i>
          <h4>Long-Term Holdings (${taxData.ltHoldings.count})</h4>
        </div>
        <div class="holdings-split-summary">
          <div class="holdings-split-stat">
            <span class="label">Total Value</span>
            <span class="value">₹${formatNumber(
              taxData.ltHoldings.totalValue,
            )}</span>
          </div>
          <div class="holdings-split-stat">
            <span class="label">Unrealized Gain</span>
            <span class="value ${
              taxData.unrealizedLTCG >= 0 ? "gain" : "loss"
            }">
  ${taxData.unrealizedLTCG >= 0 ? "+₹" : "-₹"}${formatNumber(
    Math.abs(taxData.unrealizedLTCG),
  )}
</span>
          </div>
          <i class="fa-solid fa-chevron-down collapse-icon" id="longTermIcon"></i>
        </div>
      </div>
      <div class="holdings-split-content collapsed" id="longTermContent">
  `;

  taxData.ltHoldings.funds.forEach((fund, idx) => {
    const gainPercent =
      fund.cost > 0 ? ((fund.unrealizedGain / fund.cost) * 100).toFixed(2) : 0;
    const itemId = `ltHolding_${idx}`;

    let folioDetailRows = "";
    if (fund.batchDetails && fund.batchDetails.length > 0) {
      folioDetailRows = fund.batchDetails
        .map((bd) => {
          const bdValue = bd.units * (fund.currentValue / fund.units);
          const folioDisplay = bd.folio.split("/")[0].trim();
          const purchaseDateStr = bd.purchaseDate.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          });
          return `<tr>
          <td>${folioDisplay}</td>
          <td>${bd.units.toFixed(3)}</td>
          <td>₹${formatNumber(bdValue)}</td>
          <td>${purchaseDateStr}</td>
          <td>${bd.holdingDays}D</td>
        </tr>`;
        })
        .join("");
    }

    html += `
    <div class="tax-holding-wrap">
      <div class="tax-holding-item" id="${itemId}" onclick="toggleTaxHoldingItem('${itemId}')">
        <div class="tax-holding-info">
          <div class="tax-holding-name">${fund.name}</div>
          <div class="tax-holding-meta">
            <span class="tp-holding-meta-pill tp-pill-taxcat tp-pill-taxcat--${fund.taxCategory || "equity"}">${fund.taxCategory ? fund.taxCategory.charAt(0).toUpperCase() + fund.taxCategory.slice(1) : "Equity"}</span>
            <span class="tp-holding-meta-pill tp-pill-days">${fund.avgHoldingDays}d avg</span>
            <span class="tp-holding-meta-pill tp-pill-units">${fund.units.toFixed(3)} units</span>
            <span class="tp-holding-meta-pill tp-pill-units">Cost ₹${formatNumber(fund.cost)}</span>
          </div>
        </div>
        <div class="tax-holding-values">
          <div class="tax-holding-value">₹${formatNumber(fund.currentValue)}</div>
          <div class="tax-holding-percentage ${fund.unrealizedGain >= 0 ? "gain" : "loss"}">
            ${fund.unrealizedGain >= 0 ? "+₹" : "-₹"}${formatNumber(Math.abs(fund.unrealizedGain))} 
            (${fund.unrealizedGain >= 0 ? "+" : ""}${gainPercent}%)
          </div>
        </div>
        <i class="fa-solid fa-chevron-down tax-holding-chevron"></i>
      </div>
      <div class="tax-holding-detail" id="${itemId}_detail">
        <table class="tax-holding-detail-table">
          <colgroup><col><col><col><col><col></colgroup><thead><tr><th>Folio</th><th>Units</th><th>Value</th><th>Purchase</th><th>Held</th></tr></thead>
          <tbody>${folioDetailRows}</tbody>
        </table>
      </div>
    </div>
  `;
  });
  html += `
      </div>
    </div>
  `;

  // Short-Term Holdings Section
  html += `
    <div class="holdings-split-section">
      <div class="holdings-split-header" onclick="toggleHoldingsSplit('shortTerm')">
        <div class="holdings-split-title">
          <i class="fa-solid fa-clock"></i>
          <h4>Short-Term Holdings (${taxData.stHoldings.count})</h4>
        </div>
        <div class="holdings-split-summary">
          <div class="holdings-split-stat">
            <span class="label">Total Value</span>
            <span class="value">₹${formatNumber(
              taxData.stHoldings.totalValue,
            )}</span>
          </div>
          <div class="holdings-split-stat">
            <span class="label">Unrealized Gain</span>
            <span class="value ${
              taxData.unrealizedSTCG >= 0 ? "gain" : "loss"
            }">
  ${taxData.unrealizedSTCG >= 0 ? "+₹" : "-₹"}${formatNumber(
    Math.abs(taxData.unrealizedSTCG),
  )}
</span>
          </div>
          <i class="fa-solid fa-chevron-down collapse-icon" id="shortTermIcon"></i>
        </div>
      </div>
      <div class="holdings-split-content collapsed" id="shortTermContent">
  `;

  taxData.stHoldings.funds.forEach((fund, idx) => {
    const gainPercent =
      fund.cost > 0 ? ((fund.unrealizedGain / fund.cost) * 100).toFixed(2) : 0;
    const itemId = `stHolding_${idx}`;

    let folioDetailRows = "";
    if (fund.batchDetails && fund.batchDetails.length > 0) {
      folioDetailRows = fund.batchDetails
        .map((bd) => {
          const bdValue = bd.units * (fund.currentValue / fund.units);
          const folioDisplay = bd.folio.split("/")[0].trim();
          const purchaseDateStr = bd.purchaseDate.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          });
          return `<tr>
          <td>${folioDisplay}</td>
          <td>${bd.units.toFixed(3)}</td>
          <td>₹${formatNumber(bdValue)}</td>
          <td>${purchaseDateStr}</td>
          <td>${bd.holdingDays}D</td>
        </tr>`;
        })
        .join("");
    }

    html += `
    <div class="tax-holding-wrap">
      <div class="tax-holding-item" id="${itemId}" onclick="toggleTaxHoldingItem('${itemId}')">
        <div class="tax-holding-info">
          <div class="tax-holding-name">${fund.name}</div>
          <div class="tax-holding-meta">
            <span class="tp-holding-meta-pill tp-pill-taxcat tp-pill-taxcat--${fund.taxCategory || "equity"}">${fund.taxCategory ? fund.taxCategory.charAt(0).toUpperCase() + fund.taxCategory.slice(1) : "Equity"}</span>
            <span class="tp-holding-meta-pill tp-pill-days">${fund.avgHoldingDays}d avg</span>
            <span class="tp-holding-meta-pill tp-pill-units">${fund.units.toFixed(3)} units</span>
            <span class="tp-holding-meta-pill tp-pill-units">Cost ₹${formatNumber(fund.cost)}</span>
          </div>
        </div>
        <div class="tax-holding-values">
          <div class="tax-holding-value">₹${formatNumber(fund.currentValue)}</div>
          <div class="tax-holding-percentage ${fund.unrealizedGain >= 0 ? "gain" : "loss"}">
            ${fund.unrealizedGain >= 0 ? "+₹" : "-₹"}${formatNumber(Math.abs(fund.unrealizedGain))} 
            (${fund.unrealizedGain >= 0 ? "+" : ""}${gainPercent}%)
          </div>
        </div>
        <i class="fa-solid fa-chevron-down tax-holding-chevron"></i>
      </div>
      <div class="tax-holding-detail" id="${itemId}_detail">
        <table class="tax-holding-detail-table">
          <colgroup><col><col><col><col><col></colgroup><thead><tr><th>Folio</th><th>Units</th><th>Value</th><th>Purchase</th><th>Held</th></tr></thead>
          <tbody>${folioDetailRows}</tbody>
        </table>
      </div>
    </div>
  `;
  });

  html += `
      </div>
    </div>
  `;

  // Current Tax Rates Section
  html += `
    <div class="tax-rates-section">
      <div class="tax-rates-header">
        <span class="tax-rates-icon">📋</span>
        <span class="tax-rates-title">Current Tax Rates</span>
      </div>
      <div class="tax-rates-table-wrapper">
        <table class="tax-rates-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>STCG (Short-Term)</th>
              <th>LTCG (Long-Term)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Equity Funds</strong> <span class="tax-rates-sub">(≥65% equity)</span></td>
              <td data-label="STCG">20% (flat)</td>
              <td data-label="LTCG">12.5% on gains above ₹1.25L <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
            <tr>
              <td><strong>Hybrid Funds</strong> <span class="tax-rates-sub">(Equity-oriented, ≥65% equity)</span></td>
              <td data-label="STCG">20% (flat)</td>
              <td data-label="LTCG">12.5% on gains above ₹1.25L <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
            <tr>
              <td><strong>Debt / Specified Funds</strong> <span class="tax-rates-sub">(Post 1 Apr 2023)</span></td>
              <td data-label="STCG">Taxed at slab rates <span class="tax-rates-sub">(any period)</span></td>
              <td data-label="LTCG">No LTCG benefit - taxed at slab rates</td>
            </tr>
            <tr>
              <td><strong>Debt Funds</strong> <span class="tax-rates-sub">(Pre-1 Apr 2023)</span></td>
              <td data-label="STCG">≤ 24 months: Taxed at slab rates</td>
              <td data-label="LTCG">&gt; 24 months: 12.5% <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
            <tr>
              <td><strong>ELSS Funds</strong></td>
              <td data-label="STCG">Not applicable <span class="tax-rates-sub">(3-year lock-in)</span></td>
              <td data-label="LTCG">&gt; 36 months: 12.5% on gains above ₹1.25L <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
            <tr>
              <td><strong>Gold ETFs / Silver ETFs</strong> <span class="tax-rates-sub">(Listed)</span></td>
              <td data-label="STCG">≤ 12 months: Taxed at slab rates</td>
              <td data-label="LTCG">&gt; 12 months: 12.5% <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
            <tr>
              <td><strong>Gold Mutual Funds / Gold FoFs</strong></td>
              <td data-label="STCG">≤ 24 months: Taxed at slab rates</td>
              <td data-label="LTCG">&gt; 24 months: 12.5% <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
            <tr>
              <td><strong>International Funds / FoFs</strong></td>
              <td data-label="STCG">≤ 24 months: Taxed at slab rates</td>
              <td data-label="LTCG">&gt; 24 months: 12.5% <span class="tax-rates-sub">(no indexation)</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="tax-rates-notes">
        <p>• Rates exclude surcharge &amp; cess.</p>
        <p>• ₹1.25 lakh annual exemption applies only to equity-oriented funds (Section 112A).</p>
        <p>• Hybrid funds with &lt;65% equity are taxed like debt/international funds.</p>
        <p>• Use FIFO for SIP redemptions and always verify the purchase date and fund classification.</p>
        <p>• Hold equity funds for at least 1 year to benefit from lower LTCG tax rates.</p>
        <p>• Consider booking LTCG up to ₹1.25L annually to use the tax-free limit.</p>
        <p>• Plan redemptions to minimize tax impact by timing them strategically.</p>
      </div>
    </div>
  `;

  // Disclaimer
  html += `
    <div class="tax-disclaimer">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>Tax calculations are estimates only and should not be considered professional advice; please verify the results independently before making financial decisions.</span>
    </div>
  `;

  html += `</div>`;

  container.innerHTML = html;
}

function groupBatchesByFolioDate(batches) {
  const map = {};
  batches.forEach((b) => {
    const dateKey = b.purchaseDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `${b.folio}__${dateKey}`;
    if (!map[key]) {
      map[key] = {
        folio: b.folio,
        units: 0,
        purchaseDate: b.purchaseDate,
        holdingDays: b.holdingDays,
      };
    }
    map[key].units += b.units;
    // holdingDays will be the same for same date; keep as-is
  });
  return Object.values(map).sort((a, b) => b.holdingDays - a.holdingDays);
}

function calculateTaxPlanningData() {
  const data = {
    ltHoldings: { funds: [], totalValue: 0, count: 0, percentage: 0 },
    stHoldings: { funds: [], totalValue: 0, count: 0, percentage: 0 },
    unrealizedLTCG: 0,
    unrealizedSTCG: 0,
    ltcgTaxLiability: 0,
    stcgTaxLiability: 0,
    stcgEquityAmount: 0,
    stcgDebtAmount: 0,
    stcgEquityTax: 0,
  };

  let totalPortfolioValue = 0;
  const today = new Date();

  Object.entries(fundWiseData).forEach(([fundKey, fund]) => {
    const currentValue = fund.advancedMetrics?.currentValue || 0;
    if (currentValue <= 0) return;

    totalPortfolioValue += currentValue;

    // Determine holding period threshold using unified tax category logic
    const extendedData = fund.isin ? mfStats[fund.isin] : null;
    const taxCat = getTaxCategory(extendedData, fund);
    const threshold = taxCat === "equity" ? 365 : 730;
    const isEquityOriented = taxCat === "equity";
    const equityPercentage = isEquityOriented ? 100 : 0;
    const latestNav = fund.valuation?.nav || 0;

    // Split units into LT and ST based on actual holding period
    let ltUnits = 0;
    let ltCost = 0;
    let stUnits = 0;
    let stCost = 0;
    let ltTotalHoldingDays = 0;
    let stTotalHoldingDays = 0;

    // Per-batch lists for expandable detail rows (one row per SIP/purchase batch)
    const ltBatchList = [];
    const stBatchList = [];

    // Get remaining units from FIFO queue
    const folioSummaries = fund.advancedMetrics?.folioSummaries || {};

    Object.values(folioSummaries).forEach((folioSummary) => {
      // Reconstruct unit queue for this folio
      const transactions = fund.transactions
        .filter((tx) => tx.folio === folioSummary.folio)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      const unitQueue = [];

      transactions.forEach((tx) => {
        const units = parseFloat(tx.units || 0);
        const nav = parseFloat(tx.nav || 0);

        if (tx.type === "PURCHASE" && units > 0 && nav > 0) {
          unitQueue.push({
            units: units,
            nav: nav,
            purchaseDate: new Date(tx.date),
          });
        } else if (tx.type === "REDEMPTION") {
          let unitsToSell = Math.abs(units);
          while (unitsToSell > 0.0001 && unitQueue.length > 0) {
            const batch = unitQueue[0];
            if (batch.units <= unitsToSell + 0.0001) {
              unitsToSell -= batch.units;
              unitQueue.shift();
            } else {
              batch.units -= unitsToSell;
              unitsToSell = 0;
            }
          }
        }
      });

      // Now classify remaining units
      unitQueue.forEach((batch) => {
        const holdingDays = Math.floor(
          (today - batch.purchaseDate) / (1000 * 60 * 60 * 24),
        );
        const batchCost = batch.units * batch.nav;
        const folioNum = folioSummary.folio;

        if (holdingDays >= threshold) {
          ltUnits += batch.units;
          ltCost += batchCost;
          ltTotalHoldingDays += holdingDays * batch.units;
          ltBatchList.push({
            folio: folioNum,
            units: batch.units,
            nav: batch.nav,
            purchaseDate: batch.purchaseDate,
            holdingDays,
          });
        } else {
          stUnits += batch.units;
          stCost += batchCost;
          stTotalHoldingDays += holdingDays * batch.units;
          stBatchList.push({
            folio: folioNum,
            units: batch.units,
            nav: batch.nav,
            purchaseDate: batch.purchaseDate,
            holdingDays,
          });
        }
      });
    });

    // Create separate entries for LT and ST portions
    if (ltUnits > 0.001) {
      const ltValue = ltUnits * latestNav;
      const ltGain = ltValue - ltCost;
      const ltAvgHolding =
        ltUnits > 0 ? Math.round(ltTotalHoldingDays / ltUnits) : 0;

      data.ltHoldings.funds.push({
        name: fund.schemeDisplay || fund.scheme,
        currentValue: ltValue,
        cost: ltCost,
        unrealizedGain: ltGain,
        avgHoldingDays: ltAvgHolding,
        equityPercentage: equityPercentage,
        isEquityOriented: isEquityOriented,
        taxCategory: taxCat,
        units: ltUnits,
        batchDetails: groupBatchesByFolioDate(ltBatchList),
      });

      data.ltHoldings.totalValue += ltValue;
      data.ltHoldings.count++;
      data.unrealizedLTCG += ltGain;
    }

    if (stUnits > 0.001) {
      const stValue = stUnits * latestNav;
      const stGain = stValue - stCost;
      const stAvgHolding =
        stUnits > 0 ? Math.round(stTotalHoldingDays / stUnits) : 0;

      data.stHoldings.funds.push({
        name: fund.schemeDisplay || fund.scheme,
        currentValue: stValue,
        cost: stCost,
        unrealizedGain: stGain,
        avgHoldingDays: stAvgHolding,
        equityPercentage: equityPercentage,
        isEquityOriented: isEquityOriented,
        taxCategory: taxCat,
        units: stUnits,
        batchDetails: groupBatchesByFolioDate(stBatchList),
      });

      data.stHoldings.totalValue += stValue;
      data.stHoldings.count++;
      data.unrealizedSTCG += stGain;

      if (isEquityOriented) {
        data.stcgEquityAmount += stGain;
      } else {
        data.stcgDebtAmount += stGain;
      }
    }
  });

  // Calculate percentages
  if (totalPortfolioValue > 0) {
    data.ltHoldings.percentage =
      (data.ltHoldings.totalValue / totalPortfolioValue) * 100;
    data.stHoldings.percentage =
      (data.stHoldings.totalValue / totalPortfolioValue) * 100;
  }

  // Sort by value descending
  data.ltHoldings.funds.sort((a, b) => b.currentValue - a.currentValue);
  data.stHoldings.funds.sort((a, b) => b.currentValue - a.currentValue);

  // Calculate tax liabilities
  if (data.unrealizedLTCG > 0) {
    const ltcgTaxableGain = Math.max(0, data.unrealizedLTCG - 125000);
    data.ltcgTaxLiability = ltcgTaxableGain * 0.125;
  } else {
    data.ltcgTaxLiability = 0;
  }

  // UPDATED: Calculate STCG tax more accurately
  if (data.stcgEquityAmount > 0) {
    data.stcgEquityTax = data.stcgEquityAmount * 0.2; // 20% for equity
  }

  // Debt STCG is at slab rate, so we can't calculate exact tax
  // Keep the old stcgTaxLiability as indicative for total
  if (data.unrealizedSTCG > 0) {
    data.stcgTaxLiability = data.stcgEquityTax; // Only show equity portion as calculablel̥
  } else {
    data.stcgTaxLiability = 0;
  }

  return data;
}

function toggleHoldingsSplit(section) {
  const content = document.getElementById(`${section}Content`);
  const icon = document.getElementById(`${section}Icon`);

  if (!content || !icon) return;

  if (content.classList.contains("collapsed")) {
    content.style.maxHeight = content.scrollHeight + "px";
    content.classList.remove("collapsed");
    icon.classList.add("rotated");
  } else {
    // Close all open detail panels before collapsing
    content.querySelectorAll(".tax-holding-detail.open").forEach((detail) => {
      detail.classList.remove("open");
    });
    content.querySelectorAll(".tax-holding-item.expanded").forEach((item) => {
      item.classList.remove("expanded");
    });
    content
      .querySelectorAll(".tax-holding-wrap.detail-open")
      .forEach((wrap) => {
        wrap.classList.remove("detail-open");
      });
    content.style.maxHeight = "0";
    content.classList.add("collapsed");
    icon.classList.remove("rotated");
  }
}

function toggleTaxHoldingItem(itemId) {
  const item = document.getElementById(itemId);
  const detail = document.getElementById(`${itemId}_detail`);
  if (!item || !detail) return;

  const wrap = item.closest(".tax-holding-wrap");
  const content = item.closest(".holdings-split-content");
  const isOpen = detail.classList.contains("open");

  if (isOpen) {
    const detailHeight = detail.scrollHeight;
    detail.classList.remove("open");
    item.classList.remove("expanded");
    if (wrap) wrap.classList.remove("detail-open");
    // Shrink parent simultaneously — subtract detail height right now
    if (content && !content.classList.contains("collapsed")) {
      content.style.maxHeight = content.scrollHeight - detailHeight + "px";
    }
  } else {
    detail.classList.add("open");
    item.classList.add("expanded");
    if (wrap) wrap.classList.add("detail-open");
    // Add 600px headroom so the expanding panel is never clipped
    if (content && !content.classList.contains("collapsed")) {
      content.style.maxHeight = content.scrollHeight + 600 + "px";
    }
  }
}

// UPDATES & API
async function fetchOrUpdateMFStats(updateType = "auto") {
  try {
    if (!portfolioData) {
      console.warn("No portfolio data available");
      return {};
    }

    console.log(`🔄 Fetching MF stats (${updateType})...`);

    // Step 1: Collect ISINs based on updateType and CAS type
    const targetIsins = new Set();

    // Always fetch portfolio benchmark funds
    targetIsins.add("INF247L01957"); // MO Nifty 500 Index
    targetIsins.add("INF247L01AE7"); // MO Nifty 50 Index

    if (updateType === "initial") {
      // For initial load, fetch ALL funds
      if (portfolioData.cas_type === "SUMMARY") {
        portfolioData.folios.forEach((folio) => {
          if (folio.isin) targetIsins.add(folio.isin);
        });
      } else {
        portfolioData.folios.forEach((folio) => {
          if (folio.schemes && Array.isArray(folio.schemes)) {
            folio.schemes.forEach((scheme) => {
              if (scheme.isin) targetIsins.add(scheme.isin);
            });
          }
        });
      }
      console.log(`📊 Initial load: Fetching all ${targetIsins.size} funds`);
    } else {
      if (portfolioData.cas_type === "SUMMARY") {
        portfolioData.folios.forEach((folio) => {
          const hasValue =
            folio.current_value && parseFloat(folio.current_value || 0) > 0;
          if (folio.isin && hasValue) targetIsins.add(folio.isin);
        });
      } else {
        portfolioData.folios.forEach((folio) => {
          if (folio.schemes && Array.isArray(folio.schemes)) {
            folio.schemes.forEach((scheme) => {
              const hasValue =
                scheme.isActive ||
                (scheme.currentValue &&
                  parseFloat(scheme.currentValue || 0) > 0);
              if (scheme.isin && hasValue) targetIsins.add(scheme.isin);
            });
          }
        });
      }
      console.log(
        `📊 Update mode: Fetching ${targetIsins.size} active holdings`,
      );
    }

    const uniqueIsins = [...targetIsins];

    // Step 2: Get ISIN → searchString map
    const searchKeyJson = await getSearchKeys();

    // Step 3: Find corresponding search strings
    const searchKeys = uniqueIsins
      .map((isin) => {
        const searchValue = searchKeyJson[isin];
        if (!searchValue)
          console.log(`⚠️ No search value found for ISIN: ${isin}`);
        return searchValue;
      })
      .filter(Boolean);

    const uniqueSearchKeys = [...new Set(searchKeys)];

    if (uniqueSearchKeys.length === 0) {
      console.warn("No funds to fetch stats for");
      return mfStats || {};
    }

    // For initial uploads and updates, always use the unified /api/mf-stats endpoint
    return await _fetchFull(uniqueSearchKeys, updateType);
  } catch (err) {
    console.error("❌ Failed to fetch MF stats:", err);
    showToast("Failed to fetch MF stats: " + err.message, "error");
    return mfStats || {};
  }
}

async function _fetchFull(uniqueSearchKeys, updateType) {
  const response = await fetch(BACKEND_SERVER + "/api/mf-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchKeys: uniqueSearchKeys }),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const result = await response.json();
  if (!result.success && result.error) throw new Error(result.error);

  const newStats = result.data || result;

  if (updateType === "initial") {
    mfStats = newStats;
    console.log(
      "✅ MF Stats fetched successfully (initial):",
      Object.keys(mfStats).length,
      "funds",
    );

    // Render portfolio immediately — all data (nav, portfolio_stats, etc.) is present
    updateProcessingProgress(70, "Data aggregated");
    if (isSummaryCAS) {
      processSummaryCAS();
    } else {
      updateProcessingProgress(90, "Rendering dashboard…");
      await processPortfolio();
      enableSummaryIncompatibleTabs();
    }
  } else {
    mfStats = {
      ...mfStats,
      ...newStats,
    };
    console.log(
      "✅ MF Stats updated successfully:",
      Object.keys(newStats).length,
      "active funds updated,",
      Object.keys(mfStats).length,
      "total funds in cache",
    );
  }

  return mfStats;
}
async function updateMFStats() {
  if (!portfolioData) {
    showToast("Please load a portfolio first", "warning");
    return;
  }

  // Check if already updated this week (manual only, auto doesn't count here)
  if (
    !storageManager.needsFullUpdate() &&
    storageManager.hasManualStatsUpdateThisWeek()
  ) {
    showToast(
      "Manual fund statistics update already used this week. You can manually update once per week (in addition to the automatic weekly update).",
      "info",
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest fund statistics for ALL users. This may take a few minutes. Continue?",
  );

  if (!confirmUpdate) return;

  showSimpleSplash("Updating fund statistics…");

  try {
    await updateAllUsersStats("manual");
    updateFooterInfo();
  } catch (err) {
    hideSimpleSplash();
    console.error("Update error:", err);
    showToast("Failed to update statistics: " + err.message, "error");
  }
}

async function updateNavManually() {
  if (!portfolioData) {
    showToast("Please load a portfolio first", "warning");
    return;
  }

  // Check if already updated today (auto + manual)
  if (
    !storageManager.needsNavUpdate() &&
    storageManager.hasManualNavUpdateToday()
  ) {
    showToast(
      "NAV already updated today for all users. Please try again tomorrow after 6 AM.",
      "info",
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest NAV for ALL users. Continue?",
  );

  if (!confirmUpdate) return;

  showSimpleSplash("Updating NAV…");

  try {
    await updateAllUsersNav("manual");

    hideSimpleSplash();
    showToast("NAV updated successfully for all users!", "success");
    updateFooterInfo();
  } catch (err) {
    hideSimpleSplash();
    console.error("NAV update error:", err);
    showToast("Failed to update NAV: " + err.message, "error");
  }
}

async function updateAllUsersStats(updateType = "auto") {
  const users = storageManager.getAllUsers();

  if (users.length === 0) {
    console.log("No users to update");
    return false;
  }

  console.log(`🔄 Updating stats for ${users.length} users (${updateType})...`);

  // Collect ONLY ACTIVE ISINs from ALL users
  const allIsins = new Set();

  // Always fetch portfolio benchmark funds
  allIsins.add("INF247L01957"); // MO Nifty 500 Index
  allIsins.add("INF247L01AE7"); // MO Nifty 50 Index

  const userDataMap = new Map();

  for (const user of users) {
    try {
      const stored = await storageManager.loadPortfolioData(user);
      if (!stored) continue;

      const casData = stored.casData;
      const mfStatsUser = stored.mfStats;

      userDataMap.set(user, { casData, mfStats: mfStatsUser });

      // Full stats update: collect ALL ISINs (active + redeemed) so that
      // funds which were parsed before new fields (e.g. launch_date, manager)
      // were added also get their stale cached objects refreshed.
      if (casData.cas_type === "SUMMARY") {
        casData.folios.forEach((folio) => {
          if (folio.isin) allIsins.add(folio.isin);
        });
      } else {
        casData.folios.forEach((folio) => {
          if (folio.schemes && Array.isArray(folio.schemes)) {
            folio.schemes.forEach((scheme) => {
              if (scheme.isin) allIsins.add(scheme.isin);
            });
          }
        });
      }
    } catch (err) {
      console.error(`Error loading data for user ${user}:`, err);
    }
  }

  if (allIsins.size === 0) {
    console.log("No active holdings found across all users");
    return false;
  }

  console.log(
    `📊 Fetching stats for ${allIsins.size} unique funds (active + redeemed)...`,
  );

  // Get search keys for all ISINs
  const searchKeyJson = await getSearchKeys();
  const searchKeys = [...allIsins]
    .map((isin) => searchKeyJson[isin])
    .filter(Boolean);
  const uniqueSearchKeys = [...new Set(searchKeys)];

  if (uniqueSearchKeys.length === 0) {
    console.warn("No search keys found");
    return false;
  }

  try {
    // Single unified fetch via /api/mf-stats — full data in one go
    console.log("⚡ Fetching unified stats for all users...");
    const response = await fetch(BACKEND_SERVER + "/api/mf-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchKeys: uniqueSearchKeys }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const result = await response.json();
    if (!result.success && result.error) throw new Error(result.error);

    const newStats = result.data || {};

    // Save updated stats for all users and refresh current user's view
    for (const [user, userData] of userDataMap.entries()) {
      try {
        const updatedMfStats = { ...userData.mfStats, ...newStats };

        await storageManager.savePortfolioData(
          userData.casData,
          updatedMfStats,
          false,
          user,
        );
        storageManager.updateLastNavUpdate(user);
        storageManager.updateLastFullUpdate(user);
        if (updateType === "manual") {
          storageManager.markManualStatsUpdate(user);
          storageManager.markManualNavUpdate(user);
        }
        console.log(`✅ Stats saved for user: ${user}`);
      } catch (err) {
        console.error(`Error saving stats for user ${user}:`, err);
      }
    }

    // Refresh current user's view and hide splash
    if (currentUser && userDataMap.has(currentUser)) {
      const userData = userDataMap.get(currentUser);
      mfStats = { ...userData.mfStats, ...newStats };

      if (isSummaryCAS) {
        processSummaryCAS();
        disableSummaryIncompatibleTabs();
      } else {
        await processPortfolio();
        enableSummaryIncompatibleTabs();
      }
    }

    hideSimpleSplash();
    console.log("Fund statistics updated successfully!");
    invalidateFamilyDashboardCache();
    updateFooterInfo();

    return true;
  } catch (err) {
    console.error("❌ Stats update failed:", err);
    throw err;
  }
}

async function updateAllUsersNav(updateType = "auto") {
  const users = storageManager.getAllUsers();

  if (users.length === 0) {
    console.log("No users to update");
    return false;
  }

  console.log(`🔄 Updating NAV for ${users.length} users (${updateType})...`);

  // Collect NAV update data from all users
  const navUpdateData = {};
  const userDataMap = new Map();

  for (const user of users) {
    try {
      const stored = await storageManager.loadPortfolioData(user);
      if (!stored) continue;

      const casData = stored.casData;
      const mfStatsUser = stored.mfStats;

      userDataMap.set(user, { casData, mfStats: mfStatsUser });

      // Collect active holdings
      if (casData.cas_type === "SUMMARY") {
        casData.folios.forEach((folio) => {
          const hasValue =
            folio.current_value && parseFloat(folio.current_value || 0) > 0;

          if (folio.isin && hasValue && mfStatsUser[folio.isin]?.scheme_code) {
            if (!navUpdateData[folio.isin]) {
              navUpdateData[folio.isin] = {
                scheme_code: mfStatsUser[folio.isin].scheme_code,
                last_nav_date: mfStatsUser[folio.isin].latest_nav_date || null,
              };
            }
          }
        });
      } else {
        casData.folios.forEach((folio) => {
          if (folio.schemes && Array.isArray(folio.schemes)) {
            folio.schemes.forEach((scheme) => {
              const hasValue =
                scheme.isActive ||
                (scheme.currentValue &&
                  parseFloat(scheme.currentValue || 0) > 0);

              if (
                scheme.isin &&
                hasValue &&
                mfStatsUser[scheme.isin]?.scheme_code
              ) {
                if (!navUpdateData[scheme.isin]) {
                  navUpdateData[scheme.isin] = {
                    scheme_code: mfStatsUser[scheme.isin].scheme_code,
                    last_nav_date:
                      mfStatsUser[scheme.isin].latest_nav_date || null,
                  };
                }
              }
            });
          }
        });
      }
    } catch (err) {
      console.error(`Error loading data for user ${user}:`, err);
    }
  }

  const activeHoldingsCount = Object.keys(navUpdateData).length;

  if (activeHoldingsCount === 0) {
    console.log("ℹ️ No active holdings to update NAV for.");
    return true;
  }

  console.log(`📊 Updating NAV for ${activeHoldingsCount} active holdings...`);

  // Single API call for all users
  try {
    const response = await fetch(BACKEND_SERVER + "/api/update-nav-only", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navUpdateData }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const result = await response.json();

    if (result.success) {
      const updatedNavData = result.data;

      // Update each user's data
      for (const [user, userData] of userDataMap.entries()) {
        try {
          const updatedMfStats = { ...userData.mfStats };

          // Apply NAV updates
          Object.keys(updatedNavData).forEach((isin) => {
            if (updatedMfStats[isin]) {
              const newNavData = updatedNavData[isin];

              if (newNavData.latest_nav) {
                updatedMfStats[isin].latest_nav = newNavData.latest_nav;
              }
              if (newNavData.latest_nav_date) {
                updatedMfStats[isin].latest_nav_date =
                  newNavData.latest_nav_date;
              }

              if (newNavData.nav_entries && newNavData.nav_entries.length > 0) {
                const existingHistory = updatedMfStats[isin].nav_history || [];

                if (newNavData.is_full_history) {
                  updatedMfStats[isin].nav_history = newNavData.nav_entries;
                } else {
                  const combined = [
                    ...newNavData.nav_entries,
                    ...existingHistory,
                  ];
                  const uniqueByDate = Array.from(
                    new Map(combined.map((item) => [item.date, item])).values(),
                  );

                  uniqueByDate.sort((a, b) => {
                    const [dayA, monthA, yearA] = a.date.split("-");
                    const [dayB, monthB, yearB] = b.date.split("-");
                    const dateA = new Date(`${yearA}-${monthA}-${dayA}`);
                    const dateB = new Date(`${yearB}-${monthB}-${dayB}`);
                    return dateB - dateA;
                  });

                  updatedMfStats[isin].nav_history = uniqueByDate;
                }
              }

              if (newNavData.meta) {
                updatedMfStats[isin].meta = newNavData.meta;
              }
            }
          });

          await storageManager.savePortfolioData(
            userData.casData,
            updatedMfStats,
            false,
            user,
          );

          storageManager.updateLastNavUpdate(user);

          if (updateType === "manual") {
            storageManager.markManualNavUpdate(user);
          }

          console.log(`✅ Updated NAV for user: ${user}`);
        } catch (err) {
          console.error(`Error saving NAV data for user ${user}:`, err);
        }
      }

      // Refresh current user's view
      if (currentUser && userDataMap.has(currentUser)) {
        mfStats = { ...userDataMap.get(currentUser).mfStats };

        // Apply updates to current view
        Object.keys(updatedNavData).forEach((isin) => {
          if (mfStats[isin]) {
            const newNavData = updatedNavData[isin];
            if (newNavData.latest_nav) {
              mfStats[isin].latest_nav = newNavData.latest_nav;
            }
            if (newNavData.latest_nav_date) {
              mfStats[isin].latest_nav_date = newNavData.latest_nav_date;
            }
            if (newNavData.nav_entries) {
              const existingHistory = mfStats[isin].nav_history || [];
              if (newNavData.is_full_history) {
                mfStats[isin].nav_history = newNavData.nav_entries;
              } else {
                const combined = [
                  ...newNavData.nav_entries,
                  ...existingHistory,
                ];
                const uniqueByDate = Array.from(
                  new Map(combined.map((item) => [item.date, item])).values(),
                );
                uniqueByDate.sort((a, b) => {
                  const [dayA, monthA, yearA] = a.date.split("-");
                  const [dayB, monthB, yearB] = b.date.split("-");
                  const dateA = new Date(`${yearA}-${monthA}-${dayA}`);
                  const dateB = new Date(`${yearB}-${monthB}-${dayB}`);
                  return dateB - dateA;
                });
                mfStats[isin].nav_history = uniqueByDate;
              }
            }
            if (newNavData.meta) {
              mfStats[isin].meta = newNavData.meta;
            }
          }
        });

        if (isSummaryCAS) {
          processSummaryCAS();
          disableSummaryIncompatibleTabs();
        } else {
          await processPortfolio();
          enableSummaryIncompatibleTabs();
        }
      }

      console.log(`✅ NAV updated for all ${users.length} users`);
      invalidateFamilyDashboardCache();
      return true;
    }
    return false;
  } catch (err) {
    console.error("❌ NAV update failed:", err);
    return false;
  }
}
async function updateNavHistoryOnly() {
  return await updateAllUsersNav("auto");
}
async function updateFullMFStats() {
  return await updateAllUsersStats("auto");
}
async function checkAndPerformAutoUpdates() {
  if (!portfolioData || !mfStats) {
    console.log("ℹ️ No portfolio data, skipping auto-updates");
    return;
  }

  // Stats schema check runs immediately, bypassing the 6 AM gate — if a new
  // field was added server-side that requires a full re-pull, the user
  // shouldn't have to wait until tomorrow morning to get it.
  const storedSchemaVersion = parseInt(
    localStorage.getItem(STATS_SCHEMA_VERSION_KEY) || "0",
    10,
  );
  const schemaIsStale = storedSchemaVersion < STATS_SCHEMA_VERSION;

  if (schemaIsStale) {
    console.log(
      `🆕 Stats schema outdated (have v${storedSchemaVersion}, need v${STATS_SCHEMA_VERSION}) — forcing immediate full update`,
    );
    const updated = await updateFullMFStats();
    if (updated) {
      // updateAllUsersStats already calls storageManager.updateLastFullUpdate()
      // per user internally, which resets the 7-day weekly-update counter.
      localStorage.setItem(
        STATS_SCHEMA_VERSION_KEY,
        String(STATS_SCHEMA_VERSION),
      );
      console.log("Portfolio statistics updated due to schema change!");
      return; // Full update includes NAV, so skip NAV-only update
    }
    console.log("⚠️ Schema-triggered full update failed, will retry next load");
  }

  // Only auto-update after 6 AM
  if (!isAfter6AM()) {
    console.log("⏰ Auto-updates only run after 6 AM");
    return;
  }

  // Check if full update is needed (every 7 days)
  if (storageManager.needsFullUpdate()) {
    console.log("📅 Weekly update required (7+ days since last update)");
    const updated = await updateFullMFStats();
    if (updated) {
      console.log("Portfolio statistics updated for the week!");
      return; // Full update includes NAV, so skip NAV-only update
    }
  }

  // Check if NAV update is needed (daily, only if not manually updated today)
  if (
    storageManager.needsNavUpdate() &&
    !storageManager.hasManualNavUpdateToday()
  ) {
    console.log("📅 Daily NAV update required");
    const updated = await updateNavHistoryOnly();
    if (updated) {
      if (isSummaryCAS) {
        processSummaryCAS();
        disableSummaryIncompatibleTabs();
      } else {
        await processPortfolio();
        enableSummaryIncompatibleTabs();
      }

      console.log("Latest NAV updated!");
      updateFooterInfo();
    } else {
      console.log("Failed to update NAV", "error");
    }
  }
}

// NAVIGATION & UI
function switchDashboardTab(tabId) {
  // Prevent switching to disabled tabs for summary CAS
  if (isSummaryCAS) {
    const disabledTabs = [
      "charts",
      "transactions",
      "capital-gains",
      "past-holding",
    ];
    if (disabledTabs.includes(tabId)) {
      showToast("This feature is not available for Summary CAS", "warning");
      return;
    }
  }

  // Hide all sections
  document.querySelectorAll(".dashboard section").forEach((section) => {
    section.classList.remove("active-tab");
  });

  // Remove active class from all tab buttons (sidebar + topbar)
  document
    .querySelectorAll(".sidebar-menu-item, .topbar-cas-btn")
    .forEach((btn) => {
      btn.classList.remove("active");
    });

  document.querySelectorAll(".holdings-search-input").forEach((search) => {
    search.value = "";
    filterHoldingsGrid("current");
    filterHoldingsGrid("past");
  });

  // Show selected section
  const selectedSection = document.getElementById(tabId);
  if (selectedSection) {
    selectedSection.classList.add("active-tab");
  }

  // Add active class to clicked button (desktop)
  const buttonClass = "." + tabId + "-button";
  const activeButtons = document.querySelectorAll(buttonClass);
  activeButtons.forEach((btn) => btn.classList.add("active"));

  if (tabId === "charts") {
    if (!isSummaryCAS) {
      updateChart();
      displayMonthlySummaryAndProjections();
      renderTransactionCalendar();
    }
  }
  if (tabId === "transactions") {
    if (!isSummaryCAS) {
      renderTransactionCalendar();
    }
  } else if (tabId === "overlap-analysis") {
    displayOverlapAnalysis();
  } else if (tabId === "expense-impact") {
    displayExpenseImpact();
  } else if (tabId === "health-score") {
    displayHealthScore();
  } else if (tabId === "tax-planning") {
    displayTaxPlanning();
  } else if (tabId === "family-dashboard") {
    loadFamilyDashboard();
  } else {
  }
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function toggleMobileMenu() {
  const menu = document.getElementById("appSidebar");
  const overlay = document.getElementById("mobileMenuOverlay");
  const hamburger = document.getElementById("hamburgerMenu");

  menu.classList.toggle("mobile-active");
  overlay.classList.toggle("active");
  hamburger.classList.toggle("active");

  if (menu.classList.contains("mobile-active")) {
    lockBodyScroll();
  } else {
    unlockBodyScroll();
  }
}

function closeMobileMenu() {
  const menu = document.getElementById("appSidebar");
  const overlay = document.getElementById("mobileMenuOverlay");
  const hamburger = document.getElementById("hamburgerMenu");

  menu.classList.remove("mobile-active");
  overlay.classList.remove("active");
  hamburger.classList.remove("active");
  unlockBodyScroll();
}

function toggleSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const expanded = sidebar.classList.toggle("expanded");
  document.body.classList.toggle("sidebar-expanded", expanded);
  localStorage.setItem("sidebarExpanded", expanded ? "1" : "0");
}
function showUploadSection() {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) {
    console.warn("Dashboard element not found");
    return;
  }

  // Show dashboard but in disabled state
  dashboard.classList.add("active");
  dashboard.classList.remove("disabled");

  // Disable all tabs except CAS upload
  disableAllTabsExceptUpload();
  switchDashboardTab("manage-data");

  const hideCards = ["update-stats", "update-nav"];
  const showCard = "instructions-card";

  hideCards.forEach((e) => {
    const element = document.querySelector("." + e);
    if (element) element.classList.add("hidden");
  });

  const instructionsCard = document.querySelector("." + showCard);
  if (instructionsCard) instructionsCard.classList.remove("hidden");

  showToast("Please upload CAS to view the Dashboard.", "info");
}

function enableAllTabs() {
  document
    .querySelectorAll(".sidebar-menu-item, .topbar-cas-btn")
    .forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.style.pointerEvents = "auto";
    });
}

function disableAllTabsExceptUpload() {
  document
    .querySelectorAll(".sidebar-menu-item, .topbar-cas-btn")
    .forEach((btn) => {
      if (!btn) return;
      if (!btn.classList.contains("manage-data-button")) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
        btn.style.pointerEvents = "none";
      } else {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        btn.style.pointerEvents = "auto";
      }
    });
}
function disableSummaryIncompatibleTabs() {
  const tabsToDisable = [
    ".charts-button",
    ".transactions-button",
    ".capital-gains-button",
    ".past-holding-button",
    ".tax-planning-button",
  ];

  tabsToDisable.forEach((selector) => {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.classList.add("disabled-tab");
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
      btn.title = "Not available for Summary CAS";

      const originalOnclick = btn.onclick;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showToast("This feature is not available for Summary CAS", "warning");
        return false;
      };
    });
  });

  document.getElementById("show-past")?.classList.add("hidden");
  document.getElementById("show-past-mobile")?.classList.add("hidden");
}
function enableSummaryIncompatibleTabs() {
  const tabsToEnable = [
    ".charts-button",
    ".transactions-button",
    ".capital-gains-button",
    ".past-holding-button",
    ".overlap-analysis-button",
    ".expense-impact-button",
    ".health-score-button",
    ".tax-planning-button",
  ];

  tabsToEnable.forEach((selector) => {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove("disabled-tab");
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.title = "";

      if (btn.classList.contains("charts-button")) {
        btn.onclick = () => {
          switchDashboardTab("charts");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("transactions-button")) {
        btn.onclick = () => {
          switchDashboardTab("transactions");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("capital-gains-button")) {
        btn.onclick = () => {
          switchDashboardTab("capital-gains");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("past-holding-button")) {
        btn.onclick = () => {
          switchDashboardTab("past-holding");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("overlap-analysis-button")) {
        btn.onclick = () => {
          switchDashboardTab("overlap-analysis");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("expense-impact-button")) {
        btn.onclick = () => {
          switchDashboardTab("expense-impact");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("health-score-button")) {
        btn.onclick = () => {
          switchDashboardTab("health-score");
          if (btn.classList.contains("sidebar-menu-item")) {
            closeMobileMenu();
          }
        };
      }
    });
  });
}
function toggleFamilyDashboard() {
  const users = storageManager.getAllUsers();
  const familyButtons = document.querySelectorAll(".family-dashboard-button");

  if (users.length >= 2) {
    familyButtons.forEach((btn) => {
      btn.classList.remove("hidden");
      btn.disabled = false;
      btn.classList.remove("disabled-tab");
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.title = "";

      if (btn.classList.contains("sidebar-menu-item")) {
        btn.onclick = () => {
          switchDashboardTab("family-dashboard");
          closeMobileMenu();
        };
      } else {
        btn.onclick = () => switchDashboardTab("family-dashboard");
      }
    });
  } else {
    familyButtons.forEach((btn) => {
      btn.classList.remove("hidden");
      btn.disabled = true;
      btn.classList.add("disabled-tab");
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
      btn.title = "Requires at least 2 users";

      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showToast("Family Dashboard requires at least 2 users", "warning");
        return false;
      };
    });
  }
}

// THEME
function initializeTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeUI(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";

  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  updateThemeUI(newTheme);

  if (portfolioData && fundWiseData) {
    calculateAndDisplayPortfolioAnalytics();
  }

  if (currentTab && chart) {
    updateChart();
  }

  if (familyDashboardCache) {
    displayFamilyAnalytics(familyDashboardCache);
  }
}

function updateThemeUI(theme) {
  const isDark = theme === "dark";

  const themeIcon = document.getElementById("themeIconDesktop");

  if (themeIcon) {
    themeIcon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }

  const themeIconMobile = document.getElementById("themeIconMobile");

  if (themeIconMobile) {
    themeIconMobile.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
}

// FOOTER INFO
function updateFooterInfo() {
  const manifest = storageManager.getManifest();

  if (manifest) {
    // CAS parsed date
    const casDate = manifest.timestamp
      ? new Date(manifest.timestamp).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "--";

    // Stats update date
    const statsDate = manifest.lastFullUpdate
      ? new Date(manifest.lastFullUpdate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "--";

    // NAV update date
    const navDate = manifest.lastNavUpdate
      ? new Date(manifest.lastNavUpdate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "--";

    // Update upload tab dates (elements may not exist on all views)
    const navEl = document.getElementById("lastNavUpdateDate");
    const statsEl = document.getElementById("lastStatsUpdateDate");
    if (navEl) navEl.textContent = navDate;
    if (statsEl) statsEl.textContent = statsDate;
  }
}

// MISC HELPERS
function updatePortfolioDataWithActiveStatus() {
  portfolioData.folios.forEach((folio) => {
    // Detailed CAS: each folio has a nested schemes[]
    // Summary CAS:  each folio IS the scheme entry (no nested schemes)
    if (Array.isArray(folio.schemes)) {
      folio.schemes.forEach((scheme) => {
        const key = getFundKey(scheme);
        const fund = fundWiseData[key];

        if (fund && fund.advancedMetrics) {
          scheme.currentValue = fund.advancedMetrics.currentValue;
          scheme.isActive = fund.advancedMetrics.currentValue > 0;
        } else {
          scheme.currentValue = 0;
          scheme.isActive = false;
        }
      });
    } else if (folio.scheme) {
      const key = getFundKey(folio);
      const fund = fundWiseData[key];

      if (fund && fund.advancedMetrics) {
        folio.current_value = fund.advancedMetrics.currentValue;
        folio.isActive = fund.advancedMetrics.currentValue > 0;
      } else {
        folio.current_value = 0;
        folio.isActive = false;
      }
    }
  });
}
let currentWidthCategory;

function getWidthCategory() {
  const width = window.innerWidth;
  if (width <= 500) return "mobile";
  if (width <= 885) return "tab";
  return "desktop";
}

window.addEventListener("resize", () => {
  const newCategory = getWidthCategory();
  if (newCategory !== currentWidthCategory) {
    currentWidthCategory = newCategory;
    updateChart();
  }
});

async function callHealthCheck() {
  try {
    await fetch(BACKEND_SERVER + "/health");
    console.log("Health check completed");
  } catch (err) {
    console.error("Health check failed:", err);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  initializeTheme();
  // Restore sidebar expanded/collapsed preference
  const sidebarEl = document.getElementById("appSidebar");
  if (sidebarEl && localStorage.getItem("sidebarExpanded") === "1") {
    sidebarEl.classList.add("expanded");
    document.body.classList.add("sidebar-expanded");
  }
  callHealthCheck();
  // Show debug CAS inject row only when DEBUG_MODE is on
  const debugRow = document.getElementById("debugCASInjectRow");
  if (debugRow) {
    if (DEBUG_MODE) {
      debugRow.classList.remove("hidden");
    } else {
      debugRow.classList.add("hidden");
    }
  }

  const dashboard = document.getElementById("dashboard");

  const hasUsers = initializeUserManagement();

  if (!hasUsers) {
    console.log("📡 No users found");
    showUploadSection();
    return;
  }

  if (currentUser) {
    const storedFileInfo = localStorage.getItem(
      `lastCASFileInfo_${currentUser}`,
    );
    if (storedFileInfo) {
      lastUploadedFileInfo = storedFileInfo;
    }
  }

  try {
    const stored = await storageManager.loadPortfolioData(currentUser);

    if (stored) {
      const showCards = ["update-stats", "update-nav"];
      const hideCard = "instructions-card";

      showCards.forEach((e) => {
        const element = document.querySelector("." + e);
        if (element) element.classList.remove("hidden");
      });

      const hideElement = document.querySelector("." + hideCard);
      if (hideElement) hideElement.classList.add("hidden");

      dashboard.classList.remove("disabled");
      showSimpleSplash("Loading portfolio…");

      portfolioData = stored.casData;
      mfStats = stored.mfStats;

      isSummaryCAS = portfolioData.cas_type === "SUMMARY";

      console.log(
        "✅ Portfolio Data Loaded from IndexedDB - User:",
        currentUser,
        " - CAS Type:",
        isSummaryCAS ? "SUMMARY" : "DETAILED",
      );

      try {
        if (isSummaryCAS) {
          processSummaryCAS();
        } else {
          await processPortfolio();
          enableSummaryIncompatibleTabs();
        }

        toggleFamilyDashboard();
        hideSimpleSplash();
        console.log(`Portfolio loaded for ${currentUser}!`);

        updateFooterInfo();
        enableAllTabs();

        if (isSummaryCAS) {
          disableSummaryIncompatibleTabs();
        }

        dashboard.classList.add("active");
        switchDashboardTab(getInitialTabFromHash());

        setTimeout(async () => {
          await checkAndPerformAutoUpdates();
          updateFooterInfo();
        }, 2000);
      } catch (processErr) {
        hideSimpleSplash();
        console.error("Portfolio processing error:", processErr);
        showToast(
          "Failed to load portfolio. Please re-upload your CAS.",
          "error",
        );
        showUploadSection();
      }

      return;
    }

    console.log(`📡 No data for user: ${currentUser}`);
    showUploadSection();
  } catch (err) {
    hideSimpleSplash();
    console.error("Load error:", err);
    showUploadSection();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

const originalSwitchDashboardTab = window.switchDashboardTab;
window.switchDashboardTab = function (tabId) {
  const previousTab = document.querySelector(
    ".dashboard section.active-tab",
  )?.id;

  if (previousTab && previousTab !== tabId && !window.isPopStateNavigation) {
    tabHistory = tabHistory.slice(0, historyPointer + 1);
    tabHistory.push(tabId);
    historyPointer = tabHistory.length - 1;

    window.history.pushState(
      { tab: tabId, pointer: historyPointer },
      "",
      window.location.pathname + "#" + tabId,
    );
  }

  originalSwitchDashboardTab(tabId);

  // Update dashboard-title to reflect the active tab name
  const tabNames = {
    main: "Dashboard",
    charts: "Charts",
    transactions: "Transactions",
    "capital-gains": "Capital Gains",
    "past-holding": "Past Holdings",
    "current-holding": "Current Holdings",
    "overlap-analysis": "Overlap Analysis",
    "expense-impact": "Expense Impact",
    "health-score": "Portfolio Health",
    "family-dashboard": "Family Dashboard",
    "manage-data": "Manage Data",
    "tax-planning": "Tax Planning",
  };
  const titleEl = document.querySelector(".dashboard-title");
  if (titleEl && tabNames[tabId]) {
    titleEl.textContent = tabNames[tabId];
  }

  // Sync active state on sidebar-footer CAS button (mobile)
  const footerCasBtn = document.querySelector(".sidebar-footer-cas-btn");
  if (footerCasBtn) {
    footerCasBtn.classList.toggle("active", tabId === "manage-data");
  }
};

// ── "Press back again to exit" ──────────────────────────────────────────
// IMPORTANT: a popstate handler CANNOT intercept/cancel the back press that
// takes the user past the oldest entry in our history stack — the browser
// has already left the page by the time JS would run. So we keep a
// permanent sentinel entry below "main". The first back press from main
// lands on the sentinel (still inside our page -> popstate fires -> we show
// the toast and push "main" back on top). Only a second press, while the
// sentinel is still showing, is allowed to actually exit.
let _exitPending = false;
let _exitToastTimeout = null;

function _showExitToast() {
  if (typeof showToast === "function") {
    showToast("Press back again to exit", "info");
  } else {
    let el = document.getElementById("_exitToastBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "_exitToastBanner";
      el.style.cssText =
        "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);" +
        "background:#333;color:#fff;padding:10px 20px;border-radius:20px;" +
        "font-size:14px;z-index:99999;pointer-events:none;transition:opacity .3s;";
      document.body.appendChild(el);
    }
    el.textContent = "Press back again to exit";
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.opacity = "0";
    }, 2000);
  }
}

window.addEventListener("popstate", function (event) {
  // ── 0. OCD bottom sheet — check DOM presence directly, not just state shape.
  // This must run before anything else: if the sheet is open, back ALWAYS
  // just closes it, no matter what event.state looks like.
  if (document.getElementById("overlapFundSheetOverlay")) {
    closeOverlapFundSheet(true);
    return;
  }

  // ── 1. Sentinel hit: user pressed back while resting on main ───────────
  if (!event.state || event.state.sentinel) {
    if (_exitPending) {
      // Second back press at the sentinel -> let it through, app exits.
      clearTimeout(_exitToastTimeout);
      _exitPending = false;
      return;
    }
    // First press -> show toast, restore "main" on top of the sentinel so
    // the user keeps seeing the dashboard, not a blank/previous page.
    _exitPending = true;
    _showExitToast();
    _exitToastTimeout = setTimeout(() => {
      _exitPending = false;
    }, 2000);
    window.history.pushState(
      { tab: "main", pointer: 0 },
      "",
      window.location.pathname + "#main",
    );
    return;
  }

  // (sheet already handled in step 0 above)
  if (event.state.sheet === "ocd") {
    closeOverlapFundSheet(true);
    return;
  }

  // ── 3. Modals — each just closes on back ────────────────────────────────
  const allTimeModal = document.getElementById("allTimeTransactionsModal");
  const activeModal = document.getElementById("activeTransactionsModal");
  const fundTxModal = document.getElementById("fundTransactionModal");
  const fundHoldingsModal = document.getElementById("fundHoldingsModal");
  const portfolioHoldingsModal = document.getElementById(
    "portfolioHoldingsModal",
  );
  const familyHoldingsModal = document.getElementById("familyHoldingsModal");
  const fundDetailsModal = document.getElementById("fundDetailsModal");
  const overlapDetailModal = document.getElementById("overlapDetailModal");
  const commonHoldingDetailModal = document.getElementById(
    "commonHoldingDetailModal",
  );
  const allOverlapPairsModal = document.getElementById("allOverlapPairsModal");
  const allCommonHoldingsModal = document.getElementById(
    "allCommonHoldingsModal",
  );

  if (commonHoldingDetailModal) {
    closeCommonHoldingDetailModal();
    return;
  }
  if (overlapDetailModal) {
    closeOverlapDetailModal();
    return;
  }
  if (allOverlapPairsModal) {
    closeAllOverlapPairsModal();
    return;
  }
  if (allCommonHoldingsModal) {
    closeAllCommonHoldingsModal();
    return;
  }
  if (allTimeModal) {
    closeAllTimeTransactions();
    return;
  }
  if (activeModal) {
    closeActiveTransactions();
    return;
  }
  if (fundTxModal) {
    closeFundTransactionModal();
    return;
  }
  if (fundHoldingsModal) {
    closeFundHoldingsModal();
    return;
  }
  if (portfolioHoldingsModal) {
    closePortfolioHoldingsModal();
    return;
  }
  if (familyHoldingsModal) {
    closeFamilyHoldingsModal();
    return;
  }
  if (fundDetailsModal) {
    closeFundDetailsModal();
    return;
  }

  // ── 4. Tab navigation ────────────────────────────────────────────────────
  if (event.state.pointer !== undefined) {
    const newPointer = event.state.pointer;
    const targetTab = tabHistory[newPointer] || "main";

    historyPointer = newPointer;
    window.isPopStateNavigation = true;
    switchDashboardTab(targetTab);
    window.isPopStateNavigation = false;

    if (window.location.hash.slice(1) !== targetTab) {
      window.history.replaceState(
        event.state,
        "",
        window.location.pathname + "#" + targetTab,
      );
    }
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
});

{
  // The real, original navigation entry (whatever was loaded before this
  // script ran) is left completely untouched — we never call replaceState
  // on it. Chromium browsers (Chrome/Edge) apply an anti-hijacking
  // heuristic: if a page calls replaceState on its own entry immediately
  // at load (no user gesture in between) and the user later presses back,
  // the browser can skip that rewritten entry entirely and jump straight
  // past it. That's exactly what was happening with the old {sentinel:true}
  // replaceState call — it silently vanished on back, so the very first
  // back press blew straight past it.
  //
  // Instead: just pushState "main" on top of the original entry. The
  // popstate handler's existing `!event.state` check already treats a
  // null state as the floor, so going back to this never-modified entry
  // behaves exactly like hitting the old sentinel — but can't be skipped,
  // because we never rewrote it.
  const initialTab = (window.location.hash || "#main").slice(1) || "main";

  tabHistory = ["main"];
  historyPointer = 0;

  window.history.pushState(
    { tab: "main", pointer: 0 },
    "",
    window.location.pathname + "#main",
  );

  if (initialTab !== "main") {
    tabHistory.push(initialTab);
    historyPointer = 1;
    window.history.pushState(
      { tab: initialTab, pointer: 1 },
      "",
      window.location.pathname + "#" + initialTab,
    );
  }
}

// ============================================
// FULL PAGE SCREENSHOT
// ============================================

async function takeFullPageScreenshot() {
  const btn = [
    document.getElementById("screenshotBtnMobile"),
    document.getElementById("screenshotBtnDesktop"),
  ].find((el) => el && el.offsetParent !== null);

  if (typeof html2canvas === "undefined") {
    console.log("Screenshot library not loaded");
    return;
  }

  if (btn) {
    btn.classList.add("capturing");
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }

  const patched = [];
  try {
    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark";

    // --- Directly patch every backdrop-filter element via inline styles ---
    // html2canvas reads computed/inline styles, so CSS class overrides can
    // arrive too late or be ignored. Inline style is the only reliable fix.
    const pageBg = isDark ? [19, 20, 31] : [248, 250, 252]; // #13141f / #f8fafc

    // Composite rgba(r,g,b,a) over the page background → fully opaque equivalent
    function solidifyRgba(computedColor) {
      const m = computedColor.match(
        /rgba\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\)/,
      );
      if (!m) return null;
      const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]];
      const [br, bg, bb] = pageBg;
      return `rgb(${Math.round(a * r + (1 - a) * br)}, ${Math.round(a * g + (1 - a) * bg)}, ${Math.round(a * b + (1 - a) * bb)})`;
    }

    const patchSelectors = [
      ".summary-cards",
      ".upload-section",
      ".folio-card",
      ".analytics-card",
      ".chart-section",
      ".compact-dashboard",
      ".compact-summary-card",
      ".compact-header",
      ".compact-stat-row",
      ".compact-members",
      ".modal-content",
      ".portfolio-analytics-section",
      ".transaction-section",
      ".portfolio-valuation-section",
      ".monthly-summary-container",
      ".tax-planning-container",
      ".upload-card",
      ".cas-panel",
      ".stat-item",
    ];
    patchSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const prev = {
          backdropFilter: el.style.backdropFilter,
          webkitBackdropFilter: el.style.webkitBackdropFilter,
          background: el.style.background,
          borderTopColor: el.style.borderTopColor,
          borderRightColor: el.style.borderRightColor,
          borderBottomColor: el.style.borderBottomColor,
          borderLeftColor: el.style.borderLeftColor,
        };
        el.style.backdropFilter = "none";
        el.style.webkitBackdropFilter = "none";
        // Solidify semi-transparent background
        const cs = getComputedStyle(el);
        const computedBg = cs.backgroundColor;
        if (computedBg.startsWith("rgba")) {
          const opaque = solidifyRgba(computedBg);
          if (opaque) el.style.background = opaque;
        }
        // Solidify semi-transparent borders (html2canvas renders rgba borders incorrectly)
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          const prop = `border${side}Color`;
          const computedBorder = cs[prop];
          if (computedBorder && computedBorder.startsWith("rgba")) {
            const opaque = solidifyRgba(computedBorder);
            if (opaque) el.style[prop] = opaque;
          }
        }
        patched.push({ el, prev });
      });
    });

    document.body.classList.add("screenshot-mode");

    // Wait for 2 rAFs + a small timeout to ensure a full repaint flush
    await new Promise((r) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(r, 50)),
      ),
    );

    const canvas = await html2canvas(document.body, {
      backgroundColor: isDark ? "#13141f" : "#f8fafc",
      scale: 2,
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      logging: false,
    });

    const timestamp = new Date()
      .toLocaleDateString("en-IN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");

    const link = document.createElement("a");
    link.download = `mf-dashboard-${timestamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    showToast("Screenshot saved!", "success");
  } catch (err) {
    console.error("Screenshot failed:", err);
    showToast("Screenshot failed. Please try again.", "error");
  } finally {
    patched.forEach(({ el, prev }) => {
      el.style.backdropFilter = prev.backdropFilter;
      el.style.webkitBackdropFilter = prev.webkitBackdropFilter;
      el.style.background = prev.background;
      el.style.borderTopColor = prev.borderTopColor;
      el.style.borderRightColor = prev.borderRightColor;
      el.style.borderBottomColor = prev.borderBottomColor;
      el.style.borderLeftColor = prev.borderLeftColor;
    });
    document.body.classList.remove("screenshot-mode");
    if (btn) {
      btn.classList.remove("capturing");
      btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
    }
  }
}
