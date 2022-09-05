"use strict";
const net    = require('net');
const http   = require('http');
const util   = require("util");
const events = require("events");
/**
 *
 * @constructor
 */
class webServer extends events.EventEmitter {
    constructor() {
        super();
        this.server = this.setup();
        // this.init();
        this.plugins(this.server);
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
        let onCustomMessage = function onCustomMessage(data, handle) {
            console.log(`onCustomMessage:`, data);
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

    /**
     *
     * @return {net.Server}
     */
    setup() {
        const server = http.createServer((req, res) => {
            res.writeHead(200,{'Content-Type':'text/html'});
            res.write('<html><body>This is student Page.</body></html>');
            res.end();
        });
        return server;
    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = new webServer();