/**
 * @file indexeddb-helper.js
 * @description Manages browser Indexed DB and Local Storage for Cache
 * @author Pabitra Swain https://github.com/the-sdet
 * @license MIT
 */

const DB_NAME = "MFPortfolioDB";
const DB_VERSION = 1;
const STORE_NAME = "files";

class IndexedDBHelper {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "filename" });
        }
      };
    });
  }

  async saveFile(filename, data) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({
        filename: filename,
        data: data,
        timestamp: new Date().toISOString(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getFile(filename) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(filename);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFile(filename) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(filename);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// Manifest management in localStorage
class ManifestManager {
  static MANIFEST_KEY = "mf_portfolio_manifest";
  static SEARCH_KEYS_KEY = "mf_search_keys";

  static getManifest() {
    const manifest = localStorage.getItem(this.MANIFEST_KEY);
    return manifest ? JSON.parse(manifest) : null;
  }

  static saveManifest(
    files,
    lastNavUpdate = null,
    lastFullUpdate = null,
    originalTimestamp = null
  ) {
    const now = new Date().toISOString();
    const today = now.split("T")[0];

    const manifest = {
      version: today, // YYYY-MM-DD
      files: files,
      timestamp: originalTimestamp || now,
      lastNavUpdate: lastNavUpdate || today,
      lastFullUpdate: lastFullUpdate || today,
    };
    localStorage.setItem(this.MANIFEST_KEY, JSON.stringify(manifest));
    return manifest;
  }

  static saveSearchKeys(searchKeys) {
    localStorage.setItem(this.SEARCH_KEYS_KEY, JSON.stringify(searchKeys));
  }

  static getSearchKeys() {
    const keys = localStorage.getItem(this.SEARCH_KEYS_KEY);
    return keys ? JSON.parse(keys) : null;
  }

  static clearSearchKeys() {
    localStorage.removeItem(this.SEARCH_KEYS_KEY);
  }

  static clearManifest() {
    localStorage.removeItem(this.MANIFEST_KEY);
    this.clearSearchKeys();
  }

  static isStale() {
    const manifest = this.getManifest();
    if (!manifest) return true;

    const today = new Date().toISOString().split("T")[0];
    return manifest.version !== today;
  }

  static needsNavUpdate() {
    const manifest = this.getManifest();
    if (!manifest || !manifest.lastNavUpdate) return true;

    const today = new Date().toISOString().split("T")[0];
    return manifest.lastNavUpdate !== today;
  }

  static needsFullUpdate() {
    const manifest = this.getManifest();
    if (!manifest || !manifest.lastFullUpdate) return true;

    const lastUpdate = new Date(manifest.lastFullUpdate);
    const today = new Date();

    // Check if we're past the 10th of this month and haven't updated yet
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const lastUpdateMonth = lastUpdate.getMonth();
    const lastUpdateYear = lastUpdate.getFullYear();

    // If it's a new month or year, and we're on or after the 10th
    if (
      (currentYear > lastUpdateYear ||
        (currentYear === lastUpdateYear && currentMonth > lastUpdateMonth)) &&
      today.getDate() >= 10
    ) {
      return true;
    }

    return false;
  }

  static updateLastNavUpdate() {
    const manifest = this.getManifest();
    if (manifest) {
      manifest.lastNavUpdate = new Date().toISOString().split("T")[0];
      localStorage.setItem(this.MANIFEST_KEY, JSON.stringify(manifest));
    }
  }

  static updateLastFullUpdate() {
    const manifest = this.getManifest();
    if (manifest) {
      manifest.lastFullUpdate = new Date().toISOString().split("T")[0];
      localStorage.setItem(this.MANIFEST_KEY, JSON.stringify(manifest));
    }
  }
}

// Unified storage manager
class StorageManager {
  constructor() {
    this.idb = new IndexedDBHelper();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      await this.idb.init();
      this.initialized = true;
      console.log("✅ IndexedDB initialized");
    } catch (err) {
      console.warn(
        "⚠️ IndexedDB initialization failed, will use API directly:",
        err
      );
      this.initialized = false;
    }
  }

  async savePortfolioData(casData, mfStats, isNewCAS = false) {
    await this.init();

    if (this.initialized) {
      try {
        await this.idb.saveFile("parsed-cas.json", casData);
        await this.idb.saveFile("mf-stats.json", mfStats);

        const manifest = ManifestManager.getManifest();
        const today = new Date().toISOString().split("T")[0];

        if (isNewCAS) {
          // Fresh CAS upload - set all dates to today
          ManifestManager.saveManifest(
            ["parsed-cas.json", "mf-stats.json"],
            today, // lastNavUpdate
            today, // lastFullUpdate
            new Date().toISOString() // timestamp (CAS parse date)
          );
        } else {
          // Auto-update - preserve original CAS timestamp
          ManifestManager.saveManifest(
            ["parsed-cas.json", "mf-stats.json"],
            manifest?.lastNavUpdate,
            manifest?.lastFullUpdate,
            manifest?.timestamp // Preserve original CAS parse date
          );
        }

        console.log("✅ Portfolio data saved to IndexedDB");
        return true;
      } catch (err) {
        console.error("❌ Failed to save to IndexedDB:", err);
        return false;
      }
    }
    return false;
  }

  async loadPortfolioData() {
    await this.init();

    if (!this.initialized) {
      console.log("📡 Loading from API (IndexedDB not available)");
      return null;
    }

    const manifest = ManifestManager.getManifest();
    if (!manifest) {
      console.log("📡 No manifest found, loading from API");
      return null;
    }

    try {
      const casData = await this.idb.getFile("parsed-cas.json");
      const mfStats = await this.idb.getFile("mf-stats.json");

      if (casData && mfStats) {
        console.log("✅ Portfolio data loaded from IndexedDB");
        return { casData, mfStats };
      } else {
        console.log("📡 Incomplete data in IndexedDB, loading from API");
        return null;
      }
    } catch (err) {
      console.error("❌ Failed to load from IndexedDB:", err);
      return null;
    }
  }

  async clearAll() {
    await this.init();
    if (this.initialized) {
      await this.idb.clear();
    }
    ManifestManager.clearManifest();
    console.log("🗑️ All storage cleared");
  }

  isStale() {
    return ManifestManager.isStale();
  }

  needsNavUpdate() {
    return ManifestManager.needsNavUpdate();
  }

  needsFullUpdate() {
    return ManifestManager.needsFullUpdate();
  }

  updateLastNavUpdate() {
    ManifestManager.updateLastNavUpdate();
  }

  updateLastFullUpdate() {
    ManifestManager.updateLastFullUpdate();
  }

  getManifest() {
    return ManifestManager.getManifest();
  }
}

// Global instance
const storageManager = new StorageManager();
