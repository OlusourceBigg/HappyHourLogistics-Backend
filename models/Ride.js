const mongoose = require('mongoose');

const RideSchema = new mongoose.Schema(
  {
    rideId: {
      type: String,
      required: true,
      unique: true,
    },
    passengerName: {
      type: String,
      default: 'Ibadan Rider',
    },
    passengerPhone: {
      type: String,
      default: '',
    },
    vehicleType: {
      type: String,
      enum: ['motor', 'keke', 'bike'],
      required: true,
    },
    pickupLocation: {
      type: String,
      required: true,
      trim: true,
    },
    dropoffLocation: {
      type: String,
      required: true,
      trim: true,
    },
    fare: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
    },
    assignedDriver: {
      name: { type: String, default: null },
      phone: { type: String, default: null },
      vehiclePlate: { type: String, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Ride', RideSchema);