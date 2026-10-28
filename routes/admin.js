const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const Rental = require('../models/Rental');
const User = require('../models/User');
const { isAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(isAdmin); // every route in this file is admin-only

// One-time messages that survive a redirect (shown once, then cleared)
router.use((req, res, next) => {
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;
  next();
});

function go(req, res, url, type, message) {
  req.session.flash = { [type]: message };
  req.session.save(() => res.redirect(url));
}

// Catches errors in async routes
const safe = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err);
    res.status(500).send('Something went wrong.');
  });

const validId = (id) => mongoose.isValidObjectId(id);
const itemsUrl = (c) =>
  Item.CATEGORIES.includes(c) ? `/admin/items?category=${encodeURIComponent(c)}` : '/admin/items';
const PENALTY_FILTERS = ['unpaid', 'paid', 'waived'];
const penaltiesUrl = (s) =>
  PENALTY_FILTERS.includes(s) ? `/admin/penalties?status=${s}` : '/admin/penalties';

function penaltyQuery(status) {
  const q = { 'penalty.amount': { $gt: 0 } };
  if (status === 'unpaid') { q['penalty.paid'] = false; q['penalty.waived'] = false; }
  if (status === 'paid') q['penalty.paid'] = true;
  if (status === 'waived') q['penalty.waived'] = true;
  return q;
}

async function unpaidTotal() {
  const r = await Rental.aggregate([
    { $match: penaltyQuery('unpaid') },
    { $group: { _id: null, total: { $sum: '$penalty.amount' }, count: { $sum: 1 } } },
  ]);
  return r[0] || { total: 0, count: 0 };
}

// ---------- Dashboard ----------
router.get('/dashboard', safe(async (req, res) => {
  const now = new Date();
  const [
    totalItems, available, rented, maintenance, damaged,
    pendingApprovals, pendingReturns, activeRentals, overdueRentals,
    totalStudents, unpaid, categoryCounts, recentRentals,
  ] = await Promise.all([
    Item.countDocuments(),
    Item.countDocuments({ status: 'available' }),
    Item.countDocuments({ status: 'rented' }),
    Item.countDocuments({ status: 'maintenance' }),
    Item.countDocuments({ status: 'damaged' }),
    Rental.countDocuments({ status: 'pending' }),
    Rental.countDocuments({ status: 'pending_return' }),
    Rental.countDocuments({ status: 'approved' }),
    Rental.countDocuments({ status: 'approved', dueDate: { $lt: now } }),
    User.countDocuments({ role: 'student' }),
    unpaidTotal(),
    Item.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Rental.find().sort({ createdAt: -1 }).limit(10).populate('user', 'name'),
  ]);

  res.render('admin/dashboard', {
    totalItems, available, rented, maintenance, damaged,
    pendingApprovals, pendingReturns, activeRentals, overdueRentals,
    totalStudents, unpaid, categoryCounts, recentRentals,
  });
}));

// ---------- Manage Items ----------
router.get('/items', safe(async (req, res) => {
  const category = Item.CATEGORIES.includes(req.query.category) ? req.query.category : 'all';
  const filter = category === 'all' ? {} : { category };
  const items = await Item.find(filter).sort({ category: 1, itemCode: 1 });
  res.render('admin/items', { items, category, categories: Item.CATEGORIES });
}));

router.post('/items/add', safe(async (req, res) => {
  const back = itemsUrl(req.body.back_category);
  const itemCode = (req.body.item_code || '').trim();
  const itemName = (req.body.item_name || '').trim();
  const category = req.body.category;
  const status = ['available', 'maintenance', 'damaged'].includes(req.body.status) ? req.body.status : 'available';

  if (!itemCode || !itemName) return go(req, res, back, 'error', 'Please enter item code and name.');
  if (!Item.CATEGORIES.includes(category)) return go(req, res, back, 'error', 'Invalid category.');

  try {
    await Item.create({ itemCode, itemName, category, status });
  } catch (err) {
    if (err.code === 11000) return go(req, res, back, 'error', 'An item with that code already exists.');
    throw err;
  }
  go(req, res, back, 'success', 'Item added successfully.');
}));

