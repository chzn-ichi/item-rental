const Rental = require('../models/Rental');
const { sendDueSoonEmail, sendOverdueEmail } = require('./mailer');

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check once an hour

async function runReminderCheck() {
  const now = new Date();
  const soon = new Date(now.getTime() + DAY_MS);

  // 1) Due within the next 24 hours, not reminded yet
  const dueSoon = await Rental.find({
    status: 'approved',
    dueDate: { $gt: now, $lte: soon },
    dueSoonNotified: { $ne: true },
  }).populate('user', 'name email');

  for (const rental of dueSoon) {
    // Claim it first, so two running servers can't both send the same email
    const claimed = await Rental.findOneAndUpdate(
      { _id: rental._id, dueSoonNotified: { $ne: true } },
      { dueSoonNotified: true }
    );
    if (claimed && rental.user) {
      await sendDueSoonEmail({
        to: rental.user.email,
        name: rental.user.name,
        itemName: rental.itemName,
        itemCode: rental.itemCode,
        dueDate: rental.dueDate,
      });
    }
  }

  // 2) Already past the due date, not notified yet
  const overdue = await Rental.find({
    status: 'approved',
    dueDate: { $lt: now },
    overdueNotified: { $ne: true },
  }).populate('user', 'name email');

  for (const rental of overdue) {
    const claimed = await Rental.findOneAndUpdate(
      { _id: rental._id, overdueNotified: { $ne: true } },
      { overdueNotified: true }
    );
    if (claimed && rental.user) {
      await sendOverdueEmail({
        to: rental.user.email,
        name: rental.user.name,
        itemName: rental.itemName,
        itemCode: rental.itemCode,
        dueDate: rental.dueDate,
      });
    }
  }
}

function startReminderJob() {
  if (process.env.ENABLE_REMINDERS !== 'true') {
    console.log('Email reminders are off (set ENABLE_REMINDERS=true to turn them on).');
    return;
  }

  const run = () =>
    runReminderCheck().catch((err) => console.error('Reminder check failed:', err.message));

  run();
  setInterval(run, CHECK_INTERVAL_MS);
  console.log('Email reminders are on (checked hourly).');
}

module.exports = { startReminderJob, runReminderCheck };