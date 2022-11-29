"use strict";
const net    = require('net');
const http   = require('http');
const util   = require("util");
const events = require("events");
/**
 *
 * @constructor
 */
class webServer extends events {
    constructor() {
        super();
        this.server = this.setup();
        // this.init();
        this.plugins(this.server);
        console.log(`=> name:${process.argv[2]} pid: ${process.pid}`);
        process.send({
            evt: 'metadata',
            data: {
                'f2db': 'localhost',
                'cacheSever': 'localhost'
            }
        });
        let count = 0;
        setInterval(() => {
            this.info.betting = count++;
        }, 1000)
    }
    init() {
        const {server} = this;
        const {allowHalfOpen} = this.server;
        process.on('message', function (data, handle) {

            var json = data;

            if (typeof json === 'string') {

            } else if(typeof json === 'object') {

                if (data.evt == "c_init") {
                    var socket = new net.Socket({
                        handle:handle,
                        allowHalfOpen:allowHalfOpen
                    });
                    socket.readable = socket.writable = true;
                    socket.server = null;
                    server.emit("connection", socket);
                    socket.emit("connect");
                    socket.emit('data',Buffer.from(data.data));
                    socket.resume();
                } else if(data.evt == "processInfo") {
                    process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0, "lv": 0}})
                }  else if(data.evt == "kickUsersOut") {
                    process.kill(process.pid, `SIGTERM`);
                }
            }
        });
        if (process.send instanceof Function) {
            process.send({"action":"creationComplete"});
            process.send({evt:"processConf", data: {lv:0, f2db:undefined}});
        }
        process.on('SIGINT', () => process.exit(2));
    }
    plugins(server) {
        let OctoPlugins = require('../lib/OctoPlugins.js');
        this.octoPlugins = new OctoPlugins(this, console);
        this.octoPlugins.setBitratesGroup = {};
        this.octoPlugins.database = '127.0.0.1';
        this.octoPlugins.setupIPCBridge(server);
        this.octoPlugins.onReload = function onReload(data, handle) {
            console.log("info", "reload", data, handle);
            return true;
        };
        let onCustomMessage = function onCustomMessage(data, handle, next) {
            console.log(`onCustomMessage:`, data);
            let {evt} = data;
            if (evt == 'ipcMessage') {
                next();
            }
        };
        let onKickUsersOut = function onKickUsersOut(data, handle) {

        };
        this.octoPlugins.on("ipcMessage", onCustomMessage);
        this.octoPlugins.on("kickUsersOut", onKickUsersOut);
        this.octoPlugins.on("gracefully-shutdown", (next) => {
            next(0);
            setTimeout(() => next(1), 10000);
        });
        /** !! important !! The is tell parent yourself has complete. **/
        this.octoPlugins.makeSureComplete();
    }
    get info() {
        return this.octoPlugins.info;
    }
    /**
     *
     * @return {net.Server}
     */
    setup() {
        const server = http.createServer( (req, res) => {
            req.setTimeout(0);
            res.writeHead(200, {
                'Content-Type':'text/html',
                'Connection': 'close'
            });
            res.write('<html><body>This is student Page 1234.</body></html>');
            res.end();
        });
        server.keepAliveTimeout = 0;
        return server;
    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = new webServer();