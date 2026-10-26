require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// ==========================================
// 1. MIDDLEWARE SETUP
// ==========================================
app.use(cors());
app.use(express.json());

// Request logger for Render monitoring
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ==========================================
// 2. MONGODB ATLAS CONNECTION
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI environment variable is missing.');
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB (happyhourlogistics)'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// ==========================================
// 3. SCHEMAS, INDEXES & MODELS
// ==========================================

// --- USER SCHEMA ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  role: { 
    type: String, 
    enum: ['passenger', 'driver', 'admin'], 
    default: 'passenger' 
  },
  isApprovedDriver: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Fast index for user auth lookups
userSchema.index({ phone: 1 });

const User = mongoose.model('User', userSchema);

// --- RIDE SCHEMA WITH FINANCIAL BREAKDOWN ---
const rideSchema = new mongoose.Schema({
  rideId: { type: String, required: true, unique: true },
  passenger: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  passengerName: { type: String, required: true },
  passengerPhone: { type: String, required: true },
  pickupLocation: { type: String, required: true },
  dropoffLocation: { type: String, required: true },
  
  // Financial breakdown
  totalFare: { type: Number, required: true },
  commissionRate: { type: Number, default: 0.15 }, // 15% platform cut
  platformFee: { type: Number, required: true },    // 15% retained by company
  driverEarnings: { type: Number, required: true }, // 85% paid to driver
  
  paymentMethod: { 
    type: String, 
    enum: ['cash', 'card', 'transfer', 'wallet'], 
    default: 'cash' 
  },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'paid', 'settled'], 
    default: 'pending' 
  },

  vehicleType: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'], 
    default: 'pending' 
  },
  createdAt: { type: Date, default: Date.now },
});

// Compound index for high-speed Driver Radar queries
rideSchema.index({ status: 1, createdAt: -1 });

// Single indexes for tracking and trip histories
rideSchema.index({ rideId: 1 });
rideSchema.index({ passenger: 1, createdAt: -1 });
rideSchema.index({ driver: 1, createdAt: -1 });

const Ride = mongoose.model('Ride', rideSchema);

// ==========================================
// 4. API ROUTES
// ==========================================

// Health-check
app.get('/', (req, res) => {
  res.json({ message: 'HappyHour Logistics API is live and operational!' });
});

// User Authentication (Login or Auto-Register)
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, role } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and phone number are required.' 
      });
    }

    const cleanedPhone = phone.trim();
    const userRole = role === 'driver' ? 'driver' : 'passenger';

    let user = await User.findOne({ phone: cleanedPhone });

    if (!user) {
      user = await User.create({
        name: name.trim(),
        phone: cleanedPhone,
        role: userRole,
        isApprovedDriver: userRole === 'driver',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user,
    });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Internal authentication failure' 
    });
  }
});

// Passenger: Request a new ride with automated fee calculation
app.post('/api/rides/request', async (req, res) => {
  try {
    const { 
      passengerId, 
      passengerName, 
      passengerPhone, 
      pickupLocation, 
      dropoffLocation, 
      fare, 
      totalFare,
      vehicleType,
      paymentMethod 
    } = req.body;

    // Accepts either 'fare' or 'totalFare' from the frontend payload
    const tripFare = fare || totalFare;

    if (!pickupLocation || !dropoffLocation || !tripFare || !vehicleType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required trip parameters (pickup, dropoff, fare, vehicleType).' 
      });
    }

    // Mathematical split: 15% platform commission, 85% driver earnings
    const numericFare = Number(tripFare);
    const commissionRate = 0.15;
    const platformFee = Math.round(numericFare * commissionRate);
    const driverEarnings = numericFare - platformFee;

    const rideId = `HHL-${Math.floor(100000 + Math.random() * 900000)}`;

    const newRide = await Ride.create({
      rideId,
      passenger: passengerId || null,
      passengerName: passengerName || 'Passenger',
      passengerPhone: passengerPhone || '',
      pickupLocation,
      dropoffLocation,
      totalFare: numericFare,
      commissionRate,
      platformFee,
      driverEarnings,
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: 'pending',
      vehicleType,
      status: 'pending',
    });

    return res.status(201).json({ success: true, ride: newRide });
  } catch (error) {
    console.error('Ride request error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Driver: High-frequency radar feed for available trips
app.get('/api/rides/available', async (req, res) => {
  try {
    const availableRides = await Ride.find({ status: 'pending' })
      .select('rideId passengerName passengerPhone pickupLocation dropoffLocation totalFare platformFee driverEarnings vehicleType paymentMethod createdAt')
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();

    return res.status(200).json({ success: true, rides: availableRides });
  } catch (error) {
    console.error('Available rides error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Driver: Accept a ride
app.post('/api/rides/accept', async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    if (!rideId) {
      return res.status(400).json({ success: false, message: 'rideId is required.' });
    }

    const ride = await Ride.findOneAndUpdate(
      { rideId, status: 'pending' },
      { status: 'accepted', driver: driverId || null },
      { new: true }
    );

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Trip already taken or not found.' });
    }

    return res.status(200).json({ success: true, ride });
  } catch (error) {
    console.error('Accept ride error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Polling: Track single trip status
app.get('/api/rides/:rideId', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.params.rideId }).lean();
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found.' });
    }
    return res.status(200).json({ success: true, ride });
  } catch (error) {
    console.error('Trip tracking error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 5. SAFETY & ERROR HANDLING
// ==========================================

// Catch-all 404 handler (always returns clean JSON, never HTML)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.method} ${req.url} does not exist.`,
  });
});

// Global server error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server exception:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ==========================================
// 6. SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});