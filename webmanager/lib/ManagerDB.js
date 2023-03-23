"use strict";
const events = require("events");
const lokijs = require('lokijs');
const {nanoid} = require('nanoid');
const NSLog  = require('fxNetSocket').Logger.getInstance();
/**
 * 資料庫
 * @constructor
 */
class ManagerDB extends events.EventEmitter {
    constructor(filepath) {
        super();
        this.filepath = filepath;
    }
    async test() {
        console.log(`test => ${await this.getUser({username: 'newflash@mail.chungyo.net'})}`);
    }
    /**
     * 初始化設定
     * @return {*}
     */
    async start() {
        let {filepath} = this;
        if (!filepath) filepath = ".";
        let src = `./manager.db`;
        NSLog.info(`ManagerDB lokijs src: ${src}`);
        this.db = new lokijs(src);
        await this.load();
        this.accounts = this.createBucket(`accounts`);
        // this.roles = this.createBucket('roles');
        // this.roles.insert({role: 'Guest', id: 0});
        // console.log(this.roles.findOne({role: 'Guest'}));
        this.save();
        return this;
    }
    async load() {
        let {db} = this
        return new Promise((resolve) => {
            db.loadDatabase({}, () => resolve());
        })
    }
    createBucket(bucket) {
        let {db} = this;
        let collection = db.getCollection(bucket);
        if (collection) {
            return collection;
        } else {
            collection = db.addCollection(bucket, {autoupdate: true});
            return collection;
        }
    }
    async insertAccount({username, password, permission}) {
        const {accounts} = this;
        let json = {
            id: nanoid(10),
            username,
            password,
            permission,
            token: '',
            otp: '',
        };
        if (!accounts.findOne({username})) {
            console.log(`insertAccount`, json);

            accounts.insert(json);
            this.db.saveDatabase();

        }
    }
    async updateAccount({password, username}) {
        let user = await this.getUser(username);
        user.password = password;
        this.update(user);
    }
    async updatePermission({password, username, value}) {
        let user = await this.getUser(username);
        if (password == user.password) {
            user.permission = value;
            this.update(user);
            return true;
        } else {
            return false;
        }
    }
    async flushToken({username, token}) {
        let user = await this.getUser(username);
        user.token = token;
        // console.log('flushToken', user);
        this.update(user);
        return user;
    }
    async updateSecret(username, otp, url) {
        let user = await this.getUser(username);
        user.otp = otp;
        user.url = url || null;
        this.update(user);
    }
    async getSecret(username) {
        let user = await this.getUser(username);
        return user.otp;
    }
    async getPermission(username) {
        let user = await this.getUser(username);
        return {permission: user.permission};
    }
    async getUser(username) {
        const {accounts} = this;
        return accounts.findOne({username});
    };
    update(user) {
        const {accounts} = this;
        accounts.update(user);
        this.db.saveDatabase();
    }
    save() {
        console.log(`db.save()`);
        this.db.save();
    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = ManagerDB;

new ManagerDB().start();