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
        this.db = new ManagerDB(process.cwd());
        this.test();
    }
    async test() {
        const username = "newflash@mail.chungyo.net";
        const password = "nanhvw8Y";
        const permission = 0;
        let user = await this.db.getUser(username);
        if (!user) {
            await this.register({ username, password, permission });
        }
    };
    async register({username, password, permission}) {
        if (typeof permission != "number") permission = 0;
        return await this.db.insertAccount({
            username: username,
            password: await this.hash(password),
            permission
        }).catch((err) => {
            NSLog.log("error", "User '%s' Registration failed. err: %s", username, err);
            return false;
        });
    };
    /**
     * 更換密碼
     * @param {String} username
     * @param {String} password
     * @param {String} newPassword
     * @param {Object} authorization
     * @return {Promise<*|boolean>}
     */
    async changePassword({password, newPassword, authorization}) {

        let {result, data} = await this.jwtVerify(authorization);
        if (!result || newPassword.length < 8) return false;
        let { username } = data;
        let {valid, user, twoFactor} = this.verify({username, password})
        if (valid) {
            return await this.db.updateAccount({
                username: username,
                password: await this.hash(newPassword)
            }).catch((err) => {
                NSLog.log("error", "User '%s' Change Password failed. err: %s", username, err);
                return false;
            });
        } else {
            return false;
        }
    };
    /**
     * 登入系統
     * @param username
     * @param password
     * @return {Promise<*|boolean>}
     */
    async login({username, password}) {

        let {valid, user, twoFactor} = await this.verify({username, password});

        if (valid) {
            const payload = {
                username,
                exp: Math.floor(Date.now() / 1000) + (60 * 60), // 1hour
                twoFactor,
                otpauth: false
            };
            const options = {};
            let token = jwt.sign(payload, 'sidonia', options);
            await this.db.flushToken({token, username}); //刷新
            return token;
        }
        return false;
    };
    async otpAuth(payload) {
        const {username} = payload;
        payload.otpauth = true;
        const options = {};
        let token = jwt.sign(payload, 'sidonia', options);
        await this.db.flushToken({token, username}); //刷新
        return token;
    };
    async logout({username}) {
        await this.db.flushToken({
            username,
            token: null
        });
        return true;
    };
    /**
     * 驗證使用者
     * @param username
     * @param password
     * @return {Promise<{valid: boolean, twoFactor: boolean, user: (boolean|*)}>}
     */
    async verify({username, password}) {
        let user = await this.db.getUser(username);
        let valid = false;
        let twoFactor = false;
        if (user) {
            valid = await bcrypt.compare(password, user.password);
            twoFactor = (user.otp != '');
        }

        NSLog.log("info",` - user ${username} valid:${valid} twoFactor:${twoFactor}`);
        return {user, valid, twoFactor};
    };
    /**
     * 驗證jwt token
     * @param username
     * @param token
     * @return {Promise<*|boolean>}
     */
    async verify2({username, token}) {
        // let currentToken = await this.getToken(username);
        // if (currentToken != token) return false;
        return await this.jwtVerify(token);
    };
    /**
     * 取得當下token
     * @param username
     * @return {Promise<string|*|string|null>}
     */
    async getToken(username) {
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
    jwtVerify(token) {
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
    hash(pwd) {
        return new Promise((resole, reject) => {
            bcrypt.hash(pwd, 10, (err, hash) => {
                if (err) reject(err);
                else resole(hash);
            });
        });
    };
    async registerOTP(username, secret) {
        return await this.db.updateSecret(username, secret);
    };
    async getSecret(username) {
        return await this.db.getSecret(username);
    };
}
module.exports = exports = Auth;