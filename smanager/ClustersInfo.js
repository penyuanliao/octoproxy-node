"use strict";
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const GAME_LB_NAME_ASSIGN = "casino_game_rule";
const GAME_LB_NAME = "loadBalance";

/**
 * 服務資訊
 * @constructor
 */
class ClustersInfo extends EventEmitter {
    constructor(delegate) {
        super();
        this.delegate = delegate;
        /** total client count **/
        this.octoProxyCount = 0;
        this.procCount = [];
        this.procKeys = [];
        //記錄所有的process information
        this.info = [];
        //記錄所有pid
        this.pids = new Set();
        this.uptime = Date.now();
        //記錄所有的tags
        this.tags = new Set();
        this.metadata = [];
        this._mxoss = -1;
        setTimeout(() => this.refresh(), 1000);
    }
    get mxoss() {
        if (this._mxoss == -1) {
            this._mxoss = 0;
            process.argv.forEach((value) => {
                if (value.indexOf('max-old-space-size') != -1) {
                    let num = value.split("=")[1];
                    this._mxoss = Number(num);
                } else {}
            });
        }
        return this._mxoss;
    }
    /**
     * 刷新
     */
    refresh() {
        this.clean();
        let services = this.getProcessInfo();
        let trash = this.getTrashInfo();
        let lb = this.getLBAInfo();
        if (lb) services.push(lb);
        if (services.length != 0) {
            services[0].count = this.octoProxyCount;
            this.info = this.info.concat(services, trash);
            this.emit("refresh", this.info);
        }
    }
}
/**
 * 目前程序的資訊
 * @return {*[]|[{file: string, memoryUsage: NodeJS.MemoryUsage, name: string, count: number, lock, pid: number, lv: string, complete: boolean, uptime}]}
 */
ClustersInfo.prototype.getProcessInfo = function () {
    const clusters = this.delegate.getClusters();
    if (!clusters) return [];
    let keys = Object.keys(clusters);
    let total = 0;
    let procCount = this.procCount;
    let procKeys  = this.procKeys;
    let pids = this.pids;
    let list = [{
        "pid": process.pid,
        "file": "Main",
        "name":'octoproxy',
        "count": 0,
        "mxoss": this.mxoss,
        "lock": this.delegate.getLockState(),
        "memoryUsage": process.memoryUsage(),
        "complete": 1,
        "lv": "debug",
        "uptime": this.uptime,
        "cpuUsage": this.delegate.getCPU(process.pid),
        "tags": [...this.tags]
    }];
    keys.forEach((key) => {

        let j     = 0;
        let group = clusters[key];
        let obj, cluster;
        while (j < group.length)
        {
            cluster = group[j];
            obj = {}
            this.unifyData(cluster, obj);
            this.updateMetadata(cluster);
            list.push(obj);
            procKeys.push(key);
            procCount.push(cluster.nodeInfo.connections);
            pids.add(cluster._cpfpid);
            total += cluster.nodeInfo.connections;
            j++;
        }
        group = null;
    });
    this.octoProxyCount += total;
    return list;
};
/**
 * 檢查數據資料
 * @param cluster
 * @param obj
 * @return {{}}
 */