router.post('/items/:id/edit', safe(async (req, res) => {
  const back = itemsUrl(req.body.back_category);
  const itemCode = (req.body.item_code || '').trim();
  const itemName = (req.body.item_name || '').trim();
  const category = req.body.category;

  if (!validId(req.params.id) || !itemCode || !itemName || !Item.CATEGORIES.includes(category)) {
    return go(req, res, back, 'error', 'Invalid item details.');
  }

  let item;
  try {
    item = await Item.findByIdAndUpdate(req.params.id, { itemCode, itemName, category }, { new: true });
  } catch (err) {
    if (err.code === 11000) return go(req, res, back, 'error', 'An item with that code already exists.');
    throw err;
  }
  if (!item) return go(req, res, back, 'error', 'Item not found.');

  // Keep the copies stored inside rentals in sync
  await Rental.updateMany({ item: item._id }, { itemCode, itemName, category });
  go(req, res, back, 'success', 'Item details updated.');
}));

router.post('/items/:id/status', safe(async (req, res) => {
  const back = itemsUrl(req.body.back_category);
  const status = req.body.status;

  if (!validId(req.params.id) || !['available', 'maintenance', 'damaged'].includes(status)) {
    return go(req, res, back, 'error', 'Invalid status.');
  }

  // An item that is out on rental can't be changed by hand
  const item = await Item.findOneAndUpdate(
    { _id: req.params.id, status: { $ne: 'rented' } },
    { status }
  );
  if (!item) return go(req, res, back, 'error', 'This item is currently rented. Its status changes when it is returned.');
  go(req, res, back, 'success', 'Item status updated.');
}));

router.post('/items/:id/delete', safe(async (req, res) => {
  const back = itemsUrl(req.body.back_category);
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid item.');

  const active = await Rental.countDocuments({ item: req.params.id, status: { $ne: 'returned' } });
  if (active > 0) return go(req, res, back, 'error', 'Cannot delete an item that is currently rented or pending.');

  await Item.deleteOne({ _id: req.params.id });
  go(req, res, back, 'success', 'Item deleted successfully.');
}));

// ---------- Manage Rentals ----------
router.get('/rentals', safe(async (req, res) => {
  const [pending, active] = await Promise.all([
    Rental.find({ status: 'pending' }).sort({ createdAt: 1 }).populate('user', 'name email'),
    Rental.find({ status: 'approved' }).sort({ dueDate: 1 }).populate('user', 'name email'),
  ]);
  res.render('admin/rentals', { pending, active, now: new Date() });
}));

router.post('/rentals/:id/approve', safe(async (req, res) => {
  const back = '/admin/rentals';
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid rental.');

  // The 7 days start counting from approval
  const due = new Date();
  due.setDate(due.getDate() + Rental.RENTAL_DAYS);

  const rental = await Rental.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'approved', dueDate: due }
  );
  if (!rental) return go(req, res, back, 'error', 'Request not found or already handled.');
  go(req, res, back, 'success', 'Rental request approved.');
}));

router.post('/rentals/:id/reject', safe(async (req, res) => {
  const back = '/admin/rentals';
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid rental.');

  const rental = await Rental.findOneAndDelete({ _id: req.params.id, status: 'pending' });
  if (!rental) return go(req, res, back, 'error', 'Request not found or already handled.');

  await Item.updateOne({ _id: rental.item, status: 'rented' }, { status: 'available' });
  go(req, res, back, 'success', 'Rental request rejected.');
}));

// ---------- Process Returns ----------
router.get('/returns', safe(async (req, res) => {
  const [pending, recent] = await Promise.all([
    Rental.find({ status: 'pending_return' }).sort({ updatedAt: 1 }).populate('user', 'name email'),
    Rental.find({ status: 'returned' }).sort({ returnDate: -1 }).limit(10).populate('user', 'name'),
  ]);
  res.render('admin/returns', { pending, recent });
}));

