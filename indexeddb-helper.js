/**
 * @file indexeddb-helper.js
 * @description IndexedDB wrapper for storing large JSON files
 * @author Pabitra Swain https://github.com/the-sdet
 * @license MIT
 */

class IDBHelper {
  constructor() {
    this.dbName = "MyMFDashboard";
    this.version = 1;
    this.storeName = "files";
    this.db = null;
  }

  async init() {
    if (this.db) {
      // Probe the cached connection — if it's stale/closing, a transaction attempt will throw
      try {
        const probe = this.db.transaction([this.storeName], "readonly");
        probe.abort();
        return this.db;
      } catch (e) {
        console.warn(
          "IDB: cached connection is stale, reopening...",
          e.message,
        );
        this.db = null;
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;

        // Handle forced closure when another tab upgrades the DB version
        this.db.onversionchange = () => {
          console.warn(
            "IDB: version change detected, closing connection gracefully",
          );
          this.db.close();
          this.db = null;
        };

        // Handle unexpected connection closure
        this.db.onclose = () => {
          console.warn(
            "IDB: connection closed unexpectedly, will reopen on next use",
          );
          this.db = null;
        };

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "fileName" });
        }
      };
    });
  }

  async saveFile(fileName, data) {
    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);

      const record = {
        fileName: fileName,
        data: data,
        timestamp: new Date().toISOString(),
      };

      return new Promise((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IDB save error:", err);
      throw err;
    }
  }

  async loadFile(fileName) {
    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.get(fileName);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.data : null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IDB load error:", err);
      return null;
    }
  }

  async deleteFile(fileName) {
    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.delete(fileName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IDB delete error:", err);
      throw err;
    }
  }

  async listFiles() {
    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IDB list error:", err);
      return [];
    }
  }

  async clearAll() {
    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IDB clear error:", err);
      throw err;
    }
  }

  async exportAllRecords() {
    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("IDB exportAllRecords error:", err);
      throw err;
    }
  }

  async importAllRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return;

    try {
      const db = await this.init();
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);

        for (const record of records) {
          store.put(record);
        }
      });
    } catch (err) {
      console.error("IDB importAllRecords error:", err);
      throw err;
    }
  }
}

class ManifestManager {
  static SEARCH_KEYS_KEY = "mf_search_keys";
  static SEARCH_KEYS_VERSION_KEY = "mf_search_keys_version";

  static saveSearchKeys(searchKeys, hash) {
    localStorage.setItem(this.SEARCH_KEYS_KEY, JSON.stringify(searchKeys));
    localStorage.setItem(this.SEARCH_KEYS_VERSION_KEY, hash);
  }

  static getSearchKeys() {
    const keys = localStorage.getItem(this.SEARCH_KEYS_KEY);
    return keys ? JSON.parse(keys) : null;
  }

  static clearSearchKeys() {
    localStorage.removeItem(this.SEARCH_KEYS_KEY);
    localStorage.removeItem(this.SEARCH_KEYS_VERSION_KEY);
  }
}

class StorageManager {
  constructor() {
    this.idb = new IDBHelper();
    this.manifestKey = "portfolio-manifest";
    this.usersKey = "portfolio-users";
    this.globalManifestKey = "portfolio-global-update-manifest";
    this._globalManifestCache = undefined; // in-memory cache, undefined = not yet loaded
  }

  getGlobalManifest() {
    if (this._globalManifestCache !== undefined)
      return this._globalManifestCache;
    try {
      this._globalManifestCache = JSON.parse(
        localStorage.getItem(this.globalManifestKey) || "null",
      );
    } catch {
      this._globalManifestCache = null;
    }
    return this._globalManifestCache;
  }

  saveGlobalManifest(manifest) {
    this._globalManifestCache = manifest;
    localStorage.setItem(this.globalManifestKey, JSON.stringify(manifest));
  }

  getAllUsers() {
    try {
      const users = JSON.parse(localStorage.getItem(this.usersKey) || "[]");
      return users;
    } catch {
      return [];
    }
  }

  addUser(userName) {
    const users = this.getAllUsers();
    if (!users.includes(userName)) {
      users.push(userName);
      localStorage.setItem(this.usersKey, JSON.stringify(users));
    }
  }

  async deleteUser(userName) {
    try {
      let users = this.getAllUsers();
      users = users.filter((u) => u !== userName);

      if (users.length === 0) {
        localStorage.removeItem(this.usersKey);
        localStorage.removeItem("lastActiveUser");
        localStorage.removeItem(this.globalManifestKey);
        console.log("🗑️ All users deleted, cleared user-specific localStorage");
      } else {
        localStorage.setItem(this.usersKey, JSON.stringify(users));

        const lastActive = localStorage.getItem("lastActiveUser");
        if (lastActive === userName) {
          localStorage.setItem("lastActiveUser", users[0]);
          console.log(`🔄 Switched active user to: ${users[0]}`);
        }
      }
      localStorage.removeItem(`${this.manifestKey}-${userName}`);
      localStorage.removeItem(`lastCASFileInfo_${userName}`);

      await this.idb.deleteFile(`cas-data-${userName}.json`);
      await this.idb.deleteFile(`mf-stats-${userName}.json`);

      console.log(`✅ User "${userName}" deleted completely`);
      return true;
    } catch (err) {
      console.error(`❌ Error deleting user "${userName}":`, err);
      throw err;
    }
  }

