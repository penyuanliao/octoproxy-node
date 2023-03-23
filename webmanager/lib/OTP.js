"use strict";
const {URLSearchParams, URL} = require("url");
const util   = require("util");
const events = require("events");
const {customAlphabet} = require('nanoid/non-secure');
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 32);
const {authenticator, totp, hotp, HashAlgorithms} = require('otplib');
const QRCode = require('qrcode');
/**
 * 帳號驗證
 * @constructor
 */
class OTP extends events.EventEmitter {
    constructor() {
        super();
        this.setup();
        this.issuer = 'octoMan';
    }
    setup() {
        let digits = 6;
        let period = 30;
        let algorithm = 'sha1';
        authenticator.options = { digits, algorithm, step: period};
        this.options = { digits, algorithm, period};
    }
    async test() {
        nanoid().toUpperCase();
        let issuer = 'octoMan';
        let username = '12345@ex.com.tw';
        let secret = 'BOZNDJLWR2LP3INRVERRL7XGHNCWJLR4';
        let digits = 6;
        let period = 30;
        let algorithm = 'sha1';
        let url = this.generateURL({issuer, username, secret, digits, period, algorithm});

        return new Promise((resolve) => {
            this.create_qrcode(url.toString(), 'buffer').then((img) => {
                resolve(img);
            });
        })
    }
    /**
     * 產生驗證URL
     * @param issuer
     * @param username
     * @param secret
     * @return {string}
     */
    generateURL({issuer, username, secret}) {
        let {digits, period, algorithm} = this.options;
        let url = new URL('otpauth://totp/');
        url.pathname = `${issuer}:${username}`;
        let {searchParams} = url;
        searchParams.append('secret', secret);
        searchParams.append('issuer', issuer);
        searchParams.append('algorithm', algorithm.toUpperCase());
        searchParams.append('digits', digits.toString());
        searchParams.append('period', period.toString());
        return url.toString();
    }
    /**
     * 產生qrcode
     * @param url
     * @param type
     * @return {Promise}
     */
    create_qrcode(url, type) {

        return new Promise((resolve, reject) => {
            let to = '';
            if (type === 'buffer') {
                to = 'toBuffer';
            }
            if (type === 'base64') {
                to = 'toDataURL';
            }
            QRCode[to](url, (err, url) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(url);
                }
            });

        })
    };
    /**
     * 產生secret key
     * @return {string}
     */
    generateSecret(size) {
        return authenticator.generateSecret(size);
    }
    /**
     * 驗證合法
     * @param secret
     * @param token
     * @return {boolean}
     */
    verify({secret, token}) {
        return authenticator.verify({secret, token});
    }

    clean() {
    }
    release() {
    }
}
module.exports = exports = OTP;

new OTP();