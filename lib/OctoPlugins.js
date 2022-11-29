"use strict";
const net          = require("net");
const util         = require("util");
const url          = require("url");
const querystring  = require("querystring");
const events       = require("events");
var NSLog;
/**
 * 對接子服務程序
 * @param delegate
 * @param log
 * @constructor
 */
class OctoPlugins extends events {
    constructor(delegate, log) {
        super();
        this.delegate      = delegate;
        this.connections   = 0;
        this.bitratesGroup = {};
        this.roleServices  = { enabled: false };
        NSLog = log || console;
        this.logLevel = NSLog.level || "none";
        this.f2db     = "";
        this.amf      = "";
        this.initConf = false;
        this.warpId   = 1;
        this.warpRespond = new Map();
        this.ipcSocketHandle = false;
        this.info = {};
        this.deny = new Set();
        this.onReload = function (data, handle) {
            return true;
        };
        this.getWarpJumpSockets = function () {
            return [];
        };
    }
    set liveCounts(value) {
        this.connections = value;
    }
    get liveCounts() {
        return this.connections;
    }
    set setBitratesGroup(group) {
        this.bitratesGroup = group;
    }
    set database(str) {
        let modify = (this.f2db != str);
        this.f2db = str;
        if (modify) this.updateNodeConf();
    };
    get database() {
        return this.f2db;
    };
    updateNodeConf() {

        const {lv, f2db, amf} = this;
        const json = {
            evt: 'processConf',
            data : { lv, f2db, amf }
        };
        process.send(json);
    }
    getAssignRule(assign, data) {
        if (!assign || typeof assign == "undefined") return null;

        let { namespace, originPath, mode } = data;
        const ns1 = namespace || "";
        const ns2 = ns1.substr(1);
        let server = null;
        if (typeof assign[ns1] != "undefined") {
            server = assign[ns1];
        } else if (typeof assign[ns2] != "undefined") {
            server = assign[ns2];
        } else {
            //rule LB
            if (typeof originPath == "undefined") {
                NSLog.log("error", "Not valid %s", originPath);
                return null;
            }
            const {query} = url.parse(originPath);
            const args = querystring.parse(query);
            const lb = args.gameType || args.stream;
            if (typeof assign[lb] != "undefined") {
                server = assign[lb];
            } else if (typeof assign[`/${lb}`] != "undefined") {
                server = assign[`/${lb}`];
            } else if (typeof assign["default"] != "undefined") {
                server = assign["default"];
            } else {
                NSLog.log("error", "Not valid %s", lb);
                return null;
            }
        }
        return server;
    };
    setRoleServer({http, ws, fl, socket, enabled}) {
        if (typeof arguments[0] != "object") return false;
        const { roleServices } = this;
        if (http) roleServices.http = http;
        if (ws) roleServices.ws = ws;
        if (fl) roleServices.fl = fl;
        if (socket) roleServices.socket = socket;
        if (typeof enabled == "boolean") roleServices.enabled = enabled;
        return true;
    };
    getRoleServer(mode) {
        const { roleServices } = this;
        const {enabled, http, ws, fl, socket} = roleServices;
        if (!enabled) return false;
        if (http && mode === 'http') return http;
        if (ws && mode === 'ws') return ws;
        if (fl && mode === 'fl') return fl;
        if (socket && mode === 'socket') return socket;
    };
    /**
     * 跳躍到其他服務
     * @param {Object} socket native net.socket
     * @param {string} goto assign rule
     * @param {Buffer} handshake 第一包資料
     * @param {Object} metaData 客製化資料
     * @param {String} originPath loadbalance
     * @param {String} mode
     * @param {Object} cb 回傳成功失敗事件
     */
    warpJump({socket, goto, handshake, metaData, originPath, mode}, cb) {
        let {_handle} = socket;
        const message = {
            evt: "warp_handle",
            id: `#${this.warpId++}`,
            goto: goto,
            raw: handshake || socket.relatedData,
            metaData: metaData,
            originPath: socket.originPath,
            mode
        };
        socket.pause();
        socket.ref();
        socket.readable = socket.writable = false;
        process.send(message, _handle, () => {
            this.warpRespond.set(`/${message.id}`, (res) => {
                // res.result
                // res.error
                if (cb) cb(res);
            });
        });
    };
    setLogLevel(lv) {
        this.logLevel = lv;
        NSLog.setLevel = lv;
    };
    /** !! important !! The is tell parent yourself has complete. **/
    makeSureComplete(status) {
        if (!status) status = OctoPlugins.CompleteStatus.ON;
        if (process.send instanceof Function) {
            process.send({"action": "creationComplete", data: status});
        }
        if (!this.initConf) {
            this.updateNodeConf();
            this.initConf = true;
        }
    };
    bridgeQuitSignal() {
        NSLog.log("debug", "IPC channel exit -1");
        process.exit(-1);
    };
    ipcReceiveMessage(args, handle) {
        if (args.evt) {
            this.bridgeMessageConversion.apply(this, arguments);
        } else if (args.action) {
            this.commandMessage.apply(this, arguments);
        }
    }
    destroy(handle) {
        if (!handle) return;
        let socket = new net.Socket({
            handle:handle,
            allowHalfOpen:false
        });
        socket.on('connect', () => socket.destroy());
        socket.readable = socket.writable = true;
        socket.emit("connect");
        socket.resume();
    }
    /**
     * 自訂服務事件
     * @param {String} action 事件
     * @param {Object} params 參數
     */
    commandMessage({action, params}) {
        NSLog.info(`serviceMessage: ${action} params: ${JSON.stringify(params)}`);
        if (action == 'warp') {
            // let {
            //     goto,
            // } = params;
        }
    }
    onIPCMessage(json, handle, next) {
        let id = json.id;
        let timeout = setTimeout(() => this.onIPCMessageComplete(id, false), 5000);
        this.emit("ipcMessage", json, handle, (bool) => {
            clearTimeout(timeout);
            this.onIPCMessageComplete(id, (typeof bool == "boolean" ? bool : true));
        });
    };
    onIPCMessageComplete(id, result) {
        process.send({ evt: 'onIpcMessage', id, result });
    };
    /** assign {"/namespace: <assign>"} **/
    setupIPCBridge(server, assign) {
        NSLog.log("info","Setup ipc bridge connection");
        this.server = server;
        if (typeof assign != "undefined") {
            this.server = undefined;
            this.assign = assign;
        }
        this.startBonding();
    };
    startBonding() {
        //kill訊號
        process.on("SIGINT", async () => {
            let timeout;
            let ts = Date.now();
            const todo = await new Promise((resolve) => {
                //無處理會導致線程不會kill
                timeout = setTimeout(() => resolve(), 1000);
                this.emit("gracefully-shutdown", async (status) => {
                    if (status === 0) {
                        this.makeSureComplete(2);
                        NSLog.info(`gracefully-shutdown status=${status === 0 ? 'pending' : ''}`);
                        clearTimeout(timeout);
                        timeout = setTimeout(() => {
                            NSLog.info(`gracefully-shutdown status=Timeout`);
                            resolve();
                        }, 60000);
                    } else {
                        clearTimeout(timeout);
                        this.makeSureComplete(0);
                        NSLog.info(`gracefully-shutdown status=Done`);
                        resolve();
                    }
                });

            });
            clearTimeout(timeout);
            NSLog.info(`SIGINT gracefully-shutdown runtime: ${Date.now() - ts}`);
            if (todo && todo.result === true) {
                process.exit(2);
            } else if (todo) {
                process.exit(2);
            } else {
                process.exit(2);
            }
        });

        process.on("SIGQUIT", () => this.bridgeQuitSignal());
        process.on("disconnect", () => this.bridgeDisconnect());
        process.on("message", (data, handle) => this.ipcReceiveMessage(data, handle));
        process.on("uncaughtException", function (err) {
            NSLog.log("quiet"," ================== uncaughtException start ====================== ");
            NSLog.log("quiet", err.stack);
            NSLog.log("quiet"," ================== uncaughtException ended ====================== ");
        });
    };
    bridgeDisconnect() {
        NSLog.log("debug", "sends a QUIT signal (SIGQUIT)");
        process.exit(0);
    };
    bridgeMessageConversion(json, handle) {
        let server;
        let {mode, evt, id, params, data} = json;
        if (evt == 'c_init' || evt == 'c_init2') {
            try {
                if (this.deny.has(mode)) {
                    NSLog.info(`bridgeMessageConversion mode:${mode}`);
                    return this.destroy(handle);
                }
                let director = this.getAssignRule(this.assign, json);
                server = (director) ? director : this.server;
                this.acceptSocketDescriptor(server, json, handle);
            } catch (e) {
                NSLog.log("error", 'bridgeMessageConversion error', e);
                this.destroy(handle);
            }
        }
        else if (evt == 'c_socket') {
            //native socket
            this.acceptNativeSocket(this.server, json, handle);
        }
        else if (evt == 'wrap_socket') {
            //wrap socket
            this.acceptWrap(this.server, json, handle);
        }
        else if (evt == 'processInfo') {
            process.send({
                evt: "processInfo",
                id,
                data : {
                    memoryUsage: process.memoryUsage(),
                    connections: this.connections,
                    bitrates: this.bitratesGroup,
                    info: this.info
                }
            })
        }
        else if (evt == 'kickUsersOut') {
            NSLog.log("warning","kickUsersOut()", json);
            this.emit("kickUsersOut", json);
        }
        else if (evt == 'reload') {
            if (typeof this.onReload != "function") return;
            if (this.onReload(json, handle)) {
                process.exit(0);
            }
        }
        else if (evt == "startWarp") {
            this.startWarp(json, true);
        }
        else if (evt == "setLogLevel") {
            this.setLogLevel(params.lv);
        }
        else if (evt == "ipcMessage") {
            this.onIPCMessage(json, handle);
        }
        else if (evt == 'warp_handle') {
            //送出parent結果回應
            let key = `/${id}`;
            if (this.warpRespond.has(key)) {
                this.warpRespond.get(key)(data);
            }
        }
        else {
            NSLog.log("error",'out of hand. dismiss message.\n');
        }
        json = null;
    }
    acceptSocketDescriptor(server, json, handle) {
        let {mode} = json;
        if (this.ipcSocketHandle) {
            this.emit('ipcSocketHandle', json, handle);
        } else {
            let socket = new net.Socket({
                handle: handle,
                allowHalfOpen: server.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = (mode === 'http' ? null : server);
            socket.mode = mode;
            server.emit("connection", socket);
            socket.emit("connect");
            socket.relatedData = Buffer.from(json.data);
            socket.emit('data', socket.relatedData);
            socket.setTimeout(0);
            socket.resume();
        }
    };
    acceptNativeSocket(server, json, handle) {
        let socket = handle;

        server._setupSlave([socket]);
        socket.setKeepAlive(true, 100000);
        socket.mode = mode;
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
    };
    acceptWrap(server, json, handle) {
        let socket = new net.Socket({
            handle:handle,
            allowHalfOpen: server.allowHalfOpen
        });
        socket.replicated = true;
        socket.baseEvtShow = false;
        socket.readable = socket.writable = true;
        socket.server = server;
        server.emit("connection", socket);
        socket.emit("connect");
        socket.relatedData = Buffer.from(json.raw);
        socket.metadata = json.metadata;
        socket.emit('data', socket.relatedData);
        socket.resume();
    };
    startWarp(json, completed) {
        const id = json.id;
        let { from, togo, that, list } = json.params;
        let getWarpJumpSockets;
        if (typeof this.delegate.getWarpJumpSockets != "function") {
            getWarpJumpSockets = this.getWarpJumpSockets;
        } else {
            getWarpJumpSockets = this.delegate.getWarpJumpSockets();
        }
        NSLog.info(`startWarp() togo: ${togo} list: ${list}`);
        // this.emit('start')

        if (typeof json.params == "undefined" || typeof json.params.togo == "undefined") {
            return process.send({evt: "startWarpComplete", id, reboot: false, error: 'invalid arguments'});
        }

        const goto = json.params.togo;
        let handshake = json.params.handshake;
        const group = getWarpJumpSockets(json.params) || [];

        if (Array.isArray(group) == false) return;
        const self = this;
        var i = 0;

        function startWarpJump() {
            const socket = group[i].socket;
            const mode = socket.mode || 'socket';
            const metaData = group[i].metadata;
            if (!handshake) handshake = socket.relatedData;
            let originPath = socket.originPath;
            self.warpJump({socket, goto, handshake, metaData, originPath, mode}, function () {
                if (++i < group.length) {
                    startWarpJump();
                }
                else {
                    if (completed) process.send({evt: "startWarpComplete", id, reboot: false})
                }
            })
        }
        if (i < group.length) {
            startWarpJump();
        }
        else {
            if (completed) process.send({evt: "startWarpComplete", id, reboot: false})
        }

    };
    isMaster() {
        return !(process.send instanceof Function);
    };
    setInfo(key, value) {
        this.info[key] = value;
    }
    async delay(milliseconds) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(), milliseconds);
        });
    };
    static get CompleteStatus() {
        return {
            OFF :  0,
            ON  :  1,
            PEND:  2,
            MAINT: 3,
            TRASH: 4
        };
    }
}
module.exports = exports = OctoPlugins;