  async deleteAllUsers() {
    try {
      const users = this.getAllUsers();
      for (const user of users) {
        await this.idb.deleteFile(`cas-data-${user}.json`);
        await this.idb.deleteFile(`mf-stats-${user}.json`);

        localStorage.removeItem(`${this.manifestKey}-${user}`);

        localStorage.removeItem(`lastCASFileInfo_${user}`);

        console.log(`🗑️ Deleted data for user: ${user}`);
      }

      localStorage.removeItem(this.usersKey);
      localStorage.removeItem("lastActiveUser");
      localStorage.removeItem(this.globalManifestKey);

      console.log("✅ All users deleted successfully");
      return true;
    } catch (err) {
      console.error("❌ Error deleting all users:", err);
      throw err;
    }
  }

  getManifest(userName = null) {
    const user = userName || currentUser;
    if (!user) return null;

    try {
      const key = `${this.manifestKey}-${user}`;
      const manifest = JSON.parse(localStorage.getItem(key) || "null");
      return manifest;
    } catch {
      return null;
    }
  }

  saveManifest(manifest, userName = null) {
    const user = userName || currentUser;
    if (!user) return;

    const key = `${this.manifestKey}-${user}`;
    localStorage.setItem(key, JSON.stringify(manifest));
  }

  async saveGlobalMFStats(newStats) {
    const existing = (await this.idb.loadFile("mf-stats-global.json")) || {};
    const merged = { ...existing, ...newStats };
    await this.idb.saveFile("mf-stats-global.json", merged);
    return merged;
  }

  async loadGlobalMFStats() {
    return (await this.idb.loadFile("mf-stats-global.json")) || null;
  }

  async savePortfolioData(
    casData,
    mfStats,
    isNewUpload = false,
    userName = null,
    label = "Portfolio data",
  ) {
    const user = userName || currentUser;
    if (!user) {
      console.error("No user specified for saving data");
      return;
    }

    try {
      await this.idb.saveFile(`cas-data-${user}.json`, casData);
      await this.saveGlobalMFStats(mfStats);

      // Only register the user after both writes succeed — prevents zombie
      // state where the user appears in the list but has incomplete data.
      this.addUser(user);

      const manifest = this.getManifest(user) || {};
      manifest.timestamp = new Date().toISOString();
      manifest.userName = user;
      manifest.casType = casData.cas_type || "DETAILED";

      if (isNewUpload) {
        manifest.lastFullUpdate = new Date().toISOString();
        manifest.lastNavUpdate = new Date().toISOString();
      }

      this.saveManifest(manifest, user);

      console.log(`✅ ${label} saved for user: ${user}`);
    } catch (err) {
      console.error("Failed to save portfolio data:", err);
      throw err;
    }
  }

  async loadPortfolioData(userName = null) {
    const user = userName || currentUser;
    if (!user) {
      console.log("No user specified for loading data");
      return null;
    }

    try {
      const casData = await this.idb.loadFile(`cas-data-${user}.json`);
      if (!casData) return null;

      // Try global stats first; migrate from per-user file if needed
      let mfStats = await this.loadGlobalMFStats();
      if (!mfStats) {
        const perUser = await this.idb.loadFile(`mf-stats-${user}.json`);
        if (perUser) {
          mfStats = await this.saveGlobalMFStats(perUser);
          console.log("📦 Migrated per-user mf-stats to global store");
        }
      }

      if (casData && mfStats) {
        return { casData, mfStats };
      }

      return null;
    } catch (err) {
      console.error("Failed to load portfolio data:", err);
      return null;
    }
  }

  async clearAll() {
    if (!currentUser) {
      console.log("⚠️ No current user to clear");
      return;
    }

    const userName = currentUser;
    await this.deleteUser(userName);

    const remainingUsers = this.getAllUsers();

    if (remainingUsers.length === 0) {
      localStorage.removeItem("lastActiveUser");
      console.log("🗑️ Last user deleted, cleared lastActiveUser");
    }

    console.log(`✅ Cleared all data for user: ${userName}`);
  }

  updateLastNavUpdate(userName = null) {
    const user = userName || currentUser;
    if (user) {
      const manifest = this.getManifest(user) || {};
      manifest.lastNavUpdate = new Date().toISOString();
      this.saveManifest(manifest, user);
    }

    const globalManifest = this.getGlobalManifest() || {};
    globalManifest.lastNavUpdate = new Date().toISOString();
    this.saveGlobalManifest(globalManifest);
  }

  markManualStatsUpdate(userName = null) {
    const user = userName || currentUser;
    const today = new Date().toISOString().split("T")[0];

    if (user) {
      const manifest = this.getManifest(user) || {};
      manifest.lastManualStatsUpdate = today;
      this.saveManifest(manifest, user);
    }

    const globalManifest = this.getGlobalManifest() || {};
    globalManifest.lastManualStatsUpdate = today;
    this.saveGlobalManifest(globalManifest);
  }

