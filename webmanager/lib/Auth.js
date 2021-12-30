"use strict";
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const crypto        = require('crypto');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const ManagerDB     = require("./ManagerDB.js");
const NSLog         = require("fxNetSocket").logger.getInstance();

/**
 * 使用者權限
 * @constructor
 */
class Auth extends EventEmitter {
    constructor() {
        super();
        this.db = new ManagerDB();
        // this.test();

    }
}
Auth.prototype.test = async function () {
    const data = await this.register({
        username: "newflash@mail.chungyo.net",
        password: "password1"
    });
    console.log('data->', data);
    const token = await this.login({
        username: "newflash@mail.chungyo.net",
        password: "password1"
    });
    console.log('token', token);
}
Auth.prototype.register = async function ({username, password}) {
    return await this.db.insertAccount({
        username: username,
        password: await this.hash(password)
    }).catch((err) => {
        NSLog.log("error", "User '%s' Registration failed. err: %s", username, err);
        return false;
    });
};
/**
 * 登入系統
 * @param username
 * @param password
 * @return {Promise<*|boolean>}
 */
Auth.prototype.login = async function ({username, password}) {

    let {valid, user} = await this.verify({username, password});

    if (valid) {
        const payload = {
            username,
            exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1hour
        };
        const options = {};
        let token = jwt.sign(payload, 'sidonia', options);
        await this.db.flushToken({token, username}); //刷新
        return token;
    }
    return false;
};
Auth.prototype.logout = async function ({username}) {
    await this.db.flushToken({
        username,
        token: null
    });
    return true;
};
Auth.prototype.verify = async function ({username, password}) {
    let user = await this.db.getUser(username);
    let valid = false;
    if (user) {
        valid = await bcrypt.compare(password, user.password);
    }
    NSLog.log("info",` - user ${username} valid:${valid}`);
    return {user, valid};
};
/**
 * 驗證jwt token
 * @param username
 * @param token
 * @return {Promise<*|boolean>}
 */
Auth.prototype.verify2 = async function ({username, token}) {
    // let currentToken = await this.getToken(username);
    // if (currentToken != token) return false;
    return await this.jwtVerify(token);
};
/**
 * 取得當下token
 * @param username
 * @return {Promise<string|*|string|null>}
 */
Auth.prototype.getToken = async function (username) {
    let user = await this.db.getUser(username);
    if (user) {
        return user.token;
    } else {
        return null;
    }
}
/**
 * 驗證token
 * @param token
 * @return {Promise}
 */
Auth.prototype.jwtVerify = function (token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, 'sidonia', (err, decoded) => {

            if (err) {
                // console.log(err.message);
                resolve({result: false, error: err.message});
            }
            else {
                // console.log(decoded);
                resolve({result: true, data: decoded});
            }
        });
    })
};
Auth.prototype.hash = function (pwd) {
    return new Promise((resole, reject) => {
        bcrypt.hash(pwd, 10, (err, hash) => {
            if (err) reject(err);
            else resole(hash);
        });
    });
}
module.exports = exports = Auth;
if (process.env.NODE_ENV == 'test') {
    const auth = new Auth();
    auth.test();
}