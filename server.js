const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();

// ==========================================
// 1. RAW BODY PARSER & MIDDLEWARE
// ==========================================
app.use(cors({ origin: '*' }));

app.use(
  express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // Preserves raw buffer for Paystack HMAC verification
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
// 3. SCHEMAS & MODELS
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
    avatarUrl: { type: String, default: null },
    gender: { type: String, default: 'Male' },
    accountTier: { type: String, default: 'Tier 1' },

    walletBalance: { type: Number, default: 1000 },
    isSuspendedFromRadar: { type: Boolean, default: false },
    transactions: [TransactionSchema],

    driverDetails: {
      firstName: String,
      surname: String,
      dateOfBirth: String,
      yearsOfExperience: String,
      vehicleType: { type: String, default: 'Cab / Micra' },
      vehicleModel: String,
      plateNumber: String,
      serviceScope: { type: String, default: 'both' },
      bankName: String,
      bankCode: String,
      accountNumber: String,
      accountName: String,
      paystackSubaccountCode: String,
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
    paymentMethod: { type: String, default: 'wallet' },
    paymentStatus: { type: String, default: 'pending' },
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
// 4. API ROUTES
// ==========================================

// Dedicated Backend Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', service: 'HappyHour Logistics Cashless API', timestamp: new Date().toISOString() });
});

