/**
 * Created by Benson.Liao on 15/12/9.
 * 多執行緒 執行
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

const util = require('util');
const debug = require('debug')('rtmp:LiveMaster');
debug.log = console.log.bind(console); //file log 需要下這行
const fxNetSocket = require('fxNetSocket');
const parser = fxNetSocket.parser;
const pheaders = parser.headers;
const utilities = fxNetSocket.utilities;
const daemon = fxNetSocket.daemon;
const client = fxNetSocket.wsClient;
const path   = require('path');
const NSLog  = fxNetSocket.logger.getInstance();
NSLog.configure({logFileEnabled:true, consoleEnabled:true, level:'trace', dateFormat:'[yyyy-MM-dd hh:mm:ss]',filePath:__dirname+"/historyLog", maximumFileSize: 1024 * 1024 * 100});


/** 建立連線 **/
const TCP = process.binding("tcp_wrap").TCP;
const uv = process.binding('uv');
const fs  = require('fs');
const net  = require('net');
const evt = require('events');
const cfg = require('./config.js');
/** 所有視訊stream物件 **/
var liveStreams = {};
/** 多執行緒 **/
var noop = {};
const closeWaitTime = 5000;

var server;
var clusters = [];
var roundrobinNum = [];

NSLog.log('debug',"** Initialize FxLiveMaster.js **");

initizatialSrv();

/** cluster ended **/
function initizatialSrv() {


    utilities.autoReleaseGC(); //** 手動 1 sec gc

    // 1. setup child process fork
    setupCluster(cfg.forkOptions);
    // 2. create listen 80 port server
    NSLog.log('info', 'Ready start create server');
    createServer(cfg.srvOptions);

};

/**
 * 建立tcp伺服器不使用node net
 * @param opt
 */
function createServer(opt) {
    if (!opt) {
        opt = {'host':'0.0.0.0', 'port': 8080,'backlog':511};
    };
    var err, tcp_handle;
    try {
        tcp_handle = new TCP();
        err = tcp_handle.bind(opt.host, opt.port);
        if (err) {
            throw new Error(err);
        };

        err = tcp_handle.listen(opt.backlog);

        if (err) {
            throw new Error(err);
        };
        tcp_handle.onconnection = function (err ,handle) {

            if (err) {
                NSLog.log('error', 'onconnection Error on Exception accept.');
                return;
            }
            // user address, port
            var out = {};
            err = handle.getpeername(out);
            if (err) {
                NSLog.log('error','uv.UV_EADDRINUSE');
                handle.close(close_callback);
                return;
            }

            // console.log(out);
            handle.setNoDelay(true);

            handle.setKeepAlive(true, 30);

            handle.onread = onread_url_param;

            err = handle.readStart(); //讀header封包
            if(err){
                handle.close(close_callback);
            }

            //onread_roundrobin(handle); //平均分配資源
            handle.closeWaiting = setTimeout(function () {
                NSLog.log('warning','CLOSE_WAIT %s:%s - Wait 5 sec timeout.',out.address, out.port);
                handle.close(close_callback);
            },closeWaitTime);
        };

        server = tcp_handle;
    }
    catch (e) {
        NSLog.log('error','Create server error:', e);
        tcp_handle.close(close_callback);
    };

    NSLog.log('listen:',opt.port);
};
function reboot() {
    server.close();
    server.onconnection = null;
    delete server;
    server = null;

    createServer(cfg.srvOptions);

};
function initSocket(sockHandle, buffer) {
    console.log('create socket');
    var socket = new net.Socket({
        handle:sockHandle
    });
    socket.readable = socket.writable = true;
    socket.server = this.server;

    var ws = new client(socket,function () {
        console.log('handshake successful.');

        ws.on('data', function (data) {
            console.log('Data Event is received ws-packet Stream.');
        });
        ws.on('message', function (msg) {
            console.log('Message is decode ws-packet Stream on:', msg);
            
            if (msg == '/reboot'){
                ws.write('reboot main server.');
                reboot();
            }

            
        });

    });

    socket.emit("connect");
    socket.emit('data',buffer);
    socket.resume();
}