ClustersInfo.prototype.unifyData = function (cluster, obj) {
    if (!obj) obj = {lv: 'none'};

    if (!cluster) return obj;

    const {
        _cpfpid, name, nodeInfo,
        _dontDisconnect, creationComplete, uptime,
        ats, _lookoutEnabled, _args,
        nodeConf, _modulePath,
        tags, monitor, mxoss,
        optConf
    } = cluster;
    const { connections, memoryUsage } = nodeInfo;
    obj.mxoss = mxoss;
    obj.pid   = _cpfpid;
    obj.name  = name;
    obj.count = connections;
    obj.lock  = _dontDisconnect;
    obj.complete = creationComplete;
    obj.uptime = uptime;
    obj.ats   = ats;
    obj.lookout = _lookoutEnabled;
    obj.args = _args.slice(1);
    obj.env  = optConf.env;
    obj.cpuUsage  = this.delegate.getCPU(_cpfpid);
    let hashtag;
    if (!Array.isArray(tags)) {
        hashtag = (tags || "").split(",")
    } else {
        hashtag = tags;
    }
    if (Array.isArray(tags)) {
        tags.forEach((value) => this.tags.add(value));
    }
    obj.tags = hashtag;
    if (typeof memoryUsage != "undefined") {
        obj.memoryUsage = memoryUsage;
    }
    if (typeof nodeConf != "undefined") {
        this.setNodeConf(nodeConf, obj);
    }
    if (Array.isArray(nodeInfo.params)) {
        obj.params.forEach((item) => obj[item[0]] = item[1]);
    }
    obj.bitrates = nodeInfo.bitrates;
    if (monitor) obj.monitor = monitor;
    obj.file = _modulePath;
    return obj;
};
ClustersInfo.prototype.setNodeConf = function ({lv, f2db, amf}, obj) {
    if (lv) obj.lv = lv;
    else obj.lv = 'none';
    if (f2db) obj.f2db = f2db;
    if (amf) obj.amf = amf;
};
/**
 * 回收機制資訊
 * @return {*[]}
 */
ClustersInfo.prototype.getTrashInfo = function () {
    let list = [];
    const group = this.delegate.getGarbageDump();
    if (!group) return [];
    let j = 0;
    while (j < group.length)
    {
        let obj = {trash:true};
        this.unifyData(group[j], obj);
        list.push(obj);
        this.pids.add(group[j]._cpfpid);
        this.octoProxyCount += group[j].nodeInfo.connections;
        j++;
    }
    return list;
};
ClustersInfo.prototype.updateMetadata = function (cluster) {
    let data = [];
    let { metadata, _cpfpid } = cluster;
    if (metadata) {
        data.push([_cpfpid, metadata]);
    }
    this.metadata = data;
};
ClustersInfo.prototype.getMetadata = function () {
    return Object.assign([], this.metadata);
};
/**
 * load balance
 * @return {Object|null}
 */
ClustersInfo.prototype.getLBAInfo = function () {
    const LBSrv = this.delegate.getBalancerCluster();
    if (!LBSrv) return false;
    if (LBSrv) {
        let obj   = {
            "pid"  :LBSrv._cpfpid,
            "name" :GAME_LB_NAME_ASSIGN,
            "count":0,
            "lv"   :LBSrv.lv,
            "lock" :LBSrv._dontDisconnect,
            "memoryUsage":{"rss":0},
            "file":GAME_LB_NAME,
            "complete":LBSrv.creationComplete,
            "uptime":LBSrv.uptime,
            "args": LBSrv._args,
            "cpuUsage": this.delegate.getCPU(LBSrv._cpfpid),
            "mxoss": LBSrv.mxoss
        };
        obj["memoryUsage"] = LBSrv.nodeInfo.memoryUsage;
        const {lv, f2db, amf} = (LBSrv.nodeConf || {});
        if (lv) obj.lv = lv;
        if (f2db) obj.f2db = f2db;
        if (amf) obj.amf = amf;
        this.pids.add(LBSrv._cpfpid);
        return obj;
    } else {
        return null;
    }
};
/**
 * 提供 Balancer live count
 * @param {Array} list 人數
 * @param {Array} keys 子程序
 */
ClustersInfo.prototype.resetBalancerCount = function (list, keys) {
    const LBSrv = this.delegate.getBalancer();
    if (LBSrv) {
        LBSrv.updateServerCount(list, keys);
    }
};

ClustersInfo.prototype.clearTags = function () {
    this.tags.clear();
};
ClustersInfo.prototype.clean = function () {
    this.octoProxyCount = 0;
    this.procCount = [];
    this.procKeys = [];
    this.info = [];
    this.pids = new Set([process.pid]);
};
ClustersInfo.prototype.release = function () {
    this.delegate = null;
};
module.exports = exports = ClustersInfo;