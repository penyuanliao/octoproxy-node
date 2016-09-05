/**
 * Created by Benson.Liao on 15/12/9.
 * 多執行緒 執行
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

const util          = require('util');
const debug         = require('debug')('rtmp:LiveMaster');
debug.log           = console.log.bind(console); //file log 需要下這行
const fxNetSocket   = require('fxNetSocket');
const parser        = fxNetSocket.parser;
const pheaders      = parser.headers;
const utilities     = fxNetSocket.utilities;
const daemon        = fxNetSocket.daemon;
const client        = fxNetSocket.wsClient;
const path          = require('path');
const NSLog         = fxNetSocket.logger.getInstance();
const TCP           = process.binding("tcp_wrap").TCP; // TCP連線
const WriteWrap     = process.binding('stream_wrap').WriteWrap;
const uv            = process.binding('uv');
const fs            = require('fs');
const net           = require('net');
const evt           = require('events');
const cfg           = require('./config.js');
const gLBSrv        = require('./lib/gameLBSrv.js');
NSLog.configure({
    logFileEnabled:true,
    consoleEnabled:true,
    level:'trace',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath:__dirname+"/historyLog",
    maximumFileSize: 1024 * 1024 * 100});
const closeWaitTime = 5000;
const sendWaitClose = 5000;

/** WebSocket Server **/
var server;
/** mgmt srv **/
var mServer;
/** Sub Service **/
var clusters = [];
var clusterNum = 0;
/** [roundrobin] Client go to sub-service index **/
var roundrobinNum = [];
/** casino load balance **/
var gameLBSrv = new gLBSrv(cfg.gamSLB);
/** clients request flashPolicy source response data **/
const policy = '<?xml version=\"1.0\"?>\n<cross-domain-policy>\n<allow-access-from domain=\"*\" to-ports=\"ps\"/>\n</cross-domain-policy>\n';
NSLog.log('debug',"** Initialize FxLiveMaster.js **");
/** tracking socket close **/
const TRACE_SOCKET_IO = true;

/** 多執行緒 **/
function noop() {}

initizatialSrv();
/** cluster ended **/
function initizatialSrv() {

    utilities.autoReleaseGC(); //** 手動 1 sec gc

    NSLog.log('info' , 'Game server load balance enabled: [%s]', cfg.gamSLB.enabled);
    if (cfg.gamSLB.enabled) {
        // Initial start up on Game Server Load Balance.
        gameLBSrv.init_daemon();
    }

    // 1. setup child process fork
    setupCluster(cfg.forkOptions);
    // 2. create listen 80 port server
    NSLog.log('info', 'Ready start create server');
    createServer(cfg.srvOptions);
    // setupMemagent();

}

/**
 * 建立tcp伺服器不使用node net
 * @param opt
 */
