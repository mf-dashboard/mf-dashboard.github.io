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
const showViewDetailsForPast = false;
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

// Chart instances
let marketCapChart = null;
let sectorChart = null;
let amcChart = null;
let holdingsChart = null;
let familySectorChart = null;
let familyAmcChart = null;
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

// Backend configuration
const BACKEND_SERVER =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://my-mf-dashboard-backend.onrender.com";

console.log("🔧 Backend Server:", BACKEND_SERVER);
const DEBUG_MODE = false;

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

  if (!casData?.folios || !Array.isArray(casData.folios)) {
    showToast(
      "Invalid CAS structure — expected a 'folios' array at root",
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
      await fetchOrUpdateMFStats("initial");
    } else {
      console.log(
        `✅ mfStats already present (${Object.keys(mfStats).length} funds) — skipping fetch`,
      );
    }

    if (isSummaryCAS) {
      processSummaryCAS();
    } else {
      await processPortfolio();
      enableSummaryIncompatibleTabs();
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
  if (DEBUG_MODE) {
    console.log("🐛 DEBUG MODE: Loading from local JSON files...");
    showProcessingSplash();

    const debugData = await loadLocalDebugData();
    if (!debugData) {
      hideProcessingSplash();
      return;
    }

    portfolioData = debugData.casData;
    mfStats = debugData.statsData;

    isSummaryCAS = portfolioData.cas_type === "SUMMARY";

    console.log(
      "CAS Type:",
      isSummaryCAS ? "SUMMARY" : "DETAILED",
      " - Folios Fetched: ",
      portfolioData.folios?.length,
    );

    if (isSummaryCAS) {
      processSummaryCAS();
    } else {
      await processPortfolio();
      enableSummaryIncompatibleTabs();
    }

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
        console.log(`✨ Creating new user with increment: ${currentUser}`);
      } else {
        currentUser = firstNameFromCAS;
        console.log(`✨ Creating new user: ${currentUser}`);
      }
    }

    localStorage.setItem("lastActiveUser", currentUser);

    const hiddenFoliosKey = `hiddenFolios_${currentUser}`;
    localStorage.removeItem(hiddenFoliosKey);
    console.log(`🗑️ Cleared hidden folios for user: ${currentUser}`);

    await storageManager.savePortfolioData(
      portfolioData,
      mfStats,
      true,
      currentUser,
    );

    localStorage.setItem(`investorName_${currentUser}`, fullInvestorName);
    console.log(`💾 Debug data saved for user: ${currentUser}`);

    allUsers = storageManager.getAllUsers();

    populateUserList(allUsers);
    updateCurrentUserDisplay();

    const dashboard = document.getElementById("dashboard");
    dashboard.classList.remove("disabled");

    enableAllTabs();

    hideProcessingSplash();

    const showCards = ["update-stats", "update-nav"];
    const hideCard = "instructions-card";

    showCards.forEach((e) => {
      const element = document.querySelector("." + e);
      if (element) element.classList.remove("hidden");
    });

    const hideElement = document.querySelector("." + hideCard);
    if (hideElement) hideElement.classList.add("hidden");

    showToast(`Debug data loaded successfully for ${currentUser}!`, "success");
    updateFooterInfo();
    invalidateFamilyDashboardCache();
    switchDashboardTab("main");
    return;
  }

  const fileInput = document.getElementById("fileInputTab");
  const passwordInput = document.getElementById("filePasswordTab");
  const password = passwordInput.value;
  const file = fileInput.files[0];

  console.log("File selected:", file?.name);
  console.log("Password entered:", password ? "yes" : "no");

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

    // Detect CAS type
    isSummaryCAS = portfolioData.cas_type === "SUMMARY";

    console.log(
      "CAS Type:",
      isSummaryCAS ? "SUMMARY" : "DETAILED",
      " - Folios Fetched: ",
      portfolioData.folios?.length,
    );

    if (isSummaryCAS) {
      await fetchOrUpdateMFStats("initial");
      processSummaryCAS();
    } else {
      await fetchOrUpdateMFStats("initial");
      await processPortfolio();
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
    console.log(`🗑️ Cleared hidden folios for user: ${currentUser}`);

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
    console.log(`💾 File signature saved for user: ${currentUser}`);

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

    showToast(
      `Portfolio loaded and saved successfully for ${currentUser}!`,
      "success",
    );
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
async function processPortfolio() {
  document.getElementById("dashboard").classList.add("active");

  aggregateFundWiseData();

  const summary = calculateSummary();
  updateSummaryCards(summary);

  requestAnimationFrame(() => {
    updateFundBreakdown();
    calculateAndDisplayPortfolioAnalytics();
    displayCapitalGains();
    initializeTransactionSections();
    updateCompactDashboard();
    updateCompactPastDashboard();
    switchDashboardTab("main");
  });

  // Calculate daily valuations asynchronously (non-blocking)
  requestIdleCallback(
    async () => {
      const portfolioValuation = await calculatePortfolioDailyValuation();
      console.log("Portfolio valuation data:", portfolioValuation);

      window.portfolioValuationHistory = portfolioValuation;

      initializeCharts();

      if (currentTab === "growth") {
        updateChart();
      }
    },
    { timeout: 2000 },
  );
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

      const key = scheme.scheme.trim().toLowerCase();
      // Get additional data from mfStats if available
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
          return_stats: return_stats,
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

    const key = folio.scheme.trim().toLowerCase();
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
      cost > 0 ? ((unrealizedGain / cost) * 100).toFixed(2) : 0;

    folio.current_value = currentValue;
    folio.nav = latestNav;
    folio.nav_date = extendedData?.latest_nav_date || folio.nav_date;

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
        averageRemainingCostPerUnit: units > 0 ? (cost / units).toFixed(3) : 0,
        averageHoldingDays: 0,
        category: extendedData?.category || "hybrid",
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
    switchDashboardTab("main");
  });
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
  let category = "hybrid";

  const equityTypes = ["equity", "elss"];
  const debtTypes = ["debt", "income", "liquid", "gilt"];
  const hybridTypes = ["hybrid", "balanced", "commodities"];

  if (extendedData?.category) {
    const cat = extendedData.category.toLowerCase();
    if (equityTypes.includes(cat)) category = "equity";
    else if (debtTypes.includes(cat)) category = "debt";
    else if (hybridTypes.includes(cat)) {
      category = (
        extendedData?.second_category?.toLowerCase?.() ?? ""
      ).includes("debt")
        ? "debt"
        : "hybrid";
    }
  } else {
    const fundType = (fund.type || "").toLowerCase();
    if (fundType.includes("equity")) category = "equity";
    else if (fundType.includes("debt") || fundType.includes("income"))
      category = "debt";
  }

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
    currentValue = fund.valuation ? parseFloat(fund.valuation.value || 0) : 0;
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

  const activeFunds = Object.values(fundWiseData).filter(
    (fund) => fund.advancedMetrics?.currentValue > 0,
  );

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
  overlapData.topOverlaps = overlapData.fundPairs.slice(0, 10);

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
        holdingCounts.set(company, { count: 0, funds: [], totalWeight: 0 });
      }
      const data = holdingCounts.get(company);
      data.count++;
      data.funds.push(fundName);
      data.totalWeight += parseFloat(holding.corpus_per || 0);
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
      avgWeight: (data.totalWeight / data.count).toFixed(2),
    }))
    .sort((a, b) => b.fundCount - a.fundCount)
    .slice(0, 20);

  return overlapData;
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
    document.getElementById("asset-market-cap-split")?.classList.add("loading");
    document.getElementById("sectorCard")?.classList.add("loading");
    document.getElementById("amcCard")?.classList.add("loading");
    document.getElementById("holdingsCard")?.classList.add("loading");

    if (sectorChart) {
      sectorChart.destroy();
      sectorChart = null;
    }
    if (amcChart) {
      amcChart.destroy();
      amcChart = null;
    }
    if (holdingsChart) {
      holdingsChart.destroy();
      holdingsChart = null;
    }

    // Immediately clear asset allocation and market cap bar content so stale
    // data from a previous user doesn't show during the setTimeout delays.
    // Target wrappers directly — the canvas IDs may no longer exist if a
    // previous render already replaced the wrapper innerHTML with bar HTML.
    const assetCard = document.getElementById("assetAllocationCard");
    if (assetCard) {
      const assetWrapper = assetCard.querySelector(".chart-wrapper");
      if (assetWrapper)
        assetWrapper.innerHTML = '<canvas id="assetAllocationChart"></canvas>';
    }
    const mcapCard = document.getElementById("marketCapCard");
    if (mcapCard) mcapCard.innerHTML = '<canvas id="marketCapChart"></canvas>';

    setTimeout(() => {
      const analytics = calculatePortfolioAnalytics();

      setTimeout(() => {
        displayAssetAllocation(analytics.assetAllocation);
        displayMarketCapSplit(analytics.marketCap);
      }, 200);

      setTimeout(() => {
        displaySectorSplit(analytics.sector, analytics.totalValue);
      }, 100);

      setTimeout(() => {
        displayAMCSplit(analytics.amc, analytics.totalValue);
      }, 100);

      setTimeout(() => {
        displayHoldingsSplit(analytics.holdings, analytics.totalValue);
      }, 100);

      setTimeout(() => {
        displayWeightedReturns(analytics.weightedReturns);
      }, 100);
    }, 100);
  } catch (err) {
    console.error("Portfolio analytics failed:", err);
    document
      .getElementById("asset-market-cap-split")
      ?.classList.remove("loading");
    document.getElementById("sectorCard")?.classList.remove("loading");
    document.getElementById("amcCard")?.classList.remove("loading");
    document.getElementById("holdingsCard")?.classList.remove("loading");
  }
}

