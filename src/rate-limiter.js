// Rate limiter — per-agent token bucket.
//
// Single-process, in-memory. Config is loaded from the `settings` table on
// first use and written back on configure(). Refill happens lazily on acquire()
// rather than via a timer, so no background interval is needed.

const DEFAULT_CAPACITY = 10;
const DEFAULT_REFILL_PER_SECOND = 1;

// buckets: agentId -> { tokens, capacity, refillPerSecond, lastRefillMs }
const buckets = new Map();

// Injected on first acquire() when stmts are provided.
let _stmts = null;

function _loadConfig(agentId) {
  if (!_stmts) return null;
  try {
    const row = _stmts.getSettings.get('rate_limit:' + agentId);
    if (!row) return null;
    return JSON.parse(row.value_json);
  } catch { return null; }
}

function _saveConfig(agentId, capacity, refillPerSecond) {
  if (!_stmts) return;
  try {
    _stmts.upsertSettings.run({
      key: 'rate_limit:' + agentId,
      value_json: JSON.stringify({ capacity, refill_per_second: refillPerSecond })
    });
  } catch { /* non-fatal — config stays in memory */ }
}

function _getBucket(agentId) {
  if (!buckets.has(agentId)) {
    const cfg = _loadConfig(agentId) || {};
    const capacity = cfg.capacity || DEFAULT_CAPACITY;
    const refillPerSecond = cfg.refill_per_second || DEFAULT_REFILL_PER_SECOND;
    buckets.set(agentId, {
      tokens: capacity,
      capacity,
      refillPerSecond,
      lastRefillMs: Date.now()
    });
  }
  return buckets.get(agentId);
}

function _applyRefill(bucket) {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefillMs) / 1000;
  const added = elapsed * bucket.refillPerSecond;
  if (added >= 1) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.floor(added));
    bucket.lastRefillMs = now;
  }
}

/**
 * Inject the DB statement bundle so config can be persisted.
 * Call once at startup from server.js or wherever executeWithFailover is wired.
 */
function init(stmts) {
  _stmts = stmts;
}

/**
 * Try to consume one token for agentId.
 * Returns true if the dispatch is allowed, false if the bucket is empty.
 * Does NOT block — callers decide what to do on false.
 */
function acquire(agentId) {
  const bucket = _getBucket(agentId);
  _applyRefill(bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * Manually trigger a refill pass across all known buckets.
 * Useful for tests or an external keepalive interval.
 */
function refill() {
  for (const bucket of buckets.values()) {
    _applyRefill(bucket);
  }
}

/**
 * Override per-agent capacity and refill rate.
 * Resets the bucket to full capacity with the new settings.
 */
function configure(agentId, capacity, refillPerSecond) {
  capacity = Math.max(1, capacity || DEFAULT_CAPACITY);
  refillPerSecond = Math.max(0.01, refillPerSecond || DEFAULT_REFILL_PER_SECOND);
  buckets.set(agentId, {
    tokens: capacity,
    capacity,
    refillPerSecond,
    lastRefillMs: Date.now()
  });
  _saveConfig(agentId, capacity, refillPerSecond);
}

/**
 * Return a snapshot of the bucket state (for /api/agents/:id/throttle or tests).
 */
function status(agentId) {
  const bucket = _getBucket(agentId);
  _applyRefill(bucket);
  return {
    tokens: bucket.tokens,
    capacity: bucket.capacity,
    refill_per_second: bucket.refillPerSecond
  };
}

module.exports = { init, acquire, refill, configure, status };
