"use strict";
const events        = require("events");
const util          = require("util");
const fs            = require("fs");
const editor        = require('../lib/AssignEdittor.js');
const AMFConfigPath = "../configuration/AMFConfig.json";
const DashboardPath = "./historyLog/Dashboard.json";
const NSLog         = require('fxNetSocket').logger.getInstance();

const GAME_LB_NAME_ASSIGN = "casino_game_rule";
const GAME_LB_NAME = "loadBalance";

const ManagerEvents2 = new Set([
    "setRecordEnabled",
    "updatePodDevInfo",
    "applyJoin",
]);
const ManagerEvents = new Set([
    "test",
    "getAMFConfig",
    "setAMFConfig",
    "setLogLevel",
    "getServiceInfo",
    "getSysInfo",
    "getLBGamePath",
    "setLBGamePath",
    "clusterLockEnabled",
    "kickoutToPID",
    "hotReload",
    "reloadToPID",
    "restartCluster",
    "killCluster",
    "editCluster",
    "addCluster",
    "restartMultiCluster",
    "ipcMessage",
    "readConfigFile",
    "readFileContents",
    "saveFileContents",
    "readBlockIPs",
    "getDashboardInfo",
    "lockdownMode"
]);
/**
 *
 * @constructor
 */
class IHandler extends events {
    constructor(delegate) {
        super();
        this.delegate = delegate;
        this.syncAssignFile = true;
    }
}

/**
 * 初始化設定
 * @param IPFilterPath
 * @param syncAssignFile
 * @param AssignPath
 */
IHandler.prototype.setup = function ({IPFilterPath, syncAssignFile, AssignPath}) {
    this.IPFilterPath = IPFilterPath;
    this.syncAssignFile = syncAssignFile;
    this.AssignPath = AssignPath;
    this.IPFilterPath = IPFilterPath;
};
/**
 * 代理事件
 * @param params
 * @param client
 * @param callback
 */
IHandler.prototype.targetEvent = function (params, client, callback) {
    const {method} = params;
    if (ManagerEvents.has(method)) {
        this[method].apply(this, arguments);
    } else {
        NSLog.log("debug", "NOT Method '%s'", method);
        if (callback) callback({
            result: false
        });
    }
};
IHandler.prototype.test = function (params, client, callback) {
    if (callback) {
        callback({result: true, version: require('./package.json').version});
    }
};
IHandler.prototype.clusterInfoRefresh = function () {
};
/** 讀取目前服務資訊 **/
IHandler.prototype.getServiceInfo = function (params, client, callback) {
    let data = {};
    if (this.delegate) {
        data = this.delegate.nodesInfo.info;
    }
    if (callback) {
        callback({
            result: true,
            data: data
        })
    }
};
IHandler.prototype.getSysInfo = function (params, client, callback) {
    let data = {};
    if (this.delegate) {
        data = this.delegate.coreInfo.refresh();
    }
    if (callback) {
        callback({
            result: true,
            data: data
        });
    }
};
IHandler.prototype.setLogLevel2 = function (params, client, callback) {
    try {
        this.setLogLevel2(params, client, callback);
    } catch (e)
    {
        console.log(e);
    }
}
/**
 * 增加子程序
 * @param params
 * @param client
 * @param callback
 */
IHandler.prototype.addCluster = function (params, client, callback) {
    let {
        file,
        assign,
        mxoss,
        options
    } = params;
    options.file = file;
    options.assign = assign;
    options.mxoss = mxoss;
    let {clone} = options;
    const endpoint = this.delegate.delegate;
    let index = endpoint.clusterNum++;

    const child = endpoint.createChild(endpoint, {index, params: options});

    const {name} = child;

    const group = this.delegate.getClusters(name);

    if (!group) {
        this.delegate.setCluster(name, child);
    }

    if (this.syncAssignFile && clone != true) {
        this.updateAssign(child.optConf);
    }

    if (callback) callback({
        result: true
    });
};
/**
 * 刪除子程序
 * @param params
 * @param client
 * @param callback
 */
IHandler.prototype.killCluster = function (params, client, callback) {
    const clusters = this.delegate.getClusters();
    const pid = parseInt(params.pid);
    const keys = Object.keys(clusters);

    if (!IHandler._verifyArgs(pid, "number")) {
        if (callback) callback({result: false});
        return false;
    }
    let result = false;
    for (let name of keys) {
        let group = clusters[name];
        for (var j = 0; j < group.length; j++) {
            let cluster = group[j];
            let c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster.stop();
                cluster.stopHeartbeat();
                cluster.isRelease = true;
                group.splice(j,1);
                if (this.syncAssignFile)
                    this.deleteAssign({name});
                result = true;
                break;
            }

        }
    }
    if (callback) callback({result});
};
/**
 * 修改子程序
 * @param params
 * @param client
 * @param callback
 */