/** _handle Equal Division **/
function onread_roundrobin(client_handle) {
    var worker = clusters.shift();
    worker.send({'evt':'c_equal_division'}, client_handle,[{ track: false, process: false }]);
    clusters.push(worker);
};
/** reload request header and assign **/
function onread_url_param(nread, buffer) {

    debug("reload request header and assign");

    var handle = this;
    var self = server;

    // nread > 0 read success
    if (nread < 0) return;

    if (nread === 0) {
        debug('not any data, keep waiting.');
        return;
    };

    // Error, end of file.
    if (nread === uv.UV_EOF) {
        debug('error UV_EOF: unexpected end of file.');
        handle.close();
        handleRelease(handle);
        return;
    }

    handle.readStop();
    clearTimeout(handle.closeWaiting);

    var headers = pheaders.onReadTCPParser(buffer);
    var source = headers.source;
    var general = headers.general;
    var isBrowser = (typeof general != 'undefined');
    var mode = "";
    var namespace = undefined;


    if (general) {
        mode = general[0].match('HTTP/1.1') != null ? "http" : mode;
        mode = headers.iswebsocket  ? "ws" : mode;
        namespace = general[1];
    }else
    {
        mode = "socket";
        namespace = buffer.toString('utf8');
        namespace = namespace.replace("\0","");
        // NSLog.log('trace','socket - namespace - ', namespace);
        source = buffer;
    }

    if ((buffer.byteLength == 0 || mode == "socket" || !headers) && !headers.swfPolicy) mode = "socket";
    if (headers.unicodeNull != null && headers.swfPolicy && mode != 'ws') mode = "flashsocket";

    // debug("sec-websocket-protocol:", headers["sec-websocket-protocol"]);
    // if (headers["sec-websocket-protocol"] == 'admini') {
    //     initSocket(handle, buffer);
    //     return;
    // }
    // NSLog.log('info','connection:mode:',mode);
    if ((mode === 'ws' && isBrowser) || mode === 'socket' || mode === "flashsocket") {

        if(namespace.indexOf("policy-file-request") != -1 ) {

            NSLog.log('warning','Clients is none rtmp... to destroy.');
            // handle.close(close_callback);
            // handleRelease(handle);
            // return;
            namespace = 'figLeaf';
        }
        if (namespace.length > 20 ){
            NSLog.log('warning', 'namespace change figLeaf');
            namespace = 'figLeaf';
        }

        assign(namespace, function (worker) {

            if (typeof worker === 'undefined') {
                worker = clusters["*"];
                if (!worker) {
                    handle.close();
                    console.log('!!!! close();');
                }else{
                    NSLog.log('trace','1. Socket goto %s(*)',namespace);
                    worker[0].send({'evt':'c_init',data:source}, handle,{ track: false, process: false , keepOpen:false});
                }

            }else{
                NSLog.log('trace','2. Socket goto %s',namespace);
                worker.send({'evt':'c_init',data:source}, handle,{ track: false, process: false , keepOpen:false});
            };
            handle.readStop();
        });

    }else if(mode === 'http' && isBrowser)
    {
        NSLog.log('trace','socket is http connection');
        var socket = new net.Socket({
            handle:handle,
            allowHalfOpen:httpServer.allowHalfOpen
        });
        socket.readable = socket.writable = true;
        socket.server = httpServer;
        httpServer.emit("connection", socket);
        socket.emit("connect");
        socket.emit('data',new Buffer(buffer));
        socket.resume();
        // handle.close(close_callback);
        // handleRelease(handle);
        // handle = null;
        return;// current no http service
    }else {
        NSLog.log('trace','socket mode not found.');
        handle.close(close_callback);
        handleRelease(handle);
        handle = null;
        return;// current no http service
    }

    handle.readStop();
};

function handleRelease(handle){
    handle.readStop();
    handle.onread = noop;

    handle = null;
}
/****/
function close_callback(opt) {
    if (opt)
        NSLog.log('info', 'callback handle(%s:%s) has close.',opt.address,opt.port);
    else
        NSLog.log('info', 'callback handle has close.');
}
/**
 * 建立子執行緒
 * @param opt {cluster:[file:(String)<js filename>, assign:(String)<server assign rule>]}
 */
function setupCluster(opt) {
    if (typeof opt === 'undefined') {
        opt = { 'cluster': [0] };
    }
    var num = Number(opt.cluster.length);
    if (num != 0) { //
        for (var i = 0; i < num; i++) {

            // file , fork.settings, args
            var env = process.env;
            env.NODE_CDID = i;
            //var cluster = proc.fork(opt.cluster,{silent:false}, {env:env});
            var cluster = new daemon(opt.cluster[i].file,{silent:false}, {env:env}); //心跳系統
            cluster.init();
            cluster.name = opt.cluster[i].assign;
            if (!clusters[cluster.name]) {
                clusters[cluster.name] = [];
                roundrobinNum[cluster.name] = 0;
            }
            clusters[cluster.name].push(cluster);
        };
        NSLog.log('info',"Cluster active number:", num);
    };
}
/**
 * 分流處理
 * url_param: todo config assignRule 區分
 * roundrobin: 輪詢規則不管伺服器使用者數量
 * leastconn: 檢查伺服器數量平均使用者
 * @param namespace
 * @returns {undefined}
 */
function assign(namespace, cb) {
    var cluster = undefined;

    var path = namespace.split("/");
    if (path[2]) {
        namespace = path[1];
    }else{
        namespace = path[1];
        if (typeof namespace == 'undefined') namespace = path[0];
    }
    NSLog.log('info',"assign::namespace: ", namespace);
    // url_param
    if (cfg.balance === "url_param") {

    }
    else if (cfg.balance === "roundrobin") {

        if(typeof clusters[namespace] == 'undefined') {
            if (cb) cb(undefined);
            return;
        }

        cluster = clusters[namespace][roundrobinNum[namespace]++];

        if (roundrobinNum[namespace] >= clusters[namespace].length) roundrobinNum[namespace] = 0;

        if (cb) cb(cluster);

    }else if (cfg.balance === "leastconn") { //Each server with the lowest number of connections

        var group = clusters[namespace];

        if (!group || typeof group == 'undefined') {
            // console.error('Error not found Cluster server');
            NSLog.log('error','leastconn not found Cluster server');
            if (cb) cb(undefined);
            return;
        }
        var stremNum = group.length;

        cluster = group[0];

        for (var n = 0; n < stremNum; n++) {
            //檢查最小連線數
            if (cluster.nodeInfo.connections < clusters[namespace][n].nodeInfo.connections){
                cluster = clusters[namespace][n];
            }
        }
        if (cb) cb(cluster);
    }else
    {
        // console.error('Error not found Cluster server');
        NSLog.log('error','Not found Cluster server');
        if (cb) cb(undefined);
    }
}

/** process state **/
process.on('uncaughtException', function (err) {
    console.error(err.stack);
});

process.on("exit", function () {
    NSLog.log('info',"Main Thread exit.");
});
process.on("SIGQUIT", function () {
    NSLog.log('info',"user quit node process");
});


const http = require('http');
httpServer = http.createServer(function (req,res) {
    res.writeHead(404, {"Content-Type": "text/html"});
    res.end();
});