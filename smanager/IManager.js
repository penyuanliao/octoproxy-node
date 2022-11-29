"use strict";
const xPath         = require("path");
const net           = require("net");
const util          = require("util");
const fs            = require("fs");
const EventEmitter  = require("events");
const {Server}      = require("../lib/RPCSocket.js");
const Dashboard     = require("../lib/Dashboard.js");
const TelegramBot   = require("../lib/FxTelegramBot.js");
const IHandler      = require("./IHandler.js");
const ClustersInfo  = require("./ClustersInfo.js");
const CoreInfo      = require("./CoreInfo.js");
const IBlockList    = require("./IBlockList.js");
const ReportTool    = require("./ReportTool.js");
const IConfig       = require('../IConfig.js').getInstance();
const {UDPClient}   = require("../lib/UDP.js");
const NSLog         = require('fxNetSocket').logger.getInstance();
const hostname      = require("os").hostname();
const IPFilterPath  = "../configuration/BlockList.json";
const AssignPath    = "../configuration/Assign.json";
const syncAssignFile = true;
// const saveHeapTime   = (10 * 60 * 1000);
/**
 * 管理器
 * @constructor
 */
class IManager extends EventEmitter {
    /**
     * 新版管理層服務
     * @param {*} delegate
     * @param [options]
     */
    constructor(delegate, options) {
        super();
        this.delegate  = delegate;
        this.timer     = undefined;
        /** record visitor remote address **/
        this.dashboard = new Dashboard(Dashboard.loadFile("./historyLog/Dashboard.json"));
        this.nodesInfo = new ClustersInfo(this);
        this.coreInfo  = new CoreInfo(this);
        this.iHandler  = this.setupHandler();
        this.udp       = new UDPClient(this, IConfig.wpc.udp.port);
        this.iHandler.setup({
            IPFilterPath,
            AssignPath,
            syncAssignFile
        });
        /**
         * 白名單跟黑名單
         * @type {IBlockList}
         */
        this.blockIPs = new IBlockList()
            .load(this.readFile(IPFilterPath, {enabled:true, allow:{}, deny:{}}));
        /**
         * influx紀錄Log檔案
         * @type {ReportTool}
         */
        this.reporting = new ReportTool().start();
        this.tgBot     = this.createTelegramBot(IConfig.IManagerConfig.telegram);
        //auto check
        this.autoTimes = 0;
        this.setupServerMode();
        this.setup();
        this.start();
    }
    /** Create new dynamic id in process.send **/
    get tokenId() {
        return this.delegate.getTokenId();
    };
    get blockListEnabled() {
        return this.blockIPs.enabled;
    };
    /**
     * 建立事件監聽
     * @return {IHandler}
     */
    setupHandler() {
        const handler = new IHandler(this);
        handler.on('refresh', () => this.nodesInfo.refresh());
        return handler;
    };
    /**
     * 建立伺服器
     * @param {*} options 參數
     * @param {string} options.host 監聽位址
     * @param {number} options.port 埠
     * @param {boolean} options.web 支援http
     * @param {boolean} options.listen 開啟監聽埠
     */
    createTCPServer(options) {
        if (!options) options = {
            host: "0.0.0.0",
            port: 8100,
            // 提供HTTP Server
            web: true,
            // 是否聆聽port服務
            listen: false
        }
        const server = new Server(this, options);
        server.on("completed", () => {
            NSLog.log('debug', 'Create a new tcp server on completed.');
        });
        server.expose("targetEvent", this.iHandler.targetEvent, this.iHandler);

        return server;
    };
    /**
     * 設定連線服務模式
     * @default 預設被動等控制端服務管理中心連入
     */
    setupServerMode() {
        let { server } = IConfig.IManagerConfig;
        if (server.passive.enabled) {
            let options = JSON.parse(JSON.stringify(server.passive));
            this.server = this.createTCPServer(options);
        }
        if (server.active.enabled) {
            let options = JSON.parse(JSON.stringify(server.active));
            this.createConnect(options);
        }
    };
    /**
     * [主動]尋找控制端服務管理中心
     * @param options
     */
    createConnect(options) {
        let active = new net.Socket();
        const nServer = this.server.getNativeServer();
        active.once("connect", () => {
            active.pause();
            // let socket = new net.Socket(active);
            // socket.sever = nServer;
            nServer.emit("connection", active);
            // socket.emit("connect");
            active.resume();
        });
        active.on("close", () => {
            NSLog.log("info", 'Active connect has close.');
            setTimeout(this.createConnect.bind(this), 5000, options);
        });
        active.on("error", (err) => NSLog.error("error:", err));
        active.connect(options.port, options.host);
    };
    /**
     * 設定Cluster
     * @param rule
     * @param cluster
     * @return {boolean|*}
     */
    setCluster(rule, cluster) {
        const proxy = this.delegate;
        if (!proxy) return false;
        proxy.addChild(cluster);
        return proxy.clusters[rule];
    };
    /**
     * 更換cluster process
     * @param assign
     * @param index
     * @param cluster
     * @return {boolean}
     */
    changeCluster({assign, index, cluster}) {
        const proxy = this.delegate;
        if (!proxy) return false;
        if (Array.isArray(proxy.clusters[assign]) == false) {
            proxy.clusters[assign] = [];
            proxy.roundrobinNum[assign] = 0;
        }
        if (cluster) {
            proxy.clusters[assign][index] = cluster;
        }
        return true;
    };
    /**
     * 取得子服務
     * @param name
     * @return {[]|*|boolean}
     */
    getClusters(name) {
        const {delegate} = this;
        if (!delegate) return false;
        if (name) {
            return delegate.clusters[name];
        } else {
            return delegate.clusters;
        }
    };
    /**
     * 移除子服務
     * @param name
     * @return {boolean}
     */
    rmCluster(name) {
        const proxy = this.delegate;
        if (!proxy) return false;
        if (name) {
            delete proxy.clusters[name];
            return true;
        } else {
            return false;
        }
    };
    /**
     * 找尋子服務
     * @param pid
     * @param name
     * @return {boolean|*}
     */
    findCluster(pid, name) {
        const clusters = this.getClusters();
        if (!clusters) return false;

        if (typeof name == "string") {
            let group = clusters[name];
            for (let cluster of group) {
                if (cluster.pid == pid) return cluster;
            }
        } else {

            let groupKeys = Object.keys(clusters);
            for (let key of groupKeys) {
                let group = clusters[key];
                for (let cluster of group) {
                    if (cluster.pid == pid) return cluster;
                }
            }
        }
        return false;
    };
    /**
     * 回收子程序
     * @param pid
     * @param name
     * @return {boolean}
     */
    freeCluster({pid, name}) {
        let result = {
            result: false,
            pid
        };
        if (typeof pid == "number") {
            const cluster = this.findCluster(pid, name);
            if (cluster) {
                name = (name) ? name : cluster.name;
                cluster.stop();
                cluster.stopHeartbeat();
                cluster.isRelease = true;
                let group = this.getClusters(name);
                group.indexOf(group.indexOf(cluster), 1);
                if (group.length == 0) this.rmCluster(name);
                result.result = true;
                result.name = name;
            }
        }
        return result;
    };
    /**
     * 主服務關閉所有使用者進入
     * @param bool
     * @return {boolean}
     */
    setAllowEntry(bool) {
        const proxy = this.delegate;
        if (!proxy) return false;
        proxy.lockState = bool;
        return true;
    };
    /**
     * 回收子服務清單
     * @return {boolean|[]|*[]}
     */
    getGarbageDump() {
        const proxy = this.delegate;
        if (!proxy) return false;
        return proxy.garbageDump || [];
    };
    /**
     * 取得負載平衡子服務
     * @return {boolean|*}
     */
    getBalancerCluster() {
        const proxy = this.delegate;
        if (!proxy) return false;
        return proxy.gameLBSrv.getCluster;
    };
    /**
     * 取得負載平衡物件
     * @return {boolean|gameLBSrv|*}
     */
    getBalancer() {
        const proxy = this.delegate;
        if (!proxy) return false;
        return proxy.gameLBSrv;
    };
    /**
     * 取得主服務鎖定狀態
     * @return {*}
     */
    getLockState() {
        return this.delegate.lockState;
    }
    /**
     * 取得cpu狀態
     * @param pid
     * @return {*|number}
     */
    getCPU(pid) {
        return this.coreInfo.cpu(pid);
    };
    /**
     * 初始化
     */
    setup() {};
    /**
     * 開始心跳
     */
    start() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => this.loops(), 5000);

    };
    /**
     * 輪詢檢查服務
     */
    async loops() {
        let info = await this.nodesInfo.refresh();
        this.reporting.submit(info);
        if (++this.autoTimes >= 60) {
            this.autoTimes = 0; //重置
            this.automaticCheckCluster();
        }
        this.cpuCheck();
    };
    /**
     * 紀錄各個服務CPU使用率
     */
    cpuCheck() {
        if (this.coreInfo.checkServices(this.nodesInfo.pids)) {
            this.coreInfo.getPID(this.nodesInfo.info);
        }
    };
    /**
     * 送出IPC Event
     * @param cluster
     * @param params
     * @param callback
     */
    sendIPCMessage(cluster, params, callback) {
        if (typeof this.ipcToken != "number") this.ipcToken = 0;
        if (!this.callbackFunc) this.callbackFunc = {};
        let data = {
            evt: 'ipcMessage',
            id: "/" + this.ipcToken++,
            data: params
        }
        // console.log(`sendIPCMessage`);
        cluster.send(data);
        this.callbackFunc[data.id] = {
            cb: callback,
            ts: setTimeout(() => {
                if (callback) callback(false)
                this.callbackFunc[data.id] = null;
                delete this.callbackFunc[data.id];
            }, 10000)
        };
    };
    /**
     * 接收ipc event
     * @param message
     */
    onIpcMessage(message) {
        // console.log(`onIpcMessage`, message);
        if (!this.callbackFunc) this.callbackFunc = {};
        if (typeof this.callbackFunc[message.id] != "undefined") {
            const cb = this.callbackFunc[message.id].cb;
            clearTimeout(this.callbackFunc[message.id].ts);
            this.callbackFunc[message.id] = null;
            if (cb) cb(true);
        }
    };
    /**
     * 修改程序參數
     * @param cluster
     * @return {boolean}
     */
    refreshClusterParams(cluster) {
        if (typeof cluster == "undefined") return false;
        const index = cluster._options.env.NODE_CDID;
        const conf  = this.iHandler.getAssign();
        const params = conf.cluster[index];
        if (params && params.assign == cluster.name && params.reload == true) {
            if (params.env) IHandler.setEnvironmentVariables(cluster._options.env, params.env);
            if (params.file != cluster._modulePath) cluster._modulePath = params.file;
            if (typeof params.ats == "boolean" && params.ats != cluster.ats) cluster.ats = params.ats;
            if (typeof params["recycleExpired"] == "number" && params["recycleExpired"] != cluster.optConf["recycleExpired"]) {
                cluster.optConf["recycleExpired"] = params["recycleExpired"];
            }
            delete params.reload;
            this.iHandler.saveAssign.apply(this, [conf]);
            NSLog.log("debug", "%s %s configure refresh", params.file, params.assign);
        }
    };
    /**
     * 清除回收桶裡的cluster
     */
    awaitRecycle() {
        if (this.delegate) {
            this.delegate.awaitRecycle();
        }
    };
    /**
     * 自動檢查機制 start auto remove mem
     * @return {Boolean}
     */
    automaticCheckCluster() {
        const clusters = this.getClusters();
        let arr_assign = Object.keys(clusters);
        let res = false;
        for (let i = 0; i < arr_assign.length; i++) {
            let assign = arr_assign[i];
            res = this.outOfRangeMemLimit(assign);
        }
        return res;
    };
    /**
     * 檢查記憶體是否超出限制(ats=true)
     * @param assign
     * @return {boolean}
     */
    outOfRangeMemLimit(assign) {
        const group = this.getClusters(assign);
        if (!group) return false;

        for (let i = 0; i < group.length; i++) {
            let cluster = group[i];
            if (cluster.ats != true) continue;
            if (typeof cluster.nodeInfo != 'undefined' && typeof cluster.nodeInfo.memoryUsage != "undefined") {
                let memory = cluster.nodeInfo.memoryUsage["rss"];
                let memory_m = (memory / 1024 / 1024).toFixed(2);
                let maxMemory = (cluster.mxoss * 0.9);
                let bool = (memory_m > maxMemory);
                if (typeof cluster.score != "number") cluster.score = 0;
                if (bool) { //預留10%緩衝
                    NSLog.log("info", `OutOfMemory => usage:${memory_m}(${maxMemory}) tun:${(bool ? "on": "off")} score: ${cluster.score}`);
                    if (cluster.score++ > 2) {
                        cluster.score = 0;
                        return (this.cloneCluster({assign, pid: cluster.pid}) != false);
                    }
                } else {
                    cluster.score = 0;
                }
            }
        }
        return false;
    };
    /**
     * 複製一個一樣程序然後另個等待回收
     * @param {string} assign 服務程序名稱
     * @param {number} pid 服務程序PID
     * @return {boolean|| number}
     */
    async cloneCluster({assign, pid}) {
        const manager = this;
        const group = manager.getClusters(assign);
        if (!group) {
            return false;
        }
        NSLog.info(`[cloneCluster]Create new process pid:${pid} assign:${assign}`);

        let index = 0;
        let cluster = group[0];
        for (let i = 0; i < group.length; i++) {
            if (group[i].pid == pid) {
                index = i;
                cluster = group[i];
                break;
            }
        }

        if (!cluster) return false;
        let mxoss = cluster.mxoss;
        let file  = cluster._modulePath;
        let options = Object.assign({}, cluster.optConf);
        options.clone = true;
        let res = await this.iHandler.addClusterAsync({
            file,
            assign,
            mxoss,
            options:options
        });
        let trash = group.splice(index, 1)[0];
        trash.recycleStartDate = new Date().getTime();
        let garbageDump = manager.getGarbageDump();
        garbageDump.push(trash);
        NSLog.warning(`[cloneCluster]Waiting to clear for assign => ${assign} 
                   trash.pid: ${trash.pid},
                   current: ${group.length} 
                   garbageDump: ${garbageDump.length}`);
        manager.awaitRecycle();
        return res.pid;
    };
    /** 阻擋異常address **/
    checkedIPDeny(address) {
        //是否開啟
        if (!this.blockListEnabled) return true;
        if (typeof address != "string") return false;
        return this.blockIPs.check(address);
    };
    /**
     * UDP 接管服務
     * @param name
     * @param host
     * @param port
     * @param remoteInfo
     * @return {Promise<void>}
     */
    async handoffService({name, host, port}, remoteInfo) {
        const clusters = this.getClusters();
        let keys = Object.keys(clusters);
        keys = keys.filter((element) => {
            return (element.indexOf(name) != -1);
        });
        for (let name of keys) {
            let clusterGroup = clusters[name];
            if (!Array.isArray(clusterGroup)) continue;
            for (let cluster of clusterGroup) {
                cluster.restart();
                if (this.udp) {
                    this.udp.record(util.format("restart %s %s %s", hostname, name, new Date().toDateString()), remoteInfo);
                }
                cluster.send({'evt':'ipcMessage', params: { action: "handoff", host, port }});
                await this.waiting(1000);
            }
        }
    };
    /**
     * 延遲等待事件
     * @param millisecond
     * @return {Promise<unknown>}
     */
    async waiting(millisecond) {
        return new Promise(function (resolve) {
            setTimeout(function () {
                resolve();
            }, millisecond || 500);
        })
    };
    /**
     * 讀取檔案
     * @param namepath
     * @param defObj
     * @return {any}
     */
    readFile(namepath, defObj) {
        var data;
        try {
            data = fs.readFileSync(namepath);
            return eval("("+data+")");
        } catch (e) {
            NSLog.log("error", "Loading conf path '%s' not found.", namepath);
            data = defObj;
            this.writeFile(namepath, data);
            return data;
        }
    };
    /**
     * 寫入檔案
     * @param namepath
     * @param data
     */
    writeFile(namepath, data) {
        return fs.writeFileSync(namepath, JSON.stringify(data, null, "\t"));
    };
    /**
     * 關閉管理端server
     */
    close() {
        this.server.close(() => {
            NSLog.log("warning", "STOP Bound Port '%s'", this.server.address());
        });
    };
    /** http規則 */
    getSignature(appID) {
        if (typeof appID == "string" && appID != "") {
            return (appID === IConfig.IManagerConfig.SIGNATURE);
        } else {
            return false;
        }
    };

    /**
     * 取得路徑
     * @param pathname
     * @return {string}
     */
    getPath(pathname) {
        return xPath.resolve(process.cwd(), pathname);
    };
    /**
     * 建立通知系統
     * @param {string} bot
     * @param {string} token
     * @param {boolean} enabled 啟用
     * @param {object} proxyMode
     * @param {string} proxyMode.host
     * @param {number} proxyMode.port
     * @param {boolean} proxyMode.enabled
     * @return {FxTelegramBot.instance}
     */
    createTelegramBot({bot, token, enabled, proxyMode}) {
        let tgBot = new TelegramBot(bot, token);
        tgBot.enabled = (typeof enabled != "boolean") ? false : enabled;
        if (proxyMode.enabled) {
            tgBot.setProxy(proxyMode.host, proxyMode.port);
        }
        return tgBot;
    }
    /**
     * 清除
     */
    clean() {

    };
    /**
     * 回收
     */
    release() {

    };
    /**
     * 建立Socket控制端服務
     * @param {*} delegate
     * @return {IManager}
     */
    static createManager (delegate) {
        const manager = new IManager(delegate);
        manager.nodesInfo.on('refresh', () => {
            // console.log('refresh', element);
        });
        // this.manager.coreInfo.start(); //開始系統資訊
        return manager;
    };
}
module.exports = exports = IManager;