  needsFullUpdate() {
    const manifest = this.getGlobalManifest();
    if (!manifest || !manifest.lastFullUpdate) return true;

    const lastUpdate = new Date(manifest.lastFullUpdate);
    const now = new Date();
    const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);

    return daysSinceUpdate >= 7;
  }

  needsNavUpdate() {
    const manifest = this.getGlobalManifest();
    if (!manifest || !manifest.lastNavUpdate) return true;

    const lastIST = new Date(
      new Date(manifest.lastNavUpdate).toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
      }),
    );
    const nowIST = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );
    const slots =
      typeof NAV_UPDATE_SLOTS_IST !== "undefined"
        ? NAV_UPDATE_SLOTS_IST
        : [7, 12];
    const hourNow = nowIST.getHours();

    // Find the most recent slot that has passed today
    const passedSlotHours = slots.filter((h) => hourNow >= h);
    if (passedSlotHours.length === 0) return false; // No slot has passed yet

    const lastPassedHour = Math.max(...passedSlotHours);
    const lastPassedSlotTime = new Date(nowIST);
    lastPassedSlotTime.setHours(lastPassedHour, 0, 0, 0);

    return lastIST < lastPassedSlotTime;
  }

  hasManualStatsUpdateThisWeek() {
    const manifest = this.getGlobalManifest();
    if (!manifest || !manifest.lastManualStatsUpdate) return false;

    const lastUpdate = new Date(manifest.lastManualStatsUpdate);
    const now = new Date();
    const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);

    return daysSinceUpdate < 7;
  }

  updateLastFullUpdate(userName = null) {
    const user = userName || currentUser;
    if (user) {
      const manifest = this.getManifest(user) || {};
      manifest.lastFullUpdate = new Date().toISOString();
      this.saveManifest(manifest, user);
    }

    const globalManifest = this.getGlobalManifest() || {};
    globalManifest.lastFullUpdate = new Date().toISOString();
    this.saveGlobalManifest(globalManifest);
  }

  saveBenchmarkData(returns, rolling) {
    const manifest = this.getGlobalManifest() || {};
    manifest.benchmarkReturns = returns;
    manifest.benchmarkRolling = rolling;
    manifest.lastBenchmarkUpdate = new Date().toISOString();
    this.saveGlobalManifest(manifest);
  }

  getBenchmarkData() {
    const manifest = this.getGlobalManifest();
    if (!manifest) return null;
    return {
      returns: manifest.benchmarkReturns || null,
      rolling: manifest.benchmarkRolling || null,
    };
  }

  needsBenchmarkUpdate() {
    const manifest = this.getGlobalManifest();
    if (!manifest?.lastBenchmarkUpdate) return true;
    const last = new Date(manifest.lastBenchmarkUpdate);
    return new Date() - last > 7 * 24 * 60 * 60 * 1000;
  }
}

const storageManager = new StorageManager();

// Patch: add backup methods to StorageManager prototype
StorageManager.prototype.exportBackup = async function () {
  const idbRecords = await this.idb.exportAllRecords();

  const localStorageSnapshot = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const isAppKey =
      key.startsWith(this.manifestKey) ||
      key === this.usersKey ||
      key === this.globalManifestKey ||
      key === "lastActiveUser" ||
      key.startsWith("lastCASFileInfo_") ||
      key.startsWith("hiddenFolios_") ||
      key.startsWith("investorName_") ||
      key === ManifestManager.SEARCH_KEYS_KEY ||
      key === ManifestManager.SEARCH_KEYS_VERSION_KEY;
    if (isAppKey) {
      localStorageSnapshot[key] = localStorage.getItem(key);
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    appName: "MyMFDashboard",
    idbRecords,
    localStorage: localStorageSnapshot,
  };
};

StorageManager.prototype.downloadBackup = async function () {
  const backup = await this.exportBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().split("T")[0];
  const a = document.createElement("a");
  a.href = url;
  a.download = `my-mf-dashboard-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

StorageManager.prototype.importBackup = async function (backup) {
  if (!backup || backup.appName !== "MyMFDashboard") {
    throw new Error("Invalid backup file — not a MyMFDashboard backup.");
  }
  if (!backup.version || backup.version < 1) {
    throw new Error("Unrecognised backup version.");
  }
  if (Array.isArray(backup.idbRecords) && backup.idbRecords.length > 0) {
    await this.idb.importAllRecords(backup.idbRecords);
  }
  if (backup.localStorage && typeof backup.localStorage === "object") {
    for (const [key, value] of Object.entries(backup.localStorage)) {
      if (value !== null && value !== undefined) {
        localStorage.setItem(key, value);
      }
    }
  }
};

StorageManager.prototype.importBackupFile = async function (file) {
  if (!file) throw new Error("No file provided.");
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read backup file."));
    reader.readAsText(file);
  });
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }
  await this.importBackup(backup);
};
