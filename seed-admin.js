require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./models/User');

async function seedAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('Please set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD in your .env file.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`An account with ${email} already exists. Nothing changed.`);
  } else {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({ name: ADMIN_NAME, email, passwordHash, role: 'admin' });
    console.log(`Admin account created for ${email}`);
  }

  await mongoose.disconnect();
}

seedAdmin().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});