const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const {
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendVerificationCodeEmail,
} = require('../utils/mailer');

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_CODE_ATTEMPTS = 5;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// The user id is mixed in so the same code gives a different hash for each person
function hashCode(userId, code) {
  return hashToken(`${userId}:${code}`);
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

// Creates a fresh 6-digit code, stores only its hash, and emails it
async function issueVerificationCode(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        verifyCodeHash: hashCode(user._id, code),
        verifyCodeExpires: new Date(Date.now() + CODE_TTL_MS),
        verifyAttempts: 0,
        verifyLastSentAt: new Date(),
      },
    }
  );
  sendVerificationCodeEmail({ to: user.email, name: user.name, code });
}

// Remembers which email is being verified, then opens the code page
function startVerification(req, res, email, notice) {
  req.session.verifyEmail = email;
  req.session.verifyNotice = notice;
  req.session.save(() => res.redirect('/verify'));
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

    // Correct password, but the email was never verified
    if (user.pendingVerification) {
      const hasValidCode = user.verifyCodeHash && user.verifyCodeExpires > new Date();
      if (!hasValidCode) await issueVerificationCode(user);
      return startVerification(req, res, user.email, 'Please verify your email first. Enter the code we sent you.');
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

// Handle registration (always creates a student, who must verify the email)
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
    if (exists && !exists.pendingVerification) return fail('Email already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    let user;

    if (exists) {
      // An earlier sign-up was never verified: let them start over with a new code
      exists.name = name;
      exists.passwordHash = passwordHash;
      await exists.save();
      user = exists;
    } else {
      user = await User.create({
        name,
        email,
        passwordHash,
        role: 'student',
        pendingVerification: true,
      });
    }

    await issueVerificationCode(user);
    startVerification(req, res, email, `We sent a 6-digit code to ${email}.`);
  } catch (err) {
    console.error(err);
    res.render('auth', { activeForm: 'register', error: 'Registration failed. Please try again.', success: '' });
  }
});

// ---------- Email verification ----------

router.get('/verify', redirectIfLoggedIn, (req, res) => {
  const email = req.session.verifyEmail;
  if (!email) return res.redirect('/login');

  const notice = req.session.verifyNotice || '';
  delete req.session.verifyNotice;
  res.render('verify', { email, error: '', success: notice });
});

router.post('/verify', redirectIfLoggedIn, async (req, res) => {
  try {
    const email = req.session.verifyEmail;
    if (!email) return res.redirect('/login');

    const fail = (msg) => res.render('verify', { email, error: msg, success: '' });
    const code = (req.body.code || '').replace(/\s/g, '');

    if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from your email.');

    // Count this attempt first, so guesses can't be made in parallel
    const user = await User.findOneAndUpdate(
      { email, pendingVerification: true },
      { $inc: { verifyAttempts: 1 } },
      { new: true }
    );
    if (!user) return res.redirect('/login');

    if (user.verifyAttempts > MAX_CODE_ATTEMPTS) {
      return fail('Too many wrong attempts. Send a new code and try again.');
    }
    if (!user.verifyCodeHash || !user.verifyCodeExpires || user.verifyCodeExpires < new Date()) {
      return fail('This code has expired. Send a new one.');
    }
    if (hashCode(user._id, code) !== user.verifyCodeHash) {
      return fail('That code is not correct.');
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: { pendingVerification: false },
        $unset: { verifyCodeHash: '', verifyCodeExpires: '', verifyAttempts: '', verifyLastSentAt: '' },
      }
    );

    sendWelcomeEmail({ to: user.email, name: user.name });

    // Verified: sign them in right away
    delete req.session.verifyEmail;
    req.session.userId = user._id.toString();
    req.session.userName = user.name;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.save(() => res.redirect('/dashboard'));
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

router.post('/verify/resend', redirectIfLoggedIn, async (req, res) => {
  try {
    const email = req.session.verifyEmail;
    if (!email) return res.redirect('/login');

    const user = await User.findOne({ email, pendingVerification: true });
    if (!user) return res.redirect('/login');

    const wait = user.verifyLastSentAt
      ? RESEND_COOLDOWN_MS - (Date.now() - user.verifyLastSentAt.getTime())
      : 0;
    if (wait > 0) {
      return res.render('verify', {
        email,
        error: `Wait ${Math.ceil(wait / 1000)} seconds before asking for another code.`,
        success: '',
      });
    }

    await issueVerificationCode(user);
    res.render('verify', { email, error: '', success: 'A new code was sent.' });
  } catch (err) {
    console.error(err);
    res.redirect('/login');
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

    // Following the emailed link proves they own the address, so this also verifies the account
    await User.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash, pendingVerification: false },
        $unset: {
          resetPasswordToken: '',
          resetPasswordExpires: '',
          verifyCodeHash: '',
          verifyCodeExpires: '',
          verifyAttempts: '',
          verifyLastSentAt: '',
        },
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