/**
 * @file script.js
 * @description Main Driver for my-mf-dashboard backend calls and frontend rendering
 * @author Pabitra Swain https://github.com/the-sdet
 * @license MIT
 */
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

// Auto-detect backend
const BACKEND_SERVER =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://my-mf-dashboard-backend.onrender.com";

console.log("🔧 Backend Server:", BACKEND_SERVER);

const DEBUG_MODE = false;

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

if (window.location.pathname === "/index.html") {
  window.location.replace(
    window.location.origin + window.location.search + window.location.hash
  );
}

let marketCapChart = null;
let sectorChart = null;
let amcChart = null;
let holdingsChart = null;
let familySectorChart = null;
let familyAmcChart = null;

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

    setTimeout(() => {
      const analytics = calculatePortfolioAnalytics();

      setTimeout(() => {
        displayAssetAllocation(analytics.assetAllocation);
        displayMarketCapSplit(analytics.marketCap);
      }, 200);

      setTimeout(() => {
        displaySectorSplit(analytics.sector);
      }, 100);

      setTimeout(() => {
        displayAMCSplit(analytics.amc);
      }, 100);

      setTimeout(() => {
        displayHoldingsSplit(analytics.holdings);
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

  Object.values(fundWiseData).forEach((fund) => {
    const value = fund.valuation ? parseFloat(fund.valuation.value || 0) : 0;
    if (value > 0) result.totalValue += value;
  });

  if (result.totalValue === 0) return result;

  Object.values(fundWiseData).forEach((fund) => {
    const value = parseFloat(fund.advancedMetrics.currentValue || 0);
    if (!(value > 0)) return;

    const weight = value / result.totalValue;
    const extended = fund.isin ? mfStats[fund.isin] : null;

    const fundAsset = extended?.portfolio_stats?.asset_allocation;
    if (fundAsset) {
      Object.entries(fundAsset).forEach(([k, v]) => {
        if (v == null || isNaN(parseFloat(v)) || parseFloat(v) <= 0) return;
        const key = k.trim().toLowerCase();

        let bucket = "debt";
        if (key.includes("equity")) bucket = "equity";
        else if (key.includes("commodities")) {
          const subcategory = extended?.sub_category?.toLowerCase?.() || "";
          const name = fund?.scheme?.toLowerCase?.() || "";
          if (subcategory.includes("gold") || name.includes("gold"))
            bucket = "gold";
          else if (subcategory.includes("silver") || name.includes("silver"))
            bucket = "silver";
          else {
            bucket = "debt";
          }
        } else {
          bucket = "debt";
        }

        result.assetAllocation[bucket] =
          (result.assetAllocation[bucket] || 0) +
          (parseFloat(v) / 100) * weight * 100;
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
      extended?.amc ?? fund.amc ?? "Unknown AMC"
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

  result.assetAllocation.equity = result.assetAllocation.equity || 0;
  result.assetAllocation.debt = result.assetAllocation.debt || 0;
  result.assetAllocation.cash = result.assetAllocation.cash || 0;
  result.assetAllocation.other = result.assetAllocation.other || 0;

  const mcSum =
    result.marketCap.large + result.marketCap.mid + result.marketCap.small;
  if (mcSum > 0) {
    result.marketCap.large = (result.marketCap.large / mcSum) * 100;
    result.marketCap.mid = (result.marketCap.mid / mcSum) * 100;
    result.marketCap.small = (result.marketCap.small / mcSum) * 100;
  }

  const sectorEntries = Object.entries(result.sector).sort(
    (a, b) => b[1] - a[1]
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
      out[k] = Math.round((v + Number.EPSILON) * 100) / 100;
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
        (result.holdings[company].percentage + Number.EPSILON) * 1000000
      ) / 1000000;
  });

  return result;
}

const themeColors = [
  "#667eea",
  "#764ba2",
  "#10b981",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f472b6",
  "#93c5fd",
];

function getChartColors() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    textColor: isDark ? "#e5e7eb" : "#374151",
    gridColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)",
    borderColor: isDark ? "rgba(255, 255, 255, 0.2)" : "#e5e7eb",
    tooltipBg: isDark ? "rgba(34, 37, 47, 0.95)" : "rgba(0, 0, 0, 0.8)",
    tooltipBorder: isDark ? "rgba(102, 126, 234, 0.5)" : "#3b82f6",
    growthValuation: isDark ? "#e5e7eb" : "#52528c",
    growthCost: isDark ? "#9ca3af" : "#9ca3af",
  };
}

function destroyIfExists(chartRef) {
  if (chartRef) {
    try {
      if (typeof chartRef.destroy === "function") {
        chartRef.destroy();
      }
    } catch (e) {
      console.warn("Error destroying chart:", e);
    }
  }
  return null;
}

function truncateLabel(label, maxLength = 12) {
  return label.length > maxLength ? label.slice(0, maxLength) + "..." : label;
}

function sortData(labels, data) {
  const combined = labels.map((label, i) => ({ label, value: data[i] }));
  combined.sort((a, b) => b.value - a.value);
  return [combined.map((d) => d.label), combined.map((d) => d.value)];
}

function buildDoughnutChart(canvasId, labels, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`Canvas element '${canvasId}' not found`);
    return null;
  }

  const colors = getChartColors();
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: themeColors.slice(0, data.length),
          borderColor: colors.borderColor,
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: {
          position: "bottom",
          align: "center",
          labels: {
            padding: 6,
            boxWidth: 12,
            font: { size: 11, weight: "500" },
            usePointStyle: true,
            color: colors.textColor,
            generateLabels: (chart) =>
              chart.data.labels.map((label, i) => ({
                text: `${truncateLabel(label)}: ${chart.data.datasets[0].data[
                  i
                ].toFixed(2)}%`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                strokeStyle: colors.borderColor,
                lineWidth: 1,
                hidden: false,
                index: i,
              })),
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
          padding: 8,
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => {
              const val = ctx.parsed ?? 0;
              const isFamilyChart = ctx.chart.canvas.id.startsWith("family");

              let totalValue;
              if (isFamilyChart && familyDashboardCache) {
                totalValue = familyDashboardCache.totalCurrentValue;
              } else {
                totalValue = Object.values(fundWiseData).reduce(
                  (sum, fund) =>
                    sum + (fund.advancedMetrics?.currentValue || 0),
                  0
                );
              }

              const rupeeValue = (totalValue * val) / 100;
              return `₹${formatNumber(Math.round(rupeeValue))} (${val.toFixed(
                2
              )}%)`;
            },
          },
        },
      },
      layout: {
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
      },
      animation: {
        animateRotate: true,
        animateScale: true,
        duration: 800,
        easing: "easeInOutQuart",
      },
    },
  });
}

