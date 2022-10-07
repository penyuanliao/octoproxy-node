"use strict";
const Path          = require("path");
const util          = require("util");
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
    constructor() {
        super();
        this.app = this.createProxyServer();
    }
    listen() {
        let { app } = this;
        return app.listen().close();
    };
    createProxyServer() {
         //建立Express個體
        return express();
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
     * @param [pathRewrite]
     */
    addRouter(app, {router, target, pathRewrite}) {
        let options = {
            target: target,
            changeOrigin: true,
        };
        if (pathRewrite instanceof Function) {
            options.pathRewrite = pathRewrite;
        }
        app.use(router, createProxyMiddleware(options));
        return this;
    };
    getServer() {
        return this.server;
    };
    clean() {
    }
    release() {
    }
}
module.exports = exports = WebMiddleware;