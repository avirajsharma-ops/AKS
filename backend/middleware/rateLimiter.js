/**
 * Rate Limiter Middleware
 * Prevents abuse with request limiting
 */

const rateLimit = new Map();

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

function rateLimiter(req, res, next) {
  // Skip rate limiting in development
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  // Clean up old entries
  rateLimit.forEach((value, key) => {
    if (now - value.startTime > WINDOW_MS) {
      rateLimit.delete(key);
    }
  });

  // Get or create rate limit entry
  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, {
      count: 1,
      startTime: now
    });
    return next();
  }

  const entry = rateLimit.get(ip);

  // Reset if window has passed
  if (now - entry.startTime > WINDOW_MS) {
    entry.count = 1;
    entry.startTime = now;
    return next();
  }

  // Check if limit exceeded
  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.startTime)) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter
    });
  }

  // Increment count
  entry.count++;
  next();
}

module.exports = { rateLimiter };
