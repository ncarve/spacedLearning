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

const domain = 'localhost:16716';

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  log.info(`${req.ip} ${req.method} ${req.originalUrl}`);
  next();
});
app.use(bodyParser.json());

const midAuth = (scope, scheme) => {
  if (scope === undefined) {
    return (req, res, next) => {
      req.credentials = {
        user: null
      };
      next();
    }
  }
  const actualScheme = scheme || 'oauth2';
  switch(actualScheme.toLowerCase()) {
    case 'basic':
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
              if (!user.hasPrivilege(scope))
                throw new HttpError('Insufficient privileges', 401);
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
      };
      break;
    case 'oauth2':
      return (req, res, next) => {
          return P.try(() => {
            if (!req.get('Authorization'))
              throw new HttpError('Unauthorized', 401);
            const token = req.get('Authorization')
              .toLowerCase()
              .replace(/^bearer ([0-9a-f]*$)/, '$1');
            return db.oauth2(token);
          })
          .then(user => {
            if (!user)
              throw new HttpError('Unauthorized', 401);
            if (!user.hasPrivilege(scope))
              throw new HttpError('Insufficient privileges', 401);
            req.credentials = {
              user
            };
            log.debug(`Successful login, credentials: ${JSON.stringify(req.credentials)}`);
            return next();
          })
          .catch(e => {
            log.error(`Error mid-oauth2: ${e.message}`);
            res.set('Content-Location', '/api/users/login');
            res.set('WWW-Authenticate', `Basic realm="${domain}"`);
            return res.status(401).send('Unauthorized');
          });
      };
    default:
      return (req, res, next) => res.status(401).send('Unauthorized');
  }
}

app.crud = function(collection, handlers, permissions, schemes) {
  if (handlers.getAllExtra && permissions.getAllExtra) {
    this.get(`/api/${permissions.getAllExtra}/${collection}`, midAuth(permissions.getAllExtra, schemes.getAllExtra),
      (req, res, next) => {
        handlers.getAllExtra.bind(db)(req.credentials).then((values) => res.status(200).json(values.map(val => val.present())))
        .catch(HttpError, e => {
          res.status(e.statusCode).send(e.message);
        });
      }
    );
  }
  this.get(`/api/${collection}`, midAuth(permissions.getAll, schemes.getAll),
    (req, res, next) => {
      handlers.getAll.bind(db)(req.credentials).then((values) => res.status(200).json(values.map(val => val.present())))
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.get(`/api/${collection}/:id([0-9a-f-]+)`, midAuth(permissions.get, schemes.get),
    (req, res, next) => {
      handlers.get.bind(db)(req.params.id, req.credentials)
      .then((val) => res.status(200).json(val.present()))
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.delete(`/api/${collection}/:id([0-9a-f-]+)`, midAuth(permissions.delete, schemes.delete),
    (req, res, next) => {
      handlers.delete.bind(db)(req.params.id, req.credentials).then(() => {
        res.status(204).send();
      })
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.post(`/api/${collection}`, midAuth(permissions.post, schemes.post),
    (req, res, next) => {
      handlers.post.bind(db)(req.body, req.credentials).then((val) => {
        res.status(200).json(val.present());
      })
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.put(`/api/${collection}/:id([0-9a-f-]+)`, midAuth(permissions.put, schemes.put),
    (req, res, next) => {
      handlers.put.bind(db)(req.params.id, req.body, req.credentials).then((val) => {
        res.status(200).json(val.present());
      })
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
};

app.get('/', (req, res, next) => {
  return res.send('Hello Pancake!');
});

app.post('/api/users/login', midAuth('user', 'basic'), (req, res, next) => {
  if(req.credentials && req.credentials.user && req.credentials.user instanceof User)
    return res.status(200).send(req.credentials.user.present());
  return res.status(401).send('Unauthorized');
});

app.post('/api/questions/:questionId([0-9a-f-]+)/submit', midAuth('user'), (req, res, next) => {
  db.updateStats(req.credentials.user, req.params.questionId, req.body)
    .then(() => {
      res.status(204).send();
    })
    .catch(HttpError, err => {
      res.status(err.statusCode).send(err.message);
    });
});

app.crud('questions', {
  get: db.getQuestion,
  getAll: db.getAllQuestions,
  getAllExtra: db.getAllUserQuestions,
  post: db.addQuestion,
  put: db.updateQuestion,
  delete: db.deleteQuestion
},
{
  getAllExtra: 'user',
  post: 'admin',
  put: 'admin',
  delete: 'admin'
},
{});

app.crud('users', {
  get: db.getUser,
  getAll: db.getUsers,
  post: db.addUser,
  delete: db.deleteUser
},
{
  get: 'user',
  delete: 'admin'
},
{});

const port = 16716;
app.listen(port, () => log.info(`Spaced Learning app listening on port ${port}!`));

