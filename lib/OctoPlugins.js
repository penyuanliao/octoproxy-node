const net          = require("net");
const util         = require("util");
const url          = require("url");
const querystring  = require("querystring");
const EventEmitter = require("events");
var NSLog;
util.inherits(OctoPlugins, EventEmitter);

function OctoPlugins(delegate, log) {

    this.delegate    = delegate;
    this.connections = 0;
    this.bitratesGroup = {};
    NSLog = log || console;
    this.logLevel = NSLog.level || "none";
    this.onReload = function (data, handle) {
        return true;
    };

    var self = this;

    Object.defineProperties(this, {
        "liveCounts": {
            get: function () {
                return self.connections;
            },
            set:function (value) {
                self.connections = value;
            },
            enumerable: false,
            configurable: false
        },
        "setBitratesGroup": {
            set: function (group) {
                self.bitratesGroup = group;
            },
            enumerable: false,
            configurable: false
        }
    });

    EventEmitter.call(this);
}
OctoPlugins.prototype.setLogLevel = function (lv) {
    this.logLevel = lv;
    NSLog.configure({level: lv});
};
/** !! important !! The is tell parent yourself has complete. **/
OctoPlugins.prototype.makeSureComplete = function () {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
    }
};
/** assign {"/namespace: <assign>"} **/
OctoPlugins.prototype.setupIPCBridge = function (server, assign) {
    var self = this;
    NSLog.log("debug","setup ipc bridge connection");

    this.server = server;
    // utilities.autoReleaseGC();

    if (typeof assign != "undefined") {
        this.server = undefined;
        this.assign = assign;
    }

    process.on("SIGQUIT", this.bridgeQuitSignal);
    process.on("disconnect", this.bridgeDisconnect);
    process.on("message", this.bridgeMessageConversion.bind(this));

    process.on("uncaughtException", function (err) {
        NSLog.log("quiet"," ================== uncaughtException start ====================== ");
        NSLog.log("quiet", err.stack);
        NSLog.log("quiet"," ================== uncaughtException ended ====================== ");
    });
};
OctoPlugins.prototype.bridgeQuitSignal = function () {
    NSLog.log("debug", "IPC channel exit -1");
    process.exit(-1);
};
OctoPlugins.prototype.bridgeDisconnect = function () {
    NSLog.log("debug", "sends a QUIT signal (SIGQUIT)");
    process.exit(0);
};
OctoPlugins.prototype.bridgeMessageConversion = function (data, handle) {
    var json = data;
    var socket;
    var server = this.server;

    var self = this;

    if (typeof this.assign != "undefined") {
        if (typeof json === 'object' && (json.evt == "c_init" || json.evt == "c_socket")) {
            const ns1 = data.namespace;
            const ns2 = data.namespace.substr(1);
            if (typeof this.assign[ns1] != "undefined") {
                server = this.assign[ns1];
            } else if (typeof this.assign[ns2] != "undefined") {
                server = this.assign[ns2];
            } else {
                //rule LB
                const originPath = data.originPath;
                if (typeof originPath == "undefined") {
                    NSLog.log("error", "Not valid %s", originPath);
                    return;
                }
                const query = url.parse(originPath).query;
                const args = querystring.parse(query);
                if (typeof this.assign[args.gameType] != "undefined") {
                    server = this.assign[args.gameType];
                } else if (typeof this.assign["/" + args.gameType] != "undefined") {
                    server = this.assign["/" + args.gameType];
                } else {
                    NSLog.log("error", "Not valid %s", args.gameType);
                    return;
                }
            }
        }
    }
    let mode = (json.mode);
    //var clusters = this.clusters;
    if (typeof json === 'string') {
    }
    else if (typeof json === 'object') {
        if (data.evt == "c_init") {
            socket = new net.Socket({
                handle:handle,
                allowHalfOpen:server.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = (mode === 'http' ? null : server);
            server.emit("connection", socket);
            socket.emit("connect");
            socket.relatedData = Buffer.from(data.data);
            socket.emit('data', socket.relatedData);
            socket.resume();
        }
        else if (data.evt === "c_socket") {
            socket = handle;
            server._setupSlave([socket]);
            socket.setKeepAlive(true, 100000);

            socket.fd = handle.fd;
            socket.setTimeout(1000, function () {
                process.stdout.write(String(socket.remoteAddress).split(":")[3] + socket.remotePort +'\n');
                socket.close();
            });
            socket.readable = true;
            socket.writable = true;

            socket.resume();
            socket.server = server;
            server.emit("connection", socket);
            socket.emit("connect");
        }
        else if (data.evt === "streamData") {
            this.sendStreamData(data)
        }
        else if (data.evt === "wrap_socket") {
            socket = new net.Socket({
                handle:handle,
                allowHalfOpen:server.allowHalfOpen
            });
            socket.replicated = true;
            socket.baseEvtShow = false;
            socket.readable = socket.writable = true;
            socket.server = server;
            server.emit("connection", socket);
            socket.emit("connect");
            socket.relatedData = Buffer.from(data.raw);
            socket.metadata = data.metadata;
            socket.emit('data', socket.relatedData);
            socket.resume();
        }
        else if (data.evt === "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": self.connections, lv: self.logLevel, bitrates: self.bitratesGroup}})
        } else if(data.evt == "kickUsersOut") {
            NSLog.log("warning","kickUsersOut()", json);
            self.emit("kickUsersOut", json);
        } else if (data.evt == "reload") {
            if (typeof self.onReload != "function") return;
            if (self.onReload(json, handle)) {
                process.exit(0);
            }
        } else if (data.evt == "hotReload") {
            console.log('hotReload');
            self.startHotReload(json, true);

        } else if (data.evt == "setLogLevel") {
            self.setLogLevel(data.params.lv);
        } else {
            self.emit("ipcMessage", json, handle);
        }
        json = null;
    }
    else {
        NSLog.log("error",'out of hand. dismiss message.\n');
    }
};
OctoPlugins.prototype.startHotReload = function (json, completed) {
    if (typeof this.delegate.getWarpJumpSockets != "function") return;
    if (typeof json.params == "undefined" || typeof json.params.togo == "undefined") return;
    const togo = json.params.togo;
    const group = this.delegate.getWarpJumpSockets();

    if (Array.isArray(group) == false) return;
    const self = this;
    var i = 0;

    function startWarpJump() {
        const socket = group[i].socket;
        const metadata = group[i].metadata;
        
        self.warpJump(socket, togo, metadata, function () {
            if (++i < group.length) {
                startWarpJump();
            }
            else {
                if (completed) process.send({"evt":"hotReloadComplete"})
            }
        })
    }
    if (i < group.length) {
        startWarpJump();
    }
    else {
        if (completed) process.send({"evt":"hotReloadComplete"})
    }

};
// swap
OctoPlugins.prototype.warpJump = function (socket, goto, metaData, cb) {
    const handle = socket._handle;
    const message = {
        evt: "warp_handle",
        goto: goto,
        raw: socket.relatedData,
        metaData: metaData,
        originPath: socket.originPath
    };
    process.send(message, handle, cb);
    socket.pause();
    socket.ref();
    socket.readable = socket.writable = false;
};
OctoPlugins.isMaster = function () {
    return ((process.send instanceof Function) == false);
};

module.exports = exports = OctoPlugins;
