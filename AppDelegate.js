"use strict";
/**
 * Created by Benson.Liao on 15/12/9.
 * 多執行緒 執行
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 * 2016.10.18 memory leak 1day 20MB
 */
const version       = Number(process.versions.node.split(".")[0]);
const util          = require('util');
const fxNetSocket   = require('fxNetSocket');
const parser        = fxNetSocket.parser;
const pheaders      = parser.headers;
const utilities     = fxNetSocket.utilities;
const daemon        = fxNetSocket.daemon;
const client        = fxNetSocket.wsClient;
const xPath          = require('path');
const NSLog         = fxNetSocket.logger.getInstance();
const tcp_wrap      = process.binding("tcp_wrap");
const TCP           = tcp_wrap.TCP; // TCP連線
const {
    WriteWrap,
    kReadBytesOrError,
    streamBaseState
}                   = process.binding('stream_wrap');
const uv            = process.binding('uv');
const fs            = require('fs');
const net           = require('net');
const tls           = require('tls');
const evt           = require('events');
const cfg           = require('./config.js');
const gLBSrv        = require('./lib/gameLBSrv.js');
const Dashboard     = require("./lib/Dashboard.js");
const TelegramBot   = require("./lib/FxTelegramBot.js");
const hostname      = require('os').hostname();
const IHandler      = require('./smanager/IHandler.js');

NSLog.configure({
    logFileEnabled:true,
    consoleEnabled:true,
    level:'debug',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath: xPath.join(process.cwd(), "./historyLog"),
    id:"octoproxy",
    remoteEnabled: false,
    /*console:console,*/
    trackBehaviorEnabled: false, // toDB server [not implement]
    trackOptions:{db:"couchbase://127.0.0.1", bucket:"nodeHistory"},
    fileDateHide: true,
    fileMaxCount: 0,
    fileSort:"asc",
    maximumFileSize: 1024 * 1024 * 500});

/** remove a socket was pending timeout. **/
const closeWaitTime = 5000;
/** done accept socket was pending timeout **/
const sendWaitClose = 5000;
/** clients request flashPolicy source response data **/
const policy = '<?xml version=\"1.0\"?>\n<cross-domain-policy>\n<allow-access-from domain=\"*\" to-ports=\"80,443\"/>\n</cross-domain-policy>\n';
/** tracking socket close **/
const TRACE_SOCKET_IO = true;
/** tcp connection the maximum segment size **/
const TCP_MTU = 2048;
/** 多執行緒 **/
function noop() {}
/**
 * 主服務
 * @constructor AppDelegate
 * @property server
 * @property clusters
 * @property clusterNum
 * @property awaitTrashTimes
 * @property roundrobinNum
 * @property gameLBSrv
 */
function AppDelegate() {

    /** webSocket Server **/
    this.awaitTrashTimes = undefined; //times
    this.server          = undefined;
    this.clusterNum      = 0;
    this.clusters        = {};
    this.clustersDialog  = {};
    this.garbageDump     = []; //回收記憶體太大的
    /** [roundrobin] Client go to sub-service index **/
    this.roundrobinNum   = [];
    /** The lockdown not allows user to connect service **/
    this._lockdown       = false;
    /** casino load balance **/
    this.gameLBSrv       = new gLBSrv(cfg.gamSLB, this);
    this.mgmtSrv         = undefined;
    /** record visitor remote address **/
    this.recordDashboard = new Dashboard(Dashboard.loadFile("./historyLog/Dashboard.json"));
    this.recordEnabled   = true;
    this.setupProps();
    NSLog.log('info','lockdown:[%s]', this._lockdown);
    NSLog.log('debug', "** Initialize octoproxy.js **");
    NSLog.log("debug", " > Frontend support listens for RTMP/TCP requests to enabled: [%s]", cfg.gamSLB.rtmpFrontendEnabled);
    this.init();
}
/**
 * 初始化
 * **/
AppDelegate.prototype.init = function () {
    utilities.autoReleaseGC(); //** 手動 1 sec gc
    NSLog.log('info' , 'Game server load balance enabled: [%s]', cfg.gamSLB.enabled);
    if (cfg.gamSLB.enabled) {
        // Initial start up on Game Server Load Balance.
        this.gameLBSrv.init_daemon();
    }

    // 1. setup child process fork
    this.setupCluster(cfg.forkOptions);
    // 2. create listen 80 port server

    var self = this;
    var count = 10;
    if (cfg.env == "development") {
        NSLog.log('info', 'Ready to start create server.');
        self.server = self.createServer(cfg.srvOptions);
    }else {
        NSLog.log('info', 'Ready to start create server wait...',count);
        setTimeout(waitingHandle,1000);

        function waitingHandle() {
            NSLog.log('info', 'Ready start create server wait...',--count);
            if (count == 0) self.server = self.createServer(cfg.srvOptions);
            else setTimeout(waitingHandle,1000);
        }
    }

    this.BindingProcEvent();

    this.management();
};

/**
 * 建立tcp伺服器不使用node net
 * @param opt
 */
