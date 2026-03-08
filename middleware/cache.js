const redisClient = require('../config/redis');

const cacheMiddleware = (duration) => {
  return async (req, res, next) => {
    const key = req.originalUrl || req.url;

    try {
      const cachedData = await redisClient.get(key);
      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }

      const originalSend = res.send;
      res.send = function (data) {
        if (res.statusCode === 200 && data) {
          redisClient.setex(key, duration, JSON.stringify(data));
        }
        originalSend.call(this, data);
      };

      next();
    } catch (err) {
      console.error('Cache error:', err);
      next();
    }
  };
};

module.exports = cacheMiddleware;
