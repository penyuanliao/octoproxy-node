"use strict";
const net            = require("net");
const util           = require("util");
const events         = require("events");
const restify        = require('restify');
const corsMiddleware = require('restify-cors-middleware2');
/**
 * 
 * @constructor
 */
class CorsMiddleware extends events {
    constructor() {
        super();
        this.options = {
            preflightMaxAge: 5, //Optional
            origins: ['*'],
            allowHeaders: ['appid'],
            exposeHeaders: ['appid']
        };
        this.server = this.create();
    }
    create() {
        const server = restify.createServer({
            name: 'cors.middleware',
            version: '1.0.0'
        });
        const cors = corsMiddleware(this.options);
        server.pre(cors.preflight);
        server.use(cors.actual);
        server.use(restify.plugins.acceptParser(server.acceptable));
        server.use(restify.plugins.queryParser());
        server.use(restify.plugins.bodyParser());
        server.use(restify.plugins.authorizationParser()); // header authorization parser
        return server;
    }
    getServer() {
        return this.server.server;
    }
    inbound(handle, data) {
        const server = this.getServer();
        let socket = new net.Socket({
            handle:handle,
            allowHalfOpen: server.allowHalfOpen
        });
        socket.readable = socket.writable = true;
        server.emit("connection", socket);
        socket.emit("connect");
        socket.emit('data', Buffer.from(data));
        socket.resume();
    }
    release() {
    }
}
module.exports = exports = CorsMiddleware;