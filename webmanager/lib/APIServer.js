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
const OTP           = require("./OTP.js");

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
/**
 * 初始化設定
 */
APIServer.prototype.setup = function () {
    const listen = !this.isWorker;
    this.auth        = new Auth();
    this.otp         = new OTP();
    this.wsServer    = this.createTCPServer({listen, port: 8002});
    this.restManager = this.createRestServer({listen, port:8001});
    this.manager     = new RemoteClient(); //連線到服務窗口
    this.logServer   = this.createLiveLogServer(10080);
    if (this.isWorker) this.setupIPCBridge();
    this.makeSureComplete();
};
/**
 * socket server
 * @param port
 * @param listen
 * @return {Server}
 */
APIServer.prototype.createTCPServer = function ({port, listen}) {

    const server = net.createServer();
    server.on("connection", socket => this.onConnection(socket));

    server.on('listening', () =>
        NSLog.log("info",'Server is listening on port', port));
    server.on('close', () =>
        NSLog.log("error",'Server is now closed'));
    server.on('error',  (err) => {
        NSLog.log("error",'Error occurred:', err.message);
    });
    if (listen) server.listen(port);
    return server;
};
/**
 * HTTP SERVER
 * @param listen
 * @param port
 */
APIServer.prototype.createHTTPServer = function ({listen, port}) {
    const web = http.createServer((req, res) => {});
    web.on('upgrade', (request, socket, head) => {
        NSLog.log(request.url, request.method, request.upgrade, request.client);
    });
    if (listen) web.listen(port, () => {
        NSLog.log("info",'Web Service start listening port %s.', port);
    });

};
/**
 * HTTP WEB API
 * @param listen
 * @param port
 * @return {RestManager}
 */
APIServer.prototype.createRestServer = function ({listen, port}) {
    const manager = new RestManager(this);
    if (listen) manager.start({port: port});
    return manager;
};
/**
 * 處理SOCKET連線
 * @param socket 連線進來的使用者
 */
APIServer.prototype.onConnection = async function (socket) {
    const APIClient = require("./APIClient.js");
    const cli = new APIClient(this);
    await cli.connect(socket);
};
/**
 * remote log
 * @param {number} port
 * @return {LogServer}
 */
APIServer.prototype.createLiveLogServer = function (port) {
    const server = new LogServer(port);
    server.on("update", (output) => {});
    return server;
}
/**
 *
 */
APIServer.prototype.clean = function () {

};
/**
 *
 */
APIServer.prototype.release = function () {

};
/**
 * 綁定
 */
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
            NSLog.log('SIGINT: failure -> ', failure);
        });
        if (todo) {
            if (todo.result === true) {
                process.exit(2);
            }
        } else {
            console.log(`todo -> `, todo);
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
    process.on("message", (args, handle) => this.ipcReceiveMessage(args, handle));
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
        if (id) process.send({ evt, id });
    }
    else if (evt === 'setLogLevel') {
        this.LOG_LEVEL = data.params.lv;
        NSLog.setLevel = this.LOG_LEVEL;
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
    NSLog.info(`serviceMessage: ${evt} params: ${JSON.stringify(params)}`);
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