IHandler.prototype.editCluster = function (params, client, callback) {
    let {oldName, newName, mxoss, options} = params;
    const oGroup = this.delegate.getClusters(oldName) || [];
    if (!oGroup) {
        if (callback) callback({result: false});
        return false;
    } else if (!IHandler._verifyArgs(oldName, "string") || !IHandler._verifyArgs(newName, "string")) {
        if (callback) callback({result: false});
        return false;
    }
    let nGroup;
    let file;
    if (typeof options == "undefined") options = {};
    const clusters = this.delegate.getClusters(newName);

    if (!clusters) {
        nGroup = this.delegate.setCluster(newName);
    } else {
        nGroup = oGroup;
    }
    while (oGroup.length > 0) {
        var cluster = oGroup.shift();
        cluster.name = newName;
        if (typeof mxoss == "undefined") mxoss = cluster.mxoss;
        if (typeof mxoss != "number") mxoss = 2048;
        file  = cluster._modulePath;
        if (typeof options.ats == "boolean") {
            cluster.ats = options.ats;
        }
        nGroup.push(cluster);
    }
    if (this.syncAssignFile) {
        let args = {
            oAssign: oldName,
            obj: {
                file:file,
                assign:newName,
                mxoss:mxoss,
                options:options
            }
        };
        this.editAssign(args);
    }
    this.delegate.rmCluster(oldName);
    if (callback) callback({result: true});
};
/**
 * [重啟]服務
 * @param params
 * @param {string} params.name
 * @param {number|string} params.pid
 * @param client
 * @param callback
 * @return {boolean}
 */
IHandler.prototype.restartCluster = function (params, client, callback) {
    NSLog.log("info",'restartCluster', params);
    if (params.name == GAME_LB_NAME_ASSIGN) {
        return this.restartBalancer(params, client, callback);
    }
    let data = [];
    let pid = parseInt(params.pid);
    if (typeof pid == "number") {
        let cluster = this.delegate.findCluster(pid, params.name);
        if (cluster) {
            cluster.restart();
            data.push(pid);
            NSLog.log('info', "Admin User do restartCluster();", pid);
        }
    } else {
        let group = this.delegate.getClusters(params.name);
        if (Array.isArray(group)) {
            for (let cluster of group) {
                NSLog.log('info', "*** Admin User do restartCluster();", cluster._cpfpid);
                cluster.restart();
            }
        }
    }
    if (callback) callback({result: true, data});
};
/**
 * [重啟]多個服務
 * @param params
 * @param client
 * @param callback
 * @return {boolean}
 */
IHandler.prototype.restartMultiCluster = function (params, client, callback) {
    if (this.hasMultiReboot) {
        if (callback) callback({result: false});
        return false;
    }
    this.hasMultiReboot = true;
    this.multiReboot(params.group, client, callback).then((res) => {
        this.hasMultiReboot = false;
    }).catch((err) => {
        this.hasMultiReboot = false;
    });
};
IHandler.prototype.multiReboot = async function (group, client, callback) {
    const clusters = this.delegate.getClusters();
    const keys = Object.keys(clusters);
    const LBSrv = this.delegate.getBalancerCluster();
    let index;
    if ((index = group.indexOf(LBSrv._cpfpid)) != -1) {
        this.restartBalancer();
        group.splice(index, 1);
    }

    for (let name of keys) {
        let clusterGroup = clusters[name];
        if (!Array.isArray(clusterGroup)) continue;
        for (let cluster of clusterGroup) {
            index = group.indexOf(String(cluster._cpfpid));
            if (index !== -1) {
                cluster.restart();
                NSLog.log('info', "Admin User do restartCluster();", cluster._cpfpid);
                group.splice(index, 1);
                const wait = await this.waiting(1000);
            }
            if (group.length == 0) return true;
        }
    }
    return true;
};
IHandler.prototype.waiting = async function (millisecond) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve();
        }, millisecond || 500);
    })
};
/**
 * [重啟]附載平衡服務
 * @param [params]
 * @param [client]
 * @param [callback]
 * @return {boolean}
 */
