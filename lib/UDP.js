"use strict";
const crypto        = require("crypto");
const dgram         = require("dgram");
const util          = require("util");
const path          = require("path");
const fs            = require("fs");
const os            = require("os");
const EventEmitter  = require("events");
const MULTICAST_ADDR = "224.0.1.2";
const key = crypto.randomBytes(4).toString("hex");
/**
 * 實作UDP通道
 * @delegate
 * @options
 * @constructor
 */
class UDP extends EventEmitter {
    constructor(delegate, options) {
        super();
        this.delegate = delegate;
        this._token = 0;
        this.blocks = new Map();
        this.acceptClients = new Map();
        this.settings = {};
        this.setup();
        this.isPrimary = false;
        this.options = options || {
            port: 8080,
            soBroadcast: true,
            multicastTTL: 2,
            multicastAddr: MULTICAST_ADDR,
            bind: options.bind || true
        };
        this.receiver = this.createReceived(this.options);
    }
}
/**
 * 設定
 */
UDP.prototype.setup = function () {
    Object.defineProperties(this, {
        token: {
            get() {
                return key + "-" + ++this._token;
            },
            enumerable: false,
            configurable: false
        }
    });
};
/**
 * 監聽接收資料
 * @param options
 * @return {Object<dgram.Socket>}
 */
UDP.prototype.createReceived = function (options) {
    const receiver = dgram.createSocket("udp4");
    receiver.on("listening", () => {
        const address = receiver.address();
        console.log("listening udp:", address);
        receiver.setBroadcast(options.soBroadcast);
        receiver.setMulticastTTL(options.multicastTTL);
    });
    receiver.on('message', (buf, remoteInfo) => {
        console.log("#Receiver - %s:%s data:", remoteInfo.address, remoteInfo.port, buf.toString());
        this.receiveMessage(buf.toString(), remoteInfo);
    });
    if (options.bind == false) return receiver;
    receiver.bind(options.port, function () {
        receiver.addMembership(options.multicastAddr); // Add the HOST_IP_ADDRESS for reliability
    });
    return receiver;
};
/**
 * 收到資訊
 * @param {String} data
 * @param {string} address
 * @param {string} family
 * @param {number} port
 */
UDP.prototype.receiveMessage = function (data, {address, family, port}) {
    try {
        let json = JSON.parse(data);
        if (json.action) console.log(' |- receiveMessage - action: %s', json.action);
        //回應事件
        if (json.tokenId && this.blocks.has(json.tokenId)) {
            console.log(' |- receiveMessage - blocks: %s', json.tokenId);
            this.blocks.get(json.tokenId)(json, arguments[1]);
        } else if (json.action === "accepted") {
            this.accepted(json, {port, address});
        } else if (json.action === "onAccepted") {
            this.onAccepted(json, {port, address});
        } else if (json.action === "log") {
            this.emit("log", json.data, arguments[1]);
        } else {
            this.emit("message", json, arguments[1]);
        }
    } catch (e) {
        console.log(`data: ${data}`);
        console.error(e);
    }
}
/**
 * 廣播取得所有客端
 */
UDP.prototype.ready = function () {
    let json = {
        action: "accepted"
    };
    let data = Buffer.from(JSON.stringify(json));
    this.sendMulticast(data, this.options.port, MULTICAST_ADDR);
    this.isPrimary = true;
}
/**
 * 回應接受到事件
 * @param data
 * @param address
 * @param port
 */
UDP.prototype.respond = function ({data, port, address}) {
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    console.log('respond - port: %s, address: %s', port, address);
    this.receiver.send(buf, 0, buf.byteLength, port, address);
}
/**
 * 廣播訊息到指定port
 * @param {String|Buffer} message
 * @param {Number} port
 * @param {String} [multicastAddr]
 */
UDP.prototype.sendMulticast = function (message, port, multicastAddr) {
    const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
    let address = multicastAddr || MULTICAST_ADDR;
    this.receiver.send(buf, 0, buf.length, port, address);
};
/**
 * Peer To Peer
 * @param json
 * @param port
 * @param address
 */
UDP.prototype.callAsync = function (json, port, address) {
    let tokenId = this.token;
    let task = Object.assign({tokenId: tokenId}, json);
    let data = JSON.stringify(task);
    return new Promise((resolve, reject) => {
        this.blocks.set(tokenId, (arg1, arg2) => {
            resolve(arg1, arg2);
            this.blocks.delete(tokenId);
        });
        this.respond({data, port, address});
    });
};
/**
 * 接收到accepted事件<br>
 * 回傳是否接受
 * @param content
 * @param address
 * @param port
 */
