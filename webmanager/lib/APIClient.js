"use strict";
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const WSClient      = require("fxNetSocket").WSClient;
const {UDPManager}  = require("../../lib/UDP.js");
const NSLog         = require('fxNetSocket').logger.getInstance();
/**
 *
 * @constructor
 */
class APIClient extends EventEmitter {
    constructor(socket, delegate) {
        super();
        this.socket   = socket;
        this.manager  = delegate.manager;
        this.delegate = delegate;
        this.cmode    = 0;
        this.signin   = true;
        this.info     = null;
        this.udp      = null; //視訊專用
        this.ws       = this.setup(socket);
    }

}
APIClient.prototype.setup = function (socket) {
    const self = this;
    const ws = new WSClient(socket, {
        ejection:"socket",
        baseEvtShow: false,
        zlibDeflatedEnabled: false
    }, () => {
        console.log('connected');
        this.ready();
    });
    ws.on('message', this.handle.bind(this));
    ws.once("close", () => {
        console.log('client closed');
        this.release();
    });
    ws.once("error", (err) => {
        console.log('err');
    });
    ws.pingEnable = false;
    return ws;
};
APIClient.prototype.ready = function () {
    this.ws.write({event: 'ready', version: require('../package.json').version});
}
APIClient.prototype.handle = function (data) {
    if (typeof data == "string") data = JSON.parse(data);
    const {action} = data;
    if (!this.signin && action === "login") {
        this[action](data);
    } else if (this.signin && this[action] instanceof Function) {
        console.log(`[APIClient] action: ${action}`);
        this[action](data);
    } else if (this.handle_v1(data)) {

    } else {
        console.log('[APIClient] Not Found %s', action, data);
    }
};
APIClient.prototype.handle_v1 = function (data) {
    if (typeof data.event != "undefined") {
        //舊API
        switch (data.event) {
            case "liveLog":
                this[data.event]({ name: data.data[0]});
                break;
            case 'leaveLog':
                this[data.event]({ name: data.data[0]});
                break
            default:
                return false;
        }
        return true;
    } else {
        return false;
    }
};
APIClient.prototype.login = async function (json) {
    const auth = this.delegate.auth;
    let {result, data} = await auth.jwtVerify(json.token);
    let respond = {
        tokenId: json.tokenId,
        event: "login",
        result
    };
    this.signin = result;
    this.write(respond);
};
APIClient.prototype.logout = function (json) {
    this.signin = false;
    let respond = {
        tokenId: json.tokenId,
        event: "logout",
        result: true
    };
    this.write(respond);
}
/** 服務資訊 **/
APIClient.prototype.getServiceInfo = async function (json) {
    const manager = this.manager;
    let params = {
        method: "getServiceInfo"
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "getServiceInfo",
        result,
        data
    };
    this.write(respond);
};
APIClient.prototype.getSysInfo = async function (json) {
    const manager = this.manager;
    let params = {
        method: "getSysInfo"
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "getSysInfo",
        result,
        data: data.sysInfo
    };
    this.write(respond);
}
APIClient.prototype.getDashboardInfo = async function (json) {
    const manager = this.manager;
    let params = {
        method: "getDashboardInfo"
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "getDashboardInfo",
        result,
        data: data
    };
    this.write(respond);
};
APIClient.prototype.lockdownMode = async function (json) {
    const manager = this.manager;
    let params = {
        method: "lockdownMode",
        bool: json.bool
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "lockdownMode",
        result
    };
    this.write(respond);
};
APIClient.prototype.liveLog = async function (json) {
    console.log(json);
    const logServer = this.delegate.logServer;
    logServer.setClient(json.name, this.ws);
};
APIClient.prototype.leaveLog = async function (json) {
    console.log(json);
    const logServer = this.delegate.logServer;

};
/** 新增服務
 *
 * @param json
 * @param json.tokenId
 * @param json.data.file
 * @param json.data.assign
 * @param json.data.memory
 * @param json.data.options
 * @version 2.0.0
 * @return {Promise<void>}
 */
APIClient.prototype.addCluster = async function (json) {
    const manager = this.manager;
    const {
        file, assign, memory, options
    } = (json.data || json);
    let params = {
        method: "addCluster",
        file,
        assign,
        mxoss: memory,
        options: options
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "addCluster",
        result
    };
    this.write(respond);
};
/**
 * 編輯指定名單規則
 * @param json
 * @return {Promise<void>}
 */
APIClient.prototype.editCluster = async function (json) {
    const manager = this.manager;
    let {
        oAssign,
        nAssign,
        pid,
        options
    } = (json.data || json);
    let params = {
        method: "editCluster",
        oldName: oAssign,
        newName: nAssign,
        pid,
        options: options
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "editCluster",
        result
    };
    this.write(respond);
}
/**
 * 動態刪除指定程序 - 伺服器重啟還會有
 * @param json
 * @param json.tokenId
 * @param json.data
 * @param json.data.pid
 * @return {Promise<void>}
 */
