const {
  httpRequestDurationMicroseconds,
  activeRequests,
  errorCounter
} = require('../config/monitoring');

const monitoringMiddleware = (req, res, next) => {
  const start = process.hrtime();
  activeRequests.inc();

  res.on('finish', () => {
    const duration = process.hrtime(start);
    const durationInSeconds = duration[0] + duration[1] / 1e9;

    // Safely get route path - handle cases where route is not defined
    const routePath = req.route?.path || req.path || 'unknown';

    try {
      httpRequestDurationMicroseconds
        .labels(req.method, routePath, res.statusCode)
        .observe(durationInSeconds);

      if (res.statusCode >= 400) {
        errorCounter.labels(req.method, routePath, res.statusCode).inc();
      }
    } catch (metricError) {
      // Don't let metrics errors affect request handling
      console.warn('Metrics recording error:', metricError.message);
    }

    activeRequests.dec();
  });

  next();
};

module.exports = monitoringMiddleware;
