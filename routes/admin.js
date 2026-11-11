const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const Rental = require('../models/Rental');
const User = require('../models/User');
const { isAdmin } = require('../middleware/auth');
const { dateInputValue } = require('../utils/helpers');
const {
  sendRentalApprovedEmail,
  sendRentalRejectedEmail,
  sendReturnProcessedEmail,
  sendPenaltySettledEmail,
  sendDeadlineExtendedEmail,
} = require('../utils/mailer');

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

// Looks up the student and sends them an email. Never throws, so a failed
// email can't break the admin action that triggered it. Call it without await.
async function emailStudent(userId, sendFn, data) {
  try {
    const student = await User.findById(userId).select('name email');
    if (student) await sendFn({ to: student.email, name: student.name, ...data });
  } catch (err) {
    console.error('Could not send student email:', err.message);
  }
}

const validId = (id) => mongoose.isValidObjectId(id);
const itemsUrl = (c) =>
  Item.CATEGORIES.includes(c) ? `/admin/items?category=${encodeURIComponent(c)}` : '/admin/items';
const PENALTY_FILTERS = ['unpaid', 'paid', 'waived'];
const penaltiesUrl = (s) =>
  PENALTY_FILTERS.includes(s) ? `/admin/penalties?status=${s}` : '/admin/penalties';

// ---------- Due dates ----------
const MAX_LOAN_DAYS = 30;

// The chosen day counts until 23:59:59 Philippine time
function parseDueDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str || '')) return null;
  const due = new Date(`${str}T23:59:59.999+08:00`);
  return Number.isNaN(due.getTime()) ? null : due;
}

// Earliest, latest, and default due dates the admin can pick (YYYY-MM-DD)
function dueLimits() {
  const now = new Date();
  return {
    minDue: dateInputValue(now, 1),
    maxDue: dateInputValue(now, MAX_LOAN_DAYS),
    defaultDue: dateInputValue(now, Rental.RENTAL_DAYS),
  };
}

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


const ITEM_SORTS = {
  category:  { label: 'Category, then code', sort: { category: 1, itemCode: 1 } },
  newest:    { label: 'Date added: newest first', sort: { createdAt: -1, _id: -1 } },
  oldest:    { label: 'Date added: oldest first', sort: { createdAt: 1, _id: 1 } },
  code_asc:  { label: 'Item code: A to Z', sort: { itemCode: 1 } },
  code_desc: { label: 'Item code: Z to A', sort: { itemCode: -1 } },
  name_asc:  { label: 'Item name: A to Z', sort: { itemName: 1, itemCode: 1 } },
  name_desc: { label: 'Item name: Z to A', sort: { itemName: -1, itemCode: 1 } },
  status:    { label: 'Status', sort: { status: 1, itemCode: 1 } },
};
const hasSort = (key) => typeof key === 'string' && Object.hasOwn(ITEM_SORTS, key);


// ---------- Manage Items ----------
router.get('/items', safe(async (req, res) => {
  const category = Item.CATEGORIES.includes(req.query.category) ? req.query.category : 'all';
  if (hasSort(req.query.sort)) req.session.itemSort = req.query.sort;
  const sort = hasSort(req.session.itemSort) ? req.session.itemSort : 'category';

  const filter = category === 'all' ? {} : { category };
  const items = await Item.find(filter)
    .collation({ locale: 'en', numericOrdering: true })
    .sort(ITEM_SORTS[sort].sort);

  res.render('admin/items', { items, category, categories: Item.CATEGORIES, sort, sortOptions: ITEM_SORTS });
}));

const MAX_BATCH = 100;

router.post('/items/add', safe(async (req, res) => {
  const back = itemsUrl(req.body.back_category);
  const code = (req.body.item_code || '').trim();
  const itemName = (req.body.item_name || '').trim();
  const category = req.body.category;
  const status = ['available', 'maintenance', 'damaged'].includes(req.body.status) ? req.body.status : 'available';
  const quantity = Number.parseInt(req.body.quantity, 10) || 1;

  if (!code || !itemName) return go(req, res, back, 'error', 'Please enter item code and name.');
  if (!Item.CATEGORIES.includes(category)) return go(req, res, back, 'error', 'Invalid category.');
  if (quantity < 1 || quantity > MAX_BATCH) {
    return go(req, res, back, 'error', `Quantity must be between 1 and ${MAX_BATCH}.`);
  }

  // One unit: use the code exactly as typed
  if (quantity === 1) {
    try {
      await Item.create({ itemCode: code, itemName, category, status });
    } catch (err) {
      if (err.code === 11000) return go(req, res, back, 'error', 'An item with that code already exists.');
      throw err;
    }
    return go(req, res, back, 'success', 'Item added successfully.');
  }

  // Several units: the code is a prefix, numbered from the next free number
  const prefix = code.replace(/-+$/, '');
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = await Item.find({ itemCode: new RegExp(`^${escaped}-(\\d+)$`) }).select('itemCode');
  const highest = existing.reduce((max, i) => Math.max(max, parseInt(i.itemCode.split('-').pop(), 10)), 0);

  const docs = [];
  for (let n = 1; n <= quantity; n++) {
    docs.push({ itemCode: `${prefix}-${String(highest + n).padStart(3, '0')}`, itemName, category, status });
  }

  try {
    await Item.insertMany(docs);
  } catch (err) {
    if (err.code === 11000) return go(req, res, back, 'error', 'Some of those codes already exist. Try a different prefix.');
    throw err;
  }
  go(req, res, back, 'success', `${quantity} items added (${docs[0].itemCode} to ${docs[docs.length - 1].itemCode}).`);
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
  res.render('admin/rentals', { pending, active, now: new Date(), ...dueLimits() });
}));

