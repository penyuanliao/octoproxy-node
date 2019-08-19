const path = require("path");
const v8  = require("v8");
const util = require("util");
const EventEmitter = require("events");
const dosomething = require("../fxNodeRtmp/client.js");

util.inherits(pkgBuild, EventEmitter);

function pkgBuild() {
    console.log('/start/');
    setInterval(function () {
        console.log('run....');
    }, 60000);
    EventEmitter.call(this);
    this.makeSureComplete();
    this.setupIPCBridge();
    // console.log('forked heap', v8.getHeapStatistics());
    // console.log('forked heap', process.env);
    // console.log(process.versions);
}
pkgBuild.prototype.makeSureComplete = function () {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
    }
};

process.on("uncaughtException", function (err) {
    console.log("quiet"," ================== uncaughtException start ====================== ");
    console.log("quiet", err.stack);
    console.log("quiet"," ================== uncaughtException ended ====================== ");
});
pkgBuild.prototype.setupIPCBridge = function(srv){
    console.log("quiet",'setupIPCBridge :');
    var self = this;
    process.parent = this;

    process.on("SIGQUIT", function () {
        process.exit(-1);
    });
    process.on("disconnect", function () {
        process.exit(0);
    });
    process.on("message", function (msg, handle) {
        var arg = msg;
        console.log(arg);
        if (typeof arg === 'string') {

        } else if (typeof arg === 'object') {
            var data = msg;
            if (data.evt == "c_init2") {
                self.clusters[0].send({'evt':'c_init',data:data.data}, handle,{keepOpen:false});
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
                process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
            } else if(data.evt == "kickUsersOut") {
                console.log("warning", "** Start Kick User Out. **");
            } else if (data.evt == "setLogLevel") {
                console.log('quiet', "** Server manager change console level: [%s]. **", '');
            } else {
                console.log("quiet",'out of hand. dismiss message', msg);
            }

        }
    });
};
module.exports = exports = new pkgBuild();