function calculatePortfolioAnalytics() {
  const result = {
    totalValue: 0,
    assetAllocation: {},
    marketCap: { large: 0, mid: 0, small: 0 },
    sector: {},
    amc: {},
    holdings: {},
    weightedReturns: { return1y: null, return3y: null, return5y: null },
  };

  // Get additional assets
  const additionalAssets = getAdditionalAssets();
  let additionalGoldValue = 0;
  let additionalSilverValue = 0;
  let additionalCashValue = 0;

  if (additionalAssets) {
    additionalGoldValue =
      additionalAssets.gold.quantity * additionalAssets.gold.rate;
    additionalSilverValue =
      additionalAssets.silver.quantity * additionalAssets.silver.rate;
    additionalCashValue = additionalAssets.cash;
  }

  // Object.values(fundWiseData).forEach((fund) => {
  //   const value = fund.valuation ? parseFloat(fund.valuation.value || 0) : 0;
  //   if (value > 0) result.totalValue += value;
  // });
  // ✅ After — use advancedMetrics.currentValue, same source used everywhere else
  Object.values(fundWiseData).forEach((fund) => {
    const value = parseFloat(fund.advancedMetrics?.currentValue || 0);
    if (value > 0) result.totalValue += value;
  });

  // Add additional assets to total
  const totalAdditional =
    additionalGoldValue + additionalSilverValue + additionalCashValue;
  const totalWithAdditional = result.totalValue + totalAdditional;

  if (totalWithAdditional === 0) return result;

  // Process MF funds with totalWithAdditional as base
  Object.values(fundWiseData).forEach((fund) => {
    const value = parseFloat(fund.advancedMetrics.currentValue || 0);
    if (!(value > 0)) return;

    const weight = value / totalWithAdditional; // CHANGED: Use totalWithAdditional instead of result.totalValue
    const extended = fund.isin ? mfStats[fund.isin] : null;

    const fundAsset = extended?.portfolio_stats?.asset_allocation;
    if (fundAsset) {
      Object.entries(fundAsset).forEach(([k, v]) => {
        if (v == null || isNaN(parseFloat(v)) || parseFloat(v) <= 0) return;
        const key = k.trim().toLowerCase();

        if (key.includes("equity")) {
          result.assetAllocation.equity =
            (result.assetAllocation.equity || 0) +
            (parseFloat(v) / 100) * weight * 100;
        } else if (key.includes("commodities")) {
          let goldWeight = 0;
          let silverWeight = 0;

          if (extended?.holdings && Array.isArray(extended.holdings)) {
            extended.holdings.forEach((holding) => {
              const companyName = (holding.company_name || "").toLowerCase();
              const instrumentName = (
                holding.instrument_name || ""
              ).toLowerCase();
              const holdingPercent = parseFloat(holding.corpus_per || 0);

              if (
                (companyName.includes("gold") ||
                  instrumentName.includes("gold")) &&
                (companyName.includes("etf") ||
                  instrumentName.includes("mutual fund"))
              ) {
                goldWeight += holdingPercent;
              } else if (
                (companyName.includes("silver") ||
                  instrumentName.includes("silver")) &&
                (companyName.includes("etf") ||
                  instrumentName.includes("mutual fund"))
              ) {
                silverWeight += holdingPercent;
              }
            });
          }

          const totalCommodityWeight = goldWeight + silverWeight;

          if (totalCommodityWeight > 0) {
            const goldProportion = goldWeight / totalCommodityWeight;
            const silverProportion = silverWeight / totalCommodityWeight;

            result.assetAllocation.gold =
              (result.assetAllocation.gold || 0) +
              (parseFloat(v) / 100) * weight * 100 * goldProportion;

            result.assetAllocation.silver =
              (result.assetAllocation.silver || 0) +
              (parseFloat(v) / 100) * weight * 100 * silverProportion;
          } else {
            const subcategory = extended?.sub_category?.toLowerCase?.() || "";
            const name = fund?.scheme?.toLowerCase?.() || "";

            let bucket = "debt";
            if (subcategory.includes("gold") || name.includes("gold")) {
              bucket = "gold";
            } else if (
              subcategory.includes("silver") ||
              name.includes("silver")
            ) {
              bucket = "silver";
            }

            result.assetAllocation[bucket] =
              (result.assetAllocation[bucket] || 0) +
              (parseFloat(v) / 100) * weight * 100;
          }
        } else {
          result.assetAllocation.debt =
            (result.assetAllocation.debt || 0) +
            (parseFloat(v) / 100) * weight * 100;
        }
      });
    } else {
      const category = (fund.type || fund.category || "").toLowerCase();
      if (category.includes("equity")) {
        result.assetAllocation.equity =
          (result.assetAllocation.equity || 0) + weight * 100;
      } else if (category.includes("debt") || category.includes("income")) {
        result.assetAllocation.debt =
          (result.assetAllocation.debt || 0) + weight * 100;
      } else {
        result.assetAllocation.other =
          (result.assetAllocation.other || 0) + weight * 100;
      }
    }

    const ps = extended?.portfolio_stats;
    if (
      ps?.large_cap !== undefined ||
      ps?.mid_cap !== undefined ||
      ps?.small_cap !== undefined
    ) {
      const l = parseFloat(ps.large_cap || 0);
      const m = parseFloat(ps.mid_cap || 0);
      const s = parseFloat(ps.small_cap || 0);
      const total = l + m + s || 100;

      result.marketCap.large += (l / total) * weight * 100;
      result.marketCap.mid += (m / total) * weight * 100;
      result.marketCap.small += (s / total) * weight * 100;
    } else if (ps?.market_cap_per) {
      const mp = ps.market_cap_per;
      const l = parseFloat(mp.large || 0);
      const m = parseFloat(mp.mid || 0);
      const s = parseFloat(mp.small || 0);
      const total = l + m + s || 100;

      result.marketCap.large += (l / total) * weight * 100;
      result.marketCap.mid += (m / total) * weight * 100;
      result.marketCap.small += (s / total) * weight * 100;
    } else {
      const name = (fund.scheme || "").toLowerCase();
      if (name.includes("small") || name.includes("smallcap")) {
        result.marketCap.small += weight * 100;
      } else if (name.includes("mid") || name.includes("midcap")) {
        result.marketCap.mid += weight * 100;
      } else {
        result.marketCap.large += weight * 100;
      }
    }

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

    const amcName = standardizeTitle(
      extended?.amc ?? fund.amc ?? "Unknown AMC",
    );
    result.amc[amcName] = (result.amc[amcName] || 0) + weight * 100;

    if (
      fund.holdings &&
      Array.isArray(fund.holdings) &&
      fund.holdings.length > 0
    ) {
      let fundHoldingsTotal = 0;
      fund.holdings.forEach((holding) => {
        const holdingWeight = parseFloat(holding.corpus_per || 0);
        fundHoldingsTotal += holdingWeight;
      });

      fund.holdings.forEach((holding) => {
        const companyName = holding.company_name || "Unknown";
        const holdingWeight = parseFloat(holding.corpus_per || 0);

        if (holdingWeight > 0) {
          const portfolioWeight = (holdingWeight / 100) * weight * 100;

          if (!result.holdings[companyName]) {
            result.holdings[companyName] = {
              percentage: 0,
              nature: holding.nature_name || "Unknown",
              sector: holding.sector_name || "Unknown",
              instrument: holding.instrument_name || "Unknown",
            };
          }
          result.holdings[companyName].percentage += portfolioWeight;
        }
      });

      if (fundHoldingsTotal < 100 && fundHoldingsTotal > 0) {
        const remainingPercentage = 100 - fundHoldingsTotal;
        const portfolioWeight = (remainingPercentage / 100) * weight * 100;

        const cashDebtKey = "Cash Equivalents";
        if (!result.holdings[cashDebtKey]) {
          result.holdings[cashDebtKey] = {
            percentage: 0,
            nature: "Debt",
            sector: "Cash",
            instrument: "Cash Equivalents",
          };
        }
        result.holdings[cashDebtKey].percentage += portfolioWeight;
      }
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

  // NOW add additional assets to allocation (ONLY ONCE, AT THE END)
  if (additionalGoldValue > 0) {
    const goldWeight = (additionalGoldValue / totalWithAdditional) * 100;

    // Store breakdown info
    if (!result.assetAllocation._breakdown) {
      result.assetAllocation._breakdown = {};
    }
    if (!result.assetAllocation._breakdown.gold) {
      result.assetAllocation._breakdown.gold = { mf: 0, physical: 0 };
    }

    // Store MF gold percentage BEFORE adding physical
    result.assetAllocation._breakdown.gold.mf =
      result.assetAllocation.gold || 0;

    // Add physical gold
    result.assetAllocation.gold =
      (result.assetAllocation.gold || 0) + goldWeight;

    // Store physical gold percentage
    result.assetAllocation._breakdown.gold.physical = goldWeight;
  }

  if (additionalSilverValue > 0) {
    const silverWeight = (additionalSilverValue / totalWithAdditional) * 100;

    // Store breakdown info
    if (!result.assetAllocation._breakdown) {
      result.assetAllocation._breakdown = {};
    }
    if (!result.assetAllocation._breakdown.silver) {
      result.assetAllocation._breakdown.silver = { mf: 0, physical: 0 };
    }

    // Store MF silver percentage BEFORE adding physical
    result.assetAllocation._breakdown.silver.mf =
      result.assetAllocation.silver || 0;

    // Add physical silver
    result.assetAllocation.silver =
      (result.assetAllocation.silver || 0) + silverWeight;

    // Store physical silver percentage
    result.assetAllocation._breakdown.silver.physical = silverWeight;
  }

  if (additionalCashValue > 0) {
    const cashWeight = (additionalCashValue / totalWithAdditional) * 100;

    // Store breakdown info
    if (!result.assetAllocation._breakdown) {
      result.assetAllocation._breakdown = {};
    }
    if (!result.assetAllocation._breakdown.cash) {
      result.assetAllocation._breakdown.cash = { mf: 0, physical: 0 };
    }

    // Store MF cash percentage BEFORE adding physical
    result.assetAllocation._breakdown.cash.mf =
      result.assetAllocation.cash || 0;

    // Add physical cash
    result.assetAllocation.cash =
      (result.assetAllocation.cash || 0) + cashWeight;

    // Store physical cash percentage
    result.assetAllocation._breakdown.cash.physical = cashWeight;
  }

  result.assetAllocation.equity = result.assetAllocation.equity || 0;
  result.assetAllocation.debt = result.assetAllocation.debt || 0;
  result.assetAllocation.cash = result.assetAllocation.cash || 0;
  result.assetAllocation.other = result.assetAllocation.other || 0;

  // Rest of the function remains the same...
  const mcSum =
    result.marketCap.large + result.marketCap.mid + result.marketCap.small;
  if (mcSum > 0) {
    result.marketCap.large = (result.marketCap.large / mcSum) * 100;
    result.marketCap.mid = (result.marketCap.mid / mcSum) * 100;
    result.marketCap.small = (result.marketCap.small / mcSum) * 100;
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

  result.assetAllocation = roundMap(result.assetAllocation);
  result.marketCap = roundMap(result.marketCap);
  result.sector = roundMap(result.sector);
  result.amc = roundMap(result.amc);

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
    "equity",
    "debt",
    "gold",
    "silver",
    "commodities",
    "real estate",
    "cash",
    "other",
  ];

  const labels = [];
  const data = [];

  // Preferred order first
  preferred.forEach((k) => {
    const val = parseFloat(assetAllocation[k]);
    if (!isNaN(val) && val > 0) {
      labels.push(k.charAt(0).toUpperCase() + k.slice(1));
      data.push(val);
    }
  });

  // Any extra asset types (excluding _breakdown)
  Object.keys(assetAllocation).forEach((k) => {
    if (!preferred.includes(k) && k !== "_breakdown") {
      const val = parseFloat(assetAllocation[k]);
      if (!isNaN(val) && val > 0) {
        labels.push(k.charAt(0).toUpperCase() + k.slice(1));
        data.push(val);
      }
    }
  });

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    const container = document.getElementById("asset-market-cap-split");
    if (!container) return;

    const chartCanvas = document.getElementById("assetAllocationChart");
    if (!chartCanvas) return;

    if (sortedLabels.length === 0) {
      chartCanvas.parentElement.innerHTML =
        '<div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>';
      container.classList.remove("loading");
      return;
    }

    const additionalAssets = getAdditionalAssets();

    // Total value from funds
    let totalValue = Object.values(fundWiseData).reduce(
      (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
      0,
    );

    // Add manual assets (gold, silver, cash)
    if (additionalAssets) {
      totalValue +=
        additionalAssets.gold.quantity * additionalAssets.gold.rate +
        additionalAssets.silver.quantity * additionalAssets.silver.rate +
        additionalAssets.cash;
    }

    const barHTML = sortedLabels
      .map((label, i) => {
        const color = themeColors[i % themeColors.length];
        const rupeeValue = (totalValue * sortedData[i]) / 100;

        return `
          <div class="composition-segment"
               style="width: ${sortedData[i]}%; background-color: ${color};"
               title="${label}: ₹${formatNumber(
                 Math.round(rupeeValue),
               )} (${sortedData[i].toFixed(1)}%)">
          </div>`;
      })
      .join("");

    const legendHTML = sortedLabels
      .map((label, i) => {
        const color = themeColors[i % themeColors.length];

        return `
          <span class="legend-item">
            <span class="legend-color" style="background-color: ${color};"></span>
            ${label} ${sortedData[i].toFixed(1)}%
          </span>`;
      })
      .join("");

    chartCanvas.parentElement.innerHTML = `
      <div class="fund-composition-chart">
        <div class="composition-bar">${barHTML}</div>
        <div class="composition-legend">${legendHTML}</div>
      </div>
    `;

    container.classList.remove("loading");
  }, 50);
}

function displayMarketCapSplit(marketCap) {
  const labels = ["Large", "Mid", "Small", "Other"].filter((k) => {
    const val = marketCap[k.toLowerCase()];
    return val !== undefined && parseFloat(val) > 0;
  });
  const data = labels.map((l) => marketCap[l.toLowerCase()]);

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    const container = document.getElementById("asset-market-cap-split");
    if (!container) return;

    const chartCanvas = document.getElementById("marketCapChart");
    if (!chartCanvas) return;

    if (sortedLabels.length === 0) {
      chartCanvas.parentElement.innerHTML =
        '<div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>';
      container.classList.remove("loading");
      return;
    }

    // Calculate total value for tooltip
    const totalValue = Object.values(fundWiseData).reduce(
      (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
      0,
    );

    const barHTML = sortedLabels
      .map((label, i) => {
        const color = themeColors[i % themeColors.length];
        const rupeeValue = (totalValue * sortedData[i]) / 100;
        return `
          <div class="composition-segment"
               style="width: ${sortedData[i]}%; background-color: ${color};"
               title="${label}: ₹${formatNumber(
                 Math.round(rupeeValue),
               )} (${sortedData[i].toFixed(1)}%)">
          </div>`;
      })
      .join("");

    const legendHTML = sortedLabels
      .map((label, i) => {
        const color = themeColors[i % themeColors.length];
        return `
          <span class="legend-item">
            <span class="legend-color" style="background-color: ${color};"></span>${label}: ${sortedData[
              i
            ].toFixed(1)}%
          </span>`;
      })
      .join("");

    chartCanvas.parentElement.innerHTML = `
      <div class="fund-composition-chart">
        <div class="composition-bar">${barHTML}</div>
        <div class="composition-legend">${legendHTML}</div>
      </div>
    `;

    setTimeout(() => {
      container.classList.remove("loading");
    }, 150);
  }, 50);
}

function displaySectorSplit(sectorObj, totalValue) {
  let entries = Object.entries(sectorObj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 10);
  const rest = entries.slice(10);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);
  if (othersValue > 0) top.push(["Others", othersValue]);

  const filteredTop = top.filter(([name, value]) => {
    return value >= 1;
  });

  const labels = filteredTop.map(([name]) => name);
  const data = filteredTop.map(([_, val]) => val);

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    sectorChart = buildBarChart(
      "sectorChart",
      sortedLabels,
      sortedData,
      totalValue,
    );

    setTimeout(() => {
      const sectorCard = document.getElementById("sectorCard");
      if (!sectorCard) return;

      sectorCard.classList.remove("loading");

      const nonZeroEntries = entries.filter(([_, v]) => v > 0);
      const onlyUnclassified =
        nonZeroEntries.length === 1 &&
        nonZeroEntries[0][0].toLowerCase() === "unclassified";

      if (onlyUnclassified) {
        sectorCard.classList.add("hidden");
      } else {
        sectorCard.classList.remove("hidden");
      }
    }, 150);
  }, 50);
}

function displayAMCSplit(amcObj, totalValue) {
  let entries = Object.entries(amcObj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 10);
  const rest = entries.slice(10);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);
  if (othersValue > 0) top.push(["Others", othersValue]);

  const cleaned = top.map(([name, value]) => {
    let shortName = name
      .replace(/mutual\s*fund/gi, "")
      .replace(/\bmf\b/gi, "")
      .trim();
    return [shortName, value];
  });

  const labels = cleaned.map(([n]) => n);
  const data = cleaned.map(([_, v]) => v);

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    amcChart = buildBarChart("amcChart", sortedLabels, sortedData, totalValue);

    setTimeout(() => {
      document.getElementById("amcCard")?.classList.remove("loading");
    }, 150);
  }, 50);
}
function displayHoldingsSplit(holdingsObj, totalValue) {
  let entries = Object.entries(holdingsObj)
    .filter(([company]) => company !== "Cash Equivalents")
    .map(([company, data]) => [company, data.percentage])
    .sort((a, b) => b[1] - a[1]);

  const top = entries.slice(0, 10);

  const labels = top.map(([name]) => name);
  const data = top.map(([_, val]) => val);

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    holdingsChart = buildBarChart(
      "holdingsChart",
      sortedLabels,
      sortedData,
      totalValue,
    );

    setTimeout(() => {
      document.getElementById("holdingsCard")?.classList.remove("loading");
    }, 150);
  }, 50);
}
function displayWeightedReturns(wr) {
  const container = document.getElementById("weightedReturnsContainer");
  if (!container) {
    console.warn("weightedReturnsContainer not found");
    return;
  }
  container.innerHTML = "";

  const cards = [
    { key: "return1y", title: "1Y Weighted Return" },
    { key: "return3y", title: "3Y Weighted Return" },
    { key: "return5y", title: "5Y Weighted Return" },
  ];

  cards.forEach((c) => {
    const val = wr[c.key];
    const card = document.createElement("div");
    card.className = "return-card";

    const display = val === null || isNaN(val) ? "--" : `${val}%`;
    const cls = val === null ? "" : val >= 0 ? "positive" : "negative";

    card.innerHTML = `
      <h4>${c.title}</h4>
      <div class="return-value ${cls}">${display}</div>
    `;

    container.appendChild(card);
  });
}