function buildBarChart(canvasId, labels, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`Canvas element '${canvasId}' not found`);
    return null;
  }

  const colors = getChartColors();
  const ctx = document.getElementById(canvasId).getContext("2d");
  const maxVal = Math.max(...data);
  const suggestedMax = Math.min(100, Math.ceil((maxVal * 1.1) / 10) * 10);

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: themeColors.slice(0, data.length),
          borderRadius: 8,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: "easeInOutQuart",
      },
      plugins: {
        legend: { display: false },
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
          padding: 8,
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => {
              const percent = ctx.parsed.x;
              const isFamilyChart = ctx.chart.canvas.id.startsWith("family");

              let totalValue;
              if (isFamilyChart && familyDashboardCache) {
                totalValue = familyDashboardCache.totalCurrentValue;
              } else {
                totalValue = Object.values(fundWiseData).reduce(
                  (sum, fund) =>
                    sum + (fund.advancedMetrics?.currentValue || 0),
                  0
                );
              }

              const rupeeValue = (totalValue * percent) / 100;
              return `₹${formatNumber(
                Math.round(rupeeValue)
              )} (${percent.toFixed(2)}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMax,
          ticks: {
            callback: (v) => v + "%",
            color: colors.textColor,
            font: { size: 11 },
          },
          grid: {
            drawBorder: false,
            color: colors.gridColor,
          },
        },
        y: {
          ticks: {
            color: colors.textColor,
            font: { size: 11 },
            callback: function (value, index, ticks) {
              const label = this.chart.data.labels[index];
              if (!label) return "";
              return label.length > 22 ? label.slice(0, 22) + "…" : label;
            },
          },
          grid: { display: false },
        },
      },
    },
  });
}

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
  const labels = [],
    data = [];

  preferred.forEach((k) => {
    const val = parseFloat(assetAllocation[k]);
    if (!isNaN(val) && val > 0) {
      labels.push(k.charAt(0).toUpperCase() + k.slice(1));
      data.push(val);
    }
  });

  Object.keys(assetAllocation).forEach((k) => {
    if (!preferred.includes(k)) {
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

    const barHTML = sortedLabels
      .map((label, i) => {
        const segment = label.toLowerCase();
        return `
          <div class="composition-segment ${segment}"
               style="width: ${sortedData[i]}%"
               title="${label}: ${sortedData[i].toFixed(1)}%">
          </div>`;
      })
      .join("");

    const legendHTML = sortedLabels
      .map((label, i) => {
        const segment = label.toLowerCase();
        return `
          <span class="legend-item">
            <span class="legend-color ${segment}"></span>${label}: ${sortedData[
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

function displayMarketCapSplit(marketCap) {
  const labels = ["Large", "Mid", "Small", "Other"].filter(
    (k) => marketCap[k.toLowerCase()] !== undefined
  );
  const data = labels.map((l) => marketCap[l.toLowerCase()]);

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    const container = document.getElementById("asset-market-cap-split");
    if (!container) return;

    const chartCanvas = document.getElementById("marketCapChart");
    if (!chartCanvas) return;

    const barHTML = sortedLabels
      .map((label, i) => {
        const segment = label.toLowerCase() + "-cap";
        return `
          <div class="composition-segment ${segment}"
               style="width: ${sortedData[i]}%"
               title="${label}: ${sortedData[i].toFixed(1)}%">
          </div>`;
      })
      .join("");

    const legendHTML = sortedLabels
      .map((label, i) => {
        const segment = label.toLowerCase() + "-cap";
        return `
          <span class="legend-item">
            <span class="legend-color ${segment}"></span>${label}: ${sortedData[
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

function displaySectorSplit(sectorObj) {
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
    sectorChart = buildBarChart("sectorChart", sortedLabels, sortedData);

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

function displayAMCSplit(amcObj) {
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
    amcChart = buildBarChart("amcChart", sortedLabels, sortedData);

    setTimeout(() => {
      document.getElementById("amcCard")?.classList.remove("loading");
    }, 150);
  }, 50);
}

function displayHoldingsSplit(holdingsObj) {
  let entries = Object.entries(holdingsObj)
    .filter(([company]) => company !== "Cash Equivalents")
    .map(([company, data]) => [company, data.percentage])
    .sort((a, b) => b[1] - a[1]);

  const top = entries.slice(0, 10);

  const labels = top.map(([name]) => name);
  const data = top.map(([_, val]) => val);

  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    holdingsChart = buildBarChart("holdingsChart", sortedLabels, sortedData);

    setTimeout(() => {
      document.getElementById("holdingsCard")?.classList.remove("loading");
    }, 150);
  }, 50);
}

// Function to show all portfolio holdings in modal
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
    (a, b) => b[1].percentage - a[1].percentage
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
    window.location.pathname
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
    (a, b) => parseFloat(b.corpus_per || 0) - parseFloat(a.corpus_per || 0)
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
    window.location.pathname
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
    (a, b) => b[1].percentage - a[1].percentage
  );

  const mainHoldings = allEntries.filter(
    ([company, info]) => info.percentage >= 0.01
  );
  const smallHoldings = allEntries.filter(
    ([company, info]) => info.percentage < 0.01
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
      0
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
      (a, b) => parseFloat(b.corpus_per || 0) - parseFloat(a.corpus_per || 0)
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

let mfStats = {};

class XIRRCalculator {
  constructor() {
    this.transactions = [];
    this.xirrResult = null;
  }

  addTransaction(type, date, amount) {
    const normalizedAmount =
      type.toLowerCase() === "buy" ? -Math.abs(amount) : Math.abs(amount);

    this.transactions.push({
      type: type,
      date: new Date(date),
      amount: normalizedAmount,
      displayAmount: Math.abs(amount),
    });

    this.sortTransactions();
  }

  sortTransactions() {
    this.transactions.sort((a, b) => a.date - b.date);
  }

  parseDate(dateStr) {
    if (!dateStr) return null;

    const dmy = dateStr.match(/(\d{1,2})-([A-Z]{3})-(\d{4})/i);
    if (dmy) {
      const months = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      const day = parseInt(dmy[1]);
      const month = months[dmy[2].toLowerCase()];
      const year = parseInt(dmy[3]);
      return new Date(year, month, day);
    }

    const dmy2 = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (dmy2) {
      const day = parseInt(dmy2[1]);
      const month = parseInt(dmy2[2]) - 1;
      let year = parseInt(dmy2[3]);
      if (year < 100) {
        year = year < 50 ? 2000 + year : 1900 + year;
      }
      return new Date(year, month, day);
    }

    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  }

  daysBetween(d1, d2) {
    return (d2 - d1) / (1000 * 60 * 60 * 24);
  }

  npv(rate) {
    const firstDate = this.transactions[0].date;
    return this.transactions.reduce((sum, t) => {
      const years = this.daysBetween(firstDate, t.date) / 365;
      return sum + t.amount / Math.pow(1 + rate, years);
    }, 0);
  }

  dNpv(rate) {
    const firstDate = this.transactions[0].date;
    return this.transactions.reduce((sum, t) => {
      const years = this.daysBetween(firstDate, t.date) / 365;
      const factor = Math.pow(1 + rate, years);
      return sum - (years * t.amount) / (factor * (1 + rate));
    }, 0);
  }

  calculateXIRR(guess = 0.1) {
    if (this.transactions.length < 2) {
      throw new Error("At least 2 transactions required");
    }

    const hasPositive = this.transactions.some((t) => t.amount > 0);
    const hasNegative = this.transactions.some((t) => t.amount < 0);

    if (!hasPositive || !hasNegative) {
      throw new Error("Need both positive and negative cash flows");
    }

    const maxIterations = 100;
    const precision = 1e-6;

    // Newton-Raphson method with better initial guess
    let rate = guess;

    for (let i = 0; i < maxIterations; i++) {
      const npvValue = this.npv(rate);
      const npvDerivative = this.dNpv(rate);

      // Check convergence
      if (Math.abs(npvValue) < precision) {
        this.xirrResult = rate;
        return rate * 100;
      }

      // Avoid division by zero
      if (Math.abs(npvDerivative) < 1e-10) {
        break;
      }

      // Newton-Raphson step
      const newRate = rate - npvValue / npvDerivative;

      // Bound the rate to prevent extreme values
      if (newRate < -0.99) {
        rate = -0.99;
      } else if (newRate > 10) {
        rate = 10;
      } else {
        rate = newRate;
      }

      // Check if we're oscillating
      if (
        i > 0 &&
        Math.abs(rate - (rate - npvValue / npvDerivative)) < precision
      ) {
        break;
      }
    }

    // If Newton-Raphson didn't converge, try bisection
    let low = -0.99;
    let high = 5;
    let npvLow = this.npv(low);
    let npvHigh = this.npv(high);

    // Check if we have a valid bracket
    if (npvLow * npvHigh > 0) {
      // Try to find a bracket
      for (let i = 0; i < 50; i++) {
        if (Math.abs(npvLow) < Math.abs(npvHigh)) {
          low = low - (high - low);
          low = Math.max(low, -0.99);
          npvLow = this.npv(low);
        } else {
          high = high + (high - low);
          high = Math.min(high, 10);
          npvHigh = this.npv(high);
        }

        if (npvLow * npvHigh < 0) {
          break;
        }
      }
    }

    // Bisection method
    if (npvLow * npvHigh < 0) {
      for (let i = 0; i < maxIterations; i++) {
        rate = (low + high) / 2;
        const npvMid = this.npv(rate);

        if (Math.abs(npvMid) < precision) {
          this.xirrResult = rate;
          return rate * 100;
        }

        if (npvMid * npvLow < 0) {
          high = rate;
          npvHigh = npvMid;
        } else {
          low = rate;
          npvLow = npvMid;
        }

        if (Math.abs(high - low) < precision) {
          this.xirrResult = rate;
          return rate * 100;
        }
      }
    }

    this.xirrResult = rate;
    return rate * 100;
  }

  clear() {
    this.transactions = [];
    this.xirrResult = null;
  }
}
const titleCache = new Map();

function sanitizeSchemeName(schemeName) {
  if (!schemeName) return "";

  const parts = schemeName.split("-");

  if (parts.length === 1) {
    // No hyphen case
    const match = schemeName.match(/.*?\bFund\b/i);
    return match ? match[0].trim() : schemeName.trim();
  }

  // Has hyphen
  const firstPart = parts[0].trim();
  const secondPart = parts[1].trim();

  let cleaned = fixCapitalization(
    /fund/i.test(secondPart) ? `${firstPart} - ${secondPart}` : firstPart
  );
  return cleaned;
}

function fixCapitalization(text) {
  if (!text) return "";

  const words = text.split(" ");

  // Check if all words are uppercase
  const allUpperCase = words.every(
    (word) => word === word.toUpperCase() && word.length > 0
  );

  // List of words that should stay uppercase (common AMC abbreviations)
  const uppercaseWords = [
    "SBI",
    "ICICI",
    "HDFC",
    "UTI",
    "LIC",
    "IDFC",
    "BOI",
    "BOB",
    "PNB",
    "HSBC",
    "JM",
    "DSP",
    "ITI",
    "PGIM",
    "PPFAS",
    "IIFL",
  ];

  // List of words that should be lowercase (articles, prepositions, conjunctions)
  const lowercaseWords = [
    "of",
    "and",
    "or",
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "to",
    "for",
  ];

  return words
    .map((word, index) => {
      // Check if word is in uppercase list
      if (uppercaseWords.includes(word.toUpperCase())) {
        return word.toUpperCase();
      }

      // If all uppercase originally, convert to title case
      if (allUpperCase) {
        // First word always capitalized
        if (index === 0) {
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        // Check if it should be lowercase
        if (lowercaseWords.includes(word.toLowerCase())) {
          return word.toLowerCase();
        }
        // Otherwise title case
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }

      // If first word is all caps (like SBI, ICICI), keep it
      if (index === 0 && word === word.toUpperCase() && word.length <= 6) {
        // Rest of words should be title case
        return word;
      }

      // If word is all lowercase at start, capitalize it
      if (index === 0 && word === word.toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      // For other words, apply title case if they're all lowercase
      if (word === word.toLowerCase() && !lowercaseWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      // Keep as is
      return word;
    })
    .join(" ");
}

function standardizeTitle(title) {
  if (!title) return "";

  // Check cache first
  if (titleCache.has(title)) {
    return titleCache.get(title);
  }

  const words = title.split(" ");
  const result = words
    .map((word, index) => {
      if (index === 0) {
        const specialWords = ["NIPPON", "QUANT", "MOTILAL"];
        if (specialWords.includes(word.toUpperCase())) {
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        } else {
          return word;
        }
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");

  titleCache.set(title, result);
  return result;
}

async function getFileSignature(file) {
  // Generate signature based on file content only (not metadata like name)
  try {
    const chunkSize = 16384; // 16KB chunks for better uniqueness
    const fileSize = file.size;

    // Read multiple chunks throughout the file for better fingerprinting
    const chunks = [];

    // Read as ArrayBuffer for consistent binary reading
    const readChunk = async (start, end) => {
      const blob = file.slice(start, end);
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    };

    // First chunk (contains PDF header and metadata)
    chunks.push(await readChunk(0, Math.min(chunkSize, fileSize)));

    // Multiple middle chunks for better distribution
    if (fileSize > chunkSize * 3) {
      const quarter = Math.floor(fileSize / 4);
      chunks.push(await readChunk(quarter, quarter + chunkSize));
      chunks.push(await readChunk(quarter * 3, quarter * 3 + chunkSize));
    } else if (fileSize > chunkSize * 2) {
      const midPoint = Math.floor(fileSize / 2);
      chunks.push(await readChunk(midPoint, midPoint + chunkSize));
    }

    // Last chunk
    if (fileSize > chunkSize) {
      chunks.push(await readChunk(Math.max(0, fileSize - chunkSize), fileSize));
    }

    // Create hash from binary data
    let hash = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < Math.min(chunk.length, 1000); i++) {
        hash = (hash << 5) - hash + chunk[i];
        hash = hash & hash; // Convert to 32-bit integer
      }
    }

    // Include first few bytes as additional fingerprint
    const fingerprint = Array.from(chunks[0].slice(0, 32))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Combine file size, hash, and binary fingerprint
    return `${fileSize}_${hash}_${fingerprint}`;
  } catch (err) {
    console.warn("Could not read file chunks:", err);
    // Fallback to just file size and timestamp if reading fails
    return `${file.size}_${file.lastModified}_fallback`;
  }
}

function getStoredInvestorName(userName) {
  return (
    localStorage.getItem(`investorName_${userName}`) ||
    userName.replace(/_\d+$/, "")
  );
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
      portfolioData.folios?.length
    );

    if (isSummaryCAS) {
      processSummaryCAS();
    } else {
      await processPortfolio();
      enableSummaryIncompatibleTabs();
    }

    const fullInvestorName =
      portfolioData.investor_info?.name?.trim() || "DebugUser";
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

    await storageManager.savePortfolioData(
      portfolioData,
      mfStats,
      true,
      currentUser
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
        "warning"
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
      portfolioData.folios?.length
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
        `♻️ Overwriting existing user: ${currentUser} (same investor: ${fullInvestorName})`
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
          `✨ Creating new user with increment: ${currentUser} (different investor: ${fullInvestorName})`
        );
      } else {
        // First name doesn't exist - use first name
        currentUser = firstNameFromCAS;
        console.log(
          `✨ Creating new user: ${currentUser} (new investor: ${fullInvestorName})`
        );
      }
    }

    localStorage.setItem("lastActiveUser", currentUser);

    // Save to IndexedDB BEFORE updating UI
    await storageManager.savePortfolioData(
      portfolioData,
      mfStats,
      true,
      currentUser
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
      "success"
    );
    updateFooterInfo();

    invalidateFamilyDashboardCache();

    switchDashboardTab("main");
  } catch (err) {
    hideProcessingSplash();
    console.error("ERROR:", err);
    showToast(
      "Could NOT process CAS. Please check the file/password and try again.",
      "error"
    );
  }
}

function processSummaryCAS() {
  // Disable tabs that are not relevant for summary
  disableSummaryIncompatibleTabs();

  // Build fundWiseData from summary folios
  fundWiseData = {};

  portfolioData.folios.forEach((folio) => {
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
    0
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

  const overallGain = currentValue - totalInvested;

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
      currentValue
    )}</span></div>
    <div class="folio-stat"><span class="label">Current Cost:</span><span class="value">₹${formatNumber(
      cost
    )}</span></div>
    <div class="folio-stat fund-card-separator-space"><span class="label">P&L:</span><span class="value ${
      unrealizedGain >= 0 ? "gain" : "loss"
    }">₹${formatNumber(
    Math.abs(unrealizedGain)
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

function disableSummaryIncompatibleTabs() {
  const tabsToDisable = [
    ".charts-button",
    ".transactions-button",
    ".capital-gains-button",
    ".past-holding-button",
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
      ManifestManager.SEARCH_KEYS_VERSION_KEY
    );
    const cachedKeys = ManifestManager.getSearchKeys();

    if (cachedKeys && cachedHash === dataHash) {
      return cachedKeys;
    }

    console.log(
      cachedKeys
        ? "🔄 Search keys changed, updating cache..."
        : "📥 Loading search keys for first time...",
      Object.keys(searchKeys).length
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

function showProcessingSplash() {
  document.querySelector(".loader").classList.remove("hidden");
}

function hideProcessingSplash() {
  document.querySelector(".loader").classList.add("hidden");
}

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
    { timeout: 2000 }
  );
}

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
    }
  } else if (tabId === "overlap-analysis") {
    displayOverlapAnalysis();
  } else if (tabId === "expense-impact") {
    displayExpenseImpact();
  } else if (tabId === "health-score") {
    displayHealthScore();
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

function normalizeBenchmarkName(name) {
  if (!name) return "";
  name = name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/tri$/i, "TRI")
    .replace(/^(NIFTY|BSE)\s*/i, "") // remove NIFTY/BSE prefix
    .replace(/\b(INDEX|TOTAL|RETURN|RETURNS)\b/gi, "") // remove noise words
    .trim();

  // Split into tokens, keep TRI separately
  const parts = name.split(/\s+/);
  const hasTRI = parts.some((p) => /^TRI$/i.test(p));
  const filtered = parts.filter((p) => !/^TRI$/i.test(p));

  // Sort alphabetically to normalize 250 SmallCap vs SmallCap 250
  filtered.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  // Reattach TRI at the end
  if (hasTRI) filtered.push("TRI");

  return filtered.join(" ").toUpperCase();
}

function aggregateBenchmarkReturns(fundWiseData) {
  const benchmarkReturns = {};

  Object.values(fundWiseData).forEach((fund) => {
    const { scheme, benchmark, return_stats } = fund || {};
    if (!benchmark || !return_stats) return;

    const bmKey = normalizeBenchmarkName(benchmark);
    const r1 = return_stats.index_return1y;
    const r3 = return_stats.index_return3y;
    const r5 = return_stats.index_return5y;

    if (!benchmarkReturns[bmKey]) {
      benchmarkReturns[bmKey] = {
        "1Y": null,
        "3Y": null,
        "5Y": null,
        schemes: new Set(),
      };
    }

    benchmarkReturns[bmKey].schemes.add(scheme);

    const current = benchmarkReturns[bmKey];
    if (r1 != null && !isNaN(r1) && current["1Y"] == null)
      current["1Y"] = parseFloat(r1.toFixed(2));
    if (r3 != null && !isNaN(r3) && current["3Y"] == null)
      current["3Y"] = parseFloat(r3.toFixed(2));
    if (r5 != null && !isNaN(r5) && current["5Y"] == null)
      current["5Y"] = parseFloat(r5.toFixed(2));
  });

  // Final cleanup
  Object.keys(benchmarkReturns).forEach((bm) => {
    benchmarkReturns[bm].schemes = [...benchmarkReturns[bm].schemes];
    if (["1Y", "3Y", "5Y"].every((k) => benchmarkReturns[bm][k] == null)) {
      delete benchmarkReturns[bm];
    }
  });

  return benchmarkReturns;
}

function aggregateFundWiseData() {
  if (isSummaryCAS) {
    console.log("⏭️ Skipping aggregateFundWiseData for Summary CAS");
    return fundWiseData;
  }

  fundWiseData = {};

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

      // Skip if there are no transactions
      if (
        !Array.isArray(scheme.transactions) ||
        scheme.transactions.length === 0
      )
        return;

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
      const excludedTypes = ["STAMP_DUTY_TAX", "STT_TAX", "MISC", "OTHER"];

      const typeMap = {
        PURCHASE: "PURCHASE",
        PURCHASE_SIP: "PURCHASE",
        SWITCH_IN: "PURCHASE",
        DIVIDEND_REINVEST: "PURCHASE",
        REDEMPTION: "REDEMPTION",
        SWITCH_OUT: "REDEMPTION",
      };

      const filteredTxns = scheme.transactions
        .filter((t) => !excludedTypes.includes(t.type))
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
        new Date(current.date) > new Date(latest.date) ? current : latest
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

function getFinancialYear(date) {
  const d = new Date(date);
  if (isNaN(d)) throw new Error("Invalid date");

  const year = d.getFullYear();
  const month = d.getMonth(); // 0–11

  const fyStartYear = month >= 3 ? year : year - 1;
  const fyEndYear = fyStartYear + 1;

  return `FY ${fyStartYear}-${String(fyEndYear).slice(-2)}`;
}

let capitalGainsData = {
  byYear: {},
  currentYear: {},
  allTime: {
    equity: { stcg: 0, ltcg: 0, redeemed: 0 },
    debt: { stcg: 0, ltcg: 0, redeemed: 0 },
    hybrid: { stcg: 0, ltcg: 0, redeemed: 0 },
  },
};

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

  // Group by folio for proper FIFO
  const folioGroups = {};
  fund.transactions.forEach((tx) => {
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
            (saleDate - batch.purchaseDate) / (1000 * 60 * 60 * 24)
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
      0
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
            0
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
        }))
      );
    }
  });

  const remainingCost = remainingUnitsAllFolios.reduce(
    (sum, batch) => sum + batch.units * batch.nav,
    0
  );

  const totalUnitsRemaining = remainingUnitsAllFolios.reduce(
    (sum, batch) => sum + batch.units,
    0
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
          0
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
        date.getMonth() + 1
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
      txDate.getMonth() + 1
    ).padStart(2, "0")}-${String(txDate.getDate()).padStart(2, "0")}`;
    if (!txByDate.has(dateStr)) {
      txByDate.set(dateStr, []);
    }
    txByDate.get(dateStr).push(tx);
  });

  const firstTxDate = new Date(
    Math.min(...fund.transactions.map((tx) => new Date(tx.date)))
  );

  // Use today's date to include current valuation
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(
    today.getMonth() + 1
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
      "0"
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
      0
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

  const labels = dataToUse.map((item) => {
    // Parse the date string directly (YYYY-MM-DD format)
    const [year, month, day] = item.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  });

  const values = dataToUse.map((item) => item.value);
  const costs = dataToUse.map((item) => item.cost);

  return { labels, values, costs, rawData: dataToUse };
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
                (((totalValue - totalCost) / totalCost) * 100).toFixed(2)
              )
            : 0,
        funds: fundsWithData,
      });
    }
  });

  return Array.from(portfolioMap.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
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
        { timeout: 100 }
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

function updateProcessingProgress(percent, message) {
  const progressBar = document.getElementById("processingProgress");
  const progressText = document.getElementById("processingText");

  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (progressText) {
    progressText.textContent = message;
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;

  // Handle DD-MM-YYYY or DD-MMM-YYYY format
  const dmy = dateStr.match(/(\d{1,2})-([A-Z]{3}|\d{1,2})-(\d{4})/i);
  if (dmy) {
    const day = parseInt(dmy[1]);
    let month;

    if (isNaN(parseInt(dmy[2]))) {
      // Month is text (MMM format)
      const months = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      month = months[dmy[2].toLowerCase()];
    } else {
      // Month is number
      month = parseInt(dmy[2]) - 1;
    }

    const year = parseInt(dmy[3]);
    // Create date at noon to avoid timezone issues
    return new Date(year, month, day, 12, 0, 0, 0);
  }

  // Fallback to standard parsing
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    // Set to noon to avoid timezone issues
    parsed.setHours(12, 0, 0, 0);
    return parsed;
  }

  return null;
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
      folioSummary.cashflows.forEach((cf) => {
        const enriched = {
          scheme: fund.schemeDisplay || fund.scheme,
          folio: folioSummary.folio,
          type: cf.type === "Buy" ? "PURCHASE" : "REDEMPTION",
          date: new Date(cf.date),
          amount: cf.amount,
          nav: cf.nav,
          units: cf.units,
        };

        allTimeFlows.push(enriched);

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
      amount: currentValue,
      nav: null,
      units: null,
    };
    allTimeFlows.push(valuationFlow);
    activeFlows.push(valuationFlow);
  }

  allTimeFlows.sort((a, b) => a.date - b.date);
  activeFlows.sort((a, b) => a.date - b.date);

  const overallGain = currentValue - totalInvested + totalWithdrawn;

  let allTimeXirr = null;
  if (allTimeFlows.length >= 2) {
    const cashFlowsSimple = allTimeFlows.map((cf) => ({
      date: cf.date,
      amount: cf.amount,
    }));
    allTimeXirr = calculatePortfolioXIRR(cashFlowsSimple);
  }

  let activeXirr = null;
  if (activeFlows.length >= 2) {
    const cashFlowsSimple = activeFlows.map((cf) => ({
      date: cf.date,
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

function getCapitalGainsTransactions() {
  const transactions = [];

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
              (saleDate - batch.purchaseDate) / (1000 * 60 * 60 * 24)
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
    (a, b) => new Date(b.redemptionDate) - new Date(a.redemptionDate)
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

function displayCapitalGains() {
  const container = document.getElementById("capitalGainsContent");
  if (!container) return;

  const currentFY = getFinancialYear(new Date());
  const hasCurrentYearData = Object.values(capitalGainsData.currentYear).some(
    (cat) =>
      cat.stcg !== 0 ||
      cat.ltcg !== 0 ||
      cat.stcgRedeemed !== 0 ||
      cat.ltcgRedeemed !== 0
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
        <div class="year-selector">
    `;

    years.forEach((fy) => {
      // 🔧 FIX: Add active class to defaultFY
      html += `
        <button class="year-btn ${fy === defaultFY ? "active" : ""}"
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
      cat.ltcgRedeemed !== 0
  );

  html += `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>🏆 All-Time Summary</h3>
        <p class="section-subtitle">Complete history of capital gains</p>
      </div>`;

  if (!hasAllTimeData) {
    html += `<p class="no-data">No redemptions made yet</p></div>`;
  } else {
    html += `<div class="gains-summary-grid">`;

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
          Math.abs(data.stcg)
        )}</span>
          </div>
          <div class="summary-row">
            <span>LTCG:</span>
            <span class="${data.ltcg >= 0 ? "gain" : "loss"}">₹${formatNumber(
          Math.abs(data.ltcg)
        )}</span>
          </div>
          <div class="summary-row total">
            <span>Total Gains:</span>
            <span class="${totalGains >= 0 ? "gain" : "loss"}">₹${formatNumber(
          Math.abs(totalGains)
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
          <button class="primary-btn" onclick="downloadCapitalGainsReport()">
            📥 Download All Time Report
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

// Update the showYearGains function to include transactions
function showYearGainsWithTransactions(fy) {
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
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
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
        Math.abs(data.stcg)
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
        Math.abs(data.ltcg)
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
      hasInflow
    );
    return null;
  }

  // Use XIRRCalculator class instead
  const calc = new XIRRCalculator();

  cashFlows.forEach((cf) => {
    const type = cf.amount < 0 ? "buy" : "sell";
    calc.addTransaction(type, cf.date, Math.abs(cf.amount));
  });

  try {
    return calc.calculateXIRR();
  } catch (error) {
    console.log("XIRR calculation failed:", error.message);
    return null;
  }
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
      <td>${cf.folio || "Unknown"}</td>
      <td><span class="tx-type">${txType}</span></td>
      <td>${cf.date.toISOString().split("T")[0]}</td>
      <td>₹${cf.nav ? cf.nav.toFixed(4) : "N/A"}</td>
      <td>${cf.units ? cf.units.toFixed(3) : "N/A"}</td>
      <td class="amount" style="color: ${amountColor};">₹${Math.abs(
      cf.amount
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
      <td>${cf.folio || "Unknown"}</td>
      <td><span class="tx-type">${txType}</span></td>
      <td>${cf.date.toISOString().split("T")[0]}</td>
      <td>₹${cf.nav ? cf.nav.toFixed(4) : "N/A"}</td>
      <td>${cf.units ? cf.units.toFixed(3) : "N/A"}</td>
      <td class="amount" style="color: ${amountColor};">₹${Math.abs(
      cf.amount
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

function lockBodyScroll() {
  const scrollBarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.body.style.paddingRight = `${scrollBarWidth}px`;
}

function unlockBodyScroll() {
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
}

// Shows overlay for All-Time Transactions
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
    createTransactionTable(allTimeFlows, "allTimeTable")
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

// Shows overlay for Active Transactions
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

function toggleTransactionSection(sectionId) {
  const section = document.getElementById(sectionId);
  const content = section.querySelector(".transaction-section-content");
  const excelExportBtn = section.querySelector(".trans-download");
  const btn = section.querySelector(".toggle-section-btn");

  content.classList.toggle("hidden");
  excelExportBtn.classList.toggle("hidden");
  btn.textContent = content.classList.contains("hidden") ? "▶" : "▼";
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
        <button class="modal-close" onclick="closeFundTransactionModal()">✕</button>
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
  benchmark_returns
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
    safeRound
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

function showFundDetailsModal(
  fundKey,
  isPastHolding = false,
  specificFolios = null
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
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase()
      );
      return (
        schemeInFolio && parseFloat(schemeInFolio.valuation?.value || 0) === 0
      );
    });
    targetFolios = displayFolios;
  } else if (specificFolios) {
    displayFolios = specificFolios;
  } else {
    // For current holdings, only show active folios
    displayFolios = fund.folios.filter((folioNum) => {
      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return false;
      return folioData.schemes.some(
        (s) =>
          s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase() &&
          s.valuation &&
          parseFloat(s.valuation.value || 0) > 0
      );
    });
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
        }
      );
    }
    if (current > 0) {
      calc.addTransaction(
        "Sell",
        new Date().toISOString().split("T")[0] + "T00:00:00.000Z",
        current
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

  modal.innerHTML = `
    <div class="transaction-modal fund-details-modal">
      <div class="modal-header">
        <h2>${displayName}</h2>
        <button class="modal-close" onclick="closeFundDetailsModal()">✕</button>
      </div>
      <div class="modal-content fund-details-content">
        
        <!-- Summary Stats Section -->
        <div class="fund-details-section">
          <h3>📊 Summary</h3>
          <div class="fund-details-stats-grid">
            <div class="fund-detail-stat">
              <span class="stat-label">AMC</span>
              <span class="stat-value">${standardizeTitle(fund.amc)}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Folios</span>
              <span class="stat-value">${displayFolios
                .map((f) => f.split("/")[0].trim())
                .join(", ")}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">${
                isPastHolding ? "Total Withdrawn" : "Current Value"
              }</span>
              <span class="stat-value">₹${formatNumber(
                isPastHolding ? cost + unrealizedGain : current
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">${
                isPastHolding ? "Total Invested" : "Current Cost"
              }</span>
              <span class="stat-value">₹${formatNumber(cost)}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Units</span>
              <span class="stat-value">${roundValue(units)}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Avg NAV</span>
              <span class="stat-value">${roundValue(avgNav)}</span>
            </div>
            ${
              !isPastHolding
                ? `<div class="fund-detail-stat">
                  <span class="stat-label">Avg. Holding Days</span>
                  <span class="stat-value">${roundValue(avgHoldingDays)}</span>
                </div>`
                : ""
            }
            <div class="fund-detail-stat">
              <span class="stat-label">P&L</span>
              <span class="stat-value ${unrealizedGain >= 0 ? "gain" : "loss"}">
                ₹${formatNumber(
                  Math.abs(unrealizedGain)
                )} (${unrealizedGainPercentage}%)
              </span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">XIRR</span>
              <span class="stat-value">${xirrText}</span>
            </div>
          </div>
        </div>

        <!-- Charts Row - Side by side on desktop, stacked on mobile -->
        <div class="fund-details-charts-row">
          <div class="fund-details-section">
            <h3>📈 Valuation History</h3>
            <div class="fund-detail-chart-wrapper">
              <canvas id="modalFundValuationChart"></canvas>
            </div>
          </div>

          ${
            extendedData
              ? `
          <div class="fund-details-section">
            <h3>📊 Performance Comparison</h3>
            <div class="fund-detail-chart-wrapper">
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
        <div class="fund-details-section">
          <h3>🧩 Fund Composition</h3>
          <div class="composition-charts-grid">
            <div>
              <h4>Asset Allocation</h4>
              <div class="fund-detail-chart-wrapper">
                <canvas id="modalAssetAllocationChart"></canvas>
              </div>
            </div>
            <div>
              <h4>Market Cap Split</h4>
              <div class="fund-detail-chart-wrapper">
                <canvas id="modalMarketCapChart"></canvas>
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
        <div class="fund-details-section">
          <h3>📉 Fund Statistics</h3>
          <div class="fund-details-stats-grid">
            <div class="fund-detail-stat">
              <span class="stat-label">Alpha</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.alpha
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Beta</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.beta
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Sharpe Ratio</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.sharpe_ratio
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Sortino Ratio</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.sortino_ratio
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Information Ratio</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.information_ratio
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Standard Deviation</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.standard_deviation
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Expense Ratio</span>
              <span class="stat-value">${roundValue(
                extendedData.expense_ratio
              )}%</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">1Y Return</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.return1y
              )}%</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">3Y Return</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.return3y
              )}%</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">5Y Return</span>
              <span class="stat-value">${roundValue(
                extendedData.return_stats?.return5y
              )}%</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">Rating</span>
              <span class="stat-value">${roundValue(
                extendedData.groww_rating
              )}</span>
            </div>
            <div class="fund-detail-stat">
              <span class="stat-label">AUM</span>
              <span class="stat-value">₹${formatNumber(
                roundValue(extendedData.aum)
              )}CR</span>
            </div>
          </div>
        </div>
        `
            : ""
        }

        <!-- Quick Actions Section -->
        <div class="fund-details-section">
          <h3>⚡ Quick Actions</h3>
          <div class="fund-details-actions">
            <button class="primary-btn" onclick="showFundHoldings('${fundKey}')">
              <i class="fa-solid fa-eye"></i> View Holdings (${
                fund.holdings?.length || 0
              })
            </button>
            <button class="primary-btn" onclick="showFundTransactions('${fundKey}', '${fund.folios.join(
    ","
  )}')">
              <i class="fa-solid fa-exchange-alt"></i> View Transactions
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
    window.location.pathname
  );

  // Render charts after modal is in DOM
  setTimeout(() => {
    renderModalFundValuationChart(fundKey);
    if (extendedData) {
      renderModalFundPerformanceChart(
        fundKey,
        extendedData,
        fund.benchmark_returns
      );
      renderModalCompositionCharts(fundKey, extendedData);
    }
  }, 50);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFundDetailsModal();
  });
}

function renderModalFundValuationChart(fundKey) {
  const fund = fundWiseData[fundKey];
  const dailyValuation = fund.advancedMetrics?.dailyValuation;

  if (!dailyValuation || dailyValuation.length === 0) return;

  const canvas = document.getElementById("modalFundValuationChart");
  if (!canvas) return;

  const colors = getChartColors();
  const ctx = canvas.getContext("2d");

  const allData = dailyValuation;
  const labels = allData.map((d) => {
    const date = new Date(d.date);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });

  const values = allData.map((d) => d.value);
  const costs = allData.map((d) => d.cost);

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
      maintainAspectRatio: true,
      aspectRatio: 2,
      interaction: { intersect: false, mode: "index", axis: "x" },
      plugins: {
        legend: { display: true, position: "bottom" },
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
  benchmark_returns
) {
  const ctx = document.getElementById("modalFundPerformanceChart");
  if (!ctx) return;

  const colors = getChartColors();
  const labels = ["1Y", "3Y", "5Y"];
  const safeRound = (val) =>
    typeof val === "number" && !isNaN(val) ? Math.round(val * 100) / 100 : null;

  const stats = extendedData.return_stats || {};
  const fundData = [stats.return1y, stats.return3y, stats.return5y].map(
    safeRound
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
      aspectRatio: 2,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            boxWidth: 12,
            font: { size: 11 },
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

function renderModalCompositionCharts(fundKey, extendedData) {
  const ps = extendedData?.portfolio_stats;
  if (!ps) return;

  // Asset Allocation Chart
  const assetContainer = document.getElementById("modalAssetAllocationChart");
  if (assetContainer) {
    const rawAsset = ps.asset_allocation || {};
    let equity = 0,
      debt = 0,
      gold = 0,
      silver = 0;

    Object.entries(rawAsset).forEach(([key, value]) => {
      const val = parseFloat(value);
      if (isNaN(val) || val <= 0) return;

      const k = key.toLowerCase();
      let bucket = "debt";

      if (k.includes("equity")) {
        bucket = "equity";
      } else if (k.includes("commodities")) {
        const subcategory = extendedData?.sub_category?.toLowerCase?.() || "";
        const name = fundKey?.toLowerCase?.() || "";

        if (subcategory.includes("gold") || name.includes("gold")) {
          bucket = "gold";
        } else if (subcategory.includes("silver") || name.includes("silver")) {
          bucket = "silver";
        } else {
          bucket = "debt";
        }
      } else {
        bucket = "debt";
      }

      switch (bucket) {
        case "equity":
          equity += val;
          break;
        case "gold":
          gold += val;
          break;
        case "silver":
          silver += val;
          break;
        default:
          debt += val;
      }
    });

    const segments = [];
    if (equity > 0)
      segments.push({ key: "equity", label: "Equity", value: equity });
    if (debt > 0) segments.push({ key: "debt", label: "Debt", value: debt });
    if (gold > 0) segments.push({ key: "other", label: "Gold", value: gold });
    if (silver > 0)
      segments.push({ key: "other", label: "Silver", value: silver });

    // Sort by value descending
    segments.sort((a, b) => b.value - a.value);

    if (segments.length > 0) {
      const total = segments.reduce((sum, s) => sum + s.value, 0);
      const normalizedSegments = segments.map((s) => ({
        ...s,
        value: (s.value / total) * 100,
      }));

      const barHTML = normalizedSegments
        .map(
          (s) => `
          <div class="composition-segment ${s.key}"
               style="width: ${s.value}%"
               title="${s.label}: ${s.value.toFixed(1)}%">
          </div>
        `
        )
        .join("");

      const legendHTML = normalizedSegments
        .map(
          (s) => `
          <span class="legend-item">
            <span class="legend-color ${s.key}"></span>${
            s.label
          }: ${s.value.toFixed(1)}%
          </span>
        `
        )
        .join("");

      assetContainer.parentElement.innerHTML = `
        <div class="fund-composition-chart">
          <div class="composition-bar">${barHTML}</div>
          <div class="composition-legend">${legendHTML}</div>
        </div>
      `;
    } else {
      assetContainer.parentElement.innerHTML =
        '<div class="fund-composition-chart empty-composition">No data available</div>';
    }
  }

  // Market Cap Chart
  const mcapContainer = document.getElementById("modalMarketCapChart");
  if (mcapContainer) {
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
      large = (large / total) * 100;
      mid = (mid / total) * 100;
      small = (small / total) * 100;

      const segments = [];
      if (large > 0)
        segments.push({ key: "large-cap", label: "Large", value: large });
      if (mid > 0) segments.push({ key: "mid-cap", label: "Mid", value: mid });
      if (small > 0)
        segments.push({ key: "small-cap", label: "Small", value: small });

      // Sort by value descending
      segments.sort((a, b) => b.value - a.value);

      const barHTML = segments
        .map(
          (s) => `
          <div class="composition-segment ${s.key}"
               style="width: ${s.value}%"
               title="${s.label}: ${s.value.toFixed(1)}%">
          </div>
        `
        )
        .join("");

      const legendHTML = segments
        .map(
          (s) => `
          <span class="legend-item">
            <span class="legend-color ${s.key}"></span>${
            s.label
          }: ${s.value.toFixed(1)}%
          </span>
        `
        )
        .join("");

      mcapContainer.parentElement.innerHTML = `
        <div class="fund-composition-chart">
          <div class="composition-bar">${barHTML}</div>
          <div class="composition-legend">${legendHTML}</div>
        </div>
      `;
    } else {
      mcapContainer.parentElement.innerHTML =
        '<div class="fund-composition-chart empty-composition">No data available</div>';
    }
  }
}

function createFundCardForFolios(fund, fundKey, folios, isActive) {
  const folioNumbers = folios.map((f) => f.folioNum);

  // Use advancedMetrics.folioSummaries for calculations
  let invested = 0;
  let withdrawn = 0;
  let current = 0;
  let cost = 0;
  let realizedGain = 0;
  let unrealizedGain = 0;

  const advancedMetrics = fund.advancedMetrics;

  let remainingUnits = parseFloat(advancedMetrics.totalUnitsRemaining).toFixed(
    3
  );
  let averageHoldingDays = parseFloat(
    advancedMetrics.averageHoldingDays
  ).toFixed(1);
  let averageRemainingCostPerUnit = parseFloat(
    advancedMetrics.averageRemainingCostPerUnit
  ).toFixed(3);

  const targetFolioSummaries = [];

  Object.values(advancedMetrics.folioSummaries).forEach((folioSummary) => {
    if (folioNumbers.includes(folioSummary.folio)) {
      targetFolioSummaries.push(folioSummary);
      invested += folioSummary.invested;
      withdrawn += folioSummary.withdrawn;
      current += folioSummary.currentValue;
      cost += folioSummary.remainingCost;
      realizedGain += folioSummary.realizedGain;
      unrealizedGain += folioSummary.unrealizedGain;
    }
  });

  const overallGain = current - invested + withdrawn;

  const investedAmountForRealized = invested - cost;
  const realizedGainPercentage = parseFloat(
    investedAmountForRealized > 0
      ? (realizedGain / investedAmountForRealized) * 100
      : 0
  ).toFixed(2);
  const unrealizedGainPercentage = parseFloat(
    cost > 0 ? (unrealizedGain / cost) * 100 : 0
  ).toFixed(2);

  // Calculate XIRR using cashflows from folioSummaries
  const calc = new XIRRCalculator();
  targetFolioSummaries.forEach((folioSummary) => {
    folioSummary.cashflows.forEach((cf) => {
      calc.addTransaction(cf.type, cf.date, Math.abs(cf.amount));
    });
  });

  if (current > 0) {
    calc.addTransaction(
      "Sell",
      new Date().toISOString().split("T")[0] + "T00:00:00.000Z",
      current
    );
  }

  let xirr = null;
  try {
    xirr = calc.calculateXIRR();
  } catch (e) {
    console.debug("XIRR calculation failed for", fundKey, e);
  }

  const xirrText =
    xirr == null || isNaN(xirr) ? "--" : `${parseFloat(xirr.toFixed(2))}%`;

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
    realizedGainPercentage,
    Math.round(unrealizedGain),
    unrealizedGainPercentage,
    remainingUnits,
    averageRemainingCostPerUnit,
    averageHoldingDays,
    xirrText
  );
}

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

  fundsArray.forEach(([fundKey, fund]) => {
    const totalInvested = fund.transactions
      .filter((t) => t.type === "PURCHASE")
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    if (totalInvested === 0) return;

    const activeFolios = [];
    const inactiveFolios = [];

    fund.folios.forEach((folioNum) => {
      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return;

      const schemeInFolio = folioData.schemes.find(
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase()
      );

      if (schemeInFolio) {
        const folioValue = schemeInFolio.valuation
          ? parseFloat(schemeInFolio.valuation.value || 0)
          : 0;

        if (folioValue > 0) {
          activeFolios.push({ folioNum, folioData: schemeInFolio });
        } else {
          inactiveFolios.push({ folioNum, folioData: schemeInFolio });
        }
      }
    });

    if (activeFolios.length > 0) {
      const activeCard = createFundCardForFolios(
        fund,
        fundKey,
        activeFolios,
        true
      );
      currentGrid.appendChild(activeCard);
    }

    if (inactiveFolios.length > 0) {
      const inactiveCard = createFundCardForFolios(
        fund,
        fundKey,
        inactiveFolios,
        false
      );
      pastGrid.appendChild(inactiveCard);
      hasPast = true;
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

  if (hasPast) {
    pastSection?.classList.remove("hidden");
    pastSectionMobile?.classList.remove("hidden");
  } else {
    pastSection?.classList.remove("hidden");
    pastSectionMobile?.classList.remove("hidden");

    // Show message when no past holdings
    pastGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 20px;">📋</div>
        <h3 style="margin-bottom: 10px; color: var(--text-primary);">No Past Holdings</h3>
        <p style="color: var(--text-tertiary);">You don't have any fully redeemed funds yet.</p>
      </div>
    `;
  }
}

function createFundCompositionCharts(extendedData, fundKey) {
  const ps = extendedData?.portfolio_stats;
  if (!ps) return "";

  let html = "";

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const buildChartHTML = (title, segments) => {
    const hasData = segments.some((s) => s.value > 0);

    if (!hasData) {
      return `
        <div class="folio-stat fund-card-separator-header"><span class="label">${title}:</span></div>
        <div class="fund-composition-chart empty-composition">No Data</div>
      `;
    }

    const barHTML = segments
      .filter((s) => s.value > 0)
      .map(
        (s) => `
        <div class="composition-segment ${s.key}"
             style="width: ${s.value}%"
             title="${cap(s.label)}: ${s.value.toFixed(1)}%">
        </div>`
      )
      .join("");

    const legendHTML = segments
      .filter((s) => s.value > 0)
      .map(
        (s) => `
        <span class="legend-item">
          <span class="legend-color ${s.key}"></span>${cap(
          s.label
        )}: ${s.value.toFixed(1)}%
        </span>`
      )
      .join("");

    return `
      <div class="folio-stat fund-card-separator-header"><span class="label">${title}:</span></div>
      <div class="fund-composition-chart">
        <div class="composition-bar">${barHTML}</div>
        <div class="composition-legend">${legendHTML}</div>
      </div>
    `;
  };

  const normalizeAndSort = (segments) => {
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    if (total <= 0) {
      return segments.map((s) => ({ ...s, value: 0 }));
    }

    const normalized = segments.map((s) => ({
      ...s,
      value: (s.value / total) * 100,
    }));

    normalized.sort((a, b) => b.value - a.value);

    return normalized;
  };

  // ---------- ASSET ALLOCATION ----------

  const rawAsset = ps.asset_allocation || {};

  let equity = 0,
    debt = 0,
    gold = 0,
    silver = 0;

  Object.entries(rawAsset).forEach(([key, value]) => {
    const val = parseFloat(value);
    if (isNaN(val) || val <= 0) return;

    const k = key.toLowerCase();

    let bucket = "debt";

    if (k.includes("equity")) {
      bucket = "equity";

      // Commodities → gold/silver if detected, otherwise debt
    } else if (k.includes("commodities")) {
      const subcategory = extendedData?.sub_category?.toLowerCase?.() || "";
      const name = fundKey?.toLowerCase?.() || "";

      if (subcategory.includes("gold") || name.includes("gold")) {
        bucket = "gold";
      } else if (subcategory.includes("silver") || name.includes("silver")) {
        bucket = "silver";
      } else {
        bucket = "debt";
      }
    } else {
      bucket = "debt";
    }

    // Add values
    switch (bucket) {
      case "equity":
        equity += val;
        break;
      case "gold":
        gold += val;
        break;
      case "silver":
        silver += val;
        break;
      default:
        debt += val; // everything else → debt
    }
  });

  // Only these 4 buckets now exist
  const assetSegments = normalizeAndSort([
    { key: "equity", label: "equity", value: equity },
    { key: "gold", label: "gold", value: gold },
    { key: "silver", label: "silver", value: silver },
    { key: "debt", label: "debt", value: debt },
  ]);

  html += buildChartHTML("Asset Allocation", assetSegments);

  // ---------- MARKET CAP ----------

  let large = 0,
    mid = 0,
    small = 0;

  const hasDirectMC =
    ps.large_cap !== undefined ||
    ps.mid_cap !== undefined ||
    ps.small_cap !== undefined;

  const hasMCPer =
    ps.market_cap_per &&
    (ps.market_cap_per.large ||
      ps.market_cap_per.mid ||
      ps.market_cap_per.small);

  if (hasDirectMC) {
    large = parseFloat(ps.large_cap || 0) || 0;
    mid = parseFloat(ps.mid_cap || 0) || 0;
    small = parseFloat(ps.small_cap || 0) || 0;
  } else if (hasMCPer) {
    large = parseFloat(ps.market_cap_per.large || 0) || 0;
    mid = parseFloat(ps.market_cap_per.mid || 0) || 0;
    small = parseFloat(ps.market_cap_per.small || 0) || 0;
  }

  const mcapSegments = normalizeAndSort([
    { key: "large-cap", label: "large", value: large },
    { key: "mid-cap", label: "mid", value: mid },
    { key: "small-cap", label: "small", value: small },
  ]);

  html += buildChartHTML("Market Cap Split", mcapSegments);

  return html;
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
  xirrText
) {
  const card = document.createElement("div");
  card.className = "folio-card";

  const extendedData = mfStats[fund.isin];
  const displayFolios = fund.folios.filter((folioNum) => {
    if (current > 0) {
      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return false;
      return folioData.schemes.some(
        (s) =>
          s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase() &&
          s.valuation &&
          parseFloat(s.valuation.value || 0) > 0
      );
    } else {
      return true;
    }
  });

  function roundValue(val) {
    if (val === null || val === undefined) return "--";
    if (typeof val === "number") return Math.round(val * 100) / 100;
    return val;
  }

  // Store folio numbers in data attribute for transaction viewing
  const folioNumbersStr = fund.folios.join(",");
  const displayName = fund.schemeDisplay || fund.scheme;

  card.innerHTML = `
    <h4 title="${displayName}">${displayName}</h4>
    <div class="folio-info">
      ${standardizeTitle(fund.amc)}${
    displayFolios.length > 0
      ? " • " + displayFolios.map((f) => f.split("/")[0].trim()).join(", ")
      : ""
  }</div>
    ${
      current <= 0
        ? `<div class="folio-stat fund-card-separator"><span class="label">Invested:</span><span class="value">₹${formatNumber(
            invested
          )}</span></div>
    <div class="folio-stat"><span class="label">Withdrawn:</span><span class="value">₹${formatNumber(
      withdrawn
    )}</span></div>`
        : ""
    }
    ${
      current <= 0
        ? `<div class="folio-stat fund-card-separator-space"><span class="label">P&L:</span><span class="value ${
            realizedGain >= 0 ? "gain" : "loss"
          }">
            ₹${formatNumber(
              Math.abs(realizedGain)
            )} (${realizedGainPercentage}%)</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat"><span class="label">Current Value:</span><span class="value">₹${formatNumber(
            current
          )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat"><span class="label">Current Cost:</span><span class="value">₹${formatNumber(
            remainingCost
          )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat"><span class="label">P&L:</span><span class="value ${
            unrealizedGain >= 0 ? "gain" : "loss"
          }">
          ₹${formatNumber(Math.abs(unrealizedGain))} (${
            current > 0 ? unrealizedGainPercentage : realizedGainPercentage
          }%)</span></div>`
        : ""
    }
    <div class="folio-stat fund-card-separator-space"><span class="label">XIRR:</span><span class="value">${xirrText}</span></div>
    <div class="fund-card-actions">
      ${
        current > 0
          ? `
      <button class="fund-action-btn primary" onclick="showFundDetailsModal('${fundKey}', false)">
        <i class="fa-solid fa-chart-line"></i> View Details
      </button>
      
      <button class="fund-action-btn secondary" onclick="event.stopPropagation(); showFundHoldings('${fundKey}')">
        <i class="fa-solid fa-eye"></i> Holdings (${fund.holdings.length})
      </button>
      `
          : ""
      }
    </div>
  `;

  return card;
}

function downloadFundTransactions(fundKey) {
  const fund = fundWiseData[fundKey];
  if (!fund) return;

  const transactions = fund.transactions.map((tx) => ({
    scheme: fund.scheme,
    folio: fund.folios[0] || "Unknown",
    type: tx.type,
    date: new Date(tx.date),
    amount: Math.abs(parseFloat(tx.nav * tx.units) || 0),
  }));

  const filename = `${fund.scheme.replace(/\s+/g, "_")}_transactions.xlsx`;
  generateExcelReport(transactions, filename);
}

function updateSummaryCards(summary) {
  document.getElementById("totalInvested").textContent = formatNumber(
    summary.totalInvested
  );
  document.getElementById("currentValue").textContent = formatNumber(
    summary.currentValue
  );
  document.getElementById("totalWithdrawn").textContent = formatNumber(
    summary.totalWithdrawn
  );

  document.getElementById("costBasis").textContent = formatNumber(
    summary.costPrice
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
    summary.allTimeXirr
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
    null
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
    summary.activeXirr
  );

  const activeFundCount = Object.values(fundWiseData).filter(
    (fund) => (fund.advancedMetrics?.currentValue || 0) > 0
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
  const xirrText =
    xirr !== null ? ` | XIRR: ${xirr.toFixed(2)}%` : " | XIRR: --";
  if (isSummaryCAS) {
    document.getElementById(percentId).textContent =
      "Absolute: " + (gain >= 0 ? "+" : "") + percent + "%";
  } else {
    document.getElementById(percentId).textContent =
      "Absolute: " +
      (gain >= 0 ? "+" : "") +
      percent +
      "%" +
      (percentId === "realizedGainPercent" ? "" : xirrText);
  }
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

function adjustXAxisLabels(chart) {
  const ctx = chart.ctx;
  const xAxis = chart.scales.x;
  if (!xAxis) return;

  const ticks = xAxis.ticks;
  if (ticks.length < 2) return;

  // Get approximate label width
  ctx.font = `${chart.options.scales.x.ticks.font?.size || 12}px ${
    chart.options.scales.x.ticks.font?.family || "sans-serif"
  }`;
  const labelWidth = Math.max(
    ...ticks.map((t) => ctx.measureText(t.label).width)
  );

  // Get distance between first two tick marks
  const tickDistance = xAxis.width / (ticks.length - 1) || 1;

  // If labels overlap, tilt them up to 45°
  if (labelWidth > tickDistance * 0.9) {
    chart.options.scales.x.ticks.maxRotation = 45;
    chart.options.scales.x.ticks.minRotation = 30;
  } else {
    chart.options.scales.x.ticks.maxRotation = 0;
    chart.options.scales.x.ticks.minRotation = 0;
  }

  chart.update("none"); // refresh without animation
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
// Helper: Smart X-axis tilt ---
function adjustXAxisLabels(chart) {
  const ctx = chart.ctx;
  const xAxis = chart.scales.x;
  if (!xAxis) return;
  const ticks = xAxis.ticks;
  if (ticks.length < 2) return;

  ctx.font = `${chart.options.scales.x.ticks.font?.size || 12}px ${
    chart.options.scales.x.ticks.font?.family || "sans-serif"
  }`;

  const labelWidth = Math.max(
    ...ticks.map((t) => ctx.measureText(t.label).width)
  );
  const tickDistance = xAxis.width / (ticks.length - 1) || 1;

  if (labelWidth > tickDistance * 0.9) {
    chart.options.scales.x.ticks.maxRotation = 45;
    chart.options.scales.x.ticks.minRotation = 30;
  } else {
    chart.options.scales.x.ticks.maxRotation = 0;
    chart.options.scales.x.ticks.minRotation = 0;
  }

  chart.update("none");
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

  // Pre-calculate earliest date once
  let earliestDate = now;
  const allTransactions = Object.values(fundWiseData).flatMap(
    (fund) => fund.transactions
  );
  allTransactions.forEach((tx) => {
    const txDate = new Date(tx.date);
    if (txDate < earliestDate) earliestDate = txDate;
  });

  earliestDate = new Date(
    earliestDate.getFullYear(),
    earliestDate.getMonth(),
    1
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
    0
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
      (l) => (fullData[l].investment || 0) - (fullData[l].withdrawal || 0)
    );

  return { labels, values };
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
        0
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
        day: "2-digit",
        month: "short",
        year: "2-digit",
      });
      data.labels.push(todayLabel);
      data.values.push(currentValue);
      data.costs.push(lastCost);
    }

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          {
            label: "Portfolio Value",
            data: data.values,
            borderColor: getChartColors().growthValuation,
            fill: false,
            tension: 0.3,
            borderWidth: window.innerWidth <= 768 ? 1.5 : 2,
            pointRadius: 0,
            pointHoverRadius: window.innerWidth <= 768 ? 4 : 6,
            pointHoverBackgroundColor: getChartColors().growthValuation,
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: window.innerWidth <= 768 ? 1 : 1.5,
          },
          {
            label: "Total Invested",
            data: data.costs,
            borderColor: getChartColors().growthCost,
            borderDash: [6, 4],
            fill: false,
            tension: 0.3,
            borderWidth: window.innerWidth <= 768 ? 1.5 : 2,
            pointRadius: 0,
            pointHoverRadius: window.innerWidth <= 768 ? 4 : 6,
            pointHoverBackgroundColor: getChartColors().growthCost,
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
              color: getChartColors().textColor,
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: getChartColors().tooltipBg,
            borderColor: getChartColors().tooltipBorder,
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
              borderColor: getChartColors().borderColor,
              borderWidth: 2,
            },
            ticks: { display: false },
          },
          y: {
            display: false,
            grid: { display: false, drawBorder: false },
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

function formatNumber(num) {
  const rounded = Math.round(num);
  return Object.is(rounded, -0) ? "0" : rounded.toLocaleString("en-IN");
}

const ICONS = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
};

// === Toast utility ===
function getToastContainer() {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = "info") {
  const container = getToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = ICONS[type] || "";
  toast.innerText = `${icon} ${message}`;

  container.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add("show"), 10);

  // Remove after 3s
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
      "info"
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest fund statistics for ALL users. This may take a few minutes. Continue?"
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
      "info"
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest NAV for ALL users. Continue?"
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
          user
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
      `✅ Stats updated for ${allIsins.size} active funds across ${users.length} users`
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
                    new Map(combined.map((item) => [item.date, item])).values()
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
            user
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
                  new Map(combined.map((item) => [item.date, item])).values()
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

async function updateNavHistoryOnly() {
  return await updateAllUsersNav("auto");
}

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
        `📊 Update mode: Fetching ${targetIsins.size} active holdings`
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
        "funds"
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
        "total funds in cache"
      );
    }

    return mfStats;
  } catch (err) {
    console.error("❌ Failed to fetch MF stats:", err);
    showToast("Failed to fetch MF stats: " + err.message, "error");
    return mfStats || {};
  }
}

