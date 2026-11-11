const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'student'], default: 'student' },

    // Password reset (the token is stored hashed, never in plain text)
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    pendingVerification: { type: Boolean, default: false },
    verifyCodeHash: { type: String },
    verifyCodeExpires: { type: Date },
    verifyAttempts: { type: Number, default: 0 },
    verifyLastSentAt: { type: Date },
  },
  { timestamps: true } // adds createdAt and updatedAt automatically
);

module.exports = mongoose.model('User', userSchema);