const http           = require("http");
const util          = require("util");
const EventEmitter  = require("events");
const fxNetSocket   = require('fxNetSocket');
const FxConnection  = fxNetSocket.netConnection;
const NSLog         = fxNetSocket.logger.getInstance();

util.inherits(SpeedTest, EventEmitter);

function SpeedTest() {
    EventEmitter.call(this);

    this.setupIPCBridge(this.server);
    this.makeSureComplete();

}
/** Socket Server **/
SpeedTest.prototype.createServer = function () {
    var self = this;
    var runListen = (process.send instanceof Function) == false;
    var port = (process.env.port) ? process.env.port : 8001;
    var server    = new FxConnection(port, {runListen: runListen, glListener:false});
    server.on('connection', this.connectionHandler.bind(this));
    server.on("error", function (error) {
        NSLog.log("error", "The service ERROR!!!");
    });
    server.on("close", function () {
        console.log('close');
    });
    server.on("Listening", function () {
        var info = server.app.address();
        NSLog.log("info", "The service has started to address [%s]:%s. ", info.address, info.port);
    });

    server.userPingEnabled = false;
    return server;
};
/** Client Connections **/
SpeedTest.prototype.connectionHandler = function (client) {
    client.on("disconnect", function (name) {});
    client.on("ping", function (obj) {});
    client.on("message", function (data) {});
    client.on("error", function () {});
};
SpeedTest.prototype.setupIPCBridge = function(srv){
    NSLog.log("quiet",'starting setupIPCBridge');
    var self = this;

    process.on("SIGQUIT", function () {
        process.exit(-1);
    });
    process.on("disconnect", function () {
        process.exit(0);
    });
    process.on("message", function (msg, handle) {
        var arg = msg;
        if (typeof arg === 'string') {

        } else if (typeof arg === 'object') {
            var data = msg;
            if (data.evt == "c_init2") {
            }
            else if (data.evt == "c_init") {
                var socket = new net.Socket({
                    handle:handle,
                    allowHalfOpen:srv.allowHalfOpen
                });
                socket.readable = socket.writable = true;
                socket.server = srv;
                srv.emit("connection", socket);
                socket.emit("connect");
                socket.emit('data', Buffer.from(data.data));
                socket.resume();

            } else if(data.evt == "processInfo") {
                process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": self.server.connections}})
            } else {
                NSLog.log("quiet",'out of hand. dismiss message');
            }

        }
    });
};

SpeedTest.prototype.makeSureComplete = function () {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
    }
};

/**
 * Server Big trouble
 */
process.on("uncaughtException", function (err) {
    NSLog.log("quiet"," ================== uncaughtException start ====================== ");
    NSLog.log("quiet", err.stack);
    NSLog.log("quiet"," ================== uncaughtException ended ====================== ");
});

module.exports = exports = SpeedTest;