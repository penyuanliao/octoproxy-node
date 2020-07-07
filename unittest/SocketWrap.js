const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const OctoPlugins   = require("../lib/OctoPlugins.js");
const fxNetSocket   = require('fxNetSocket');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const ws            = fxNetSocket.WSClient;
const daemon        = fxNetSocket.daemon;
const NSLog         = fxNetSocket.logger.getInstance();

NSLog.configure({
    /* File for record */
    logFileEnabled:true,
    /* console log */
    consoleEnabled:true,
    /* quiet, error, warning, info, debug, trace, log */
    level:'debug',
    /* Date format */
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    /* Display the last time of FILE */
    fileDateHide: true,
    /*  */
    filePath: "./historyLog",
    /*filePath: undefined,*/
    /* lof filename */
    fileName: "SocketWrapExample",
    /* create file max amount */
    fileMaxCount:2,
    /* sort : none, asc, desc */
    fileSort:"asc",
    maximumFileSize: 1024 * 1024 * 100});

const WS_SERVER_OPTIONS = Object.freeze({
    host: "0.0.0.0",
    port: 8001
});

util.inherits(SocketWrap, EventEmitter);
function SocketWrap() {
    EventEmitter.call(this);
    this.name = process.argv[2];
    this.clients = [];
    this.server = this.createServer(WS_SERVER_OPTIONS);
    this.setup(this.server.app);
    this.completed();
}
SocketWrap.prototype.setup = function (server) {
    const self = this;
    this.octoPlugins = new OctoPlugins(this, NSLog);
    this.octoPlugins.onReload = function onReload(data, handle) {
        //重新載入事件
        return true;
    };
    var onCustomMessage = function onCustomMessage(data, handle) {
        //客製化事件
    };
    var onKickUsersOut = function onKickUsersOut(data, handle) {
        //踢人事件
    };
    this.octoPlugins.on("ipcMessage", onCustomMessage);

    this.octoPlugins.on("kickUsersOut", onKickUsersOut);

    this.octoPlugins.setupIPCBridge(server);
};
SocketWrap.prototype.onCustomMessage = function (data, handle) {
    
};
SocketWrap.prototype.onKickUsersOut = function (data, handle) {

};
SocketWrap.prototype.getWarpJumpSockets = function () {
    const group = [];
    for (var i = 0; i < this.clients.length; i++) {
        group.push({
            metadata: {},
            socket: this.clients[i].socket
        })
    }
    return group;
};
/** !! important !! The is tell parent yourself has complete. **/
SocketWrap.prototype.completed = function () {
    if (typeof this.octoPlugins != "undefined") {
        this.octoPlugins.makeSureComplete();
        process.send({evt:"processConf", data: {lv:NSLog.level, f2db:""}});
    }
};
SocketWrap.prototype.createServer = function (options) {
    const config = {
        // 統一監聽事件
        glListener:false,
        // 是否聆聽port服務, 需要透過lb則需要關閉listen
        runListen: false,
    };
    const server = new FxConnection(options.port, config);
    server.on('connection', this.connection.bind(this));
    server.on("error", function (error) {
        NSLog.log("error", "The service ERROR!!!", error);
    });
    server.on("close", function () {});
    server.on("Listening", function () {
        var info = server.app.address();
        NSLog.log("info", "The service has started to address [%s]:%s. ", info.address, info.port);
    });

    server.userPingEnabled = false;
    return server;
};
SocketWrap.prototype.connection = function (client) {
    NSLog.log("debug", "[%s] user connection", this.name);
    client.write(JSON.stringify({action:"ready"}));

    function onMessage(data) {
        try {
            const json = JSON.parse(data);
            this.selector(json);
        } catch (e) {

        }
    }
    function onDisconnect(key) {
        NSLog.log("debug", "[%s] user disconnect", this.name);
        const index = this.clients.indexOf(client);
        if (index != -1) this.clients.splice(index, 1);
    }
    function onPing(obj) {}

    client.on("message", onMessage.bind(this));
    client.on("disconnect", onDisconnect.bind(this));
    client.on("ping", onPing.bind(this));

    this.clients.push(client);
};
SocketWrap.prototype.selector = function (json) {
    if (json.action === "ready") {

    }
    if (json.action === "wrap") {
        this.octoPlugins.startHotReload({
            params: {togo:"test2"}
        })
    }
};

module.exports = exports = SocketWrap;

const wrap = new SocketWrap();