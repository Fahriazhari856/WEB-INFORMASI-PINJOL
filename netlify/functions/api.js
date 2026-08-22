'use strict';

const serverless = require('serverless-http');
const { createApp } = require('../../server/app');

const app = createApp({ production: true });

module.exports.handler = serverless(app);
