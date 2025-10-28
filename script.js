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
let currentPeriod = "1Y";
let fundWiseData = {};
const allTimeFlows = [];
const activeFlows = [];
const BACKEND_SERVER = "https://my-mf-dashboard-backend.onrender.com";

let assetAllocationChart = null;
let marketCapChart = null;
let sectorChart = null;
let amcChart = null;
let holdingsChart = null;

function calculateAndDisplayPortfolioAnalytics() {
  try {
    // Add loading state to all cards
    document.getElementById("assetAllocationCard")?.classList.add("loading");
    document.getElementById("marketCapCard")?.classList.add("loading");
    document.getElementById("sectorCard")?.classList.add("loading");
    document.getElementById("amcCard")?.classList.add("loading");
    document.getElementById("holdingsCard")?.classList.add("loading"); // Add in loading section

    setTimeout(() => {
      const analytics = calculatePortfolioAnalytics();

      displayAssetAllocation(analytics.assetAllocation);

      setTimeout(() => {
        displayMarketCapSplit(analytics.marketCap);
      }, 100);

      setTimeout(() => {
        displaySectorSplit(analytics.sector);
      }, 200);

      setTimeout(() => {
        displayAMCSplit(analytics.amc);
      }, 300);

      setTimeout(() => {
        displayHoldingsSplit(analytics.holdings);
      }, 500);

      setTimeout(() => {
        displayWeightedReturns(analytics.weightedReturns);
      }, 400);
    }, 100);
  } catch (err) {
    console.error("Portfolio analytics failed:", err);
    // Remove loading state on error
    document.getElementById("assetAllocationCard")?.classList.remove("loading");
    document.getElementById("marketCapCard")?.classList.remove("loading");
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
    const extended = fund.isin ? mfStats[fund.isin] : null; // Cache lookup

    // Asset allocation
    const fundAsset = extended?.portfolio_stats?.asset_allocation;
    if (fundAsset) {
      Object.entries(fundAsset).forEach(([k, v]) => {
        if (v == null || isNaN(parseFloat(v)) || parseFloat(v) <= 0) return;
        const key = k.trim().toLowerCase();
        let bucket = "other";
        if (key.includes("equity")) bucket = "equity";
        else if (key.includes("debt")) bucket = "debt";
        else if (key.includes("commodities")) {
          const subcategory = extended?.sub_category?.toLowerCase?.() || "";
          const name = fund?.scheme?.toLowerCase?.() || "";
          if (subcategory.includes("gold") || name.includes("gold"))
            bucket = "gold";
          else if (subcategory.includes("silver") || name.includes("silver"))
            bucket = "silver";
          else {
            bucket = "commodities";
          }
        } else if (key.includes("real estate")) bucket = "real estate";
        else if (key.includes("cash")) bucket = "cash";
        else {
          bucket = "other";
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

    // Market cap
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

    // Sector
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

    // AMC
    const amcName = standardizeTitle(
      extended?.amc ?? fund.amc ?? "Unknown AMC"
    );
    result.amc[amcName] = (result.amc[amcName] || 0) + weight * 100;

    // Holdings Aggregation
    if (
      fund.holdings &&
      Array.isArray(fund.holdings) &&
      fund.holdings.length > 0
    ) {
      // Calculate total holdings percentage for this fund
      let fundHoldingsTotal = 0;
      fund.holdings.forEach((holding) => {
        const holdingWeight = parseFloat(holding.corpus_per || 0);
        fundHoldingsTotal += holdingWeight;
      });

      // Add actual holdings
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

      // Add remaining portion as Cash/Debt if holdings don't add up to 100%
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

    // Weighted returns
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

  // Normalization
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

function destroyIfExists(chartRef) {
  if (chartRef && chartRef.destroy) {
    chartRef.destroy();
    chartRef = null;
  }
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
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: themeColors.slice(0, data.length),
          borderColor: "#fff",
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
            generateLabels: (chart) =>
              chart.data.labels.map((label, i) => ({
                text: `${truncateLabel(label)}: ${chart.data.datasets[0].data[
                  i
                ].toFixed(2)}%`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                strokeStyle: "#fff",
                lineWidth: 1,
                hidden: false,
                index: i,
              })),
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed ?? 0;
              return `${ctx.label}: ${val.toFixed(2)}%`;
            },
          },
        },
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
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.parsed.x.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMax,
          ticks: {
            callback: (v) => v + "%",
            color: "#6b7280",
            font: { size: 11 },
          },
          grid: { drawBorder: false, color: "rgba(0,0,0,0.05)" },
        },
        y: {
          ticks: {
            color: "#374151",
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

  destroyIfExists(assetAllocationChart);
  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    assetAllocationChart = buildDoughnutChart(
      "assetAllocationChart",
      sortedLabels,
      sortedData
    );

    setTimeout(() => {
      document
        .getElementById("assetAllocationCard")
        ?.classList.remove("loading");
    }, 150);
  }, 50);
}

function displayMarketCapSplit(marketCap) {
  const labels = ["Large", "Mid", "Small", "Other"].filter(
    (k) => marketCap[k.toLowerCase()] !== undefined
  );
  const data = labels.map((l) => marketCap[l.toLowerCase()]);
  destroyIfExists(marketCapChart);
  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    marketCapChart = buildDoughnutChart(
      "marketCapChart",
      sortedLabels,
      sortedData
    );

    setTimeout(() => {
      document.getElementById("marketCapCard")?.classList.remove("loading");
    }, 150);
  }, 50);
}

function displaySectorSplit(sectorObj) {
  let entries = Object.entries(sectorObj).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 10);
  const rest = entries.slice(10);
  const othersValue = rest.reduce((sum, [, v]) => sum + v, 0);
  if (othersValue > 0) top.push(["Others", othersValue]);

  const labels = top.map(([name]) => name);
  const data = top.map(([_, val]) => val);

  destroyIfExists(sectorChart);
  const [sortedLabels, sortedData] = sortData(labels, data);

  setTimeout(() => {
    sectorChart = buildBarChart("sectorChart", sortedLabels, sortedData);

    setTimeout(() => {
      document.getElementById("sectorCard")?.classList.remove("loading");
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

  destroyIfExists(amcChart);
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
    .filter(([company]) => company !== "Cash Equivalents") // Exclude cash from chart
    .map(([company, data]) => [company, data.percentage])
    .sort((a, b) => b[1] - a[1]);

  // Just take top 10, no "Others"
  const top = entries.slice(0, 10);

  const labels = top.map(([name]) => name);
  const data = top.map(([_, val]) => val);

  destroyIfExists(holdingsChart);
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

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "fundHoldingsModal";

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
        <h2>${fund.scheme} - Holdings (${holdingsWithCash.length})</h2>
        <button class="modal-close" onclick="closeFundHoldingsModal()">✕</button>
      </div>
      <div class="modal-content" id="fundHoldingsContent"></div>
      <div class="modal-footer">
        <button onclick="downloadFundHoldings('${fundKey}')">Download as Excel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const content = document.getElementById("fundHoldingsContent");
  content.appendChild(createFundHoldingsTable(holdingsWithCash));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFundHoldingsModal();
  });
}

function closeFundHoldingsModal() {
  const modal = document.getElementById("fundHoldingsModal");
  if (modal) modal.remove();
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

async function loadFileFromTab() {
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

    if (lastUploadedFileInfo === fileSignature) {
      showToast(
        "This file has already been uploaded... Your data is already updated...",
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
    console.log("folios:", portfolioData.folios?.length);

    await fetchOrUpdateMFStats("initial");

    // Save to IndexedDB with current date for both NAV and Stats
    await storageManager.savePortfolioData(portfolioData, mfStats, true);

    // Store the file signature after successful upload
    lastUploadedFileInfo = fileSignature;
    localStorage.setItem("lastCASFileInfo", fileSignature);

    const dashboard = document.getElementById("dashboard");
    dashboard.classList.remove("disabled");

    enableAllTabs();

    await processPortfolio();

    try {
      fileInput.value = "";
      passwordInput.value = "";
    } catch (err) {}

    hideProcessingSplash();
    const showCards = ["clear-cache", "update-stats", "update-nav"];

    const hideCard = "instructions-card";

    showCards.forEach((e) =>
      document.querySelector("." + e).classList.remove("hidden")
    );

    document.querySelector("." + hideCard).classList.add("hidden");
    showToast("Portfolio loaded and saved successfully!", "success");

    // Update footer info
    updateFooterInfo();

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

// Fetch search-key.json from server
async function getSearchKeys() {
  try {
    // Check if we have cached search keys
    const cachedKeys = ManifestManager.getSearchKeys();
    if (cachedKeys) {
      console.log(
        "✅ Using cached search keys:",
        Object.keys(cachedKeys).length
      );
      return cachedKeys;
    }

    // If not cached, fetch from server
    const response = await fetch("./data/search-key.json");
    if (!response.ok) {
      throw new Error(`Failed to load search-key.json: ${response.status}`);
    }

    const searchKeys = await response.json();
    console.log(
      "📥 Loaded search keys from file:",
      Object.keys(searchKeys).length
    );

    // Cache for future use
    ManifestManager.saveSearchKeys(searchKeys);

    return searchKeys;
  } catch (err) {
    console.error("Error loading search-key.json:", err);
    return {};
  }
}

async function clearCache() {
  if (confirm("This will clear all cached portfolio data. Continue?")) {
    await storageManager.clearAll();

    // Reset file info
    lastUploadedFileInfo = null;
    localStorage.removeItem("lastCASFileInfo");

    // Disable all tabs except upload before reload
    disableAllTabsExceptUpload();

    // Small delay to show the disabled state before reload
    setTimeout(() => {
      location.reload();
    }, 100);
  }
}

function showProcessingSplash() {
  document.querySelector(".loader").classList.remove("hidden");
}

function hideProcessingSplash() {
  document.querySelector(".loader").classList.add("hidden");
}

async function processPortfolio() {
  window.fundChartsRendered = false;
  document.getElementById("dashboard").classList.add("active");

  aggregateFundWiseData();

  const summary = calculateSummary();
  updateSummaryCards(summary);

  requestAnimationFrame(() => {
    updateFundBreakdown();
    calculateAndDisplayPortfolioAnalytics();
    displayCapitalGains();
    initializeTransactionSections();
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
  // Hide all sections
  document.querySelectorAll(".dashboard section").forEach((section) => {
    section.classList.remove("active-tab");
  });

  // Remove active class from all tab buttons
  document.querySelectorAll(".dashboard-tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Show selected section
  const selectedSection = document.getElementById(tabId);
  if (selectedSection) {
    selectedSection.classList.add("active-tab");
  }

  // Add active class to clicked button
  const buttonClass = "." + tabId + "-button";
  const activeButton = document.querySelector(buttonClass);
  if (activeButton) {
    activeButton.classList.add("active");
  }

  if (tabId === "main") {
    document.getElementById("toggleExtendedBtn").classList.add("hidden");
    document.getElementById("toggleSeeMore").classList.remove("hidden");
  } else if (tabId === "current-holding") {
    document.getElementById("toggleExtendedBtn").classList.remove("hidden");
    document.getElementById("toggleSeeMore").classList.add("hidden");
    renderAllFundCharts();
  } else if (tabId === "charts") {
    updateChart();
    document.getElementById("toggleExtendedBtn").classList.add("hidden");
    document.getElementById("toggleSeeMore").classList.add("hidden");
  } else {
    document.getElementById("toggleExtendedBtn").classList.add("hidden");
    document.getElementById("toggleSeeMore").classList.add("hidden");
  }
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function renderAllFundCharts() {
  // Check if charts have already been rendered
  if (window.fundChartsRendered) {
    return;
  }

  // Mark as rendered to prevent duplicate rendering
  window.fundChartsRendered = true;

  // Delay to ensure smooth tab transition
  Object.entries(fundWiseData).forEach(([fundKey, fund]) => {
    const chartIdVal = `fundChart_${fundKey.replace(/\s+/g, "_")}`;
    renderFundValuationChart(fundKey, chartIdVal);

    const perfChartId = `fundPerfChart_${fundKey.replace(/\s+/g, "_")}`;
    const extendedData = mfStats[fund.isin];
    if (extendedData) renderFundPerformanceChart(perfChartId, extendedData);
  });
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
  fundWiseData = {};

  portfolioData.folios.forEach((folio) => {
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
          "1Y": benchmarkSummary[bmKey]["1Y"],
          "3Y": benchmarkSummary[bmKey]["3Y"],
          "5Y": benchmarkSummary[bmKey]["5Y"],
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
  html += `
    <div class="capital-gains-section">
      <div class="section-header">
        <h3>🏆 All-Time Summary</h3>
        <p class="section-subtitle">Complete history of capital gains</p>
      </div>
      <div class="gains-summary-grid">
  `;

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
        <h4 style="margin: 0; color: #1f2937;">Detailed Transactions for ${fy}</h4>
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

  const existingModals = document.querySelectorAll(".transaction-modal");
  existingModals.forEach((e) => e.remove());

  lockBodyScroll();

  const modal = document.createElement("div");
  modal.className = "transaction-modal-overlay";
  modal.id = "fundTransactionModal";

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
      <h4>Unrealized Gain</h4>
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

  const index_return1y = benchmark_returns?.["1Y"] ?? null;
  const index_return3y = benchmark_returns?.["3Y"] ?? null;
  const index_return5y = benchmark_returns?.["5Y"] ?? null;

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

  const ctx = canvas.getContext("2d");

  // Use ALL available data
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
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
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
            label: (ctx) => {
              if (ctx.datasetIndex === 0) {
                return `Value: ₹${ctx.parsed.y.toLocaleString("en-IN")}`;
              } else {
                return `Cost: ₹${ctx.parsed.y.toLocaleString("en-IN")}`;
              }
            },
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
            color: "#9ca3af",
          },
        },
        y: {
          display: true,
          grid: {
            color: "rgba(0, 0, 0, 0.05)",
            drawBorder: false,
          },
          ticks: {
            font: { size: 9 },
            color: "#9ca3af",
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
          if (container) {
            container.classList.remove("loading");
          }
        },
      },
    },
  });
}

function renderFundPerformanceChart(canvasId, extendedData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Extract fundKey from canvasId - remove the prefix
  const fundKey = canvasId.replace("fundPerfChart_", "");
  const containerId = `fundPerfChartContainer_${fundKey}`;
  const container = document.getElementById(containerId);

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
    if (container) {
      container.classList.remove("loading");
    }
    return;
  }

  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, font: { size: 9 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: "#6b7280" },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: {
            font: { size: 10 },
            color: "#6b7280",
            callback: (val) => `${val}%`,
          },
        },
      },
      animation: {
        duration: 0,
        onComplete: () => {
          ctx.classList.add("chart-ready");
          if (container) {
            container.classList.remove("loading");
          }
        },
      },
    },
  });
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

    // Group folios by active/inactive status using transaction folio property
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

  hasPast
    ? pastSection.classList.remove("hidden")
    : pastSection.classList.add("hidden");
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
        ? `</div>
    <div class="folio-stat fund-card-separator"><span class="label">Invested:</span><span class="value">₹${formatNumber(
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
            ${realizedGain >= 0 ? "+" : ""}₹${formatNumber(
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
        ? `<div class="folio-stat"><span class="label">Units:</span><span class="value">${roundValue(
            remainingUnits
          )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat"><span class="label">Avg NAV:</span><span class="value">${roundValue(
            averageRemainingCostPerUnit
          )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat"><span class="label">Avg. Holding Days:</span><span class="value">${roundValue(
            averageHoldingDays
          )}</span></div>`
        : ""
    }
      ${
        current > 0
          ? `<div class="folio-stat"><span class="label">P&L:</span><span class="value ${
              unrealizedGain >= 0 ? "gain" : "loss"
            }">
            ${unrealizedGain >= 0 ? "+" : ""}₹${formatNumber(
              Math.abs(unrealizedGain)
            )} (${
              current > 0 ? unrealizedGainPercentage : realizedGainPercentage
            }%)</span></div>`
          : ""
      }
    <div class="folio-stat fund-card-separator-space"><span class="label">XIRR:</span><span class="value">${xirrText}</span></div>
    ${
      current > 0
        ? `<div class="folio-stat fund-card-separator-header hidden"><span class="label">Overall Info: </span><span></span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat fund-card-separator hidden"><span class="label">Invested:</span><span class="value">₹${formatNumber(
            invested
          )}</span></div>
    <div class="folio-stat hidden"><span class="label">Withdrawn:</span><span class="value">₹${formatNumber(
      withdrawn
    )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat hidden"><span class="label">Overall Gain/Loss:</span><span class="value ${
            overallGain >= 0 ? "gain" : "loss"
          }">
            ${overallGain >= 0 ? "+" : ""}₹${formatNumber(
            Math.abs(overallGain)
          )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `<div class="folio-stat fund-card-separator-space hidden"><span class="label">P&L:</span><span class="value ${
            realizedGain >= 0 ? "gain" : "loss"
          }">
            ${realizedGain >= 0 ? "+" : ""}₹${formatNumber(
            Math.abs(realizedGain)
          )}</span></div>`
        : ""
    }
    ${
      current > 0
        ? `${createFundValuationChart(fund, fundKey)}
              ${createFundPerformanceChart(
                fund,
                fundKey,
                extendedData,
                fund.benchmark_returns
              )}`
        : ""
    }
    ${
      current > 0
        ? extendedData
          ? `<div class="extended-stats hidden">
          <div class="folio-stat fund-card-separator-header"><span class="label">Fund Stats: </span><span></span></div>
               <div class="folio-stat fund-card-separator"><span class="label">Alpha:</span><span class="value">${roundValue(
                 extendedData.return_stats.alpha
               )}</span></div>
               <div class="folio-stat"><span class="label">Beta:</span><span class="value">${roundValue(
                 extendedData.return_stats.beta
               )}</span></div>
               <div class="folio-stat"><span class="label">Sharpe Ratio:</span><span class="value">${roundValue(
                 extendedData.return_stats.sharpe_ratio
               )}</span></div>
               <div class="folio-stat"><span class="label">Sortino Ratio:</span><span class="value">${roundValue(
                 extendedData.return_stats.sortino_ratio
               )}</span></div>
               <div class="folio-stat"><span class="label">Information Ratio:</span><span class="value">${roundValue(
                 extendedData.return_stats.information_ratio
               )}</span></div>
               <div class="folio-stat"><span class="label">Standard Deviation:</span><span class="value">${roundValue(
                 extendedData.return_stats.standard_deviation
               )}</span></div>
               <div class="folio-stat"><span class="label">Expense Ratio:</span><span class="value">${roundValue(
                 extendedData.expense_ratio
               )}%</span></div>
               <div class="folio-stat hidden"><span class="label">1Y Return:</span><span class="value">${roundValue(
                 extendedData.return_stats.return1y
               )}%</span></div>
               <div class="folio-stat hidden"><span class="label">3Y Return:</span><span class="value">${roundValue(
                 extendedData.return_stats.return3y
               )}%</span></div>
               <div class="folio-stat hidden"><span class="label">5Y Return:</span><span class="value">${roundValue(
                 extendedData.return_stats.return5y
               )}%</span></div>
                <div class="folio-stat"><span class="label">Rating:</span><span class="value">${roundValue(
                  extendedData.groww_rating
                )}</span></div>
               <div class="folio-stat"><span class="label">AUM:</span><span class="value">₹${formatNumber(
                 roundValue(extendedData.aum)
               )}CR</span></div>
               <div class="folio-stat fund-card-separator-space"><span class="label">Holdings:</span><span class="value"><button class="holdings-eye-btn" onclick="event.stopPropagation(); showFundHoldings('${fundKey}')"><i class="fa-solid fa-eye"></i></button><span>${
              fund.holdings.length
            }</span></span></div>
             </div>`
          : ""
        : ""
    }<div class="folio-stat"><button class="view-tx-btn" onclick="showFundTransactions('${fundKey}', '${folioNumbersStr}')">View Transactions</button></div>
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
  document.getElementById("avgHoldingDays").textContent =
    calculateWeightedHoldingDays();
}

