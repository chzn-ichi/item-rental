const mongoose = require('mongoose');

// One document (key: 'main') holds the rules for the whole system
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    defaultLoanDays: { type: Number, default: 7, min: 1 },
    maxLoanDays: { type: Number, default: 30, min: 1 },
    maxRentals: { type: Number, default: 3, min: 1 },
    blockOnPenalty: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Setting', settingSchema);