AppDelegate.prototype.createServer = function (opt) {
    const self = this;

    if (!opt) {
        opt = {'host':'0.0.0.0', 'port': 8080,'backlog':511};
    }
    var err, tcp_handle;
    try {

        if (version <= 6) {
            tcp_handle = new TCP();
        } else {
            tcp_handle = new TCP(tcp_wrap.constants.SERVER);
        }
        if (typeof opt.host != "undefined" && require("net").isIPv6(opt.host)) {
            err = tcp_handle.bind6(opt.host, opt.port);
        } else {
            err = tcp_handle.bind(opt.host, opt.port);
        }
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
                self.rejectClientException(handle ,"UV_ERR_CON");
                handle.close(close_callback);
                return;
            }

            err = handle.getpeername(out);
            if (err) {
                self.rejectClientException(handle ,"UV_EADDRINUSE");
                handle.close(close_callback);
                return;
            }
            NSLog.log('trace', 'Client Handle onConnection(%s:%s)', out.address, out.port);
            handle.setNoDelay(true);

            // handle.setKeepAlive(true, 30); // handle(sec) socket(msecs)

            handle.onread = onread_url_param;

            err = handle.readStart(); //讀header封包

            if (err) {
                self.rejectClientException(handle ,"UV_ERR_RS");
                handle.close(close_callback);
            }

            //onread_roundrobin(handle); //平均分配資源

            handle.closeWaiting = setTimeout(function () {
                handle.closeWaiting = undefined;
                self.rejectClientException(handle ,"CON_TIMEOUT");
                handle.close(close_callback);
            }, closeWaitTime);
        };

        return tcp_handle;

    }
    catch (e) {
        NSLog.log('error','Create server error:', e);
        tcp_handle.close(close_callback);
    }

    NSLog.log('debug','listen:',opt.port);

    /** reload request header and assign **/
    function onread_url_param() {

        // NSLog.log('debug',"reload request header and assign, nread:", nread);
        var nread, buffer;
        if (version >= 12) {
            buffer = (arguments[0] ? Buffer.from(arguments[0]) : Buffer.alloc(0));
            nread = streamBaseState[kReadBytesOrError];
        } else {
            nread = arguments[0];
            buffer = arguments[1];
        }

        var handle = this;
        // var srv = self.server;

        // nread > 0 read success
        if (nread < 0) {
            if (nread == uv.UV_ECONNRESET) {
                NSLog.log('debug','connection reset by peer.');
            }
            // Error, end of file. -4095
            if (nread === uv.UV_EOF) {

                self.rejectClientException(handle ,"UV_EOF");
                handle.close(close_callback);
                handleRelease(handle);
                clearTimeout(handle.closeWaiting);
                handle.closeWaiting = undefined;
                handle = null;
            }

            if (nread === 0) {
                NSLog.log('debug','not any data, keep waiting.');
            }

            return;
        }

        handle.readStop();
        clearTimeout(handle.closeWaiting);
        handle.closeWaiting = undefined;

        if (cfg.gamSLB.rtmpFrontendEnabled === true) {
            const MediaClientBinder = require("./Framework/FlServer/MediaClientBinder.js");
            const hasRTMP = MediaClientBinder.hasHandshake(buffer);

            if (hasRTMP) {
                onread_rtmp_param(this, buffer);
                return;
            }
        }

        let headers = pheaders.onReadTCPParser(buffer);
        /** @property {Buffer} */
        let source = headers.source;
        let general = headers.general;
        let isBrowser = (typeof general != 'undefined');
        var mode = "";
        var namespace = undefined;
        if (typeof headers["x-forwarded-for"] != "undefined") handle.getSockInfos.xff = headers["x-forwarded-for"];
        else handle.getSockInfos.xff = null;
        const host = (typeof handle.getSockInfos.xff != "undefined" && handle.getSockInfos.xff != null) ? handle.getSockInfos.xff: handle.getSockInfos.address;
        if (self.mgmtSrv.checkedIPDeny(host)) {
            self.rejectClientException(handle, "CON_DENY_CONNECT");
            handle.close(close_callback);
            handleRelease(handle);
            handle = null;
            return; // deny access
        }
        if (general) {
            mode = general[0].match('HTTP/') != null ? "http" : mode;
            mode = headers.iswebsocket  ? "ws" : mode;
            namespace = general[1];

            if (general[2] == "OPTIONS") {
                tcp_write(handle, self.corsOptions(headers));
                handle.close(close_callback);
                handleRelease(handle);
                handle = null;
                return;
            }

        } else
        {
            mode = "socket";
            namespace = buffer.toString('utf8');
            namespace = namespace.replace("\0","");
            source = buffer;
            try {
                var temp = namespace.toString().match(new RegExp("({.+?})(?={|)", "g"));
                if (Array.isArray(temp) && temp.length >= 1 && temp[0].indexOf("setup") != -1) {
                    var json = JSON.parse(temp[0]);
                    var rule1 = (json.action == "setup" && (typeof json.cluID != "undefined" || typeof json.uuid != "undefined" ));
                    if (rule1 && typeof json.balance == "string") {
                        namespace = json.balance;
                        general = ["", json.balance];
                    } else if (rule1)  {
                        namespace = json.namespace;
                        general = ["", namespace];
                    }
                }
            } catch (e) {
                NSLog.log("error", "[Socket] JSON.parse ERROR:", namespace.toString() , e);
                namespace = buffer.toString();
                namespace = namespace.replace("\0","");
            }

        }
        let mAppid = false;
        /** TODO 2016/10/06 -- ADMIN DEMO **/
        if (headers["sec-websocket-protocol"] == "admin" || headers["sec-websocket-protocol"] == "log" ||
            ((self.mgmtSrv["getSignature"] instanceof Function) && (mAppid = self.mgmtSrv["getSignature"](headers["appid"])))) {
            const [cluster] = (self.clusters["inind"] || self.clusters["administrator"] || []);
            if (cluster) cluster.send({'evt':'c_init2',data:source, mode: (mAppid ? 'http': 'ws')}, handle,{keepOpen:false});
            setTimeout(function () {
                handle.getSockInfos.path  = `${cluster.name}`;
                handle.getSockInfos.mode  = (mAppid ? 'http': 'ws');
                self.rejectClientException(handle, "CON_VERIFIED");
                handle.close(close_callback);
                handleRelease(handle);
            }, sendWaitClose);
            return;
        }
        if ((namespace || "").indexOf(cfg["heartbeat_namespace"]) != -1) {
            let heartbeatRes = "";
            if (mode === "socket" ) {
                heartbeatRes = JSON.stringify({status: "ok" , hostname: hostname});

            } else if (mode == "http") {
                heartbeatRes = [
                    "HTTP/1.1 200 OK",
                    "Connection: close",
                    "Content-Type: text/plain",
                    "",
                    "200 ok"
                ].join("\r\n");
            } else {

            }
            tcp_write(handle, heartbeatRes);
            self.rejectClientException(handle, "CON_MOD_HTTP");
            handle.close(close_callback);
            handleRelease(handle);
            handle = null;
            return;
        }
        /** TODO 2016/08/17 -- Log Info **/
        if (handle.getSockInfos && TRACE_SOCKET_IO) {
            handle.getSockInfos.nread = nread; // buf size
            handle.getSockInfos.path  = namespace;
            handle.getSockInfos.mode  = mode;
        }

        if (self._lockdown === true) {
            self.rejectClientException(handle ,"CON_LOCK_CONNECT");
            handle.close(close_callback);
            return;
        }
        /** TODO 2016/08/09 -- URL regex argument **/
        namespace = namespace.replace(/\/\w+\//i,'/'); //filter F5 load balance Rule
        const originPath = namespace;
        var args = utilities.parseUrl(namespace); //url arguments
        /**
         * @typedef {Object} url_args
         * @property {String} [gametype]
         * @property {String} [stream]
         */
        var url_args = {};
        if (args) {
            namespace = args[0];
            var ns_len = args.length;
            for (var i = 1; i < ns_len; i++) {
                var str = args[i].toString().replace(/(\?|\&)+/g,"");
                var keyValue = str.split("=");
                url_args[keyValue[0].toLowerCase()] = keyValue[1];
            }
            // NSLog.log("trace","url arguments:", url_args,namespace);
            args = null;
        }

        if ((buffer.byteLength == 0 || mode == "socket" || !headers) && !headers.swfPolicy) mode = "socket";
        if (headers.unicodeNull != null && headers.swfPolicy && mode != 'ws') mode = "flashsocket";

        if ((mode === 'ws' && isBrowser) || mode === 'socket' || mode === "flashsocket" || (cfg.gamSLB.httpEnabled && mode === 'http' && isBrowser)) {
            if(namespace.indexOf("policy-file-request") != -1 ) {

                tcp_write(handle, policy + '\0');
                self.rejectClientException(handle, "FL_POLICY");
                handle.close(close_callback);
                handleRelease(handle);
                handle = null;
                return;
                // namespace = 'figLeaf';
            }
            if (mode == "http") {
                // const httpUrl = require("url").parse(general[1]);
                const URL = require("url").URL;
                // console.log(new URL("http://127.0.0.1" + general[1]));
                const params = {f5: general[1], host: host};
                NSLog.log('debug','socket is http connection', params);

                if (url_args && (url_args.gametype || url_args.stream)) {
                    const tokencode = self.gameLBSrv.getLoadBalancePath(url_args, params, function (action, json) {
                        namespace = json.path;
                        clusterEndpoint(namespace, source, originPath, mode);
                    });
                } else {
                    namespace = self.gameLBSrv.urlParse({
                        path: general[1],
                        host: host,
                        vPrefix: cfg.gamSLB.vPrefix
                    });
                    clusterEndpoint(namespace, source, originPath, mode);
                }
                return;
            }
            //const chk_assign = cfg.gamSLB.assign.split(",").indexOf(namespace);
            const chk_assign = (cfg.gamSLB.assign == namespace);
            if (cfg.gamSLB.enabled && chk_assign || (cfg.gamSLB.videoEnabled && typeof url_args != "undefined" && typeof url_args.stream != "undefined")) {
                var lbtimes;
                var kickOut = false;
                var params = {f5: general[1], host: host};
                var tokencode = self.gameLBSrv.getLoadBalancePath(url_args, params, function (action, json) {
                    NSLog.log('trace','--------------------------');
                    NSLog.log('info', 'action: %s:%s, token code:%s', action, (typeof url_args == "object") ? JSON.stringify(url_args) : url_args, JSON.stringify(json));
                    NSLog.log('trace','--------------------------');
                    var src;

                    if (kickOut) {return;}

                    if (json.action == self.gameLBSrv.LBActionEvent.ON_GET_PATH) {
                        if (typeof lbtimes != 'undefined') clearTimeout(lbtimes);
                        lbtimes = undefined;
                        if (typeof json.path == "undefined") json.path = "";
                        namespace = json.path.toString('utf8');
                        var src_string;
                        if (mode == "socket" || mode === "flashsocket") {
                            src_string = source.toString('utf8');
                        } else {
                            src_string = source.toString('utf8').replace(originPath, namespace);
                        }
                        // var indx = source.indexOf(originPath);
                        if (typeof handle.getSockInfos != "undefined" && handle.getSockInfos != null && namespace != null && typeof namespace != "undefined") {
                            handle.getSockInfos.lbPath = namespace;
                        }
                        src = Buffer.from(src_string);
                        if (cfg.gamSLB.videoEnabled) {
                            clusterEndpoint(namespace , source, originPath, mode);
                        } else {
                            clusterEndpoint(namespace , src, originPath, mode);
                        }

                    }else if (json.action == self.gameLBSrv.LBActionEvent.ON_BUSY) {

                        if (typeof lbtimes != 'undefined') clearTimeout(lbtimes);
                        lbtimes = undefined;
                        namespace = '/godead';
                        handle.getSockInfos.lbPath = namespace;
                        self.rejectClientException(handle, "CON_DONT_CONNECT");
                        const chgSrc = source.toString('utf8').replace(originPath, namespace);
                        src = Buffer.from(chgSrc);
                        self.gameLBSrv.getGoDead(handle, src);
                        setTimeout(function () {
                            handle.close(close_callback);
                            handleRelease(handle);
                            handle = null;
                        }, sendWaitClose);
                    }

                    src = null;
                });

                lbtimes = setTimeout(function () {
                    self.gameLBSrv.removeCallbackFunc(tokencode);
                    self.rejectClientException(handle, "CON_LB_TIMEOUT");
                    handle.close(close_callback);
                    handleRelease(handle);
                    kickOut = true;
                }, sendWaitClose);

            } else {
                if (cfg.gamSLB.videoEnabled) {
                    var spPath = namespace.split("/");
                    var offset = 2;
                    if (spPath.length >= 3) {
                        if (spPath[1] != "video") offset = 1;
                        namespace = (cfg.gamSLB.vPrefix + spPath[offset]);
                    }
                    if (url_args.s === "root") {
                        namespace = {
                            dir: spPath.splice(1, 2).join("/")
                        }
                    }
                }
                clusterEndpoint(namespace, source, originPath, mode);
            }

            function clusterEndpoint(lastnamspace, chgSource, originPath, mode) {

                self.assign(lastnamspace, function (worker) {

                    if (typeof chgSource != 'undefined') {
                        source = chgSource;
                    }

                    if (typeof worker === 'undefined' || !worker) {
                        worker = self.clusters["*"]; //TODO 未來準備擋奇怪連線
                        if (typeof worker == 'undefined'  || !worker) {
                            self.rejectClientException(handle, "PROC_NOT_FOUND");
                            handle.close(close_callback);
                            handleRelease(handle);
                            NSLog.log('trace','!!!! close();');
                            handle = null;

                        }else{
                            NSLog.log('trace','1. Socket goto %s(*)', lastnamspace);
                            worker[0].send({'evt':'c_init',data:source, namespace:lastnamspace, originPath:originPath, mode}, handle,{keepOpen:false});
                            setTimeout(function () {
                                self.rejectClientException(handle, "CON_VERIFIED");
                                handle.close(close_callback);
                                handleRelease(handle);
                                handle = null;
                            }, sendWaitClose);
                        }

                    }else{

                        // don't disconnect
                        if (worker._dontDisconnect == true) {
                            self.rejectClientException(handle, "CON_DONT_CONNECT");
                            handle.close(close_callback);
                            handleRelease(handle);
                            handle = null;
                            return;
                        }

                        NSLog.log('trace','2. Socket goto %s', lastnamspace);
                        setTimeout(function () {
                            self.rejectClientException(handle, "CON_VERIFIED");
                            handle.close(close_callback);
                            handleRelease(handle);
                            handle = null;
                        }, sendWaitClose);
                        worker.send({'evt':'c_init',data:source, namespace:lastnamspace, originPath:originPath, mode}, handle,{keepOpen:false}); //KeepOpen = KeepAlive
                    }

                    //noinspection JSUnresolvedFunction
                    if (handle && handle != 0) handle.readStop();
                    source = null;
                    lastnamspace = null;
                });
            }


        } else if(mode === 'http' && isBrowser)
        {
            NSLog.log('trace','socket is http connection');
            /** TODO 2016/10/06 -- ADMIN DEMO **/
            /*
            var cluster = self.clusters["administrator"][0];
            if (cluster!= "undefined") {
                cluster.send({'evt':'c_init',data:source}, handle,{keepOpen:false});
                setTimeout(function () {
                    self.rejectClientException(handle, "CON_VERIFIED");
                    handle.close(close_callback);
                }, sendWaitClose);
                return;
            }
            */

            self.rejectClientException(handle, "CON_MOD_NOT_FOUND");
            handle.close(close_callback);
            handleRelease(handle);
            handle = null;
            return;// current no http service
        }else {
            self.rejectClientException(handle, "CON_MOD_NOT_FOUND");
            handle.close(close_callback);
            handleRelease(handle);
            handle = null;
            return;// current no http service
        }

        if (handle) handle.readStop();
    }
    /** reload request rtmp/tcp **/
    function onread_rtmp_param(handle, buffer) {
        NSLog.log("info", "Parse and respond RTMP/TCP handshake.");
        const MediaClientBinder = require("./Framework/FlServer/MediaClientBinder.js");
        const mc = new MediaClientBinder();
        mc.binder.enabled = true;
        mc.binder.mode = "transmit";

        mc.on("connect", function onMediaConnect(cmd, packet) {
            handle.readStop();
            NSLog.log("debug", "binder:", cmd);
            // NSLog.log("debug", "src:", packet);
            let dir = xPath.parse(cmd.cmdObj.app).dir;
            if (dir.split("/").length == 1) {
                dir = cmd.cmdObj.app;
            }
            if (dir.substr(dir.length-1, 1) == "/") {
                dir = dir.substr(0, dir.length-1);
            }
            NSLog.log("debug", "onread_rtmp_param.dir:", dir);
            self.assign({
                dir: dir
            }, function (worker) {
                if (typeof worker === 'undefined' || !worker) {
                    self.rejectClientException(handle, "CON_MOD_NOT_FOUND");
                    mc.socket.destroy();
                    return;
                }
                worker.send({'evt':'c_init',data: (Buffer.isBuffer(packet[0]) ? Buffer.concat(packet) : Buffer.alloc(0)), namespace: dir, originPath: dir, mode}, handle,{keepOpen:false});
                setTimeout(function () {

                    NSLog.log("debug", "onread_rtmp_param setTimeout", )
                    self.rejectClientException(handle, "CON_VERIFIED");
                    mc.socket.destroy();
                    // mc.socket._handle = null;
                }, sendWaitClose);
            }.bind(this));
        }.bind(this));
        mc.on("close", function () {
            NSLog.log("debug", "FMS parse connect is closed");
            close_callback.apply(handle);
        });
        const tmp = new net.Socket({
            handle: handle
        });
        mc.setup(tmp);
        tmp.emit("data", buffer);
        handle.readStart(); // need socket create if not Error: read EALREADY
        return mc;
    }
    /** handle dealloc ref **/
    function handleRelease(handle){
        if (handle == null) return;
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

            if (self.recordEnabled && self._lockdown === false) self.recordDashboard.record(this.getSockInfos);

            if (TRACE_SOCKET_IO) {
                var now = new Date();
                var nowFomat = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate() + " " + now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds();
                var lb = (this.getSockInfos.lbPath ? this.getSockInfos.lbPath : "null");
                NSLog.log( status, '{"msg":"%s", "ts": "%s", "src":"%s", "xff":"%s" , "mode":"%s", "path":"%s", "lb":%s}',
                    message,
                    nowFomat,
                    this.getSockInfos.address,
                    this.getSockInfos.xff,
                    this.getSockInfos.mode,
                    this.getSockInfos.path,
                    lb
                );
                this.getSockInfos.exception = null;
                this.getSockInfos.address = null;
                this.getSockInfos.mode = null;
                this.getSockInfos.path = null;
                this.getSockInfos.lbPath = null;
                this.getSockInfos = null;
                message = null;
                status = null;
                now = null;
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
            NSLog.log('trace','oncomplete',status, err);
        };
        req.async = false;
        var err = handle.writeUtf8String(req, data);
        if (err) {
            NSLog.log('error', 'tcp_write:', err);
        }
    }

};
AppDelegate.prototype.createTLSServer = function (opt) {
    const self = this;
    const options = {};
    const listenOpt = {};
    if (!opt || !opt.keyFile || !opt.certFile) {
        NSLog.log("error", "Not found cert file.");
        return false;
    }
    listenOpt.host = opt.host || "0.0.0.0";
    listenOpt.port = opt.port || 443;
    options.rejectUnauthorized = opt.rejectUnauthorized || true;
    if (opt.keyFile) options.key = fs.readFileSync(opt.keyFile);
    if (opt.certFile) options.cert = fs.readFileSync(opt.certFile);

    const tlsServer = tls.createServer(options, function onTlsIncoming(tlsSocket) {
        NSLog.log("info", "TLS Inbound %s, %s:%s", tlsSocket.remoteFamily, tlsSocket.remoteAddress, tlsSocket.remotePort);
        tlsSocket.pause();
        const sock = new net.Socket();
        sock.connect(80, "127.0.0.1", () => {
            sock.pipe(tlsSocket);
            tlsSocket.pipe(sock);
        });
        sock.once("close", () => {
           if (!tlsSocket.destroyed) tlsSocket.destroy();
        });
        tlsSocket.once("close", () => {
            sock.unpipe(tlsSocket);
            tlsSocket.unpipe(sock);
            if (!sock.destroyed) sock.destroy();
        });



    });
    tlsServer.listen(listenOpt, function () {
        console.log('tls server bound');
    })
};
/**
 *
 * @param {tls.TLSSocket} tlsSocket
 */