async function updateFullMFStats() {
  return await updateAllUsersStats("auto");
}

function isAfter6AM() {
  const now = new Date();
  const hours = now.getHours();
  return hours >= 6; // 6 AM or later
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
  if (hideElement) hideElement.classList.add("hidden");

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

function calculateOverlapAnalysis() {
  const overlapData = {
    fundPairs: [],
    topOverlaps: [],
    commonHoldings: {},
  };

  const activeFunds = Object.values(fundWiseData).filter(
    (fund) => fund.advancedMetrics?.currentValue > 0
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
        ])
      );
      const holdings2 = new Map(
        fund2.holdings.map((h) => [
          h.company_name,
          parseFloat(h.corpus_per || 0),
        ])
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
              Math.min(a.fund1Percent, a.fund2Percent)
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
        data.count >= 3 && !company.toUpperCase().includes("GOI")
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

function displayOverlapAnalysis() {
  const container = document.getElementById("overlapContent");
  const data = calculateOverlapAnalysis();

  if (data.error) {
    container.innerHTML = `
      <div class="capital-gains-section">
        <div class="section-header">
          <h3>🔍 Fund Overlap Analysis</h3>
          <p class="section-subtitle">Identify duplicate holdings across your mutual funds</p>
        </div>
        <p class="no-data">${data.error}</p>
      </div>
    `;
    return;
  }

  // Check if there's actually any overlap data
  const hasOverlapData = data.topOverlaps && data.topOverlaps.length > 0;
  const hasCommonHoldings =
    data.commonHoldings && data.commonHoldings.length > 0;

  if (!hasOverlapData && !hasCommonHoldings) {
    container.innerHTML = `
      <div class="capital-gains-section">
        <div class="section-header">
          <h3>🔍 Fund Overlap Analysis</h3>
          <p class="section-subtitle">Identify duplicate holdings across your mutual funds</p>
        </div>
        <p class="no-data">No overlap found between your funds. Your portfolio has good diversification!</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>🔍 Fund Overlap Analysis</h3>
        <p class="section-subtitle">Identify duplicate holdings across your mutual funds</p>
      </div>
  `;

  // Top overlapping fund pairs
  if (hasOverlapData) {
    html += `
      <div class="gains-table-wrapper">
        <h4>Highest Overlapping Fund Pairs</h4>
        <table class="gains-table">
          <thead>
            <tr>
              <th>Fund 1</th>
              <th>Fund 2</th>
              <th>Overlap %</th>
              <th>Common Stocks</th>
            </tr>
          </thead>
          <tbody>
    `;

    data.topOverlaps.forEach((pair) => {
      const colorClass =
        pair.overlapPercent > 50
          ? "loss"
          : pair.overlapPercent > 25
          ? "warning"
          : "gain";

      html += `
        <tr>
          <td>${pair.fund1}</td>
          <td>${pair.fund2}</td>
          <td class="${colorClass}">${pair.overlapPercent}%</td>
          <td>${pair.commonStocks.length}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;
  }

  // Common holdings across multiple funds
  if (hasCommonHoldings) {
    html += `
      <div class="gains-table-wrapper" style="margin-top: 30px;">
        <h4>Stocks Common Across Multiple Funds</h4>
        <table class="gains-table">
          <thead>
            <tr>
              <th>Company</th>
              <th># of Funds</th>
              <th>Avg Weight</th>
              <th>Funds</th>
            </tr>
          </thead>
          <tbody>
    `;

    data.commonHoldings.forEach((holding) => {
      html += `
        <tr>
          <td>${holding.company}</td>
          <td><strong>${holding.fundCount}</strong></td>
          <td>${holding.avgWeight}%</td>
          <td><small>${holding.funds.join(", ")}</small></td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
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

function displayExpenseImpact() {
  const container = document.getElementById("expenseContent");
  const data = calculateExpenseImpact();

  let html = `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>💰 Expense Ratio Impact</h3>
        <p class="section-subtitle">See how much you're paying in fund management fees</p>
      </div>

      <div class="gains-summary-grid">
        <div class="gains-summary-card">
          <h4>Weighted Expense Ratio</h4>
          <div class="summary-row">
            <span>Your Portfolio</span>
            <span class="loss">${data.weightedExpenseRatio.toFixed(3)}%</span>
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

      <div class="gains-table-wrapper" style="margin-top: 30px;">
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
    (f) => f.advancedMetrics?.currentValue > 0
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
      (p) => p.overlapPercent > 50
    ).length;
    const mediumOverlaps = overlapData.fundPairs.filter(
      (p) => p.overlapPercent > 25 && p.overlapPercent <= 50
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

function displayHealthScore() {
  const container = document.getElementById("healthScoreContent");
  const scores = calculateHealthScore();

  if (scores.error) {
    container.innerHTML = `
      <div class="capital-gains-section">
        <p class="no-data">${scores.error}</p>
      </div>
    `;
    return;
  }

  const getGrade = (score) => {
    if (score >= 85)
      return { grade: "A+", color: "#10b981", message: "Excellent" };
    if (score >= 75) return { grade: "A", color: "#10b981", message: "Great" };
    if (score >= 65) return { grade: "B+", color: "#3b82f6", message: "Good" };
    if (score >= 55)
      return { grade: "B", color: "#3b82f6", message: "Above Average" };
    if (score >= 45)
      return { grade: "C", color: "#f59e0b", message: "Average" };
    return { grade: "D", color: "#ef4444", message: "Needs Improvement" };
  };

  const result = getGrade(scores.overall);

  let html = `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>💪 Portfolio Health Score</h3>
        <p class="section-subtitle">Data-driven assessment of your portfolio quality</p>
      </div>

      <div style="text-align: center; padding: 40px 20px; background: var(--bg-gradiant); border-radius: 12px; margin-bottom: 30px;">
        <h1 style="font-size: 72px; margin: 0; color: ${result.color};">${scores.overall}/100</h1>
        <h2 style="font-size: 36px; margin: 10px 0; color: ${result.color};">Grade: ${result.grade}</h2>
        <p style="font-size: 18px; color: var(text-secondary); margin: 0;">${result.message}</p>
      </div>

      <div class="gains-summary-grid">
  `;

  Object.entries(scores.details).forEach(([key, detail]) => {
    const percentage = (detail.score / detail.max) * 100;
    const color =
      percentage >= 80
        ? "#10b981"
        : percentage >= 60
        ? "#3b82f6"
        : percentage >= 40
        ? "#f59e0b"
        : "#ef4444";

    html += `
      <div class="gains-summary-card">
        <h4>${key.charAt(0).toUpperCase() + key.slice(1)}</h4>
        <div style="position: relative; height: 8px; background: #e5e7eb; border-radius: 4px; margin: 10px 0;">
          <div style="position: absolute; height: 100%; width: ${percentage}%; background: ${color}; border-radius: 4px;"></div>
        </div>
        <div class="summary-row">
          <span>Score</span>
          <span style="color: ${color}; font-weight: bold;">${detail.score}/${
      detail.max
    }</span>
        </div>
        <div class="summary-row">
          <span style="font-size: 12px; font-style: italic;">${
            detail.message
          }</span>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;
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

    console.log("Initializing user management. Current user:", currentUser);

    populateUserList(users);

    updateCurrentUserDisplay();

    toggleFamilyDashboard();
    return true;
  } else {
    if (container) {
      container.innerHTML =
        '<div style="text-align: center; padding: 20px; color: var(--text-tertiary);">No users found. Upload a CAS file to get started.</div>';
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
      '<div style="text-align: center; padding: 20px; color: var(--text-tertiary);">No users found. Upload a CAS file to get started.</div>';
    return;
  }

  users.forEach((user) => {
    const investorName = getStoredInvestorName(user);
    const isActive = user === currentUser;

    const userItem = document.createElement("div");
    userItem.className = `user-item ${isActive ? "active" : ""}`;

    userItem.onclick = (e) => {
      if (e.target.closest(".user-item-delete")) return;
      switchToUser(user);
    };

    userItem.innerHTML = `
      <div class="user-item-info">
        <div class="user-item-name">${investorName}</div>
        <div class="user-item-email">${user}</div>
      </div>
      <button class="user-item-delete" onclick="event.stopPropagation(); deleteSingleUser('${user}')">
        <i class="fa-solid fa-trash"></i>
      </button>
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

  showToast(`Switching to ${investorName}...`, "success");
  toggleFamilyDashboard();

  setTimeout(() => {
    location.reload();
  }, 500);
}

async function deleteSingleUser(userName) {
  if (!userName) {
    showToast("No user specified", "warning");
    return;
  }

  const confirmDelete = confirm(
    `Are you sure you want to delete user "${userName}" and all their data? This cannot be undone.`
  );

  if (!confirmDelete) return;

  showProcessingSplash();

  try {
    await storageManager.deleteUser(userName);

    allUsers = storageManager.getAllUsers();

    if (userName === currentUser) {
      if (allUsers.length > 0) {
        currentUser = allUsers[0];
        localStorage.setItem("lastActiveUser", currentUser);
      } else {
        currentUser = null;
        localStorage.removeItem("lastActiveUser");
      }
    }

    populateUserList(allUsers);

    hideProcessingSplash();
    showToast(`User ${userName} deleted successfully`, "success");
    toggleFamilyDashboard();
    invalidateFamilyDashboardCache();

    if (userName === currentUser || allUsers.length === 0) {
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

function populateUserSelector(users) {
  const selector = document.getElementById("userSelector");

  users.forEach((user) => {
    const option = document.createElement("option");
    option.value = user;
    option.textContent = user;
    selector.appendChild(option);
  });
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

async function deleteAllUsers() {
  if (allUsers.length === 0) {
    showToast("No users to delete", "info");
    return;
  }

  const confirmDelete = confirm(
    `⚠️ WARNING: This will delete ALL users (${allUsers.length}) and ALL their data permanently.\n\nThis action CANNOT be undone!\n\nAre you absolutely sure?`
  );

  if (!confirmDelete) return;

  const doubleConfirm = confirm(
    "This is your last chance!\n\nClick OK to permanently delete all user data."
  );

  if (!doubleConfirm) return;

  showProcessingSplash();

  try {
    await storageManager.deleteAllUsers();

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
      "#family-dashboard .portfolio-analytics-section"
    );
    if (analyticsSection) analyticsSection.style.display = "none";

    const holdingsSection = document.querySelector(
      "#family-dashboard .folio-section"
    );
    if (holdingsSection) holdingsSection.style.display = "none";

    return;
  }

  const analyticsSection = document.querySelector(
    "#family-dashboard .portfolio-analytics-section"
  );
  if (analyticsSection) analyticsSection.style.display = "block";

  const holdingsSection = document.querySelector(
    "#family-dashboard .folio-section"
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

      if (casData.cas_type === "SUMMARY") {
        casData.folios.forEach((folio) => {
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

            const excludedTypes = [
              "STAMP_DUTY_TAX",
              "STT_TAX",
              "MISC",
              "OTHER",
            ];
            const typeMap = {
              PURCHASE: "PURCHASE",
              PURCHASE_SIP: "PURCHASE",
              SWITCH_IN: "PURCHASE",
              DIVIDEND_REINVEST: "PURCHASE",
              REDEMPTION: "REDEMPTION",
              SWITCH_OUT: "REDEMPTION",
            };

            const filteredTxns = scheme.transactions
              .filter((t) => !excludedTypes.includes(t.type))
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
    }
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
          let bucket = "debt";
          if (key.includes("equity")) bucket = "equity";
          else if (key.includes("commodities")) {
            const subcategory =
              extendedData?.sub_category?.toLowerCase?.() || "";
            const name = fund?.scheme?.toLowerCase?.() || "";
            if (subcategory.includes("gold") || name.includes("gold"))
              bucket = "gold";
            else if (subcategory.includes("silver") || name.includes("silver"))
              bucket = "silver";
            else bucket = "debt";
          } else bucket = "debt";

          metrics.assetAllocation[bucket] =
            (metrics.assetAllocation[bucket] || 0) +
            (parseFloat(v) / 100) * weight * 100;
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

  const mcSum =
    metrics.marketCap.large + metrics.marketCap.mid + metrics.marketCap.small;
  if (mcSum > 0) {
    metrics.marketCap.large = (metrics.marketCap.large / mcSum) * 100;
    metrics.marketCap.mid = (metrics.marketCap.mid / mcSum) * 100;
    metrics.marketCap.small = (metrics.marketCap.small / mcSum) * 100;
  }

  const sectorEntries = Object.entries(metrics.sector).sort(
    (a, b) => b[1] - a[1]
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

  const unrealizedGainPercent =
    metrics.totalCost > 0
      ? ((metrics.totalUnrealizedGain / metrics.totalCost) * 100).toFixed(2)
      : 0;

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

function updateCompactFamilyDashboard(metrics) {
  if (!metrics || window.innerWidth > 500) return;

  const container = document.getElementById("compactFamilyDashboard");
  if (!container) return;

  const unrealizedGainPercent =
    metrics.totalCost > 0
      ? ((metrics.totalUnrealizedGain / metrics.totalCost) * 100).toFixed(2)
      : 0;

  container.innerHTML = `
    <div class="compact-summary-card">
      <div class="compact-header">
        <h3>FAMILY PORTFOLIO (<span>${
          Object.keys(metrics.userBreakdown).length
        }</span> MEMBERS)</h3>
        <h2 class="compact-total-value">₹${formatNumber(
          metrics.totalCurrentValue
        )}</h2>
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
    Math.abs(metrics.totalUnrealizedGain)
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
    (a, b) => b[1].currentValue - a[1].currentValue
  );

  sortedUsers.forEach(([userName, data]) => {
    const gainPercent =
      data.cost > 0 ? ((data.unrealizedGain / data.cost) * 100).toFixed(2) : 0;

    const item = document.createElement("div");
    item.className = "compact-holding-item";

    item.innerHTML = `
      <div class="compact-holding-info">
        <div class="compact-holding-name"><i class="fa-solid fa-user"></i> ${userName}</div>
        <div class="compact-holding-meta">${data.holdings} Active Holdings</div>
      </div>
      <div class="compact-holding-values">
        <div class="compact-holding-current ${
          data.currentValue <= data.cost ? "red" : "green"
        }">
          ₹${formatNumber(data.currentValue)}
        </div>
        <div class="compact-holding-invested">₹${formatNumber(data.cost)}</div>
        <div class="compact-holding-xirr">
          <span class="${data.unrealizedGain >= 0 ? "green" : "red"}">
            ${data.unrealizedGain >= 0 ? "+" : ""}${gainPercent}%
          </span>
        </div>
      </div>
    `;

    breakdownContainer.appendChild(item);
  });
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
    ([_, v]) => v > 0
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
        sortedData
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
        sortedData
      );
      document.getElementById("familyAmcCard")?.classList.remove("loading");
    }, 300);
  } else {
    document.getElementById("familyAmcCard").innerHTML =
      '<p style="text-align: center; color: #9ca3af; padding: 20px;">No data available</p>';
  }

  const returnsContainer = document.getElementById(
    "familyWeightedReturnsContainer"
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

  preferred.forEach((k) => {
    const val = parseFloat(metrics.assetAllocation?.[k]);
    if (!isNaN(val) && val > 0) {
      assetLabels.push(k.charAt(0).toUpperCase() + k.slice(1));
      assetData.push(val);
    }
  });

  Object.keys(metrics.assetAllocation || {}).forEach((k) => {
    if (!preferred.includes(k)) {
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
      '<p style="text-align: center; color: #9ca3af; padding: 20px;">No data available</p>';
    return;
  }

  const [sortedLabels, sortedData] = sortData(assetLabels, assetData);

  const barHTML = sortedLabels
    .map(
      (label, i) => `
      <div class="composition-segment ${label.toLowerCase()}"
           style="width: ${sortedData[i]}%"
           title="${label}: ${sortedData[i].toFixed(1)}%">
      </div>`
    )
    .join("");

  const legendHTML = sortedLabels
    .map(
      (label, i) => `
      <span class="legend-item">
        <span class="legend-color ${label.toLowerCase()}"></span>
        ${label}: ${sortedData[i].toFixed(1)}%
      </span>`
    )
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
      '<p style="text-align: center; color: #9ca3af; padding: 20px;">No data available</p>';
    return;
  }

  const [sortedLabels, sortedData] = sortData(mcLabels, mcData);

  const barHTML = sortedLabels
    .map(
      (label, i) => `
      <div class="composition-segment ${label.toLowerCase()}-cap"
           style="width: ${sortedData[i]}%"
           title="${label}: ${sortedData[i].toFixed(1)}%">
      </div>`
    )
    .join("");

  const legendHTML = sortedLabels
    .map(
      (label, i) => `
      <span class="legend-item">
        <span class="legend-color ${label.toLowerCase()}-cap"></span>
        ${label}: ${sortedData[i].toFixed(1)}%
      </span>`
    )
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
    (a, b) => b[1].currentValue - a[1].currentValue
  );

  sortedUsers.forEach(([userName, data]) => {
    const gainPercent =
      data.cost > 0 ? ((data.unrealizedGain / data.cost) * 100).toFixed(2) : 0;
    const gainClass = data.unrealizedGain >= 0 ? "gain" : "loss";

    const card = document.createElement("div");
    card.className = "family-user-card";

    card.innerHTML = `
      <h4><i class="fa-solid fa-user"></i> ${userName}</h4>
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
      Math.abs(data.unrealizedGain)
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

function invalidateFamilyDashboardCache() {
  familyDashboardCache = null;
  familyDashboardCacheTimestamp = null;
  familyDashboardInitialized = false;
  toggleFamilyDashboard();
}

function updateCompactDashboard() {
  if (!portfolioData || !fundWiseData) return;

  const summary = calculateSummary();
  const activeFunds = Object.values(fundWiseData).filter(
    (f) => f.advancedMetrics?.currentValue > 0
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

  elements.compactHoldingsCount.textContent = activeFunds.length;
  elements.compactTotalValue.textContent = formatNumber(summary.currentValue);
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

  populateCompactHoldings(activeFunds);
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
      Math.abs(Math.round(totalOneDayChange))
    )} (${percentChange.toFixed(2)}%)`,
    value: totalOneDayChange,
  };
}

let compactDisplayMode = "1day";
let compactSortMode = "currentValue";
let compactPastSortMode = "returns";

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
    (f) => f.advancedMetrics?.currentValue > 0
  );
  populateCompactHoldings(activeFunds);
  toggleCompactXIRR(display);
}

function updateCompactPastDashboard() {
  if (!portfolioData || !fundWiseData) return;

  const container = document.getElementById("compactPastDashboard");
  if (!container) return;

  const inactiveFundData = {};

  Object.entries(fundWiseData).forEach(([fundKey, fund]) => {
    const totalInvested = fund.transactions
      .filter((t) => t.type === "PURCHASE")
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    if (totalInvested === 0) return;

    // Check each folio for this fund
    fund.folios.forEach((folioNum) => {
      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return;

      const schemeInFolio = folioData.schemes.find(
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase()
      );

      if (schemeInFolio) {
        const folioValue = schemeInFolio.valuation
          ? parseFloat(schemeInFolio.valuation.value || 0)
          : 0;

        // Only include inactive folios (value = 0)
        if (folioValue === 0) {
          if (!inactiveFundData[fundKey]) {
            inactiveFundData[fundKey] = {
              fundKey,
              fund,
              folioNums: [],
              totalInvested: 0,
              totalWithdrawn: 0,
              totalRealizedGain: 0,
            };
          }

          inactiveFundData[fundKey].folioNums.push(folioNum);

          // Aggregate folio-level data
          const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
          if (folioSummary) {
            inactiveFundData[fundKey].totalInvested +=
              folioSummary.invested || 0;
            inactiveFundData[fundKey].totalWithdrawn +=
              folioSummary.withdrawn || 0;
            inactiveFundData[fundKey].totalRealizedGain +=
              folioSummary.realizedGain || 0;
          }
        }
      }
    });
  });

  const inactiveFunds = Object.values(inactiveFundData);

  if (inactiveFunds.length === 0) {
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

  // Calculate totals
  let totalInvested = 0;
  let totalWithdrawn = 0;
  let totalRealizedGain = 0;

  inactiveFunds.forEach((fundData) => {
    totalInvested += fundData.totalInvested;
    totalWithdrawn += fundData.totalWithdrawn;
    totalRealizedGain += fundData.totalRealizedGain;
  });

  const investedAmountForRealized = totalInvested;
  const realizedGainPercent =
    investedAmountForRealized > 0
      ? parseFloat(
          (totalRealizedGain / investedAmountForRealized) * 100
        ).toFixed(2)
      : 0;

  container.innerHTML = `
    <div class="compact-summary-card">
      <div class="compact-header">
        <h3>PAST HOLDINGS (<span>${inactiveFunds.length}</span>)</h3>
        <h2 class="compact-total-value">₹${formatNumber(totalWithdrawn)}</h2>
      </div>

      <div class="compact-stats">
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

    <div class="compact-holdings-list" id="compactPastHoldingsList"></div>
  `;

  populateCompactPastHoldings(inactiveFunds);
}

function populateCompactPastHoldings(inactiveFunds) {
  const list = document.getElementById("compactPastHoldingsList");
  if (!list) return;

  list.innerHTML = "";

  if (inactiveFunds.length === 0) {
    list.innerHTML =
      '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">No past holdings data available</div>';
    return;
  }

  // Sort based on current mode
  let sortedFunds;
  switch (compactPastSortMode) {
    case "invested":
      sortedFunds = [...inactiveFunds].sort(
        (a, b) => b.totalInvested - a.totalInvested
      );
      break;
    case "returns":
      sortedFunds = [...inactiveFunds].sort(
        (a, b) => b.totalRealizedGain - a.totalRealizedGain
      );
      break;
    case "withdrawn":
    default:
      sortedFunds = [...inactiveFunds].sort(
        (a, b) => b.totalWithdrawn - a.totalWithdrawn
      );
      break;
  }

  sortedFunds.forEach((fundData) => {
    const { fundKey, fund, totalInvested, totalWithdrawn, totalRealizedGain } =
      fundData;

    const realizedGainPercent = parseFloat(
      (totalRealizedGain / totalInvested) * 100
    ).toFixed(2);

    const item = document.createElement("div");
    item.className = "compact-holding-item";
    // item.onclick = () => {
    //   showFundDetailsModal(fundKey, true);
    // };

    item.innerHTML = `
      <div class="compact-holding-info">
        <div class="compact-holding-name">${
          fund.schemeDisplay || fund.scheme
        }</div>
        <div class="compact-holding-meta">${standardizeTitle(fund.amc)}</div>
      </div>
      <div class="compact-holding-values">
        <div class="compact-holding-current ${
          totalWithdrawn <= totalInvested ? "red" : "green"
        }">₹${formatNumber(totalWithdrawn)}</div>
        <div class="compact-holding-invested">₹${formatNumber(
          totalInvested
        )}</div>
        <div class="compact-holding-xirr">
          <span>Returns: </span>
          <span class="${totalRealizedGain >= 0 ? "green" : "red"}">
            ₹${formatNumber(Math.abs(totalRealizedGain))} (${parseFloat(
      realizedGainPercent
    ).toFixed(2)}%)
          </span>
        </div>
      </div>
    `;

    list.appendChild(item);
  });
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
    "#compactPastDashboard .compact-filter-btn"
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

  // Re-collect and aggregate inactive funds data
  const inactiveFundData = {};

  Object.entries(fundWiseData).forEach(([fundKey, fund]) => {
    const totalInvested = fund.transactions
      .filter((t) => t.type === "PURCHASE")
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    if (totalInvested === 0) return;

    fund.folios.forEach((folioNum) => {
      const folioData = portfolioData.folios.find((f) => f.folio === folioNum);
      if (!folioData) return;

      const schemeInFolio = folioData.schemes.find(
        (s) => s.scheme.trim().toLowerCase() === fund.scheme.toLowerCase()
      );

      if (schemeInFolio) {
        const folioValue = schemeInFolio.valuation
          ? parseFloat(schemeInFolio.valuation.value || 0)
          : 0;

        if (folioValue === 0) {
          if (!inactiveFundData[fundKey]) {
            inactiveFundData[fundKey] = {
              fundKey,
              fund,
              folioNums: [],
              totalInvested: 0,
              totalWithdrawn: 0,
              totalRealizedGain: 0,
            };
          }

          inactiveFundData[fundKey].folioNums.push(folioNum);

          const folioSummary = fund.advancedMetrics?.folioSummaries?.[folioNum];
          if (folioSummary) {
            inactiveFundData[fundKey].totalInvested +=
              folioSummary.invested || 0;
            inactiveFundData[fundKey].totalWithdrawn +=
              folioSummary.withdrawn || 0;
            inactiveFundData[fundKey].totalRealizedGain +=
              folioSummary.realizedGain || 0;
          }
        }
      }
    });
  });

  const inactiveFunds = Object.values(inactiveFundData);

  // Re-populate with sorted data
  populateCompactPastHoldings(inactiveFunds);
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
          }
        );
      }

      if (currentValue > 0) {
        calc.addTransaction(
          "Sell",
          new Date().toISOString().split("T")[0] + "T00:00:00.000Z",
          currentValue
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

    const xirr = fund.calculatedXIRR;
    const xirrVal = xirr == null || isNaN(xirr) ? 0 : xirr;
    const xirrText = xirrVal == 0 ? "--" : `${parseFloat(xirr.toFixed(2))}%`;
    const returnsPercentText =
      returnsPercent == 0
        ? "--"
        : `₹${formatNumber(Math.abs(returns))} (${parseFloat(
            returnsPercent.toFixed(2)
          )}%)`;

    const oneDayReturn = fund.oneDayReturn;
    const oneDayText = oneDayReturn
      ? `₹${formatNumber(oneDayReturn.rupees)} (${oneDayReturn.percent.toFixed(
          2
        )})%`
      : "--";

    const item = document.createElement("div");
    item.className = "compact-holding-item";
    const fundKey = fund.scheme.trim().toLowerCase();
    item.onclick = () => {
      showFundDetailsModal(fundKey, false);
    };

    item.innerHTML = `
      <div class="compact-holding-info">
        <div class="compact-holding-name">${
          fund.schemeDisplay || fund.scheme
        }</div>
        <div class="compact-holding-meta">${standardizeTitle(fund.amc)}</div>
      </div>
      <div class="compact-holding-values">
        <div class="compact-holding-current ${
          currentValue <= invested ? "red" : "green"
        }">₹${formatNumber(currentValue)}</div>
        <div class="compact-holding-invested">₹${formatNumber(invested)}</div>
        <div class="compact-holding-xirr hidden"><span>XIRR: </span><span class="${
          xirrVal < 0 ? "red" : "green"
        }">${xirrText}</span></div>
        <div class="compact-holding-abs hidden"><span>Returns: </span><span class="${
          returns < 0 ? "red" : "green"
        }">${returnsPercentText}</span></div>
        <div class="compact-holding-1day"><span>1D Returns: </span><span class=" ${
          oneDayReturn && oneDayReturn.percent >= 0 ? "green" : "red"
        }">${oneDayText}</span></div>
      </div>
    `;

    list.appendChild(item);
  });
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
// Modal swipe-down to close
function initializeModalSwipe(modalElement) {
  if (!modalElement) return;

  const modalContent = modalElement.querySelector(".transaction-modal");
  if (!modalContent) return;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  modalContent.addEventListener(
    "touchstart",
    (e) => {
      const modalHeader = modalElement.querySelector(".modal-header");
      if (modalHeader && modalHeader.contains(e.target)) {
        startY = e.touches[0].clientY;
        isDragging = true;
        modalContent.style.transition = "none";
      }
    },
    { passive: true }
  );

  modalContent.addEventListener(
    "touchmove",
    (e) => {
      if (!isDragging) return;

      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      if (deltaY > 0) {
        modalContent.style.transform = `translateY(${deltaY}px)`;
      }
    },
    { passive: true }
  );

  modalContent.addEventListener("touchend", () => {
    if (!isDragging) return;

    isDragging = false;
    const deltaY = currentY - startY;

    modalContent.style.transition = "transform 0.3s ease";

    if (deltaY > 100) {
      modalContent.style.transform = "translateY(100%)";
      setTimeout(() => {
        closeActiveModal();
      }, 300);
    } else {
      modalContent.style.transform = "translateY(0)";
    }
  });
}

function closeActiveModal() {
  const allTimeModal = document.getElementById("allTimeTransactionsModal");
  const activeModal = document.getElementById("activeTransactionsModal");
  const fundTxModal = document.getElementById("fundTransactionModal");
  const fundHoldingsModal = document.getElementById("fundHoldingsModal");
  const portfolioHoldingsModal = document.getElementById(
    "portfolioHoldingsModal"
  );
  const fundDetailsModal = document.getElementById("fundDetailsModal");

  if (allTimeModal) closeAllTimeTransactions();
  if (activeModal) closeActiveTransactions();
  if (fundTxModal) closeFundTransactionModal();
  if (fundHoldingsModal) closeFundHoldingsModal();
  if (portfolioHoldingsModal) closePortfolioHoldingsModal();
  if (fundDetailsModal) closeFundDetailsModal();
}

window.addEventListener("DOMContentLoaded", async () => {
  initializeTheme();
  const dashboard = document.getElementById("dashboard");

  const hasUsers = initializeUserManagement();

  if (!hasUsers) {
    console.log("📡 No users found");
    showUploadSection();
    return;
  }

  if (currentUser) {
    const storedFileInfo = localStorage.getItem(
      `lastCASFileInfo_${currentUser}`
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
      showProcessingSplash();

      portfolioData = stored.casData;
      mfStats = stored.mfStats;

      isSummaryCAS = portfolioData.cas_type === "SUMMARY";

      console.log(
        "✅ Loaded from IndexedDB - User:",
        currentUser,
        " - CAS Type:",
        isSummaryCAS ? "SUMMARY" : "DETAILED"
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

let tabHistory = ["main"];
let historyPointer = 0;

const originalSwitchDashboardTab = window.switchDashboardTab;
window.switchDashboardTab = function (tabId) {
  const previousTab = document.querySelector(
    ".dashboard section.active-tab"
  )?.id;

  if (previousTab && previousTab !== tabId && !window.isPopStateNavigation) {
    tabHistory = tabHistory.slice(0, historyPointer + 1);
    tabHistory.push(tabId);
    historyPointer = tabHistory.length - 1;

    window.history.pushState(
      { tab: tabId, pointer: historyPointer },
      "",
      window.location.pathname
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
    "portfolioHoldingsModal"
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
      ".dashboard section.active-tab"
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
  window.location.pathname
);
