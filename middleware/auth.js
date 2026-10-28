// Must be logged in
function isLoggedIn(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// Must be an admin; students get sent to their own dashboard
function isAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  if (req.session.role === 'admin') return next();
  res.redirect('/dashboard');
}

// Must be a student; admins get sent to the admin dashboard
function isStudent(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  if (req.session.role === 'student') return next();
  res.redirect('/admin/dashboard');
}

// Makes the logged-in user's info available in every EJS page
function exposeUser(req, res, next) {
  res.locals.currentUser = req.session.userId
    ? {
        id: req.session.userId,
        name: req.session.userName,
        email: req.session.email,
        role: req.session.role,
      }
    : null;
  next();
}

module.exports = { isLoggedIn, isAdmin, isStudent, exposeUser };