// DISPLAY FUNCTIONS - CAPITAL GAINS
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

  let html = `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>📊 Current Financial Year (${currentFY})</h3>
        <p class="section-subtitle">Tax applicable on capital gains for redemptions in ${currentFY}</p>
      </div>
  `;

  if (hasCurrentYearData) {
    html += `
      <div class="gains-table-wrapper">
        <h4>STCG (Short Term Capital Gains)</h4>
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
      const data = capitalGainsData.currentYear[cat];
      const taxRate = cat === "equity" ? "20%" : "As per slab";
      const holdingPeriod = cat === "equity" ? "< 1Y" : "< 2Y";
      const hasData = data.stcg !== 0 || data.stcgRedeemed !== 0;

      html += `
        <tr>
          <td>${
            cat.charAt(0).toUpperCase() + cat.slice(1)
          } (${holdingPeriod})</td>
          <td class="${!hasData ? "" : data.stcg >= 0 ? "gain" : "loss"}">
            ${"₹" + formatNumber(hasData ? Math.abs(data.stcg) : 0)}
          </td>
          <td>${"₹" + formatNumber(hasData ? data.stcgRedeemed : 0)}</td>
          <td>${taxRate}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>

        <h4>LTCG (Long Term Capital Gains)</h4>
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
      const data = capitalGainsData.currentYear[cat];
      const taxRate = cat === "debt" ? "As per slab" : "12.5% (>₹1.25L)";
      const holdingPeriod = cat === "equity" ? "≥ 1Y" : "≥ 2Y";
      const hasData = data.ltcg !== 0 || data.ltcgRedeemed !== 0;

      html += `
        <tr>
          <td>${
            cat.charAt(0).toUpperCase() + cat.slice(1)
          } (${holdingPeriod})</td>
          <td class="${!hasData ? "" : data.ltcg >= 0 ? "gain" : "loss"}">
            ${"₹" + formatNumber(hasData ? Math.abs(data.ltcg) : 0)}
          </td>
          <td>${"₹" + formatNumber(hasData ? data.ltcgRedeemed : 0)}</td>
          <td>${taxRate}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;
  } else {
    html += `<p class="no-data">No redemptions in ${currentFY}</p>`;
  }
  html += `</div>`;

  // Get all transactions
  const allTransactions = getCapitalGainsTransactions();

  // Financial Year-wise breakdown with transactions
  const years = Object.keys(capitalGainsData.byYear).sort((a, b) => {
    const aNum = parseInt(a.split(" ")[1].split("-")[0]);
    const bNum = parseInt(b.split(" ")[1].split("-")[0]);
    return bNum - aNum;
  });

  // Determine which FY to show by default
  let defaultFY = currentFY;
  if (!hasCurrentYearData && years.length > 0) {
    // If current FY has no data, use the most recent FY with data
    defaultFY = years[0];
  }

  if (years.length > 0) {
    html += `
      <div class="capital-gains-section">
        <div class="section-header">
          <h3>📅 Financial Year-wise Breakdown</h3>
          <p class="section-subtitle">Historical capital gains across all financial years</p>
        </div>
        <div class="cg-pill-bar" id="capitalGainsYearPills">
    `;

    years.forEach((fy) => {
      // 🔧 FIX: Add active class to defaultFY
      html += `
        <button class="cg-pill ${fy === defaultFY ? "active" : ""}"
                onclick="showYearGainsWithTransactions('${fy}')">
          ${fy}
        </button>
      `;
    });

    html += `</div><div id="yearGainsDisplay"></div></div>`;
  }

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
    html += `<div class="gains-summary-grid alltime-summary-grid">`;

    ["equity", "debt", "hybrid"].forEach((cat) => {
      const data = capitalGainsData.allTime[cat];
      const totalGains = data.stcg + data.ltcg;
      const totalRedeemed = data.stcgRedeemed + data.ltcgRedeemed;
      if (totalGains !== 0 || totalRedeemed !== 0) {
        html += `
        <div class="gains-summary-card">
          <h4>${cat.charAt(0).toUpperCase() + cat.slice(1)}</h4>
          <div class="summary-row">
            <span>STCG:</span>
            <span class="${data.stcg >= 0 ? "gain" : "loss"}">₹${formatNumber(
              Math.abs(data.stcg),
            )}</span>
          </div>
          <div class="summary-row">
            <span>LTCG:</span>
            <span class="${data.ltcg >= 0 ? "gain" : "loss"}">₹${formatNumber(
              Math.abs(data.ltcg),
            )}</span>
          </div>
          <div class="summary-row total">
            <span>Total Gains:</span>
            <span class="${totalGains >= 0 ? "gain" : "loss"}">₹${formatNumber(
              Math.abs(totalGains),
            )}</span>
          </div>
          <div class="summary-row">
            <span>Total Redeemed:</span>
            <span>₹${formatNumber(totalRedeemed)}</span>
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

  container.innerHTML = html;

  // Show defaultFY by default (current FY or most recent with data)
  if (years.length > 0) {
    showYearGainsWithTransactions(defaultFY);
  }
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
      const taxRate = cat === "debt" ? "As per slab" : "12.5% (>₹1.25L)";
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
  if (!yearData) return;

  // Update button states
  document.querySelectorAll(".cg-pill").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.textContent.trim() === fy) {
      btn.classList.add("active");
    }
  });

  const display = document.getElementById("yearGainsDisplay");

  // Get transactions for this FY
  const allTransactions = getCapitalGainsTransactions();
  const fyTransactions = allTransactions.filter((tx) => tx.fy === fy);

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
    const taxRate = cat === "equity" ? "20%" : "As per slab";
    const holdingPeriod = cat === "equity" ? "< 1Y" : "< 2Y";
    const hasData = data.stcg !== 0 || data.stcgRedeemed !== 0;

    html += `
      <tr>
        <td>${
          cat.charAt(0).toUpperCase() + cat.slice(1)
        } (${holdingPeriod})</td>
        <td class="${!hasData ? "" : data.stcg >= 0 ? "gain" : "loss"}">
          ${"₹" + formatNumber(hasData ? Math.abs(data.stcg) : 0)}
        </td>
        <td>${"₹" + formatNumber(hasData ? data.stcgRedeemed : 0)}</td>
        <td>${taxRate}</td>
      </tr>
    `;
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
    const taxRate = cat === "debt" ? "As per slab" : "12.5% (>₹1.25L)";
    const holdingPeriod = cat === "equity" ? "≥ 1Y" : "≥ 2Y";
    const hasData = data.ltcg !== 0 || data.ltcgRedeemed !== 0;

    html += `
      <tr>
        <td>${
          cat.charAt(0).toUpperCase() + cat.slice(1)
        } (${holdingPeriod})</td>
        <td class="${!hasData ? "" : data.ltcg >= 0 ? "gain" : "loss"}">
          ${"₹" + formatNumber(hasData ? Math.abs(data.ltcg) : 0)}
        </td>
        <td>${"₹" + formatNumber(hasData ? data.ltcgRedeemed : 0)}</td>
        <td>${taxRate}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  // Add detailed transactions table for this FY
  if (fyTransactions.length > 0) {
    html += `
    <div style="margin-top: 30px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding:10px;">
        <h4>Detailed Transactions for ${fy}</h4>
        <button class="secondary-btn" onclick="downloadFYCapitalGainsReport('${fy}')">
          📥 Download ${fy} Report
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
function displayOverlapAnalysis() {
  const container = document.getElementById("overlapContent");
  const data = calculateOverlapAnalysis();

  const sectionHead = `
    <div class="cg-section-head">
      <div class="cg-section-title"><i class="fa-solid fa-layer-group"></i><h3>Fund Overlap Analysis</h3></div>
      <span class="cg-section-subtitle">Identify duplicate holdings</span>
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

    data.topOverlaps.forEach((pair) => {
      const pctClass =
        pair.overlapPercent > 50
          ? "loss"
          : pair.overlapPercent > 25
            ? "warning"
            : "gain";
      html += `
        <div class="overlap-pair-row">
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
  }

  // Common holdings
  if (hasCommonHoldings) {
    html += `<div class="cg-sub-title" style="margin-top:${hasOverlapData ? "0" : "0"};">Stocks Common Across Multiple Funds</div>`;

    // mini header
    html += `
      <div class="common-holding-row" style="background:rgba(102,126,234,0.04);border-bottom:1px solid rgba(102,126,234,0.1);">
        <span class="common-holding-name" style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-tertiary);">Company</span>
        <span class="common-holding-count" style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-tertiary);"># Funds</span>
        <span class="common-holding-weight" style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-tertiary);">Avg Wt.</span>
        <span class="common-holding-funds" style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-tertiary);">Funds</span>
      </div>`;

    data.commonHoldings.forEach((holding) => {
      html += `
        <div class="common-holding-row">
          <span class="common-holding-name">${holding.company}</span>
          <span class="common-holding-count">${holding.fundCount}</span>
          <span class="common-holding-weight">${holding.avgWeight}%</span>
          <span class="common-holding-funds">${holding.funds.join(", ")}</span>
        </div>`;
    });
  }

  html += `</div>`;
  container.innerHTML = html;
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

  section.innerHTML = `
    <div class="monthly-summary-container">
      <div class="section-header">
        <h3>📅 Transaction Calendar</h3>
        <p class="section-subtitle">Days you invested (green) or withdrew (red)</p>
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
      
      <div class="summary-table-wrapper">
        <table class="gains-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Avg Buy</th>
              <th>Avg Sell</th>
              <th>Avg Net Inflow</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Last 6 Months</strong></td>
              <td>₹${formatNumber(Math.round(summary.sixMonths.avgBuy))}</td>
              <td>₹${formatNumber(Math.round(summary.sixMonths.avgSell))}</td>
              <td class="${summary.sixMonths.avgNetInflow >= 0 ? "gain" : "loss"}">
                ₹${formatNumber(Math.round(Math.abs(summary.sixMonths.avgNetInflow)))}
              </td>
            </tr>
            <tr>
              <td><strong>Last 12 Months</strong></td>
              <td>₹${formatNumber(Math.round(summary.twelveMonths.avgBuy))}</td>
              <td>₹${formatNumber(
                Math.round(summary.twelveMonths.avgSell),
              )}</td>
              <td class="${summary.twelveMonths.avgNetInflow >= 0 ? "gain" : "loss"}">
                ₹${formatNumber(
                  Math.round(Math.abs(summary.twelveMonths.avgNetInflow)),
                )}
              </td>
            </tr>
          </tbody>
        </table>
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

  const colors = getChartColors();
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
  // Get additional assets
  const assets = getAdditionalAssets();
  const hasAdditionalAssets =
    assets &&
    (assets.gold.quantity * assets.gold.rate > 0 ||
      assets.silver.quantity * assets.silver.rate > 0 ||
      assets.cash > 0);

  const goldValue = assets ? assets.gold.quantity * assets.gold.rate : 0;
  const silverValue = assets ? assets.silver.quantity * assets.silver.rate : 0;
  const cashValue = assets ? assets.cash : 0;
  const totalAdditional = goldValue + silverValue + cashValue;
  const combinedValue = summary.currentValue + totalAdditional;

  // Dynamically update first card based on additional assets
  const summaryCardsContainer = document.querySelector("#main .summary-cards");
  const firstCard = summaryCardsContainer.querySelector(".card:first-child");

  if (hasAdditionalAssets) {
    // Show Total Portfolio card
    firstCard.innerHTML = `
      <h3>Total Portfolio Value</h3>
      <div class="value">₹${formatNumber(combinedValue)}</div>
      <div class="subtext">MF: ₹${formatNumber(
        summary.currentValue,
      )} + Additional: ₹${formatNumber(totalAdditional)}</div>
    `;
  } else {
    // Show Current Value card
    firstCard.innerHTML = `
      <h3>Current Value</h3>
      <div class="value">₹<span id="currentValue">${formatNumber(
        summary.currentValue,
      )}</span></div>
      <div class="subtext">MF Holdings Value</div>
    `;
  }

  // Update all other cards (existing code)
  document.getElementById("totalInvested").textContent = formatNumber(
    summary.totalInvested,
  );
  if (!hasAdditionalAssets) {
    document.getElementById("currentValue").textContent = formatNumber(
      summary.currentValue,
    );
  }
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
}

function updateGainCard(valueId, percentId, gain, percent, xirr) {
  const el = document.getElementById(valueId);
  el.textContent = (gain >= 0 ? "₹" : "-₹") + formatNumber(Math.abs(gain));
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
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase(),
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

  fundsArray.forEach(([fundKey, fund]) => {
    const card = createSummaryFundCard(fund, fundKey);
    currentGrid.appendChild(card);
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
  const pnlSub = `${pnl >= 0 ? "▲" : "▼"} ${Math.abs(pnlPct)}%`;

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
      <span class="folio-card-meta-value">${averageHoldingDays ? Math.round(averageHoldingDays) + "d" : "--"}</span>
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
      </div>
      <div class="folio-card-hero-cell ${pnlHeroClass}">
        <span class="folio-card-hero-label">P&amp;L</span>
        <span class="folio-card-hero-value ${pnlClass}">${pnlSign}₹${formatNumber(Math.abs(pnl))}</span>
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
  const card = document.createElement("div");
  card.className = "folio-card";

  const extendedData = mfStats[fund.isin];
  const displayName = fund.schemeDisplay || fund.scheme;

  const currentValue = fund.advancedMetrics.currentValue;
  const cost = fund.advancedMetrics.remainingCost;
  const unrealizedGain = fund.advancedMetrics.unrealizedGain;
  const unrealizedGainPercentage =
    fund.advancedMetrics.unrealizedGainPercentage;
  const units = fund.advancedMetrics.totalUnitsRemaining;
  const avgNav = fund.advancedMetrics.averageRemainingCostPerUnit;

  function roundValue(val) {
    if (val === null || val === undefined) return "--";
    if (typeof val === "number") return Math.round(val * 100) / 100;
    return val;
  }

  card.innerHTML = `
    <h4 title="${displayName}">${displayName}</h4>
    <div class="folio-info">
      ${standardizeTitle(fund.amc)}${
        fund.folios.length > 0
          ? " • " + fund.folios.map((f) => f.split("/")[0].trim()).join(", ")
          : ""
      }</div>
    <div class="folio-stat"><span class="label">Current Value:</span><span class="value">₹${formatNumber(
      currentValue,
    )}</span></div>
    <div class="folio-stat"><span class="label">Current Cost:</span><span class="value">₹${formatNumber(
      cost,
    )}</span></div>
    <div class="folio-stat fund-card-separator-space"><span class="label">P&L:</span><span class="value ${
      unrealizedGain >= 0 ? "gain" : "loss"
    }">₹${formatNumber(
      Math.abs(unrealizedGain),
    )} (${unrealizedGainPercentage}%)</span></div>
    ${
      currentValue > 0
        ? `<div class="fund-card-actions">
      <button class="fund-action-btn primary" onclick="showFundDetailsModal('${fundKey}')">
        <i class="fa-solid fa-chart-line"></i> View Details
      </button>
      ${
        extendedData && fund.holdings && fund.holdings.length > 0
          ? `
      <button class="fund-action-btn secondary" onclick="event.stopPropagation(); showFundHoldings('${fundKey}')">
        <i class="fa-solid fa-eye"></i> Holdings (${fund.holdings.length})
      </button>
      `
          : ""
      }`
        : ""
    }
    </div>
  `;

  return card;
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
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase(),
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
    xirr = calc.calculateXIRR();
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

  // Build Folios section HTML before modal.innerHTML (avoids nested template literal issues)
  let foliosSectionHTML = "";
  const _folioSummaries = fund.advancedMetrics?.folioSummaries;
  if (_folioSummaries && displayFolios.length >= 2) {
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
          (folioIsPast ? "Realized P&L" : "P&L") +
          "</span>" +
          '<span class="folio-compact-cell-value ' +
          pnlClass +
          '">' +
          (pnl >= 0 ? "+" : "-") +
          "₹" +
          formatNumber(Math.abs(pnl)) +
          ' <span class="folio-compact-pct">(' +
          Math.abs(pnlPct) +
          "%)</span>" +
          "</span>" +
          "</div>" +
          (!isPastHolding
            ? '<div class="folio-compact-cell folio-compact-cell--hold">' +
              '<span class="folio-compact-cell-label">Avg Hold</span>' +
              '<span class="folio-compact-cell-value">' +
              (holdingDays === "--" ? "--" : holdingDays + "d") +
              "</span>" +
              "</div>"
            : "") +
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
        <h2>${displayName}</h2>
        <button class="modal-close" onclick="closeFundDetailsModal()">✕</button>
      </div>
      <div class="modal-content fund-details-content">
        
        <!-- Summary Stats Section (Compact Redesign) -->
        <div class="fund-summary-compact">

          <!-- Meta bar: AMC + Folios -->
          <div class="fund-summary-meta-bar">
            <div class="fund-summary-meta-item">
              <span class="fund-summary-meta-label">AMC</span>
              <span class="fund-summary-meta-value">${standardizeTitle(fund.amc)}</span>
            </div>
            <div class="fund-summary-meta-divider"></div>
            <div class="fund-summary-meta-item">
              <span class="fund-summary-meta-label">FOLIOS</span>
              <div class="fund-summary-folio-chips">
                ${displayFolios.map((f) => `<span class="fund-summary-folio-chip">${f.split("/")[0].trim()}</span>`).join("")}
              </div>
            </div>
          </div>

          <!-- Hero row: 3 primary financial metrics -->
          <div class="fund-summary-hero-row">
            <div class="fund-summary-hero-card">
              <span class="fund-summary-hero-label">${isPastHolding ? "Total Withdrawn" : "Current Value"}</span>
              <span class="fund-summary-hero-value">₹${formatNumber(isPastHolding ? cost + unrealizedGain : current)}</span>
            </div>
            <div class="fund-summary-hero-card fund-summary-hero-card--pnl ${unrealizedGain >= 0 ? "gain" : "loss"}">
              <span class="fund-summary-hero-label">P&amp;L</span>
              <span class="fund-summary-hero-value">
                ${unrealizedGain >= 0 ? "+" : "-"}₹${formatNumber(Math.abs(unrealizedGain))}
              </span>
              <span class="fund-summary-hero-sub">${unrealizedGain >= 0 ? "▲" : "▼"} ${Math.abs(unrealizedGainPercentage)}%</span>
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
              <span class="fund-summary-chip-label">Avg NAV</span>
              <span class="fund-summary-chip-value">${roundValue(avgNav)}</span>
            </div>
            ${
              !isPastHolding
                ? `
            <div class="fund-summary-chip">
              <span class="fund-summary-chip-label">Avg Hold</span>
              <span class="fund-summary-chip-value">${roundValue(avgHoldingDays) === "--" ? "--" : roundValue(avgHoldingDays) + "d"}</span>
            </div>`
                : ""
            }
          </div>

        </div>

        <!-- Folios Section -->
        ${foliosSectionHTML}

        <!-- Charts Row - Side by side on desktop, stacked on mobile -->
        <div class="fund-details-charts-row">

          <!-- Valuation History -->
          <div class="fund-chart-card">
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
              ? `
          <!-- Performance Comparison -->
          <div class="fund-chart-card">
            <div class="fund-chart-card-header">
              <span class="fund-chart-card-icon">📊</span>
              <span class="fund-chart-card-title">Performance Comparison</span>
              <div class="fund-chart-legend-pills">
                <span class="fund-chart-legend-pill" style="--pill-color:#3b82f6">Fund</span>
                <span class="fund-chart-legend-pill" style="--pill-color:#10b981">Category</span>
                <span class="fund-chart-legend-pill" style="--pill-color:#f59e0b">Benchmark</span>
              </div>
            </div>
            <div class="fund-chart-canvas-wrapper">
              <canvas id="modalFundPerformanceChart"></canvas>
            </div>
          </div>
          `
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
              <div class="fund-composition-col-label">Asset Alloc.</div>
              <div class="fund-composition-col-body">
                <canvas id="modalAssetAllocationChart" style="display:none"></canvas>
                <div id="modalAssetAllocationBar"></div>
              </div>
            </div>
            <div class="fund-composition-col-divider"></div>
            <div class="fund-composition-col">
              <div class="fund-composition-col-label">Market Cap</div>
              <div class="fund-composition-col-body">
                <canvas id="modalMarketCapChart" style="display:none"></canvas>
                <div id="modalMarketCapBar"></div>
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
            <span class="fund-stats-header-icon">📉</span>
            <span class="fund-stats-header-title">Fund Statistics</span>
            <div class="fund-stats-header-badges">
              ${extendedData.groww_rating ? `<span class="fund-stats-rating-badge">★ ${roundValue(extendedData.groww_rating)}</span>` : ""}
              ${extendedData.expense_ratio ? `<span class="fund-stats-expense-badge">Exp: ${roundValue(extendedData.expense_ratio)}%</span>` : ""}
              ${extendedData.aum ? `<span class="fund-stats-aum-badge">AUM ₹${formatNumber(roundValue(extendedData.aum))}Cr</span>` : ""}
            </div>
          </div>

          <!-- Returns row -->
          <div class="fund-stats-group fund-stats-group--returns">
            <div class="fund-stats-group-label">Returns</div>
            <div class="fund-stats-group-cells">
              <div class="fund-stats-cell fund-stats-cell--return">
                <span class="fund-stats-cell-label">1Y</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.return1y) === "--" ? "--" : roundValue(extendedData.return_stats?.return1y) + "%"}</span>
              </div>
              <div class="fund-stats-cell fund-stats-cell--return">
                <span class="fund-stats-cell-label">3Y</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.return3y) === "--" ? "--" : roundValue(extendedData.return_stats?.return3y) + "%"}</span>
              </div>
              <div class="fund-stats-cell fund-stats-cell--return">
                <span class="fund-stats-cell-label">5Y</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.return5y) === "--" ? "--" : roundValue(extendedData.return_stats?.return5y) + "%"}</span>
              </div>
            </div>
          </div>

          <!-- Risk ratios row -->
          <div class="fund-stats-group fund-stats-group--risk">
            <div class="fund-stats-group-label">Risk</div>
            <div class="fund-stats-group-cells">
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Alpha</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.alpha)}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Beta</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.beta)}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Sharpe</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.sharpe_ratio)}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Sortino</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.sortino_ratio)}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Info Ratio</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.information_ratio)}</span>
              </div>
              <div class="fund-stats-cell">
                <span class="fund-stats-cell-label">Std Dev</span>
                <span class="fund-stats-cell-value">${roundValue(extendedData.return_stats?.standard_deviation)}</span>
              </div>
            </div>
          </div>

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
            <button class="fund-quick-action-btn" onclick="showFundTransactions('${fundKey}', '${fund.folios.join(",")}')">
              <i class="fa-solid fa-exchange-alt"></i>
              <span>View Transactions</span>
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
      renderModalFundPerformanceChart(
        fundKey,
        extendedData,
        fund.benchmark_returns,
      );
      renderModalCompositionCharts(fundKey, extendedData);
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
function renderModalFundValuationChart(fundKey, initialPeriod = "ALL") {
  const fund = fundWiseData[fundKey];
  const dailyValuation = fund.advancedMetrics?.dailyValuation;

  if (!dailyValuation || dailyValuation.length === 0) return;

  const canvas = document.getElementById("modalFundValuationChart");
  if (!canvas) return;

  const colors = getChartColors();
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

  const colors = getChartColors();
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

function renderModalCompositionCharts(fundKey, extendedData) {
  const ps = extendedData?.portfolio_stats;
  if (!ps) return;

  // ============ ASSET ALLOCATION CHART ============
  const assetBarEl = document.getElementById("modalAssetAllocationBar");
  if (assetBarEl) {
    const rawAsset = ps.asset_allocation || {};
    let equity = 0,
      debt = 0,
      gold = 0,
      silver = 0;

    Object.entries(rawAsset).forEach(([key, value]) => {
      const val = parseFloat(value);
      if (isNaN(val) || val <= 0) return;

      const k = key.toLowerCase();

      if (k.includes("equity")) {
        equity += val;
      } else if (k.includes("commodities")) {
        // Check holdings to split commodities between gold and silver
        let goldWeight = 0;
        let silverWeight = 0;

        if (extendedData?.holdings && Array.isArray(extendedData.holdings)) {
          extendedData.holdings.forEach((holding) => {
            const companyName = (holding.company_name || "").toLowerCase();
            const instrumentName = (
              holding.instrument_name || ""
            ).toLowerCase();
            const holdingPercent = parseFloat(holding.corpus_per || 0);

            if (
              (companyName.includes("gold") ||
                instrumentName.includes("gold")) &&
              (companyName.includes("etf") ||
                instrumentName.includes("mutual fund"))
            ) {
              goldWeight += holdingPercent;
            } else if (
              (companyName.includes("silver") ||
                instrumentName.includes("silver")) &&
              (companyName.includes("etf") ||
                instrumentName.includes("mutual fund"))
            ) {
              silverWeight += holdingPercent;
            }
          });
        }

        const totalCommodityWeight = goldWeight + silverWeight;

        if (totalCommodityWeight > 0) {
          // Split commodities allocation proportionally
          const goldProportion = goldWeight / totalCommodityWeight;
          const silverProportion = silverWeight / totalCommodityWeight;

          gold += val * goldProportion;
          silver += val * silverProportion;
        } else {
          // Fallback to checking subcategory and name
          const subcategory = extendedData?.sub_category?.toLowerCase?.() || "";
          const name = fundKey?.toLowerCase?.() || "";

          if (subcategory.includes("gold") || name.includes("gold")) {
            gold += val;
          } else if (
            subcategory.includes("silver") ||
            name.includes("silver")
          ) {
            silver += val;
          } else {
            debt += val;
          }
        }
      } else {
        debt += val;
      }
    });

    const segments = [];
    if (equity > 0) segments.push({ label: "Equity", value: equity });
    if (debt > 0) segments.push({ label: "Debt", value: debt });
    if (gold > 0) segments.push({ label: "Gold", value: gold });
    if (silver > 0) segments.push({ label: "Silver", value: silver });

    // Sort largest first
    segments.sort((a, b) => b.value - a.value);

    if (segments.length > 0) {
      const total = segments.reduce((sum, s) => sum + s.value, 0);
      const normalized = segments.map((s) => ({
        ...s,
        value: (s.value / total) * 100,
      }));

      // Apply theme-based colors
      const barHTML = normalized
        .map((s, i) => {
          const color = themeColors[i % themeColors.length];
          return `
            <div class="composition-segment"
                 style="width: ${s.value}%; background-color: ${color};"
                 title="${s.label}: ${s.value.toFixed(1)}%">
            </div>
          `;
        })
        .join("");

      const legendHTML = normalized
        .map((s, i) => {
          const color = themeColors[i % themeColors.length];
          return `
            <span class="legend-item">
              <span class="legend-color" style="background-color: ${color};"></span>
              ${s.label}: ${s.value.toFixed(1)}%
            </span>
          `;
        })
        .join("");

      assetBarEl.innerHTML = `
        <div class="fund-composition-bar-wrap">
          <div class="composition-bar">${barHTML}</div>
          <div class="composition-legend">${legendHTML}</div>
        </div>
      `;
    } else {
      assetBarEl.innerHTML =
        '<div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>';
    }
  }

  // ============ MARKET CAP CHART ============
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

    const total = large + mid + small;
    if (total > 0) {
      const segments = [
        { label: "Large", value: (large / total) * 100 },
        { label: "Mid", value: (mid / total) * 100 },
        { label: "Small", value: (small / total) * 100 },
      ].filter((s) => s.value > 0);

      // Sort largest first
      segments.sort((a, b) => b.value - a.value);

      const barHTML = segments
        .map((s, i) => {
          const color = themeColors[i % themeColors.length];
          return `
            <div class="composition-segment"
                 style="width: ${s.value}%; background-color: ${color};"
                 title="${s.label}: ${s.value.toFixed(1)}%">
            </div>
          `;
        })
        .join("");

      const legendHTML = segments
        .map((s, i) => {
          const color = themeColors[i % themeColors.length];
          return `
            <span class="legend-item">
              <span class="legend-color" style="background-color: ${color};"></span>
              ${s.label}: ${s.value.toFixed(1)}%
            </span>
          `;
        })
        .join("");

      mcapBarEl.innerHTML = `
        <div class="fund-composition-bar-wrap">
          <div class="composition-bar">${barHTML}</div>
          <div class="composition-legend">${legendHTML}</div>
        </div>
      `;
    } else {
      mcapBarEl.innerHTML =
        '<div class="fund-composition-chart empty-composition">DATA NOT AVAILABLE</div>';
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
        <h2>Portfolio Holdings (Top ${top200.length}${
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
      <th>Sector</th>
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
        <td>${data.sector}</td>
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
      <th>Sector</th>
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
      <td>${holding.sector_name || "Unknown"}</td>
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
  XLSX.utils.book_append_sheet(wb, ws, "Portfolio Holdings");

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

  // Remove existing transaction wrapper if it exists
  const existingWrapper = document.getElementById("transactionSectionsWrapper");
  if (existingWrapper) {
    existingWrapper.remove();
  }

  // Create a clean button container for the transactions tab
  const transactionWrapper = document.createElement("div");
  transactionWrapper.id = "transactionSectionsWrapper";
  transactionWrapper.className = "transaction-buttons-container";

  transactionWrapper.innerHTML = `
    <div class="transaction-header">
      <h2>Portfolio Transactions</h2>
      <p class="transaction-subtitle">View and download all your mutual fund transactions</p>
    </div>
    
    <div class="transaction-cards-grid">
      <div class="transaction-card">
        <div class="transaction-card-icon">📊</div>
        <h3>All-Time Transactions</h3>
        <p>Complete history of all investments and redemptions across all funds</p>
        <div class="transaction-card-actions">
          <button class="primary-btn" onclick="showAllTimeTransactions()">
            <span>View Transactions</span>
          </button>
          <button class="secondary-btn" onclick="generateExcelReport(allTimeFlows, 'all_time_holdings_transactions.xlsx')">
            <span>Download Excel</span>
          </button>
        </div>
      </div>

      <div class="transaction-card">
        <div class="transaction-card-icon">💼</div>
        <h3>Active Holdings Transactions</h3>
        <p>Transactions for funds you currently hold in your portfolio</p>
        <div class="transaction-card-actions">
          <button class="primary-btn" onclick="showActiveTransactions()">
            <span>View Transactions</span>
          </button>
          <button class="secondary-btn" onclick="generateExcelReport(activeFlows, 'active_holdings_transactions.xlsx')">
            <span>Download Excel</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Clear the excel container and append the new wrapper
  excelContainer.innerHTML = "";
  excelContainer.appendChild(transactionWrapper);
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
function updateChart() {
  const canvas = document.getElementById("portfolioChart");

  // Don't show spinner here - it's already managed by initializeCharts
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

    const colors = getChartColors();

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
          color: getChartColors().textColor,
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
          backgroundColor: getChartColors().tooltipBg,
          borderColor: getChartColors().tooltipBorder,
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
            color: getChartColors().textColor,
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

  const colors = getChartColors();
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

  const colors = getChartColors();
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
    compactTotalReturns: document.getElementById("compactTotalReturns"),
    compact1DReturns: document.getElementById("compact1DReturns"),
  };

  if (!Object.values(elements).every((el) => el !== null)) {
    console.warn("Some compact dashboard elements not found");
    return;
  }

  // Calculate additional assets
  const assets = getAdditionalAssets();
  const hasAdditionalAssets =
    assets &&
    (assets.gold.quantity * assets.gold.rate > 0 ||
      assets.silver.quantity * assets.silver.rate > 0 ||
      assets.cash > 0);

  const goldValue = assets ? assets.gold.quantity * assets.gold.rate : 0;
  const silverValue = assets ? assets.silver.quantity * assets.silver.rate : 0;
  const cashValue = assets ? assets.cash : 0;
  const totalAdditional = goldValue + silverValue + cashValue;
  const mfValue = summary.currentValue;
  const combinedValue = mfValue + totalAdditional;

  elements.compactHoldingsCount.textContent = activeFunds.length;

  // Update total value display based on whether additional assets exist
  if (hasAdditionalAssets) {
    elements.compactTotalValue.textContent = formatNumber(combinedValue);
  } else {
    elements.compactTotalValue.textContent = formatNumber(summary.currentValue);
  }

  elements.compactInvested.textContent = "₹" + formatNumber(summary.costPrice);
  elements.compactXIRR.textContent =
    summary.activeXirr !== null ? summary.activeXirr.toFixed(2) + "%" : "--";

  const totalReturnPercent =
    summary.totalInvested > 0
      ? ((summary.unrealizedGain / summary.costPrice) * 100).toFixed(2)
      : 0;

  elements.compactTotalReturns.textContent = `${
    summary.unrealizedGain >= 0 ? "+" : ""
  }₹${formatNumber(Math.abs(summary.unrealizedGain))} (${totalReturnPercent}%)`;
  elements.compactTotalReturns.className =
    "stat-value " + (summary.unrealizedGain >= 0 ? "positive" : "negative");

  const oneDayReturns = calculateOneDayReturns();
  elements.compact1DReturns.textContent = oneDayReturns.text;
  elements.compact1DReturns.className =
    "stat-value " + (oneDayReturns.value >= 0 ? "positive" : "negative");

  // Update the compact header subtitle to show breakdown
  updateCompactHeaderSubtitle(hasAdditionalAssets, mfValue, totalAdditional);

  populateCompactHoldings(activeFunds);
}
function updateCompactPastDashboard() {
  if (!portfolioData || !fundWiseData) return;

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
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase(),
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

  container.innerHTML = `
    <div class="compact-summary-card">
      <div class="compact-stats">
        <div class="compact-stat-row">
          <span class="stat-label">Total Funds</span>
          <span class="stat-value">${totalFunds}</span>
        </div>

        <div class="compact-stat-row">
          <span class="stat-label">Total Invested</span>
          <span class="stat-value">₹${formatNumber(totalInvested)}</span>
        </div>

        <div class="compact-stat-row">
          <span class="stat-label">Total Withdrawn</span>
          <span class="stat-value">₹${formatNumber(totalWithdrawn)}</span>
        </div>

        <div class="compact-stat-row">
          <span class="stat-label">P&L</span>
          <span class="stat-value ${
            totalRealizedGain >= 0 ? "positive" : "negative"
          }">
            ₹${formatNumber(Math.abs(totalRealizedGain))} 
            (${parseFloat(realizedGainPercent).toFixed(2)}%)
          </span>
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
function updateCompactHeaderSubtitle(
  hasAdditionalAssets,
  mfValue,
  totalAdditional,
) {
  // Find or create subtitle element in compact dashboard
  const compactHeader = document.querySelector(
    "#compactDashboard .compact-header",
  );
  if (!compactHeader) return;

  // Remove existing subtitle if present
  let subtitle = compactHeader.querySelector(".compact-subtitle");

  if (hasAdditionalAssets) {
    if (!subtitle) {
      subtitle = document.createElement("p");
      subtitle.className = "compact-subtitle";
      subtitle.style.cssText =
        "font-size: 11px; color: var(--text-tertiary); margin-top: 5px;";
      compactHeader.appendChild(subtitle);
    }
    subtitle.textContent = `MF: ₹${formatNumber(
      mfValue,
    )} + Additional: ₹${formatNumber(totalAdditional)}`;
  } else {
    // Remove subtitle if no additional assets
    if (subtitle) {
      subtitle.remove();
    }
  }
}
function populateCompactHoldings(funds) {
  const list = document.getElementById("compactHoldingsList");
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

      xirr = calc.calculateXIRR();
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
    const returnsPercent = fund.advancedMetrics?.unrealizedGainPercentage || 0;
    const isProfit = returns >= 0;

    const xirr = fund.calculatedXIRR;
    const xirrVal = xirr == null || isNaN(xirr) ? 0 : xirr;
    const xirrText = xirrVal === 0 ? "--" : `${parseFloat(xirr.toFixed(2))}%`;

    const returnsSign = returns >= 0 ? "+" : "-";
    const returnsPercentText =
      returnsPercent === 0
        ? "--"
        : `${returnsSign}₹${formatNumber(Math.abs(returns))} (${returnsSign}${Math.abs(parseFloat(returnsPercent.toFixed(2)))}%)`;

    const oneDayReturn = fund.oneDayReturn;
    const oneDayPositive = !oneDayReturn || oneDayReturn.percent >= 0;
    const odSign = oneDayPositive ? "+" : "-";
    const oneDayText = oneDayReturn
      ? `${odSign}₹${formatNumber(Math.abs(oneDayReturn.rupees))} (${odSign}${Math.abs(oneDayReturn.percent.toFixed(2))}%)`
      : "--";

    const item = document.createElement("div");
    item.className = "compact-holding-item chi-hero";
    const fundKey = fund.scheme.trim().toLowerCase();
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
              <span class="chi-stat-pill ${isProfit ? "chi-stat-pill--pos" : "chi-stat-pill--neg"}">
                <span class="chi-stat-label">Abs.</span>
                <span class="chi-stat-value">${returnsPercentText}</span>
              </span>
              <span class="chi-stat-pill ${xirrVal < 0 ? "chi-stat-pill--neg" : "chi-stat-pill--pos"}">
                <span class="chi-stat-label">XIRR</span>
                <span class="chi-stat-value">${xirrText}</span>
              </span>
            </div>
          </div>
          <div class="chi-right">
            <div class="chi-current ${isProfit ? "chi-current--gain" : "chi-current--loss"}">₹${formatNumber(currentValue)}</div>
            <div class="chi-invested">₹${formatNumber(invested)}</div>
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
    const gainText = `${gainSign}₹${formatNumber(Math.abs(realizedGain))} (${gainSign}${Math.abs(realizedGainPercent)}%)`;

    const item = document.createElement("div");
    item.className = "compact-holding-item chi-hero chi-hero--past";

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
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase(),
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

  return {
    text: `₹${formatNumber(
      Math.abs(Math.round(totalOneDayChange)),
    )} (${percentChange.toFixed(2)}%)`,
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
    console.log("📊 Using cached family dashboard data");

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
    marketCap: { large: 0, mid: 0, small: 0 },
    sector: {},
    amc: {},
    weightedReturns: { return1y: null, return3y: null, return5y: null },
  };

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
          const key = folio.scheme.trim().toLowerCase();
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

            const key = scheme.scheme.trim().toLowerCase();
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
        }
      });

      metrics.userBreakdown[userName] = {
        currentValue: userCurrentValue,
        cost: userCost,
        unrealizedGain: userCurrentValue - userCost,
        holdings: userHoldings,
      };

      metrics.totalCurrentValue += userCurrentValue;
      metrics.totalCost += userCost;
      metrics.totalHoldings += userHoldings;
    },
  );

  metrics.totalUnrealizedGain = metrics.totalCurrentValue - metrics.totalCost;
  metrics.totalHoldings = Object.keys(metrics.combinedFundData).length;

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
      if (fundAsset) {
        Object.entries(fundAsset).forEach(([k, v]) => {
          if (v == null || isNaN(parseFloat(v)) || parseFloat(v) <= 0) return;
          const key = k.trim().toLowerCase();

          if (key.includes("equity")) {
            metrics.assetAllocation.equity =
              (metrics.assetAllocation.equity || 0) +
              (parseFloat(v) / 100) * weight * 100;
          } else if (key.includes("commodities")) {
            // Check holdings to split commodities between gold and silver
            let goldWeight = 0;
            let silverWeight = 0;

            if (
              extendedData?.holdings &&
              Array.isArray(extendedData.holdings)
            ) {
              extendedData.holdings.forEach((holding) => {
                const companyName = (holding.company_name || "").toLowerCase();
                const instrumentName = (
                  holding.instrument_name || ""
                ).toLowerCase();
                const holdingPercent = parseFloat(holding.corpus_per || 0);

                if (
                  (companyName.includes("gold") ||
                    instrumentName.includes("gold")) &&
                  (companyName.includes("etf") ||
                    instrumentName.includes("mutual fund"))
                ) {
                  goldWeight += holdingPercent;
                } else if (
                  (companyName.includes("silver") ||
                    instrumentName.includes("silver")) &&
                  (companyName.includes("etf") ||
                    instrumentName.includes("mutual fund"))
                ) {
                  silverWeight += holdingPercent;
                }
              });
            }

            const totalCommodityWeight = goldWeight + silverWeight;

            if (totalCommodityWeight > 0) {
              // Split commodities allocation proportionally
              const goldProportion = goldWeight / totalCommodityWeight;
              const silverProportion = silverWeight / totalCommodityWeight;

              metrics.assetAllocation.gold =
                (metrics.assetAllocation.gold || 0) +
                (parseFloat(v) / 100) * weight * 100 * goldProportion;

              metrics.assetAllocation.silver =
                (metrics.assetAllocation.silver || 0) +
                (parseFloat(v) / 100) * weight * 100 * silverProportion;
            } else {
              // Fallback to checking subcategory and name
              const subcategory =
                extendedData?.sub_category?.toLowerCase?.() || "";
              const name = fund?.scheme?.toLowerCase?.() || "";

              let bucket = "debt";
              if (subcategory.includes("gold") || name.includes("gold")) {
                bucket = "gold";
              } else if (
                subcategory.includes("silver") ||
                name.includes("silver")
              ) {
                bucket = "silver";
              }

              metrics.assetAllocation[bucket] =
                (metrics.assetAllocation[bucket] || 0) +
                (parseFloat(v) / 100) * weight * 100;
            }
          } else {
            metrics.assetAllocation.debt =
              (metrics.assetAllocation.debt || 0) +
              (parseFloat(v) / 100) * weight * 100;
          }
        });
      } else {
        const category = (extendedData.category || "").toLowerCase();
        if (category.includes("equity")) {
          metrics.assetAllocation.equity =
            (metrics.assetAllocation.equity || 0) + weight * 100;
        } else if (category.includes("debt") || category.includes("income")) {
          metrics.assetAllocation.debt =
            (metrics.assetAllocation.debt || 0) + weight * 100;
        } else {
          metrics.assetAllocation.other =
            (metrics.assetAllocation.other || 0) + weight * 100;
        }
      }

      const ps = extendedData.portfolio_stats;
      if (
        ps?.large_cap !== undefined ||
        ps?.mid_cap !== undefined ||
        ps?.small_cap !== undefined
      ) {
        const l = parseFloat(ps.large_cap || 0);
        const m = parseFloat(ps.mid_cap || 0);
        const s = parseFloat(ps.small_cap || 0);
        const total = l + m + s || 100;

        metrics.marketCap.large += (l / total) * weight * 100;
        metrics.marketCap.mid += (m / total) * weight * 100;
        metrics.marketCap.small += (s / total) * weight * 100;
      } else if (ps?.market_cap_per) {
        const mp = ps.market_cap_per;
        const l = parseFloat(mp.large || 0);
        const m = parseFloat(mp.mid || 0);
        const s = parseFloat(mp.small || 0);
        const total = l + m + s || 100;

        metrics.marketCap.large += (l / total) * weight * 100;
        metrics.marketCap.mid += (m / total) * weight * 100;
        metrics.marketCap.small += (s / total) * weight * 100;
      } else {
        const name = (fund.scheme || "").toLowerCase();
        if (name.includes("small") || name.includes("smallcap")) {
          metrics.marketCap.small += weight * 100;
        } else if (name.includes("mid") || name.includes("midcap")) {
          metrics.marketCap.mid += weight * 100;
        } else {
          metrics.marketCap.large += weight * 100;
        }
      }

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

      const amcName = standardizeTitle(extendedData.amc || "Unknown AMC");
      metrics.amc[amcName] = (metrics.amc[amcName] || 0) + weight * 100;

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

  // After processing all funds, add additional assets for all family members
  Object.keys(allUserData).forEach((userName) => {
    const additionalAssets = getAdditionalAssets(userName);
    if (additionalAssets) {
      const additionalGoldValue =
        additionalAssets.gold.quantity * additionalAssets.gold.rate;
      const additionalSilverValue =
        additionalAssets.silver.quantity * additionalAssets.silver.rate;
      const additionalCashValue = additionalAssets.cash;

      const additionalTotal =
        additionalGoldValue + additionalSilverValue + additionalCashValue;

      if (additionalTotal > 0) {
        // Update total value to include additional assets
        const userTotalMF = metrics.userBreakdown[userName]?.currentValue || 0;
        const userNewTotal = userTotalMF + additionalTotal;

        // Recalculate total with additional assets
        const oldTotal = metrics.totalCurrentValue;
        const newTotal = oldTotal + additionalTotal;

        // Update metrics totals
        metrics.totalCurrentValue = newTotal;

        // Add additional assets to allocation with breakdown
        if (!metrics.assetAllocation._breakdown) {
          metrics.assetAllocation._breakdown = {};
        }

        if (additionalGoldValue > 0) {
          const goldWeight = (additionalGoldValue / newTotal) * 100;

          if (!metrics.assetAllocation._breakdown.gold) {
            metrics.assetAllocation._breakdown.gold = { mf: 0, physical: 0 };
          }
          metrics.assetAllocation._breakdown.gold.mf =
            metrics.assetAllocation.gold || 0;
          metrics.assetAllocation.gold =
            (metrics.assetAllocation.gold || 0) + goldWeight;
          metrics.assetAllocation._breakdown.gold.physical =
            (metrics.assetAllocation._breakdown.gold.physical || 0) +
            goldWeight;
        }

        if (additionalSilverValue > 0) {
          const silverWeight = (additionalSilverValue / newTotal) * 100;

          if (!metrics.assetAllocation._breakdown.silver) {
            metrics.assetAllocation._breakdown.silver = { mf: 0, physical: 0 };
          }
          metrics.assetAllocation._breakdown.silver.mf =
            metrics.assetAllocation.silver || 0;
          metrics.assetAllocation.silver =
            (metrics.assetAllocation.silver || 0) + silverWeight;
          metrics.assetAllocation._breakdown.silver.physical =
            (metrics.assetAllocation._breakdown.silver.physical || 0) +
            silverWeight;
        }

        if (additionalCashValue > 0) {
          const cashWeight = (additionalCashValue / newTotal) * 100;

          if (!metrics.assetAllocation._breakdown.cash) {
            metrics.assetAllocation._breakdown.cash = { mf: 0, physical: 0 };
          }
          metrics.assetAllocation._breakdown.cash.mf =
            metrics.assetAllocation.cash || 0;
          metrics.assetAllocation.cash =
            (metrics.assetAllocation.cash || 0) + cashWeight;
          metrics.assetAllocation._breakdown.cash.physical =
            (metrics.assetAllocation._breakdown.cash.physical || 0) +
            cashWeight;
        }

        // Update user breakdown to include additional assets
        if (metrics.userBreakdown[userName]) {
          metrics.userBreakdown[userName].currentValue = userNewTotal;
          metrics.userBreakdown[userName].unrealizedGain =
            userNewTotal - metrics.userBreakdown[userName].cost;
        }
      }
    }
  });

  // Normalize all percentages after adding additional assets
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
    metrics.marketCap.large + metrics.marketCap.mid + metrics.marketCap.small;
  if (mcSum > 0) {
    metrics.marketCap.large = (metrics.marketCap.large / mcSum) * 100;
    metrics.marketCap.mid = (metrics.marketCap.mid / mcSum) * 100;
    metrics.marketCap.small = (metrics.marketCap.small / mcSum) * 100;
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

  return metrics;
}

function displayFamilySummaryCards(metrics) {
  const container = document.getElementById("familySummaryCards");

  // Calculate additional assets for all family members
  const users = storageManager.getAllUsers();
  let totalAdditionalAssets = 0;

  users.forEach((userName) => {
    const assets = getAdditionalAssets(userName);
    if (assets) {
      const goldValue = assets.gold.quantity * assets.gold.rate;
      const silverValue = assets.silver.quantity * assets.silver.rate;
      const cashValue = assets.cash;
      totalAdditionalAssets += goldValue + silverValue + cashValue;
    }
  });

  const hasAdditionalAssets = totalAdditionalAssets > 0;
  const combinedFamilyValue = metrics.totalCurrentValue + totalAdditionalAssets;

  const unrealizedGainPercent =
    metrics.totalCost > 0
      ? ((metrics.totalUnrealizedGain / metrics.totalCost) * 100).toFixed(2)
      : 0;

  if (hasAdditionalAssets) {
    // Show Total Family Value card
    container.innerHTML = `
      <div class="card">
        <h3>Total Family Value</h3>
        <div class="value">₹${formatNumber(combinedFamilyValue)}</div>
        <div class="subtext">MF: ₹${formatNumber(
          metrics.totalCurrentValue,
        )} + Additional: ₹${formatNumber(totalAdditionalAssets)}</div>
      </div>
      <div class="card">
        <h3>MF Current Value</h3>
        <div class="value">₹${formatNumber(metrics.totalCurrentValue)}</div>
        <div class="subtext">Combined MF Holdings</div>
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
  } else {
    // Show MF Current Value card (no Total Family Value)
    container.innerHTML = `
      <div class="card">
        <h3>Total Family Value</h3>
        <div class="value">₹${formatNumber(metrics.totalCurrentValue)}</div>
        <div class="subtext">Combined Portfolio Value</div>
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
}
function displayFamilyAnalytics(metrics) {
  window.familyDashboardCache = metrics;

  if (familySectorChart) {
    familySectorChart.destroy();
    familySectorChart = null;
  }

  if (familyAmcChart) {
    familyAmcChart.destroy();
    familyAmcChart = null;
  }

  setTimeout(() => {
    displayFamilyAssetAllocation(metrics);
    displayFamilyMarketCapSplit(metrics);
  }, 200);

  const sectorLabels = [];
  const sectorData = [];

  Object.entries(metrics.sector).forEach(([name, value]) => {
    if (value > 0) {
      sectorLabels.push(name);
      sectorData.push(value);
    }
  });

  const nonZeroEntries = Object.entries(metrics.sector).filter(
    ([_, v]) => v > 0,
  );
  const onlyUnclassified =
    nonZeroEntries.length === 1 &&
    nonZeroEntries[0][0].toLowerCase() === "unclassified";

  const sectorCard = document.getElementById("familySectorCard");

  if (onlyUnclassified || sectorData.length === 0) {
    sectorCard.classList.add("hidden");
  } else {
    sectorCard.classList.remove("hidden");
    const [sortedLabels, sortedData] = sortData(sectorLabels, sectorData);
    setTimeout(() => {
      familySectorChart = buildBarChart(
        "familySectorChart",
        sortedLabels,
        sortedData,
      );
      sectorCard.classList.remove("loading");
    }, 200);
  }

  const amcLabels = [];
  const amcData = [];

  Object.entries(metrics.amc).forEach(([name, value]) => {
    if (value > 0) {
      const shortName = name
        .replace(/mutual\s*fund/gi, "")
        .replace(/\bmf\b/gi, "")
        .trim();
      amcLabels.push(shortName);
      amcData.push(value);
    }
  });

  if (amcData.length > 0) {
    const [sortedLabels, sortedData] = sortData(amcLabels, amcData);
    setTimeout(() => {
      familyAmcChart = buildBarChart(
        "familyAmcChart",
        sortedLabels,
        sortedData,
      );
      document.getElementById("familyAmcCard")?.classList.remove("loading");
    }, 300);
  } else {
    document.getElementById("familyAmcCard").innerHTML =
      '<p style="text-align: center; color: #9ca3af; padding: 20px;">DATA NOT AVAILABLE</p>';
  }

  const returnsContainer = document.getElementById(
    "familyWeightedReturnsContainer",
  );
  returnsContainer.innerHTML = "";

  const returnCards = [
    { key: "return1y", title: "1Y Weighted Return" },
    { key: "return3y", title: "3Y Weighted Return" },
    { key: "return5y", title: "5Y Weighted Return" },
  ];

  returnCards.forEach((c) => {
    const val = metrics.weightedReturns[c.key];
    const card = document.createElement("div");
    card.className = "return-card";

    const display = val === null || isNaN(val) ? "--" : `${val}%`;
    const cls = val === null ? "" : val >= 0 ? "positive" : "negative";

    card.innerHTML = `
      <h4>${c.title}</h4>
      <div class="return-value ${cls}">${display}</div>
    `;

    returnsContainer.appendChild(card);
  });
}

function displayFamilyAssetAllocation(metrics) {
  const preferred = [
    "equity",
    "debt",
    "gold",
    "silver",
    "commodities",
    "real estate",
    "cash",
    "other",
  ];

  const assetLabels = [];
  const assetData = [];

  // Preferred order first
  preferred.forEach((k) => {
    const val = parseFloat(metrics.assetAllocation?.[k]);
    if (!isNaN(val) && val > 0) {
      assetLabels.push(k.charAt(0).toUpperCase() + k.slice(1));
      assetData.push(val);
    }
  });

  // Any extra asset types (excluding _breakdown)
  Object.keys(metrics.assetAllocation || {}).forEach((k) => {
    if (!preferred.includes(k) && k !== "_breakdown") {
      const val = parseFloat(metrics.assetAllocation[k]);
      if (!isNaN(val) && val > 0) {
        assetLabels.push(k.charAt(0).toUpperCase() + k.slice(1));
        assetData.push(val);
      }
    }
  });

  const container = document.getElementById("family-asset-market-cap-split");
  const assetCard = document.getElementById("familyAssetAllocationCard");
  if (!container || !assetCard) return;

  container.classList.remove("loading");

  if (assetData.length === 0) {
    assetCard.querySelector(".chart-wrapper").innerHTML =
      '<p style="text-align: center; color: #9ca3af; padding: 20px;">DATA NOT AVAILABLE</p>';
    return;
  }

  const [sortedLabels, sortedData] = sortData(assetLabels, assetData);

  // Calculate total value INCLUDING additional assets
  const users = storageManager.getAllUsers();
  let totalValue = metrics.totalCurrentValue || 0;

  users.forEach((user) => {
    const assets = getAdditionalAssets(user);
    if (assets) {
      totalValue +=
        assets.gold.quantity * assets.gold.rate +
        assets.silver.quantity * assets.silver.rate +
        assets.cash;
    }
  });

  const barHTML = sortedLabels
    .map((label, i) => {
      const color = themeColors[i % themeColors.length];
      const rupeeValue = (totalValue * sortedData[i]) / 100;

      return `
        <div class="composition-segment"
             style="width: ${sortedData[i]}%; background-color: ${color};"
             title="${label}: ₹${formatNumber(
               Math.round(rupeeValue),
             )} (${sortedData[i].toFixed(1)}%)">
        </div>`;
    })
    .join("");

  const legendHTML = sortedLabels
    .map((label, i) => {
      const color = themeColors[i % themeColors.length];
      return `
        <span class="legend-item">
          <span class="legend-color" style="background-color: ${color};"></span>
          ${label} ${sortedData[i].toFixed(1)}%
        </span>`;
    })
    .join("");

  const wrapper = assetCard.querySelector(".chart-wrapper");
  wrapper.innerHTML = `
    <div class="fund-composition-chart">
      <div class="composition-bar">${barHTML}</div>
      <div class="composition-legend">${legendHTML}</div>
    </div>
  `;
}

function displayFamilyMarketCapSplit(metrics) {
  const preferred = ["large", "mid", "small"];
  const mcLabels = [];
  const mcData = [];

  preferred.forEach((k) => {
    const val = parseFloat(metrics.marketCap?.[k]);
    if (!isNaN(val) && val > 0) {
      mcLabels.push(k.charAt(0).toUpperCase() + k.slice(1));
      mcData.push(val);
    }
  });

  const container = document.getElementById("family-asset-market-cap-split");
  const mcCard = document.getElementById("familyMarketCapCard");
  if (!container || !mcCard) return;

  container.classList.remove("loading");

  if (mcData.length === 0) {
    mcCard.querySelector(".chart-wrapper").innerHTML =
      '<p style="text-align: center; color: #9ca3af; padding: 20px;">DATA NOT AVAILABLE</p>';
    return;
  }

  const [sortedLabels, sortedData] = sortData(mcLabels, mcData);

  // Calculate total value for tooltip
  const totalValue = metrics.totalCurrentValue;

  const barHTML = sortedLabels
    .map((label, i) => {
      const color = themeColors[i % themeColors.length];
      const rupeeValue = (totalValue * sortedData[i]) / 100;
      return `
      <div class="composition-segment"
           style="width: ${sortedData[i]}%; background-color: ${color};"
           title="${label}: ₹${formatNumber(
             Math.round(rupeeValue),
           )} (${sortedData[i].toFixed(1)}%)">
      </div>`;
    })
    .join("");

  const legendHTML = sortedLabels
    .map((label, i) => {
      const color = themeColors[i % themeColors.length];
      return `
      <span class="legend-item">
        <span class="legend-color" style="background-color: ${color};"></span>
        ${label}: ${sortedData[i].toFixed(1)}%
      </span>`;
    })
    .join("");

  const wrapper = mcCard.querySelector(".chart-wrapper");
  wrapper.innerHTML = `
    <div class="fund-composition-chart">
      <div class="composition-bar">${barHTML}</div>
      <div class="composition-legend">${legendHTML}</div>
    </div>
  `;
}

function displayFamilyUserBreakdown(userBreakdown) {
  const container = document.getElementById("familyUserBreakdown");
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

    card.innerHTML = `
      <h4><i class="fa-solid fa-user"></i> ${displayName}</h4>
      <div class="family-user-stats">
        <div class="family-stat-row">
          <span class="label">Current Value:</span>
          <span class="value">₹${formatNumber(data.currentValue)}</span>
        </div>
        <div class="family-stat-row">
          <span class="label">Cost:</span>
          <span class="value">₹${formatNumber(data.cost)}</span>
        </div>
        <div class="family-stat-row">
          <span class="label">P&L:</span>
          <span class="value ${gainClass}">
            ${data.unrealizedGain >= 0 ? "+" : ""}₹${formatNumber(
              Math.abs(data.unrealizedGain),
            )} 
            (${data.unrealizedGain >= 0 ? "+" : ""}${gainPercent}%)
          </span>
        </div>
        <div class="family-stat-row">
          <span class="label">Active Holdings:</span>
          <span class="value">${data.holdings}</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}
