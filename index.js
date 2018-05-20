'use strict';

const express = require('express');
const P = require('bluebird');
const R = require('ramda');
const logger = require('logger');
const Database = require('./database');
const User = require('./user');
const Question = require('./question');
const log = logger.log;
const yargs = require('yargs');
const bodyParser = require('body-parser');
const { HttpError } = require('./errors');
const auth = require('basic-auth');

const argv = yargs
  .default('log', 'info')
  .choices('log', logger.logLevels)
  .argv;
logger.setThreshold(argv.log);

const app = express();
const db = new Database(logger);

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  log.info(`${req.ip} ${req.method} ${req.originalUrl}`);
  next();
});
app.use(bodyParser.json());

const midBasic = (scope) => {
  if (scope === undefined) {
    return (req, res, next) => {
      req.credentials = {
        user: null
      };
      next();
    }
  }
  
  return (req, res, next) => {
    return P.resolve(auth(req))
      .then(credentials => {
        if (!credentials || !credentials.name || !credentials.pass)
          throw new HttpError('No credentials', 401);
        return db.login(credentials.name, credentials.pass);
      })
      .then((user) => {
        if(user === null)
          throw new HttpError('Unauthorized', 401);
        req.credentials = {
          user
        };
        log.debug(`Successful login, credentials: ${JSON.stringify(req.credentials)}`);
        return next();
      })
      .catch(HttpError, e => {
        log.debug(`Error midBasic: ${e.message}`);
        res.set('WWW-Authenticate', 'Basic realm="localhost:16716"');
        return res.status(401).send();
      });
  }
}

app.crud = function(collection, handlers, permissions) {
  this.get(`/api/${collection}`, midBasic(permissions.getAll),
    (req, res, next) => {
      handlers.getAll.bind(db)(req.credentials).then((values) => res.status(200).json(values.map(val => val.present())))
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.get(`/api/${collection}/:id`, midBasic(permissions.get),
    (req, res, next) => {
      handlers.get.bind(db)(req.params.id, req.credentials)
      .then((val) => res.status(200).json(val.present()))
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.delete(`/api/${collection}/:id`, midBasic(permissions.delete),
    (req, res, next) => {
      handlers.delete.bind(db)(req.params.id, req.credentials).then(() => {
        res.status(204).send();
      })
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.post(`/api/${collection}`, midBasic(permissions.post),
    (req, res, next) => {
      handlers.post.bind(db)(req.body, req.credentials).then((val) => {
        res.status(200).json(val.present());
      })
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
};

app.get('/', (req, res, next) => {
  res.send('Hello Pancake!');
  next();
});

app.get('/api/users/login', midBasic('user'),
  (req, res, next) => {
    if(req.credentials && req.credentials.user && req.credentials.user instanceof User)
      return res.status(204).send(req.credentials.user.present());
    return res.status(401).send('Unauthorized');
  });

app.crud('questions', {
  get: db.getQuestion,
  getAll: db.getQuestions,
  post: db.addQuestion,
  delete: db.deleteQuestion
},
{
  post: 'admin',
  delete: 'admin'
});

app.crud('users', {
  get: db.getUser,
  getAll: db.getUsers,
  post: db.addUser,
  delete: db.deleteUser
},
{
  get: 'user',
  delete: 'admin'
});

const port = 16716;
app.listen(port, () => log.info(`Spaced Learning app listening on port ${port}!`));

