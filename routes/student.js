const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/Item');
const Rental = require('../models/Rental');
const { isStudent } = require('../middleware/auth');

const router = express.Router();
router.use(['/dashboard', '/borrow', '/my-rentals', '/overdue', '/penalties'], isStudent);

const MAX_ACTIVE = 3;
const IN_PROGRESS = ['pending', 'approved', 'pending_return'];

// Total and count of this student's unpaid (not waived) penalties
async function getOutstandingPenalty(userId) {
  const result = await Rental.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        'penalty.amount': { $gt: 0 },
        'penalty.paid': false,
        'penalty.waived': false,
      },
    },
    { $group: { _id: null, total: { $sum: '$penalty.amount' }, count: { $sum: 1 } } },
  ]);
  return result[0] || { total: 0, count: 0 };
}

// ---------- Dashboard ----------
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.userId;
    const now = new Date();

    const [availableItems, activeRentals, pendingRequests, overdueRentals, recentRentals, penalty] =
      await Promise.all([
        Item.countDocuments({ status: 'available' }),
        Rental.countDocuments({ user: userId, status: 'approved' }),
        Rental.countDocuments({ user: userId, status: 'pending' }),
        Rental.countDocuments({ user: userId, status: 'approved', dueDate: { $lt: now } }),
        Rental.find({ user: userId }).sort({ createdAt: -1 }).limit(5),
        getOutstandingPenalty(userId),
      ]);

    res.render('student/dashboard', {
      availableItems, activeRentals, pendingRequests, overdueRentals, recentRentals, penalty,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

// ---------- Borrow ----------
async function renderBorrow(req, res, message = {}) {
  const userId = req.session.userId;
  const category = req.query.category || 'all';

  const filter = { status: 'available' };
  if (category !== 'all' && Item.CATEGORIES.includes(category)) filter.category = category;

  const [items, categories, inProgress, penalty] = await Promise.all([
    Item.find(filter).sort({ category: 1, itemCode: 1 }),
    Item.distinct('category'),
    Rental.countDocuments({ user: userId, status: { $in: IN_PROGRESS } }),
    getOutstandingPenalty(userId),
  ]);

  res.render('student/borrow', {
    items, categories: categories.sort(), category, inProgress, penalty,
    maxRentals: MAX_ACTIVE,
    success: message.success || '',
    error: message.error || '',
  });
}

router.get('/borrow', async (req, res) => {
  try {
    await renderBorrow(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

router.post('/borrow', async (req, res) => {
  try {
    const userId = req.session.userId;
    const itemId = req.body.item_id;

    if (!mongoose.isValidObjectId(itemId)) {
      return renderBorrow(req, res, { error: 'Invalid item.' });
    }

    // Rule 1: unpaid penalty blocks borrowing
    const penalty = await getOutstandingPenalty(userId);
    if (penalty.count > 0) {
      return renderBorrow(req, res, {
        error: 'You have an unpaid penalty. Please settle it with the dorm officer first.',
      });
    }

    // Rule 2: max 3 rentals in progress (pending + approved + pending return)
    const inProgress = await Rental.countDocuments({ user: userId, status: { $in: IN_PROGRESS } });
    if (inProgress >= MAX_ACTIVE) {
      return renderBorrow(req, res, {
        error: `You already have ${inProgress} rental(s) in progress. Maximum is ${MAX_ACTIVE}.`,
      });
    }

    // Atomic claim: only succeeds if the item is STILL available,
    // so two students can't grab the same item at the same time
    const item = await Item.findOneAndUpdate(
      { _id: itemId, status: 'available' },
      { status: 'rented' },
      { new: true }
    );
    if (!item) {
      return renderBorrow(req, res, { error: 'Item is no longer available.' });
    }

    try {
      await Rental.create({
        user: userId,
        item: item._id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        category: item.category,
      });
    } catch (err) {
      // Undo the claim if the rental couldn't be saved
      await Item.updateOne({ _id: item._id }, { status: 'available' });
      throw err;
    }

    await renderBorrow(req, res, {
      success: 'Borrow request submitted. Wait for admin approval.',
    });
  } catch (err) {
    console.error(err);
    renderBorrow(req, res, { error: 'Failed to submit request.' }).catch(() =>
      res.status(500).send('Something went wrong.')
    );
  }
});

// ---------- My Rentals ----------
async function renderMyRentals(req, res, message = {}) {
  const userId = req.session.userId;
  const tab = ['active', 'pending', 'returning'].includes(req.query.tab) ? req.query.tab : 'all';

  const filter = { user: userId };
  if (tab === 'active') filter.status = 'approved';
  if (tab === 'pending') filter.status = 'pending';
  if (tab === 'returning') filter.status = 'pending_return';

  const rentals = await Rental.find(filter).sort({ createdAt: -1 });
  const titles = {
    all: 'My Rentals', active: 'Active Rentals',
    pending: 'Pending Requests', returning: 'Pending Returns',
  };

  res.render('student/my-rentals', {
    rentals, tab, title: titles[tab],
    success: message.success || '',
    error: message.error || '',
  });
}

router.get('/my-rentals', async (req, res) => {
  try {
    await renderMyRentals(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

// Student asks to return an item (the admin verifies the condition later)
router.post('/my-rentals/return', async (req, res) => {
  try {
    const rentalId = req.body.return_rental_id;
    let updated = null;

    if (mongoose.isValidObjectId(rentalId)) {
      updated = await Rental.findOneAndUpdate(
        { _id: rentalId, user: req.session.userId, status: 'approved' },
        { status: 'pending_return' }
      );
    }

    await renderMyRentals(req, res, updated
      ? { success: 'Return request submitted. Admin will verify the item condition.' }
      : { error: 'Invalid rental record.' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

// ---------- Overdue ----------
router.get('/overdue', async (req, res) => {
  try {
    const rentals = await Rental.find({
      user: req.session.userId,
      status: 'approved',
      dueDate: { $lt: new Date() },
    }).sort({ dueDate: 1 });

    res.render('student/overdue', { rentals });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

// ---------- Penalties ----------
router.get('/penalties', async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rentals, penalty] = await Promise.all([
      Rental.find({ user: userId, 'penalty.amount': { $gt: 0 } }).sort({ updatedAt: -1 }),
      getOutstandingPenalty(userId),
    ]);
    res.render('student/penalties', { rentals, penalty });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

module.exports = router;