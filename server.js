const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// ==========================================
// 1. RAW BODY PARSER FOR PAYSTACK WEBHOOK
// ==========================================
app.use(cors({ origin: '*' }));

app.use(
  express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // Preserves raw buffer for HMAC verification
    },
  })
);
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ==========================================
// 2. MONGODB ATLAS CONNECTION
// ==========================================
const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb+srv://admin:happyhour2026@cluster0.mongodb.net/happyhour?retryWrites=true&w=majority';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas Cluster'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// 3. SCHEMAS & MODELS (WITH OPAY-STYLE PROFILE)
// ==========================================
const TransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  balanceAfter: { type: Number, required: true },
  date: { type: Date, default: Date.now },
});

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: '' },
    role: { type: String, enum: ['passenger', 'driver'], default: 'passenger' },
    primaryHub: { type: String, default: 'Bodija Market' },
    
    // OPay-Style Profile Attributes
    avatarUrl: { type: String, default: null },
    gender: { type: String, default: 'Male' },
    accountTier: { type: String, default: 'Tier 1' }, // Tier 1 (Passenger) or Tier 3 (Captain)

    // Commission Wallet & Overdraft Tracking
    walletBalance: { type: Number, default: 500 }, // ₦500 Welcome Bonus Credit
    isSuspendedFromRadar: { type: Boolean, default: false }, // Locked if balance < -₦2,500
    transactions: [TransactionSchema],

    driverDetails: {
      firstName: String,
      surname: String,
      dateOfBirth: String,
      yearsOfExperience: String,
      vehicleType: { type: String, default: 'Cab / Micra' },
      vehicleModel: String,
      vehicleYear: String,
      plateNumber: String,
      serviceScope: { type: String, default: 'both' },
    },
  },
  { timestamps: true }
);

const RideSchema = new mongoose.Schema(
  {
    rideId: { type: String, required: true, unique: true },
    passengerId: String,
    passengerName: String,
    passengerPhone: String,
    serviceType: { type: String, default: 'ride' },
    pickupLocation: String,
    dropoffLocation: String,
    distanceKm: Number,
    estimatedMinutes: Number,
    fare: Number,
    totalFare: Number,
    baseFare: Number,
    weightSurcharge: Number,
    vehicleType: String,
    coordinates: Object,
    driverId: String,
    driverName: String,
    status: { type: String, default: 'pending' },
    deliveryPin: String,
    recipient: { name: String, phone: String },
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
    driverEarnings: Number,
    platformFee: Number,
  },
  { timestamps: true, strict: false }
);

const User = mongoose.model('User', UserSchema);
const Ride = mongoose.model('Ride', RideSchema);

// ==========================================
// 4. AUTH & PROFILE MANAGEMENT ENDPOINTS
// ==========================================

// Health Check
app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'HappyHour API', timestamp: new Date().toISOString() });
});