AppDelegate.prototype.onTlsIncoming = function (tlsSocket) {
    const self = this;
    tlsSocket.on("data", function onDataHandle(chunk) {
        self.readTCPParser(tlsSocket, chunk);
        tlsSocket.pause();
    });
};
AppDelegate.prototype.readTCPParser = function (socket, buffer) {
    const headers = pheaders.onReadTCPParser(buffer);
    console.log(headers);
};
AppDelegate.prototype.rejectClientException = function(handle, name) {
    if (typeof handle != "undefined" && TRACE_SOCKET_IO) {
        handle.getSockInfos.exception = utilities.errorException(name);
    }
};
AppDelegate.prototype.reboot = function () {
    this.server.close();
    this.server.onconnection = noop;
    delete this.server;
    this.server = undefined;

    this.server = this.createServer(cfg.srvOptions);
};
/**
 * 建立子執行緒
 * @param opt cluster:[file:(String)<js filename>, assign:(String)<server assign rule>]
 */
AppDelegate.prototype.setupCluster = function (opt) {
    if (typeof opt === 'undefined') {
        opt = { 'cluster': [] };
    }
    const num = Number(opt.cluster.length);
    if (num != 0) {
        let child;
        let params;
        for (var index = 0; index < num; index++) {
            params = opt.cluster[index];
            child = this.createChild(this, {index, params});
            this.addChild(child);
        }
        NSLog.log('info',"Cluster active number:", num);
        this.clusterNum = num;
    }
};
AppDelegate.prototype.addChild = function (child) {
    const {name} = child;
    if (!this.clusters[name]) {
        this.clusters[name] = [];
        this.roundrobinNum[name] = 0;
    }
    this.clusters[name].push(child);
};
/**
 * @typedef {Object} ChildProperties 參數
 * @property {String} file 服務程序檔案
 * @property {String} assign 服務程序名稱
 * @property {Number} mxoss 記憶體使用量
 * @property {Array} [args] commands 參數$2,$3 e.g. $file, $assign, $args1, $args2
 * @property {Boolean} [lookout=true] 子服務檢查是否回應開關
 * @property {Boolean} [heartbeat=true] 心跳機制(info跟lookout)
 * @property {Boolean} [ats] 記憶體超過回收機制開關
 * @property {Number} [recycleExpired] 清除回收後到期時間
 * @property {Boolean} [pkg] node打包執行檔模式
 * @property {Boolean} [gc] 手動gc
 * @property {Boolean} [compact] v8 args
 * @property {Boolean} [inspect] v8 args
 * @property {Array} [env] 自訂環境變數
 * @property {Array|String} [v8Flags] v8Flags

 * @property {String} cmd 執行檔
 */
