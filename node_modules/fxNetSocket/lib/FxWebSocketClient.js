"use strict";
/**
 * Created by Benson.Liao on 2016/4/14.
 * @file
 * @module FxWebSocketClient
 * @version 2.0.0
 */
const util = require('util');
const utility = require('./FxUtility.js');
const fxSocket = require('./FxSocket.js');
const events = require('events');
const fxStatus = require('./FxEnum.js').fxStatus;
const Versions = require('./FxEnum.js').Versions;
util.inherits(FxWebSocketClient, events.EventEmitter); // 繼承事件
/**
 * 處理ws, socket, flash socket連線客端
 * @param {module:net.Socket} socket
 * @param {Object|function} option 設定參數
 * @param {Object} option.zlibDeflatedEnabled 設定參數
 * @param {Boolean} option.fourWayHandshake fin
 * @param {function=} cb 回傳連線成功事件
 * @exports FxWebSocketClient
 * @constructor
 */
function FxWebSocketClient(socket, option, cb) {
    events.EventEmitter.call(this);
    /** @property {Boolean} nPingPong 內建 ping pong 機制 */
    this.nPingPong = false;
    this.splitsReceiveLimitCount = 100;
    if (typeof cb == "undefined" && option instanceof Function) {
        cb = option;
        option = {};
    }
    let fourWayHandshake = (option.fourWayHandshake == true);
    const client = new fxSocket(socket, {
        delegate: this,
        zlibDeflatedEnabled: option.zlibDeflatedEnabled,
        baseVersion: option.baseVersion,
        finTCP: fourWayHandshake
    });
    this._client = client;

    this.setupProps();

    if (typeof option == "object" && option instanceof Object) {
        if (typeof option["binaryType"] == "string") this.setBinaryType(option["binaryType"]);
        if (typeof option.binary == "boolean") this.forcedBinary = option.binary;
        if (typeof option.baseEvtShow == "boolean") client.baseEvtShow = (option.baseEvtShow == true);
        if (typeof option["splitsReceiveLimitCount"] == "number") this.splitsReceiveLimitCount = option.splitsReceiveLimitCount;
        else this.splitsReceiveLimitCount = 50;
        if (typeof option.nativePingPong == "boolean") this.nPingPong = option.nativePingPong;
        if (option.baseVersion == Versions.v2) client.revicerDelegate(this);
    }
    const self = this;
    socket.once('data', function (data) {
        const mode = utility.findOutSocketConnected(client, data, this);
        client.isConnect = true;
        addUpdateData(mode, client);
        client.emit("connect");
        if (this.nPingPong) client.write(undefined, 9);
        if (cb) cb();
    }.bind(this));
    /**
     * 確定連線後連線資料事件並傳出data事件
     * @param mode 型態(fxStatus)
     * @param client 來源socket
     */
    function addUpdateData(mode, client) {
        self.mode = mode;
        if (typeof option == "object" && typeof option.ejection != "undefined" && option.ejection.indexOf(mode) != -1) {
            self._client.close();
            return;
        }
        //console.log('version:%s, zlibDeflatedEnabled:%s', client.baseVersion, client.zlibDeflatedEnabled);
        if (mode !== fxStatus.websocket || client.zlibDeflatedEnabled == false) {
            socket.on('data', function (data) {
                getData(data, mode);
            });
        } else {
            socket.pipe(client.revicer.reader);
            client.sender.pipe(socket);
        }

    };
    let count = 0;
    let chunkBuffer = Buffer.from([]);
    let first = false;
    function getData(chunk, mode) {
        if (typeof chunkBuffer == "undefined" || chunkBuffer.length <= 0) {
            chunkBuffer = Buffer.from(chunk);
        } else {
            chunkBuffer = Buffer.concat([chunkBuffer, chunk], chunkBuffer.length + chunk.length);
        }
        let data;
        let currSize = chunkBuffer.length;
        if (mode === fxStatus.websocket) {
            count = 0;
            while (chunkBuffer.length > 0 && count < self.splitsReceiveLimitCount) {
                count++;
                let obj = client.read(chunkBuffer);
                if (obj.total > chunkBuffer.length) {
                    return;
                }
                if (typeof obj == "undefined") obj = {opcode:8};
                data = obj.msg;
                if(obj.opcode == 8)
                {
                    return client.close(client.createCloseStatusCode({code: 1000, reason: ''}));
                }

                chunkBuffer = chunkBuffer.slice(client.protocol.total, chunkBuffer.length);

                if (currSize == chunkBuffer.length) {
                    chunkBuffer = chunkBuffer.slice(chunkBuffer.length, chunkBuffer.length);
                } else {
                    currSize = chunkBuffer.length;
                }
                if (obj.fin === false) {
                    self.emit("error2", "obj.fin === false");
                    continue;
                }
                if (client.encryption == "aes-256-cbc") {
                    data = client.decryption(data);
                }
                if (client.pingEnable == true && self.recordPing(client, data) == true) continue;
                self.emit("data", obj.binary);
                try {
                    if (typeof data != "undefined") self.emit('message', data);
                } catch (e) {
                    let d = "";
                    if (data == "[object Uint8Array]") {
                        client.close();
                    } else {
                        self.emit("error2", "FxWebSocketClient::LEN(" + data.length + String(data) + ")," + "\n" + e.toString());
                    }
                }
            }
            if (count === self.splitsReceiveLimitCount) {
                self.emit("error", util.format("Splits the received ByteBufs on limit max count %s.", self.splitsReceiveLimitCount));
                client.close();
                chunkBuffer = undefined;
            }
            return;
        } else if (mode === fxStatus.flashSocket) {
            self.emit("data", chunk);
            let offset = chunkBuffer.indexOf("\0");
            while (offset != -1) {
                data = chunkBuffer.slice(0, offset);
                chunkBuffer = chunkBuffer.slice(offset+1, chunkBuffer.length);
                offset = chunkBuffer.indexOf("\0");
                if (client.pingEnable == true && self.recordPing(client, data) == true) continue;

                if (typeof data != "undefined") self.emit('message', data.toString());
                data = undefined;
            }
            return;

        } else if (mode === fxStatus.socket) {
            data = chunkBuffer.toString('utf8');
            chunkBuffer = undefined;
        } else {
            chunkBuffer = undefined;
        }
        self.emit("data", chunk);
        if (client.pingEnable == true && self.recordPing(client, data) == true) return;
        if (typeof data != "undefined") self.emit('message',data);
    }
    socket.on('close',  function () {
        if (client.revicer) {
            socket.unpipe(client.revicer.reader);
            client.revicer.release();
        }
        if (client.sender) {
            client.sender.unpipe(socket);
            client.sender.release();
        }
        self.emit('close');
    });
    socket.on('end',    function () {
        self.emit('end');
    });
    socket.on('error',  function (err) {
        self.emit('error',err);
    });
    self.on("error", function (err) {});

};
FxWebSocketClient.prototype.setupProps = function () {
    const client = this._client;
    Object.defineProperties(this, {
        "originAddress": {
            get:function () { return client.originAddress; },
            configurable: false,
            enumerable: false
        },
        "forwarded": {
            get:function () {
                return client.forwarded;
            },
            configurable: false,
            enumerable: false
        },
        "headers": {
            get:function () { return client.headers; },
            configurable: false,
            enumerable: false
        },
        /**
         * @property {Boolean} authorized 結束是否處理四方交握協定
         * @name FxWebSocketClient#authorized
         * @version 1.0.0
         */
        "authorized": {
            get: function () {
                return client.authorized;
            },
            configurable: false,
            enumerable: false
        },
        /**
         * @property {Boolean} fourWayHandshake 結束是否處理四方交握協定
         * @name FxWebSocketClient#fourWayHandshake
         * @version 1.0.0
         */
        "fourWayHandshake": {
            set:function (val) {
                if (typeof val != "boolean") return;
                client.finTCP = val;
            },
            get: function () {
                return client.finTCP;
            },
            configurable: false,
            enumerable: false
        },
        /**
         * @property {Boolean} forcedBinary 設定是否傳送Buffer資料
         * @name FxWebSocketClient#forcedBinary
         * @version 2.0.0
         */
        "forcedBinary": {
            set: function (value) {
                if (typeof value == "boolean") {
                    client.forcedBinary = value;
                }
            },
            get: function () {
                return client.forcedBinary;
            },
            configurable: false,
            enumerable: false
        },
        /**
         * @property {Boolean} pingEnable 啟動ping偵測機制
         * @name FxWebSocketClient#pingEnable
         * @version 1.0.0
         */
        "pingEnable": {
            set: function (bool) {
                client.pingEnable = bool;
            },
            get: function () {
                return client.pingEnable;
            },
            configurable: false,
            enumerable: false
        }
    });
};
/**
 * 寫入資料
 * @param {Buffer|String} data 資料
 * @private
 * @returns {boolean}
 */
