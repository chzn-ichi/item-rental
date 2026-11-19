const User = require('../models/User');
const { sendAdminAlertEmail } = require('./mailer');

// Emails every admin who turned alerts on. Never throws, so call it without await.
async function alertAdmins({ heading, message, details = [], path = '/admin/dashboard' }) {
  try {
    const admins = await User.find({ role: 'admin', adminAlerts: true }).select('name email');
    await Promise.all(
      admins.map((a) => sendAdminAlertEmail({ to: a.email, name: a.name, heading, message, details, path }))
    );
  } catch (err) {
    console.error('Could not send admin alert:', err.message);
  }
}

module.exports = { alertAdmins };