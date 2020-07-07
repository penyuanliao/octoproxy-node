const fxNetSocket   = require('fxNetSocket');
const path           = require('path');
const net           = require('net');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const fxSocket     = fxNetSocket.WSClient;
const daemon     = fxNetSocket.daemon;
const NSLog   = fxNetSocket.logger.getInstance();

NSLog.configure({
    /* File for record */
    logFileEnabled:true,
    /* console log */
    consoleEnabled:true,
    /* quiet, error, warning, info, debug, trace, log */
    level:'debug',
    /* Date format */
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    /*  */
    filePath: path.join(process.cwd(), "./historyLog"),
    /*filePath: undefined,*/
    /* lof filename */
    fileName:'test',
    /* create file max amount */
    fileMaxCount:3,
    /* sort : none, asc, desc */
    fileSort:"desc",
    /** file show times **/
    fileDateHide: true,
    initClear: true,
    maximumFileSize: 50000});
// NSLog.clean();
function create() {
    var server = new FxConnection(8001,{runListen: false, glListener: false});
    var self = this;
    var clients = [];
    server.on('connection', function (client) {
        // clients.push(client);
        // console.log(clients.indexOf(client));
        //console.log('connect', typeof client);
        client.on("disconnect", function (name) {
            console.log('disconnect');
        })
        // console.log('info','Connection Clients name:%s (namespace %s)',client.name, client.namespace);
    });

    server.on('message', function (evt) {
        console.log('debug','message :', evt.data);

    });
    server.on('disconnect', function (name) {
        // console.log('debug','disconnect :', name);
    });

    return server;
}
var srv = create();
process.on('message', function (data, handle) {

    var json = data;


    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if (data.evt == "c_init") {
            NSLog.log('debug', "Conversion Socket.Hanlde from Child Process.");

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
        }else if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0, "lv": 0}})
        }
    }
});
if (process.send instanceof Function) {
    process.send({"action":"creationComplete"});
    process.send({evt:"processConf", data: {lv:0, f2db:undefined}});
}
var onLogged = function onLogged() {
    const used = process.memoryUsage();
    NSLog.log("info", '+ ------------------------------------------------------ +');
    NSLog.log("info", '| rss:%s MB | heapTotal:%s MB | heapUsed:%s MB | external:%s MB |',
        Math.round(used["rss"]/ 1024/1024*100) / 100,
        Math.round(used["heapTotal"]/ 1024/1024*100) / 100,
        Math.round(used["heapUsed"]/ 1024/1024*100) / 100,
        Math.round(used["external"]/ 1024/1024*100) / 100
    );
    NSLog.log("info", '+ ------------------------------------------------------ +');
};
if (typeof this._intrLogged == "undefined") {
    onLogged();
    this._intrLogged = setInterval(onLogged, 1000);
}