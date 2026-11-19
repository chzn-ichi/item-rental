const express = require('express');
const User = require('../models/User');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { getSettings, saveSettings } = require('../utils/settings');

const router = express.Router();

// Only the /settings paths need a login (a global router.use would affect every other page)
router.use('/settings', isLoggedIn);

function back(req, res, type, message) {
  req.session.settingsFlash = { [type]: message };
  req.session.save(() => res.redirect('/settings'));
}

router.get('/settings', async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('role notifyEmail adminAlerts');
    if (!user) return res.redirect('/logout');

    const flash = req.session.settingsFlash || {};
    delete req.session.settingsFlash;

    res.render('settings', {
      isStudent: user.role === 'student',
      isAdminPage: user.role === 'admin',
      notifyEmail: user.notifyEmail !== false,
      adminAlerts: user.adminAlerts === true,
      loanRules: user.role === 'admin' ? await getSettings() : null,
      success: flash.success || '',
      error: flash.error || '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

router.post('/settings/notifications', async (req, res) => {
  try {
    const on = req.body.notify_email === 'on';
    await User.updateOne({ _id: req.session.userId, role: 'student' }, { notifyEmail: on });
    back(req, res, 'success', on ? 'Email notifications are on.' : 'Email notifications are off.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

router.post('/settings/admin-alerts', isAdmin, async (req, res) => {
  try {
    const on = req.body.admin_alerts === 'on';
    await User.updateOne({ _id: req.session.userId, role: 'admin' }, { adminAlerts: on });
    back(req, res, 'success', on ? 'Admin alerts are on.' : 'Admin alerts are off.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

router.post('/settings/loan-rules', isAdmin, async (req, res) => {
  try {
    const defaultLoanDays = Number.parseInt(req.body.default_days, 10);
    const maxLoanDays = Number.parseInt(req.body.max_days, 10);
    const maxRentals = Number.parseInt(req.body.max_rentals, 10);
    const blockOnPenalty = req.body.block_on_penalty === 'on';

    const inRange = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

    if (!inRange(maxLoanDays, 1, 90)) return back(req, res, 'error', 'The maximum loan must be between 1 and 90 days.');
    if (!inRange(defaultLoanDays, 1, 90)) return back(req, res, 'error', 'The default loan must be between 1 and 90 days.');
    if (defaultLoanDays > maxLoanDays) return back(req, res, 'error', 'The default loan can\'t be longer than the maximum.');
    if (!inRange(maxRentals, 1, 10)) return back(req, res, 'error', 'Rentals per student must be between 1 and 10.');

    await saveSettings({ defaultLoanDays, maxLoanDays, maxRentals, blockOnPenalty });
    back(req, res, 'success', 'Loan rules saved.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong.');
  }
});

module.exports = router;