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
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  log.info(`${req.ip} ${req.method} ${req.originalUrl}`);
  next();
});
app.use(bodyParser.json());

const midBasic = (scope) => {
  if (scope === undefined)
    return (req, res, next) => next();
  
  return (req, res, next) => {
    return P.resolve(auth(req))
      .then(user => {
        if (!user || !user.name || !user.pass)
          throw new HttpError('No username', 401);
        return db.login(user.name, user.pass);
      })
      .then(({success}) => {
        if(!success)
          throw new HttpError('No username', 401);
        log.highlight("Successful login");
        return next();
      })
      .catch(HttpError, e => {
        res.set('WWW-Authenticate', 'Basic realm="localhost:16716"');
        return res.status(401).send();
      });
  }
}

app.crud = function(collection, handlers, permissions) {
  this.get(`/api/${collection}`, midBasic(permissions.getAll),
    (req, res, next) => {
      handlers.getAll.bind(db)().then((values) => res.status(200).json(values.map(val => val.present())))
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.get(`/api/${collection}/:id`, midBasic(permissions.get),
    (req, res, next) => {
      handlers.get.bind(db)(req.params.id)
      .then((val) => res.status(200).json(val.present()))
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.delete(`/api/${collection}/:id`, midBasic(permissions.delete),
    (req, res, next) => {
      handlers.delete.bind(db)(req.params.id).then(() => {
        res.status(204).send("OK");
      })
      .catch(HttpError, e => {
        res.status(e.statusCode).send(e.message);
      });
    }
  );
  this.post(`/api/${collection}`, midBasic(permissions.post),
    (req, res, next) => {
      handlers.post.bind(db)(req.body).then((val) => {
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
  delete: 'admin'
});

app.post('/api/users',
  (req, res, next) => {
    db.addUser(req.body).then((val) => {
      res.status(200).json(val);
    })
    .catch(HttpError, e => {
      res.status(e.statusCode).send(e.message);
    });
  }
)

const port = 16716;
app.listen(port, () => log.info(`Spaced Learning app listening on port ${port}!`));