function updateGainCard(valueId, percentId, gain, percent, xirr) {
  const el = document.getElementById(valueId);
  el.textContent = (gain >= 0 ? "₹" : "-₹") + formatNumber(Math.abs(gain));
  el.parentElement.classList.add(gain >= 0 ? "positive" : "negative");
  const xirrText =
    xirr !== null ? ` | XIRR: ${xirr.toFixed(2)}%` : " | XIRR: --";
  document.getElementById(percentId).textContent =
    "Absolute: " +
    (gain >= 0 ? "+" : "") +
    percent +
    "%" +
    (percentId === "realizedGainPercent" ? "" : xirrText);
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

  periods.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "time-btn" + (p === "1Y" ? " active" : "");
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
            borderColor: "#3b82f6",
            fill: false,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: "#3b82f6",
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 2,
          },
          {
            label: "Total Invested",
            data: data.costs,
            borderColor: "#9ca3af",
            borderDash: [6, 4],
            fill: false,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: "#9ca3af",
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 800, // Smooth animation
          easing: "easeInOutQuart",
        },
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              usePointStyle: true,
              pointStyle: "circle",
              font: { size: 13, weight: "600" },
              color: "#374151",
            },
          },
          tooltip: {
            backgroundColor: "rgba(0,0,0,0.85)",
            borderColor: "#3b82f6",
            borderWidth: 2,
            cornerRadius: 8,
            titleFont: { size: 13, weight: "bold" },
            bodyFont: { size: 12 },
            displayColors: false,
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
              drawBorder: true,
              borderColor: "#e5e7eb",
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
      animation: { duration: 800, easing: "easeInOutQuart" }, // Smooth animation
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#000",
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

document.getElementById("toggleExtendedBtn").addEventListener("click", () => {
  const extendedElements = document.querySelectorAll(".extended-stats");
  extendedElements.forEach((el) => el.classList.toggle("hidden"));

  const firstHidden = extendedElements[0].classList.contains("hidden");

  // Update button text + icon
  document.getElementById("toggleExtendedBtn").innerHTML = firstHidden
    ? `<i class="fa-solid fa-eye"></i> Show Fund Stats`
    : `<i class="fa-solid fa-eye-slash"></i> Hide Fund Stats`;
});

document.getElementById("toggleSeeMore").addEventListener("click", () => {
  const extendedElements = document.querySelectorAll(".extra-card");
  extendedElements.forEach((el) => el.classList.toggle("hidden"));

  const firstHidden = extendedElements[0].classList.contains("hidden");

  document.getElementById("toggleSeeMore").innerHTML = firstHidden
    ? `<i class="fa-solid fa-eye"></i> Show Overall Stats`
    : `<i class="fa-solid fa-eye-slash"></i> Hide Overall Stats`;
});

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

  // Check if already updated today (auto + manual)
  if (
    !storageManager.needsFullUpdate() &&
    storageManager.hasManualUpdateToday()
  ) {
    showToast(
      "Fund statistics already updated today (auto + manual). Next update available tomorrow after 6 AM.",
      "info"
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest fund statistics (portfolio composition, returns, ratings, etc.). This may take a few minutes. Continue?"
  );

  if (!confirmUpdate) return;

  showProcessingSplash();
  showToast("Updating fund statistics...", "info");

  try {
    await fetchOrUpdateMFStats("manual");

    await storageManager.savePortfolioData(portfolioData, mfStats, false);
    storageManager.updateLastFullUpdate();
    storageManager.markManualUpdate(); // Mark manual update done
    await processPortfolio();

    hideProcessingSplash();
    showToast("Fund statistics updated successfully!", "success");
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
    storageManager.hasManualUpdateToday()
  ) {
    showToast(
      "NAV already updated today (auto + manual). Please try again tomorrow after 6 AM.",
      "info"
    );
    return;
  }

  const confirmUpdate = confirm(
    "This will fetch the latest NAV for all your funds. Continue?"
  );

  if (!confirmUpdate) return;

  showProcessingSplash();
  showToast("Updating NAV...", "info");

  try {
    const success = await updateNavHistoryOnly();

    if (success) {
      // Reset chart render flag to force re-render
      window.fundChartsRendered = false;

      // Re-process portfolio with updated NAV
      await processPortfolio();

      storageManager.markManualUpdate();
      showToast("NAV updated successfully!", "success");
      updateFooterInfo();
    } else {
      showToast("Failed to update NAV", "error");
    }

    hideProcessingSplash();
  } catch (err) {
    hideProcessingSplash();
    console.error("NAV update error:", err);
    showToast("Failed to update NAV: " + err.message, "error");
  }
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
    document.getElementById("footerCASDate").textContent = casDate;

    // Stats update date
    const statsDate = manifest.lastFullUpdate
      ? new Date(manifest.lastFullUpdate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "--";
    document.getElementById("footerStatsDate").textContent = statsDate;

    // NAV update date
    const navDate = manifest.lastNavUpdate
      ? new Date(manifest.lastNavUpdate).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "--";
    document.getElementById("footerNavDate").textContent = navDate;

    // Update upload tab dates
    document.getElementById("lastNavUpdateDate").textContent = navDate;
    document.getElementById("lastStatsUpdateDate").textContent = statsDate;
  }
}

async function updateNavHistoryOnly() {
  if (!portfolioData) return;

  console.log("🔄 Auto-updating NAV history...");

  const navUpdateData = {}; // Track scheme_code and last NAV date for each ISIN

  portfolioData.folios.forEach((folio) => {
    folio.schemes.forEach((scheme) => {
      if (scheme.isin) {
        const existingStats = mfStats[scheme.isin];

        if (existingStats?.scheme_code) {
          navUpdateData[scheme.isin] = {
            scheme_code: existingStats.scheme_code,
            last_nav_date: existingStats.latest_nav_date || null,
          };
        }
      }
    });
  });

  console.log("NAV update data:", navUpdateData);

  try {
    const response = await fetch(BACKEND_SERVER + "/api/update-nav-only", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        navUpdateData, // Contains ISIN -> {scheme_code, last_nav_date}
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // Merge the updated NAV data with existing mfStats
      const updatedNavData = result.data;

      Object.keys(updatedNavData).forEach((isin) => {
        if (mfStats[isin]) {
          const newNavData = updatedNavData[isin];

          // Update latest NAV and date
          if (newNavData.latest_nav) {
            mfStats[isin].latest_nav = newNavData.latest_nav;
          }
          if (newNavData.latest_nav_date) {
            mfStats[isin].latest_nav_date = newNavData.latest_nav_date;
          }

          // Handle NAV history
          if (newNavData.nav_entries && newNavData.nav_entries.length > 0) {
            const existingHistory = mfStats[isin].nav_history || [];

            // If this is full history (last_nav_date was null), replace everything
            if (newNavData.is_full_history) {
              mfStats[isin].nav_history = newNavData.nav_entries;
            } else {
              // Merge incremental updates
              const combined = [...newNavData.nav_entries, ...existingHistory];

              // Remove duplicates by date
              const uniqueByDate = Array.from(
                new Map(combined.map((item) => [item.date, item])).values()
              );

              // Sort by date descending (newest first)
              uniqueByDate.sort((a, b) => new Date(b.date) - new Date(a.date));

              mfStats[isin].nav_history = uniqueByDate;
            }
          }

          // Update meta if provided
          if (newNavData.meta) {
            mfStats[isin].meta = newNavData.meta;
          }
        }
      });

      await storageManager.savePortfolioData(portfolioData, mfStats, false);
      storageManager.updateLastNavUpdate();
      console.log("✅ NAV history updated successfully");

      // Refresh the display without full recalculation
      aggregateFundWiseData();
      const summary = calculateSummary();
      updateSummaryCards(summary);
      updateFundBreakdown();

      return true;
    }
    return false;
  } catch (err) {
    console.error("❌ NAV update failed:", err);
    return false;
  }
}

async function fetchOrUpdateMFStats(updateType = "full") {
  try {
    if (!portfolioData) {
      console.warn("No portfolio data available");
      return {};
    }

    console.log(`🔄 Fetching MF stats (${updateType})...`);

    // Step 1: Collect all ISINs from portfolio
    const isins = [];
    portfolioData.folios.forEach((folio) => {
      folio.schemes.forEach((scheme) => {
        if (scheme.isin) {
          isins.push(scheme.isin);
        }
      });
    });

    const uniqueIsins = [...new Set(isins)];

    // Step 2: Get ISIN → searchString map
    const searchKeyJson = await getSearchKeys();

    // Step 3: Find corresponding search strings for unique ISINs
    const searchKeys = uniqueIsins
      .map((isin) => searchKeyJson[isin])
      .filter(Boolean); // remove undefined if any ISIN not found

    const uniqueSearchKeys = [...new Set(searchKeys)];

    // Step 4: Call API with only search keys
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

    mfStats = result.data || result;
    console.log(
      "✅ MF Stats fetched successfully:",
      Object.keys(mfStats).length,
      "funds"
    );

    return mfStats;
  } catch (err) {
    console.error("❌ Failed to fetch MF stats:", err);
    showToast("Failed to fetch MF stats: " + err.message, "error");
    return {};
  }
}
async function updateFullMFStats() {
  if (!portfolioData) return false;

  console.log("🔄 Auto-updating full MF stats (monthly update)...");

  try {
    await fetchOrUpdateMFStats("auto");

    await storageManager.savePortfolioData(portfolioData, mfStats, false);
    storageManager.updateLastFullUpdate();
    console.log("✅ Full MF stats updated successfully");

    // Refresh entire portfolio
    await processPortfolio();

    return true;
  } catch (err) {
    console.error("❌ Full MF stats update failed:", err);
    return false;
  }
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

  // Check if NAV update is needed (daily)
  if (storageManager.needsNavUpdate()) {
    console.log("📅 Daily NAV update required");
    const updated = await updateNavHistoryOnly();
    if (updated) {
      showToast("Latest NAV updated!", "success");
    }
  }
}

function showUploadSection() {
  const dashboard = document.getElementById("dashboard");

  // Show dashboard but in disabled state
  dashboard.classList.add("active");
  dashboard.classList.remove("disabled"); // Remove disabled class to allow tab switching

  // Disable all tabs except CAS upload
  disableAllTabsExceptUpload();
  switchDashboardTab("cas-upload-tab");

  const hideCards = ["clear-cache", "update-stats", "update-nav"];
  const showCard = "instructions-card";

  hideCards.forEach((e) =>
    document.querySelector("." + e).classList.add("hidden")
  );
  document.querySelector("." + showCard).classList.remove("hidden");
  showToast("Please upload CAS to view the Dashboard.", "info");
}

function enableAllTabs() {
  document.querySelectorAll(".dashboard-tab-btn").forEach((btn) => {
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
    btn.style.pointerEvents = "auto";
  });
}

function disableAllTabsExceptUpload() {
  document.querySelectorAll(".dashboard-tab-btn").forEach((btn) => {
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

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("toggleExtendedBtn").classList.add("hidden");
  document.getElementById("toggleSeeMore").classList.add("hidden");

  const dashboard = document.getElementById("dashboard");

  // Load last file info from localStorage
  const storedFileInfo = localStorage.getItem("lastCASFileInfo");
  if (storedFileInfo) {
    lastUploadedFileInfo = storedFileInfo;
  }

  try {
    const stored = await storageManager.loadPortfolioData();

    if (stored) {
      const showCards = ["clear-cache", "update-stats", "update-nav"];

      const hideCard = "instructions-card";

      showCards.forEach((e) =>
        document.querySelector("." + e).classList.remove("hidden")
      );

      document.querySelector("." + hideCard).classList.add("hidden");
      dashboard.classList.remove("disabled");
      showProcessingSplash();

      portfolioData = stored.casData;
      mfStats = stored.mfStats;
      console.log("✅ Loaded from IndexedDB");

      await processPortfolio();
      hideProcessingSplash();
      showToast("Portfolio loaded from cache!", "success");

      // Update footer info
      updateFooterInfo();

      enableAllTabs();
      dashboard.classList.add("active");
      switchDashboardTab("main");

      // Perform auto-updates in background
      setTimeout(async () => {
        await checkAndPerformAutoUpdates();
        updateFooterInfo(); // Update footer after auto-updates
      }, 2000);

      return;
    }

    console.log("📡 No data in IndexedDB");
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