IHandler.prototype.restartBalancer = function (params, client, callback) {
    const LBSrv = this.delegate.getBalancerCluster();
    let result = false;
    if (LBSrv) {
        LBSrv.name = GAME_LB_NAME;
        LBSrv.restart();
        NSLog.log('info', "Admin User do restartGLoadBalance();");
        result = true;
    }
    if (callback) callback({result});
    return result;
};
/**
 * process socket lock & unlock to pid or assign
 * @param params
 * @param client
 * @param callback
 * @version 2.0.0
 */
IHandler.prototype.clusterLockEnabled = function (params, client, callback) {
    let result = true;
    if (params.type == 'pid') {
        const pid = parseInt(params.pid);
        //主服務
        if (process.pid == pid) {
            result = this.entryStatus(params.lock);
            this.emit('refresh');
        } else {
            const cluster = this.delegate.findCluster(pid);
            if (cluster) {
                cluster._dontDisconnect = (params.lock == true);
                NSLog.log('info',' |- Service Lock: %s PID: %s.', cluster._dontDisconnect, pid);
                this.emit('refresh');
            } else {
                result = false;
            }
        }
    } else if (params.type == 'assign') {
        const group = this.delegate.getClusters(params.assign);
        let i = group.length;
        while (i-- > 0) {
            var cluster = group[i];
            cluster._dontDisconnect = params.lock;
            NSLog.log('info',' |- Service Lock: %s Assign: %s ', cluster._dontDisconnect, params.assign);
        }
        this.emit('refresh');
    } else {
        result = false;
    }
    if (callback) callback({result});
};
/**
 * 調整服務狀態
 * @param bool
 * @return {boolean}
 */
IHandler.prototype.entryStatus = function (bool) {
    this.delegate.setAllowEntry((bool == true));
    return true;
}
IHandler.prototype.reboot = function (params, client, callback) {
    
}
/** 剔除使用者 */
IHandler.prototype.kickoutToPID = function ({pid, trash, params}, client, callback) {

    const _pid = parseInt(pid);

    if (!IHandler._verifyArgs(_pid, "number")) {
        if (callback) callback({result: false});
        return false;
    }
    if (trash === true) {
        let trashGroup = this.delegate.getGarbageDump();
        for (let j = 0; j < trashGroup.length; j++) {
            if (trashGroup[j]._cpfpid == pid) {
                trashGroup[j].send({'evt':'kickUsersOut', params:params});
                if (callback) callback({result: true});
                return true;
            }

        }
    } else {

    }
    const cluster = this.delegate.findCluster(pid);
    if (!cluster) {
        if (callback) callback({result: false});
    } else {
        cluster.send({'evt':'kickUsersOut', params:params});
        if (callback) callback({result: true});
    }
    return false;
};
IHandler.prototype.reloadToPID = function ({pid, params}, client, callback) {
    const _pid = parseInt(pid);

    if (!IHandler._verifyArgs(_pid, "number")) {
        if (callback) callback({result: false});
        return false;
    }
    const cluster = this.delegate.findCluster(pid);
    if (!cluster) {
        if (callback) callback({result: false});
    } else {
        cluster.send({'evt':'reload', params:params});
        if (callback) callback({result: true});
    }
};
IHandler.prototype.hotReload = function ({pid, params}, client, callback) {
    const _pid = parseInt(pid);

    if (!IHandler._verifyArgs(_pid, "number")) {
        if (callback) callback({result: false});
        return false;
    }
    const cluster = this.delegate.findCluster(pid);
    if (!cluster) {
        if (callback) callback({result: false});
    } else {
        cluster.send({'evt':'hotReload', params:params});
        cluster._dontDisconnect = true;
        if (callback) callback({result: true});
    }
};
IHandler.prototype.setLogLevel = function ({pid, params}, client, callback) {
    const _pid = parseInt(pid);
    console.log(`setLogLevel:`,pid, params);
    if (!IHandler._verifyArgs(_pid, "number")) {
        if (callback) callback({result: false});
        return false;
    }
    const cluster = this.delegate.findCluster(pid);
    if (!cluster) {
        if (callback) callback({result: false});
    } else {
        cluster.send({'evt':'setLogLevel', params:params});
        if (typeof cluster.nodeConf != "undefined") cluster.nodeConf.lv = params.lv;
        if (callback) callback({result: true});
    }
};
IHandler.prototype.reloadMgmt = function ({pid}, client, callback) {
    if (process.pid != pid) {
        if (callback) callback({result: false});
        return false;
    } else {
        this.delegate.delegate.reLoadManagement();
        if (callback) callback({result: true});
        return true;
    }
};
/**
 * income使用者IPAddress紀錄
 * @param enabled 開關
 * @param client
 * @param callback
 */