/**
 *
 * @param {Object} endpoint
 * @param {Number} index
 * @param {Object} params
 * @return {daemon}
 */
AppDelegate.prototype.createChild = function (endpoint, {index, params}) {
    let options = AppDelegate.createChildProperties(params);
    let env = JSON.parse(JSON.stringify(process.env)); //環境變數
    env.NODE_CDID = String(index);
    if (options.env) IHandler.setEnvironmentVariables(env, options.env);
    let execArgv = []; // octoProxy pkg versions
    if (options.pkg != true) {
        if (options.gc) execArgv.push('--expose-gc');
        if (options.compact) execArgv.push('--always-compact');
        if (options.inspect) execArgv.push('--inspect');
        if (options.inspect) execArgv.push('--expose-gc');
        if (typeof options.v8Flags != "undefined") {
            let flags = options.v8Flags;
            if (Array.isArray(flags)) {
                flags = flags.filter((value) => {
                    return (typeof value != "undefined" && value != "" && value != null);
                });
                execArgv = execArgv.concat(flags);
            } else if (typeof flags == "string") {
                execArgv.push(flags);
            }
        }
    }
    let cmdLine = [options.assign].concat(options.args);
    let daemonOptions = {
        env,
        silent: false,
        execArgv,
        //心跳系統
        lookoutEnabled: options.lookout,
        heartbeatEnabled: options.heartbeat,
        pkgFile: options.pkg,
        cmd: options.cmd
    };
    let {file, assign, mxoss, ats} = options;
    const child = new daemon(file, cmdLine, daemonOptions);
    child.name = assign;
    child.mxoss = mxoss;
    child.ats = ats;
    child.optConf = options; //複製程序使用
    child.init();
    child.emitter.on('warp_handle', (message, handle) => endpoint.duringWarp(message, handle));
    child.emitter.on('onIpcMessage', (message) => endpoint.mgmtSrv.onIpcMessage(message));
    child.emitter.on('status', (message) => NSLog.log('warning', message));
    child.emitter.on('unexpected', function (err) {
        NSLog.log('warning', "unexpected:", err.name);
        endpoint.tgBotTemplate("-1001314121392", "shutdown", [err.name]);
    });
    child.emitter.on('restart', function () {
        endpoint.mgmtSrv.refreshClusterParams(child);
    });

    return child;
};
/**
 * @param {ChildProperties} params;
 * @return {Object}
 */
