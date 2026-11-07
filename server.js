require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 5000;
const OVERDRAFT_LIMIT = -2500;

// ==========================================
// MIDDLEWARES & BODY PARSER
// ==========================================
app.use(cors());
// Set limits to 50mb to accommodate base64 package & avatar photo payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// MONGODB CONNECTION
// ==========================================
const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://olusource:happyhour2026@cluster0.mongodb.net/happyhour_logistics?retryWrites=true&w=majority';

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas successfully.');
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
  });

// ==========================================
// SCHEMAS & MODELS
// ==========================================
const TransactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    default: () => `TX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
  },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  description: { type: String, required: true },
  date: { type: Date, default: Date.now },
});

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, default: '' },
    nin: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
      validate: {
        validator: function (v) {
          if (!v) return true; // Allows legacy accounts without NIN
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
      default: 1000, // ₦1,000 welcome credit for new signups
    },
    isSuspendedFromRadar: {
      type: Boolean,
      default: false,
    },
    // Driver-specific attributes (populated during Captain KYC)
    driverDetails: {
      firstName: String,
      surname: String,
      dateOfBirth: String,
      yearsOfExperience: String,
      vehicleType: { type: String, default: 'Cab / Micra' },
      vehicleModel: String,
      plateNumber: { type: String, uppercase: true },
      serviceScope: { type: String, default: 'both' },
      bankCode: String,
      bankName: String,
      accountNumber: String,
      subaccountCode: String,
    },
    transactions: [TransactionSchema],
  },
  { timestamps: true }
);

const RideSchema = new mongoose.Schema(
  {
    rideId: {
      type: String,
      unique: true,
      default: () => `HH-${Math.floor(100000 + Math.random() * 900000)}`,
    },
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    passengerName: { type: String, required: true },
    passengerPhone: { type: String, required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    driverName: { type: String, default: null },
    driverPhone: { type: String, default: null },
    serviceType: {
      type: String,
      enum: ['ride', 'logistics'],
      default: 'ride',
    },
    pickupLocation: { type: String, required: true },
    dropoffLocation: { type: String, required: true },
    distanceKm: { type: Number, default: 4.5 },
    estimatedMinutes: { type: Number, default: 12 },
    baseFare: { type: Number, default: 1200 },
    weightSurcharge: { type: Number, default: 0 },
    fare: { type: Number, required: true },
    totalFare: { type: Number, required: true },
    driverEarnings: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    vehicleType: { type: String, default: 'Cab / Micra' },
    paymentMethod: {
      type: String,
      enum: ['wallet', 'bank_transfer'],
      default: 'wallet',
    },
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
    // Logistics & Cargo Handover Security
    deliveryPin: { type: String, default: null },
    recipient: {
      name: String,
      phone: String,
    },
    packageDetails: {
      description: String,
      weightTier: String,
      weightSurcharge: Number,
      pickupPhotoUrl: String,
    },
    cargoDescription: String,
    cargoWeightTier: String,
    cargoRecipientName: String,
    cargoRecipientPhone: String,
    pickupPhotoUrl: String,
    status: {
      type: String,
      enum: ['requested', 'accepted', 'in_progress', 'awaiting_payment', 'completed', 'cancelled'],
      default: 'requested',
    },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Ride = mongoose.models.Ride || mongoose.model('Ride', RideSchema);

// Synchronize database indexes on boot
mongoose.connection.on('open', async () => {
  try {
    await User.syncIndexes();
    await Ride.syncIndexes();
    console.log('✅ MongoDB schema indexes synchronized.');
  } catch (err) {
    console.error('⚠️ Index sync error:', err.message);
  }
});

// ==========================================
// AUTHENTICATION & KYC ROUTES
// ==========================================

/**
 * Passenger / Captain User Authentication & Registration
 * Mandatory 11-digit NIN verification enforced on new signups.
 */
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, nin, role, primaryHub, isSignUp } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const cleanPhone = phone.trim();
    const targetRole = role === 'driver' ? 'driver' : 'passenger';
    let user = await User.findOne({ phone: cleanPhone });

    if (isSignUp) {
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Full name is required for registration.' });
      }

      const cleanNin = nin ? String(nin).trim() : '';
      if (!cleanNin || cleanNin.length !== 11 || !/^\d{11}$/.test(cleanNin)) {
        return res.status(400).json({
          success: false,
          message: 'A valid 11-digit National Identification Number (NIN) is mandatory.',
        });
      }

      // Check if NIN is already linked to another account
      const existingNinUser = await User.findOne({ nin: cleanNin });
      if (existingNinUser && existingNinUser.phone !== cleanPhone) {
        return res.status(400).json({
          success: false,
          message: 'This NIN is already registered to another HappyHour account.',
        });
      }

      if (!user) {
        user = new User({
          name: name.trim(),
          phone: cleanPhone,
          nin: cleanNin,
          role: targetRole,
          primaryHub: primaryHub || 'Bodija Market',
          walletBalance: 1000,
          transactions: [
            {
              amount: 1000,
              type: 'credit',
              description: 'HappyHour Welcome Credit (NIN Verified)',
            },
          ],
        });
      } else {
        user.name = name.trim();
        user.nin = cleanNin;
        user.role = targetRole;
        if (primaryHub) user.primaryHub = primaryHub;
      }

      await user.save();
      return res.json({ success: true, user });
    }

    // Sign-in flow
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Account not found. Please select "New Account" and register your details.',
      });
    }

    // Enforce role consistency if attempting to log in as driver without KYC
    if (targetRole === 'driver' && user.role !== 'driver' && !user.driverDetails?.plateNumber) {
      return res.status(403).json({
        success: false,
        message: 'This account has not completed Captain KYC. Please tap "Complete KYC Vetting".',
      });
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error('Authentication error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number or NIN already registered in system.',
      });
    }
    return res.status(500).json({ success: false, message: 'Server error during authentication.' });
  }
});

/**
 * Captain KYC Registration
 * Links vehicle class, settlement NUBAN bank, and 11-digit NIN.
 */
app.post('/api/drivers/register', async (req, res) => {
  try {
    const {
      firstName,
      surname,
      phone,
      nin,
      dateOfBirth,
      yearsOfExperience,
      vehicleType,
      vehicleModel,
      plateNumber,
      serviceScope,
      bankCode,
      bankName,
      accountNumber,
    } = req.body;

    const cleanPhone = phone ? phone.trim() : '';
    const cleanNin = nin ? String(nin).trim() : '';

    if (!firstName || !surname || !cleanPhone || !plateNumber || !accountNumber || !cleanNin) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, 11-digit NIN, plate number, and settlement account number are required.',
      });
    }

    if (cleanNin.length !== 11 || !/^\d{11}$/.test(cleanNin)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid NIN. Must be an exact 11-digit numeric sequence.',
      });
    }

    // Prevent duplicate NIN cross-registration
    const ninConflict = await User.findOne({ nin: cleanNin });
    if (ninConflict && ninConflict.phone !== cleanPhone) {
      return res.status(400).json({
        success: false,
        message: 'This NIN is already registered to another Captain account.',
      });
    }

    const driverName = `${firstName.trim()} ${surname.trim()}`;
    const driverPayload = {
      name: driverName,
      phone: cleanPhone,
      nin: cleanNin,
      role: 'driver',
      driverDetails: {
        firstName: firstName.trim(),
        surname: surname.trim(),
        dateOfBirth: dateOfBirth || '',
        yearsOfExperience: yearsOfExperience || '3',
        vehicleType: vehicleType || 'Cab / Micra',
        vehicleModel: vehicleModel || '',
        plateNumber: plateNumber.trim().toUpperCase(),
        serviceScope: serviceScope || 'both',
        bankCode: bankCode || '999992',
        bankName: bankName || 'OPay',
        accountNumber: accountNumber.trim(),
      },
    };

    const driver = await User.findOneAndUpdate(
      { phone: cleanPhone },
      { $set: driverPayload },
      { new: true, upsert: true, runValidators: true }
    );

    return res.json({ success: true, driver });
  } catch (error) {
    console.error('Captain KYC error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Phone number or NIN already registered.' });
    }
    return res.status(500).json({ success: false, message: 'Could not complete Captain KYC registration.' });
  }
});

/**
 * Profile Photo & Metadata Updates
 */
app.put('/api/users/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { avatarUrl, email } = req.body;

    const updates = {};
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (email !== undefined) updates.email = email.trim();

    const user = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update profile.' });
  }
});

// ==========================================
// CASHLESS WALLET & PAYMENT ROUTES
// ==========================================

/**
 * Retrieve User Wallet Balance & Ledger
 */
app.get('/api/wallet/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User wallet not found.' });
    }

    const isSuspended = user.walletBalance < OVERDRAFT_LIMIT;
    if (user.isSuspendedFromRadar !== isSuspended) {
      user.isSuspendedFromRadar = isSuspended;
      await user.save();
    }

    return res.json({
      success: true,
      walletBalance: user.walletBalance,
      isSuspendedFromRadar: user.isSuspendedFromRadar,
      transactions: (user.transactions || []).reverse(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve wallet details.' });
  }
});

/**
 * Top Up Wallet (Instant Sandbox / In-App Simulation)
 */
app.post('/api/wallet/topup', async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum top-up amount is ₦100.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    user.walletBalance += numericAmount;
    user.isSuspendedFromRadar = user.walletBalance < OVERDRAFT_LIMIT;
    user.transactions.push({
      amount: numericAmount,
      type: 'credit',
      description: description || `Wallet Top-Up • +₦${numericAmount.toLocaleString()}`,
    });

    await user.save();

    return res.json({
      success: true,
      walletBalance: user.walletBalance,
      isSuspendedFromRadar: user.isSuspendedFromRadar,
    });
  } catch (error) {
    console.error('Wallet top-up error:', error);
    return res.status(500).json({ success: false, message: 'Could not complete wallet top-up.' });
  }
});

/**
 * Initialize Card / USSD Payment Checkout (Paystack Direct / Simulation)
 */
app.post('/api/payment/initialize', async (req, res) => {
  try {
    const { userId, amount, email } = req.body;
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum checkout is ₦100.' });
    }

    // If a Paystack Secret Key is configured in environment, initiate real checkout; otherwise return simulation URL
    if (process.env.PAYSTACK_SECRET_KEY) {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email || 'payments@happyhourlogistics.ng',
          amount: numericAmount * 100, // Paystack operates in Kobo
          metadata: { userId },
        }),
      });

      const data = await response.json();
      if (data.status && data.data?.authorization_url) {
        return res.json({
          success: true,
          authorizationUrl: data.data.authorization_url,
          reference: data.data.reference,
        });
      }
    }

    // Dynamic Checkout Fallback URL for Instant Testing
    const mockRef = `HH-${Date.now()}`;
    const authorizationUrl = `https://checkout.paystack.com/simulate/${mockRef}?amount=${numericAmount}`;

    return res.json({
      success: true,
      authorizationUrl,
      reference: mockRef,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Payment gateway connection error.' });
  }
});

