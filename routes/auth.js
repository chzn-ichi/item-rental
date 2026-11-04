const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { sendPasswordResetEmail, sendWelcomeEmail } = require('../utils/mailer');

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getBaseUrl(req) {
  const fromEnv = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fromEnv || `${req.protocol}://${req.get('host')}`;
}

// Find a user whose reset token matches and has not expired
function findUserByResetToken(token) {
  return User.findOne({
    resetPasswordToken: hashToken(String(token || '')),
    resetPasswordExpires: { $gt: new Date() },
  });
}

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

    // Welcome email (never blocks or breaks registration)
    sendWelcomeEmail({ to: email, name });

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

// ---------- Forgot / reset password ----------

// Show the "enter your email" page
router.get('/forgot-password', redirectIfLoggedIn, (req, res) => {
  res.render('forgot-password', { error: '', success: '' });
});

// Create a reset token and email the link
router.post('/forgot-password', redirectIfLoggedIn, async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();

    if (!email) {
      return res.render('forgot-password', { error: 'Please enter your email address', success: '' });
    }

    const user = await User.findOne({ email });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');

      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordToken: hashToken(token),
            resetPasswordExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        }
      );

      const resetUrl = `${getBaseUrl(req)}/reset-password/${token}`;

      // Not awaited on purpose, so the response looks the same whether or not the email exists
      sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
    }

    // Same message either way, so this form can't be used to find out which emails are registered
    res.render('forgot-password', {
      error: '',
      success:
        'If that email is registered, a reset link has been sent. It expires in 1 hour. Check your spam folder if you do not see it.',
    });
  } catch (err) {
    console.error(err);
    res.render('forgot-password', { error: 'Something went wrong. Please try again.', success: '' });
  }
});

// Show the "choose a new password" page
router.get('/reset-password/:token', redirectIfLoggedIn, async (req, res) => {
  try {
    const user = await findUserByResetToken(req.params.token);

    if (!user) {
      return res.render('forgot-password', {
        error: 'This reset link is invalid or has expired. Please request a new one.',
        success: '',
      });
    }

    res.render('reset-password', { token: req.params.token, error: '' });
  } catch (err) {
    console.error(err);
    res.render('forgot-password', { error: 'Something went wrong. Please try again.', success: '' });
  }
});

// Save the new password
router.post('/reset-password/:token', redirectIfLoggedIn, async (req, res) => {
  try {
    const user = await findUserByResetToken(req.params.token);

    if (!user) {
      return res.render('forgot-password', {
        error: 'This reset link is invalid or has expired. Please request a new one.',
        success: '',
      });
    }

    const password = req.body.password || '';
    const confirm = req.body.confirm_password || '';

    const fail = (msg) => res.render('reset-password', { token: req.params.token, error: msg });

    if (!password || !confirm) return fail('Please fill in all fields');
    if (password !== confirm) return fail('Passwords do not match');
    if (password.length < 6) return fail('Password must be at least 6 characters');

    const passwordHash = await bcrypt.hash(password, 10);

    await User.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash },
        $unset: { resetPasswordToken: '', resetPasswordExpires: '' },
      }
    );

    res.render('auth', {
      activeForm: 'login',
      error: '',
      success: 'Password updated! Please login with your new password.',
    });
  } catch (err) {
    console.error(err);
    res.render('forgot-password', { error: 'Something went wrong. Please try again.', success: '' });
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