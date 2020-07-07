/**
 * Created by Benson.Liao on 20/02/06.
 *
 * central server
 */
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const NetSocket     = require("../lib/NetSocket.js");
const Gateway       = require("./Gateway.js");
const OctoPlugins   = require("../lib/OctoPlugins.js");
const fxNetSocket   = require('fxNetSocket');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const ws            = fxNetSocket.WSClient;
const daemon        = fxNetSocket.daemon;
const NSLog         = fxNetSocket.logger.getInstance();

util.inherits(Connector, EventEmitter);

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
    fileName: "Connector",
    /* create file max amount */
    fileMaxCount:2,
    /* sort : none, asc, desc */
    fileSort:"asc",
    maximumFileSize: 1024 * 1024 * 100});

const WS_SERVER_OPTIONS = Object.freeze({
    host: "::",
    port: 8001
});

const IsMaster = !(process.send instanceof Function);

function Connector() {
    EventEmitter.call(this);
    this.name = process.argv[2];
    this.clients = [];
    this.server = this.createServer2(WS_SERVER_OPTIONS);
    this.setup(this.server.app);
    this.gateway = this.createGateway();
    this.completed();
}
Connector.prototype.setup = function () {
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

    this.octoPlugins.setupIPCBridge(this.server);
};
Connector.prototype.getWarpJumpSockets = function () {
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
Connector.prototype.completed = function () {
    if (typeof this.octoPlugins != "undefined") {
        this.octoPlugins.makeSureComplete();
    }
};
Connector.prototype.initial = function () {

};
Connector.prototype.createServer = function (options) {
    const config = {
        // 統一監聽事件
        glListener:false,
        // 是否聆聽port服務, 需要透過lb則需要關閉listen
        runListen: IsMaster,
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
Connector.prototype.connection = function (client) {
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
Connector.prototype.selector = function (json) {
    console.log(json);
    if (json.action === "ready") {

    }
    if (json.action === "wrap") {
        this.octoPlugins.startHotReload({
            params: {togo:"test2"}
        })
    }
};

Connector.prototype.createServer2 = function (options) {
    const self = this;
    const server = net.createServer(function (c) {
        c.on('data', function (data) {
            console.log(data.toString());
        });
        c.on("drain", function () {
            console.log('drain');
        })
    });
    server.listen(8001);
    return {app: server};
};

Connector.prototype.matchmaking = function () {
    console.log(process.name);
};

Connector.prototype.createGateway = function () {
    const gateway = new Gateway();
    var pending = false;
    var queue = [];

    var s = net.createConnection({port: 8001}, function () {
        console.log('connected to server:', s._handle.fd);

        setTimeout(function () {
            gateway.adapters.call("matchmaking", { fd: 4
            }, function (err, result) {
                console.log(arguments);
            })
        },1000)
    });
    s.on('drain', function () {

    });


    return gateway;

};

module.exports = exports = Connector;