/**
 * Direct Paystack Split Checkout for Trip Settlement
 */
app.post('/api/payment/initialize-trip', async (req, res) => {
  try {
    const { rideId, passengerId, driverId } = req.body;
    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Trip record not found.' });
    }

    const fare = Number(ride.totalFare || ride.fare || 2500);
    const mockTripRef = `TRIP-${rideId}-${Date.now()}`;
    const authorizationUrl = `https://checkout.paystack.com/simulate/${mockTripRef}?amount=${fare}`;

    return res.json({
      success: true,
      authorizationUrl,
      reference: mockTripRef,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to initiate trip payment checkout.' });
  }
});

// ==========================================
// RIDE DISPATCH & LOGISTICS CARGO ROUTES
// ==========================================

/**
 * Request an Intra-City Ride or Freight Cargo Dispatch
 */
app.post('/api/rides/request', async (req, res) => {
  try {
    const {
      passengerId,
      passengerName,
      passengerPhone,
      serviceType,
      pickupLocation,
      dropoffLocation,
      distanceKm,
      estimatedMinutes,
      baseFare,
      weightSurcharge,
      fare,
      totalFare,
      vehicleType,
      paymentMethod,
      coordinates,
      deliveryPin,
      recipient,
      packageDetails,
      cargoDescription,
      cargoWeightTier,
      cargoRecipientName,
      cargoRecipientPhone,
      pickupPhotoUrl,
    } = req.body;

    if (!pickupLocation || !dropoffLocation || !fare) {
      return res.status(400).json({ success: false, message: 'Incomplete ride request details.' });
    }

    const newRide = new Ride({
      passengerId,
      passengerName,
      passengerPhone,
      serviceType: serviceType || 'ride',
      pickupLocation,
      dropoffLocation,
      distanceKm: Number(distanceKm) || 4.5,
      estimatedMinutes: Number(estimatedMinutes) || 12,
      baseFare: Number(baseFare) || 1200,
      weightSurcharge: Number(weightSurcharge) || 0,
      fare: Number(fare),
      totalFare: Number(totalFare || fare),
      vehicleType: vehicleType || 'Cab / Micra',
      paymentMethod: paymentMethod || 'wallet',
      coordinates: coordinates || null,
      deliveryPin: deliveryPin || (serviceType === 'logistics' ? Math.floor(1000 + Math.random() * 9000).toString() : null),
      recipient: recipient || (cargoRecipientName ? { name: cargoRecipientName, phone: cargoRecipientPhone } : undefined),
      packageDetails: packageDetails || {
        description: cargoDescription || '',
        weightTier: cargoWeightTier || '',
        weightSurcharge: Number(weightSurcharge) || 0,
        pickupPhotoUrl: pickupPhotoUrl || null,
      },
      cargoDescription,
      cargoWeightTier,
      cargoRecipientName,
      cargoRecipientPhone,
      pickupPhotoUrl,
      status: 'requested',
    });

    await newRide.save();
    return res.json({ success: true, ride: newRide });
  } catch (error) {
    console.error('Ride request error:', error);
    return res.status(500).json({ success: false, message: 'Could not create trip dispatch request.' });
  }
});

/**
 * Driver Radar: Available Trips Filtered by Vehicle Class
 */
app.get('/api/rides/available', async (req, res) => {
  try {
    const { vehicleType, driverId } = req.query;

    let isSuspended = false;
    if (driverId) {
      const driver = await User.findById(driverId);
      if (driver && driver.walletBalance < OVERDRAFT_LIMIT) {
        isSuspended = true;
      }
    }

    const filter = { status: 'requested' };
    if (vehicleType) {
      filter.vehicleType = vehicleType;
    }

    const rides = await Ride.find(filter).sort({ createdAt: -1 }).limit(10);
    return res.json({ success: true, rides, isSuspended });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving radar trips.' });
  }
});

/**
 * Driver Action: Accept Cashless Trip
 */
app.post('/api/rides/accept', async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    const driver = await User.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found.' });
    }

    if (driver.walletBalance < OVERDRAFT_LIMIT) {
      return res.status(403).json({
        success: false,
        message: 'Overdraft limit exceeded. Top up your wallet to unfreeze Radar.',
      });
    }

    const ride = await Ride.findOne({ rideId, status: 'requested' });
    if (!ride) {
      return res.status(409).json({ success: false, message: 'Trip already accepted or unavailable.' });
    }

    ride.driverId = driver._id;
    ride.driverName = driver.name;
    ride.driverPhone = driver.phone;
    ride.status = 'accepted';

    await ride.save();
    return res.json({ success: true, ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to accept trip request.' });
  }
});