IHandler.prototype.setRecordEnabled = function ({enabled}, client, callback) {
    if (typeof enabled == "undefined") enabled = false;
    if (typeof this.delegate != "undefined") {
        if (this.delegate) {
            const endpoint = this.delegate.delegate;
            if (endpoint) {
                endpoint.recordEnabled = enabled;
                if (callback) callback({result: true});
            }
        }
    }
    if (callback) callback({result: false});
};
/** 服務紀錄的ip **/
IHandler.prototype.readBlockIPs = function (params, client, callback) {
    this.delegate.blockIPs = this.readFile(this.IPFilterPath, {enabled:false, allow:{}, deny:{}});
    if (callback) callback({result: true});
};
IHandler.prototype.setIPFilter = function ({ip, state, endTime, count, log}, client, callback) {
    var checkIP = ip.match(/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);

    // var checkIPv6 = ip.match(/(?:[\w\d]{1,4}:){7}[\w\d]{1,4}/);
    // ip.split(":")
    if (checkIP == null) return;

    var obj = {address: checkIP.toString(), state:state, startTime: new Date().toISOString()};

    if (state) {
        editor.setIPFilterAdd.apply(this, [obj]);
    } else {
        editor.setIPFilterDel.apply(this, [obj]);
    }
    if (callback) callback({result: true});
};
IHandler.prototype.getIPFilter = function (params, client, callback) {
    const data = editor.getIPFilter.apply(this);
    if (callback) callback({result: true, data});
};
/**
 * 讀取dashboard資訊
 * @param params
 * @param client
 * @param callback
 * @return {Promise<void>}
 */
IHandler.prototype.getDashboardInfo = async function (params, client, callback) {
    const pathname = this.delegate.getPath(DashboardPath);
    NSLog.log("debug", "getDashboardInfo()", pathname);
    let data = await this.readFile(pathname, {});
    if (callback) {
        callback({data, result: true});
    }
};
/**
 * 關閉服務模式
 * @param params
 * @param client
 * @param callback
 * @return {Promise<void>}
 */
IHandler.prototype.lockdownMode = async function (params, client, callback) {
    let bool = params.bool;
    let result = true;
    const endpoint = this.delegate.delegate;
    console.log(`bool`, params);
    if (!bool) {
        result = false;
    } else {

        if (endpoint.lockdown && bool === false) {
            endpoint.lockdown = false;
        } else if (endpoint.lockdown === false && bool === true) {
            endpoint.lockdown = true;
        } else {
            result = false;
        }
    }
    NSLog.log("info", `lockdownMode() result: ${result} lockdown: ${endpoint.lockdown}`);
    if (callback) {
        callback({result});
    }
};
/**
 * 緊急模式
 * @param params
 * @param client
 * @param callback
 */
IHandler.prototype.emergencyMode = function (params, client, callback) {
    
};

/**
 * 讀取 Load Balancer 設定檔案
 * @return {Object}
 */
IHandler.prototype.getAssign = function () {
    return editor.getAssign.apply(this, arguments);
};
IHandler.prototype.saveAssign = function (conf) {
    return editor.saveAssign.apply(this, arguments);
};
/**
 * 更新：全部 Load Balancer 設定檔案
 * @param obj
 * @param client
 * @param callback
 */
IHandler.prototype.updateAssign = function (obj, client, callback) {
    let result = editor.updateAssign.apply(this, [obj]);
    if (callback) callback({result});
};
/**
 * 更新：指定設定 Load Balancer 設定檔案
 * @param oAssign
 * @param obj
 * @param [client]
 * @param [callback]
 */
IHandler.prototype.editAssign   = function ({oAssign, obj}, client, callback) {
    editor.editAssign.apply(this, [oAssign, obj]);
    if (callback) callback({result: true});
};
/**
 * 刪除：指定名稱 Load Balancer 設定檔案
 * @param name
 * @param [client]
 * @param [callback]
 */