UDP.prototype.accepted = function (content, {port, address}) {
    let json = {
        action: "onAccepted",
        hostname: os.hostname(),
        accept: true,
        settings: this.settings
    };
    let data = Buffer.from(JSON.stringify(json));
    this.respond({data, port, address});
};
/**
 * 接收onAccepted回傳事件
 * @param hostname
 * @param accept
 * @param settings
 * @param port
 * @param address
 */
UDP.prototype.onAccepted = function ({hostname, accept, settings}, {port, address}) {
    if (!accept) return false;
    let item =  {
        hostname: hostname,
        port: port,
        address: address,
        settings: settings
    };
    this.acceptClients.set(address, item);
    this.emit("ready", item);
};
UDP.prototype.log = function (log, {port, address}) {
    let json = {
        action: "log",
        data: log
    };
    let data = Buffer.from(JSON.stringify(json));
    this.respond({data, port, address});
}
UDP.prototype.saveFile = function (json) {
    if (!json) {
        console.log('param invalid', json);
        return false;
    }
    const filename = json.filename;
    const filepath = path.resolve(process.cwd(), "../configuration/" + filename + ".json");
    try {
        // let fileData = JSON.parse(fs.readFileSync(filepath).toString());
        // console.log("File '%s' begin save...", filename);

        fs.writeFileSync(filepath, JSON.stringify(json.data, null, '\t'));
        console.log('done');
    } catch (e) {
        return false;
    }

    return true;
};
UDP.prototype.loadFile = function (json) {
    if (!json) {
        return {event: false, error: 'param invalid'};
    }
    const filename = json.filename;
    const filepath = path.resolve(process.cwd(), "../configuration/" + filename + ".json");
    try {
        if (!fs.existsSync(filepath)) return { event: false, error: 'not exists'};
        let data = JSON.parse(fs.readFileSync(filepath).toString());
        return { event: true, data };
    } catch (e) {
        return { event: false, error: e.message };
    }
}
UDP.prototype.clean = function () {

};
UDP.prototype.release = function () {
    this.receiver.close();
};

/***
 * 控制端
 * @param delegate
 * @param port
 * @constructor
 */
function UDPManager(delegate, port) {
    EventEmitter.call(this);
    this.delegate = delegate;
    this.udp = new UDP(this, {
        port: port || 8080,
        soBroadcast: true,
        multicastTTL: 2,
        multicastAddr: MULTICAST_ADDR,
        bind: false //多人使用動態產生port
    });
}
util.inherits(UDPManager, EventEmitter);
UDPManager.prototype.ready = function () {
    return new Promise((resolve) => {
        let group = [];
        this.udp.on('ready', ({ hostname, port, address, settings }) => {
            // this.emit("ready", address);
            // this.getFile("MediaSetting", address);
            group.push([hostname, port, address, settings]);
            console.log(`${this.constructor.name} ready: ${address}` );
        });
        this.udp.on('log', (data, {port, address}) => {
            this.emit("log", {data, address});
        });
        this.udp.on('message', (json, {address, family, port, size}) => {
            console.log('UDPManager', json);
        })
        setTimeout((element) => {
            resolve(group);
        }, 1000);
        this.udp.ready();
    });
}
/**
 * 取得服務清單
 * @return {any[]}
 */
UDPManager.prototype.getClients = function () {
    return [...this.udp.acceptClients.values()];
}
/**
 * 取得設定檔案
 * @param filename
 * @param address
 * @return {Promise<Object>}
 */
UDPManager.prototype.getFile = async function (filename, address) {
    const bool = this.udp.acceptClients.has(address);
    if (!bool) return false;
    let { port } = this.udp.acceptClients.get(address);
    const data = await this.udp.callAsync({
        action: "getFile",
        filename: filename || "MediaSetting"
    }, port, address);
    console.log(' |---- sendGetFile: ', data);
    return data;
}
/**
 * 儲存設定檔案
 * @param address
 * @param filename
 * @param data
 * @return {Promise<Object>}
 */
