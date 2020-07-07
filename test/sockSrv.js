/**
 * Created by Benson on 2017/2/20.
 */
const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const fxSocket     = fxNetSocket.WSClient;
const daemon     = fxNetSocket.daemon;
var srv = create();
var srv2 = create();
var cluster = cl();

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
            var d = new Buffer(data.data);




        }else if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
        }else{
            console.log('debug', 'out of hand. dismiss message');
        }
    }
});


function create() {
    var server = new FxConnection(8000,{runListen: false});
    var self = this;
    server.on('connection', function (client) {

        console.log('info','Connection Clients name:%s (namespace %s)',client.name, client.namespace);


        setTimeout(function () {
            transferProcess(cluster, client.hsSource, client.socket, function (err) {
                if (err == null) {
                    console.log('cluster ',err);
                    client.release();
                }
            })
        },10000)
    });

    server.on('message', function (evt) {
        console.log('debug','message :', evt.data);

    });
    server.on('disconnect', function (name) {
        console.log('debug','disconnect :', name);
    });
    return server;
}
function cl() {
    var cluster = new daemon("./test/sockSrv2.js",[], {env:process.env,silent:false,execArgv:["--nouse-idle-notification", "--max-old-space-size=" + 512]}); //心跳系統
    cluster.init();
    return cluster;
}
function transferProcess(fork, hsSource, socket, callback) {
    fork.send({evt:"c_init", data:hsSource, registered:true},socket, callback);
}