FxWebSocketClient.prototype.write = function (data) {

    if (!this._client) return false;
    if (typeof data == 'string') {
        return this._client.write(data);
    } else if (typeof data == 'object') {
        return this._client.write(JSON.stringify(data));
    } else if (Buffer.isBuffer(data)) {
        return this._client.write(data, 2);
    }
    return false;
};
/**
 * 讀取資料
 * @param {Buffer} chunk 數據
 * @private
 * @returns {*}
 */
FxWebSocketClient.prototype.read = function (chunk) {
    const obj = this._client.read(chunk);
    return obj;
};
/**
 * 關閉連線
 * @public
 */
FxWebSocketClient.prototype.destroy = function () {
    if (this._client) this._client.checkFinishTCP();
};
/**
 * 關閉連線
 * @public
 */
FxWebSocketClient.prototype.close = function (data) {
    if (this._client) this._client.close(data);
};
/**
 * 設定連線資料模式
 * @param {("arraybuffer"|"blob"|"string")} type 資料型態
 * @public
 */
FxWebSocketClient.prototype.setBinaryType = function (type) {
    this._client.binaryType = type;
}
/**
 * 檢查是否為紀錄RTT資訊
 * @param {fxSocket} client 客端物件
 * @param {Buffer} data 資料
 * @private
 * @returns {boolean}
 */