function updateCompactFamilyDashboard(metrics) {
  if (!metrics || window.innerWidth > 500) return;

  const container = document.getElementById("compactFamilyDashboard");
  if (!container) return;

  // Calculate additional assets for all family members
  const users = storageManager.getAllUsers();
  let totalAdditionalAssets = 0;

  users.forEach((userName) => {
    const assets = getAdditionalAssets(userName);
    if (assets) {
      const goldValue = assets.gold.quantity * assets.gold.rate;
      const silverValue = assets.silver.quantity * assets.silver.rate;
      const cashValue = assets.cash;
      totalAdditionalAssets += goldValue + silverValue + cashValue;
    }
  });

  const hasAdditionalAssets = totalAdditionalAssets > 0;
  const combinedFamilyValue = metrics.totalCurrentValue + totalAdditionalAssets;

  const unrealizedGainPercent =
    metrics.totalCost > 0
      ? ((metrics.totalUnrealizedGain / metrics.totalCost) * 100).toFixed(2)
      : 0;

  const displayValue = hasAdditionalAssets
    ? combinedFamilyValue
    : metrics.totalCurrentValue;
  const subtitle = hasAdditionalAssets
    ? `MF: ₹${formatNumber(
        metrics.totalCurrentValue,
      )} + Additional: ₹${formatNumber(totalAdditionalAssets)}`
    : `Combined Portfolio Value`;

  container.innerHTML = `
    <div class="compact-summary-card">
      <div class="compact-header">
        <h3>FAMILY PORTFOLIO (<span>${
          Object.keys(metrics.userBreakdown).length
        }</span> MEMBERS)</h3>
        <h2 class="compact-total-value">₹${formatNumber(displayValue)}</h2>
        ${
          hasAdditionalAssets
            ? `<p style="font-size: 11px; color: var(--text-tertiary); margin-top: 5px;">${subtitle}</p>`
            : ""
        }
      </div>

      <div class="compact-stats">
        <div class="compact-stat-row">
          <span class="stat-label">Total Unique Holdings</span>
          <span class="stat-value">${metrics.totalHoldings}</span>
        </div>

        <div class="compact-stat-row">
          <span class="stat-label">P&L</span>
          <span class="stat-value ${
            metrics.totalUnrealizedGain >= 0 ? "positive" : "negative"
          }">
            ${metrics.totalUnrealizedGain >= 0 ? "+" : ""}₹${formatNumber(
              Math.abs(metrics.totalUnrealizedGain),
            )} 
            (${
              metrics.totalUnrealizedGain >= 0 ? "+" : ""
            }${unrealizedGainPercent}%)
          </span>
        </div>

        <div class="compact-stat-row">
          <span class="stat-label">Total Invested</span>
          <span class="stat-value">₹${formatNumber(metrics.totalCost)}</span>
        </div>
      </div>
    </div>

    <div class="compact-family-breakdown" id="compactFamilyBreakdown"></div>
  `;

  const breakdownContainer = document.getElementById("compactFamilyBreakdown");
  const sortedUsers = Object.entries(metrics.userBreakdown).sort(
    (a, b) => b[1].currentValue - a[1].currentValue,
  );

  sortedUsers.forEach(([userName, data]) => {
    const gainPercent =
      data.cost > 0 ? ((data.unrealizedGain / data.cost) * 100).toFixed(2) : 0;
    const displayName = getStoredInvestorName(userName).split(" ")[0];

    const isProfit = data.unrealizedGain >= 0;
    const gainSign = isProfit ? "+" : "-";
    const pnlText = `${gainSign}₹${formatNumber(Math.abs(data.unrealizedGain))} (${gainSign}${Math.abs(gainPercent)}%)`;

    const item = document.createElement("div");
    item.className = "compact-holding-item chi-hero";

    item.innerHTML = `
      <div class="chi-accent ${isProfit ? "chi-accent--gain" : "chi-accent--loss"}"></div>
      <div class="chi-body">
        <div class="chi-top">
          <div class="chi-left">
            <div class="chi-name"><i class="fa-solid fa-user" style="font-size:10px;opacity:0.6;margin-right:4px;"></i>${displayName}</div>
            <div class="chi-stats-line">
              <span class="chi-stat-pill chi-stat-pill--neutral">
                <span class="chi-stat-label">Holdings</span>
                <span class="chi-stat-value">${data.holdings}</span>
              </span>
              <span class="chi-stat-pill ${isProfit ? "chi-stat-pill--pos" : "chi-stat-pill--neg"}">
                <span class="chi-stat-label">P&L</span>
                <span class="chi-stat-value">${pnlText}</span>
              </span>
            </div>
          </div>
          <div class="chi-right">
            <div class="chi-current ${isProfit ? "chi-current--gain" : "chi-current--loss"}">₹${formatNumber(data.currentValue)}</div>
            <div class="chi-invested">₹${formatNumber(data.cost)}</div>
          </div>
        </div>
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

    console.log("Initializing user management. Current user:", currentUser);

    populateUserList(users);

    updateCurrentUserDisplay();

    toggleFamilyDashboard();
    return true;
  } else {
    if (container) {
      container.innerHTML =
        '<div style="text-align: right; padding: 20px; color: var(--text-tertiary); font-size:12px">No users found. Upload a CAS file to get started.</div>';
    }

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
    return;
  }

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

  console.log("User list populated. Current user:", currentUser);
}

function switchToUser(userName) {
  if (!userName || userName === currentUser) return;

  const investorName = getStoredInvestorName(userName);
  const confirmSwitch = confirm(`Switch to user: ${investorName}?`);
  if (!confirmSwitch) return;

  currentUser = userName;
  localStorage.setItem("lastActiveUser", currentUser);

  console.log("Switching to user:", userName);

  loadAdditionalAssetsForm();

  showToast(`Switching to ${investorName}...`, "success");
  toggleFamilyDashboard();

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

  showProcessingSplash();

  try {
    const wasCurrentUser = userName === currentUser;

    await storageManager.deleteUser(userName);

    const hiddenFoliosKey = `hiddenFolios_${userName}`;
    localStorage.removeItem(hiddenFoliosKey);
    console.log(`🗑️ Cleared hidden folios for deleted user: ${userName}`);

    const additionalAssetsKey = `additionalAssets_${userName}`;
    localStorage.removeItem(additionalAssetsKey);
    console.log(`🗑️ Cleared additional assets for deleted user: ${userName}`);

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

    hideProcessingSplash();
    showToast(`User ${investorName} deleted successfully`, "success");

    toggleFamilyDashboard();
    invalidateFamilyDashboardCache();

    // Reload if current user was deleted
    if (wasCurrentUser || allUsers.length === 0) {
      setTimeout(() => {
        location.reload();
      }, 500);
    }
  } catch (err) {
    hideProcessingSplash();
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

  showProcessingSplash();

  try {
    await storageManager.deleteAllUsers();

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("hiddenFolios_")) {
        keysToRemove.push(key);
      }

      if (key && key.startsWith("additionalAssets_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    console.log(
      `🗑️ Cleared hidden folios for all users (${keysToRemove.length} entries)`,
    );

    hideProcessingSplash();
    showToast("All users deleted, reloading...", "success");

    invalidateFamilyDashboardCache();

    setTimeout(() => {
      location.reload();
    }, 500);
  } catch (err) {
    hideProcessingSplash();
    console.error("Error deleting all users:", err);
    showToast("Failed to delete all users: " + err.message, "error");
  }
}
function updateCurrentUserDisplay() {
  if (!currentUser) {
    const display = document.getElementById("currentUserDisplay");
    if (display) {
      display.style.display = "none";
    }
    return;
  }

  console.log("Updating current user display:", currentUser);

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
      console.log("Added active class to:", userName);
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

  showToast("Folio visibility settings saved!", "success");

  closeFolioManagementModal();

  // If current user, reload portfolio
  if (userName === currentUser) {
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
                  s.scheme.trim().toLowerCase() ===
                    scheme.scheme.trim().toLowerCase() &&
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

// ADDITIONAL ASSETS
function getAdditionalAssets(userName = null) {
  const user = userName || currentUser;
  if (!user) return null;

  const key = `additionalAssets_${user}`;
  const stored = localStorage.getItem(key);
  return stored
    ? JSON.parse(stored)
    : {
        gold: { quantity: 0, rate: 0 },
        silver: { quantity: 0, rate: 0 },
        cash: 0,
      };
}

function saveAdditionalAssets() {
  if (!currentUser) return;

  const goldQty =
    parseFloat(document.getElementById("goldQuantity").value) || 0;
  const goldRate = parseFloat(document.getElementById("goldRate").value) || 0;
  const silverQty =
    parseFloat(document.getElementById("silverQuantity").value) || 0;
  const silverRate =
    parseFloat(document.getElementById("silverRate").value) || 0;
  const cash = parseFloat(document.getElementById("cashAmount").value) || 0;

  const assets = {
    gold: { quantity: goldQty, rate: goldRate },
    silver: { quantity: silverQty, rate: silverRate },
    cash: cash,
  };

  const key = `additionalAssets_${currentUser}`;
  localStorage.setItem(key, JSON.stringify(assets));

  updateAdditionalAssetsDisplay();

  // Update main dashboard if we have portfolio data
  if (portfolioData && fundWiseData) {
    calculateAndDisplayPortfolioAnalytics();
  }
}

function updateAdditionalAssetsDisplay() {
  const assets = getAdditionalAssets();
  if (!assets) return;

  const goldValue = assets.gold.quantity * assets.gold.rate;
  const silverValue = assets.silver.quantity * assets.silver.rate;
  const cashValue = assets.cash;
  const totalAdditional = goldValue + silverValue + cashValue;

  document.getElementById("goldValue").textContent =
    "₹" + formatNumber(Math.round(goldValue));
  document.getElementById("silverValue").textContent =
    "₹" + formatNumber(Math.round(silverValue));
  document.getElementById("cashValue").textContent =
    "₹" + formatNumber(Math.round(cashValue));
  document.getElementById("totalAdditionalAssets").textContent =
    "₹" + formatNumber(Math.round(totalAdditional));

  // Calculate combined value
  const mfValue = Object.values(fundWiseData || {}).reduce(
    (sum, fund) => sum + (fund.advancedMetrics?.currentValue || 0),
    0,
  );
  const combinedValue = mfValue + totalAdditional;
  document.getElementById("combinedPortfolioValue").textContent =
    "₹" + formatNumber(Math.round(combinedValue));

  // Trigger summary cards update
  if (portfolioData && fundWiseData) {
    const summary = calculateSummary();
    updateSummaryCards(summary);
  }
}

function loadAdditionalAssetsForm() {
  const assets = getAdditionalAssets();
  if (!assets) return;

  document.getElementById("goldQuantity").value = assets.gold.quantity || "";
  document.getElementById("goldRate").value = assets.gold.rate || "";
  document.getElementById("silverQuantity").value =
    assets.silver.quantity || "";
  document.getElementById("silverRate").value = assets.silver.rate || "";
  document.getElementById("cashAmount").value = assets.cash || "";

  updateAdditionalAssetsDisplay();
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
  console.log(taxData.stcgDebtAmount);
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

  taxData.ltHoldings.funds.forEach((fund) => {
    const gainPercent =
      fund.cost > 0 ? ((fund.unrealizedGain / fund.cost) * 100).toFixed(2) : 0;
    html += `
    <div class="tax-holding-item">
      <div class="tax-holding-info">
        <div class="tax-holding-name">${fund.name}</div>
        <div class="tax-holding-meta">
          <span class="tp-holding-meta-pill tp-pill-equity">Equity ${fund.equityPercentage.toFixed(1)}%</span>
          <span class="tp-holding-meta-pill tp-pill-days">${fund.avgHoldingDays}d avg</span>
          <span class="tp-holding-meta-pill tp-pill-units">${fund.units.toFixed(3)} units</span>
          <span class="tp-holding-meta-pill tp-pill-units">Cost ₹${formatNumber(fund.cost)}</span>
        </div>
      </div>
      <div class="tax-holding-values">
        <div class="tax-holding-value">₹${formatNumber(fund.currentValue)}</div>
        <div class="tax-holding-percentage ${
          fund.unrealizedGain >= 0 ? "gain" : "loss"
        }">
          ${fund.unrealizedGain >= 0 ? "+₹" : "-₹"}${formatNumber(
            Math.abs(fund.unrealizedGain),
          )} 
          (${fund.unrealizedGain >= 0 ? "+" : ""}${gainPercent}%)
        </div>
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

  taxData.stHoldings.funds.forEach((fund) => {
    const gainPercent =
      fund.cost > 0 ? ((fund.unrealizedGain / fund.cost) * 100).toFixed(2) : 0;
    html += `
    <div class="tax-holding-item">
      <div class="tax-holding-info">
        <div class="tax-holding-name">${fund.name}</div>
        <div class="tax-holding-meta">
          <span class="tp-holding-meta-pill tp-pill-equity">Equity ${fund.equityPercentage.toFixed(1)}%</span>
          <span class="tp-holding-meta-pill tp-pill-days">${fund.avgHoldingDays}d avg</span>
          <span class="tp-holding-meta-pill tp-pill-units">${fund.units.toFixed(3)} units</span>
          <span class="tp-holding-meta-pill tp-pill-units">Cost ₹${formatNumber(fund.cost)}</span>
        </div>
      </div>
      <div class="tax-holding-values">
        <div class="tax-holding-value">₹${formatNumber(fund.currentValue)}</div>
        <div class="tax-holding-percentage ${
          fund.unrealizedGain >= 0 ? "gain" : "loss"
        }">
          ${fund.unrealizedGain >= 0 ? "+₹" : "-₹"}${formatNumber(
            Math.abs(fund.unrealizedGain),
          )} 
          (${fund.unrealizedGain >= 0 ? "+" : ""}${gainPercent}%)
        </div>
      </div>
    </div>
  `;
  });

  html += `
      </div>
    </div>
  `;

  // Tax Optimization Tips
  html += `
    <div class="tax-note">
      <i class="fa-solid fa-lightbulb"></i>
      <div>
        <strong>Tax Optimization Tips</strong>
        <ul>
          <li><strong>LTCG Tax:</strong> 12.5% on gains above ₹1.25L for equity funds (holding ≥ 1 year)</li>
          <li><strong>STCG Tax:</strong> 20% for equity funds (holding < 1 year), as per slab for debt funds</li>
          <li><strong>Strategy:</strong> Hold equity funds for at least 1 year to benefit from lower LTCG tax rates</li>
          <li><strong>Harvesting:</strong> Consider booking LTCG up to ₹1.25L annually to use the tax-free limit</li>
          <li><strong>Rebalancing:</strong> Plan redemptions to minimize tax impact by timing them strategically</li>
        </ul>
      </div>
    </div>
  `;

  html += `</div>`;

  container.innerHTML = html;
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

    // Determine equity percentage
    const extendedData = fund.isin ? mfStats[fund.isin] : null;
    let equityPercentage = 0;

    if (extendedData?.portfolio_stats?.asset_allocation) {
      const assetAlloc = extendedData.portfolio_stats.asset_allocation;
      Object.entries(assetAlloc).forEach(([key, value]) => {
        if (key.toLowerCase().includes("equity")) {
          equityPercentage += parseFloat(value || 0);
        }
      });
    } else {
      const category = (fund.type || fund.category || "").toLowerCase();
      if (category.includes("equity")) {
        equityPercentage = 100;
      }
    }

    const isEquityOriented = equityPercentage >= 65;
    const threshold = isEquityOriented ? 365 : 730;
    const latestNav = fund.valuation?.nav || 0;

    // Split units into LT and ST based on actual holding period
    let ltUnits = 0;
    let ltCost = 0;
    let stUnits = 0;
    let stCost = 0;
    let ltTotalHoldingDays = 0;
    let stTotalHoldingDays = 0;

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

        if (holdingDays >= threshold) {
          ltUnits += batch.units;
          ltCost += batchCost;
          ltTotalHoldingDays += holdingDays * batch.units;
        } else {
          stUnits += batch.units;
          stCost += batchCost;
          stTotalHoldingDays += holdingDays * batch.units;
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
        units: ltUnits,
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
        units: stUnits,
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
    content.style.maxHeight = "0";
    content.classList.add("collapsed");
    icon.classList.remove("rotated");
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

    if (updateType === "initial") {
      // For initial load, fetch ALL funds
      if (portfolioData.cas_type === "SUMMARY") {
        portfolioData.folios.forEach((folio) => {
          if (folio.isin) {
            targetIsins.add(folio.isin);
          }
        });
      } else {
        portfolioData.folios.forEach((folio) => {
          if (folio.schemes && Array.isArray(folio.schemes)) {
            folio.schemes.forEach((scheme) => {
              if (scheme.isin) {
                targetIsins.add(scheme.isin);
              }
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
          if (folio.isin && hasValue) {
            targetIsins.add(folio.isin);
          }
        });
      } else {
        portfolioData.folios.forEach((folio) => {
          if (folio.schemes && Array.isArray(folio.schemes)) {
            folio.schemes.forEach((scheme) => {
              const hasValue =
                scheme.isActive ||
                (scheme.currentValue &&
                  parseFloat(scheme.currentValue || 0) > 0);

              if (scheme.isin && hasValue) {
                targetIsins.add(scheme.isin);
              }
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
        if (!searchValue) {
          console.log(`⚠️ No search value found for ISIN: ${isin}`);
        }
        return searchValue;
      })
      .filter(Boolean);

    const uniqueSearchKeys = [...new Set(searchKeys)];

    if (uniqueSearchKeys.length === 0) {
      console.warn("No funds to fetch stats for");
      return mfStats || {};
    }

    // Step 4: Call API with search keys
    const response = await fetch(BACKEND_SERVER + "/api/mf-stats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        searchKeys: uniqueSearchKeys,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    // Step 5: Parse response
    const result = await response.json();

    if (!result.success && result.error) {
      throw new Error(result.error);
    }

    const newStats = result.data || result;

    if (updateType === "initial") {
      // For initial load, replace mfStats completely
      mfStats = newStats;
      console.log(
        "✅ MF Stats fetched successfully (initial):",
        Object.keys(mfStats).length,
        "funds",
      );
    } else {
      // For updates, merge with existing data (preserve historical data)
      mfStats = {
        ...mfStats, // Keep existing data for inactive funds
        ...newStats, // Update/add data for active funds
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
  } catch (err) {
    console.error("❌ Failed to fetch MF stats:", err);
    showToast("Failed to fetch MF stats: " + err.message, "error");
    return mfStats || {};
  }
}
async function updateMFStats() {
  if (!portfolioData) {
    showToast("Please load a portfolio first", "warning");
    return;
  }

  // Check if already updated this month (manual only, auto doesn't count here)
  if (
    !storageManager.needsFullUpdate() &&
    storageManager.hasManualStatsUpdateThisMonth()
  ) {
    showToast(
      "Manual fund statistics update already used this month. You can manually update once per month (in addition to the automatic monthly update after the 10th).",
      "info",
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest fund statistics for ALL users. This may take a few minutes. Continue?",
  );

  if (!confirmUpdate) return;

  showProcessingSplash();
  showToast("Updating fund statistics for all users...", "info");

  try {
    await updateAllUsersStats("manual");

    hideProcessingSplash();
    showToast("Fund statistics updated successfully for all users!", "success");
    updateFooterInfo();
  } catch (err) {
    hideProcessingSplash();
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

  showProcessingSplash();
  showToast("Updating NAV for all users...", "info");

  try {
    await updateAllUsersNav("manual");

    hideProcessingSplash();
    showToast("NAV updated successfully for all users!", "success");
    updateFooterInfo();
  } catch (err) {
    hideProcessingSplash();
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
  const userDataMap = new Map();

  for (const user of users) {
    try {
      const stored = await storageManager.loadPortfolioData(user);
      if (!stored) continue;

      const casData = stored.casData;
      const mfStatsUser = stored.mfStats;

      userDataMap.set(user, { casData, mfStats: mfStatsUser });

      // Collect ISINs ONLY from active holdings
      if (casData.cas_type === "SUMMARY") {
        casData.folios.forEach((folio) => {
          const hasValue =
            folio.current_value && parseFloat(folio.current_value || 0) > 0;

          if (folio.isin && hasValue) {
            allIsins.add(folio.isin);
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

              if (scheme.isin && hasValue) {
                allIsins.add(scheme.isin);
              }
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

  console.log(`📊 Fetching stats for ${allIsins.size} unique ACTIVE funds...`);

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

  // Single API call for all users
  try {
    const response = await fetch(BACKEND_SERVER + "/api/mf-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchKeys: uniqueSearchKeys }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const result = await response.json();
    if (!result.success && result.error) throw new Error(result.error);

    const newStats = result.data || result;

    // Update each user's data
    for (const [user, userData] of userDataMap.entries()) {
      try {
        // Merge: keep existing stats for inactive funds, update active funds
        const updatedMfStats = { ...userData.mfStats, ...newStats };

        await storageManager.savePortfolioData(
          userData.casData,
          updatedMfStats,
          false,
          user,
        );

        storageManager.updateLastFullUpdate(user);
        storageManager.updateLastNavUpdate(user);

        if (updateType === "manual") {
          storageManager.markManualStatsUpdate(user);
          storageManager.markManualNavUpdate(user);
        }

        console.log(`✅ Updated stats for user: ${user}`);
      } catch (err) {
        console.error(`Error saving data for user ${user}:`, err);
      }
    }

    // Refresh current user's view
    if (currentUser && userDataMap.has(currentUser)) {
      mfStats = { ...userDataMap.get(currentUser).mfStats, ...newStats };

      if (isSummaryCAS) {
        processSummaryCAS();
        disableSummaryIncompatibleTabs();
      } else {
        await processPortfolio();
        enableSummaryIncompatibleTabs();
      }
    }

    console.log(
      `✅ Stats updated for ${allIsins.size} active funds across ${users.length} users`,
    );
    invalidateFamilyDashboardCache();
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

  // Only auto-update after 6 AM
  if (!isAfter6AM()) {
    console.log("⏰ Auto-updates only run after 6 AM");
    return;
  }

  // Check if full update is needed (after 10th of month)
  if (storageManager.needsFullUpdate()) {
    console.log("📅 Monthly update required (after 10th)");
    const updated = await updateFullMFStats();
    if (updated) {
      showToast("Portfolio statistics updated for the month!", "success");
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

      showToast("Latest NAV updated!", "success");
      updateFooterInfo();
    } else {
      showToast("Failed to update NAV", "error");
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

  // Remove active class from all tab buttons (both desktop and mobile)
  document
    .querySelectorAll(".dashboard-tab-btn, .mobile-menu-item")
    .forEach((btn) => {
      btn.classList.remove("active");
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
  const menu = document.getElementById("mobileMenu");
  const overlay = document.getElementById("mobileMenuOverlay");
  const hamburger = document.getElementById("hamburgerMenu");

  menu.classList.toggle("active");
  overlay.classList.toggle("active");
  hamburger.classList.toggle("active");

  if (menu.classList.contains("active")) {
    lockBodyScroll();
  } else {
    unlockBodyScroll();
  }
}

function closeMobileMenu() {
  const menu = document.getElementById("mobileMenu");
  const overlay = document.getElementById("mobileMenuOverlay");
  const hamburger = document.getElementById("hamburgerMenu");

  menu.classList.remove("active");
  overlay.classList.remove("active");
  hamburger.classList.remove("active");
  unlockBodyScroll();
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
  switchDashboardTab("cas-upload-tab");

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
    .querySelectorAll(".dashboard-tab-btn, .mobile-menu-item")
    .forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.style.pointerEvents = "auto";
    });
}

function disableAllTabsExceptUpload() {
  document
    .querySelectorAll(".dashboard-tab-btn, .mobile-menu-item")
    .forEach((btn) => {
      if (!btn) return;
      if (!btn.classList.contains("cas-upload-tab-button")) {
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
          if (btn.classList.contains("mobile-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("transactions-button")) {
        btn.onclick = () => {
          switchDashboardTab("transactions");
          if (btn.classList.contains("mobile-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("capital-gains-button")) {
        btn.onclick = () => {
          switchDashboardTab("capital-gains");
          if (btn.classList.contains("mobile-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("past-holding-button")) {
        btn.onclick = () => {
          switchDashboardTab("past-holding");
          if (btn.classList.contains("mobile-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("overlap-analysis-button")) {
        btn.onclick = () => {
          switchDashboardTab("overlap-analysis");
          if (btn.classList.contains("mobile-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("expense-impact-button")) {
        btn.onclick = () => {
          switchDashboardTab("expense-impact");
          if (btn.classList.contains("mobile-menu-item")) {
            closeMobileMenu();
          }
        };
      } else if (btn.classList.contains("health-score-button")) {
        btn.onclick = () => {
          switchDashboardTab("health-score");
          if (btn.classList.contains("mobile-menu-item")) {
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

      if (btn.classList.contains("mobile-menu-item")) {
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
  const savedTheme = localStorage.getItem("theme") || "dark";
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

    // Update upload tab dates
    document.getElementById("lastNavUpdateDate").textContent = navDate;
    document.getElementById("lastStatsUpdateDate").textContent = statsDate;
  }
}

// MISC HELPERS
function updatePortfolioDataWithActiveStatus() {
  portfolioData.folios.forEach((folio) => {
    folio.schemes.forEach((scheme) => {
      const key = scheme.scheme.trim().toLowerCase();
      const fund = fundWiseData[key];

      if (fund && fund.advancedMetrics) {
        scheme.currentValue = fund.advancedMetrics.currentValue;
        scheme.isActive = fund.advancedMetrics.currentValue > 0;
      } else {
        scheme.currentValue = 0;
        scheme.isActive = false;
      }
    });
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

window.addEventListener("DOMContentLoaded", async () => {
  initializeTheme();

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

    loadAdditionalAssetsForm();
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
      showProcessingSplash();

      portfolioData = stored.casData;
      mfStats = stored.mfStats;

      isSummaryCAS = portfolioData.cas_type === "SUMMARY";

      console.log(
        "✅ Loaded from IndexedDB - User:",
        currentUser,
        " - CAS Type:",
        isSummaryCAS ? "SUMMARY" : "DETAILED",
      );

      if (isSummaryCAS) {
        processSummaryCAS();
      } else {
        await processPortfolio();
        enableSummaryIncompatibleTabs();
      }

      toggleFamilyDashboard();

      hideProcessingSplash();
      showToast(`Portfolio loaded for ${currentUser}!`, "success");

      updateFooterInfo();
      enableAllTabs();

      updateAdditionalAssetsDisplay();

      if (isSummaryCAS) {
        disableSummaryIncompatibleTabs();
      }

      dashboard.classList.add("active");
      switchDashboardTab("main");

      setTimeout(async () => {
        await checkAndPerformAutoUpdates();
        updateFooterInfo();
      }, 2000);

      return;
    }

    console.log(`📡 No data for user: ${currentUser}`);
    showUploadSection();
  } catch (err) {
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
      window.location.pathname,
    );
  }

  originalSwitchDashboardTab(tabId);
};

window.addEventListener("popstate", function (event) {
  const allTimeModal = document.getElementById("allTimeTransactionsModal");
  const activeModal = document.getElementById("activeTransactionsModal");
  const fundTxModal = document.getElementById("fundTransactionModal");
  const fundHoldingsModal = document.getElementById("fundHoldingsModal");
  const portfolioHoldingsModal = document.getElementById(
    "portfolioHoldingsModal",
  );
  const fundDetailsModal = document.getElementById("fundDetailsModal");

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

  if (fundDetailsModal) {
    closeFundDetailsModal();
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

  if (event.state && event.state.pointer !== undefined) {
    historyPointer = event.state.pointer;
    const targetTab = tabHistory[historyPointer] || "main";

    window.isPopStateNavigation = true;
    switchDashboardTab(targetTab);
    window.isPopStateNavigation = false;

    requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  } else {
    const currentTab = document.querySelector(
      ".dashboard section.active-tab",
    )?.id;
    if (currentTab && currentTab !== "main") {
      window.isPopStateNavigation = true;
      switchDashboardTab("main");
      window.isPopStateNavigation = false;

      requestAnimationFrame(() => {
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      });
    }
  }
});

window.history.replaceState(
  { tab: "main", pointer: 0 },
  "",
  window.location.pathname,
);
