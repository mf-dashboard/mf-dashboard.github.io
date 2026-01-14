/**
 * @file utils.js
 * @description Utility functions for my-mf-dashboard
 * @author Pabitra Swain https://github.com/the-sdet
 * @license MIT
 */

// ============================================
// CONSTANTS & THEME
// ============================================

const themeColors = [
  "#667eea",
  "#10b981",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f472b6",
  "#93c5fd",
  "#764ba2",
];

const ICONS = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
};

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

// ============================================
// FORMATTING UTILITIES
// ============================================

function formatNumber(num) {
  const rounded = Math.round(num);
  return Object.is(rounded, -0) ? "0" : rounded.toLocaleString("en-IN");
}

function truncateLabel(label, maxLength = 12) {
  return label.length > maxLength ? label.slice(0, maxLength) + "..." : label;
}

function sortData(labels, data) {
  const combined = labels.map((label, i) => ({ label, value: data[i] }));
  combined.sort((a, b) => b.value - a.value);
  return [combined.map((d) => d.label), combined.map((d) => d.value)];
}

const titleCache = new Map();

function sanitizeSchemeName(schemeName) {
  if (!schemeName) return "";

  const parts = schemeName.split("-");

  if (parts.length === 1) {
    const match = schemeName.match(/.*?\bFund\b/i);
    return match ? match[0].trim() : schemeName.trim();
  }

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

  const allUpperCase = words.every(
    (word) => word === word.toUpperCase() && word.length > 0
  );

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
      if (uppercaseWords.includes(word.toUpperCase())) {
        return word.toUpperCase();
      }

      if (allUpperCase) {
        if (index === 0) {
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        if (lowercaseWords.includes(word.toLowerCase())) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }

      if (index === 0 && word === word.toUpperCase() && word.length <= 6) {
        return word;
      }

      if (index === 0 && word === word.toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      if (word === word.toLowerCase() && !lowercaseWords.includes(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      return word;
    })
    .join(" ");
}

function standardizeTitle(title) {
  if (!title) return "";

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

// ============================================
// DATE UTILITIES
// ============================================

function parseDate(dateStr) {
  if (!dateStr) return null;

  const dmy = dateStr.match(/(\d{1,2})-([A-Z]{3}|\d{1,2})-(\d{4})/i);
  if (dmy) {
    const day = parseInt(dmy[1]);
    let month;

    if (isNaN(parseInt(dmy[2]))) {
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
      month = parseInt(dmy[2]) - 1;
    }

    const year = parseInt(dmy[3]);
    return new Date(year, month, day, 12, 0, 0, 0);
  }

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    parsed.setHours(12, 0, 0, 0);
    return parsed;
  }

  return null;
}

function getFinancialYear(date) {
  const d = new Date(date);
  if (isNaN(d)) throw new Error("Invalid date");

  const year = d.getFullYear();
  const month = d.getMonth();

  const fyStartYear = month >= 3 ? year : year - 1;
  const fyEndYear = fyStartYear + 1;

  return `FY ${fyStartYear}-${String(fyEndYear).slice(-2)}`;
}

function isAfter6AM() {
  const now = new Date();
  const hours = now.getHours();
  return hours >= 6;
}

// ============================================
// CHART UTILITIES
// ============================================

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
              if (isFamilyChart && window.familyDashboardCache) {
                totalValue = window.familyDashboardCache.totalCurrentValue;
              } else {
                totalValue = Object.values(window.fundWiseData || {}).reduce(
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
              if (isFamilyChart && window.familyDashboardCache) {
                totalValue = window.familyDashboardCache.totalCurrentValue;
              } else {
                totalValue = Object.values(window.fundWiseData || {}).reduce(
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

// ============================================
// XIRR CALCULATOR
// ============================================

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

    let rate = guess;

    for (let i = 0; i < maxIterations; i++) {
      const npvValue = this.npv(rate);
      const npvDerivative = this.dNpv(rate);

      if (Math.abs(npvValue) < precision) {
        this.xirrResult = rate;
        return rate * 100;
      }

      if (Math.abs(npvDerivative) < 1e-10) {
        break;
      }

      const newRate = rate - npvValue / npvDerivative;

      if (newRate < -0.99) {
        rate = -0.99;
      } else if (newRate > 10) {
        rate = 10;
      } else {
        rate = newRate;
      }

      if (
        i > 0 &&
        Math.abs(rate - (rate - npvValue / npvDerivative)) < precision
      ) {
        break;
      }
    }

    let low = -0.99;
    let high = 5;
    let npvLow = this.npv(low);
    let npvHigh = this.npv(high);

    if (npvLow * npvHigh > 0) {
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

// ============================================
// UI UTILITIES
// ============================================

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

  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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

function showProcessingSplash() {
  document.querySelector(".loader").classList.remove("hidden");
}

function hideProcessingSplash() {
  document.querySelector(".loader").classList.add("hidden");
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

// ============================================
// BENCHMARK UTILITIES
// ============================================

function normalizeBenchmarkName(name) {
  if (!name) return "";
  name = name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/tri$/i, "TRI")
    .replace(/^(NIFTY|BSE)\s*/i, "")
    .replace(/\b(INDEX|TOTAL|RETURN|RETURNS)\b/gi, "")
    .trim();

  const parts = name.split(/\s+/);
  const hasTRI = parts.some((p) => /^TRI$/i.test(p));
  const filtered = parts.filter((p) => !/^TRI$/i.test(p));

  filtered.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

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

  Object.keys(benchmarkReturns).forEach((bm) => {
    benchmarkReturns[bm].schemes = [...benchmarkReturns[bm].schemes];
    if (["1Y", "3Y", "5Y"].every((k) => benchmarkReturns[bm][k] == null)) {
      delete benchmarkReturns[bm];
    }
  });

  return benchmarkReturns;
}

// ============================================
// FILE UTILITIES
// ============================================

async function getFileSignature(file) {
  try {
    const chunkSize = 16384;
    const fileSize = file.size;
    const chunks = [];

    const readChunk = async (start, end) => {
      const blob = file.slice(start, end);
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    };

    chunks.push(await readChunk(0, Math.min(chunkSize, fileSize)));

    if (fileSize > chunkSize * 3) {
      const quarter = Math.floor(fileSize / 4);
      chunks.push(await readChunk(quarter, quarter + chunkSize));
      chunks.push(await readChunk(quarter * 3, quarter * 3 + chunkSize));
    } else if (fileSize > chunkSize * 2) {
      const midPoint = Math.floor(fileSize / 2);
      chunks.push(await readChunk(midPoint, midPoint + chunkSize));
    }

    if (fileSize > chunkSize) {
      chunks.push(await readChunk(Math.max(0, fileSize - chunkSize), fileSize));
    }

    let hash = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < Math.min(chunk.length, 1000); i++) {
        hash = (hash << 5) - hash + chunk[i];
        hash = hash & hash;
      }
    }

    const fingerprint = Array.from(chunks[0].slice(0, 32))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return `${fileSize}_${hash}_${fingerprint}`;
  } catch (err) {
    console.warn("Could not read file chunks:", err);
    return `${file.size}_${file.lastModified}_fallback`;
  }
}

// ============================================
// PROJECTION CALCULATIONS
// ============================================

function calculateProjections(
  currentValue,
  monthlyInflow,
  cagr = 12,
  stepup = 0,
  years = [5, 10, 15, 20]
) {
  const monthlyRate = cagr / 100 / 12;
  const annualStepup = stepup / 100;

  return years.map((year) => {
    const months = year * 12;
    const fvLumpSum = currentValue * Math.pow(1 + monthlyRate, months);

    let fvSIP = 0;
    let totalInvestedSIP = 0;

    if (stepup === 0) {
      fvSIP =
        monthlyInflow *
        ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) *
        (1 + monthlyRate);
      totalInvestedSIP = monthlyInflow * months;
    } else {
      let currentSIP = monthlyInflow;

      for (let y = 0; y < year; y++) {
        const monthsInYear = 12;
        const monthsRemaining = months - y * 12;
        const actualMonths = Math.min(monthsInYear, monthsRemaining);
        const yearsToGrow = year - y;
        const monthsToGrow = yearsToGrow * 12;

        const sipFVThisYear =
          currentSIP *
          ((Math.pow(1 + monthlyRate, actualMonths) - 1) / monthlyRate) *
          (1 + monthlyRate);

        fvSIP += sipFVThisYear * Math.pow(1 + monthlyRate, monthsToGrow);
        totalInvestedSIP += currentSIP * actualMonths;
        currentSIP = currentSIP * (1 + annualStepup);
      }
    }

    const futureValue = fvLumpSum + fvSIP;
    const totalInvested = currentValue + totalInvestedSIP;
    const gains = futureValue - totalInvested;

    return {
      year,
      futureValue: Math.round(futureValue),
      totalInvested: Math.round(totalInvested),
      gains: Math.round(gains),
      gainsPercent: ((gains / totalInvested) * 100).toFixed(2),
    };
  });
}

function formatSipInput(input) {
  let value = input.value.replace(/[^\d]/g, "");
  const cursorPos = input.selectionStart;
  const oldLength = input.value.length;

  if (value) {
    input.value = formatNumber(parseInt(value));
  } else {
    input.value = "";
  }

  const newLength = input.value.length;
  const diff = newLength - oldLength;
  input.setSelectionRange(cursorPos + diff, cursorPos + diff);
}