FxWebSocketClient.prototype.recordPing = function (client, data) {

    if (typeof data == "undefined" || data == null) return false;

    if (data.indexOf('"ping":') != -1) {
        let json;
        if (data.indexOf('"rtt":') != -1 && data.indexOf(',') == -1) return true;
        try {
            json = JSON.parse(data);
        } catch (e) {
            const NSLog = require('./FxLogger.js').getInstance();
            NSLog.error(`recordPing() data: ${data}`, e);
        }
        if (typeof json.ping != "number" && typeof json.rtt != "number") return false;
        const ping = client.probeResult(json);
        if (typeof data != "undefined") this.emit("ping", {ping:ping});
        return true;
    }
    return false;
}
FxWebSocketClient.prototype.probeResult = function (obj) {
    if (this._client) {
        return this._client.probeResult(obj);
    } else {
        return -1;
    }
};
FxWebSocketClient.prototype.createCloseStatusCode = function ({code, reason}) {
    let codeBuf = Buffer.alloc(2);
    codeBuf.writeUInt16BE(code);
    let reasonBuf = Buffer.from((reason || ''));
    return Buffer.concat([codeBuf, reasonBuf]);
};
/**
 * @returns {Versions} 版本支援版號;
 */
FxWebSocketClient.Versions = Versions;

const FxWS = require("./FxWebSocket.js")
/**
 * 建立一個Client連線伺服器物件
 * @param {string} url websocket伺服器位址
 * @returns {FxWebSocket}
 */
FxWebSocketClient.createWebSocket = function (url) {
    return FxWS = new FxWS(url);
};

module.exports = exports = FxWebSocketClient;
