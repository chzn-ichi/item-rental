const Setting = require('../models/Setting');

// Used until an admin saves their own rules
const DEFAULTS = { defaultLoanDays: 7, maxLoanDays: 30, maxRentals: 3, blockOnPenalty: true };

let cache = null;
let cachedAt = 0;
const TTL_MS = 15000;

async function getSettings() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const doc = await Setting.findOne({ key: 'main' }).lean();
  cache = {
    defaultLoanDays: doc?.defaultLoanDays ?? DEFAULTS.defaultLoanDays,
    maxLoanDays: doc?.maxLoanDays ?? DEFAULTS.maxLoanDays,
    maxRentals: doc?.maxRentals ?? DEFAULTS.maxRentals,
    blockOnPenalty: doc?.blockOnPenalty ?? DEFAULTS.blockOnPenalty,
  };
  cachedAt = Date.now();
  return cache;
}

async function saveSettings(values) {
  await Setting.updateOne({ key: 'main' }, { $set: values }, { upsert: true });
  cache = null; // the next read loads the new values
}

module.exports = { getSettings, saveSettings, DEFAULTS };