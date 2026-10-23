const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ==========================================
// MIDDLEWARE & REQUEST LOGGING
// ==========================================
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`--> [${req.method}] ${req.url}`);
  if (req.method === 'POST' || req.method === 'PATCH') {
    console.log('Payload:', JSON.stringify(req.body));
  }
  next();
});

// ==========================================
// MONGODB CONNECTION
// ==========================================
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI is missing from environment variables!');
} else {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB (happyhourlogistics)'))
    .catch((err) => console.error('MongoDB connection error:', err.message));
}

// ==========================================
// SCHEMA & MODEL
// ==========================================
const rideSchema = new mongoose.Schema(
  {
    rideId: {
      type: String,
      default: () => 'HHL-' + Math.floor(100000 + Math.random() * 900000),
      unique: true,
    },
    passengerName: { type: String, default: 'Ibadan Commuter' },
    passengerPhone: { type: String, default: '+234 703 298 3440' },
    pickupLocation: { type: String, required: true },
    dropoffLocation: { type: String, required: true },
    fare: { type: Number, required: true },
    vehicleType: { type: String, default: 'Cab / Micra' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'completed', 'cancelled'],
      default: 'pending',
    },
    driverName: { type: String, default: null },
    driverPhone: { type: String, default: null },
    vehiclePlate: { type: String, default: null },
    paymentMethod: { type: String, default: 'cash' },
  },
  { timestamps: true }
);

const Ride = mongoose.models.Ride || mongoose.model('Ride', rideSchema);

// ==========================================
// API ROUTES
// ==========================================

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'HappyHour Logistics API is live and operational!' });
});

// 1. Request a ride (Rider Mode - Sanitized)
app.post('/api/rides/request', async (req, res) => {
  try {
    const pickup = req.body.pickupLocation || req.body.pickup || 'Iwo Road Interchange';
    const dropoff = req.body.dropoffLocation || req.body.dropoff || req.body.destination;
    const rawFare = req.body.fare;
    const vehicleType = req.body.vehicleType || 'Cab / Micra';
    const passengerName = req.body.passengerName || 'Ibadan Commuter';
    const passengerPhone = req.body.passengerPhone || '+234 703 298 3440';

    if (!dropoff) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a Drop-off Destination on your screen.',
      });
    }

    const cleanedFare =
      typeof rawFare === 'number'
        ? rawFare
        : Number(String(rawFare || '1400').replace(/[^0-9.]/g, '')) || 1400;

    const newRide = new Ride({
      pickupLocation: String(pickup).trim(),
      dropoffLocation: String(dropoff).trim(),
      fare: cleanedFare,
      vehicleType,
      passengerName,
      passengerPhone,
    });

    const savedRide = await newRide.save();
    console.log(`[Ride Created] ID: ${savedRide.rideId} | Fare: ₦${savedRide.fare}`);

    return res.status(201).json({ success: true, ride: savedRide });
  } catch (err) {
    console.error('Ride request error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Fetch available pending rides (Driver Mode)
app.get('/api/rides/available', async (req, res) => {
  try {
    const rides = await Ride.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, rides });
  } catch (err) {
    console.error('Fetch rides error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch available rides.' });
  }
});

// 3. Fetch single ride status (Live Rider Tracking Polling)
app.get('/api/rides/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const query = mongoose.Types.ObjectId.isValid(identifier)
      ? { $or: [{ _id: identifier }, { rideId: identifier }] }
      : { rideId: identifier };

    const ride = await Ride.findOne(query);

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }

    res.json({ success: true, ride });
  } catch (err) {
    console.error('Fetch ride status error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch ride status.' });
  }
});

// 4. Driver accepts a ride
app.patch('/api/rides/:identifier/accept', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { driverName, driverPhone, vehiclePlate } = req.body;

    const query = mongoose.Types.ObjectId.isValid(identifier)
      ? { $or: [{ _id: identifier }, { rideId: identifier }] }
      : { rideId: identifier };

    const ride = await Ride.findOne(query);

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }

    if (ride.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'This ride has already been claimed.' });
    }

    ride.status = 'accepted';
    ride.driverName = driverName || 'Captain Segun';
    ride.driverPhone = driverPhone || '+234 703 298 3440';
    ride.vehiclePlate = vehiclePlate || 'IBD-452-AA';

    await ride.save();
    console.log(`[Ride Accepted] ID: ${ride.rideId} by ${ride.driverName}`);

    res.json({ success: true, ride });
  } catch (err) {
    console.error('Accept ride error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to accept ride.' });
  }
});

// 5. Complete a ride
app.patch('/api/rides/:identifier/complete', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { paymentMethod } = req.body;

    const query = mongoose.Types.ObjectId.isValid(identifier)
      ? { $or: [{ _id: identifier }, { rideId: identifier }] }
      : { rideId: identifier };

    const ride = await Ride.findOne(query);

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }

    ride.status = 'completed';
    if (paymentMethod) ride.paymentMethod = paymentMethod;

    await ride.save();
    console.log(`[Ride Completed] ID: ${ride.rideId}`);

    res.json({ success: true, ride });
  } catch (err) {
    console.error('Complete ride error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to complete ride.' });
  }
});

// 6. Driver Live Metrics (Today's Earnings & Trips Done)
app.get('/api/driver/metrics', async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const result = await Ride.aggregate([
      {
        $match: {
          status: 'completed',
          updatedAt: { $gte: startOfToday },
        },
      },
      {
        $group: {
          _id: null,
          todayEarnings: { $sum: '$fare' },
          tripsDone: { $sum: 1 },
        },
      },
    ]);

    const metrics = result[0] || { todayEarnings: 0, tripsDone: 0 };

    res.json({
      success: true,
      todayEarnings: metrics.todayEarnings,
      tripsDone: metrics.tripsDone,
    });
  } catch (err) {
    console.error('Driver metrics error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to calculate driver metrics.' });
  }
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});