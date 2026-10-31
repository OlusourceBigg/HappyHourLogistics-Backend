require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. DATABASE CONNECTION (LOWERCASE CASING)
// ==========================================
const MONGO_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://oolusource_db_user:logiStic2026@olusourcecluster.isfjl5l.mongodb.net/HappyHourLogistics?retryWrites=true&w=majority';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log(' Connected to MongoDB Atlas (HappyHour Cluster)'))
  .catch((err) => console.error(' MongoDB Connection Error:', err));

// ==========================================
// 2. SCHEMAS & MODELS
// ==========================================
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  firstName: { type: String, default: '' },
  surname: { type: String, default: '' },
  phone: { type: String, required: true, unique: true },
  role: {
    type: String,
    enum: ['passenger', 'driver', 'admin'],
    default: 'passenger',
  },
  driverDetails: {
    dateOfBirth: { type: String, default: '' },
    profileImage: { type: String, default: '' },
    yearsOfExperience: { type: Number, default: 1 },
    licenseNumber: { type: String, default: '' },
    vehicleType: {
      type: String,
      enum: ['Cab / Micra', 'Keke Marwa', 'Express Okada', 'Van / Bus', 'Saloon Car'],
      default: 'Cab / Micra',
    },
    vehicleMake: { type: String, default: '' },
    vehicleModel: { type: String, default: '' },
    vehicleYear: { type: String, default: '' },
    plateNumber: { type: String, default: '' },
    serviceScope: {
      type: String,
      enum: ['passenger_only', 'logistics_only', 'both'],
      default: 'both',
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
    },
  },
  isApprovedDriver: { type: Boolean, default: true },
  walletBalance: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const rideSchema = new mongoose.Schema({
  rideId: { type: String, required: true, unique: true },
  passengerId: { type: String },
  passengerName: { type: String, required: true },
  passengerPhone: { type: String, required: true },
  pickupLocation: { type: String, required: true },
  dropoffLocation: { type: String, required: true },
  fare: { type: Number, required: true },
  totalFare: { type: Number, required: true },
  vehicleType: { type: String, default: 'Cab / Micra' },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  driverId: { type: String, default: null },
  driverName: { type: String, default: null },
  driverPhone: { type: String, default: null },
  driverEarnings: { type: Number, default: 0 },
  platformFee: { type: Number, default: 0 },
  paymentMethod: { type: String, default: 'cash' },
  coordinates: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
});

const User = mongoose.model('User', userSchema);
const Ride = mongoose.model('Ride', rideSchema);

// ==========================================
// 3. API ROUTES
// ==========================================

// Health Check
app.get('/', (req, res) => {
  res.json({ status: 'Online', service: 'HappyHour Logistics API', region: 'Ibadan, Nigeria' });
});

