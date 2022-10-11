"use strict";
// const Path          = require("path");
// const util          = require("util");
const EventEmitter  = require("events").EventEmitter;
const NSLog         = require('fxNetSocket').logger.getInstance();
const express       = require("express");
const session       = require('express-session');
const bodyParser    = require('body-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
/**
 * express proxy
 * @constructor
 */
class WebMiddleware extends EventEmitter {
    constructor(store) {
        super();
        this.app = this.createProxyServer(store);
        this.store = store //|| new session.MemoryStore();
        this.day = 24 * 60 * 60 * 1000;
    }
    listen() {
        let { app } = this;
        return app.listen().close();
    };
    createProxyServer(store) {
         //建立Express個體
        let app = express();
        app.disable('x-powered-by')
        // app.use(bodyParser.json()); // support json encoded bodies
        // app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
        app.use(session({
            store,
            secret: 'sidonia_shizuka',
            name: 'user', // optional
            saveUninitialized: false,
            resave: true,
        }));
        app.use(async (req, res, next) => {
            if (req.url == '/octopus/user/login') {
            }

            next();
        });
        return app;
    };
    /**
     * 設定檔案建立
     * @param routers
     * @return {WebMiddleware}
     */
    start(routers) {
        const {app} = this;
        for (let {router, port, host, pathRewrite} of routers) {
            let options = {
                router
            };
            let proto = 'http';
            options.target = `${proto}://${(host || '127.0.0.1')}:${port}`;
            if (pathRewrite) options.pathRewrite = pathRewrite;
            this.addRouter(app, options);
        }
        this.server = this.listen();
        return this;
    };
    /**
     * 建立轉導規則
     * @param app
     * @param router
     * @param target
     * @param onProxyRes
     * @param onProxyReq
     * @param [pathRewrite]
     */
    addRouter(app, {router, target, pathRewrite, onProxyRes, onProxyReq}) {
        let options = {
            target: target,
            changeOrigin: true,
        };
        if (pathRewrite instanceof Function) {
            options.pathRewrite = pathRewrite;
        }
        if (onProxyRes instanceof Function) {
            options.onProxyRes = onProxyRes;
        } else {
            options.onProxyRes = (proxyRes, req, res) => this.onProxyRes(proxyRes, req, res)
        }
        if (onProxyReq instanceof Function) {
            options.onProxyReq = onProxyReq;
        } else {
            options.onProxyReq = (proxyReq, req, res) => this.onProxyReq(proxyReq, req, res);
        }
        app.use(router, createProxyMiddleware(options));
        return this;
    };
    getServer() {
        return this.server;
    };
    getSession(sessionID) {
        return new Promise((resolve) => {
            let { store } = this;
            store.get(sessionID, (err, sess) => resolve(sess));
        });
    };
    setSession(sessionID, session) {
        return new Promise((resolve) => {
            let { store } = this;
            store.set(sessionID, session, (err, sess) => resolve(sess));
        })
    };
    onProxyRes(proxyRes, req, res) {
        req.session.cookie.expires = new Date(Date.now() + this.day);
        req.session.cookie.maxAge = this.day;
        req.session.reload((err) => req.session.save());
    };
    onProxyReq(proxyReq, req, res) {
        proxyReq.setHeader('proxy-session-id', req.sessionID);
        if (!req.session.user) {
            req.session.user = 'Guest';
            req.session.save();
        }
    };
    clean() {
    }
    release() {
    }
}
module.exports = exports = WebMiddleware;