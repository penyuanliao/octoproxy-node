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
const APIClient     = require("./APIClient.js");
/**
 * 客端Server服務
 * @constructor
 */
class APIServer extends EventEmitter {
    constructor(configure) {
        super();
        this.isWorker = (process.send instanceof Function);
        this.LOG_LEVEL = NSLog.level;
        this.configure = configure;
        this.bandwidth = {secRate: 0};
        this.liecounts = 0;
        this.setup();
    }
    /**
     * 初始化設定
     */
    setup() {
        const { wpc } = this.configure;
        const listen = !this.isWorker;
        this.auth        = new Auth();
        this.otp         = new OTP();
        this.wsServer    = this.createTCPServer({listen, port: wpc.ws.port});
        this.restManager = this.createRestServer({
            listen: (wpc.rest.listen ? true : listen),
            port: wpc.rest.port});
        this.httpServer  = this.createHTTPServer({
            listen: (wpc.http.listen ? true : listen),
            port: wpc.http.port, options: wpc.http.session});
        this.proxy       = this.createWebProxyServer();
        this.manager     = new RemoteClient(); //連線到服務窗口
        this.logServer   = this.createLiveLogServer(wpc.logging.port);
        if (this.isWorker) this.setupIPCBridge();
        this.makeSureComplete();
        this.updateNodeConf();
    };
    get connections() {
        return this.liecounts;
    }
    /**
     * socket server
     * @param port
     * @param listen
     * @return {Server}
     */
    createTCPServer({port, listen}) {

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
     * @param options
     */
    createHTTPServer({listen, port, options}) {
        // const web = http.createServer((req, res) => {});
        // web.on('upgrade', (request, socket, head) => {
        //     NSLog.log(request.url, request.method, request.upgrade, request.client);
        // });
        // if (listen) web.listen(port, () => {
        //     NSLog.log("info",'Web Service start listening port %s.', port);
        // });
        const WebManager = require('./WebManager.js');
        const web = new WebManager({delegate: this, listen, port, options});
        web.on('listen', (element) => {

        });
        return web;
    };
    createWebProxyServer() {
        const WebMiddleware = require('./WebMiddleware.js');
        return new WebMiddleware(this.httpServer.store)
            .start(this.createWebProxyRouters());
    }
    createWebProxyRouters() {
        const { wpc } = this.configure;
        let routers = [];
        routers.push(wpc.http);
        routers.push(wpc.rest);
        return routers;
    }
    /**
     * HTTP WEB API
     * @param listen
     * @param port
     * @return {RestManager}
     */
    createRestServer({listen, port}) {
        const manager = new RestManager(this);
        if (listen) manager.start({port: port});
        return manager;
    };
    /**
     * 處理SOCKET連線
     * @param socket 連線進來的使用者
     */
    async onConnection(socket) {
        const cli = new APIClient(this);
        await cli.connect(socket);
        this.liecounts++;
    };
    /**
     * remote log
     * @param {number} port
     * @return {LogServer}
     */
    createLiveLogServer(port) {
        const server = new LogServer(port);
        server.on("update", (output) => {});
        return server;
    };
    /**
     * 綁定
     */
    setupIPCBridge() {
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
    ipcReceiveMessage(args, handle) {
        if (args.evt) {
            this.systemMessage.apply(this, arguments);
        } else if (args.action) {
            this.commandMessage.apply(this, arguments);
        }
    };
    /**
     * 建立完成
     */
    makeSureComplete() {
        if (process.send instanceof Function) {
            process.send({"action":"creationComplete", data: 1});
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
    systemMessage({evt, id, data, mode, params}, handle) {
        let server;

        if (mode) {
            server = this.targetServer(mode);
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
            this.LOG_LEVEL = params.lv;
            NSLog.setLevel = this.LOG_LEVEL;
            NSLog.log('quiet', "Server manager change NSLog level: [%s]", NSLog.level);
        }
        else if (evt === 'processInfo') {
            let replyObj = {
                evt: "processInfo",
                data: {
                    memoryUsage: process.memoryUsage(),
                    connections: (this.connections || 0),
                    bandwidth: (this.bandwidth || {secRate: 0})
                }
            };
            process.send(replyObj);
        }
        else if (evt == 'ipcMessage') {
            NSLog.log("info", "ipcMessage()", arguments[0]);

            process.send({
                evt: 'onIpcMessage',
                id: id,
                result: true
            });

        } else {
            NSLog.log("info",'out of hand. dismiss message [%s]', evt);
        }
    };
    targetServer(mode) {
        if (mode == 'http' || mode == 'web') {
            if (this.configure.wpc.proxyMode) return this.proxy.getServer();
            if (mode === 'http') return this.restManager.getServer();
            if (mode === 'web') return this.httpServer.getServer();
        } else {
            return this.wsServer;
        }
    }
    /**
     * 自訂服務事件
     * @param {String} action 事件
     * @param {Object} params 參數
     */
    commandMessage({action, params}) {
        NSLog.info(`serviceMessage: ${action} params: ${JSON.stringify(params)}`);
    };
    /**
     * 重啟服務程序
     * @param {Function} done
     * @param {Function} reject
     * @return {Promise}
     */
    async shutdown(done, reject) {
        NSLog.log("info",`shutdown`);
        done({result: true})
    };
    updateNodeConf() {
        let lv = this.LOG_LEVEL;
        const json = {
            evt: 'processConf',
            data : { lv }
        };
        if (process.send instanceof Function) process.send(json);
    };
    /**
     * clear
     */
    clean() {

    };
    /**
     * release
     */
    release() {

    };
}
module.exports = exports = APIServer;