// Role-Isolated Auth
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, email, role, primaryHub, isSignUp } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const cleanPhone = phone.trim();
    const targetRole = role || 'passenger';

    let user = await User.findOne({ phone: cleanPhone, role: targetRole });

    if (!user) {
      if (targetRole === 'driver') {
        return res.status(404).json({
          success: false,
          message: 'No verified Captain account found for this number. Please complete KYC registration.',
        });
      }

      user = new User({
        name: name ? name.trim() : 'Passenger',
        phone: cleanPhone,
        email: email ? email.trim().toLowerCase() : '',
        role: 'passenger',
        accountTier: 'Tier 1',
        primaryHub: primaryHub || 'Bodija Market',
        walletBalance: 1000,
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

// Driver KYC with Automated Paystack Subaccount Creation
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
      plateNumber,
      serviceScope,
      bankCode,
      bankName,
      accountNumber,
    } = req.body;

    const cleanPhone = phone.trim();
    const fullName = `${firstName} ${surname}`.trim();
    let subaccountCode = null;

    if (bankCode && accountNumber && process.env.PAYSTACK_SECRET_KEY) {
      try {
        const subRes = await fetch('https://api.paystack.co/subaccount', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            business_name: `${fullName} (HappyHour Captain)`,
            settlement_bank: bankCode,
            account_number: accountNumber.trim(),
            percentage_charge: 15,
            description: `Automated 85% payout subaccount for Captain ${fullName}`,
          }),
        });

        const subData = await subRes.json();
        if (subData.status && subData.data?.subaccount_code) {
          subaccountCode = subData.data.subaccount_code;
          console.log(`✅ [PAYSTACK SUBACCOUNT] Created: ${subaccountCode} for ${fullName}`);
        }
      } catch (subErr) {
        console.warn('⚠️ Paystack subaccount deferred:', subErr.message);
      }
    }

    let driver = await User.findOne({ phone: cleanPhone, role: 'driver' });
    const driverDetails = {
      firstName,
      surname,
      dateOfBirth,
      yearsOfExperience,
      vehicleType,
      vehicleModel,
      plateNumber,
      serviceScope,
      bankCode,
      bankName,
      accountNumber,
      paystackSubaccountCode: subaccountCode,
    };

    if (!driver) {
      driver = new User({
        name: fullName,
        phone: cleanPhone,
        email: email || '',
        role: 'driver',
        accountTier: 'Tier 3',
        walletBalance: 1000,
        driverDetails,
      });
    } else {
      driver.name = fullName;
      driver.accountTier = 'Tier 3';
      driver.driverDetails = driverDetails;
    }

    await driver.save();
    res.json({ success: true, driver });
  } catch (error) {
    console.error('KYC Registration Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Profile
app.put('/api/users/profile/:userId', async (req, res) => {
  try {
    const { avatarUrl, email, gender, name } = req.body;
    const user = await User.findById(req.params.userId);

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    if (email !== undefined) user.email = email.trim().toLowerCase();
    if (gender !== undefined) user.gender = gender;
    if (name !== undefined) user.name = name.trim();

    await user.save();
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Wallet Balance & History
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

// Sandbox Wallet Top-Up
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
      description: description || 'Cashless Wallet Top-Up',
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

      const targetUser = await User.findOne({
        phone: { $regex: new RegExp(last10Digits + '$') },
      });

      if (!targetUser) return;

      const alreadyCredited = targetUser.transactions?.some((tx) => tx.transactionId === reference);
      if (alreadyCredited) return;

      const newBalance = (targetUser.walletBalance || 0) + transferAmountNaira;
      const isNowActive = newBalance >= -2500;

      targetUser.transactions.push({
        transactionId: reference,
        type: 'credit',
        amount: transferAmountNaira,
        description: `Cashless DVA Deposit • ${data.authorization?.bank || 'Bank Transfer'}`,
        balanceAfter: newBalance,
        date: new Date(data.paid_at || Date.now()),
      });

      targetUser.walletBalance = newBalance;
      targetUser.isSuspendedFromRadar = !isNowActive;
      await targetUser.save();
      console.log(`✅ [PAYSTACK DVA] Credited ${targetUser.name} with ₦${transferAmountNaira}`);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

// Rides Engine
app.post('/api/rides/request', async (req, res) => {
  try {
    const payload = req.body;
    const generatedRideId = `HH-${Math.floor(100000 + Math.random() * 900000)}`;

    const newRide = new Ride({
      ...payload,
      rideId: payload.rideId || generatedRideId,
      status: 'pending',
      paymentMethod: payload.paymentMethod || 'wallet',
      paymentStatus: 'pending',
    });

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

// Conclude Trip: 85% Driver / 15% Platform Fee
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

    const finalFare = Number(ride.totalFare || ride.fare || 2500);
    const driverEarnings = Math.round(finalFare * 0.85);
    const platformFee = Math.round(finalFare * 0.15);

    const driver = await User.findById(ride.driverId);
    const passenger = await User.findById(ride.passengerId);

    if (ride.paymentMethod === 'wallet') {
      if (!passenger || passenger.walletBalance < finalFare) {
        return res.status(400).json({
          success: false,
          message: 'Passenger wallet balance insufficient. Please top up or pay via direct bank transfer.',
        });
      }

      passenger.walletBalance -= finalFare;
      passenger.transactions.push({
        transactionId: `PAY-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        type: 'debit',
        amount: finalFare,
        description: `Payment for Trip ${ride.rideId} (100% Cashless)`,
        balanceAfter: passenger.walletBalance,
        date: new Date(),
      });
      await passenger.save();

      if (driver) {
        driver.walletBalance = (driver.walletBalance || 0) + driverEarnings;
        driver.transactions.push({
          transactionId: `EARN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          type: 'credit',
          amount: driverEarnings,
          description: `85% Earnings for Trip ${ride.rideId} (₦${platformFee} Platform Fee)`,
          balanceAfter: driver.walletBalance,
          date: new Date(),
        });
        await driver.save();
      }

      ride.paymentStatus = 'settled';
    }

    ride.status = 'completed';
    ride.driverEarnings = driverEarnings;
    ride.platformFee = platformFee;
    await ride.save();

    res.json({
      success: true,
      ride,
      receipt: {
        totalFare: finalFare,
        driverEarnings,
        platformFee,
        paymentMethod: ride.paymentMethod || 'wallet',
      },
      driverWallet: driver ? driver.walletBalance : null,
      passengerWallet: passenger ? passenger.walletBalance : null,
    });
  } catch (error) {
    console.error('Complete Ride Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Paystack Direct Bank Transfer (Auto 85/15 Payout)
app.post('/api/payment/initialize-trip', async (req, res) => {
  try {
    const { rideId, passengerId, driverId } = req.body;
    const ride = await Ride.findOne({ rideId });
    const driver = await User.findById(driverId);
    const passenger = await User.findById(passengerId);

    if (!ride || !driver) {
      return res.status(404).json({ success: false, message: 'Invalid ride or driver details' });
    }

    const fare = Number(ride.totalFare || ride.fare);
    const reference = `HH_TRIP_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    const payload = {
      email: passenger?.email || `${passenger?.phone.replace(/[^0-9]/g, '')}@happyhourlogistics.ng`,
      amount: fare * 100,
      reference,
      currency: 'NGN',
      channels: ['bank_transfer', 'ussd', 'card'],
      metadata: {
        rideId: ride.rideId,
        passengerId: passenger?._id,
        driverId: driver._id,
        driverEarnings: Math.round(fare * 0.85),
        platformFee: Math.round(fare * 0.15),
      },
    };

    if (driver.driverDetails?.paystackSubaccountCode) {
      payload.subaccount = driver.driverDetails.paystackSubaccountCode;
      payload.transaction_charge = Math.round(fare * 0.15) * 100;
      payload.bearer = 'subaccount';
    }

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await paystackRes.json();
    if (data.status && data.data) {
      res.json({
        success: true,
        authorizationUrl: data.data.authorization_url,
        reference,
      });
    } else {
      res.status(400).json({ success: false, message: data.message || 'Payment initiation failed' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Standard Wallet Top-Up Checkout
app.post('/api/payment/initialize', async (req, res) => {
  try {
    const { userId, amount, email, channelType } = req.body;
    const topupAmount = Number(amount);

    if (!topupAmount || topupAmount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum transaction amount is ₦100.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const reference = `HH_PAY_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const userEmail = email || user.email || `${user.phone.replace(/[^0-9]/g, '')}@happyhourlogistics.ng`;

    const channels = channelType ? [channelType] : ['card', 'bank', 'ussd', 'bank_transfer'];

    const paystackPayload = JSON.stringify({
      email: userEmail,
      amount: topupAmount * 100,
      reference,
      currency: 'NGN',
      channels,
      metadata: {
        userId: user._id.toString(),
        userName: user.name,
        userRole: user.role,
        purpose: 'wallet_topup',
      },
    });

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: paystackPayload,
    });

    const data = await response.json();

    if (data.status && data.data) {
      res.json({
        success: true,
        authorizationUrl: data.data.authorization_url,
        reference,
      });
    } else {
      res.status(400).json({ success: false, message: data.message || 'Unable to initialize checkout.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 5. STATIC WEB BUNDLE SERVING (EXPO WEB SPA)
// ==========================================
// Serve all compiled files from the Expo dist folder
app.use(express.static(path.join(__dirname, 'dist')));

// SPA Fallback: Express 5 safe catch-all
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ==========================================
// 6. ERROR GUARD & SERVER LISTENER
// ==========================================
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Payload exceeds upload limit.' });
  }
  console.error('Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 HappyHour Logistics Server & Web App running on port ${PORT}`);
});