AppDelegate.createChildProperties = function (params) {
    const {
        mxoss,
        file,
        assign,
        args,
        lookout,
        ats,
        recycleExpired,
        pkg,
        cmd,
        heartbeat,
        env,
        compact,
        inspect,
        v8Flags
    } = params;
    /** @typedef {ChildProperties} */
    let options = {
        file,
        pkg: false,
        ats: false
    };
    options.assign    = utilities.trimAny(assign);
    options.mxoss     = mxoss || 2048;
    if (typeof lookout == "boolean") {
        options.lookout = lookout;
    } else {
        options.lookout = true;
    }
    if (typeof heartbeat == "boolean") {
        options.heartbeat = heartbeat;
    }
    else {
        options.heartbeat = true;
    }

    if (file.indexOf(".js") == -1) options.pkg = true;
    if (typeof pkg == "boolean") options.pkg = pkg;
    if (typeof args == "string") {
        options.args = utilities.trimAny(args).split(",");
    } else if (Array.isArray(args) && args.length > 0) {
        options.args = args.map((value) => utilities.trimAny(value.toString()));
    }
    if (typeof recycleExpired != "undefined") options.recycleExpired = recycleExpired;
    if (typeof ats == "boolean") options.ats = ats;
    if (typeof cmd != "undefined") {
        options.cmd = cmd;
    } else {
        options.cmd = false;
    }
    if (Array.isArray(env)) options.env = env;
    if (typeof compact == "boolean") options.compact = compact;
    if (typeof inspect == "boolean") options.inspect = inspect;
    if (typeof v8Flags != "undefined") options.v8Flags = v8Flags;

    return options;
};
/**
 * 分流處理
 * url_param: config assign 區分
 * roundrobin: 輪詢規則不管伺服器使用者數量
 * leastconn: 檢查伺服器數量平均使用者
 * @param {Object|String} namespace
 * @param cb callback
 * @returns {undefined}
 */