UDPManager.prototype.saveFile = async function ({address, filename, data}) {
    const bool = this.udp.acceptClients.has(address);
    if (!bool) return false;
    let { port } = this.udp.acceptClients.get(address);
    return await this.udp.callAsync({
        action: "saveFile",
        filename: filename,
        data: data
    }, port, address);
};
/**
 * 通知轉換視訊Origin
 * @param address UDP-服務位址
 * @param host 更換位址
 * @param port 更換port
 * @return {Promise<Object>}
 */
UDPManager.prototype.startHandoff = async function ({address, host, port}) {
    const bool = this.udp.acceptClients.has(address);
    if (!bool) return { res: false };
    let iPort = this.udp.acceptClients.get(address).port;
    return await this.udp.callAsync({
        action: "handoff",
        port: port,
        host: host
    }, iPort, address);
};
/**
 * 移除
 */
UDPManager.prototype.release = function () {
    if (this.udp) this.udp.release();
}

/**
 * 客端
 * @param delegate
 * @param port
 * @constructor
 */
function UDPClient(delegate, port) {
    this.delegate = delegate;
    this.udp = this.setup(port);

    let {event, data} = this.udp.loadFile({ filename: "MediaSetting" });
    if (event) {
        this.udp.settings.mediaSetting = data;
    } else {
        this.udp.settings.mediaSetting = {};
    }
}
UDPClient.prototype.setup = function (port) {
    const main = new UDP(this, {
        port: port || 8080,
        soBroadcast: true,
        multicastTTL: 2,
        multicastAddr: MULTICAST_ADDR
    });
    main.on('message', (json, {address, family, port, size}) => {
        if (this[json.action]) {
            this[json.action].apply(this, [json, {port, address}]);
        } else {
            console.log(`'${json.action}' not found.`);
        }
    });
    return main;
}
UDPClient.prototype.getFile = function (json, {port, address}) {
    const udp = this.udp;
    let file = {};
    if (json.filename) {
        let {event, data} = udp.loadFile(json);
        if (event) file = data;
    } else {
        console.log(`'${json.action}' filename is null.`);
    }
    let res = {
        action: "onGetFile",
        tokenId: json.tokenId,
        data: file
    };
    let data = JSON.stringify(res);
    udp.respond({data, port, address});
};
/**
 *
 * @param json
 * @param json.tokenId
 * @param json.filename
 * @param json.data
 * @param port
 * @param address
 */
UDPClient.prototype.saveFile = function (json, {port, address}) {
    const udp = this.udp;
    let res = udp.saveFile({
        filename: json.filename,
        data: json.data
    });
    let data = JSON.stringify({
        action: "onGetFile",
        tokenId: json.tokenId,
        data: res
    });
    udp.respond({data, port, address});
};
/**
 * 交接服務host, port
 * @param json 參數
 * @param json.tokenId
 * @param json.host 轉換來源位址
 * @param json.port 轉換來源埠
 * @param port 通道來源埠
 * @param address 通道來源位址
 * @return {Promise<boolean>}
 */
UDPClient.prototype.handoff = async function (json, {port, address}) {
    const udp = this.udp;
    const brokerHost = json.host;
    const brokerPort = json.port || 80;
    const filename = "MediaSetting";
    let data = udp.loadFile({filename: filename});
    let res = true;
    if (data != false || data.event != false) {
        let broker = data['broker'];
        let prevHost  = broker.host;
        let prevPort  = broker.port;
        broker.host = brokerHost;
        broker.port = brokerPort;
        console.log(data);
        udp.saveFile({ filename, data });

        //開始執行重啟
        console.log('Start handoff connection while switching from %s:%s to %s:%s', prevHost, prevPort, brokerHost, brokerPort);
    } else {
        console.log(`Handoff.loadFile failed: ${filename}`);
        res = false;
    }

    if (!this.delegate &&
        !(this.delegate.handoffService instanceof Function)) {
        res = false;
    }
    if (res) {
        this.delegate.handoffService({
            name: "agent",
            host: brokerHost,
            port: brokerPort
        }, {port, address});
    }
    udp.respond({
        data:JSON.stringify({
            tokenId: json.tokenId,
            res: res}
        ), port, address});
}
UDPClient.prototype.record = function (data, {port, address}) {
    console.log('record', arguments);
    const udp = this.udp;
    if (udp) {
        udp.log(data, {port, address});
    }
};

module.exports = exports = {
    UDP, UDPManager, UDPClient
};
// const cli = new UDPClient(this, 8080);
// const manager = new UDPManager(this, 8080);