// Role-Isolated Sign-Up / Sign-In
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, email, role, primaryHub, isSignUp } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const cleanPhone = phone.trim();
    const targetRole = role || 'passenger';

    // Query by BOTH phone and role to prevent role collision
    let user = await User.findOne({ phone: cleanPhone, role: targetRole });

    if (!user) {
      if (targetRole === 'driver') {
        return res.status(404).json({
          success: false,
          message: 'No verified Captain account found for this number. Please complete KYC registration.',
        });
      }

      // Create new Passenger
      user = new User({
        name: name ? name.trim() : 'Passenger',
        phone: cleanPhone,
        email: email ? email.trim().toLowerCase() : '',
        role: 'passenger',
        accountTier: 'Tier 1',
        primaryHub: primaryHub || 'Bodija Market',
        walletBalance: 500,
      });
      await user.save();
    } else {
      if (name && isSignUp) user.name = name.trim();
      if (email) user.email = email.trim().toLowerCase();
      if (primaryHub) user.primaryHub = primaryHub;
      await user.save();
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error('Auth Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Driver KYC Registration
app.post('/api/drivers/register', async (req, res) => {
  try {
    const {
      firstName,
      surname,
      phone,
      email,
      dateOfBirth,
      yearsOfExperience,
      vehicleType,
      vehicleModel,
      vehicleYear,
      plateNumber,
      serviceScope,
    } = req.body;

    const cleanPhone = phone.trim();
    const fullName = `${firstName} ${surname}`.trim();

    let driver = await User.findOne({ phone: cleanPhone, role: 'driver' });

    const driverDetails = {
      firstName,
      surname,
      dateOfBirth,
      yearsOfExperience,
      vehicleType,
      vehicleModel,
      vehicleYear,
      plateNumber,
      serviceScope,
    };

    if (!driver) {
      driver = new User({
        name: fullName,
        phone: cleanPhone,
        email: email ? email.trim().toLowerCase() : '',
        role: 'driver',
        accountTier: 'Tier 3',
        walletBalance: 500, // ₦500 Welcome bonus credit
        driverDetails,
      });
    } else {
      driver.name = fullName;
      driver.accountTier = 'Tier 3';
      if (email) driver.email = email.trim().toLowerCase();
      driver.driverDetails = driverDetails;
    }

    await driver.save();
    res.json({ success: true, driver });
  } catch (error) {
    console.error('KYC Registration Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Profile (Avatar, Email, Gender)
app.put('/api/users/profile/:userId', async (req, res) => {
  try {
    const { avatarUrl, email, gender, name } = req.body;
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    if (email !== undefined) user.email = email.trim().toLowerCase();
    if (gender !== undefined) user.gender = gender;
    if (name !== undefined) user.name = name.trim();

    await user.save();
    res.json({ success: true, user });
  } catch (error) {
    console.error('Profile Update Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 5. WALLET & PAYSTACK WEBHOOK
// ==========================================
app.get('/api/wallet/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({
      success: true,
      walletBalance: user.walletBalance || 0,
      isSuspendedFromRadar: Boolean(user.isSuspendedFromRadar),
      transactions: (user.transactions || []).reverse().slice(0, 30),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/wallet/topup', async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    const topupAmount = Number(amount);
    if (!topupAmount || topupAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const newBalance = (user.walletBalance || 0) + topupAmount;
    const isNowActive = newBalance >= -2500;

    const record = {
      transactionId: `TOP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      type: 'credit',
      amount: topupAmount,
      description: description || 'Driver Wallet Top-Up',
      balanceAfter: newBalance,
      date: new Date(),
    };

    user.walletBalance = newBalance;
    user.isSuspendedFromRadar = !isNowActive;
    user.transactions.push(record);
    await user.save();

    res.json({
      success: true,
      walletBalance: user.walletBalance,
      isSuspendedFromRadar: user.isSuspendedFromRadar,
      transaction: record,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Paystack DVA Webhook Handler
app.post('/api/webhooks/paystack', async (req, res) => {
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];

  if (!paystackSecret || !signature || !req.rawBody) {
    return res.status(401).send('Unauthorized webhook call');
  }

  const hash = crypto.createHmac('sha512', paystackSecret).update(req.rawBody).digest('hex');
  if (hash !== signature) {
    return res.status(401).send('Invalid signature');
  }

  res.status(200).send('Webhook acknowledged');

  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const data = event.data;
      const transferAmountNaira = data.amount / 100;
      const reference = data.reference;
      const customerPhone = data.customer?.phone;

      if (!customerPhone) return;
      const last10Digits = customerPhone.replace(/[^0-9]/g, '').slice(-10);

      const driver = await User.findOne({
        role: 'driver',
        phone: { $regex: new RegExp(last10Digits + '$') },
      });

      if (!driver) return;

      const alreadyCredited = driver.transactions?.some((tx) => tx.transactionId === reference);
      if (alreadyCredited) return;

      const newBalance = (driver.walletBalance || 0) + transferAmountNaira;
      const isNowActive = newBalance >= -2500;

      driver.transactions.push({
        transactionId: reference,
        type: 'credit',
        amount: transferAmountNaira,
        description: `Direct Bank Transfer (DVA) • ${data.authorization?.bank || 'Bank Deposit'}`,
        balanceAfter: newBalance,
        date: new Date(data.paid_at || Date.now()),
      });

      driver.walletBalance = newBalance;
      driver.isSuspendedFromRadar = !isNowActive;
      await driver.save();
      console.log(`✅ [PAYSTACK] Credited Captain ${driver.name} with ₦${transferAmountNaira}`);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

// ==========================================
// 6. RIDES & DISPATCH ENGINE
// ==========================================
app.post('/api/rides/request', async (req, res) => {
  try {
    const payload = req.body;
    const generatedRideId = `HH-${Math.floor(100000 + Math.random() * 900000)}`;
    const newRide = new Ride({ ...payload, rideId: payload.rideId || generatedRideId, status: 'pending' });
    await newRide.save();
    res.json({ success: true, ride: newRide });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/rides/available', async (req, res) => {
  try {
    const { vehicleType, driverId } = req.query;
    if (driverId) {
      const driver = await User.findById(driverId);
      if (driver && driver.isSuspendedFromRadar) {
        return res.json({ success: true, rides: [], isSuspended: true });
      }
    }
    let query = { status: 'pending' };
    if (vehicleType && vehicleType !== 'Fleet') query.vehicleType = vehicleType;
    const rides = await Ride.find(query).sort({ createdAt: -1 }).limit(25);
    res.json({ success: true, rides, isSuspended: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/rides/:rideId', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.params.rideId });
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
    res.json({ success: true, ride });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/rides/accept', async (req, res) => {
  try {
    const { rideId, driverId } = req.body;
    const driver = await User.findById(driverId);
    if (driver && driver.isSuspendedFromRadar) {
      return res.status(403).json({ success: false, message: 'Radar locked due to overdraft.' });
    }
    const ride = await Ride.findOne({ rideId });
    if (!ride || ride.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Ride already claimed or invalid.' });
    }
    ride.status = 'accepted';
    ride.driverId = driverId;
    ride.driverName = driver ? driver.name : 'Captain';
    await ride.save();
    res.json({ success: true, ride });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/rides/start', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.body.rideId });
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
    ride.status = 'in_progress';
    await ride.save();
    res.json({ success: true, ride });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/rides/complete', async (req, res) => {
  try {
    const { rideId, deliveryPin } = req.body;
    const ride = await Ride.findOne({ rideId });
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });

    if (ride.serviceType === 'logistics' && ride.deliveryPin) {
      if (!deliveryPin || deliveryPin.trim() !== ride.deliveryPin.trim()) {
        return res.status(400).json({ success: false, message: 'Invalid 4-digit Delivery PIN.' });
      }
    }

    const finalFare = Number(ride.totalFare || ride.fare || 3000);
    const driverEarnings = Math.round(finalFare * 0.85);
    const platformFee = Math.round(finalFare * 0.15);

    ride.status = 'completed';
    ride.driverEarnings = driverEarnings;
    ride.platformFee = platformFee;
    await ride.save();

    let updatedBalance = null;
    let isSuspended = false;

    if (ride.driverId) {
      const driver = await User.findById(ride.driverId);
      if (driver) {
        updatedBalance = (driver.walletBalance || 0) - platformFee;
        isSuspended = updatedBalance < -2500;

        driver.transactions.push({
          transactionId: `COMM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          type: 'debit',
          amount: platformFee,
          description: `15% Commission for Trip ${ride.rideId}`,
          balanceAfter: updatedBalance,
          date: new Date(),
        });

        driver.walletBalance = updatedBalance;
        driver.isSuspendedFromRadar = isSuspended;
        await driver.save();
      }
    }

    res.json({
      success: true,
      ride,
      wallet: { currentBalance: updatedBalance, isSuspendedFromRadar: isSuspended },
      receipt: {
        totalFare: finalFare,
        driverEarnings,
        platformFee,
        paymentMethod: 'Cash',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 HappyHour Logistics Server running on port ${PORT}`);
});