AppDelegate.prototype.assign = function (namespace, cb) {
    let url_path;
    let subname = "";
    if (typeof namespace == "string") {
        url_path = namespace || "";
        if (url_path[0] === "\/") {
            namespace = url_path.substr(1);
        }
        let split = url_path.split("/");
        subname = split[1] || split[0];
    } else if (typeof arguments[0] == "object") {
        const args = arguments[0];
        namespace = args.dir;

    }

    let clusterName = namespace;
    let group = this.clusters[clusterName];
    if ((typeof group == "undefined")) {
        clusterName = subname;
        group = this.clusters[clusterName];
    }
    if (typeof group == "undefined") {
        clusterName = this.findAssignRules({namespace, subname});
        group = this.clusters[clusterName];
    }

    if (!group || typeof group == 'undefined') {
        // console.error('Error not found Cluster server');
        NSLog.log('error','leastconn not found Cluster server');
        if (cb) cb(undefined);
        return;
    }

    // url_param
    if (cfg.balance === "url_param") {

    } else if (cfg.balance === "roundrobin") {
        this.roundrobin({namespace: clusterName, group: group}, cb);
    } else if (cfg.balance === "leastconn") { //Each server with the lowest number of connections
        this.leastconn({namespace: clusterName, group: group}, cb);
    } else
    {
        // console.error('Error not found Cluster server');
        NSLog.log('error','Not found Cluster server');
        if (cb) cb(undefined);
    }
};
AppDelegate.prototype.asyncAssign = function (namespace) {
    return new Promise((resolve, reject) => {
        this.assign(namespace, () => resolve);
    });
};
AppDelegate.prototype.findAssignRules = function ({namespace, subname}) {
    for (let str in this.clusters) {
        if (!this.clusters.hasOwnProperty(str)) continue;
        let assignRules = new Set(str.split(","));
        if (assignRules.has(namespace) || assignRules.has(subname)) {
            return str;
        }
    }
    return undefined;
};
AppDelegate.prototype.roundrobin = function ({namespace, group}, cb) {
    let cluster = group[this.roundrobinNum[namespace]++];

    if (this.roundrobinNum[namespace] >= group.length) {
        this.roundrobinNum[namespace] = 0;
    }
    if (cb) cb(cluster);
};
AppDelegate.prototype.leastconn = function ({namespace, group}, cb) {
    let num = group.length;
    let cluster = group[0];
    for (let n = 0; n < num; n++) {
        //檢查最小連線數
        let { connections } = group[n].nodeInfo.connections;
        let isPriority = (cluster.nodeInfo.connections > connections);
        if (isPriority) cluster = group[n];
    }
    if (cb) cb(cluster);
};
AppDelegate.prototype.createTelegramBot = function (opt, proxy) {
    this.tgBot = TelegramBot.getInstance();
    this.tgBot.setBot(opt.bot, opt.token);
    this.tgBot.setProxy(proxy.host, proxy.port);
};
AppDelegate.prototype.tgBotSend = function (chatID, message) {
    if (typeof this.tgBot != "undefined") {
        this.tgBot.sendMessage(chatID, message);
    }
};
AppDelegate.prototype.tgBotTemplate = function (chatID, type, args) {
    if (typeof this.tgBot == "undefined") return false;
    if (type == "shutdown") {
        this.tgBotSend(chatID, util.format("%s ❗️shutdown: reboot by \n<code>%s</code>|<b>%s</b>", hostname, TelegramBot.dateFormat(new Date()), args[0]));
    }
};
/** 清除回收桶裡的cluster **/
AppDelegate.prototype.awaitRecycle = function () {
    var self = this;
    var garbagedump = this.garbageDump;
    if (typeof this.awaitTrashTimes != "undefined") {
        return;
    }
    this.awaitTrashTimes = setInterval(function () {
        for (var i = 0; i < garbagedump.length; i++) {
            var cluster = garbagedump[i];
            var count = cluster.nodeInfo.connections;
            //到期時間回收
            const expired = (typeof cluster.optConf["recycleExpired"] != "undefined" && (new Date().getTime() - cluster.recycleStartDate) > (cluster.optConf["recycleExpired"] * 1000));

            if (count <= 10 || expired) {
                NSLog.log("warning", "AppDelegate.awaitTrashUserEmpty(), name:%s", cluster.name);
                cluster.stop();
                cluster.stopHeartbeat();
                garbagedump.splice(i, 1);
                i--;
            }
        }
    }, 5 * 60 * 1000);

};
AppDelegate.prototype.BindingProcEvent = function () {
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
    process.on("SIGINT", function () {
        NSLog.log('error',"SIGINT quit node process (Ctrl+D).");
        process.exit(0);
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
};
AppDelegate.prototype.__defineSetter__("lockState", function (state) {
   if (typeof state == "undefined") {
        this._lockdown = false;
   } else if (typeof state == "boolean") {
       this._lockdown = state;
   } else {
        this._lockdown = false;
   }
});
AppDelegate.prototype.setupProps = function () {
    Object.defineProperty(this, "lockdown", {
        get() {
            return this._lockdown;
        },
        set(bool) {
            console.log(`app.lockdown: ${bool}`);
            if (typeof bool === "boolean") {
                this._lockdown = bool;
            }
        },
        enumerable:false,
        configurable:false
    })
}
/**
 * clusters attribute
 * + clusters[key][0]
 * //not implement//
 */
AppDelegate.prototype.management = function () {
    NSLog.log('debug', '** Setup management service port:%s **', cfg.managePort);
    const IManager = require('./smanager/IManager.js');
    this.mgmtSrv = IManager.createManager(this);
    // this.manager.nodesInfo.on('refresh', (element) => {
    // console.log('refresh', element.length);
    // this.manager.coreInfo.getPID(element); //更新系統資訊
    // })
    // this.manager.coreInfo.start(); //開始系統資訊

};
AppDelegate.prototype.reLoadManagement = function () {
    this.mgmtSrv.close();
    delete require.cache[require.resolve('./smanager/IManager.js')];
    this.management();
};
//socket hot reload0
AppDelegate.prototype.duringWarp = function (message, handle) {
    const self = this;
    const assign = String(message.goto);
    const event = "wrap_socket";
    this.assign(assign, function (worker) {
        if (typeof worker === 'undefined' || !worker) {
            handle = null;
            return;
        }
        worker.send({
            evt: event,
            raw: message.raw,
            metadata: message.metadata,
            namespace: assign,
            originPath: message.originPath
        }, handle, {keepOpen: false});
    })
};
AppDelegate.prototype.addClusterDialog = function (cluster) {
    console.log(cluster.name, cluster._modulePath, cluster.uptime);
};
AppDelegate.prototype.corsOptions = function (headers) {
    let corsPolicy = [
        'HTTP/1.1 200 OK',
        'Access-Control-Allow-Origin: *',
        'Access-Control-Allow-Credentials: true',
        'Access-Control-Allow-Method: ' + headers['access-control-request-method'],
        'Access-Control-Allow-Headers: ' + headers['access-control-request-headers'],
        'Connection: Close'
    ].join("\r\n");
    corsPolicy += '\r\n\r\n';
    return corsPolicy;
};

module.exports = exports = AppDelegate;


/**
 * linux tcp_wrap tcp wrapper
 * @namespace handle
 **/
/** get tcp ip address or port
 * @function getpeername
 * @memberof handle
 **/
/** tcp read strat
 * @function readStart
 * @memberof handle
 **/
/** tcp read stop
 * @function readStop
 * @memberof handle
 **/
/** tcp listen port
 * @function listen
 * @memberof handle
 **/
/**
 * @function TCP
 * @memberof TCP
 **/

/**
 * @function WriteWrap
 * @memberof WriteWrap
 **/
/**
 * @namespace uv
 **/
/**
 * @function UV_ECONNRESET
 * @memberof uv
 **/
/**
 * @function UV_EOF
 * @memberof uv
 **/
/**
 * @namespace tcp_wrap
 **/
/**
 * @constant tcp_wrap.constants
 * @type {Object}
 * @memberof tcp_wrap
 * @description latest nodeJS version 6.0 of support
 **/
/**
 * @constant tcp_wrap.constants.SERVER
 * @type {Number}
 * @memberof tcp_wrap.constants
 **/
/**
 * @constant tcp_wrap.constants.SOCKET
 * @type {Number}
 * @memberof tcp_wrap.constants
 **/
