require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI;

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(cors());
app.use(express.json());

// Log incoming requests for Render console auditing
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================================
// DATABASE CONNECTION
// ============================================================================
if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI environment variable is missing.');
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  })
  .then(() => {
    console.log('Connected to MongoDB (happyhourlogistics)');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
  });

// ============================================================================
// MONGOOSE SCHEMAS & MODELS
// ============================================================================

// 1. User Schema (Riders, Drivers, Admins)
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  role: {
    type: String,
    enum: ['passenger', 'driver', 'admin'],
    default: 'passenger',
  },
  isApprovedDriver: { type: Boolean, default: true },
  vehicleDetails: {
    vehicleType: { type: String, default: null },
    plateNumber: { type: String, default: null },
  },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

// 2. Ride Schema
const rideSchema = new mongoose.Schema({
  rideId: { type: String, required: true, unique: true },
  passengerName: { type: String, default: 'Commuter' },
  passengerPhone: { type: String, default: 'N/A' },
  vehicleType: { type: String, default: 'Cab / Micra' },
  pickupLocation: { type: String, required: true },
  dropoffLocation: { type: String, required: true },
  fare: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'completed', 'cancelled'],
    default: 'pending',
  },
  driverName: { type: String, default: null },
  driverPhone: { type: String, default: null },
  vehiclePlate: { type: String, default: null },
  paymentMethod: { type: String, default: 'cash' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Ride = mongoose.models.Ride || mongoose.model('Ride', rideSchema);

// Helper: Find Ride by either custom rideId ("HHL-xxxxxx") or MongoDB _id
const findRideByIdentifier = (identifier) => {
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    return Ride.findOne({ $or: [{ _id: identifier }, { rideId: identifier }] });
  }
  return Ride.findOne({ rideId: identifier });
};

// ============================================================================
// ROUTES
// ============================================================================

// 1. Health & Status Check
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'HappyHour Logistics API is live and operational!',
    timestamp: new Date().toISOString(),
  });
});

