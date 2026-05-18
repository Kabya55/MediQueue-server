const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL || 'http://localhost:3000'}/api/auth/jwks`)
);

const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const db = client.db("mediQueue");
const tutorsCollection = db.collection("tutors");
const bookingsCollection = db.collection("bookings");
const usersCollection = db.collection("user");

const authenticateToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    const userId = payload.sub || payload.id;

    if (userId) {
      let query;
      try { 
        query = { _id: new ObjectId(userId) }; 
      } catch (e) { 
        query = { _id: userId, id: userId }; 
      }

      const userDoc = await usersCollection.findOne({
        $or: [
          { _id: query._id },
          { id: userId },
          { _id: userId }
        ]
      });

      if (userDoc) {
        req.user = userDoc;
      } else {
        req.user = payload;
      }
    } else {
      req.user = payload;
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(url => url.trim())
  : [];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.status(200).send('MediQueue backend is running smoothly!');
});

app.get('/api/tutors', async (req, res) => {
  try {
    const { search, startDate, endDate, limit } = req.query;
    let query = {};

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    if (startDate || endDate) {
      query.sessionStartDate = {};
      if (startDate) {
        query.sessionStartDate.$gte = startDate;
      }
      if (endDate) {
        query.sessionStartDate.$lte = endDate;
      }
    }

    let cursor = tutorsCollection.find(query);

    if (limit) {
      cursor = cursor.limit(parseInt(limit));
    }

    const tutors = await cursor.sort({ createdAt: -1 }).toArray();
    res.status(200).json(tutors);
  } catch (error) {
    console.error('Error fetching tutors:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/tutors/my', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const tutors = await tutorsCollection
      .find({ creatorEmail: userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(tutors);
  } catch (error) {
    console.error('Error fetching user tutors:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/tutors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid Tutor ID format' });
    }

    const tutor = await tutorsCollection.findOne({ _id: new ObjectId(id) });
    if (!tutor) {
      return res.status(404).json({ message: 'Tutor not found' });
    }

    res.status(200).json(tutor);
  } catch (error) {
    console.error('Error fetching tutor details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/tutors', authenticateToken, async (req, res) => {
  try {
    const {
      name, photoUrl, subject, availableDays, availableTime,
      hourlyFee, totalSlot, sessionStartDate, institution,
      experience, location, teachingMode
    } = req.body;

    if (!name || !photoUrl || !subject || !availableDays || !availableTime || !hourlyFee || !totalSlot || !sessionStartDate || !institution || !experience || !location || !teachingMode) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const newTutor = {
      name,
      photoUrl,
      subject,
      availableDays: Array.isArray(availableDays) ? availableDays : [availableDays],
      availableTime,
      hourlyFee: parseFloat(hourlyFee),
      totalSlot: parseInt(totalSlot),
      sessionStartDate,
      sessionEndDate: req.body.sessionEndDate || null,
      institution,
      experience,
      location,
      teachingMode,
      creatorEmail: req.user.email,
      createdAt: new Date()
    };

    const result = await tutorsCollection.insertOne(newTutor);
    res.status(201).json({
      message: 'Tutor added successfully!',
      tutor: { _id: result.insertedId, ...newTutor }
    });
  } catch (error) {
    console.error('Error creating tutor:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.patch('/api/tutors/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid Tutor ID format' });
    }

    const tutor = await tutorsCollection.findOne({ _id: new ObjectId(id) });
    if (!tutor) {
      return res.status(404).json({ message: 'Tutor not found' });
    }

    if (tutor.creatorEmail !== req.user.email) {
      return res.status(403).json({ message: 'You are not authorized to update this tutor' });
    }

    const updates = {};
    const allowedFields = [
      'name', 'photoUrl', 'subject', 'availableDays', 'availableTime', 
      'hourlyFee', 'totalSlot', 'sessionStartDate', 'sessionEndDate', 
      'institution', 'experience', 'location', 'teachingMode'
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === 'hourlyFee') {
          updates[field] = parseFloat(req.body[field]);
        } else if (field === 'totalSlot') {
          updates[field] = parseInt(req.body[field]);
        } else if (field === 'availableDays') {
          updates[field] = Array.isArray(req.body[field]) ? req.body[field] : [req.body[field]];
        } else {
          updates[field] = req.body[field];
        }
      }
    });

    await tutorsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    res.status(200).json({ message: 'Tutor details updated successfully!' });
  } catch (error) {
    console.error('Error updating tutor:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.delete('/api/tutors/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid Tutor ID format' });
    }

    const tutor = await tutorsCollection.findOne({ _id: new ObjectId(id) });
    if (!tutor) {
      return res.status(404).json({ message: 'Tutor not found' });
    }

    if (tutor.creatorEmail !== req.user.email) {
      return res.status(403).json({ message: 'You are not authorized to delete this tutor' });
    }

    await tutorsCollection.deleteOne({ _id: new ObjectId(id) });
    res.status(200).json({ message: 'Tutor deleted successfully!' });
  } catch (error) {
    console.error('Error deleting tutor:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const studentEmail = req.user.email;

    const bookings = await bookingsCollection
      .find({ studentEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const { tutorId, studentName, phone } = req.body;
    const studentEmail = req.user.email;

    if (!tutorId || !studentName || !phone) {
      return res.status(400).json({ message: 'Tutor ID, Student Name, and Phone are required' });
    }

    if (!ObjectId.isValid(tutorId)) {
      return res.status(400).json({ message: 'Invalid Tutor ID format' });
    }

    const tutor = await tutorsCollection.findOne({ _id: new ObjectId(tutorId) });
    if (!tutor) {
      return res.status(404).json({ message: 'Tutor not found' });
    }

    if (tutor.totalSlot <= 0) {
      return res.status(400).json({
        message: 'No available slots left.',
        errorType: 'SLOTS_EMPTY'
      });
    }

    const currentDate = new Date();
    const sessionStartDate = new Date(tutor.sessionStartDate);
    currentDate.setHours(0, 0, 0, 0);
    sessionStartDate.setHours(0, 0, 0, 0);

    if (currentDate < sessionStartDate) {
      return res.status(400).json({
        message: 'Booking is not available yet for this tutor',
        errorType: 'DATE_RESTRICTION'
      });
    }

    if (tutor.sessionEndDate) {
      const sessionEndDate = new Date(tutor.sessionEndDate);
      sessionEndDate.setHours(0, 0, 0, 0);
      if (currentDate > sessionEndDate) {
        return res.status(400).json({
          message: 'The booking window for this tutor has expired',
          errorType: 'DATE_EXPIRED'
        });
      }
    }

    const existingBooking = await bookingsCollection.findOne({
      tutorId: tutor._id.toString(),
      studentEmail,
      status: 'booked'
    });

    if (existingBooking) {
      return res.status(400).json({ message: 'You have already booked a session with this tutor.' });
    }

    const newBooking = {
      tutorId: tutor._id.toString(),
      tutorName: tutor.name,
      studentName,
      studentEmail,
      phone,
      status: 'booked',
      createdAt: new Date()
    };

    const updateResult = await tutorsCollection.updateOne(
      { _id: tutor._id, totalSlot: { $gt: 0 } },
      { $inc: { totalSlot: -1 } }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({
        message: 'This session is fully booked. You can’t join at the moment.',
        errorType: 'SLOTS_EMPTY'
      });
    }

    const bookingResult = await bookingsCollection.insertOne(newBooking);

    res.status(201).json({
      message: 'Booking completed successfully!',
      booking: { _id: bookingResult.insertedId, ...newBooking }
    });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.patch('/api/bookings/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid Booking ID format' });
    }

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.studentEmail !== req.user.email) {
      return res.status(403).json({ message: 'You are not authorized to cancel this booking' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'This booking is already cancelled' });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'cancelled' } }
    );

    if (ObjectId.isValid(booking.tutorId)) {
      await tutorsCollection.updateOne(
        { _id: new ObjectId(booking.tutorId) },
        { $inc: { totalSlot: 1 } }
      );
    }

    res.status(200).json({ message: 'Booking cancelled successfully.' });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server!' });
});

async function run() {
  try {
    await client.connect();
    console.log("Successfully connected to MongoDB!");

    app.listen(PORT, () => {
      console.log(`Server is listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB', err);
  }
}

run().catch(console.dir);
