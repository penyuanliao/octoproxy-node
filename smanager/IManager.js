"use strict";
const net           = require("net");
const util          = require("util");
const fs            = require("fs");
const EventEmitter  = require("events");
const {Server}      = require("../lib/RPCSocket.js");
const IHandler      = require("./IHandler.js");
const ClustersInfo  = require("./ClustersInfo.js");
const CoreInfo      = require("./CoreInfo.js");
const editor        = require('../lib/AssignEdittor.js');
const IConfig       = require("./IManagerConfig.js");
const {UDPClient}   = require("../lib/UDP.js");
const NSLog         = require('fxNetSocket').logger.getInstance();
const hostname      = require("os").hostname();
const IPFilterPath  = "../configuration/IPFilter.json";
const AssignPath    = "../configuration/Assign.json";
const syncAssignFile = true;
const saveHeapTime   = (10 * 60 * 1000);
/**
 * 新版管理層
 * @constructor
 */
class IManager extends EventEmitter {
    constructor(delegate, options) {
        super();
        this.delegate = delegate;
        this.timer = undefined;
        this.nodesInfo = new ClustersInfo(this);
        this.coreInfo = new CoreInfo(this);
        this.iHandler = this.setupHandler();
        this.udp = new UDPClient(this, 8080);
        this.iHandler.setup({
            IPFilterPath,
            AssignPath,
            syncAssignFile
        });
        this.blockIPs = this.readFile(IPFilterPath, {enabled:true, allow:{}, deny:{}});

        //auto check
        this.autoTimes = 0;
        this.setupServerMode();
        this.setup();
        this.start();
    }
}
IManager.prototype.setupHandler = function () {
    const handler = new IHandler(this);
    handler.on('refresh', () => {
        this.nodesInfo.refresh();
    })
    return handler;
};
/**
 * 建立伺服器
 * @param options
 */