APIClient.prototype.killCluster = async function (json) {
    const manager = this.manager;
    let { pid } = (json.data || json);
    let params = {
        method: "killCluster",
        pid: pid
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "killCluster",
        result
    };
    this.write(respond);
};
/** 動態重啟指定程序名稱 - 伺服器重啟就無效 **/
APIClient.prototype.restartCluster = async function (json) {
    const manager = this.manager;
    let data = json.data || json;
    let params = {
        method: "restartCluster",
        pid: data.pid,
        name: data.name,
        gracefully: data.gracefully
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "restartCluster",
        result
    };
    this.write(respond);
};
APIClient.prototype.restartMultiCluster = async function (json) {
    const manager = this.manager;
    let src = json.data || json;
    let group = src.group.filter((value) => {
        return (typeof value == "number");
    });
    let params = {
        method: "restartCluster",
        group
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "restartCluster",
        result,
        data
    };
    this.write(respond);
};
/** send process running kill yourself **/
APIClient.prototype.reloadToPID = async function (json) {
    const manager = this.manager;
    let data = json.data || json;
    let params = {
        method: "reloadToPID",
        pid: data.pid,
        params: data.params
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "reloadToPID",
        result
    };
    this.write(respond);
};
/**
 * 熱更新
 * @param json
 * @return {Promise<void>}
 */
APIClient.prototype.hotReload = async function (json) {
    const manager = this.manager;
    let data = json.data || json;
    let params = {
        method: "hotReload",
        pid: data.pid,
        params: data.params
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "hotReload",
        result
    };
    this.write(respond);
};
/** 踢除某子程序使用者接口 **/
APIClient.prototype.kickoutToPID = async function (json) {
    const manager = this.manager;
    let data = json.data || json;
    let params = {
        method: "kickoutToPID",
        pid: data.pid,
        trash: (data.trash == true),
        params: data.params
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "kickoutToPID",
        result
    };
    this.write(respond);
}
/**
 * 該服務關閉禁止使用者連入
 * @param json
 * @param json.tokenId
 * @param json.data
 * @param json.data.pid
 * @param json.data.trash
 * @param json.data.lock
 * @return {Promise<void>}
 */
APIClient.prototype.refuseUser = async function (json) {
    const manager = this.manager;
    let data = json.data || json;

    let params = {
        method: "clusterLockEnabled",
        pid: data.pid,
        trash: (data.trash == true),
        type: (data.pid ? 'pid' : 'assign'),
        lock: data.lock
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "refuseUser",
        result
    };
    this.write(respond);
};
/** load Balancer config **/
APIClient.prototype.setLBGamePath = async function (json) {
    const manager = this.manager;
    let data = this.sort(json.data);
    const {result} = await manager.send({method: "setLBGamePath", data: data});
    let respond = {
        tokenId: json.tokenId,
        event: "setLBGamePath",
        result
    };
    this.write(respond);
};
/** 資料排序 **/
APIClient.prototype.sort = function (data) {
    let keys = Object.keys(data);
    //字母排序
    let sort = keys.sort();
    let key;
    let sortObject = {};
    for (let s = 0; s < sort.length; s++) {
        key = sort[s];
        sortObject[key] = data[key];
    }
    return sortObject;
};
/**
 * 設定 LoadBalance.json
 * @apiParam json
 */
APIClient.prototype.getLBGamePath = async function (json) {
    const manager = this.manager;
    const {result, data} = await manager.send({method: "getLBGamePath"});
    let respond = {
        tokenId: json.tokenId,
        event: "getLBGamePath",
        result,
        data
    };
    this.write(respond);
};
APIClient.prototype.setIPFilter = async function ({tokenId, ip, state, endTime, count, log}) {
    const manager = this.manager;
    let params = {
        method: "setIPFilter",
        ip: ip,
        state: state,
        endTime: endTime,
        count: count,
        log: log
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: tokenId,
        event: "setIPFilter",
        result
    };
    this.write(respond);
};
APIClient.prototype.getIPFilter = async function (json) {
    const manager = this.manager;
    let params = {
        method: "getIPFilter"
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "getIPFilter",
        result,
        data
    };
    this.write(respond);
};
/** 修改顯示的log **/
APIClient.prototype.setLogLevel = async function (json) {
    const manager = this.manager;
    let data = json.data || json;
    let params = {
        method: "setLogLevel",
        pid: data.pid,
        params: {
            lv: data.lv
        }
    }
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "setLogLevel",
        result
    };
    this.write(respond);
};
/** 讀取機器對應flash2db **/
APIClient.prototype.getAMFConfig = async function (json) {
    const manager = this.manager;
    const {result, data} = await manager.send({method: "getAMFConfig"});
    let respond = {
        tokenId: json.tokenId,
        event: "getAMFConfig",
        data: data,
        result
    };
    this.write(respond);
};
/** 修改機器對應flash2db **/
APIClient.prototype.setAMFConfig = async function (json) {
    const manager = this.manager;
    const {result} = await manager.send({method: "setAMFConfig", data: json.data});
    let respond = {
        tokenId: json.tokenId,
        event: "setAMFConfig",
        result
    }
    this.write(respond);
};
/**
 * 新增:排程
 * @param json
 * @return {Promise<void>}
 */
