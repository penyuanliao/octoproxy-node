const net            = require("net");
const path           = require("path");
const util           = require("util");
const EventEmitter   = require("events");
const OctoPlugins    = require("../lib/OctoPlugins.js");
const WSClient       = require("fxNetSocket").wsClient;

util.inherits(TestServer, EventEmitter);
function TestServer() {
    EventEmitter.call(this);
    this.server = this.createServer({
        port: 8001
    });
    this.setup(this.server);
}
TestServer.prototype.createServer = function (options) {
    const self = this;
    const server = net.createServer();
    server.on("listening", function () {
        console.log("info", "Server is listening on port %s", options.port);
    });
    server.on("connection", function (socket) {
        // 取所有使用者要自行實作
        var ip = socket.remoteAddress.replace("::ffff:", "");

        console.log("info","client incoming %s:%s", ip, socket.remotePort);
        //#1 建立WebSocket服務
        const options = {
            zlibDeflatedEnabled: true,
            baseVersion: WSClient.Versions.v2,
            // binaryType: "arraybuffer",
            // binary: true
        };
        const ws = new WSClient(socket, options, function onConnect() {
            // #2 服務會經過F5機器所以會無法取得到真實ip需要透過header來取得
            if (typeof ws.originAddress != "undefined" && ws.originAddress != null) ip = ws.originAddress;
            console.log("info WebSocket handshake successful [%s].", ws.mode);
        });
        console.log("%s", self.getInfo(), ws.constructor.name);
        ws.on("message", function (msg) {
            console.log("debug user message:%s", msg.length, msg);
            // var json = JSON.parse(msg);
            // ws.write(json); //send message
            //ws.destroy(); //close webSocket
        });
        ws.on("close", function () {
            console.log(self.getInfo(), 'close');
        });
        ws.on("error", function (err) {});
        ws.on("ping", function (res) {
            //使用者回應時間
        });
        ws.pingEnable = true;//啟動ping事件

    });
    server.listen(options);
    // if (OctoPlugins.isMaster()) server.listen(options);
    return server;
};
TestServer.prototype.setup = function (server) {
    const self = this;
    this.octoPlugins = new OctoPlugins(this, console);
    this.octoPlugins.onReload = function onReload(data, handle) {
        //重新載入事件
        return true;
    };
    var onCustomMessage = function onCustomMessage(data, handle) {
        console.log(data);
        //客製化事件
    };
    var onKickUsersOut = function onKickUsersOut(data, handle) {
        //踢人事件
    };
    this.octoPlugins.on("ipcMessage", onCustomMessage);

    this.octoPlugins.on("kickUsersOut", onKickUsersOut);

    this.octoPlugins.setupIPCBridge(server);

    this.octoPlugins.makeSureComplete();
};
TestServer.prototype.getInfo = function () {
    return this.constructor.name;
}
module.exports = exports = TestServer;

const main = new TestServer();