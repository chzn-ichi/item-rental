require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas!');
    return mongoose.disconnect();
  })
  .catch((err) => console.error('Connection failed:', err.message));