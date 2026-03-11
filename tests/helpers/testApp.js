require('../setup/testEnv');

const supertest = require('supertest');
const { app } = require('../../server');

const createApiClient = () => supertest(app);
const createApiAgent = () => supertest.agent(app);

module.exports = {
  app,
  createApiClient,
  createApiAgent,
};
