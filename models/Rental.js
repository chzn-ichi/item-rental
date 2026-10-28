const mongoose = require('mongoose');

const RENTAL_DAYS = 7;

// Embedded inside a rental; only exists when a penalty was issued
const penaltySchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: 'Damaged item' },
    paid: { type: Boolean, default: false },
    waived: { type: Boolean, default: false },
    paidAt: { type: Date },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const rentalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },

    // Snapshot of the item, so lists load without joins
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    category: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'pending_return', 'returned'],
      default: 'pending',
    },

    borrowDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    returnDate: { type: Date },
    returnCondition: { type: String, enum: ['good', 'dirty', 'damaged'] },

    penalty: { type: penaltySchema, default: undefined },
  },
  { timestamps: true }
);

// Auto-set the due date (borrowDate + 7 days) if not provided
rentalSchema.pre('validate', function (next) {
  if (!this.dueDate) {
    const due = new Date(this.borrowDate || Date.now());
    due.setDate(due.getDate() + RENTAL_DAYS);
    this.dueDate = due;
  }
  next();
});

// Speeds up the most common lookups
rentalSchema.index({ user: 1, status: 1 });
rentalSchema.index({ status: 1, dueDate: 1 });

const Rental = mongoose.model('Rental', rentalSchema);
Rental.RENTAL_DAYS = RENTAL_DAYS;

module.exports = Rental;