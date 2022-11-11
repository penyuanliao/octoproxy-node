"use strict";
const {spawn}       = require("child_process");
const EventEmitter  = require("events");
const GAME_LB_NAME_ASSIGN = "casino_game_rule";
const GAME_LB_NAME  = "loadBalance";
const NSLog         = require('fxNetSocket').logger.getInstance();
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
        this.activeCount = new Map();
        //記錄所有的process information
        this.info = [];
        //記錄所有pid
        this.pids = new Set();
        this.memory = new Map();
        this.uptime = Date.now();
        //記錄所有的tags
        this.tags = new Set();
        this.metadataMap = new Map();
        this.commandMap = new Set();
        this._mxoss = -1;
        this.updateTime = 0;
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
    };
    get isRefresh() {
        return (Date.now() - this.updateTime) < 1000;
    }
    get childActiveCount() {
        return [...this.activeCount];
    }
    /**
     * 刷新
     */
    async refresh() {
        if (this.isRefresh) {
            this.emit("refresh", this.info);
            return this.info;
        }
        this.clean();
        let services = await this.getProcessInfo();
        let trash = this.getTrashInfo();
        let lb = this.getLBAInfo();
        if (lb) services.push(lb);
        if (services.length != 0) {
            services[0].count = this.octoProxyCount;
            services[0].payload = Math.max(this.octoProxyCount, services[0].count);
            this.info = services.concat(trash);
            this.emit("refresh", this.info);
        }
        return this.info;
    }
    /**
     * 目前程序的資訊
     * @return {*[]|[{file: string, memoryUsage: NodeJS.MemoryUsage, name: string, count: number, lock, pid: number, lv: string, complete: boolean, uptime}]}
     */
    async getProcessInfo() {
        const clusters = this.delegate.getClusters();
        if (!clusters) return [];
        let keys = Object.keys(clusters);
        let total = 0;
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
            "lv": NSLog.level,
            "uptime": this.uptime,
            "cpuUsage": this.delegate.getCPU(process.pid),
            "tags": [...this.tags],
            "payload": 0
        }];

        keys.forEach((key) => {

            let j     = 0;
            let group = clusters[key];
            let obj, cluster, count;
            while (j < group.length)
            {
                cluster = group[j];
                obj = {}
                this.unifyData(cluster, obj);
                this.updateMetadata(cluster);
                list.push(obj);
                pids.add(cluster.pid);
                count = cluster.nodeInfo.connections || 0;
                this.activeCount.set(cluster.name, count)
                total += count;
                j++;
            }
            group = null;
        });
        this.octoProxyCount += total;
        this.memory.clear();
        if (this.commandMap.size != 0) await this.getProcessMemory();
        this.commandMap.clear();
        return list;
    };
    /**
     * 分析記憶體
     * @return {Promise}
     */
    getProcessMemory() {
        return new Promise((resolve) => {
            const child = spawn('sh', ['-c', 'ps -eo pid,rss,vsz,comm | grep node']);
            child.stdout.on("data", (data) => {
                if (!data) return false;
                data.toString().replace(/( )+/g, " ").split('\n').forEach((element) => {
                    let [pid, rss, heapTotal] = element.split(" ");
                    if (pid != '') this.memory.set(Number(pid), { rss: Number(rss) * 1024, heapTotal: Number(heapTotal) * 1024 });
                });
                resolve(this.memory);
            });
            child.stderr.on('data', (data) => {
                reject(data.toString());
            })
        })
    };
    /**
     * 檢查數據資料
     * @param cluster
     * @param obj
     * @return {{}}
     */
    unifyData(cluster, obj) {
        if (!obj) obj = {lv: 'none', payload: 0};

        if (!cluster) return obj;

        const {
            pid, name, nodeInfo,
            _dontDisconnect, creationComplete, uptime,
            ats, _lookoutEnabled, _args,
            nodeConf, _modulePath,
            tags, monitor, mxoss,
            optConf, cmd, rules,
            assign2syntax
        } = cluster;
        const { connections, memoryUsage, params, info } = nodeInfo;
        obj.file = _modulePath;
        obj.name  = name;
        obj.pid   = pid;
        obj.mxoss = mxoss;
        obj.count = connections;
        obj.lock  = _dontDisconnect;
        obj.complete = creationComplete;
        obj.uptime = uptime;
        obj.ats   = ats;
        obj.lookout = _lookoutEnabled;
        obj.args = _args.slice(1);
        obj.env  = optConf.env;
        obj.assign2syntax  = assign2syntax;
        obj.cpuUsage  = this.delegate.getCPU(pid);
        obj.payload = Math.max((obj.payload || 0), connections);
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
        } else if (cmd != false || !obj.lookout) {
            obj.memoryUsage = this.memory.get(pid);
        }
        if (typeof nodeConf != "undefined") {
            this.setNodeConf(nodeConf, obj);
        }
        if (Array.isArray(params)) {
            obj.params.forEach((item) => obj[item[0]] = item[1]);
        }
        if (info) obj.info = info;
        obj.bitrates = nodeInfo.bitrates;
        if (monitor) obj.monitor = monitor;
        if (rules) obj.rules = rules;
        if (typeof cmd == "string" && cmd != false || !obj.lookout) this.commandMap.add(pid);

        return obj;
    };
}

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
        this.pids.add(group[j].pid);
        this.octoProxyCount += group[j].nodeInfo.connections;
        j++;
    }
    return list;
};
ClustersInfo.prototype.updateMetadata = function (cluster) {
    let {metadataMap} = this;
    let { metadata, pid, name } = cluster;
    if (metadata) {
        metadataMap.set(pid, metadata);
    }
};
ClustersInfo.prototype.getMetadata = function (pid) {
    if (pid) {
        return this.metadataMap.get(pid);
    } else {
        return [...this.metadataMap];
    }

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
            "pid"  :LBSrv.pid,
            "name" :GAME_LB_NAME_ASSIGN,
            "count":0,
            "lv"   :LBSrv.lv,
            "lock" :LBSrv._dontDisconnect,
            "memoryUsage":{"rss":0},
            "file":GAME_LB_NAME,
            "complete":LBSrv.creationComplete,
            "uptime":LBSrv.uptime,
            "args": LBSrv._args,
            "cpuUsage": this.delegate.getCPU(LBSrv.pid),
            "mxoss": LBSrv.mxoss
        };
        obj["memoryUsage"] = LBSrv.nodeInfo.memoryUsage;
        const {lv, f2db, amf} = (LBSrv.nodeConf || {});
        if (lv) obj.lv = lv;
        if (f2db) obj.f2db = f2db;
        if (amf) obj.amf = amf;
        this.pids.add(LBSrv.pid);
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
    // this.info = [];
    this.activeCount.clear();
    this.pids = new Set([process.pid]);
    this.metadataMap.clear();
    this.updateTime = Date.now();
};
ClustersInfo.prototype.release = function () {
    this.delegate = null;
};
module.exports = exports = ClustersInfo;