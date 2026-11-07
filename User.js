const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    nin: {
      type: String,
      trim: true,
      unique: true,   // Prevents duplicate NINs across different accounts
      sparse: true,   // Allows null/missing values for legacy users without collision
      validate: {
        validator: function (v) {
          if (!v) return true; // Allows accounts without NIN to validate
          return /^\d{11}$/.test(v);
        },
        message: 'NIN must be an exact 11-digit numeric string',
      },
    },
    role: {
      type: String,
      enum: ['passenger', 'driver', 'admin'],
      default: 'passenger',
    },
    primaryHub: {
      type: String,
      default: 'Bodija Market',
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    walletBalance: {
      type: Number,
      default: 1000,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);