// 2. Role-Based Authentication Gateway (Registration & Login)
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, role, plateNumber, vehicleType } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    const cleanPhone = phone.trim();
    let user = await User.findOne({ phone: cleanPhone });

    if (!user) {
      user = new User({
        name: name ? name.trim() : 'Commuter',
        phone: cleanPhone,
        role: role || 'passenger',
        isApprovedDriver: true,
        vehicleDetails:
          role === 'driver'
            ? {
                vehicleType: vehicleType || 'Cab / Micra',
                plateNumber: plateNumber ? plateNumber.trim().toUpperCase() : 'Pending',
              }
            : undefined,
      });
      await user.save();
    } else {
      if (name) user.name = name.trim();
      if (role) user.role = role;
      if (role === 'driver') {
        user.vehicleDetails = {
          vehicleType: vehicleType || user.vehicleDetails?.vehicleType || 'Cab / Micra',
          plateNumber: plateNumber
            ? plateNumber.trim().toUpperCase()
            : user.vehicleDetails?.plateNumber || 'Pending',
        };
      }
      await user.save();
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error('Error in /api/users/auth:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Request a New Ride (Dispatched from Mobile App or Admin Dashboard)
app.post('/api/rides/request', async (req, res) => {
  try {
    const {
      pickupLocation,
      dropoffLocation,
      fare,
      vehicleType,
      passengerName,
      passengerPhone,
    } = req.body;

    if (!pickupLocation || !dropoffLocation || !fare) {
      return res.status(400).json({
        success: false,
        error: 'Pickup, destination, and fare calculation are required.',
      });
    }

    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const rideId = `HHL-${randomSuffix}`;

    const newRide = new Ride({
      rideId,
      pickupLocation,
      dropoffLocation,
      fare: Number(fare),
      vehicleType: vehicleType || 'Cab / Micra',
      passengerName: passengerName || 'Ibadan Commuter',
      passengerPhone: passengerPhone || '+234 703 298 3440',
      status: 'pending',
    });

    await newRide.save();
    return res.status(201).json({ success: true, ride: newRide });
  } catch (err) {
    console.error('Error creating ride request:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Driver Live Radar Feed (Fetch pending ride requests)
app.get('/api/rides/available', async (req, res) => {
  try {
    const pendingRides = await Ride.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(30);

    return res.status(200).json({ success: true, rides: pendingRides });
  } catch (err) {
    console.error('Error fetching available rides:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Query Specific Ride by ID (Used by Rider live status tracker)
app.get('/api/rides/:id', async (req, res) => {
  try {
    const ride = await findRideByIdentifier(req.params.id);
    if (!ride) {
      return res.status(404).json({ success: false, error: 'Ride not found.' });
    }
    return res.status(200).json({ success: true, ride });
  } catch (err) {
    console.error('Error fetching ride:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Driver Accepts a Ride
app.patch('/api/rides/:id/accept', async (req, res) => {
  try {
    const { driverName, driverPhone, vehiclePlate } = req.body;
    const ride = await findRideByIdentifier(req.params.id);

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }

    if (ride.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: `Ride is no longer available (current status: ${ride.status}).`,
      });
    }

    ride.status = 'accepted';
    ride.driverName = driverName || 'Captain Segun';
    ride.driverPhone = driverPhone || '+234 703 298 3440';
    ride.vehiclePlate = vehiclePlate || 'IBD-452-AA';
    ride.updatedAt = new Date();

    await ride.save();
    return res.status(200).json({ success: true, ride });
  } catch (err) {
    console.error('Error accepting ride:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Complete Ride & Collect Fare
app.patch('/api/rides/:id/complete', async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    const ride = await findRideByIdentifier(req.params.id);

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }

    ride.status = 'completed';
    ride.paymentMethod = paymentMethod || 'cash';
    ride.updatedAt = new Date();

    await ride.save();
    return res.status(200).json({ success: true, ride });
  } catch (err) {
    console.error('Error completing ride:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Cancel Ride Request
app.patch('/api/rides/:id/cancel', async (req, res) => {
  try {
    const ride = await findRideByIdentifier(req.params.id);

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }

    if (ride.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Completed rides cannot be cancelled.',
      });
    }

    ride.status = 'cancelled';
    ride.updatedAt = new Date();
    await ride.save();

    return res.status(200).json({ success: true, ride });
  } catch (err) {
    console.error('Error cancelling ride:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 9. Driver Metrics (Today's completed revenue & trips)
app.get('/api/driver/metrics', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const completedToday = await Ride.find({
      status: 'completed',
      updatedAt: { $gte: startOfDay },
    });

    const todayEarnings = completedToday.reduce((sum, r) => sum + (r.fare || 0), 0);
    const tripsDone = completedToday.length;

    return res.status(200).json({
      success: true,
      todayEarnings,
      tripsDone,
    });
  } catch (err) {
    console.error('Error calculating driver metrics:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Admin Overview (Feeds admin.html tables and KPI counters)
app.get('/api/admin/overview', async (req, res) => {
  try {
    const [allRides, drivers] = await Promise.all([
      Ride.find().sort({ createdAt: -1 }).limit(100),
      User.find({ role: 'driver' }).sort({ createdAt: -1 }),
    ]);

    const totalRevenue = allRides
      .filter((r) => r.status === 'completed')
      .reduce((sum, r) => sum + (r.fare || 0), 0);

    const pendingRides = allRides.filter((r) => r.status === 'pending').length;
    const completedRides = allRides.filter((r) => r.status === 'completed').length;
    const cancelledRides = allRides.filter((r) => r.status === 'cancelled').length;

    return res.status(200).json({
      success: true,
      stats: {
        totalRevenue,
        totalRides: allRides.length,
        pendingRides,
        completedRides,
        cancelledRides,
      },
      recentRides: allRides,
      drivers,
    });
  } catch (err) {
    console.error('Error generating admin overview:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Admin Driver Approval
app.patch('/api/admin/drivers/:id/approve', async (req, res) => {
  try {
    const driver = await User.findByIdAndUpdate(
      req.params.id,
      { isApprovedDriver: true },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found.' });
    }

    return res.status(200).json({ success: true, driver });
  } catch (err) {
    console.error('Error approving driver:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// GLOBAL 404 CATCH-ALL (Guarantees JSON output, preventing HTML parse errors)
// ============================================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint not found: [${req.method}] ${req.originalUrl}`,
  });
});

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});