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

const closeWaitTime = 5000;

var server;
var clusters = [];
var roundrobinNum = [];

debug("** Initialize FxLiveMaster.js **");

initizatialSrv();

/** cluster ended **/
function initizatialSrv() {


    utilities.autoReleaseGC(); //** 手動 1 sec gc

    // 1. setup child process fork
    setupCluster(cfg.forkOptions);
    // 2. create listen 80 port server
    createServer(cfg.srvOptions);

}
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

            if (err) throw new Error("client not connect.");
            handle.onread = onread_url_param;
            handle.readStart(); //讀header封包
            //onread_roundrobin(handle); //平均分配資源
            handle.closeWaiting = setTimeout(function () {
                console.log('CLOSE_WAIT - Wait 5 sec timeout.');
                handle.close();
            },closeWaitTime);
        };

        server = tcp_handle;
    }
    catch (e) {
        debug('create server error:', e);
        tcp_handle.close();
    };

    debug('listen:80');
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
    // nread > 0 read success
    if (nread < 0) return;

    if (nread === 0) {
        debug('not any data, keep waiting.');
        return;
    };
    // Error, end of file.
    if (nread === uv.UV_EOF) { debug('error UV_EOF: unexpected end of file.'); return;}

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
        console.log('socket - namespace - ', namespace);
        source = namespace;
    }

    if ((buffer.byteLength == 0 || mode == "socket" || !headers) && !headers.swfPolicy) mode = "socket";
    if (headers.unicodeNull != null && headers.swfPolicy && mode != 'ws') mode = "flashsocket";

    // debug("sec-websocket-protocol:", headers["sec-websocket-protocol"]);
    // if (headers["sec-websocket-protocol"] == 'admini') {
    //     initSocket(handle, buffer);
    //     return;
    // }
    debug('connection:mode:',mode);
    if ((mode === 'ws' && isBrowser) || mode === 'socket' || mode === "flashsocket") {

        assign(namespace, function (worker) {

            if (typeof worker === 'undefined') {
                worker = clusters["*"];
                if (!worker) {
                    handle.close();
                }else{
                    worker[0].send({'evt':'c_init',data:source}, handle,[{ track: false, process: false }]);
                }

            }else{
                worker.send({'evt':'c_init',data:source}, handle,[{ track: false, process: false }]);
            };

        });

    }else if(mode === 'http' && isBrowser)
    {

        handle.close();
        handle.readStop();
        handle = null;
        return;// current no http service
        var worker = clusters[0];

        if (typeof worker === 'undefined') return;
        worker.send({'evt':'c_init',data:source}, handle,[{ track: false, process: false }]);
    }else {
        handle.close();
        handle.readStop();
        handle = null;
        return;// current no http service
    }

    handle.readStop();
};
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
        debug("Cluster active number:", num);
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
    }
    debug("assign::namespace: ", namespace);
    // url_param
    if (cfg.balance === "url_param") {

    }
    else if (cfg.balance === "roundrobin") {

        cluster = clusters[namespace][roundrobinNum[namespace]++];

        if (roundrobinNum[namespace] >= clusters[namespace].length) roundrobinNum[namespace] = 0;

        if (cb) cb(cluster);

    }else if (cfg.balance === "leastconn") { //Each server with the lowest number of connections

        var group = clusters[namespace];

        if (!group) {
            console.error('Error not found Cluster server');
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
        console.error('Error not found Cluster server');
        if (cb) cb(undefined);
    }
}

/** process state **/
process.on('uncaughtException', function (err) {
    console.error(err.stack);
});

process.on("exit", function () {
    console.log("Main Thread exit.");
    var n = clusters.length;
    while (n-- > 0) {
        clusters[n].stop();
    };

});
process.on("SIGQUIT", function () {
    console.log("user quit node process");
    var n = clusters.length;
    while (n-- > 0) {
        clusters[n].stop();
    };
    process.exit(0);
});