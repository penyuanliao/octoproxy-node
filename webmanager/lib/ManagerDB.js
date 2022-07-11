"use strict";
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const sqlite3       = require('sqlite3').verbose();
const NSLog         = require('fxNetSocket').Logger.getInstance();
/**
 *
 * @constructor
 */
class ManagerDB extends EventEmitter {
    constructor(filepath) {
        super();
        this.syntax = new Syntax();
        this.db = this.setup(filepath);
    }
}

ManagerDB.prototype.setup = function (filepath) {
    if (!filepath) filepath = ".";
    let src = `${filepath}/manager.db`;

    NSLog.info(`ManagerDB src: ${src}`);
    const db = new sqlite3.Database(src);
    db.serialize(() => {
        db.run(this.syntax.createTableAccount());
    });
    return db;
};

ManagerDB.prototype.insertAccount = async function (json) {

    return await this.asyncRun(this.syntax.insertAccount(json));
};

ManagerDB.prototype.updateAccount = async function (json) {
    return await this.asyncRun(this.syntax.updateAccount(json));
};

ManagerDB.prototype.flushToken = async function (json) {
    return await this.asyncRun(this.syntax.updateToken(json));
}

ManagerDB.prototype.getAccounts = async function () {
    return await this.asyncAll(this.syntax.selectAccounts());
};

ManagerDB.prototype.getUser = async function (username) {
    const data = await this.asyncAll(this.syntax.selectAccounts(username));
    if (!data.length) {
        return false;
    } else {
        return data[0];
    }
};
ManagerDB.prototype.updateSecret = async function (username, otp) {
    return await this.asyncRun(this.syntax.updateSecret({username, otp}));
};
ManagerDB.prototype.getSecret = async function (username) {
    return await this.asyncGet(this.syntax.secret({username}));
};

ManagerDB.prototype.asyncRun = function (sql) {
    return new Promise((resolve, reject) => {
        this.db.run(sql, (err, res) => {
            if (err) reject(err);
            else {
                resolve(res);
            }
        });
    })
};
ManagerDB.prototype.asyncAll = function (sql) {
    return new Promise((resolve, reject) => {
        this.db.all(sql, (err, res) => {
            if (err) reject(err);
            else {
                resolve(res);
            }
        });
    })
}
ManagerDB.prototype.asyncEach = function (sql, {key, value}) {
    return new Promise((resolve, reject) => {
        this.db.each(sql, (err, row) => {
            if (err) reject(err);
            else {
                if (value === row[key]) resolve(row);
            }
        });
    })
};
ManagerDB.prototype.asyncGet = function (sql) {
    return new Promise((resolve, reject) => {
        this.db.get(sql, (err, res) => {
            if (err) reject(err);
            else {
                resolve(res);
            }
        });
    })
}
ManagerDB.prototype.clean = function () {

};
ManagerDB.prototype.release = function () {

};
class Syntax {
    constructor() {
    };
    createTableAccount() {
        return `
        CREATE TABLE IF NOT EXISTS accounts (
            id       INTEGER        NOT NULL PRIMARY KEY,
            username varchar(50)    NOT NULL UNIQUE,
            password TEXT           NOT NULL,
            token    TEXT           NULL,
            otp      TEXT           DEFAULT ''
        )`;
    };
    insertAccount({username, password}) {
        return `INSERT INTO accounts VALUES (NULL, '${username}', '${password}', NULL, '' )`;
    };
    updateAccount({password, username}) {
        return `UPDATE accounts SET password='${password}' WHERE username='${username}'`;
    };
    updateToken({username, token}) {
        return `UPDATE accounts SET token='${token}' WHERE username='${username}'`;
    };
    updateSecret({username, otp}) {
        return `UPDATE accounts SET otp='${otp}' WHERE username='${username}'`;
    };
    secret({username}) {
        return `SELECT username, otp FROM accounts WHERE username = '${username}'`;
    };
    selectAccounts(username) {
        if (username) {
            return `SELECT * FROM accounts WHERE username = '${username}'`;
        } else {
            return `SELECT * FROM accounts`;
        }

    };
    createTableTokens() {
        return `
        CREATE TABLE IF NOT EXISTS tokens (
            id       INTEGER        NOT NULL PRIMARY KEY,
            username varchar(50)    NOT NULL
            token    TEXT,
            exp      INTEGER
            invaild  BLOB
        )`;
    };

}

module.exports = exports = ManagerDB;