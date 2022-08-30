"use strict";
const version       = Number(process.versions.node.split(".")[0]);
const util          = require('util');
const events        = require("events");
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

const TCP_OPTIONS = Object.freeze({
    host:'0.0.0.0',
    port: 8080,
    backlog:511
});

/** 多執行緒 **/
function noop() {}

/**
 * 主服務
 * @constructor IDelegate
 * @property server
 * @property clusters
 * @property clusterNum
 * @property awaitTrashTimes
 * @property roundrobinNum
 * @property gameLBSrv
 */
class IDelegate extends events.EventEmitter {
    constructor() {
        super();
        this.setup();
    }
    set lockState(state) {
        if (typeof state == "undefined") {
            this._lockdown = false;
        } else if (typeof state == "boolean") {
            this._lockdown = state;
        } else {
            this._lockdown = false;
        }
    };
    set lockdown(values) {
        return this.lockState = values;
    };
    get lockState() {
        return this._lockdown;
    };
    setup() {
        /** webSocket Server **/
        this.awaitTrashTimes = undefined; //times
        this.server          = undefined;
        this.clusterNum      = 0;
        this.clusters        = {};
        this.clusterMap      = new WeakMap();
        this.ruleTable       = new Map();
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
        this.tokenId = 0;
        NSLog.log('info','lockdown:[%s]', this._lockdown);
        NSLog.log('debug', "** Initialize octoproxy.js **");
        NSLog.log("debug", " > Frontend support listens for RTMP/TCP requests to enabled: [%s]", cfg.gamSLB.rtmpFrontendEnabled);
        this.init();
    };
    init() {
        utilities.autoReleaseGC(); //** 手動 1 sec gc
        NSLog.log('info' , 'Game server load balance enabled: [%s]', cfg.gamSLB.enabled);
        if (cfg.gamSLB.enabled) {
            // Initial start up on Game Server Load Balance.
            this.gameLBSrv.init_daemon();
        }

        // 1. setup child process fork
        this.setupCluster(cfg.forkOptions);
        // 2. create listen 80 port server
        this.start();

        this.bindingProcessEvent();

        this.management();
    };
    async start() {
        let { srvOptions, tlsOptions } = cfg;
        NSLog.log('info', `Ready to start create net server ${JSON.stringify(srvOptions)}.`);
        if (cfg.env !== "development") {
            await this.countdown(10);
        }
        this.server = this.createServer(srvOptions);

        if (tlsOptions && tlsOptions.enabled) {
            this.tlsServer = this.createTLSServer(tlsOptions);
        }
        return true;
    }
    /**
     * 建立子執行緒
     * @param opt cluster:[file:(String)<js filename>, assign:(String)<server assign rule>]
     */
    setupCluster(opt) {
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
    /**
     * 建立tcp伺服器不使用node net
     * @param opt
     */
    createServer(opt) {
        if (!opt) opt = Object.assign({}, TCP_OPTIONS);
        let err, tcp_handle;
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
                tcp_handle.close(() => this.close_callback());
                return null;
            }

            err = tcp_handle.listen(opt.backlog);

            if (err) {
                NSLog.log('error', util._exceptionWithHostPort(err, 'listen', opt.host, opt.port));

                tcp_handle.close(() => this.close_callback());
                return null;
            } else {
                NSLog.info(`Start listening on ${opt.host}:${opt.port} backlog:${opt.backlog}`);
            }

            tcp_handle.onconnection = (err, handle) => this.onconnection(err, handle);
        } catch (e) {
            NSLog.error('Create TCP Server failed. Error:', e);
            return null;
        }
        return tcp_handle;
    }
    /** income connect */
    onconnection(err, handle) {
        // user address, port
        let out = {};
        handle.getSockInfos = out;

        if (err) {
            NSLog.log('error', util._errnoException(err, 'accept'));
            this.rejectClientException(handle ,"UV_ERR_CON");
            handle.close(() => this.close_callback(handle));
            return false;
        }
        err = handle.getpeername(out); //Get remote info
        if (err) {
            this.rejectClientException(handle ,"UV_EADDRINUSE");
            handle.close(() => this.close_callback(handle));
            return false;
        }
        // NSLog.log('trace', 'Client Handle onConnection(%s:%s)', out.address, out.port);
        handle.setNoDelay(true);

        handle.onread = (args1, args2) => {
            let nread, buffer;
            if (version >= 12) {
                buffer = (args1 ? Buffer.from(args1) : Buffer.alloc(0));
                nread = streamBaseState[kReadBytesOrError];
            } else {

                nread = args1;
                buffer = args2;
            }
            this.onread_url_param(nread, buffer, handle);
        }
        err = handle.readStart(); //讀header封包
        if (err) {
            this.rejectClientException(handle ,"UV_ERR_RS");
            handle.close(() => this.close_callback(handle));
        }
        handle.closeWaiting = setTimeout(() => {
            handle.closeWaiting = undefined;
            this.rejectClientException(handle ,"CON_TIMEOUT");
            handle.close(() => this.close_callback(handle));
        }, closeWaitTime);
    };
    /** reload request header and assign **/
    onread_url_param(nread, buffer, handle) {
        // error event
        if (nread < 0) {
            if (nread == uv.UV_ECONNRESET) {
                NSLog.log('debug','ignored connection reset by peer.');
            }
            // Error, end of file. -4095
            if (nread === uv.UV_EOF) {
                this.rejectClientException(handle ,"UV_EOF");
                handle.close(this.close_callback.bind(handle, this));
                this.handleRelease(handle);
                clearTimeout(handle.closeWaiting);
                handle.closeWaiting = undefined;
                handle = null;
            }

            if (nread === 0) {
                // NSLog.log('debug','End of File.');
            }
            return false;
        }
        //success event
        handle.readStop();
        clearTimeout(handle.closeWaiting);
        handle.closeWaiting = undefined;

        let binding = this.bindingParser(handle, buffer);
        // FMS parser
        if (binding) return true;
        // http, ws, socket parser
        let headers = pheaders.onReadTCPParser(buffer);
        /** @property {Buffer} */
        let source = headers.source;
        let general = headers.general;
        let isBrowser = (typeof general != 'undefined');
        let { getSockInfos } = handle;
        let mode = "";
        let namespace = undefined;
        let hack = false;
        if (typeof headers["x-forwarded-for"] != "undefined") getSockInfos.xff = headers["x-forwarded-for"];
        else handle.getSockInfos.xff = null;
        const host = (typeof getSockInfos.xff == "string") ? getSockInfos.xff : getSockInfos.address;
        if (this.mgmtSrv.checkedIPDeny(host)) {
            this.rejectClientException(handle, "CON_DENY_CONNECT");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
            return false; // deny access
        }
        if (general) {
            mode = general[0].match('HTTP/') != null ? "http" : mode;
            mode = headers.iswebsocket  ? "ws" : mode;
            namespace = general[1];
        } else {
            mode = "socket";
            namespace = buffer.toString().replace('\0', '');
            source = buffer;
            try {
                let temp = namespace.toString().match(new RegExp("({.+?})(?={|)", "g"));
                if (Array.isArray(temp) && temp.length >= 1 && temp[0].indexOf("setup") != -1) {
                    let json = JSON.parse(temp[0]);
                    let rule1 = (json.action == "setup" && (typeof json.cluID != "undefined" || typeof json.uuid != "undefined" ));
                    if (rule1 && typeof json.balance == "string") {
                        namespace = json.balance;
                        general = ["", json.balance];
                    } else if (rule1)  {
                        namespace = json.namespace;
                        general = ["", namespace];
                    }
                } else {
                    general = [];
                    hack = true;
                }
            } catch (e) {
                hack = true;
                NSLog.log("error", "[Socket] JSON.parse ERROR:", namespace.toString() , e);
            }
        }
        if (hack) {
            const {heartbeat_namespace} = cfg;
            this.tcp_write(handle, this.createBody({namespace: heartbeat_namespace, mode: 'http', status: 401}));
            this.rejectClientException(handle, "CON_DENY_CONNECT");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
            return true;
        }
        /** TODO 2016/10/06 -- ADMIN DEMO **/
        let method = general[2];
        let hasManage = this.onManager({headers, method, mode, source}, handle);
        if (hasManage) return true;
        /** TODO 2016/08/17 -- Log Info **/
        if (handle.getSockInfos && TRACE_SOCKET_IO) {
            handle.getSockInfos.nread = nread; // buf size
            handle.getSockInfos.path  = namespace;
            handle.getSockInfos.mode  = mode;
        }



        /** 回應heartbeat **/
        let echo = this.createBody({namespace, mode, status: 200});

        if (echo) {
            this.tcp_write(handle, echo);
            this.rejectClientException(handle, "CON_MOD_HTTP");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
            return true;
        }

        if (this._lockdown) {
            this.rejectClientException(handle ,"CON_LOCK_CONNECT");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
            return true;
        }
        /** TODO 2016/08/09 -- URL regex argument **/
        namespace = namespace.replace(/\/\w+\//i,'/'); //filter F5 load balance Rule
        const originPath = namespace;
        let args = utilities.parseUrl(namespace); //url arguments
        let url_args = {};
        if (args) {
            namespace = args[0];
            let ns_len = args.length;
            for (let i = 1; i < ns_len; i++) {
                let str = args[i].toString().replace(/(\?|\&)+/g,"");
                let keyValue = str.split("=");
                url_args[keyValue[0].toLowerCase()] = keyValue[1];
            }
            args = null;
        }
        if ((buffer.byteLength == 0 || mode == "socket" || !headers) && !headers.swfPolicy) {
            mode = "socket";
        } else if (headers.unicodeNull != null && headers.swfPolicy && mode != 'ws') {
            mode = "flashsocket";
        }
        const { httpEnabled } = cfg.gamSLB;
        let params = {f5: general[1], host: host};

        if (httpEnabled && mode === 'http' && isBrowser) {
            if (this.fl_policy({namespace, handle})) return true;
            NSLog.log('debug','socket is http connection', params);
            this.gateway_http({params, url_args, namespace, source, originPath, mode}, handle);

        } else if ((mode === 'ws' && isBrowser) ||
            mode === 'socket' ||
            mode === "flashsocket") {
            this.gateway_general({params, url_args, namespace, source, originPath, mode, host}, handle);

        } else {
            // destroy()
            this.rejectClientException(handle, "CON_MOD_NOT_FOUND");
            handle.close(() => this.close_callback(handle));
            this.handleRelease(handle);
            return false;// current no http service
        }
        if (handle) handle.readStop();
    }
    bindingParser(handle, buffer) {
        let {rtmpFrontendEnabled} = cfg.gamSLB;
        if (!rtmpFrontendEnabled) return false;
        const MediaClientBinder = require("./Framework/FlServer/MediaClientBinder.js");
        const hasRTMP = MediaClientBinder.hasHandshake(buffer);
        if (hasRTMP) {
            this.onread_rtmp_param(handle, buffer);
            return true;
        } else {
            return false;
        }
    };
    gateway_http({params, url_args, namespace, source, originPath, mode}, handle) {
        if (url_args && (url_args.gametype || url_args.stream)) {
            const tokencode = this.gameLBSrv.getLoadBalancePath(url_args, params,(action, json) => {
                namespace = json.path;
                this.clusterEndpoint({namespace, source, originPath, mode}, handle).then(() => {});
            });
        } else {
            namespace = this.gameLBSrv.urlParse({
                path: params.f5,
                host: params.host,
                vPrefix: cfg.gamSLB.vPrefix,
                specificBase: cfg.specificBase
            });
            this.clusterEndpoint({namespace, source, originPath, mode}, handle).then(() => {});
        }
        return true;
    };
    gateway_general({params, url_args, namespace, source, originPath, mode, host}, handle) {
        const { assign, enabled, videoEnabled, vPrefix } = cfg.gamSLB;
        const { specificBase } = cfg;
        const chk_assign = (assign == namespace);
        if (enabled && chk_assign || (videoEnabled && typeof url_args != "undefined" && typeof url_args.stream != "undefined")) {
            let lbtimes;
            let kickOut = false;
            let tokencode = this.gameLBSrv.getLoadBalancePath(url_args, params, (action, json) => {
                NSLog.log('trace','--------------------------');
                NSLog.log('info', 'action: %s:%s, token code:%s', action, (typeof url_args == "object") ? JSON.stringify(url_args) : url_args, JSON.stringify(json));
                NSLog.log('trace','--------------------------');
                let src;
                if (kickOut) { return false; }
                if (json.action == this.gameLBSrv.LBActionEvent.ON_GET_PATH) {
                    if (typeof lbtimes != 'undefined') clearTimeout(lbtimes);
                    lbtimes = undefined;
                    if (typeof json.path == "undefined") json.path = "";
                    namespace = json.path.toString();
                    var src_string;
                    if (mode == "socket" || mode === "flashsocket") {
                        src_string = source.toString();
                    } else {
                        src_string = source.toString().replace(originPath, namespace);
                    }
                    // var indx = source.indexOf(originPath);
                    if (typeof handle.getSockInfos != "undefined" && handle.getSockInfos != null && namespace != null && typeof namespace != "undefined") {
                        handle.getSockInfos.lbPath = namespace;
                    }
                    src = (videoEnabled) ? source : Buffer.from(src_string);

                    this.clusterEndpoint({namespace, source:src, originPath, mode}, handle).then(() => {});

                } else if (json.action == this.gameLBSrv.LBActionEvent.ON_BUSY) {
                    if (typeof lbtimes != 'undefined') clearTimeout(lbtimes);
                    lbtimes = undefined;
                    namespace = '/godead';
                    handle.getSockInfos.lbPath = namespace;
                    this.rejectClientException(handle, "CON_DONT_CONNECT");
                    const chgSrc = source.toString().replace(originPath, namespace);
                    src = Buffer.from(chgSrc);
                    this.gameLBSrv.getGoDead(handle, src);
                    setTimeout(() => {
                        handle.close(this.close_callback.bind(handle, this));
                        this.handleRelease(handle);
                        handle = null;
                    }, sendWaitClose);
                }
                src = null;
            });
        } else {
            if (videoEnabled) {
                let layer = namespace.split("/");
                let offset = 2;
                if (specificBase && specificBase.has(layer[1])) {
                    namespace = this.gameLBSrv.urlParse({
                        path: namespace,
                        host: host,
                        vPrefix,
                        specificBase: specificBase
                    });
                }
                else if (layer.length >= 3) {
                    if (layer[1] != "video") offset = 1;
                    namespace = (vPrefix + layer[offset]); //ex: video/h264 => edge_h264

                    if (url_args.s === "root") {
                        namespace = {
                            dir: layer.splice(1, 2).join("/")
                        }
                    }
                }
            }
            this.clusterEndpoint({namespace, source, originPath, mode}, handle).then(() => {});
        }
    };
    async clusterEndpoint({namespace, source, originPath, mode}, handle) {
        let worker = await this.asyncAssign(namespace).catch((reason) => {
            NSLog.error(`clusterEndpoint catch: \r\n`, reason);
        });
        if (typeof worker === 'undefined' || !worker) {
            this.exceptionBreaker({namespace, source, originPath, mode}, handle);
        } else if (worker._dontDisconnect) {
            handle.getSockInfos.lbPath = `octo_bl(${worker.name})`;
            this.rejectClientException(handle, "CON_DONT_CONNECT");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
            return false;
        } else {
            handle.getSockInfos.lbPath = `octo_bl(${worker.name})`;
            NSLog.trace(`OctoBalancer ${namespace} -> ${worker.name}`);
            worker.send({evt: 'c_init', data:source, namespace, originPath, mode}, handle, {keepOpen:false}); //KeepOpen = KeepAlive
            setTimeout(() => {
                this.rejectClientException(handle, "CON_VERIFIED");
                handle.close(this.close_callback.bind(handle, this));
                this.handleRelease(handle);
                handle = null;
            }, sendWaitClose);
        }
        //noinspection JSUnresolvedFunction
        if (handle && handle != 0) handle.readStop();
        source = null;
    };

    /** reload request rtmp/tcp **/
    onread_rtmp_param(handle, buffer) {
        NSLog.log("info", "Parse and respond RTMP/TCP handshake.");
        const MediaClientBinder = require("./Framework/FlServer/MediaClientBinder.js");
        const mc = new MediaClientBinder();
        mc.binder.enabled = true;
        mc.binder.mode = "transmit";
        mc.on("connect", async (cmd, packet) => {
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
            let worker = await this.asyncAssign({ dir: dir });
            if (typeof worker === 'undefined' || !worker) {
                this.rejectClientException(handle, "CON_MOD_NOT_FOUND");
                mc.socket.destroy();
                return;
            }
            let rtmp_data = (Buffer.isBuffer(packet[0]) ? Buffer.concat(packet) : Buffer.alloc(0));
            worker.send({evt:'c_init', data: rtmp_data, namespace: dir, originPath: dir, mode: "rtmp"}, handle, {keepOpen:false});

            let timer3 = setTimeout(() => {
                NSLog.log("debug", "onread_rtmp_param setTimeout", )
                this.rejectClientException(handle, "CON_VERIFIED");
                mc.socket.destroy();
            }, sendWaitClose);
        });
        mc.on("close", () => {
            NSLog.debug("FMS parse connect is closed.");
            this.close_callback(handle);
        });
        const tmp = new net.Socket({ handle });
        mc.setup(tmp);
        tmp.emit("data", buffer);
        handle.readStart(); // need socket create if not Error: read EALREADY
        return mc;
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
    assign(namespace, cb) {
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
        let group = this.getChild(clusterName);
        if ((typeof group == "undefined")) {
            clusterName = subname;
            group = this.getChild(clusterName);
        }
        if (typeof group == "undefined") {
            clusterName = this.findAssignRules({namespace, subname});
            group = this.getChild(clusterName);
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
    asyncAssign(namespace) {
        return new Promise((resolve, reject) => {
            this.assign(namespace, resolve);
        });
    };
    exceptionBreaker({namespace, source, originPath, mode}, handle) {
        let worker = this.clusters['*']; //TODO 未來準備擋奇怪連線
        if (typeof worker == 'undefined'  || !worker) {

        } else {
            NSLog.log("warning", `exceptionBreaker -> `, namespace);
            worker[0].send({'evt':'c_init', data: source, namespace, originPath, mode}, handle, { keepOpen:false });
            setTimeout(() => {
                this.rejectClientException(handle, "CON_VERIFIED");
                handle.close(this.close_callback.bind(handle, this));
                this.handleRelease(handle);
                handle = null;
            }, sendWaitClose);
        }

    };
    findAssignRules({namespace, subname}) {
        let {ruleTable} = this;
        if (ruleTable.has(namespace)) {
            return ruleTable.get(namespace).name;
        } else if (ruleTable.has(subname)) {
            return ruleTable.get(subname).name;
        }
        return undefined;
    };
    /**
     * 循環法
     * @param {string} namespace
     * @param {Array} group
     * @param {Function} cb
     */
    roundrobin({namespace, group}, cb) {
        let cluster;
        do {
            cluster = group[this.roundrobinNum[namespace]++];
            if (this.roundrobinNum[namespace] >= group.length) {
                this.roundrobinNum[namespace] = 0;
                if (cb) cb(undefined);
            }
        } while (cluster.creationComplete != 1)
        if (cb) cb(cluster);
    };
    /**
     * 最少連線排程法
     * @param {string} namespace
     * @param {Array} group
     * @param {Function} cb
     */
    leastconn({namespace, group}, cb) {
        let num = group.length;
        let cluster = group[0];
        for (let n = 0; n < num; n++) {
            //檢查最小連線數
            let { connections, creationComplete } = group[n].nodeInfo;
            let isPriority = (cluster.nodeInfo.connections > connections) && (creationComplete == 1);
            if (isPriority) cluster = group[n];
        }
        if (cb) cb(cluster);
    };
    onManager({headers, method, mode, source}, handle) {
        let corsMode = false;
        let appid = false;
        const swp = headers["sec-websocket-protocol"];
        const {getSignature} = this.mgmtSrv;

        if (mode == 'http' && headers['sec-fetch-mode'] == 'cors' && method === 'OPTIONS') {
            corsMode = (headers["access-control-request-headers"].indexOf('appid') != -1);
        } else {
            appid = ((getSignature instanceof Function) && getSignature(headers["appid"]));
        }
        if (swp == "admin" || swp == "log" || corsMode || appid || headers.general[1].split("/")[1] === 'mgr') {
            const [cluster] = (this.clusters["inind"] || this.clusters["administrator"] || []);
            const name = `${(cluster ? cluster.name : null)}`;
            const exception = (corsMode ? "HTTP_CROSS_POLICY" : "CON_VERIFIED");
            if (cluster) {
                cluster.send({
                    evt:'c_init2',
                    data: source,
                    mode,
                    id: this.getTokenId()
                }, handle, { keepOpen:false }, (json) => {
                    if (!json.event) return false;
                    clearTimeout(socket_timer);
                    this.admin_free({handle, name, exception, mode});
                });
            }
            let socket_timer = setTimeout(() =>
                this.admin_free({handle, name, exception, mode}), sendWaitClose);
            return true;
        }
        return false;
    };

    /**
     * 回傳響應事件
     * @param namespace
     * @param mode
     * @param status
     * @return {string|boolean}
     */
    createBody({namespace, mode, status}) {
        const {heartbeat_namespace} = cfg;
        if (!namespace) return false;
        if (!status) status = 200;
        if (namespace.indexOf(heartbeat_namespace) != -1) {
            let heartbeatRes = "";
            if (mode === "socket" ) {
                heartbeatRes = JSON.stringify({status: "ok" , hostname: hostname});

            } else if (mode == "http") {
                heartbeatRes = [
                    `HTTP/1.1 ${status} ${parser.status_code[status]}`,
                    "Connection: close",
                    "Content-Type: text/plain",
                    "",
                    `${status} ${parser.status_code[status]}`
                ].join("\r\n");
            }
            return heartbeatRes;
        }
        return false;
    };
    fl_policy({namespace, handle}) {
        if (namespace.indexOf("policy-file-request") != -1) {
            this.tcp_write(handle, policy + '\0');
            this.rejectClientException(handle, "FL_POLICY");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
            return true;
        }
        return false;
    };
    /** TCP write string **/
    tcp_write(handle, data, cb) {
        let req = new WriteWrap();
        req.handle = handle;
        req.oncomplete = function (status, handle, req, err) {
            NSLog.log('trace','oncomplete', status, err);
        };
        req.async = false;
        let err = handle.writeUtf8String(req, data);
        if (err) {
            NSLog.log('error', 'tcp_write:', err);
        }
        if (cb) cb(req);
    };
    /** close complete **/
    close_callback() {
        let handle, endpoint;
        if (arguments[0] instanceof IDelegate) {
            endpoint = arguments[0];
            handle = this;
        } else {
            endpoint = this;
            handle = arguments[0];
        }
        if (handle && handle.getSockInfos) {
            const { recordEnabled, _lockdown, recordDashboard } = endpoint;
            let message;
            let status = 'error';
            let { getSockInfos } = handle;
            let { exception, lbPath, address, xff, mode, path } = getSockInfos;

            if (exception) {
                message = exception.message;
                status  = (exception.code == 0x200) ? 'info' : 'error';
            } else {
                message = "Reject the currently connecting client.";
            }

            if (recordEnabled && !_lockdown) recordDashboard.record(getSockInfos);

            if (TRACE_SOCKET_IO) {
                let ts = endpoint.dateFormat();
                let lb = (lbPath ? lbPath : 'null');
                NSLog.log(status, `{"msg":"${message}", "ts": "${ts}", "src":"${address}", "xff":"${xff}" , "mode":"${mode}", "path":"${path}", "lb":${lb}}`);
                endpoint.clearGetSockInfos(handle);
            }

        } else {
            NSLog.log('info', 'callback handle has close.');
        }
        handle = null;
        endpoint = null;
    };
    clearGetSockInfos(handle) {
        let { getSockInfos } = handle;
        if (getSockInfos) {
            getSockInfos.exception = null;
            getSockInfos.address = null;
            getSockInfos.mode = null;
            getSockInfos.path = null;
            getSockInfos.lbPath = null;
            handle.getSockInfos = null;
        }
    };
    rejectClientException(handle, name) {
        if (typeof handle != "undefined" && TRACE_SOCKET_IO) {
            handle.getSockInfos.exception = utilities.errorException(name);
        }
    };
    dateFormat() {
        let now = new Date();
        return `${now.getFullYear()}/${(now.getMonth() + 1)}/${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
    }
    getTokenId() {
        if (this.tokenId >= 100000) this.tokenId = 0;
        return `/${this.tokenId++}`;
    }
    /** handle dealloc ref **/
    handleRelease(handle) {
        if (handle == null) return false;
        handle.readStop();
        handle.onread = noop;
        handle = null;
        return true;
    };
    admin_free({handle, name, exception, mode}) {
        handle.getSockInfos.path = name;
        handle.getSockInfos.mode = mode;
        this.rejectClientException(handle, exception);
        handle.close(this.close_callback.bind(handle, this));
        this.handleRelease(handle);
        handle = null;
    }
    /** 清除回收桶裡的cluster **/
    awaitRecycle() {
        let { garbageDump } = this;
        if (typeof this.awaitTrashTimes != "undefined") return false;

        this.awaitTrashTimes = setInterval(() => {
            for (var i = 0; i < garbageDump.length; i++) {
                let cluster = garbageDump[i];
                let {connections} = cluster.nodeInfo.connections;
                let recycleExpired = cluster.optConf;
                //到期時間回收
                const expired = (typeof recycleExpired != "undefined" && (Date.now() - cluster.recycleStartDate) > (recycleExpired * 1000));

                if (connections <= 10 || expired) {
                    NSLog.log("warning", "AppDelegate.awaitRecycle(), name:%s", cluster.name);
                    cluster.stop();
                    cluster.stopHeartbeat();
                    garbageDump.splice(i, 1);
                    i--;
                }
            }
        }, 5 * 60 * 1000);

        return true;
    };
    bindingProcessEvent(server) {
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
    /**
     * 取得子程序
     * @param name
     * @return {*}
     */
    getChild(name) {
        return this.clusters[name];
    };
    /**
     * 新增子程序
     * @param child
     */
    addChild(child) {
        const {name} = child;
        if (!this.clusters[name]) {
            this.clusters[name] = [];
            this.roundrobinNum[name] = 0;
        }
        this.clusters[name].push(child);
        const rules = new Set([...name.split(","), ...child.rules]);
        if (this.clusterMap.has(child)) {
            this.rmRuleTable(child, this.clusterMap.get(child));
        }
        for (let namespace of rules.values()) {
            this.ruleTable.set(namespace, child);
        }
        this.clusterMap.set(child, rules);
    };
    /**
     * 移除規則
     * @param child
     * @param rules
     */
    rmRuleTable(child, rules) {
        for (let namespace of rules.values()) {
            this.ruleTable.delete(namespace);
        }
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
    createChild(endpoint, {index, params}) {
        let options = IDelegate.createChildProperties(params);
        let env = JSON.parse(JSON.stringify(process.env)); //環境變數
        env.NODE_CDID = String(index);
        if (options.env) IHandler.setEnvironmentVariables(env, options.env);
        let execArgv = []; // octoProxy pkg versions
        let {file, assign, mxoss, ats, args, rules, tags} = options;
        if (options.pkg != true) {
            execArgv = ["--nouse-idle-notification", `--max-old-space-size=${mxoss}`];
            if (options.gc) execArgv.push('--expose-gc');
            if (options.compact) execArgv.push('--always-compact');
            if (options.inspect) execArgv.push('--inspect');
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

        let cmdLine = (assign) ? [assign].concat(args) : args;

        const child = new daemon(file, cmdLine, daemonOptions);
        child.name = assign;
        child.rules = rules;
        child.mxoss = mxoss;
        child.ats = ats;
        child.optConf = options; //複製程序使用
        child.tags = tags;
        child.init();
        child.emitter.on('warp_handle', (message, handle) => endpoint.duringWarp(message, handle));
        child.emitter.on('onIpcMessage', (message) => endpoint.mgmtSrv.onIpcMessage(message));
        child.emitter.on('status', (message) => NSLog.log('warning', message));
        child.emitter.on('unexpected', (err) => {
            NSLog.log('warning', "unexpected:", err.name);
            endpoint.tgBotTemplate("-1001314121392", "shutdown", [err.name]);
        });
        child.emitter.on('restart', () => endpoint.mgmtSrv.refreshClusterParams(child));
        return child;
    };
    /**
     * clusters attribute
     * + clusters[key][0]
     * //not implement//
     */
    management() {
        NSLog.log('debug', '** Setup management service port:%s **', cfg.managePort);
        const IManager = require('./smanager/IManager.js');
        this.mgmtSrv = IManager.createManager(this);
    };
    reLoadManagement() {
        this.mgmtSrv.close();
        delete require.cache[require.resolve('./smanager/IManager.js')];
        this.management();
    };
    /**
     * create notify Telegram
     * @param opt
     * @param proxy
     * @public
     */
    createTelegramBot(opt, proxy) {
        this.tgBot = TelegramBot.getInstance();
        this.tgBot.setBot(opt.bot, opt.token);
        this.tgBot.setProxy(proxy.host, proxy.port);
    };
    tgBotTemplate(chatID, type, args) {
        if (typeof this.tgBot == "undefined") return false;
        if (type == "shutdown") {
            this.tgBotSend(chatID, util.format("%s ❗️shutdown: reboot by \n<code>%s</code>|<b>%s</b>", hostname, TelegramBot.dateFormat(new Date()), args[0]));
        }
    };
    tgBotSend(chatID, message) {
        if (typeof this.tgBot != "undefined") {
            this.tgBot.sendMessage(chatID, message);
        }
    }
    /**
     * //socket hot reload0
     * @param message
     * @param handle
     * @return {Promise<void>}
     */
    async duringWarp(message, handle) {
        const assign = String(message.goto);
        const event = "wrap_socket";
        let worker = this.asyncAssign(assign)
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
    };
    /**
     * cross 規則
     * @param headers
     * @return {string}
     */
    crossOptions(headers) {
        let corsPolicy = [
            'HTTP/1.1 200 OK',
            'Access-Control-Allow-Origin: *',
            'Access-Control-Allow-Credentials: true',
            'Access-Control-Allow-Method: ' + headers['access-control-request-method'],
            'Access-Control-Allow-Headers: ' + headers['access-control-request-headers']
        ].join("\r\n");
        corsPolicy += '\r\n\r\n';
        return corsPolicy;
    };
    //TLS
    createTLSServer(opt) {
        const options   = {};
        const listenOpt = {};
        if (!opt || !opt.keyFile || !opt.certFile) {
            NSLog.log("error", "Not found cert file.");
            return false;
        }
        listenOpt.host = opt.host || "0.0.0.0";
        listenOpt.port = opt.port || 443;
        options.rejectUnauthorized = opt.rejectUnauthorized || true;
        NSLog.log('info', `Ready to start create tls server ${JSON.stringify(opt)}.`);
        if (opt.keyFile) options.key = fs.readFileSync(opt.keyFile);
        if (opt.certFile) options.cert = fs.readFileSync(opt.certFile);
        const tlsServer = tls.createServer(options, (tlsSocket) => {
            NSLog.log("info", "TLS Inbound %s, %s:%s", tlsSocket.remoteFamily, tlsSocket.remoteAddress, tlsSocket.remotePort);
            tlsSocket.pause();
            const sock = new net.Socket();
            sock.connect(80, "127.0.0.1", () => {
                sock.pipe(tlsSocket);
                tlsSocket.pipe(sock);
                tlsSocket.resume();
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

        tlsServer.listen(listenOpt, () => {
            NSLog.info(`Tls server start listening on ${listenOpt.port} `);
        });
        return tlsServer;
    };
    reboot() {
        this.server.close();
        this.server.onconnection = noop;
        delete this.server;
        this.server = undefined;

        this.server = this.createServer(cfg.srvOptions);
    };
    /** launch */
    countdown(count) {
        return new Promise((resolve) => {
            if (typeof count != "number") count = 10;
            let down = setInterval(() => {
                NSLog.log('info', 'Ready to start create server wait...', count);
                if (--count < 0) {
                    clearInterval(down);
                    resolve();
                }

            }, 1000);
        });
    }
    reject() {

    }
    release() {
    }
}
/**
 * @param {ChildProperties} params;
 * @return {Object}
 */
function createChildProperties(params) {
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
        v8Flags,
        rules,
        tags
    } = params;
    /** @typedef {ChildProperties} */
    let options = {
        file,
        pkg: false,
        ats: false,
        rules: []
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
    } else {
        options.args = [];
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
    if (Array.isArray(rules)) options.rules = rules; //自訂
    options.tags = (typeof tags == "string") ? tags.split(",") : tags;

    return options;
}
IDelegate.createChildProperties = createChildProperties;

module.exports = exports = IDelegate;