function createServer(opt) {
    if (!opt) {
        opt = {'host':'0.0.0.0', 'port': 8080,'backlog':511};
    }
    var err, tcp_handle;
    try {
        tcp_handle = new TCP();
        err = tcp_handle.bind(opt.host, opt.port);
        if (err) {
            NSLog.log('error','tcp_handle Bind:',err , opt.host, opt.port);
            tcp_handle.close(close_callback);
            return;
        }

        err = tcp_handle.listen(opt.backlog);

        if (err) {
            NSLog.log('error', util._exceptionWithHostPort(err, 'listen', opt.host, opt.port));

            tcp_handle.close(close_callback);
            return;
        }
        tcp_handle.onconnection = function (err ,handle) {

            // user address, port
            var out = {};
            handle.getSockInfos = out;

            if (err) {
                NSLog.log('error', util._errnoException(err, 'accept'));
                rejectClientExcpetion(handle ,"UV_ERR_CON");
                handle.close(close_callback);
                return;
            }

            err = handle.getpeername(out);
            if (err) {
                rejectClientExcpetion(handle ,"UV_EADDRINUSE");
                handle.close(close_callback);
                return;
            }
            NSLog.log('info', 'Client Handle onConnection(%s:%s)', out.address, out.port);

            // console.log(out);
            handle.setNoDelay(true);

            // handle.setKeepAlive(true, 30); // handle(sec) socket(msecs)

            handle.onread = onread_url_param;

            err = handle.readStart(); //讀header封包
            if(err){
                rejectClientExcpetion(handle ,"UV_ERR_RS");
                handle.close(close_callback);
            }

            //onread_roundrobin(handle); //平均分配資源
            handle.closeWaiting = setTimeout(function () {
                rejectClientExcpetion(handle ,"CON_TIMEOUT");
                handle.close(close_callback);
            }, closeWaitTime);
        };

        server = tcp_handle;

    }
    catch (e) {
        NSLog.log('error','Create server error:', e);
        tcp_handle.close(close_callback);
    }

    NSLog.log('debug','listen:',opt.port);
}
function reboot() {
    server.close();
    server.onconnection = noop;
    delete server;
    server = null;

    createServer(cfg.srvOptions);

}
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
            };
            
        });

    });

    socket.emit("connect");
    socket.emit('data',buffer);
    socket.resume();
}
/** _handle Equal Division **/
function onread_roundrobin(client_handle) {
    var worker = clusters.shift();
    worker.send({'evt':'c_equal_division'}, client_handle, {keepOpen:false});
    clusters.push(worker);
};
/** reload request header and assign **/
function onread_url_param(nread, buffer) {

    // NSLog.log('debug',"reload request header and assign, nread:", nread);

    var handle = this;
    var self = server;

    // nread > 0 read success
    if (nread < 0) {

        if (nread == uv.UV_ECONNRESET) {
            NSLog.log('debug','connection reset by peer.');
        }
        // Error, end of file. -4095
        if (nread === uv.UV_EOF) {

            rejectClientExcpetion(handle ,"UV_EOF");
            handle.close(close_callback);
            handleRelease(handle);
            clearTimeout(handle.closeWaiting);
        }

        if (nread === 0) {
            NSLog.log('debug','not any data, keep waiting.');
        }

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
    // /(\w+)(\?|\&)([^=]+)\=([^&]+)/i < once
    //  < multi

    /** TODO 2016/08/17 -- Log Info **/
    if (handle.getSockInfos) {
        handle.getSockInfos.nread = nread; // buf size
        handle.getSockInfos.path  = namespace;
        handle.getSockInfos.mode  = mode;
    }

    /** TODO 2016/08/09 -- URL regex argument **/
    namespace = namespace.replace(/\/\w+\//i,'/'); //filter F5 load balance Rule
    const originPath = namespace;
    var args = utilities.parseUrl(namespace); //url arguments
    if (args) {
        namespace = args[0];
        var ns_len = args.length;
        var url_args = {};
        for (var i = 1; i < ns_len; i++) {
            var str = args[i].toString().replace(/(\?|\&)+/g,"");
            var keyValue = str.split("=");
            url_args[keyValue[0].toLowerCase()] = keyValue[1];
        }
        // NSLog.log("trace","url arguments:", url_args,namespace);
    }

    if ((buffer.byteLength == 0 || mode == "socket" || !headers) && !headers.swfPolicy) mode = "socket";
    if (headers.unicodeNull != null && headers.swfPolicy && mode != 'ws') mode = "flashsocket";

    if ((mode === 'ws' && isBrowser) || mode === 'socket' || mode === "flashsocket") {
        if(namespace.indexOf("policy-file-request") != -1 ) {

            tcp_write(handle, policy + '\0');
            rejectClientExcpetion(handle, "FL_POLICY");
            handle.close(close_callback);
            handleRelease(handle);
            return;
            // namespace = 'figLeaf';
        }

        if (cfg.gamSLB.enabled && namespace == cfg.gamSLB.assign) {
            NSLog.log('trace', 'gamSLB namspace:', namespace == cfg.gamSLB.assign);
            var lbtimes;

            var tokencode = gameLBSrv.getLoadBalancePath(url_args["gametype"], function (action, json) {
                NSLog.log('trace','--------------------------');
                NSLog.log('trace', 'action: %s, token code:%s', action, tokencode);
                NSLog.log('trace','--------------------------');
                var src = "";
                if (json.action == gameLBSrv.LBActionEvent.ON_GET_PATH) {
                    if (typeof lbtimes != 'undefined') clearTimeout(lbtimes);
                    lbtimes = undefined;
                    namespace = json.path.toString('utf8');
                    var src_string = source.toString('utf8').replace(originPath, namespace);
                    // var indx = source.indexOf(originPath);

                    src = new Buffer(src_string);

                    clusterEndpoint(namespace ,src);
                }else if (json.action == gameLBSrv.LBActionEvent.ON_BUSY) {

                    if (typeof lbtimes != 'undefined') clearTimeout(lbtimes);
                    lbtimes = undefined;
                    namespace = '/godead';
                    var chgSrc = source.toString('utf8').replace(originPath, namespace);
                    src = new Buffer(chgSrc);
                    gameLBSrv.getGoDead(handle, src);

                }

            });

            lbtimes = setTimeout(function () {
                gameLBSrv.removeCallbackFunc(tokencode);
                rejectClientExcpetion(handle, "CON_LB_TIMEOUT");
                handle.close(close_callback);
            }, sendWaitClose);

        }else {
            clusterEndpoint(namespace, source);
        }

        function clusterEndpoint(lastnamspace, chgSource){

            assign(lastnamspace.toString(), function (worker) {

                if (typeof chgSource != 'undefined') {
                    source = chgSource;
                }

                if (typeof worker === 'undefined') {
                    worker = clusters["*"]; //TODO 未來準備擋奇怪連線
                    if (!worker) {
                        rejectClientExcpetion(handle, "PROC_NOT_FOUND");
                        handle.close(close_callback);
                        console.log('!!!! close();');
                    }else{
                        NSLog.log('trace','1. Socket goto %s(*)', lastnamspace);
                        worker[0].send({'evt':'c_init',data:source}, handle,{keepOpen:false});
                        setTimeout(function () {
                            rejectClientExcpetion(handle, "CON_VERIFIED");
                            handle.close(close_callback);
                        }, sendWaitClose);
                    }

                }else{
                    NSLog.log('trace','2. Socket goto %s', lastnamspace);
                    worker.send({'evt':'c_init',data:source}, handle,{keepOpen:false});
                    setTimeout(function () {
                        rejectClientExcpetion(handle, "CON_VERIFIED");
                        handle.close(close_callback);
                    }, sendWaitClose);
                }

                handle.readStop();
            });
        }


    }else if(mode === 'http' && isBrowser)
    {
        NSLog.log('trace','socket is http connection');
        // var socket = new net.Socket({
        //     handle:handle,
        //     allowHalfOpen:httpServer.allowHalfOpen
        // });
        // socket.readable = socket.writable = true;
        // socket.server = httpServer;
        // httpServer.emit("connection", socket);
        // socket.emit("connect");
        // socket.emit('data',new Buffer(buffer));
        // socket.resume();
        rejectClientExcpetion(handle, "CON_MOD_NOT_FOUND");
        handle.close(close_callback);
        handleRelease(handle);
        return;// current no http service
    }else {
        rejectClientExcpetion(handle, "CON_MOD_NOT_FOUND");
        handle.close(close_callback);
        handleRelease(handle);
        return;// current no http service
    }

    handle.readStop();
}
/** handle dealloc ref **/
function handleRelease(handle){
    handle.readStop();
    handle.onread = noop;

    handle = null;
}
/** close complete **/
function close_callback() {

    if (this.getSockInfos) {

        var message;
        var status = "error";

        if (this.getSockInfos.exception) {
            message = this.getSockInfos.exception.message;
            // if (this.getSockInfos.exception.code == 0x302) status = "debug";
            status = (this.getSockInfos.exception.code == 0x200) ? "info" : "error"
        }
        else {
            message = "Reject the currently connecting client.";
        }

        if (TRACE_SOCKET_IO) {
            var now = new Date();

            NSLog.log( status, '{"msg":"%s", "ts": "%s", "src":"%s", "mode":"%s", "path":"%s"}',
                message,
                now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate() + " " + now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds(),
                this.getSockInfos.address,
                this.getSockInfos.mode,
                this.getSockInfos.path
            );
        }

    }
    else
        NSLog.log('info', 'callback handle has close.');
}
/** TCP write string **/
function tcp_write(handle, data, cb) {
    var req = new WriteWrap();
    req.handle = handle;
    req.oncomplete = function (status, handle, req, err) {
        console.log('oncomplete',status, err);
    };
    req.async = false;
    var err = handle.writeUtf8String(req, data);
    if (err) {
        NSLog.log('error', 'tcp_write:', err);
    }
}

/**
 * 建立子執行緒
 * @param opt cluster:[file:(String)<js filename>, assign:(String)<server assign rule>]
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
            var cluster = new daemon(opt.cluster[i].file,[opt.cluster[i].assign], {env:env,silent:false}); //心跳系統
            cluster.init();
            cluster.name = opt.cluster[i].assign;
            if (!clusters[cluster.name]) {
                clusters[cluster.name] = [];
                roundrobinNum[cluster.name] = 0;
            }
            clusters[cluster.name].push(cluster);
        }
        NSLog.log('info',"Cluster active number:", num);
        clusterNum = num;
    }
}
/**
 * 分流處理
 * url_param: config assignRule 區分
 * roundrobin: 輪詢規則不管伺服器使用者數量
 * leastconn: 檢查伺服器數量平均使用者
 * @param namespace
 * @param cb callback
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
    NSLog.log('info',"assign::namespace:", namespace);
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
    NSLog.log('error', 'uncaughtException:', err.stack);
});
process.on("exit", function () {
    NSLog.log('info',"Main Thread exit.");
});
process.on("SIGQUIT", function () {
    NSLog.log('info',"user quit node process");
});
process.on('message', function (data, handle) {
    var json = data;
    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
        }else{
            NSLog.log('debug', 'out of hand. dismiss message');
        }

    }
});

function rejectClientExcpetion(handle, name) {
    if (typeof handle != "undefined") {
        handle.getSockInfos.exception = utilities.errorException(name);
    }
}


