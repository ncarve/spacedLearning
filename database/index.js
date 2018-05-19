'use strict';

const P = require('bluebird');
const crypto = P.promisifyAll(require('crypto'));
const sqlite = require('sqlite3');
const uuid = require('uuid/v4');
const { HttpError } = require('../errors');
const User = require('../user');
const Question = require('../question');
let log;

const Database = class {

  constructor(logger) {
    ({log} = logger);
    log.info("Starting component");
    P.fromNode(cb => {
      this.db = new sqlite.Database('data/data.sqlite', cb);
      this.promisifyDb();
    }).then(() =>
      {
        this.loaded = true;
        log.info(`Database loaded`);
      })
      .tapCatch(e => {
        log.error(`Error in init: ${e.message}`);
      });
    this.loaded = false;
    log.info("DB initiated");
    return;
  }

  promisifyDb() {
    this.db.runAsync = (query, ...params) => P.fromCallback(cb => {
        this.db.run(query, ...params, function(err) {
          cb(err, this);
        });
      });
    this.db.allAsync = P.promisify(this.db.all);
    this.db.getAsync = P.promisify(this.db.get);
  }

  resetDb() {
    this.db.run("DROP TABLE IF EXISTS questions;")
      .tap(() => log.debug("Table dropped"))
      .then(() => {
        this.db.run("CREATE TABLE questions (id CHAR(36), status TEXT, question TEXT, answer TEXT, PRIMARY KEY (id));")
      })
      .tap(() => log.info(`Database reset complete`))
      .catch(e => {
        log.error(`Error in reset table: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  addUser({username, password}) {
    const user = new User(username, password);
    log.debug(`Adding ${user.toString()}`);
    return user.complete()
      .tap(() => log.debug(`User: ${user.toString()}`))
      .then(() => {
        this.db.runAsync("INSERT INTO users VALUES (?, ?, ?, ?);",
          user.id,
          user.username,
          user.pwhashBytes.toString('base64'),
          user.saltBytes.toString('base64'));
      })
      .tap(({lastID}) => {
          log.debug(`User inserted`, `rowid ${lastID}`);
      })
      .then(() => user)
      // .then(({lastID}) => this.db.getAsync("SELECT * FROM users WHERE rowid = ?", lastID))
      // .then((row) => {
      //   id, username
      // })
      .catch(e => {
        log.error(`Error in addUser ${username}: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  getUser(id) {
    log.debug(`Getting user ${id}`);
    return this.db.getAsync("SELECT * FROM users WHERE id = ?", id)
      .catch(e => {
        log.error(`Error in getUser ${id}: ${e.message}`);
        throw new HttpError(e.message, 400);
      })
      .tap(row => {
        if (row === undefined)
          throw new HttpError(`User ${id} not found`, 404);
      })
      .then(row => new User(row));
  }

  getUsers() {
    log.debug(`Getting all users`);
    return this.db.allAsync("SELECT * FROM users")
      .then(rows => rows.map(row => new User(row)))
      .catch(e => {
        log.error(`Error in getUsers: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  deleteUser(id) {
    return this.db.runAsync("UPDATE users SET status = ? WHERE id = ? AND status = ?;", 'DELETED', id, 'AVAILABLE')
      .tap((that) => {
        log.debug(`Delete: ${that.changes} row(s) marked as deleted (${id})`);
      })
      .then(that => {
        if (that.changes == 0) {
          throw new HttpError(`Delete: ${that.changes} row(s) marked as deleted (${id})`, 404);
        } else if (that.changes > 1) {
          throw new Error(`Delete: ${that.changes} row(s) marked as deleted (${id})`, 400);
        }
      })
      .catch(e => {
        log.error(`Error in deleteQuestions: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  getUserByUsername(username) {
    log.debug(`Getting info for ${username}`);
    return this.db.getAsync("SELECT * FROM users WHERE username = ?", username)
      .catch(e => {
        log.error(`Error in getUserByUsername ${username}: ${e.message}`);
        throw new HttpError(e.message, 400);
      })
      .tap(row => {
        if (row === undefined)
          throw new HttpError(`User ${username} not found`, 404);
      })
      then(row => new User(row));
  }

  login(username, password) {
    log.debug(`${username} logging in with ${password}`);
    return this.getUserByUsername(username)
      .then((user) => user.hasPassword(password))
      .then(success => ({success}));
  }

  addQuestion({questionString, answerString}) {
    const question = new Question({questionString, answerString});
    log.debug(`Adding ${question.toString()}`);
    return question.complete()
      .then(() => this.db.runAsync("INSERT INTO questions VALUES (?, ?, ?, ?);", question.id, 'AVAILABLE', question.question, question.answer))
      .tap(({lastID}) => {
          log.debug(`Question inserted`, `id ${lastID}`);
      })
//      .then(({lastID}) => this.db.getAsync("SELECT * FROM questions WHERE rowid = ?", lastID))
      .then(() => question)
      .catch(e => {
        log.error(`Error in addQuestion ${question.toString()}: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  getQuestions() {
    return this.db.allAsync("SELECT * FROM questions WHERE status = ?;", 'AVAILABLE')
      .tap((rows) => {
        log.debug(`Questions: ${rows.map(r => JSON.stringify(r))}`);
        return rows;
      })
      .then((rows) => rows.map(row => new Question(row)))
      .catch(e => {
        log.error(`Error in getQuestions: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  getQuestion(id) {
    return this.db.getAsync("SELECT * FROM questions WHERE id = ? AND status = ?;", id, 'AVAILABLE')
      .tap((question) => {
        log.debug(`Question: ${JSON.stringify(question)}`);
      })
      .tap((question) => {
        if(question === undefined)
          throw new HttpError("question not found", 404);
      })
      .then((question) => new Question(question))
      .catch(e => {
        log.error(`Error in getQuestion: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  // realDeleteQuestion(id) {
  //   return this.db.runAsync("DELETE FROM questions WHERE id = ?;", id)
  //     .tap((that) => {
  //       log.debug(`Delete: ${that.changes} row(s) deleted (${id})`);
  //     })
  //     .catch(e => {
  //       log.error(`Error in deleteQuestions: ${e.message}`);
  //       throw new HttpError(e.message, 400);
  //     });
  // }

  deleteQuestion(id) {
    return this.db.runAsync("UPDATE questions SET status = ? WHERE id = ? AND status = ?;", 'DELETED', id, 'AVAILABLE')
      .tap((that) => {
        log.debug(`Delete: ${that.changes} row(s) marked as deleted (${id})`);
      })
      .catch(e => {
        log.error(`Error in deleteQuestions: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }
}

module.exports = Database;
