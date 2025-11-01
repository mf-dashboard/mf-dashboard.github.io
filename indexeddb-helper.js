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
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
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

  async savePortfolioData(
    casData,
    mfStats,
    isNewUpload = false,
    userName = null
  ) {
    const user = userName || currentUser;
    if (!user) {
      console.error("No user specified for saving data");
      return;
    }

    try {
      this.addUser(user);

      await this.idb.saveFile(`cas-data-${user}.json`, casData);
      await this.idb.saveFile(`mf-stats-${user}.json`, mfStats);

      const manifest = this.getManifest(user) || {};
      manifest.timestamp = new Date().toISOString();
      manifest.userName = user;
      manifest.casType = casData.cas_type || "DETAILED";

      if (isNewUpload) {
        manifest.lastFullUpdate = new Date().toISOString();
        manifest.lastNavUpdate = new Date().toISOString();
      }

      this.saveManifest(manifest, user);

      console.log(`✅ Portfolio data saved for user: ${user}`);
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
      const mfStats = await this.idb.loadFile(`mf-stats-${user}.json`);

      if (casData && mfStats) {
        console.log(`✅ Portfolio data loaded for user: ${user}`);
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
    if (!user) return;

    const manifest = this.getManifest(user) || {};
    manifest.lastNavUpdate = new Date().toISOString();
    this.saveManifest(manifest, user);
  }

  markManualStatsUpdate(userName = null) {
    const user = userName || currentUser;
    if (!user) return;

    const manifest = this.getManifest(user) || {};
    const today = new Date().toISOString().split("T")[0];
    const currentMonth = new Date().toISOString().slice(0, 7);

    manifest.lastManualStatsUpdate = today;
    manifest.lastManualStatsMonth = currentMonth;
    this.saveManifest(manifest, user);
  }

  markManualNavUpdate(userName = null) {
    const user = userName || currentUser;
    if (!user) return;

    const manifest = this.getManifest(user) || {};
    const today = new Date().toISOString().split("T")[0];

    manifest.lastManualNavUpdate = today;
    this.saveManifest(manifest, user);
  }

  needsFullUpdate(userName = null) {
    const user = userName || currentUser;
    if (!user) return false;

    const manifest = this.getManifest(user);
    if (!manifest || !manifest.lastFullUpdate) return true;

    const lastUpdate = new Date(manifest.lastFullUpdate);
    const now = new Date();

    if (
      now.getMonth() !== lastUpdate.getMonth() ||
      now.getFullYear() !== lastUpdate.getFullYear()
    ) {
      return now.getDate() >= 10;
    }

    return false;
  }

  needsNavUpdate(userName = null) {
    const user = userName || currentUser;
    if (!user) return false;

    const manifest = this.getManifest(user);
    if (!manifest || !manifest.lastNavUpdate) return true;

    const lastUpdate = new Date(manifest.lastNavUpdate);
    const today = new Date();

    return lastUpdate.toDateString() !== today.toDateString();
  }

  hasManualStatsUpdateThisMonth(userName = null) {
    const user = userName || currentUser;
    if (!user) return false;

    const manifest = this.getManifest(user);
    if (!manifest || !manifest.lastManualStatsMonth) return false;

    const currentMonth = new Date().toISOString().slice(0, 7);
    return manifest.lastManualStatsMonth === currentMonth;
  }

  hasManualNavUpdateToday(userName = null) {
    const user = userName || currentUser;
    if (!user) return false;

    const manifest = this.getManifest(user);
    if (!manifest || !manifest.lastManualNavUpdate) return false;

    const today = new Date().toISOString().split("T")[0];
    return manifest.lastManualNavUpdate === today;
  }

  updateLastFullUpdate(userName = null) {
    const user = userName || currentUser;
    if (!user) return;

    const manifest = this.getManifest(user) || {};
    manifest.lastFullUpdate = new Date().toISOString();
    this.saveManifest(manifest, user);
  }
}

const storageManager = new StorageManager();