router.post('/returns/process', safe(async (req, res) => {
  const back = '/admin/returns';
  const { rental_id: rentalId, condition } = req.body;

  if (!validId(rentalId) || !['good', 'dirty', 'damaged'].includes(condition)) {
    return go(req, res, back, 'error', 'Invalid return details.');
  }

  // Penalty is optional, and only applies to damaged items
  let amount = 0;
  const raw = (req.body.penalty_amount || '').trim();
  if (condition === 'damaged' && raw !== '') {
    amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      return go(req, res, back, 'error', 'Penalty must be a valid amount.');
    }
  }

  const update = { status: 'returned', returnDate: new Date(), returnCondition: condition };
  if (amount > 0) {
    update.penalty = { amount, reason: 'Damaged item', paid: false, waived: false };
  }

  const rental = await Rental.findOneAndUpdate(
    { _id: rentalId, status: 'pending_return' },
    update
  );
  if (!rental) return go(req, res, back, 'error', 'Rental not found or already processed.');

  const itemStatus = { good: 'available', dirty: 'maintenance', damaged: 'damaged' }[condition];
  await Item.updateOne({ _id: rental.item }, { status: itemStatus });

  const messages = {
    good: 'Item returned successfully. Condition: Good.',
    dirty: 'Item returned. Condition: Dirty. It is now Under Maintenance until you mark it available.',
    damaged: amount > 0
      ? `Item marked as damaged. Penalty of ₱${amount.toFixed(2)} added.`
      : 'Item marked as damaged. No penalty added.',
  };
  go(req, res, back, 'success', messages[condition]);
}));

// ---------- Penalties ----------
router.get('/penalties', safe(async (req, res) => {
  const status = PENALTY_FILTERS.includes(req.query.status) ? req.query.status : 'all';
  const [rentals, unpaid] = await Promise.all([
    Rental.find(penaltyQuery(status))
      .sort({ updatedAt: -1 })
      .populate('user', 'name email')
      .populate('penalty.paidBy', 'name'),
    unpaidTotal(),
  ]);
  res.render('admin/penalties', { rentals, status, unpaid });
}));

router.post('/penalties/:id/paid', safe(async (req, res) => {
  const back = penaltiesUrl(req.body.back_status);
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid penalty.');

  const rental = await Rental.findOneAndUpdate(
    { _id: req.params.id, 'penalty.paid': false, 'penalty.waived': false },
    { $set: { 'penalty.paid': true, 'penalty.paidAt': new Date(), 'penalty.paidBy': req.session.userId } }
  );
  if (!rental) return go(req, res, back, 'error', 'Penalty not found or already settled.');
  go(req, res, back, 'success', 'Penalty marked as paid. The student can borrow again.');
}));

router.post('/penalties/:id/waive', safe(async (req, res) => {
  const back = penaltiesUrl(req.body.back_status);
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid penalty.');

  const rental = await Rental.findOneAndUpdate(
    { _id: req.params.id, 'penalty.paid': false, 'penalty.waived': false },
    { $set: { 'penalty.waived': true, 'penalty.paidAt': new Date(), 'penalty.paidBy': req.session.userId } }
  );
  if (!rental) return go(req, res, back, 'error', 'Penalty not found or already settled.');
  go(req, res, back, 'success', 'Penalty waived.');
}));

// ---------- Rental History ----------
router.get('/history', safe(async (req, res) => {
  const allowed = ['pending', 'approved', 'pending_return', 'returned'];
  const status = allowed.includes(req.query.status) ? req.query.status : 'all';
  const filter = status === 'all' ? {} : { status };

  const rentals = await Rental.find(filter).sort({ createdAt: -1 }).populate('user', 'name email');
  res.render('admin/history', { rentals, status });
}));

module.exports = router;