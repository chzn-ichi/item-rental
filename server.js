require('dotenv').config();

// Optional: only needed on networks where the default DNS can't resolve mongodb+srv:// addresses
if (process.env.DNS_SERVERS) {
  require('dns').setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
}

const path = require('path');
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const connectDB = require('./config/db');
const { exposeUser } = require('./middleware/auth');
const { startReminderJob } = require('./utils/reminders');

const app = express();

// Views (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.helpers = require('./utils/helpers');

// Parse form data and serve css/js from /public
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions, stored in Atlas so logins survive server restarts
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

app.use(exposeUser);

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/student'));
app.use('/admin', require('./routes/admin'));


const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
  startReminderJob();
});