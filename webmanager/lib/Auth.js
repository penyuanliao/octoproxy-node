"use strict";
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
        this.enabled = false;
        this.db = null;
        this.expiry = Math.floor(Date.now() / 1000) + (60 * 60);
        this.aes = {
            key: '2ccf858554a5f119f33516b514efa9d2',
            iv: 'c2e9d24aa29d125d'
        };
        this.init();

    }
    async initDB() {
        let db = new ManagerDB(process.cwd());
        return await db.start();
    }
    /**
     * 初始化
     * @return {Auth}
     */
    async init() {
        try {
            const IConfig = require('../../IConfig.js');
            let { authorization } = IConfig.ManagerAccounts();
            let { accounts, enabled, secret, expiry } = authorization;
            this.db = await this.initDB();
            if (accounts) await this.createUsers(accounts);
            this.enabled = enabled;
            this.secret  = secret;
            if (expiry) this.expiry = expiry;
            return this;
        } catch (e) {
            return this;
        }
    };
    async createUsers(accounts) {
        for (let i = 0; i < accounts.length; i++) {
            let { username, password, permission } = accounts[i];
            let user = await this.db.getUser(username);
            if (!user) {
                await this.register({ username, password, permission });
            }
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
        let {valid} = this.verify({username, password}); //valid, user, twoFactor
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
        password = this.decryption(password, this.aes);
        let {valid, twoFactor} = await this.verify({username, password});

        if (valid) {
            const payload = {
                username,
                exp: this.expiry, // 1hour
                twoFactor,
                otpauth: false
            };
            const options = {};
            let token = jwt.sign(payload, this.secret, options);
            await this.db.flushToken({token, username}); //刷新
            return {
                payload,
                token
            };
        }
        return false;
    };
    async otpAuth(payload) {
        const {username} = payload;
        payload.otpauth = true;
        const options = {};
        let token = jwt.sign(payload, this.secret, options);
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
        return new Promise((resolve) => {
            jwt.verify(token, this.secret, (err, decoded) => {

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
    async getPermission(username) {
        return await this.db.getPermission(username);
    };
    encryption(data, {key, iv}) {
        if (typeof data != 'string') data = JSON.stringify(data);
        iv = iv || "";
        if (typeof key == 'undefined') key = this.aes.key;
        let clearEncoding = 'utf8';
        let cipherEncoding = 'hex';
        let cipherChunks = [];
        let cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        cipher.setAutoPadding(true);
        cipherChunks.push(cipher.update(data, clearEncoding, cipherEncoding));
        cipherChunks.push(cipher.final(cipherEncoding));
        return cipherChunks.join('');
    };
    decryption(data, {key, iv}) {
        if (!data) return "";
        iv = iv || "";
        if (typeof key == 'undefined') key = this.aes.key;
        let clearEncoding = 'utf8';
        let cipherEncoding = 'hex';
        let cipherChunks = [];
        let decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(true);
        cipherChunks.push(decipher.update(data, cipherEncoding, clearEncoding));
        cipherChunks.push(decipher.final(clearEncoding));
        return cipherChunks.join('');
    };
}
module.exports = exports = Auth;