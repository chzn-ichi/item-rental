const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');

const router = express.Router();

// Defense in depth: even if mounted by mistake, refuse unless the flag is on
router.use((req, res, next) => {
  if (process.env.ENABLE_TEST_AS === 'true' && process.env.NODE_ENV !== 'production') return next();
  res.status(404).send('Not found');
});

router.post('/switch', async (req, res) => {
  try {
    const id = req.body.user_id;
    if (!mongoose.isValidObjectId(id)) return res.redirect('/login');

    const user = await User.findById(id);
    if (!user || user.pendingVerification) return res.redirect('/login');

    req.session.userId = user._id.toString();
    req.session.userName = user.name;
    req.session.email = user.email;
    req.session.role = user.role;
    delete req.session.verifyEmail;
    delete req.session.resetEmail;

    req.session.save(() => res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/dashboard'));
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

module.exports = router;