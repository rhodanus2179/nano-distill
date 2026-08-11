import { formatBytes } from './text.js';

export async function getSiteStorageSummary() {
  if (!navigator.storage?.estimate) return '保存量を取得できません';
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota) return `${formatBytes(usage)} 使用中`;
    return `${formatBytes(usage)} 使用中 / ${formatBytes(quota)} 上限`;
  } catch {
    return '保存量を取得できません';
  }
}

export async function clearSiteData() {
  const results = {
    localStorage: false,
    sessionStorage: false,
    indexedDB: 0,
    caches: 0,
    serviceWorkers: 0,
  };

  try {
    localStorage.clear();
    results.localStorage = true;
  } catch {}

  try {
    sessionStorage.clear();
    results.sessionStorage = true;
  } catch {}

  if (typeof indexedDB?.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      for (const database of databases) {
        if (!database.name) continue;
        await deleteDatabase(database.name);
        results.indexedDB += 1;
      }
    } catch {}
  }

  if ('caches' in globalThis) {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        if (await caches.delete(key)) results.caches += 1;
      }
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (await registration.unregister()) results.serviceWorkers += 1;
      }
    } catch {}
  }

  return results;
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
