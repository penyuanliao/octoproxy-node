/**
 * Created by Benson.Liao on 2016/9/12.
 */

const net   = require('net');
const fxNet = require('fxNetSocket').NetCoonection;
const NSLog = require('fxNetSocket').logger.getInstance();
NSLog.configure({
    logFileEnabled:true,
    consoleEnabled:true,
    level:'trace',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath:__dirname+"/historyLog",
    id:"octoproxy",
    remoteEnabled: false,
    maximumFileSize: 1024 * 1024 * 100});



function remoteContrl() {
    
    this.insideSrv  = undefined;
    this.outsideSrv = undefined;

    this.sockets = [];
    this.clients = [];

}
remoteContrl.prototype.outside = function () {
    var self = this;
    var srv = this.outsideSrv = new fxNet(10081, { runListen:true, glListener:false });
    srv.on('connection', function (client) {
        var namespace = client.namespace.substr(1, client.namespace.length);

        self.setClients(client, namespace);
        console.log(namespace);
        client.on('message', function (evt) {

        });
        client.on('disconnect', function () {
            var namespace = client.namespace.substr(1, client.namespace.length);
            var group = self.getClients(namespace);
            group[client.name] = undefined;
            delete group[client.name];
        });

    });

    srv.on('httpUpgrade', function (req, client, head) {
        console.log(head);
    });
    srv.on('disconnect', function (name) {
        console.log("disconnectdisconnectdisconnect");
    });

};
remoteContrl.prototype.inside = function () {
    var self = this;
    var srv = this.insideSrv = net.createServer(function (socket) {
        console.log('connected');
        socket.once('data', function (chunk) {
            var name = chunk.toString();
            socket.name = name;
            self.sockets[name] = socket;
            socket.on("data", onDataHandler);
        });

        function onDataHandler(chunk) {

            var group = self.getClients(socket.name);
            if (typeof group == "undefined") {
                return;
            }

            var g_key = Object.keys(group);
            var g;
            for (g = 0; g < g_key.length; g++) {
                var client = group[g_key[g]];
                client.write(chunk.toString());

            }

        }


        socket.on("disconnect", function () {
            self.sockets[socket.name] = undefined;
            delete self.sockets[socket.name];
        })
    });
    srv.listen(10080);
};

remoteContrl.prototype.setClients = function (client, namespace) {

    if (typeof this.clients[namespace] == "undefined") {
        this.clients[namespace] = {};
    }

    this.clients[namespace][client.name] = client;

};
remoteContrl.prototype.getClients = function (namespace) {

    var group = this.clients[namespace];

    return group;
};

var createRemoteSrv = function () {
    var s = new remoteContrl();
    s.inside();
    s.outside();
};

/**
 * 程序錯誤會出現在這裡
 */
process.on('uncaughtException', function (err) {
    console.log('error', 'Process uncaughtException :',err.stack);
});
process.on('SIGQUIT',function () {
    console.log('debug', "IPC channel exit -1");
    process.exit(-1);
});
process.on('disconnect', function () {
    console.log('debug', "sends a QUIT signal (SIGQUIT)");
    process.exit(0);
});
process.on('message', function (data, handle) {
    var json = data;
    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if (data.evt == "c_init") {

            console.log('debug', "Conversion Socket.Hanlde from Child Process.");

            var socket = new net.Socket({
                handle:handle,
                allowHalfOpen:srv.app.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = srv.app;
            srv.app.emit("connection", socket);
            socket.emit("connect");
            socket.emit('data',new Buffer(data.data));
            socket.resume();
            return;
        }else if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
        }else{
            console.log('debug', 'out of hand. dismiss message');
        };

    };
});


module.exports = exports = createRemoteSrv;


createRemoteSrv();