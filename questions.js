'use strict';

const P = require('bluebird');
const sqlite = require('sqlite3');
const uuid = require('uuid/v4');
const { HttpError } = require('./errors.js');
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
      .tapCatch(e => {
        log.error(`Error in reset table: ${e.message}`);
      });
  }

  addQuestions({question, answer}) {
    log.debug(`Adding ${question} ${answer}`);
    return this.db.runAsync("INSERT INTO questions VALUES (?, ?, ?, ?);", uuid(), 'AVAILABLE', question, answer)
      .tap(({lastID}) => {
          log.debug(`Question inserted`, `id ${lastID}`);
      })
      .then(({lastID}) => {return this.db.getAsync("SELECT * FROM questions WHERE rowid = ?", lastID);})
      .tapCatch(e => {
        log.error(`Error in addQuestions ${question}: ${e.message}`);
      });
  }

  getQuestions() {
    return this.db.allAsync("SELECT * FROM questions WHERE status = 'AVAILABLE';")
      .then((rows) => {
        log.debug(`Questions: ${rows.map(r => JSON.stringify(r))}`);
        return rows;
      })
      .tapCatch(e => {
        log.error(`Error in getQuestions: ${e.message}`);
      });
  }

  getQuestion(id) {
    return this.db.getAsync("SELECT * FROM questions WHERE id = ? AND status = 'AVAILABLE';", id)
      .tap((question) => {
        log.debug(`Question: ${JSON.stringify(question)}`);
      })
      .tap((question) => {
        if(question === undefined)
          throw new HttpError("question not found", 404);
      })
      .tapCatch(e => {
        log.error(`Error in getQuestion: ${e.message}`);
      });
  }

  realDeleteQuestion(id) {
    return this.db.runAsync("DELETE FROM questions WHERE id = ?;", id)
      .tap((that) => {
        log.debug(`Delete: ${that.changes} row(s) deleted (${id})`);
      })
      .tapCatch(e => {
        log.error(`Error in deleteQuestions: ${e.message}`);
      });
  }

  deleteQuestion(id) {
    return this.db.runAsync("UPDATE questions SET status = 'DELETED' WHERE id = ? AND status = 'AVAILABLE';", id)
      .tap((that) => {
        log.debug(`Delete: ${that.changes} row(s) marked as deleted (${id})`);
      })
      .tapCatch(e => {
        log.error(`Error in deleteQuestions: ${e.message}`);
      });
  }
}

module.exports = Database;
