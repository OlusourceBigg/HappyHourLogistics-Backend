const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI is missing from environment variables!');
} else {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB (HappyHourLogistics)'))
    .catch((err) => console.error('MongoDB connection error:', err.message));
}

// Ride Schema & Model (Self-contained, no external routes/models required)
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
    vehicleType: { type: String, default: 'motor' },
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'HappyHour Logistics API is live and operational!' });
});

// 1. Request a ride (Rider Mode)
app.post('/api/rides/request', async (req, res) => {
  try {
    const { pickupLocation, dropoffLocation, fare, vehicleType, passengerName, passengerPhone } = req.body;

    if (!pickupLocation || !dropoffLocation || !fare) {
      return res.status(400).json({ success: false, error: 'Pickup, dropoff, and fare are required.' });
    }

    const newRide = new Ride({
      pickupLocation,
      dropoffLocation,
      fare,
      vehicleType: vehicleType || 'motor',
      passengerName: passengerName || 'Ibadan Commuter',
      passengerPhone: passengerPhone || '+234 703 298 3440',
    });

    const savedRide = await newRide.save();
    console.log(`[Ride Created] ID: ${savedRide.rideId} | Fare: ₦${savedRide.fare}`);

    res.status(201).json({ success: true, ride: savedRide });
  } catch (err) {
    console.error('Ride request error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create ride request.' });
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

// 3. Driver accepts a ride
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

// 4. Complete a ride
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

// Port Binding for Render
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});