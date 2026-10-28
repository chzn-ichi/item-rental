const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const router = express.Router();

// Send already-logged-in users to their own dashboard
function redirectIfLoggedIn(req, res, next) {
  if (!req.session.userId) return next();
  res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/dashboard');
}

router.get('/', (req, res) => res.redirect('/login'));

// Show the login/register page
router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('auth', { activeForm: 'login', error: '', success: '' });
});

// Handle login
router.post('/login', redirectIfLoggedIn, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.render('auth', { activeForm: 'login', error: 'Please fill in all fields', success: '' });
    }

    const user = await User.findOne({ email });
    const valid = user && (await bcrypt.compare(password, user.passwordHash));

    if (!valid) {
      return res.render('auth', { activeForm: 'login', error: 'Invalid email or password', success: '' });
    }

    req.session.userId = user._id.toString();
    req.session.userName = user.name;
    req.session.email = user.email;
    req.session.role = user.role;

    res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/dashboard');
  } catch (err) {
    console.error(err);
    res.render('auth', { activeForm: 'login', error: 'Something went wrong. Please try again.', success: '' });
  }
});

// Handle registration (always creates a student)
router.post('/register', redirectIfLoggedIn, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const confirm = req.body.confirm_password || '';

    const fail = (msg) =>
      res.render('auth', { activeForm: 'register', error: msg, success: '' });

    if (!name || !email || !password) return fail('Please fill in all fields');
    if (password !== confirm) return fail('Passwords do not match');
    if (password.length < 6) return fail('Password must be at least 6 characters');

    const exists = await User.findOne({ email });
    if (exists) return fail('Email already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ name, email, passwordHash, role: 'student' });

    res.render('auth', {
      activeForm: 'login',
      error: '',
      success: 'Registration successful! Please login.',
    });
  } catch (err) {
    console.error(err);
    res.render('auth', { activeForm: 'register', error: 'Registration failed. Please try again.', success: '' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;