'use strict';

const express = require('express');
const P = require('bluebird');
const R = require('ramda');
const logger = require('./logger');
const Database = require('./questions.js');
const log = logger.log;
const yargs = require('yargs');
const bodyParser = require('body-parser');

const argv = yargs
  .default('log', 'info')
  .choices('log', logger.logLevels)
  .argv;
logger.setThreshold(argv.log);

const app = express();

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  log.info(`${req.ip} ${req.method} ${req.originalUrl}`);
  next();
});
app.use(bodyParser.json());

app.get('/', (req, res, next) => {
  res.send('Hello Pancake!');
  next();
});
app.get('/api/questions',
  (req, res, next) => {
    questions.getQuestions().then((val, ...args) => res.json(val));
  }
);
app.post('/api/questions',
  async (req, res, next) => {
    questions.addQuestions(req.body).then((val) => {
      res.status(200);
      res.json(val);
    });
  }
);

const port = 16716;
app.listen(port, () => log.info(`Spaced Learning app listening on port ${port}!`));

const questions = new Database(logger);
