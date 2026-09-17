// Express 4 does not catch rejected promises from async route handlers —
// an unhandled DB error would otherwise just hang the request instead of
// reaching server.js's error handler. Wrap every async route with this.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
