"use strict";
// const net           = require("net");
// const util          = require("util");
const EventEmitter  = require("events");
const {WSClient}    = require("fxNetSocket");
const {UDPManager}  = require("../../lib/UDP.js");
const NSLog         = require('fxNetSocket').logger.getInstance();
/**
 * websocket客端
 * @constructor
 */
class APIClient extends EventEmitter {
    constructor(delegate) {
        super();
        this.socket   = null;
        this.manager  = delegate.manager;
        this.wDelegate = new WeakMap([[this, delegate]]);
        this.cmode    = 0;
        this.signin   = false;
        this.token    = null;
        this.info     = null;

        this.udpPort  = delegate.configure.wpc.udp.port;
        this.udp      = null; //視訊專用
        this.viewer   = new Set();
        this.logSkip  = new Set(['getServiceInfo', 'getSysInfo']);
    }
    get delegate() {
        if (this.wDelegate.has(this))
            return this.wDelegate.get(this);
        else {
            return null;
        }
    }
    get authEnabled() {
        if (this.delegate.auth) {
            return false;
            // return this.delegate.auth.enabled;
        } else {
            return false;
        }
    }
    /**
     * 開始連線
     * @param socket
     * @return {Promise<void>}
     */
    async connect(socket) {
        this.socket   = socket;
        this.ws = await this.binding(socket);
        NSLog.info(`Connected IP address: ${socket.remoteAddress}`);
        let { ws } = this;
        ws.on('message', data => this.handle(data));
        ws.once("close", () => {
            NSLog.info(`Closed IP address: ${socket.remoteAddress}`);
            this.release();
        });
        ws.once("error", (err) => NSLog.info('err', err));
        ws.pingEnable = false;
        this.ready();
    };
    /**
     * 綁定socket
     */
    async binding(socket) {
        return new Promise((resolve) => {
            let ws = new WSClient(socket, {
                ejection:"socket",
                baseEvtShow: false,
                zlibDeflatedEnabled: false
            }, () => resolve(ws));
        });
    };
    /**
     * 初始化完成
     */
    ready() {
        let { ws } = this;
        if (ws) {
            ws.write({event: 'ready', version: require('../package.json').version, isAuthEnabled: this.authEnabled});
        }
    };
    handle(data) {
        if (typeof data == "string") data = JSON.parse(data);
        const { authEnabled, signin } = this;
        const {action} = data;
        if (authEnabled && !signin && action === "login") {
            this[action](data);
        } else if ((authEnabled ? signin : true) && this[action] instanceof Function) {
            if (!this.logSkip.has(action)) NSLog.info(`[APIClient] action: ${action}`);
            this[action](data);
        } else if (this.handle_v1(data)) {

        } else {
            if (authEnabled && !signin) {
                NSLog.warning(`[APIClient] authentication required.`);
                this.authenticationRequired(data);
            } else {
                NSLog.warning('[APIClient] Not Found %s', action, data);
            }


        }
    };
    handle_v1(data) {
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
    authenticationRequired({tokenId, action}) {
        let respond = {
            tokenId,
            event: action,
            result: false,
            error: 'authenticationRequired',
            message: 'Authentication required. your need to sign in to your Account.'
        };
        this.write(respond);
    }
    async login({tokenId, token}) {
        const auth = this.delegate.auth;
        let respond = {
            tokenId: tokenId,
            event: "login",
            result: false
        };
        if (!token || token == '') return this.write(respond);
        let {result, data} = await auth.jwtVerify(token);
        respond.result = result;
        this.signin = result;
        this.token = token;
        this.write(respond);
    };
    logout(json) {
        this.signin = false;
        let respond = {
            tokenId: json.tokenId,
            event: "logout",
            result: true
        };
        this.write(respond);
    };
    /** 服務資訊 **/
    async getServiceInfo(json) {
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
    async getSysInfo(json) {
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
    };
    async getDashboardInfo(json) {
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
    async lockdownMode(json) {
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
    async liveLog(json) {
        const { logServer } = this.delegate;

        let {
            name,
            bool
        } = (json.data || json);

        if (!this.viewer.has(name)) {
            logServer.join(name, this.ws);
            this.viewer.add(name);
        }
        if (bool == false) {
            logServer.leave(name);
            this.viewer.delete(name);
        }
    };
    async leaveLog(json) {
        const { logServer } = this.delegate;
        let {
            name
        } = (json.data || json);
        logServer.leave(name);
        this.viewer.delete(name);
    };
    /**
     * 新增服務
     * @param json
     * @param json.tokenId
     * @param json.data.file
     * @param json.data.assign
     * @param json.data.memory
     * @param json.data.options
     * @version 2.0.0
     * @return {Promise<void>}
     */
    async addCluster(json) {
        const manager = this.manager;
        const {
            file, assign, memory, options
        } = (json.data || json);
        let params = {
            method: "addCluster",
            file,
            assign,
            mxoss: memory,
            options
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
    async editCluster(json) {
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
    };
    /**
     * 動態刪除指定程序 - 伺服器重啟還會有
     * @param json
     * @param json.tokenId
     * @param json.data
     * @param json.data.pid
     * @return {Promise<void>}
     */
    async killCluster(json) {
        const manager = this.manager;
        let { pid, trash } = (json.data || json);
        let params = {
            method: "killCluster",
            pid,
            trash
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
    async restartCluster(json) {
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
    /**
     * 多個服務重啟
     * @param json
     * @return {Promise<boolean>}
     */
    async restartMultiCluster(json) {
        const manager = this.manager;
        let src = json.data || json;
        let group = src.group.filter((value) => {
            return (typeof Number.parseInt(value) == "number");
        });
        let { delay, deploy } = src;
        let params = {
            method: "restartMultiCluster",
            group,
            delay,
            deploy
        };

        this.queueSteps({
            method: 'restartMultiCluster',
            show: (value) => {
                this.write({
                    event: 'progressSteps',
                    data: {value, target: src.target}
                });
            }
        });

        const {result, data} = await manager.send(params);
        let respond = {
            tokenId: json.tokenId,
            event: "restartMultiCluster",
            result,
            data
        };
        this.write(respond);
    };
    /** send process running kill yourself **/
    async reloadToPID(json) {
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
     * 轉換服務
     * @param json
     * @return {Promise<void>}
     */
    async startWarp(json) {
        const manager = this.manager;
        let data = json.data || json;
        let params = {
            method: "startWarp",
            pid: data.pid,
            params: data.params
        };
        const {result} = await manager.send(params);
        let respond = {
            tokenId: json.tokenId,
            event: "startWarp",
            result
        };
        this.write(respond);
    };
    /** 踢除某子程序使用者接口 **/
    async kickoutToPID(json) {
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
    };
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
    async refuseUser(json) {
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
    async setLBGamePath(json) {
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
    sort(data) {
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
    async getLBGamePath(json) {
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
    async setIPFilter(json) {
        let data = json.data || json;
        let {ip, state, endTime, count, log} = data;
        const manager = this.manager;
        let params = {
            method: "IPBlockList",
            ip,
            state,
            endTime,
            count,
            log
        };
        const {result} = await manager.send(params);
        let respond = {
            tokenId: json.tokenId,
            event: "setIPFilter",
            result
        };
        this.write(respond);
    };
    async getIPFilter(json) {
        const manager = this.manager;
        let params = {
            method: "readIPBlockList"
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
    async setLogLevel(json) {
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
    async getAMFConfig(json) {
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
    async setAMFConfig(json) {
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
    async addSchedule(json) {
        const manager = this.manager;
        const {result, data} = await manager.send({method: "addSchedule", data: json.data});
        let respond = {
            tokenId: json.tokenId,
            event: "addSchedule",
            result,
            data
        }
        this.write(respond);
    };
    /**
     * 取得:排程清單
     * @param json
     * @return {Promise<void>}
     */
    async getSchedule(json) {
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
     * @param json.tokenId
     * @param json.data.id
     * @return {Promise<void>}
     * @version 2.0.0
     */
    async cancelSchedule(json) {
        const {manager} = this;
        let params = {
            method: "cancelSchedule",
            id: json.data.id
        };
        const {result, data} = await manager.send(params);
        let respond = {
            tokenId: json.tokenId,
            event: "cancelSchedule",
            data,
            result
        };
        this.write(respond);
    };
    /** process溝通通道 **/
    async ipcMessage(json) {
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
    async getMetadata(json) {
        const { manager } = this;
        let params = {
            method: "metadata"
        };
        const {result} = await manager.send(params);

        let respond = {
            tokenId: json.tokenId,
            event: "getMetadata",
            result
        };
        this.write(respond);
    };
    async blockAll(json) {
        const { manager } = this;
        let data = json.data || json;
        let params = {
            method: "blockAll",
            bool: data.bool
        };
        const {result} = await manager.send(params);

        let respond = {
            tokenId: json.tokenId,
            event: "blockAll",
            result
        };
        this.write(respond);
    };
    async warpTunnel(json) {
        const { manager } = this;
        let data = json.data || json;
        let params = {
            method: "warpTunnel",
            params: data
        };
        const {result} = await manager.send(params);
        let respond = {
            tokenId: json.tokenId,
            event: "warpTunnel",
            result
        };
        this.write(respond);

    }
    /** [UDP only] 建立udp **/
    async createUDPManager(json) {
        let udp;
        if (!this.udp) {
            udp = new UDPManager(this, this.udpPort);
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
    async handoffMediaData(json) {
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
    getWorkServices(json) {
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
    async mediaSaveFile(json) {
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
    udpEstablish(json) {
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
    queueSteps({method, show}) {
        const { manager } = this;
        manager.joinSteps({method, show});
    };
    setManager(manager) {
        this.manager = manager;
    };
    write(data) {
        if (this.cmode == 0) {
            this.ws.write(data);
        }
    };
    release() {
        if (this.udp) this.udp.release();
        if (!this.delegate) return false;
        if (this.viewer) {
            const { logServer } = this.delegate;
            this.viewer.forEach((value) => logServer.leave(value));
            this.viewer.clear();
        }
        let { delegate } = this;
        delegate.liecounts = Math.max(--delegate.liecounts, 0);
        return true;
    };
}
module.exports = exports = APIClient;