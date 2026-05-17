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