router.post('/rentals/:id/approve', safe(async (req, res) => {
  const back = '/admin/rentals';
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid rental.');

  // The admin picks the deadline: between tomorrow and MAX_LOAN_DAYS from today
  const { minDue, maxDue } = dueLimits();
  const dueStr = req.body.due_date;
  const due = parseDueDate(dueStr);
  if (!due || dueStr < minDue || dueStr > maxDue) {
    return go(req, res, back, 'error', `Choose a due date between tomorrow and ${MAX_LOAN_DAYS} days from now.`);
  }

  const rental = await Rental.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'approved', dueDate: due },
    { new: true }
  );
  if (!rental) return go(req, res, back, 'error', 'Request not found or already handled.');

  emailStudent(rental.user, sendRentalApprovedEmail, {
    itemName: rental.itemName,
    itemCode: rental.itemCode,
    dueDate: rental.dueDate,
  });

  go(req, res, back, 'success', 'Rental request approved.');
}));

router.post('/rentals/:id/extend', safe(async (req, res) => {
  const back = '/admin/rentals';
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid rental.');

  const rental = await Rental.findOne({ _id: req.params.id, status: 'approved' });
  if (!rental) return go(req, res, back, 'error', 'Only active rentals can be extended.');

  const { minDue, maxDue } = dueLimits();
  const dueStr = req.body.due_date;
  const due = parseDueDate(dueStr);
  console.log('EXTEND', { dueStr, current: rental.dueDate.toISOString(), chosen: due && due.toISOString() });
  if (!due || dueStr < minDue || dueStr > maxDue) {
    return go(req, res, back, 'error', `Choose a date between tomorrow and ${MAX_LOAN_DAYS} days from now.`);
  }
  if (due <= rental.dueDate) {
    return go(req, res, back, 'error', 'A deadline can only be extended. Choose a date after the current due date.');
  }

  // The dueDate filter makes "only later" hold even if two admins act at the same moment
  const updated = await Rental.findOneAndUpdate(
    { _id: rental._id, status: 'approved', dueDate: { $lt: due } },
    { dueDate: due },
    { new: true }
  );
  if (!updated) return go(req, res, back, 'error', 'This rental changed. Please try again.');

  emailStudent(updated.user, sendDeadlineExtendedEmail, {
    itemName: updated.itemName,
    itemCode: updated.itemCode,
    dueDate: updated.dueDate,
  });

  go(req, res, back, 'success', 'Deadline extended.');
}));

router.post('/rentals/:id/reject', safe(async (req, res) => {
  const back = '/admin/rentals';
  if (!validId(req.params.id)) return go(req, res, back, 'error', 'Invalid rental.');

  const rental = await Rental.findOneAndDelete({ _id: req.params.id, status: 'pending' });
  if (!rental) return go(req, res, back, 'error', 'Request not found or already handled.');

  await Item.updateOne({ _id: rental.item, status: 'rented' }, { status: 'available' });

  emailStudent(rental.user, sendRentalRejectedEmail, {
    itemName: rental.itemName,
    itemCode: rental.itemCode,
  });

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

  emailStudent(rental.user, sendReturnProcessedEmail, {
    itemName: rental.itemName,
    itemCode: rental.itemCode,
    condition,
    penaltyAmount: amount,
  });

  const messages = {
    good: 'Item returned successfully. Condition: Good.',
    dirty: 'Item returned. Condition: Dirty. It is now Under Maintenance until you mark it available.',
    damaged: amount > 0
      ? `Item marked as damaged. Penalty of \u20B1${amount.toFixed(2)} added.`
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

  emailStudent(rental.user, sendPenaltySettledEmail, {
    itemName: rental.itemName,
    itemCode: rental.itemCode,
    amount: rental.penalty.amount,
    waived: false,
  });

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

  emailStudent(rental.user, sendPenaltySettledEmail, {
    itemName: rental.itemName,
    itemCode: rental.itemCode,
    amount: rental.penalty.amount,
    waived: true,
  });

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