'use strict';

const P = require('bluebird');
const sqlite = require('sqlite3');
const uuid = require('uuid/v4');
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

  checkLoaded() {
    if(!this.loaded)
      throw new Error("Database not loaded");
  }

  resetDb() {
    this.checkLoaded();
    this.db.run("DROP TABLE IF EXISTS questions;")
      .tap(() => log.debug("Table dropped"))
      .then(() => {
        this.db.run("CREATE TABLE questions (id CHAR(36), question TEXT, answer TEXT, PRIMARY KEY (id));")
      })
      .tap(() => log.info(`Database reset complete`))
      .tapCatch(e => {
        log.error(`Error in reset table: ${e.message}`);
      });
  }

  addQuestions({question, answer}) {
    this.checkLoaded();
    log.debug(`Adding ${question} ${answer}`);
    return this.db.runAsync("INSERT INTO questions VALUES (?, ?, ?);", uuid(), question, answer)
      .tap(({lastID}) => {
          log.info(`Question inserted`, `id ${lastID}`);
      })
      .then(({lastID}) => {return this.db.getAsync("SELECT * FROM questions WHERE rowid = ?", lastID);})
      .tapCatch(e => {
        log.error(`Error in addQuestions ${question}: ${e.message}`);
      });
  }

  getQuestions() {
    this.checkLoaded();
    return this.db.allAsync("SELECT * FROM questions;")
      .then((rows) => {
        log.debug(`Questions: ${rows.map(r => JSON.stringify(r))}`);
        return rows;
      })
      .catch(e => {
        log.error(`Error in getQuestions: ${e.message}`);
        throw e;
      });
  }
}

module.exports = Database;
