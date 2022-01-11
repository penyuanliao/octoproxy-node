"use strict";
const net           = require("net");
const http          = require("http");
const util          = require("util");
const EventEmitter  = require("events");
const NSLog         = require("fxNetSocket").logger.getInstance();
const RemoteClient  = require("../../smanager/RemoteClient.js");
const RestManager   = require('./RestManager.js');
const LogServer     = require('./LogServer.js');
const Auth          = require("./Auth.js");

/**
 * 客端Server服務
 * @constructor
 */
class APIServer extends EventEmitter {
    constructor() {
        super();
        // this.createHTTPServer({listen:false, port: 8000});
        this.isWorker = (process.send instanceof Function);
        this.setup();
    }
}

APIServer.prototype.setup = function () {
    this.auth = new Auth();
    this.wsServer = this.createTCPServer({listen: !this.isWorker, port: 8002});
    this.restManager = this.createRestServer({listen: !this.isWorker, port:8001});
    this.manager = new RemoteClient(); //連線到服務窗口
    this.logServer = this.createLiveLogServer(10080);
    if (this.isWorker) this.setupIPCBridge();
    this.makeSureComplete();
};

APIServer.prototype.createTCPServer = function ({port, listen}) {

    const server = net.createServer();
    server.on("connection", this.onConnection.bind(this));

    server.on('listening', function () {
        console.log("info",'Server is listening on port', port);
    });
    server.on('close', function () {
        console.log("error",'Server is now closed');
    });
    server.on('error', function (err) {
        console.log("error",'Error occurred:', err.message);
    });
    if (listen) server.listen(port);
    return server;
};
APIServer.prototype.createHTTPServer = function ({listen, port}) {
    const web = http.createServer((req, res) => {});
    web.on('upgrade', (request, socket, head) => {
        console.log(request.url, request.method, request.upgrade, request.client);
    });
    if (listen) web.listen(port, () => {
        console.log("info",'Web Service start listening port %s.', port);
    });

};
APIServer.prototype.createRestServer = function ({listen, port}) {
    const manager = new RestManager(this);
    if (listen) manager.start({port: port});
    return manager;
};
/***
 * 處理SOCKET連線
 * @param {net.Socket} socket 連線進來的使用者
 */
APIServer.prototype.onConnection = function (socket) {
    const APIClient = require("./APIClient.js");
    const cli = new APIClient(socket, this);
};
/** remote log **/
APIServer.prototype.createLiveLogServer = function (port) {
    const server = new LogServer(port);
    server.on("update", (output) => {});
    return server;
}

APIServer.prototype.clean = function () {

};
APIServer.prototype.release = function () {

};
APIServer.prototype.setupIPCBridge = function () {
    NSLog.log("debug"," - Setup IPC bridge connection.");
    process.on("SIGQUIT", () => {
        NSLog.log("debug", "SIGQUIT");
        process.exit(-1);
    });
    process.on('SIGINT', async () => {
        NSLog.log("debug", "SIGINT - Gracefully Shutdown start");
        const todo = await new Promise((resolve, reject) => {
            this.emit("gracefully-shutdown", resolve, reject);
            setTimeout(() => {
                reject({result: false, error: "timeout"});
            }, 60000);
        }).catch((failure) => {
            console.log(failure);
        });
        if (todo) {
            if (todo.result === true) {
                process.exit(2);
            }
        } else {
            console.log(todo);
        }
    });
    process.on("disconnect", () => {
        NSLog.log("debug", "sends a QUIT signal (SIGQUIT)");
        process.exit(0);
    });
    process.on("uncaughtException", (err) => {
        NSLog.log("quiet","=================== uncaughtException =====================");
        NSLog.log("quiet", err.stack);
        NSLog.log("quiet","===========================================================");
    });
    process.on("message", this.ipcReceiveMessage.bind(this));
};
/**
 * ipc事件
 * @param {Object} args
 * @param {*} handle
 */
APIServer.prototype.ipcReceiveMessage = function (args, handle) {
    if (args.evt) {
        this.systemMessage.apply(this, arguments);
    } else if (args.action) {
        this.serviceMessage.apply(this, arguments);
    }
};
/**
 * 建立完成
 */
APIServer.prototype.makeSureComplete = function () {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
    }
    if (this["emit"] instanceof Function) {
        setImmediate(this["emit"].bind(this, "completed"));
    }
};
/**
 * octo系統事件
 * @param {String} evt octo系統事件
 * @param {String} action 管理服務事件
 * @param {String} id
 * @param {Object} data 事件參數
 * @param {String} [data.data] 數據
 * @param {Object} [data.params] 系統參數
 * @param {String} [data.params.lv] 紀錄等級
 * @param {('http'|'ws')} mode
 * @param {*} handle
 */
APIServer.prototype.systemMessage = function ({evt, id, data, mode}, handle) {

    let server;
    if (mode === 'http') {
        server = this.restManager.getServer();
    } else {
        server = this.wsServer;
    }
    if (evt === 'c_init2') {
        let socket = new net.Socket({
            handle:handle,
            allowHalfOpen: server.allowHalfOpen
        });
        socket.readable = socket.writable = true;
        socket.server = (mode == 'ws' ? server : null);
        server.emit("connection", socket);
        socket.emit("connect");
        socket.emit('data', Buffer.from(data));
        socket.resume();
    }
    else if (evt === 'setLogLevel') {
        this.LOG_LEVEL = data.params.lv;
        NSLog.configure({level: this.LOG_LEVEL});
        NSLog.log('quiet', "Server manager change NSLog level: [%s]", this.LOG_LEVEL);
    }
    else if (evt === 'processInfo') {
        let replyObj = {
            evt: "processInfo",
            data: {
                memoryUsage: process.memoryUsage(),
                lv: this.LOG_LEVEL,
                connections: (this.connections || 0),
                bandwidth: (this.bandwidth || {secRate: 0})
            }
        };
        process.send(replyObj);
    }
    else if (evt == 'ipcMessage') {
        NSLog.log("info", "ipcMessage()", arguments[0]);

        process.kill(process.pid, "SIGINT");

        process.send({
            evt: 'onIpcMessage',
            id: id,
            result: true
        });

    } else {
        NSLog.log("info",'out of hand. dismiss message [%s]', evt);
    }
};
/**
 * 自訂服務事件
 * @param {String} evt 事件
 * @param {Object} params 參數
 */
APIServer.prototype.serviceMessage = function ({evt, params}) {

};
/**
 * 重啟服務程序
 * @param {Function} done
 * @param {Function} reject
 * @return {Promise}
 */
APIServer.prototype.shutdown = async function (done, reject) {
    NSLog.log("info",`shutdown`);
    done({result: true})
};
module.exports = exports = APIServer;