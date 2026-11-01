const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// ==========================================
// 1. HIGH-CAPACITY BODY PARSERS & CORS
// ==========================================
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
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
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    role: { type: String, default: 'passenger' }, // 'passenger' | 'driver'
    primaryHub: { type: String, default: 'Bodija Market' },
    driverDetails: {
      firstName: String,
      surname: String,
      dateOfBirth: String,
      yearsOfExperience: String,
      vehicleType: String,
      vehicleModel: String,
      vehicleYear: String,
      plateNumber: String,
      serviceScope: String,
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
// 4. API ENDPOINTS
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
    const { name, phone, role, primaryHub, isSignUp } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    let user = await User.findOne({ phone: phone.trim() });

    if (!user) {
      user = new User({
        name: name ? name.trim() : 'Passenger',
        phone: phone.trim(),
        role: role || 'passenger',
        primaryHub: primaryHub || 'Bodija Market',
      });
      await user.save();
    } else {
      if (name && isSignUp) user.name = name.trim();
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
        role: 'driver',
        driverDetails,
      });
    } else {
      driver.name = fullName;
      driver.role = 'driver';
      driver.driverDetails = driverDetails;
    }

    await driver.save();
    res.json({ success: true, driver });
  } catch (error) {
    console.error('KYC Registration Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

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

// Available Rides Radar Query
app.get('/api/rides/available', async (req, res) => {
  try {
    const { vehicleType } = req.query;
    let query = { status: 'pending' };

    if (vehicleType && vehicleType !== 'Fleet') {
      query.vehicleType = vehicleType;
    }

    const rides = await Ride.find(query).sort({ createdAt: -1 }).limit(25);
    res.json({ success: true, rides });
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

// Verify Recipient PIN & Conclude Delivery
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

    res.json({
      success: true,
      ride,
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