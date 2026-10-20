require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Ride = require('./models/Ride');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log(' Connected to MongoDB (HappyHourLogistics)'))
  .catch((err) => console.error(' MongoDB Connection Error:', err.message));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'HappyHourLogistics API' });
});

// Rider: Create ride
app.post('/api/rides/request', async (req, res) => {
  try {
    const { vehicleType, pickupLocation, dropoffLocation, fare, passengerName, passengerPhone } = req.body;

    if (!pickupLocation || !dropoffLocation || !fare) {
      return res.status(400).json({ error: 'Pickup, drop-off, and fare are required.' });
    }

    const rideId = `HHL-RD-${Math.floor(100000 + Math.random() * 900000)}`;

    const newRide = await Ride.create({
      rideId,
      vehicleType: vehicleType || 'motor',
      pickupLocation,
      dropoffLocation,
      fare,
      passengerName: passengerName || 'Ibadan Rider',
      passengerPhone: passengerPhone || '',
      status: 'pending',
    });

    res.status(201).json({ success: true, ride: newRide });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Driver: Get pending trips
app.get('/api/rides/available', async (req, res) => {
  try {
    const pendingRides = await Ride.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, rides: pendingRides });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Driver: Accept trip
app.patch('/api/rides/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const { driverName, driverPhone, vehiclePlate } = req.body;

    let ride = await Ride.findOne({ rideId: id });
    if (!ride && /^[0-9a-fA-F]{24}$/.test(id)) {
      ride = await Ride.findById(id);
    }

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride request not found',
      });
    }

    if (ride.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Ride cannot be accepted because it is already ${ride.status}`,
      });
    }

    ride.status = 'accepted';
    ride.assignedDriver = {
      name: driverName || 'Captain Segun',
      phone: driverPhone || '08098765432',
      vehiclePlate: vehiclePlate || 'IBD-452-AA',
    };

    const updatedRide = await ride.save();

    return res.status(200).json({
      success: true,
      message: 'Ride successfully accepted by driver',
      ride: updatedRide,
    });
  } catch (error) {
    console.error('Error accepting ride:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while accepting ride',
      error: error.message,
    });
  }
});

// Driver: Complete trip
app.patch('/api/rides/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body;

    let ride = await Ride.findOne({ rideId: id });
    if (!ride && /^[0-9a-fA-F]{24}$/.test(id)) {
      ride = await Ride.findById(id);
    }

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride request not found',
      });
    }

    if (ride.status !== 'accepted' && ride.status !== 'in-progress') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete trip with status "${ride.status}". Must be "accepted" or "in-progress".`,
      });
    }

    ride.status = 'completed';
    ride.paymentMethod = paymentMethod || 'cash';
    ride.completedAt = new Date();

    const updatedRide = await ride.save();

    return res.status(200).json({
      success: true,
      message: 'Trip completed successfully. Ready for fare collection.',
      ride: updatedRide,
    });
  } catch (error) {
    console.error('Error completing ride:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while completing ride',
      error: error.message,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(` HappyHourLogistics Server running on http://0.0.0.0:${PORT}`);
});