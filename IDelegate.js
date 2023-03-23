"use strict";
const version       = Number(process.versions.node.split(".")[0]);
const util          = require('util');
const events        = require("events");
const fxNetSocket   = require('fxNetSocket');
const parser        = fxNetSocket.parser;
const pheaders      = parser.headers;
const utilities     = fxNetSocket.utilities;
const daemon        = fxNetSocket.daemon;
// const client        = fxNetSocket.wsClient;
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
const iConfig       = require('./IConfig.js').getInstance();
const GLBSrv        = require('./lib/gameLBSrv.js');
const Dashboard     = require("./lib/Dashboard.js");
const TelegramBot   = require("./lib/FxTelegramBot.js");
const hostname      = require('os').hostname();
const IHandler      = require('./smanager/IHandler.js');

NSLog.configure({
    logFileEnabled: true,
    consoleEnabled: true,
    level: iConfig.level,
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath: xPath.join(process.cwd(), "./historyLog"),
    id:"octoproxy",
    remoteEnabled: false,
    /*console:console,*/
    trackBehaviorEnabled: false, // toDB server [not implement]
    trackOptions:{db:"couchbase://127.0.0.1", bucket:"nodeHistory"},
    fileDateHide: true,
    fileMaxCount: 0,
    fileSort: "asc",
    maximumFileSize: 1024 * 1024 * 500
});