APIClient.prototype.addSchedule = async function (json) {
    const manager = this.manager;
    const {result} = await manager.send({method: "addSchedule", data: json.data});
    let respond = {
        tokenId: json.tokenId,
        event: "addSchedule",
        result
    }
    this.write(respond);
};
/**
 * 取得:排程清單
 * @param json
 * @return {Promise<void>}
 */
APIClient.prototype.getSchedule = async function (json) {
    const {manager} = this;
    let params = {
        method: "getSchedule"
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "getSchedule",
        data,
        result
    };
    this.write(respond);
};
/**
 * 取消:排程
 * @param tokenId
 * @param id
 * @return {Promise<void>}
 * @version 2.0.0
 */
APIClient.prototype.cancelSchedule = async function ({tokenId, id}) {
    const {manager} = this;
    let params = {
        method: "cancelSchedule",
        id
    };
    const {result, data} = await manager.send(params);
    let respond = {
        tokenId,
        event: "cancelSchedule",
        data,
        result
    };
    this.write(respond);
};
/** process溝通通道 **/
APIClient.prototype.ipcMessage = async function (json) {
    const manager = this.manager;
    let data = json.data || json;
    let params = {
        method: "ipcMessage",
        pid: data.pid,
        params: data.params
    };
    const {result} = await manager.send(params);
    let respond = {
        tokenId: json.tokenId,
        event: "ipcMessage",
        result
    };
    this.write(respond);
};
/** [UDP only] 建立udp **/
APIClient.prototype.createUDPManager = async function (json) {
    let udp;
    if (!this.udp) {
        udp = new UDPManager(this, 8080);
        this.udp = udp;
    } else {
        udp = this.udp
    }
    const group = await udp.ready()
    NSLog.log("debug", "UDP address ready: ", group);
    udp.group = group;
    udp.on('log', (json) => {
        this.write({
            event: "udplog",
            data: json.data,
            address: json.address
        });
    });
    let respond = {
        tokenId: json.tokenId,
        event: 'createUDPManager',
        status: true,
        group
    };
    this.write(respond);
};
/**
 * [UDP only]更換視訊ip source
 * @param json
 * @param json.tokenId
 * @param json.list 多筆
 * @param json.address 單筆
 * @param json.host
 * @param json.port
 * @return {Promise<Object>}
 */
APIClient.prototype.handoffMediaData = async function (json) {
    let respond = {
        event: 'handoffMediaData',
        tokenId: json.tokenId,
        result: false
    }
    if (this.udp) {
        let {list, address, host, port} = json;

        let group = Array.isArray(list) ? list : [];

        if (typeof address == "string") group.push(address);

        NSLog.log("info", `HandoffMediaData:
        > broadcast: ${group.toString()}
        > switch to ${host}:${port}`);
        let result = new Map();
        let adrs;
        for (let i = 0; i < group.length; i++) {
            adrs = group[i];
            let {res} = await this.udp.startHandoff({ address, host, port });
            result.set(adrs, res);
        }
        respond.list = [ ...result ];
        respond.result = true;
    } else {
        respond.error = "not a available";
    }
    this.write(respond);
};
/** [UDP only] **/
APIClient.prototype.getWorkServices = function (json) {
    let respond = {
        event: 'getWorkServices',
        tokenId: json.tokenId,
        result: false,
    }
    if (this.udp) {
        respond.data = this.udp.getClients();
        respond.result = true;
    } else {
        respond.error = "not a available";
    }
    this.write(respond);
};
APIClient.prototype.mediaSaveFile = async function (json) {
    let respond = {
        event: 'mediaSaveFile',
        tokenId: json.tokenId,
        result: false
    }
    const { udp } = this;
    if (!this.udpEstablish(json)) return false;
    let { filename, data, list } = json;

    NSLog.log("info", `mediaSaveFile:
        > broadcast: ${list.toString()}`);

    let result = new Map();
    let address;
    for (let i = 0; i < list.length; i++) {
        address = list[i];
        let {res} = await udp.saveFile({ address, filename, data });
        result.set(address, res);
    }
    respond.list = [ ...result ];
    respond.result = true;
    this.write(respond);
};
/**
 * 檢查manager服務是否建立
 * @param json
 * @return {boolean}
 */
APIClient.prototype.udpEstablish = function (json) {
    let respond = {
        event: json.action,
        tokenId: json.tokenId,
        result: false
    }
    const { udp } = this;
    if (udp) {
        return true;
    } else {
        respond.error = "not a available";
    }
    this.write(respond);
    return false;
};


APIClient.prototype.setManager = function (manager) {
    this.manager = manager;
};
APIClient.prototype.write = function (data) {
    if (this.cmode == 0) {
        this.ws.write(data);
    }
};
APIClient.prototype.release = function () {
    if (this.udp) this.udp.release();
};

module.exports = exports = APIClient;