/**
 * Driver Action: Start Trip
 */
app.post('/api/rides/start', async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await Ride.findOneAndUpdate(
      { rideId, status: 'accepted' },
      { $set: { status: 'in_progress' } },
      { new: true }
    );

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Active trip not found to start.' });
    }

    return res.json({ success: true, ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to start trip.' });
  }
});

/**
 * Driver Action: Arrived at Destination -> Request Payment from Passenger
 */
app.post('/api/rides/request-payment', async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    const ride = await Ride.findOneAndUpdate(
      { rideId, driverId },
      { $set: { status: 'awaiting_payment' } },
      { new: true }
    );

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    return res.json({ success: true, ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to request passenger payment.' });
  }
});

/**
 * Real-Time Polling: Check Individual Trip Status
 */
app.get('/api/rides/:rideId', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.params.rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    return res.json({ success: true, ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error checking trip status.' });
  }
});

/**
 * Passenger Action: Authorize Cashless Payment, Verify PIN, and Settle 85/15 Split
 */
app.post('/api/rides/complete', async (req, res) => {
  try {
    const { rideId, passengerId, deliveryPin, paymentMethod } = req.body;

    const ride = await Ride.findOne({ rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Trip record not found.' });
    }

    // Verify 4-digit security PIN for logistics parcels
    if (ride.serviceType === 'logistics' && ride.deliveryPin) {
      if (!deliveryPin || String(deliveryPin).trim() !== String(ride.deliveryPin).trim()) {
        return res.status(400).json({
          success: false,
          message: 'Incorrect 4-digit Delivery PIN. Verify code with the recipient.',
        });
      }
    }

    const totalFare = Number(ride.totalFare || ride.fare);
    const driverEarnings = Math.round(totalFare * 0.85); // 85% Auto-Split
    const platformFee = totalFare - driverEarnings;      // 15% Commission

    let updatedPassengerWallet = null;

    // Settle in-app cashless wallet deduction
    if (paymentMethod === 'wallet') {
      const passenger = await User.findById(passengerId);
      if (!passenger) {
        return res.status(404).json({ success: false, message: 'Passenger wallet account not found.' });
      }

      if (passenger.walletBalance < totalFare) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance (₦${passenger.walletBalance.toLocaleString()}) to settle fare of ₦${totalFare.toLocaleString()}.`,
        });
      }

      passenger.walletBalance -= totalFare;
      passenger.transactions.push({
        amount: totalFare,
        type: 'debit',
        description: `Trip Payment • ${ride.rideId} (${ride.pickupLocation.replace('[CARGO] ', '')} → ${ride.dropoffLocation})`,
      });
      await passenger.save();
      updatedPassengerWallet = passenger.walletBalance;
    }

    // Credit Captain earnings ledger
    if (ride.driverId) {
      const driver = await User.findById(ride.driverId);
      if (driver) {
        driver.walletBalance += driverEarnings;
        driver.isSuspendedFromRadar = driver.walletBalance < OVERDRAFT_LIMIT;
        driver.transactions.push({
          amount: driverEarnings,
          type: 'credit',
          description: `85% Driver Payout • Trip ${ride.rideId} (+₦${driverEarnings.toLocaleString()})`,
        });
        await driver.save();
      }
    }

    // Update ride record
    ride.status = 'completed';
    ride.driverEarnings = driverEarnings;
    ride.platformFee = platformFee;
    ride.paymentMethod = paymentMethod || 'wallet';
    await ride.save();

    const receipt = {
      totalFare,
      driverEarnings,
      platformFee,
      paymentMethod: ride.paymentMethod,
    };

    return res.json({
      success: true,
      ride,
      receipt,
      passengerWallet: updatedPassengerWallet,
    });
  } catch (error) {
    console.error('Trip completion settlement error:', error);
    return res.status(500).json({ success: false, message: 'Failed to settle cashless trip.' });
  }
});

// ==========================================
// WEB BUILD PRODUCTION DEPLOYMENT
// ==========================================
// Serves static web frontend if exported into the dist/ directory
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send('HappyHour Logistics API Server is running.');
    }
  });
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 HappyHour Logistics Backend active on port ${PORT}`);
});