/** remove a socket was pending timeout. **/
const closeWaitTime = 5000;
/** done accept socket was pending timeout **/
const sendWaitClose = 5000;
/** clients request flashPolicy source response data **/
const policy = '<?xml version=\"1.0\"?>\n<cross-domain-policy>\n<allow-access-from domain=\"*\" to-ports=\"80,443\"/>\n</cross-domain-policy>\n';
/** tracking socket close **/
const TRACE_SOCKET_IO = true;
/** tcp connection the maximum segment size **/
// const TCP_MTU = 2048;

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
 * @property serialNumber
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
        //recycle time
        this.awaitTrashTimes = undefined;
        //伺服器
        this.server          = undefined;
        //服務序列號
        this.serialNumber    = 0;
        //服務
        this.clusters        = {};
        //服務HashMap
        this.clusterMap      = new WeakMap();
        //規則轉導清單
        this.ruleTable       = new Map();
        //等待回收清單
        this.garbageDump     = []; //回收記憶體太大的
        /** [roundrobin] Client go to sub-service index **/
        this.roundrobinNum   = [];
        /** The lockdown not allows user to connect service **/
        this._lockdown       = false;
        /** casino load balance **/
        this.gameLBSrv       = new GLBSrv(iConfig.gamSLB, this);
        //管理端
        this.opManager       = undefined;
        //連線紀錄
        this.recordEnabled   = true;
        //LB Request 編號
        this.tokenId         = 0;
        this.init();
    };
    get dashboard() {
        return this.opManager.dashboard;
    }
    init() {

        const {enabled, rtmpFrontendEnabled, httpEnabled} = iConfig.gamSLB;
        NSLog.info(`** Initialize octoproxy.js **
    Game server Setup ->
     [1]Lockdown: ${this._lockdown}
     [2]Support RTMP/TCP Enabled: ${rtmpFrontendEnabled}
     [3]Support HTTP Enabled: ${httpEnabled}
     [4]Support Load Balance Enabled: ${enabled}
        `);

        utilities.autoReleaseGC(); //** 手動 1 sec gc
        if (enabled) {
            // Initial start up on Game Server Load Balance.
            this.gameLBSrv.init_daemon();
        }

        // 1. setup child process fork
        this.setupCluster(iConfig.forkOptions).then(() => {}).catch((reason => NSLog.error(`setupCluster() Error:${reason}`)));
        // 2. create listen 80 port server
        this.start().then(() => {}).catch((reason => NSLog.error(`start() Error:${reason}`)));

        this.bindingProcessEvent();

        this.management();
    };
    async start() {
        let { srvOptions, tlsOptions, env } = iConfig;
        NSLog.log('info', `Ready to start create net server ${JSON.stringify(srvOptions)}.`);
        if (env !== "development") {
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
    async setupCluster(opt) {
        if (typeof opt === 'undefined') {
            opt = { 'cluster': [] };
        }
        const taskSync = iConfig.taskSync || false;
        const num = Number(opt.cluster.length);
        if (num != 0) {
            let child;
            let params;
            for (var index = 0; index < num; index++) {
                params = opt.cluster[index];
                child = this.createChild(this, {index, params, taskSync});
                if (taskSync) {
                    await child.start();
                }
                this.addChild(child);
            }
            NSLog.log('info',"Cluster active number:", num);
            this.serialNumber = num;
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
                tcp_handle.close(() => this.close_callback(tcp_handle));
                return null;
            }

            err = tcp_handle.listen(opt.backlog);

            if (err) {
                NSLog.log('error', util._exceptionWithHostPort(err, 'listen', opt.host, opt.port));

                tcp_handle.close(() => this.close_callback(tcp_handle));
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
                handle.close();
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
        if (typeof headers["x-forwarded-for"] != "undefined") getSockInfos.xff = Dashboard.parseForwarded(headers["x-forwarded-for"]);
        else handle.getSockInfos.xff = null;
        const host = (typeof getSockInfos.xff == "string") ? getSockInfos.xff : getSockInfos.address;
        if (this.opManager.checkedIPDeny(host)) {
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
            const {heartbeat_namespace} = iConfig;
            this.tcp_write(handle, this.createBody({namespace: heartbeat_namespace, mode: 'http', status: 401}));
            this.rejectClientException(handle, "CON_DONT_CONNECT");
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
                let str = args[i].toString().replace(/([?&])+/g,"");
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
        const { httpEnabled } = iConfig.gamSLB;
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
        let {rtmpFrontendEnabled} = iConfig.gamSLB;
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
            NSLog.debug(`gateway_http tokencode ${tokencode} => ${url_args}`);
        } else {
            namespace = this.gameLBSrv.urlParse({
                path: params.f5,
                host: params.host,
                vPrefix: iConfig.gamSLB.vPrefix,
                specificBase: iConfig.specificBase
            });
            this.clusterEndpoint({namespace, source, originPath, mode}, handle).then(() => {});
        }
        return true;
    };
    gateway_general({params, url_args, namespace, source, originPath, mode, host}, handle) {
        const { specificBase, gamSLB } = iConfig;
        const { assign, enabled, videoEnabled, vPrefix } = gamSLB;
        const chk_assign = (assign == namespace);
        if (enabled && chk_assign || (videoEnabled && typeof url_args != "undefined" && typeof url_args.stream != "undefined")) {
            let lbTimes;
            let kickOut = false;
            let tokencode = this.gameLBSrv.getLoadBalancePath(url_args, params, (action, json) => {
                NSLog.log('trace','--------------------------');
                NSLog.info(`tokencode: ${tokencode} action:${action}:${(typeof url_args == "object") ? JSON.stringify(url_args) : url_args} => received: ${JSON.stringify(json)}`);
                NSLog.log('trace','--------------------------');
                let src;
                if (kickOut) { return false; }
                if (json.action == this.gameLBSrv.LBActionEvent.ON_GET_PATH) {
                    if (typeof lbTimes != 'undefined') clearTimeout(lbTimes);
                    lbTimes = undefined;
                    if (typeof json.path == "undefined") json.path = "";
                    namespace = json.path.toString();
                    var src_string;
                    if (mode == "socket" || mode === "flashsocket") {
                        src_string = source.toString();
                    } else {
                        src_string = source.toString().replace(originPath, namespace);
                    }

                    if (typeof handle.getSockInfos != "undefined" && handle.getSockInfos != null && namespace != null && typeof namespace != "undefined") {
                        handle.getSockInfos.lbPath = namespace;
                    }
                    src = (videoEnabled) ? source : Buffer.from(src_string);

                    this.clusterEndpoint({namespace, source:src, originPath, mode}, handle).then(() => {});

                } else if (json.action == this.gameLBSrv.LBActionEvent.ON_BUSY) {
                    if (typeof lbTimes != 'undefined') clearTimeout(lbTimes);
                    lbTimes = undefined;
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
    /**
     * reload request rtmp/tcp
     * @param {*} handle
     * @param buffer
     * @return {MediaClientBinder}
     */
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
            let worker = await this.asyncAssign({ dir: dir }).catch((reason) => {
                NSLog.error('rtmp async assign failed:', reason);
            });
            if (typeof worker === 'undefined' || !worker) {
                this.rejectClientException(handle, "CON_MOD_NOT_FOUND");
                mc.socket.destroy();
                return;
            }
            let rtmp_data = (Buffer.isBuffer(packet[0]) ? Buffer.concat(packet) : Buffer.alloc(0));
            worker.send({evt:'c_init', data: rtmp_data, namespace: dir, originPath: dir, mode: "rtmp"}, handle, {keepOpen:false});

            setTimeout(() => {
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
     * @param {Object} options
     * @param cb callback
     * @returns {undefined}
     */
    assign(namespace, options, cb) {
        const args = arguments[0];
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
            namespace = args.dir;
        }

        let {name, pool} = this.getPool(namespace, subname);

        if (!pool || typeof pool == 'undefined') {
            // console.error('Error not found Cluster server');
            NSLog.log('error','leastconn not found Cluster server');
            if (cb) cb(undefined);
            return;
        }
        let {balance} = iConfig;
        let child;
        // url_param
        if (balance === "url_param") {

        } else if (balance === "roundrobin") {
            this.roundrobin({name, pool}, cb);
        } else if (balance === "leastconn") { //Each server with the lowest number of connections
            this.leastconn({name, pool}, cb);
        } else
        {
            // console.error('Error not found Cluster server');
            NSLog.log('error','Not found Cluster server');
            if (cb) cb(undefined);
        }
    };
    /**
     * 取得服務的cluster pool
     * @param namespace
     * @param subname
     * @return {{name: (*), pool: *}}
     */
    getPool(namespace, subname) {
        let name = namespace;
        let pool = this.getChild(name);
        if ((typeof pool == "undefined") && subname) {
            name = subname;
            pool = this.getChild(name);
        }
        if (typeof pool == "undefined") {
            name = this.findAssignRules({namespace, subname});
            pool = this.getChild(name);
        }
        return {name, pool};
    };
    /**
     * Async Syntax Assign
     * @param namespace
     * @param options
     * @return {Promise}
     */
    asyncAssign(namespace, options) {
        return new Promise((resolve, reject) => {
            try {
                this.assign(namespace, options, resolve);
            } catch (e) {
                reject(e);
            }
        });
    };
    /**
     * 異常連線排除
     * @param namespace
     * @param source
     * @param originPath
     * @param mode
     * @param handle
     */
    exceptionBreaker({namespace, source, originPath, mode}, handle) {
        const { route } = iConfig.breaker;
        let worker = this.clusters[route];
        if (typeof worker == 'undefined'  || !worker || !Array.isArray(worker)) return false;

        NSLog.log("warning", `Exception Breaker -> `, namespace);
        let match = 0;
        if (Array.isArray(worker) && worker.length >= 1) {
            worker[match].send({
                evt: 'c_init',
                data: source,
                namespace,
                originPath,
                mode
            }, handle, { keepOpen:false });
        }
        setTimeout(() => {
            this.rejectClientException(handle, "CON_VERIFIED");
            handle.close(this.close_callback.bind(handle, this));
            this.handleRelease(handle);
            handle = null;
        }, sendWaitClose);

        return true;

    };
    /**
     * 尋找線程
     * @param {string} namespace 識別碼
     * @param {string} subname 調整識別碼
     * @return {undefined|*}
     */
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
     * @param {string} name
     * @param {Array} pool
     * @param {Function} cb
     */
    roundrobin({name, pool}, cb) {
        const {activate} = daemon.ActivateState();
        let cluster;
        let start = this.roundrobinNum[name];
        do {
            if (start >= pool.length) start = 0;
            if (start == this.roundrobinNum[name]) {
                cluster = undefined;
                break;
            }
            cluster = pool[start++];
        } while (cluster.creationComplete != activate);

        this.roundrobinNum[name] = start;

        if (cb) cb(cluster);
        cb = null;
        return cluster;
    };
    /**
     * 最少連線排程法
     * @param {string} name
     * @param {Array} pool
     * @param {Function} cb
     * @return {*}
     */
    leastconn({name, pool}, cb) {
        const {activate} = daemon.ActivateState();
        let num = pool.length;
        let current = pool[0];
        for (let n = 1; n < num; n++) {
            //檢查最小連線數
            let {creationComplete} = pool[n];
            let { connections } = pool[n].nodeInfo;
            let isPriority = (current.nodeInfo.connections > connections) && (creationComplete == activate);
            if (isPriority) current = pool[n];
        }
        if (cb) cb(current);
        return current
    };

    /**
     *
     * @param headers
     * @param method
     * @param mode
     * @param source
     * @param handle
     * @return {boolean}
     */
    onManager({headers, method, mode, source}, handle) {
        let corsMode = false;
        let appid = false;
        const swp = headers["sec-websocket-protocol"];
        const {getSignature} = this.opManager;

        if (mode == 'http' && method === 'OPTIONS' &&
            (headers['sec-fetch-mode'] == iConfig.crossPolicy.secFetchMode ||
                iConfig.crossPolicy.requestMethod.has(headers['access-control-request-method']))) {
            corsMode = (headers["access-control-request-headers"].indexOf('appid') != -1);
        } else {
            appid = ((getSignature instanceof Function) && getSignature(headers["appid"]));
        }
        let web = this.isManagerWebRoute(headers.general[1]);
        if (web) mode = 'web';
        if (swp == "admin" || swp == "log" || corsMode || appid || web) {
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
                    this.admin_free({handle, name, exception, mode, skip: true});
                });
            }
            let socket_timer = setTimeout(() =>
                this.admin_free({handle, name, exception, mode, skip: true}), sendWaitClose);
            return true;
        }
        return false;
    };
    /**
     * 管理端網頁資料
     * @param uri
     * @return {boolean}
     */
    isManagerWebRoute(uri) {
        const { webManagePrefix } = iConfig;
        let args = xPath.parse(uri);
        return args.dir.split('/').indexOf(webManagePrefix) != -1;
    }
    /**
     * 回傳響應事件
     * @param namespace
     * @param mode
     * @param status
     * @return {string|boolean}
     */
    createBody({namespace, mode, status}) {
        const {heartbeat_namespace} = iConfig;
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
    /**
     * close complete
     * @param arg
     * @param {boolean} skip skip record count
     */
    close_callback(arg, skip) {
        let handle, endpoint;
        if (arguments[0] instanceof IDelegate) {
            endpoint = arguments[0];
            handle = this;
        } else {
            endpoint = this;
            handle = arguments[0];
        }
        if (handle && handle.getSockInfos) {
            const { recordEnabled, _lockdown, dashboard } = endpoint;
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
            if (recordEnabled && !_lockdown && skip != true) dashboard.record(getSockInfos);

            if (TRACE_SOCKET_IO) {
                let ts = endpoint.dateFormat();
                let lb = (lbPath ? lbPath : 'null');
                if (mode != 'web') {
                    NSLog.log(status, `{"msg":"${message}", "ts": "${ts}", "src":"${address}", "xff":"${xff}" , "mode":"${mode}", "path":"${path}", "lb":${lb}}`);
                }
                endpoint.clearGetSockInfos(handle);
            }

        } else {
            NSLog.log('info', 'callback handle has close.');
        }
        handle = null;
        endpoint = null;
    };
    /**
     * clear log info
     * @param handle
     */
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
    /**
     * 記錄錯誤類型
     * @param handle
     * @param name
     */
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
    /**
     * 釋放物件跟紀錄
     * @param handle
     * @param name
     * @param exception
     * @param mode
     * @param skip
     */
    admin_free({handle, name, exception, mode, skip}) {
        handle.getSockInfos.path = name;
        handle.getSockInfos.mode = mode;
        this.rejectClientException(handle, exception);
        handle.close(this.close_callback.bind(handle, this, skip));
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
    bindingProcessEvent() {
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
        process.on('message', (data, handle) => {
            if (typeof data === 'string') {}
            else if (typeof data === 'object') {
                this.processMessage(data, handle);
            }
        });
    };
    processMessage({evt}, handle) {
        if (evt == "processInfo") {
            process.send({
                evt,
                data : {
                    memoryUsage: process.memoryUsage(),
                    connections: 0
                }
            });
        } else if (evt === 'c_init') {
            const { server } = this;
            let socket = new net.Socket({
                handle:handle,
                allowHalfOpen:server.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = (mode === 'http' ? null : server);
            server.emit("connection", socket);
            socket.emit("connect");
            socket.relatedData = Buffer.from(data.data);
            socket.emit('data', socket.relatedData);
            socket.resume();
        } else {
            NSLog.warning(`Out of hand. dismiss message: ${evt}`);
        }
    }
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
     * @param {Object} endpoint 物件
     * @param {Number} index 編號
     * @param {Object} params 參數
     * @param {boolean} taskSync 列隊執行
     * @return {daemon}
     */
    createChild(endpoint, {index, params, taskSync}) {
        let options = IDelegate.createChildProperties(params);
        let env = JSON.parse(JSON.stringify(process.env)); //環境變數
        env.NODE_CDID = String(index);
        if (options.env) IHandler.setEnvironmentVariables(env, options.env);
        let execArgv = []; // octoProxy pkg versions
        let {file, assign, mxoss, ats, args, rules, tags, cmd, assign2syntax, stdio} = options;
        let nodeParameters = ['--nouse-idle-notification', `--max-old-space-size=${mxoss}`];
        if (options.gc) nodeParameters.push('--expose-gc');
        if (options.compact) nodeParameters.push('--always-compact');
        if (options.inspect) nodeParameters.push('--inspect');
        if (typeof options.v8Flags != "undefined") {
            let flags = options.v8Flags;
            if (Array.isArray(flags)) {
                flags = flags.filter((value) => {
                    return (typeof value != "undefined" && value != "" && value != null);
                });
                nodeParameters = execArgv.concat(flags);
            } else if (typeof flags == "string") {
                nodeParameters.push(flags);
            }
        }

        if (options.pkg != true) {
            execArgv = nodeParameters;
        } else {
            execArgv = [`--options ${nodeParameters.join(",")}`];
        }
        let daemonOptions = {
            env,
            silent: false,
            execArgv,
            //心跳系統
            lookoutEnabled: options.lookout,
            heartbeatEnabled: options.heartbeat,
            maxAttempts: options.maxAttempts,
            heartbeatTimeout: options.heartbeatTimeout,
            pkgFile: options.pkg,
            cmd,
            assign2syntax,
            stdio
        };

        let cmdLine = (assign2syntax) ? [assign].concat(args) : args;

        const child = new daemon(file, cmdLine, daemonOptions);
        child.name = assign;
        child.rules = rules;
        child.mxoss = mxoss;
        child.ats = ats;
        child.optConf = options; //複製程序使用
        child.tags = tags;
        child.emitter.on('warp_handle', async (message, handle) => {
            let result = await endpoint.duringWarp(message, handle);
            const { evt, id } = message;
            child.postMessage({ evt, id, data: result });
        });
        child.emitter.on('onIpcMessage', (message) => endpoint.opManager.onIpcMessage(message));
        child.emitter.on('status', (message) => NSLog.log('warning', message));
        child.emitter.on('unexpected', (err) => {
            NSLog.log('warning', "unexpected:", err.name);
            endpoint.tgBotTemplate(iConfig.IManagerConfig.telegram.chats.sys, "shutdown", [err.name]);
        });
        child.emitter.on('restart', () => endpoint.opManager.refreshClusterParams(child));

        if (!taskSync) child.init();

        return child;
    };
    /**
     * clusters attribute
     * + clusters[key][0]
     * //not implement//
     */
    management() {
        NSLog.log('debug', '** Setup management service port:%s **', iConfig.managePort);
        const IManager = require('./smanager/IManager.js');
        this.opManager = IManager.createManager(this);
    };
    reLoadManagement() {
        this.opManager.close();
        delete require.cache[require.resolve('./smanager/IManager.js')];
        this.management();
    };
    tgBotTemplate(chatID, type, args) {
        let {tgBot} = this.opManager;
        if (typeof tgBot == "undefined") return false;
        if (type == "shutdown") {
            tgBot.sendMessage(chatID, util.format("%s ❗️shutdown: reboot by \n<code>%s</code>|<b>%s</b>", hostname, TelegramBot.dateFormat(new Date()), args[0]));
        }
    };
    /**
     * //socket hot reload0
     * @param message
     * @param handle
     * @return {Promise<void>}
     */
    async duringWarp({raw, metadata, originPath, goto, mode}, handle) {
        const namespace = String(goto);
        const evt = "wrap_socket";
        let worker = await this.asyncAssign(namespace)
        if (typeof worker === 'undefined' || !worker) {
            handle = null;
            return {result: false, error: 'assign not found.'};
        }
        worker.send({
            evt,
            mode,
            raw,
            metadata,
            namespace,
            originPath
        }, handle, {keepOpen: false});
        return {result: true};
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
    /**
     * 重啟服務
     * @param {boolean}tls 重啟tls server
     */
    reboot(tls) {
        let { srvOptions, tlsOptions } = iConfig;
        if (tls) {
            this.tlsServer.close();
            if (tlsOptions && tlsOptions.enabled) {
                this.tlsServer = this.createTLSServer(tlsOptions);
            }
        } else {
            this.server.close();
            this.server.onconnection = noop;
            this.server = this.createServer(srvOptions);
        }
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
    /**
     * @param {ChildProperties} params;
     * @return {Object}
     */
    static createChildProperties(params) {
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
            tags,
            stdoutFile,
            stderrFile,
            version,
            assign2syntax,
            stdio,
            maxAttempts,
            heartbeatTimeout
        } = params;
        /** @typedef {ChildProperties} */
        let options = {
            file,
            pkg: false,
            ats: false,
            rules: [],
            stdoutFile,
            stderrFile,
            assign2syntax
        };
        if (assign) {
            options.assign = utilities.trimAny(assign);
        } else {
            options.assign = 'empty';
        }
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
        if (typeof heartbeatTimeout == "number") {
            options.heartbeatTimeout = heartbeatTimeout;
        }
        if (typeof maxAttempts == "number") {
            options.maxAttempts = maxAttempts;
        }

        if (typeof pkg == "boolean") options.pkg = pkg;
        if (!options.pkg && file.indexOf(".js") == -1 && file.indexOf(".mjs") == -1 && !cmd) {
            options.pkg = true;
        }

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
        //自訂
        if (Array.isArray(rules)) {
            options.rules = rules
        } else if (typeof rules == "string") {
            options.rules = utilities.trimAny(rules).split(",");
        }
        if (Array.isArray(options.rules) && options.rules.length > 0) {
            options.version = 2;
            options.assign2syntax = false;
        }

        options.tags = (typeof tags == "string") ? tags.split(",") : tags;
        if (typeof version != "number") options.version = 1;
        if (typeof assign2syntax != "boolean") options.assign2syntax = true;
        else options.assign2syntax = assign2syntax;
        if (Array.isArray(stdio)) options.stdio = stdio;
        return options;
    };
}

module.exports = exports = IDelegate;