// A. Auth / Login
app.post('/api/users/auth', async (req, res) => {
  try {
    const { name, phone, role } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const cleanedPhone = phone.trim();
    let user = await User.findOne({ phone: cleanedPhone });

    if (!user) {
      user = await User.create({
        name: name ? name.trim() : 'Ibadan Resident',
        phone: cleanedPhone,
        role: role || 'passenger',
        isApprovedDriver: role === 'driver',
      });
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// B. Driver KYC Onboarding
app.post('/api/drivers/register', async (req, res) => {
  try {
    const {
      firstName,
      surname,
      phone,
      dateOfBirth,
      profileImage,
      yearsOfExperience,
      licenseNumber,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      plateNumber,
      serviceScope,
    } = req.body;

    if (!firstName || !surname || !phone || !plateNumber) {
      return res.status(400).json({
        success: false,
        message: 'First name, surname, phone number, and vehicle plate number are required.',
      });
    }

    const cleanedPhone = phone.trim();
    const fullName = `${firstName.trim()} ${surname.trim()}`;

    const driverPayload = {
      name: fullName,
      firstName: firstName.trim(),
      surname: surname.trim(),
      phone: cleanedPhone,
      role: 'driver',
      isApprovedDriver: true,
      driverDetails: {
        dateOfBirth: dateOfBirth || '',
        profileImage: profileImage || '',
        yearsOfExperience: Number(yearsOfExperience) || 1,
        licenseNumber: licenseNumber ? licenseNumber.trim().toUpperCase() : '',
        vehicleType: vehicleType || 'Cab / Micra',
        vehicleMake: vehicleMake ? vehicleMake.trim() : '',
        vehicleModel: vehicleModel ? vehicleModel.trim() : '',
        vehicleYear: vehicleYear ? vehicleYear.trim() : '',
        plateNumber: plateNumber.trim().toUpperCase(),
        serviceScope: serviceScope || 'both',
        verificationStatus: 'approved',
      },
    };

    const driver = await User.findOneAndUpdate(
      { phone: cleanedPhone },
      driverPayload,
      { new: true, upsert: true }
    );

    return res.status(201).json({
      success: true,
      message: 'Driver profile registered successfully.',
      driver,
    });
  } catch (error) {
    console.error('Driver KYC error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// C. Request Ride (Passenger)
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
      coordinates,
    } = req.body;

    const rideId = `HH-${Math.floor(100000 + Math.random() * 900000)}`;
    const tripFare = Number(fare || totalFare) || 3000;

    const ride = await Ride.create({
      rideId,
      passengerId,
      passengerName,
      passengerPhone,
      pickupLocation,
      dropoffLocation,
      fare: tripFare,
      totalFare: tripFare,
      vehicleType: vehicleType || 'Cab / Micra',
      coordinates,
      status: 'pending',
    });

    return res.status(201).json({ success: true, ride });
  } catch (error) {
    console.error('Request ride error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// D. Fetch Pending Rides with Vehicle-Class Dispatch Matching (Driver Radar)
app.get('/api/rides/available', async (req, res) => {
  try {
    const { vehicleType } = req.query;
    const filter = { status: 'pending' };

    // Strict matching so keke riders see keke, okada riders see okada, cars see cars
    if (vehicleType) {
      if (vehicleType === 'Cab / Micra' || vehicleType === 'Saloon Car') {
        filter.vehicleType = { $in: ['Cab / Micra', 'Saloon Car'] };
      } else {
        filter.vehicleType = vehicleType;
      }
    }

    const rides = await Ride.find(filter).sort({ createdAt: -1 }).limit(20);
    return res.json({ success: true, rides });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// E. Single Ride Status
app.get('/api/rides/:rideId', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.params.rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }
    return res.json({ success: true, ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// F. Accept Trip (Driver)
app.post('/api/rides/accept', async (req, res) => {
  try {
    const { rideId, driverId } = req.body;
    const driver = await User.findById(driverId);

    const ride = await Ride.findOneAndUpdate(
      { rideId, status: 'pending' },
      {
        status: 'accepted',
        driverId,
        driverName: driver ? driver.name : 'HappyHour Captain',
        driverPhone: driver ? driver.phone : '',
      },
      { new: true }
    );

    if (!ride) {
      return res.status(400).json({
        success: false,
        message: 'Ride is no longer available or already taken.',
      });
    }

    return res.json({ success: true, message: 'Ride accepted successfully.', ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// G. Start Trip (Driver)
app.post('/api/rides/start', async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await Ride.findOneAndUpdate(
      { rideId },
      { status: 'in_progress' },
      { new: true }
    );
    return res.json({ success: true, ride });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// H. Complete Trip & Financial Settlement (85% Driver / 15% Platform)
app.post('/api/rides/complete', async (req, res) => {
  try {
    const { rideId } = req.body;
    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }

    const totalFare = Number(ride.totalFare || ride.fare) || 0;
    const driverEarnings = Math.round(totalFare * 0.85); // 85% Cut
    const platformFee = totalFare - driverEarnings;      // 15% Platform

    ride.status = 'completed';
    ride.driverEarnings = driverEarnings;
    ride.platformFee = platformFee;
    ride.completedAt = new Date();
    await ride.save();

    if (ride.driverId) {
      await User.findByIdAndUpdate(ride.driverId, {
        $inc: { walletBalance: driverEarnings },
      });
    }

    return res.json({
      success: true,
      message: 'Trip completed successfully.',
      ride,
      receipt: {
        totalFare,
        driverEarnings,
        platformFee,
        paymentMethod: 'Cash',
      },
    });
  } catch (error) {
    console.error('Complete ride error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// 4. SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(` HappyHour Logistics Backend active on port ${PORT}`);
});