'use strict';

const P = require('bluebird');
const crypto = P.promisifyAll(require('crypto'));
const sqlite = require('sqlite3');
const uuid = require('uuid/v4');
const { HttpError } = require('../errors');
const User = require('../user');
const Question = require('../question');
const Privilege = require('../user/privilege');
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

  getUser(id, credentials) {
    log.debug(`Getting user ${id}`);
    return P.try(() => {
        if(!credentials || !credentials.user || !(credentials.user instanceof User))
          throw new HttpError('No credentials found', 401);
        if(credentials.user.id != id) {
          log.error(`User ${credentials.user.id} attempting to read user ${id}`);
          throw new HttpError('Unauthorized', 401);
        }
      })
      .then(() => this.db.getAsync("SELECT * FROM users WHERE id = ?", id))
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
      .then(row => new User(row));
  }

  login(username, password) {
    log.debug(`${username} logging in with ${password}`);
    return this.getUserByUsername(username)
      .tap((user) => log.debug(`${user.toString()} trying to log in`))
      .then((user) => P.props({
        success: user.hasPassword(password),
        user
      }))
      .then(({user, success}) => {
        if (!success)
          throw new HttpError('Invalid credentials', 401);
        return user;
      })
      .then((user) => P.props({
        user,
        token: crypto.randomBytesAsync(16)
      }))
      .then(({user, token}) => {
        user.token = token.toString('hex');
        return this.getPrivileges(user.id)
        .then(user.addPrivileges.bind(user))
        .then(() => user);
      })
      .tap((user) => this.db.runAsync("INSERT INTO sessions VALUES (?, ?, ?, ?);", uuid(), user.id, 'AVAILABLE', user.token))
      .tap((user) => log.highlight(`Session created with token ${user.token}`))
      .catch((err) => {
        throw new HttpError(err.message, 401);
      });
  }

  getPrivileges(userId) {
    return this.db.allAsync("\
        SELECT p.* FROM privileges p\
        INNER JOIN users_privileges up ON p.id = up.privilege_id\
        WHERE up.user_id = ?;", userId)
      .then(rows => {
        return rows.map(row => new Privilege(row));
      })
      .catch((err) => {
        throw new HttpError(err.message, 400);
      });
  }

  oauth2(token) {
    log.debug(`Logging in with token ${token}`);
    return this.db.getAsync(
      "SELECT users.* FROM sessions\
      INNER JOIN users ON (users.id = sessions.user_id)\
      WHERE users.status = ?\
      AND sessions.status = ?\
      AND token = ?;", 'AVAILABLE', 'AVAILABLE', token)
      .then((row) => {
        if (row === undefined)
          throw new HttpError('Token not found', 401);
        const user = new User(row);
        log.debug(`User ${user} logged in`);
        return this.getPrivileges(user.id)
          .then(user.addPrivileges.bind(user))
          .then(() => user);
      });
  }

  addQuestion({question, answer}) {
    const myQuestion = new Question({question, answer});
    log.debug(`Adding ${myQuestion.toString()}`);
    return myQuestion.complete()
      .then(() => this.db.runAsync("INSERT INTO questions VALUES (?, ?, ?, ?);", myQuestion.id, 'AVAILABLE', myQuestion.question, myQuestion.answer))
      .tap(({lastID}) => {
          log.debug(`Question inserted`, `id ${lastID}`);
      })
//      .then(({lastID}) => this.db.getAsync("SELECT * FROM questions WHERE rowid = ?", lastID))
      .then(() => myQuestion)
      .catch(e => {
        log.error(`Error in addQuestion ${myQuestion.toString()}: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  getAllUserQuestions(credentials) {
    return this.db.allAsync(
        "SELECT questions.*, users_questions.nb_correct, users_questions.nb_wrong\
        FROM users_questions\
        JOIN questions ON (questions.id = users_questions.question_id)\
        AND users_questions.user_id = ?\
        AND questions.status = ?;", credentials.user.id, 'AVAILABLE')
      .then(rows => rows.map(row => new Question(row)))
    .catch(e => {
      log.error(`Error in getAllUserQuestions: ${e.message}`);
      throw new HttpError(e.message, 400);
    });
  }

  getAllQuestions() {
    return this.db.allAsync("SELECT * FROM questions WHERE status = ?;", 'AVAILABLE')
      .tap((rows) => {
        log.debug(`Questions: ${rows.map(r => JSON.stringify(r))}`);
        return rows;
      })
      .then((rows) => rows.map(row => new Question(row)))
      .catch(e => {
        log.error(`Error in getAllQuestions: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  updateQuestion(questionId, {question, answer}) {
    return this.db.runAsync("\
        UPDATE questions SET question = ?, answer = ?\
        WHERE id = ?;",
        question, answer, questionId)
      .then(() => {
        return this.db.getAsync("SELECT * FROM questions WHERE id = ?;", questionId); 
      })
      .then((row) => {
        if(row === undefined)
          throw new HttpError(`Unknown question id ${questionId}`, 400);
        return new Question(row);
      })
      .catch(e => {
        log.error(`Error in updateQuestion: ${e.message}`);
        throw new HttpError(e.message, 400);
      });
  }

  getQuestion(id) {
    return this.db.getAsync("SELECT * FROM questions WHERE id = ? AND status = ?;", id, 'AVAILABLE')
      .catch(e => {
        log.error(`Error in getQuestion: ${e.message}`);
        throw new HttpError(e.message, 400);
      })
      .tap((question) => {
        log.debug(`Question: ${JSON.stringify(question)}`);
      })
      .tap((question) => {
        if(question === undefined)
          throw new HttpError("question not found", 404);
      })
      .then((question) => new Question(question));
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

  getStats(userId, questionId) {
    return this.db.getAsync("SELECT * FROM users_questions WHERE user_id = ? and question_id = ?;", userId, questionId)
      .tap(row => log.debug(`getStats: ${JSON.stringify(row)}`))
  }

  addStats(userId, questionId, correct) {
    return this.db.runAsync("INSERT INTO users_questions VALUES (?, ?, ?, ?);", userId, questionId, correct ? 1 : 0, correct ? 0 : 1)
      .tap(({lastID}) => log.debug(`addStats: row ${lastID} added`));
  }

  updateStats(user, questionId, {correct}) {
    return this.getStats(user.id, questionId)
      .then(row => {
        if (row === undefined) {
          return this.addStats(user.id, questionId, correct);
        }
        const field = (correct ? 'nb_correct' : 'nb_wrong');
        return this.db.runAsync(`UPDATE users_questions SET ${field} = ${field} + 1 WHERE user_id = ? AND question_id = ?;`, user.id, questionId);
      })
      .tap(({changes}) => log.debug(`updateStats: ${changes} rows updated`))
      .then(({changes}) => {
        if (changes != 1) {
          log.error(`updateStats: ${changes} rows updated`);
          throw new HttpError(`updateStats: ${changes} rows updated`, 400);
        }
        return;
      });
  }
}

module.exports = Database;
