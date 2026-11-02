const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// ==========================================
// 1. BODY PARSERS (RAW BUFFER CAPTURE FOR PAYSTACK)
// ==========================================
app.use(cors({ origin: '*' }));

// Raw buffer capture ensures exact HMAC-SHA512 signature verification
app.use(
  express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
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
// 3. DATABASE SCHEMAS & MODELS
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
    email: { type: String },
    role: { type: String, default: 'passenger' }, // 'passenger' | 'driver'
    primaryHub: { type: String, default: 'Bodija Market' },

    // Commission Wallet & Overdraft Tracking
    walletBalance: { type: Number, default: 500 }, // ₦500 Welcome Bonus Credit
    isSuspendedFromRadar: { type: Boolean, default: false }, // Lockout threshold: -₦2,500
    transactions: [TransactionSchema],

    driverDetails: {
      firstName: String,
      surname: String,
      email: String,
      dateOfBirth: String,
      yearsOfExperience: String,
      vehicleType: String,
      vehicleModel: String,
      vehicleYear: String,
      plateNumber: String,
      serviceScope: String,
      dvaAccountNumber: String,
      dvaBankName: String,
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
    serviceType: { type: String, default: 'ride' }, // 'ride' | 'logistics'
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
    status: { type: String, default: 'pending' }, // 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled'
    deliveryPin: String,
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
    driverEarnings: Number,
    platformFee: Number,
  },
  { timestamps: true, strict: false }
);

const User = mongoose.model('User', UserSchema);
const Ride = mongoose.model('Ride', RideSchema);

// ==========================================
// 4. GENERAL ENDPOINTS
// ==========================================

// Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'HappyHour Logistics API',
    cluster: 'MongoDB Atlas',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// User Sign-Up & Sign-In Auth
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, email, role, primaryHub, isSignUp } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    let user = await User.findOne({ phone: phone.trim() });

    if (!user) {
      user = new User({
        name: name ? name.trim() : 'Passenger',
        phone: phone.trim(),
        email: email ? email.trim().toLowerCase() : undefined,
        role: role || 'passenger',
        primaryHub: primaryHub || 'Bodija Market',
        walletBalance: 500, // Welcome credit
      });
      await user.save();
    } else {
      if (name && isSignUp) user.name = name.trim();
      if (email) user.email = email.trim().toLowerCase();
      if (primaryHub) user.primaryHub = primaryHub;
      user.role = role || user.role;
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

    const fullName = `${firstName} ${surname}`.trim();
    let driver = await User.findOne({ phone: phone.trim() });

    const driverDetails = {
      firstName,
      surname,
      email: email ? email.trim().toLowerCase() : undefined,
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
        phone: phone.trim(),
        email: email ? email.trim().toLowerCase() : undefined,
        role: 'driver',
        walletBalance: 500, // ₦500 Welcome bonus credit
        driverDetails,
      });
    } else {
      driver.name = fullName;
      driver.role = 'driver';
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

// ==========================================
// 5. DRIVER WALLET & OVERDRAFT MANAGEMENT
// ==========================================

// Fetch Driver Wallet Balance & Ledger
app.get('/api/wallet/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      walletBalance: user.walletBalance || 0,
      isSuspendedFromRadar: Boolean(user.isSuspendedFromRadar),
      transactions: (user.transactions || []).reverse().slice(0, 30),
    });
  } catch (error) {
    console.error('Wallet Query Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Top-Up Driver Wallet (Direct Simulation / Testing)
app.post('/api/wallet/topup', async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    const topupAmount = Number(amount);

    if (!topupAmount || topupAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid top-up amount.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Captain account not found.' });
    }

    const newBalance = (user.walletBalance || 0) + topupAmount;
    const isNowActive = newBalance >= -2500;

    const transactionRecord = {
      transactionId: `TOP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      type: 'credit',
      amount: topupAmount,
      description: description || 'Driver Wallet Top-Up',
      balanceAfter: newBalance,
      date: new Date(),
    };

    user.walletBalance = newBalance;
    user.isSuspendedFromRadar = !isNowActive;
    user.transactions.push(transactionRecord);

    await user.save();

    res.json({
      success: true,
      walletBalance: user.walletBalance,
      isSuspendedFromRadar: user.isSuspendedFromRadar,
      transaction: transactionRecord,
    });
  } catch (error) {
    console.error('Wallet Top-Up Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 6. PAYSTACK DVA LIVE WEBHOOK HANDLER
// ==========================================
app.post('/api/webhooks/paystack', async (req, res) => {
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.headers['x-paystack-signature'];

  if (!paystackSecret) {
    console.error('❌ PAYSTACK_SECRET_KEY environment variable is not defined.');
    return res.status(500).send('Server configuration error');
  }

  if (!signature || !req.rawBody) {
    return res.status(401).send('Missing webhook signature or raw payload');
  }

  // 1. Verify HMAC SHA-512 signature
  const hash = crypto
    .createHmac('sha512', paystackSecret)
    .update(req.rawBody)
    .digest('hex');

  if (hash !== signature) {
    console.warn('⚠️ Untrusted Webhook Attempt: Signature mismatch detected.');
    return res.status(401).send('Invalid signature');
  }

  // 2. Acknowledge Paystack immediately with 200 OK
  res.status(200).send('Webhook acknowledged');

  // 3. Process the event asynchronously
  try {
    const event = req.body;

    if (event.event === 'charge.success') {
      const data = event.data;
      const transferAmountNaira = data.amount / 100; // Paystack sends amounts in Kobo
      const reference = data.reference;
      const customerPhone = data.customer?.phone;
      const customerEmail = data.customer?.email;

      console.log(`[PAYSTACK WEBHOOK] Successful deposit received: ₦${transferAmountNaira.toLocaleString()} (Ref: ${reference})`);

      // 4. Locate Driver (Match last 10 digits of Nigerian phone number)
      let driver = null;
      if (customerPhone) {
        const cleanPhone = customerPhone.replace(/[^0-9]/g, '');
        const last10Digits = cleanPhone.slice(-10);
        driver = await User.findOne({
          role: 'driver',
          phone: { $regex: new RegExp(last10Digits + '$') },
        });
      }

      // Fallback search by email
      if (!driver && customerEmail) {
        driver = await User.findOne({
          role: 'driver',
          $or: [
            { email: customerEmail.trim().toLowerCase() },
            { 'driverDetails.email': customerEmail.trim().toLowerCase() },
          ],
        });
      }

      if (!driver) {
        console.warn(`[PAYSTACK WEBHOOK] Unmatched Captain deposit. Phone: ${customerPhone}, Email: ${customerEmail}`);
        return;
      }

      // 5. Idempotency Check: Prevent duplicate credits on retry deliveries
      const alreadyCredited = driver.transactions?.some(
        (tx) => tx.transactionId === reference
      );
      if (alreadyCredited) {
        console.log(`[PAYSTACK WEBHOOK] Reference ${reference} was already credited to Captain ${driver.name}. Skipping.`);
        return;
      }

      // 6. Atomic Balance Credit & Overdraft Evaluation
      const balanceBefore = driver.walletBalance || 0;
      const newBalance = balanceBefore + transferAmountNaira;
      const isNowActive = newBalance >= -2500; // Unfreezes radar if above -₦2,500 limit

      const creditTransaction = {
        transactionId: reference,
        type: 'credit',
        amount: transferAmountNaira,
        description: `Direct Bank Transfer (DVA) • ${data.authorization?.bank || 'Bank Deposit'}`,
        balanceAfter: newBalance,
        date: new Date(data.paid_at || Date.now()),
      };

      driver.walletBalance = newBalance;
      driver.isSuspendedFromRadar = !isNowActive;
      driver.transactions.push(creditTransaction);

      await driver.save();

      console.log(
        `✅ [WALLET CREDITED] Captain ${driver.name} (+₦${transferAmountNaira.toLocaleString()}) | Old: ₦${balanceBefore} -> New: ₦${newBalance} | Radar Suspended: ${driver.isSuspendedFromRadar}`
      );
    }
  } catch (err) {
    console.error('❌ Error processing Paystack webhook event:', err);
  }
});

// ==========================================
// 7. RIDE & LOGISTICS DISPATCH ENGINE
// ==========================================

// Dispatch Booking Request
app.post('/api/rides/request', async (req, res) => {
  try {
    const payload = req.body;
    const generatedRideId = `HH-${Math.floor(100000 + Math.random() * 900000)}`;

    const newRide = new Ride({
      ...payload,
      rideId: payload.rideId || generatedRideId,
      status: 'pending',
    });

    await newRide.save();
    console.log(`[RIDE CREATED] ${newRide.rideId} | ${newRide.serviceType} | Fare: ₦${newRide.totalFare || newRide.fare}`);
    res.json({ success: true, ride: newRide });
  } catch (error) {
    console.error('Ride Request Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Available Rides Radar Query (Suspended drivers filtered out)
app.get('/api/rides/available', async (req, res) => {
  try {
    const { vehicleType, driverId } = req.query;

    if (driverId) {
      const driver = await User.findById(driverId);
      if (driver && driver.isSuspendedFromRadar) {
        return res.json({
          success: true,
          rides: [],
          isSuspended: true,
          message: 'Wallet depleted below -₦2,500. Top up your balance to unfreeze your radar.',
        });
      }
    }

    let query = { status: 'pending' };
    if (vehicleType && vehicleType !== 'Fleet') {
      query.vehicleType = vehicleType;
    }

    const rides = await Ride.find(query).sort({ createdAt: -1 }).limit(25);
    res.json({ success: true, rides, isSuspended: false });
  } catch (error) {
    console.error('Radar Query Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Single Ride Status Query
app.get('/api/rides/:rideId', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.params.rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }
    res.json({ success: true, ride });
  } catch (error) {
    console.error('Single Ride Query Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Accept Ride Order
app.post('/api/rides/accept', async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    if (driverId) {
      const driver = await User.findById(driverId);
      if (driver && driver.isSuspendedFromRadar) {
        return res.status(403).json({
          success: false,
          message: 'Radar frozen. Wallet overdraft limit exceeded (-₦2,500). Please top up.',
        });
      }
    }

    const ride = await Ride.findOne({ rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }

    if (ride.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Order has already been claimed.' });
    }

    let driverName = 'Captain';
    if (driverId) {
      const driver = await User.findById(driverId);
      if (driver) driverName = driver.name;
    }

    ride.status = 'accepted';
    ride.driverId = driverId;
    ride.driverName = driverName;
    await ride.save();

    res.json({ success: true, ride });
  } catch (error) {
    console.error('Accept Ride Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start Transit Route
app.post('/api/rides/start', async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }

    ride.status = 'in_progress';
    await ride.save();

    res.json({ success: true, ride });
  } catch (error) {
    console.error('Start Route Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Verify Recipient PIN, Deduct 15% Platform Commission & Complete
app.post('/api/rides/complete', async (req, res) => {
  try {
    const { rideId, deliveryPin } = req.body;
    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }

    if (ride.serviceType === 'logistics' && ride.deliveryPin) {
      if (!deliveryPin || deliveryPin.trim() !== ride.deliveryPin.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Security PIN Mismatch. Goods handover verification failed.',
        });
      }
    }

    const finalFare = Number(ride.totalFare || ride.fare || 3000);
    const driverEarnings = Math.round(finalFare * 0.85);
    const platformFee = Math.round(finalFare * 0.15);

    ride.status = 'completed';
    ride.driverEarnings = driverEarnings;
    ride.platformFee = platformFee;
    await ride.save();

    // Deduct 15% platform commission from Driver's Wallet
    let updatedBalance = null;
    let isSuspended = false;

    if (ride.driverId) {
      const driver = await User.findById(ride.driverId);
      if (driver) {
        const balanceBefore = driver.walletBalance || 0;
        updatedBalance = balanceBefore - platformFee;
        isSuspended = updatedBalance < -2500;

        const debitRecord = {
          transactionId: `COMM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          type: 'debit',
          amount: platformFee,
          description: `15% Commission for Trip ${ride.rideId}`,
          balanceAfter: updatedBalance,
          date: new Date(),
        };

        driver.walletBalance = updatedBalance;
        driver.isSuspendedFromRadar = isSuspended;
        driver.transactions.push(debitRecord);
        await driver.save();
      }
    }

    res.json({
      success: true,
      ride,
      wallet: {
        currentBalance: updatedBalance,
        isSuspendedFromRadar: isSuspended,
      },
      receipt: {
        totalFare: finalFare,
        driverEarnings,
        platformFee,
        paymentMethod: 'Cash',
      },
    });
  } catch (error) {
    console.error('Complete Ride Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Error Guard
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Attached photo payload exceeds upload limit.',
    });
  }
  console.error('Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 HappyHour Logistics Server running on port ${PORT}`);
});