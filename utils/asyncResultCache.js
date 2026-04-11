const DEFAULT_MAX_ENTRIES = 200;

class AsyncResultCache {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.value !== undefined && entry.expiresAt > Date.now()) {
      return entry.value;
    }

    if (entry.promise) {
      return entry.promise;
    }

    this.store.delete(key);
    return null;
  }

  async getOrLoad(key, loader, ttlMs) {
    const existing = this.store.get(key);
    const now = Date.now();

    if (existing?.value !== undefined && existing.expiresAt > now) {
      return existing.value;
    }

    if (existing?.promise) {
      return existing.promise;
    }

    const pendingPromise = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.store.set(key, {
          value,
          expiresAt: now + ttlMs,
        });
        this.prune();
        return value;
      })
      .catch((error) => {
        const current = this.store.get(key);
        if (current?.promise === pendingPromise) {
          this.store.delete(key);
        }
        throw error;
      });

    this.store.set(key, {
      promise: pendingPromise,
      expiresAt: now + ttlMs,
    });

    return pendingPromise;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  prune() {
    const now = Date.now();

    for (const [key, entry] of this.store.entries()) {
      if (!entry.promise && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.store.delete(oldestKey);
    }
  }
}

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

module.exports = {
  AsyncResultCache,
  stableStringify,
};
