/**
 * Created by Benson on 2017/2/20.
 */
const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const ws            = fxNetSocket.WSClient;
const daemon        = fxNetSocket.daemon;
const NSLog         = fxNetSocket.logger.getInstance();

var LOG_LEVEL = "trace";

NSLog.configure({logFileEnabled:true, consoleEnabled:true, level:LOG_LEVEL, dateFormat:'[yyyy-MM-dd hh:mm:ss]',fileName: "sample" ,filePath:__dirname, maximumFileSize: 1024 * 1024 * 100,
    id:process.argv[2], remoteEnabled: false});

var server = create();

process.on('message', function (msg, handle) {
    var json = msg;
    var srv = server.app;

    if (typeof json === 'string') {

    }else if(typeof json === 'object'){
        var data = msg;
        if (data.evt == "c_init") {
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

        }else if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
        }else{
            NSLog.log('debug', 'out of hand. dismiss message');
        }
    }
});
process.on('uncaughtException', function (err) {
    NSLog.log('error', 'Process uncaughtException :',err.stack);
});

function create() {
    var server = new FxConnection(8100,{runListen: true});
    var self = this;
    server.on('connection', function (client) {

        NSLog.log('info','Connection Clients name:%s (namespace %s)',client.name, client.namespace);
        var onDataHandle = function onDataHandle(data) {
            NSLog.log('debug','message :', Buffer.byteLength(data));
            var json;
            try {
                json = JSON.parse(data);
                if (json.action == "echo") {
                    client.write(data);
                } else {
                    client.write(JSON.stringify({res:true}));
                }
            } catch (e) {
                client.write(JSON.stringify({res:false}));
                NSLog.log("error", "message error:", data);
            }
        };
        var onDisconnectHandle = function onDisconnectHandle(name) {
            NSLog.log("info", "onDisconnectHandle():", name);
        };
        var onErrorHandle = function onErrorHandle(data) {
            NSLog.log("info", "onErrorHandle() error:", data);
        };
        var closeHandle = function closeHandle() {
            NSLog.log("info", "socket has close()");
        };
        client.on("message", onDataHandle);
        client.on("disconnect", onDisconnectHandle);
        // client.on("error", onErrorHandle);
        client.socket.on("close", closeHandle);
        // client.write(JSON.stringify({"action":"initCompleted"}));
    });

    server.on('message', function (evt) {
        NSLog.log('debug','message :', Buffer.byteLength(evt.data));
    });
    return server;
}
function makeSureComplete() {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
    }
}
makeSureComplete();

NSLog.log("info", "Server Starting....");