IHandler.prototype.deleteAssign = function ({name}, client, callback) {
    NSLog.log("info", "mgmt.deleteAssign(%s)", name);
    editor.deleteAssign.apply(this, [name]);
    if (callback) callback({result: true});
};
/** Set AMFConfig **/
IHandler.prototype.setAMFConfig = function ({data}, client, callback) {
    NSLog.log("debug",'setAMFConfig()', data);
    fs.writeFileSync(AMFConfigPath, JSON.stringify(data, null, "\t"));
    if (callback) callback({
        result: true
    });
};
/** Get AMFConfig **/
IHandler.prototype.getAMFConfig = async function (params, client, callback) {
    NSLog.log("debug", "getAMFConfig()");
    let data = await this.readFile(AMFConfigPath, {});
    if (callback) {
        callback({data, result: true});
    }
};
/**
 * 讀取 LoadBalance.json
 * @param params
 * @param client
 * @param callback
 */
IHandler.prototype.getLBGamePath = function (params, client, callback) {
    const LBSrv = this.delegate.getBalancer();
    if (!LBSrv) {
        if (callback) callback({result: false});
    } else {
        LBSrv.getGamePath((data) => {
            if (callback) callback({data, result: true});
        });
    }
};
/**
 * 設定 LoadBalance.json
 * @param params
 * @param params.data
 * @param client
 * @param callback
 */
IHandler.prototype.setLBGamePath = function (params, client, callback) {
    const LBSrv = this.delegate.getBalancer();
    if (!LBSrv) {
        if (callback) callback({result: false});
    } else {
        console.log('setLBGamePath', Object.keys(params));
        LBSrv.setGamePath(params.data, (data) => {
            if (callback) callback({data, result: true});
        });
    }
};
IHandler.prototype.ipcMessage = function ({params, pid}, client, callback) {
    const _pid = parseInt(pid);

    if (!IHandler._verifyArgs(_pid, "number")) {
        if (callback) callback({result: false});
        return false;
    }
    const cluster = this.delegate.findCluster(_pid);
    if (cluster) {
        this.delegate.sendIPCMessage(cluster, params, (bool) => {
            if (callback) callback({result: bool});
        });
    } else {
        if (callback) callback({result: false});
    }
};
/**
 * 讀檔案
 * @param {String} filename
 * @param {Object} client
 * @param {Function} callback
 */
IHandler.prototype.readFileContents = function ({filename}, client, callback) {
    const filepath = util.format("../configuration/%s", filename);
    let res = false;
    let str, data;
    try {
        str = fs.readFileSync(filepath);
        data = JSON.parse(str.toString());
        res = true;
    } catch (e) {
    }

    if (callback) {
        callback({data, result: res});
    }
}
IHandler.prototype.saveFileContents = function ({filename, data}, client, callback) {
    const filepath = util.format("../configuration/%s", filename);
    let respond = {
        result: false
    }
    try {
       if (fs.existsSync(filepath)) {
           if (typeof data == "object") {
               respond.result = this.writeFile(filepath, data);
           }
       }
    } catch (e) {
        respond.error = e.message
    } finally {
        if (callback) {
            callback(respond);
        }
    }

};
IHandler.prototype.readFile = function (filepath, defObj) {
    let data;
    try {
        data = fs.readFileSync(filepath);
        return JSON.parse(data.toString());
    } catch (e) {
        NSLog.log("error", "Loading conf path '%s' not found.", filepath);
        data = defObj;
        this.writeFile(filepath, data);
        return data;
    }
};
IHandler.prototype.writeFile = function (filepath, data) {
    try {
        fs.writeFileSync(filepath, JSON.stringify(data, null, "\t"));
        return true;
    } catch (err) {
        return false;
    }

};

IHandler._verifyArgs  = function (str, type) {
    if (str == null) {
        return false;
    }else if (typeof str == "undefined") {
        return false;
    }else if (typeof str != type) {
        return false;
    }
    return true;
};
IHandler.setEnvironmentVariables = function (envVars, data) {
    let name;
    let value;
    let args;
    if (typeof data == "string") {
        args = IHandler.envStrFormatter(data);
    } else if (Array.isArray(data)) {
        args = data;
    } else {
        return envVars;
    }
    for (let envVar of args) {
        if (Array.isArray(envVar)) {
            name = envVar[0];
            value = envVar[1];
        }
        else if (typeof envVar == "object") {
            name = envVar.name;
            value = envVar.value;
        }
        if (name) {
            envVars[name] = value;
        }
    }
    return envVars;
};
IHandler.envStrFormatter = function (data) {
    let params = data.split(",");
    let strValue;
    let args = [];
    for (let str of params) {
        if (typeof str == "string") {
            strValue = str.split("=");
            args.push(strValue);
        }
    }
    return args;
};
module.exports = exports = IHandler;