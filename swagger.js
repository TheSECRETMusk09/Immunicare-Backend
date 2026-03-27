const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const resolveSwaggerServers = () => {
  const configuredUrls = [
    process.env.API_BASE_URL,
    process.env.BACKEND_URL,
    process.env.PUBLIC_API_URL,
  ]
    .map((value) => String(value || '').trim())
    .filter((value) => value.length > 0 && isValidHttpUrl(value));

  if (configuredUrls.length > 0) {
    return configuredUrls.map((url) => ({
      url,
      description: 'Configured API server',
    }));
  }

  return [
    {
      url: 'http://localhost:3001',
      description: 'Development server',
    },
  ];
};

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Immunicare API',
      version: '1.0.0',
      description: 'API documentation for Immunicare system'
    },
    servers: resolveSwaggerServers()
  },
  apis: ['./routes/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
};