IManager.prototype.createTCPServer = function (options) {
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
IManager.prototype.setupServerMode = function () {
    if (IConfig.server.passive.enabled) {
        let options = JSON.parse(JSON.stringify(IConfig.server.passive));
        this.server = this.createTCPServer(options);
    }
    if (IConfig.server.active.enabled) {
        let options = JSON.parse(JSON.stringify(IConfig.server.active));
        this.createConnect(options);
    }
};
IManager.prototype.createConnect = function (options) {
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
    active.on("error", (err) => {

    })
    active.connect(options.port, options.host);
};
IManager.prototype.setCluster = function (name, cluster) {
    const proxy = this.delegate;
    if (!proxy) return false;
    console.log('setCluster', Array.isArray(proxy.clusters[name]));
    if (Array.isArray(proxy.clusters[name]) == false) {
        proxy.clusters[name] = [];
        proxy.roundrobinNum[name] = 0;
    }
    if (cluster) {
        proxy.clusters[name].push(cluster);
    }
    return proxy.clusters[name];
};
IManager.prototype.getClusters = function (name) {
    const proxy = this.delegate;
    if (!proxy) return false;
    if (name) {
        return proxy.clusters[name];
    } else {
        return proxy.clusters;
    }
};
IManager.prototype.rmCluster = function (name) {
    const proxy = this.delegate;
    if (!proxy) return false;
    if (name) {
        delete proxy.clusters[name];
        return true;
    } else {
        return false;
    }
}
IManager.prototype.findCluster = function (pid, name) {
    const clusters = this.getClusters();
    if (!clusters) return false;

    if (typeof name == "string") {
        let group = clusters[name];
        for (let cluster of group) {
            let {_cpfpid} = cluster;
            if (_cpfpid == pid) return cluster;
        }
    } else {
        let groupKeys = Object.keys(clusters);
        for (let key of groupKeys) {
            let group = clusters[key];
            for (let cluster of group) {
                let {_cpfpid} = cluster;
                if (_cpfpid == pid) return cluster;
            }
        }
    }
    return false;
};
/**
 * 回收子程序
 * @param name
 * @param pid
 */
IManager.prototype.freeCluster = function ({pid}) {
    if (typeof pid == "number") {
        const cluster = this.findCluster(pid);
        if (cluster) {
            cluster.stop();
            cluster.stopHeartbeat();
            cluster.isRelease = true;
            return true;
        } else {
            return false;
        }
    }
};
//主服務關閉所有使用者進入
IHandler.prototype.setAllowEntry = function (bool) {
    const proxy = this.delegate;
    if (!proxy) return false;
    proxy.lockState = bool;
    return true;
}
IManager.prototype.getGarbageDump = function () {
    const proxy = this.delegate;
    if (!proxy) return false;
    return proxy.garbageDump || [];
};
IManager.prototype.getBalancerCluster = function () {
    const proxy = this.delegate;
    if (!proxy) return false;
    return proxy.gameLBSrv.getCluster;
};
IManager.prototype.getBalancer = function () {
    const proxy = this.delegate;
    if (!proxy) return false;
    return proxy.gameLBSrv;
}
IManager.prototype.getLockState = function () {
    return this.delegate._lockState;
};
IManager.prototype.getCPU = function (pid) {
    return this.coreInfo.cpu(pid);
}
IManager.prototype.setup = function () {
    Object.defineProperties(this, {
        blockIPsEnabled: {
            get:function () {
                if (typeof this.blockIPs != "undefined" && typeof this.blockIPs.enabled == "boolean") {
                    return this.blockIPs.enabled;
                } else {
                    return false;
                }
            }, configurable: false, enumerable: false
        }
    });
};
IManager.prototype.start = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(this.loops.bind(this), 5000);

};
IManager.prototype.loops = function () {
    this.nodesInfo.refresh();
    if (++this.autoTimes >= 60) {
        this.autoTimes = 0; //重置
        this.automaticCheckCluster();
    }
    this.cpuCheck();
};
IManager.prototype.cpuCheck = function () {
    if (this.coreInfo.checkServices(this.nodesInfo.pids)) {
        this.coreInfo.getPID(this.nodesInfo.info);
    }
}
IManager.prototype.clean = function () {

};
IManager.prototype.release = function () {

};
/** IPC Event **/
IManager.prototype.sendIPCMessage = function (cluster, params, callback) {
    if (typeof this.ipcToken != "number") this.ipcToken = 0;
    if (!this.callbackFunc) this.callbackFunc = {};
    params.id = "/" + this.ipcToken++;
    cluster.send({'evt':'ipcMessage', params:params});
    this.callbackFunc[params.id] = {
        cb: callback,
        ts: setTimeout(() => {
            if (callback) callback(false)
            this.callbackFunc[params.id] = null;
            delete this.callbackFunc[params.id];
        }, 10000)
    };
}
IManager.prototype.onIpcMessage = function (message) {
    if (!this.callbackFunc) this.callbackFunc = {};
    if (typeof this.callbackFunc[message.id] != "undefined") {
        const cb = this.callbackFunc[message.id].cb;
        clearTimeout(this.callbackFunc[message.id].ts);
        this.callbackFunc[message.id] = null;
        if (cb) cb(true);
    }
};
IManager.prototype.refreshClusterParams = function (cluster) {
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
IManager.prototype.awaitRecycle = function () {
    if (this.delegate) {
        this.delegate.awaitRecycle();
    }
};
/**
 * 自動檢查機制 start auto remove mem
 * @return {Boolean}
 */
IManager.prototype.automaticCheckCluster = function () {
    const clusters = this.getClusters();
    let arr_assign = Object.keys(clusters);
    let res = false;
    for (let i = 0; i < arr_assign.length; i++) {
        let assign = arr_assign[i];
        res = this.outOfRangeMemLimit(assign);
    }
    return res;
};
IManager.prototype.outOfRangeMemLimit = function (assign) {
    const group = this.getClusters(assign);
    if (group) return false;

    for (let i = 0; i < group.length; i++) {
        let cluster = group[i];
        if (cluster.ats != true) continue;
        if (typeof cluster.nodeInfo != 'undefined' && typeof cluster.nodeInfo.memoryUsage != "undefined") {
            let memory = cluster.nodeInfo.memoryUsage["rss"];
            let memory_m = (memory / 1024 / 1024).toFixed(2);
            let maxMemory = (cluster.mxoss * 0.9);
            let isFull = memory_m > maxMemory;
            NSLog.log("debug", "outOfRangeMemLimit: %s > %s = %s", memory_m , maxMemory , isFull, this.getGarbageDump().length);
            if (typeof cluster.overload != "number") cluster.overload = 0;
            if (isFull) { //預留10%緩衝
                cluster.overload++;
                if (cluster.overload > 2) return this.cloneCluster(assign);
            } else {
                cluster.overload = 0;
            }
        }
    }
    return false;
};
/** 複製一個一樣程序然後另個等待回收 **/
IManager.prototype.cloneCluster = function ({assign, pid}) {
    const manager = this;
    const group = manager.getClusters(assign);
    if (!group) {
        return false;
    }
    let index = 0;
    let cluster = group[0];
    for (let i = 0; i < group.length; i++) {
        if (group[i]._cpfpid == pid) {
            index = i;
            cluster = group[i];
            break;
        }
    }


    if (cluster) {
        return false;
    }
    let mxoss = cluster.mxoss;
    let file  = cluster._modulePath;

    if (typeof cluster.optConf != "undefined") {
        file = cluster.optConf;
    }
    this.iHandler.addCluster({
        file,
        name:assign,
        mxoss,
        options:{clone: true}
    });
    let trash = group.splice(index, 1)[0];
    trash.recycleStartDate = new Date().getTime();
    let garbageDump = manager.getGarbageDump();
    garbageDump.push(trash);
    NSLog.log("warning","cloneCluster(%s)", assign, group.length, garbageDump.length);
    manager.awaitRecycle();
    return true;
};
/** 統計ip **/
IManager.prototype.checkedIPDeny = function (ip) {
    //Denying the connection.
    if (typeof ip != "string") return false;
    // console.log(this.blockIPs["deny"]);
    return typeof this.blockIPs["deny"][ip] != "undefined" && this.blockIPs["deny"][ip].enabled === true;
};
IManager.prototype.handoffService = async function ({name, host, port}, remoteInfo) {
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
            const wait = await this.waiting(1000);
        }
    }
}
IManager.prototype.waiting = async function (millisecond) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve();
        }, millisecond || 500);
    })
};
IManager.prototype.readFile = function (namepath, defObj) {
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

IManager.prototype.writeFile = function (namepath, data) {
    return fs.writeFileSync(namepath, JSON.stringify(data, null, "\t"));
};
IManager.prototype.close = function () {
    this.server.close(() => {
        NSLog.log("warning", "STOP Bound Port '%s'", IConfig.server.passive.port);
    });
}
/** http規則 */
IManager.prototype.getSignature = function (appID) {
    if (typeof appID == "string" && appID != "") {
        return (appID === IConfig.SIGNATURE);
    } else {
        return false;
    }
};
IManager.createManager = function (delegate) {
    const manager = new IManager(delegate);
    manager.nodesInfo.on('refresh', (element) => {
        // console.log('refresh', element);
    });
    // this.manager.coreInfo.start(); //開始系統資訊
    return manager;
};

module.exports = exports = IManager;