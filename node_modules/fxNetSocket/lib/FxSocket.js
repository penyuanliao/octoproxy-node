/**
 * Created by Benson.Liao on 2015/11/20.
 * @module FxSocket
 */
const debug           = require('debug')('Socket');
const parser          = require('./FxParser.js');
const utilities       = require('./FxUtility.js');
// const fxNM          = require('./FxNetworkMonitor.js');
const util            = require('util');
const events          = require('events');
const Encoder         = parser.Encoder;
const stream          = require("stream");
const Transform       = stream.Transform;
const crypto          = require('crypto');
const fxStatus        = require('./FxEnum.js').fxStatus;
const FxRevicer       = require("./FxRevicer.js");
const FxSender        = require("./FxSender.js");

util.inherits(FxSocket, events.EventEmitter); // 繼承事件
/** 關閉事件字串 */
const WS_HANDLE_CLOSE = JSON.stringify({"NetStatusEvent":"NetConnection.Connect.Closed"});

/**
 * Custom net socket connection
 * @param {module:net.Socket} socket 網路傳輸socket
 * @param {Object|undefined} options 初始化設定
 * @param {Object} options.delegate
 * @param {FxEnum.Versions} options.baseVersion 版本設定
 * @param {Boolean} options.zlibDeflatedEnabled 啟動ws壓縮模式
 * @param {Boolean} options.finTCP 結束是否處理四方交握協定
 * @description registered : change server to init ws use.
 * @version 1.0.0
 * @constructor
 * @extends {external:EventEmitter}
 */
function FxSocket(socket, options) {
    events.EventEmitter.call(this);
    /* Variables */
    if (typeof options == "undefined") options = {};
    /**
     * @property {parser.Encoder} encoder websocket parser
     * @version 1.0.0
     * @deprecated since version 2.0
     */
    this.encoder           = new Encoder();
    /** @property {module:net.Socket} socket 網路傳輸socket */
    this.socket            = socket;
    /** @property {Boolean} finTCP 4向交握斷線 */
    this.finTCP            = (options.finTCP == true); // four Way Handshake Enabled
    /** @property {Boolean} isConnect 連線狀態 */
    this.isConnect         = false;
    /** @property {Boolean} isRelease 是否回收 */
    this.isRelease         = false;
    /** @property {Boolean} _heartbeatEnabled 心跳檢查timeout機制 */
    this._heartbeatEnabled = true;
    /** @property {Buffer} chunkBuffer 使用者stream暫存 */
    this.chunkBuffer       = Buffer.from([]);
    /** @property {Number} cookies 心跳檢查timeout機制時間(秒) */
    this.cookies           = 0;
    /** @property {Object} delegate A parent component */
    this.delegate          = options.delegate;
    /** @property {Buffer} payload 暫存處理資料 */
    this.payload           = Buffer.allocUnsafe(1024 * 32);
    /**
     * @property {Number} _binaryType 資料傳輸模式
     * @private
     */
    this._binaryType       = 1;
    /** @property {Number} 建立連線時間 */
    this.uptime            = new Date().getTime();
    /** @property {Number} 關閉連線時間 */
    this.downtime          = 0;
    /** @property {("aes-256-cbc")} encryption 對稱是加密模式 */
    this.encryption        = "";
    /**
     * @property {function} onAccept subproto事件
     * @return {Boolean}
     * @description sec-websocket-protocol 檢查值是否允許
     */
    this.onAccept          = undefined;
    /** @property {Array} wsProtocol sec-websocket-protocol參數值 */
    this.wsProtocol        = undefined;
    /**
     * @property {Boolean} _pingEnable 自訂RTT事件
     * @private
     */
    this._pingEnable       = false;
    /** @property {Timeout} _pingEnable 自訂RTT Timeout物件 */
    this.probe_timeout     = undefined;
    /** @property {Object} _pingEnable 自訂RTT 數值紀錄 */
    this.ping_time         = {time:0};
    /** @property {Buffer} tmpSource 資料暫存 */
    this.tmpSource         = Buffer.from([]);
    /** @property {String} acceptKey AES加密金鑰 */
    this.acceptKey         = undefined;
    /** @property {String} server iv AES 8 Bytes 初始化向量值 */
    this.iv                = undefined;
    /** @property {String} clinet iv AES 8 Bytes 初始化向量值 */
    this.civ               = Buffer.alloc(16);
    /** @property {Buffer} drainQueue [drain]緩送封包暫存陣列 */
    this.drainQueue        = [];
    /** @property {Boolean} backpressure [drain]啟動背壓緩送機制 */
    this.backpressure      = false;
    /** @property {Boolean} pindingDrain [drain]封包延遲發送 */
    this.pindingDrain      = false;
    /**
     * @property {Boolean} zlibDeflatedEnabled 啟動壓縮
     * @version 2.0.0
     * @public
     */
    this.zlibDeflatedEnabled = false;
    if (typeof socket.backpressure != "undefined") this.backpressure = socket.backpressure;
    // this.monitor           = fxNM.getInstance();
    /** @property {Boolean} forcedBinary 回送Buffer資料 */
    this.forcedBinary      = false;
    if (typeof this.registered == "undefined") this.registered = false;
    /** @property {Boolean} baseEvtShow 傳送連線初始化事件 */
    this.baseEvtShow       = false;
    if (typeof socket.baseEvtShow != "undefined") this.baseEvtShow = socket.baseEvtShow;
    /** @property {boolean} replicated 處理第二次對接資料 */
    this.replicated        = false; //wrap_socket event
    if (typeof socket.replicated != "undefined") this.replicated = socket.replicated;
    /** @property {String} name 定義socketName */
    socket.name = socket.remoteAddress + "\:" + socket.remotePort;
    /** @property {("http"|"ws"|"flashsocket"|"socket")} mode 客端傳輸模式 */
    this.mode = '';
    /**
     * @property {("v1"|"v2")} baseVersion 切換版本模式
     * @version 2.0.0
     * @private
     */
    this._baseVersion = "v1";
    /**
     * 支援對稱式加密
     * @enum {Boolean} 支援對稱式加密
     * @readonly
     * @private
     */
    this.encryptionCodec = {
        /** aes模式 */
        "aes":true,
    }
    /**
     * 支援編碼模式
     * @property {Object} protocolCodec 編碼模式
     * @property {Boolean} protocolCodec.bin 位元值
     * @property {Boolean} protocolCodec.op 字串
     * @readonly
     * @private
     */
    this.protocolCodec = {
        "bin":true,
        "op" :true
    };
    /**
     * 客端統計傳輸量
     * @property {Object} accessLogs 統計資料量大小
     * @property {Number} accessLogs.csBytes 接收資料量
     * @property {Number} accessLogs.scBytes 發送資料量
     */
    this.accessLogs = {
        csBytes:0,
        scBytes:0,
    }
    const self = this;

    socket.on('data', function incoming(chunk) {
        self.accessLogs.csBytes += chunk.byteLength;
        // self.monitor.incoming(chunk.byteLength);
    });
    socket.on("drain", function onDrain() {
        self.emit("drain");
        let flushed = true;
        while (self.drainQueue.length > 0 && flushed == true) {
            const data = self.drainQueue.shift();
            flushed = self.write(data[0], data[1]);
        }
        self.pindingDrain = !flushed;

    });
    socket.on('close', function onClose() {
        self.isConnect = false;
        self.downtime = new Date().getTime();
        socket.relatedData = undefined;
        if (self.delegate) {
            self.delegate = undefined;
        }
        self.pingEnable = false;
        // self.monitor.eject(self.ip_adrs);
        self.clearHeartbeat();
        self.release();
    });
    socket.on('end', function onEnd() {
        self.isConnect = false;
        if (socket.allowHalfOpen == true) {
            socket.end();
        }
        if (!socket.destroyed) {
            socket.destroy();
        }
    });
    socket.on('error',  function onError(error) {
        self.isConnect = false;
        if (!socket.destroyed) self.socket.destroy();
    });
    socket.on("timeout", function onTimeout() {
        self.clearHeartbeat();
        console.log('info','FxSocket %s at timeout.', socket.name);
        self.close();
    });

    if (this._heartbeatEnabled) {
        this.startupHeartbeat(3 * 60)
    }
    this.on("connect", function onConnect() {
        self.ip_adrs = ((typeof self.originAddress == "undefined") ? socket.remoteAddress: self.originAddress) + ":" + socket.remotePort;
        // self.monitor.join(self.ip_adrs, self.accessLogs);
    })
    Object.defineProperties(this, {
        originAddress: {
            get:function () {
                if ((typeof self.headers != "undefined" && typeof self.headers["X-Forwarded-For"] != "undefined")) {

                    const xff = self.headers["X-Forwarded-For"].replace(/\s+/g, '');

                    const xffSplit = xff.split(",");

                    return (xffSplit.length > 1) ? xffSplit[xffSplit.length-1] : xff

                } else {
                    return socket.remoteAddress;
                }
            },
            configurable: false,
            enumerable: false
        },
        forwarded: {
            get: () => {
                return self.headers["forwarded"];
            },
            configurable: false,
            enumerable: false
        },
        authorized: {
            get:function () {
                // user has legal
                return !(self._binaryType == 1 && self.encryption == "");
            },
            configurable: false,
            enumerable: false
        },
        ipAdrs: {
            get: function () {
                if (typeof self.ip_adrs == "undefined") self.ip_adrs = ((typeof self.originAddress == "undefined") ? socket.remoteAddress: self.originAddress);
                return self.ip_adrs;
            },
            configurable: false,
            enumerable: false
        },
        /**
         * @property {Boolean} compressed 客端是否支援壓縮模式
         * @name FxSocket#compressed
         * @version 2.0.0
         * @readonly
         */
        compressed: {
            get: function () {
                if (this.revicer) {
                    return this.revicer.compressed;
                } else {
                    return false;

                }
            }
        },
        setEncryption: {
            set: function (name) {
                if (name == "aes") {
                    this.encryption = "aes-256-cbc";
                    this.acceptKey  = crypto.randomBytes(16).toString("hex");
                } else {
                    this.encryption = "";
                    this.binaryType = "";
                }
            }
        },
        /**
         * @property {Boolean} connecting 連線狀態
         * @name FxSocket#connecting
         * @version 1.0.0
         * @readonly
         */
        connecting: {
            get: function () {
                if (this.socket && this.socket.writable && !this.socket.destroyed && !this.socket.connecting) {
                    return true;
                };
                return false;
            },
            configurable: false,
            enumerable: false
        },
        /**
         * @property {("v1"|"v2")} baseVersion 切換版本模式
         * @version 2.0.0
         */
        baseVersion: {
            get: function () {
                return this._baseVersion;
            },
            set: function (val) {
                if (val == "v1") this._baseVersion = val;
                else if (val == "v2") this._baseVersion = val;
                if (val == "v1") {
                    this.zlibDeflatedEnabled = false;
                } else if (val == "v2") {
                    //this.baseEvtShow = false;
                }
            }
        }
    });
    this.setup(options);
};
/**
 * 初始化物件
 * @param {Object} options 設定檔
 */
FxSocket.prototype.setup = function (options) {
    if (typeof options == "undefined") options = {
        zlibDeflatedEnabled: false,
        baseVersion: "v1"
    };
    if (typeof options != "undefined") {
        if (typeof options.baseVersion == "string") {
            this.baseVersion = options.baseVersion;
        }
        if (typeof options.zlibDeflatedEnabled == "boolean") {
            this.zlibDeflatedEnabled = options.zlibDeflatedEnabled;
        }
    }
    /**
     * @property {FxRevicer} revicer 處理Websocket Read資料
     * @version 2.0.0
     * @protected
     */
    this.revicer = new FxRevicer(this, fxStatus.websocket); // parser read
    /**
     * @property {FxSender} sender 處理Websocket Write資料
     * @version 2.0.0
     * @protected
     */
    this.sender = new FxSender(this);
};
/**
 * 指派訊息回傳物件
 * @param {Object} delegate 指派
 */
FxSocket.prototype.revicerDelegate = function (delegate) {
    if (this.revicer) {
        this.revicer.client = delegate;
    }
};
/**
 * 設定timeout機制
 * @param {Number} sec 秒
 */
FxSocket.prototype.startupHeartbeat = function (sec) {
    this.cookies = sec ;
    this.socket.setTimeout(sec * 1000);
};
/**
 * 清除timeout機制
 */
FxSocket.prototype.clearHeartbeat = function () {
    this.cookies = 0;
    this.socket.setTimeout(0);
}
/**
 * 第一包資料分析握手協定
 * @param {Buffer} chunk 數據
 */
FxSocket.prototype.handshake = function (chunk) {
    let readHeaders = parser.headers.readHeaders(chunk); //分析檔頭
    let customize   = {};
    let accept;
    let len;
    if (this.encryption != "") {
        customize["content-encoding"] = this.encryption;
    }
    //檢查服務端支持的子協議
    if (typeof readHeaders["sec-websocket-protocol"] != "undefined") {
        let subProtols = readHeaders["sec-websocket-protocol"].split(",");

        if (typeof onAccept == "function") {
            accept = onAccept(subProtols);
            if (typeof accept == "string") subProtols = accept;
        }

        readHeaders["sec-websocket-protocol"] = this.checkSubProtol(subProtols);
    }
    if (this._baseVersion == "v1" && this.zlibDeflatedEnabled) {
        console.error("Zlib Deflated does not support baseVersion 'v1'.");
        this.zlibDeflatedEnabled = false; //v1 不支援
    }
    const resHeaders = parser.headers.writeHandshake(readHeaders, customize, this.zlibDeflatedEnabled);
    if (this.socket.writable && !this.socket.destroyed && this.replicated != true) {
        this.socket.write(resHeaders);
        len = Buffer.byteLength(resHeaders);
        this.accessLogs.scBytes += len;
        // this.monitor.outgoing(len);
    }

    this.wsProtocol = readHeaders['sec-websocket-protocol'];
};
/**
 * 訊息傳送
 * @param {Buffer|String} data 資料
 * @param {Number} opcode only websocket
 * @description write > dataEncryptByWebsocket > _createMessage
 * @version 1.0.0
 * @public
 * @return {boolean}
 */
FxSocket.prototype.write = function (data, opcode) {
    // 檢查被壓模式
    if (this.pindingDrain === true && this.backpressure === true) {
        this.drainQueue.push([data, opcode]);
        return false;
    }
    let flushed = true; // flushed success on kernel buffer
    let len = 0;
    if (this.isRelease == true) return false;

    if (this.mode === fxStatus.websocket) {
        if (typeof data == "object") data = JSON.stringify(data);

        const encData = this.dataEncryptByWebsocket(data); // 資料加密處理
        const opcode = (Buffer.isBuffer(encData) ? 2 : 1);
        flushed = this._createMessage(encData, opcode);

    }
    else if (this.mode === fxStatus.flashSocket) {
        flushed = this.socket.write(data + '\0');
        len = data.byteLength + 1;
    }
    else if (this.mode === fxStatus.socket) {
        if (typeof this.delimiter == "string") {
            flushed = this.socket.write(data + this.delimiter);
            len = Buffer.isBuffer(data) ? data.byteLength : Buffer.byteLength(data);
            len += this.delimiterLen;
        } else {
            flushed = this.socket.write(data);
            len = Buffer.isBuffer(data) ? data.byteLength : Buffer.byteLength(data);
        }
    } else {
        // http
    }
    this.cookies = 0;
    this.accessLogs.scBytes += len;
    // this.monitor.outgoing(len);

    this.pindingDrain = !flushed;

    return flushed;
};
/**
 * only webosocket
 * @param {Buffer|String|Object} data 資料
 * @param {Buffer} data 資料
 * @private
 */
FxSocket.prototype._createMessage = function (data, opcode) {
    let flushed = true;
    let len = 0;
    if (typeof data == "undefined") data = Buffer.alloc(0);
    if (this.compressed && this.zlibDeflatedEnabled) {
        const info = {
            fin: true,
            data: data,
            opcode: opcode
        };
        this.sender.compressing(info, (this.sender.pipelines ? undefined : (raw) => {
            const buf = this.sender.datafragment(raw, opcode, true);
            flushed = this.socket.write(buf);
            len = buf.length;
        }));
    } else {
        const buf = this.dataFrames(data, opcode, true);
        flushed = this.socket.write(buf);
        len = buf.length;
    }
    this.accessLogs.scBytes += len;
    return flushed;
};
/**
 * 檢查資料是否需要AES加密 by websocket
 * @param {Buffer} raw Buffer資料
 * @return {Buffer}
 */
FxSocket.prototype.dataEncryptByWebsocket = function (raw) {
    let buf;
    if (this.encryption == "aes-256-cbc" && enc != false) {
        this.iv = crypto.randomBytes(8).toString("hex");
        buf = this.encryption(raw);
    } else {
        buf = raw;
    }
    return buf;
};
/**
 * 檢查資料型態
 * @param {Buffer} payload 傳送資料
 * @param {Number} opcode ws事件代號
 * @param {Boolean} fin ws結束
 * @return {Buffer}
 */
FxSocket.prototype.dataFrames = function (payload, opcode, fin) {
    if (typeof opcode == "undefined") opcode = (Buffer.isBuffer(payload) ? 2 : 1);
    if (typeof fin == "undefined") fin = true;
    if (this._binaryType > 1 && opcode < 2) opcode = 2;
    let buf = this.emit_websocket(payload, opcode, fin);
    return buf;
};
/**
 * 讀取資料
 * @param {Buffer} data 數據資料
 * @param {Boolean} first 第一包
 * @return {Object|boolean|undefined}
 */
FxSocket.prototype.read = function (data, first) {
    if (this.mode === 'flashsocket') return read_flashsocket(data);
    if (this.mode === 'ws') {
        this.protocol = this.read_websocket(data, first);
        if (typeof this.protocol != "undefined" && this.protocol != false && this.protocol.total > this.protocol.byteLength) {
            return this.protocol;
        } else if (typeof this.protocol == "undefined" || typeof this.protocol.opcode == "undefined") {
            return {opcode:8,msg:""};
        }

        var opcode = this.protocol.opcode;
        debug('log','FxSocket ws-opcode(read): ' + this.protocol.opcode );

        var obj = {opcode:opcode, fin:this.protocol.fin};

        this.tmpSource = Buffer.concat([this.tmpSource, this.protocol['msg']], this.tmpSource.length + this.protocol['msg'].length);

        if (this.protocol.fin == true) {
            this.protocol['msg'] = (this.forcedBinary == false) ? this.tmpSource.toString() : this.tmpSource;
            this.protocol['binary'] = this.tmpSource;
            this.tmpSource = Buffer.from([]);
        } else {
            return obj;
        }

        if (opcode === 1 || opcode === 0) {
            obj.msg = this.protocol['msg']
        }else if (opcode === 2) {
            obj.msg = this.protocol['msg']; //Binary Frame

            // obj.msg = parser.protocols.Utf8ArrayToStr(Buffer.from(this.protocol.msg));
            // console.log('Binary Frame:',obj.msg);
        }else if (opcode === 8){
            // 0x8 denotes a connection close
            obj.msg = "close";
        }else if (opcode === 10) {
            setTimeout(() => this._createMessage(undefined, 9), 10000)
        }
        // opcode 0x01 Text
        // opcode 0x02 ByteArray
        // opcode 0x08 frame client destory ws
        // TODO opcode 0x09 frame Pring control frame
        // TODO opcode 0x0A frame Pong control frame

        return obj;
    }
};
/** 使用者斷線 */
FxSocket.prototype.close = function (data) {
    if (this.mode === 'ws' && this.connecting) {
        try {
            if (this.baseEvtShow) this.write(WS_HANDLE_CLOSE);
            this._createMessage(data, 8);
        }
        catch (e) {
        }
    }
    if (this.finTCP) {
        this.socket.end();
        setTimeout(function (self) { self.checkFinishTCP(); }, 100, this);
    } else {
        this.socket.destroy();
    }

};
FxSocket.prototype.createCloseStatusCode = function ({code, reason}) {
    let codeBuf = Buffer.alloc(2);
    codeBuf.writeUInt16BE(code);
    let reasonBuf = Buffer.from((reason || ''));
    return Buffer.concat([codeBuf, reasonBuf]);
};
/** 檢查完成四方交握 */
FxSocket.prototype.checkFinishTCP = function () {
    //console.log('this.socket', this.socket.destroyed);
    if (typeof this.socket != "undefined" && !this.socket.destroyed) {
        this.socket.destroy();
    }
}
/**
 * 讀取XMLSocket
 * @param {Buffer} data
 * @return {Object}
 */
function read_flashsocket(data) {
    let _data = data.toString();
    // Socket 字尾終結符號\0過濾
    var trim = _data.substring(0,_data.replace(/\0/g, '').length );
    var evt;
    try {
        evt = JSON.parse(trim);
    } catch (e) {
        evt = {};
    }
    return evt;

};
/**
 * 讀取Websocket
 * @param {Buffer} data
 * @param first
 * @fires FxRevicer#message
 * @version 1.0.0
 * @deprecated since version 2.0
 * @return {{msg: string, start: number, byteLength: *}|boolean}
 */
FxSocket.prototype.read_websocket = function(data, first) {
    var proto = this.encoder.readFraming(data, first);
    return proto;
}
/***
 * 處理資料檔頭跟資料類型轉換成Buffer
 * @param {Buffer|String} data json資料或Buffer資料
 * @param {Number|} opcode ws事件代號
 * @param {Boolean|} fin ws結束
 */
FxSocket.prototype.emit_websocket = function(data, opcode, fin, auto) {
    const isBuf = Buffer.isBuffer(data);
    let bfsize;
    let tmpBuf;
    if (isBuf) {
        tmpBuf = data;
        bfsize = data.byteLength;
    } else {
        tmpBuf = this.payload;
        bfsize = Buffer.byteLength(data);
        if (bfsize > tmpBuf.length) {
            tmpBuf = Buffer.from(data);
        } else {
            tmpBuf.write(data, 0);
        }
    }
    const payload = tmpBuf.slice(0, bfsize);
    //console.log("[parse] emit_websocket", opcode, fin);
    const _buffer = this.sender.writeFraming({
        fin: fin,
        opcode: opcode,
        masked: false,
        payload: payload,
        compress: (this.compressed && this.zlibDeflatedEnabled)
    });
    return Buffer.concat([_buffer, payload], _buffer.length + bfsize);
};

FxSocket.prototype.incomming = function (chunk) {
    if (typeof this.chunkBuffer == "undefined" || this.chunkBuffer.length <= 0) {
        this.chunkBuffer = Buffer.from(chunk);
    } else {
        this.chunkBuffer = Buffer.concat([this.chunkBuffer, chunk], this.chunkBuffer.length + chunk.length);
    }
};

FxSocket.prototype.getClientStatus = function () {
    var self = this;

    return {
        "name":self.socket.name,
        "namesspace":self.socket.namespace,
        "mode":self.socket.mode,
        "uptime":self.uptime,
        "downtime":self.downtime,
        "csBytes":self.accessLogs.csBytes,
        "scBytes":self.accessLogs.scBytes
    };

};

FxSocket.prototype.__defineGetter__("name", function () {
    return this.socket.name;
});
FxSocket.prototype.__defineSetter__("name", function (name) {
    this.socket.name = name;
});

FxSocket.prototype.__defineGetter__("mode", function () {
    return this.socket.mode;
});
FxSocket.prototype.__defineSetter__("mode", function (mode) {
    this.socket.mode = mode;
});

FxSocket.prototype.__defineGetter__("namespace", function () {
    return this.socket.namespace;
});
FxSocket.prototype.__defineSetter__("namespace", function (namespace) {
    namespace = namespace.replace(/\/\w+\//i,'/');
    var args = utilities.parseUrl(namespace); //url arguments
    if (args) namespace = args[0];
    this.socket.namespace = namespace;
    if (args && typeof args != "undefined" && args.length > 1) {
        this.socket.query = args.splice(1,args.length);
    }
});
FxSocket.prototype.__defineSetter__("registered", function (bool) {
    if (typeof bool == "boolean")
        this.socket.registered = bool;
    else
        this.socket.registered = false;
});
FxSocket.prototype.__defineGetter__("registered", function () {
    if (typeof this.socket == "undefined" || typeof this.socket.registered == "undefined")
        return false;
    else
        return this.socket.registered;
});
FxSocket.prototype.__defineSetter__("heartbeatEnabled", function (bool) {
    if (typeof bool == 'boolean') {
        this._heartbeatEnabled = bool;
        if (bool){
            this.startupHeartbeat(180);
        }else {
            this.clearHeartbeat();
        }
    }

});
FxSocket.prototype.__defineGetter__("heartbeatEnabled", function () {
    return this._heartbeatEnabled;
});
FxSocket.prototype.__defineSetter__("binaryType", function (binarytype) {
    if (binarytype == "arraybuffer") {
        this._binaryType = 2;
    } else if (binarytype == "blob") {
        this._binaryType = 3;
    }
    else {
        this._binaryType = 1;
    }
});
FxSocket.prototype.__defineGetter__("pingEnable", function () {
    return this._pingEnable;
    
});
FxSocket.prototype.__defineSetter__("pingEnable", function (bool) {
    if (typeof bool == "boolean") {
        this._pingEnable = bool;
    } else {
        this._pingEnable = false;
    }

    if (this._pingEnable == false) {
        clearTimeout(this.probe_timeout);
        this.probe_timeout = null;
    } else {
        this.probe();
    }

});
FxSocket.prototype.probe = function () {
    const self = this;
    this.probe_timeout = setTimeout(function () {
        const start = new Date().getTime();
        if (self.connecting) {
            self.write(util.format('{"ping":%s,"rtt":%s}',
                start,
                self.ping_time.time));
            self.probe();
        }

    }, 5000);
};
FxSocket.prototype.probeResult = function (obj) {
    if (typeof obj == "object") {
        this.ping_time.time = new Date().getTime() - obj.ping;
    }
    return this.ping_time;
}
/**
 * 檢查子Protol參數
 * @param subProtols
 * @return {*}
 */
FxSocket.prototype.checkSubProtol = function (subProtols) {
    let agreeProtol;
    let group, name, proto, iCompress;
    for (var i = 0; i < subProtols.length; i++) {
        if (subProtols[i] == "finWay") {
            this.finTCP = true;
            continue;
        }
        if (this.encryptionCodec[subProtols[i]]) {
            agreeProtol = subProtols[i];
            this.setEncryption = subProtols[i];
            break;
        } else if (this.protocolCodec[subProtols[i]]) {
            agreeProtol = subProtols[i];
            if (agreeProtol == "bin") this.binaryType = "arraybuffer";
            if (agreeProtol == "op") this.binaryType = "";
            else this.binaryType = agreeProtol;
            break;
        } else {
            group = subProtols[i].split(".");
            name  = (typeof group[0] != "undefined") ? group[0]:undefined;
            proto  = (typeof group[1] != "undefined") ? group[1]:undefined;
            iCompress  = (typeof group[2] != "undefined") ? group[2]:undefined;
            if (this.protocolCodec[proto]){
                if (proto == "bin") this.binaryType = "arraybuffer";
                else if (agreeProtol == "op") this.binaryType = "";
                else this.binaryType = agreeProtol;
            }
            if (this.encryptionCodec[iCompress]) this.setEncryption = iCompress;
                agreeProtol = subProtols[i];
            break;
        }

    }
    return agreeProtol;
}
/**
 * ArrayBuffer轉Buffer
 * @param {ArrayBuffer} data 數據
 * @return {Buffer}
 */
FxSocket.prototype.setArrayBuffer = function (data) {

    if (!data.buffer) {
        return Buffer.from(data);
    }else {
        return Buffer.from(data.buffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
}
/**
 * AES編碼
 * @param {String|Buffer} data 數據
 * @return {string}
 */
FxSocket.prototype.encryption = function (data) {
    let algorithm = this.encryption;
    var hex = this.acceptKey;
    var iv = this.iv;
    var cipher = crypto.createCipheriv(algorithm, hex, Buffer.from(iv, "utf8"));
    var clearEncoding = 'utf8';
    var cipherEncoding = 'hex';
    var cipherChunks = [];
    cipher.setAutoPadding = true;
    cipherChunks.push(cipher.update(data, clearEncoding, cipherEncoding));
    cipherChunks.push(cipher.final(cipherEncoding));
    return iv + "$" + cipherChunks.join('');
};
/**
 * AES解碼
 * @param {String} data 數據
 * @return {string}
 */
FxSocket.prototype.decryption = function (data) {
    if (typeof data == "undefined") return;
    var sp = data.split("$");
    var hex = this.acceptKey;
    if (sp.length != 2) return;

    var ivStr = String(sp[0]);
    const civ = this.civ;
    const algorithm = this.encryption;
    const clearEncoding = 'utf8';
    const cipherEncoding = 'hex';
    if (ivStr.length > 16) ivStr = ivStr.substr(0, 16);
    civ.write(ivStr, 0, "utf8");
    var cipherChunks = [];
    var decipher = crypto.createDecipheriv(algorithm, hex, civ);
    cipherChunks.push(decipher.update(sp[1], cipherEncoding, clearEncoding));
    cipherChunks.push(decipher.final(clearEncoding));
    return cipherChunks.join('');
};
/** 回收物件 */
FxSocket.prototype.release = function () {
    if (this.isRelease) return;
    this.isRelease = true;
    this.socket.removeAllListeners();
    setTimeout(() => {
        const o = Object.freeze({
            name: this.socket.name,
            namespace: this.socket.namespace,
            mode: this.socket.mode,
            destroyed: true,
            writable: false
        });
        this.removeAllListeners();
        this.socket.baseEvtShow = false;
        this.socket = o;
    }, 0);

    this.civ = undefined;
    this.acceptKey = {};
    this.hsSource = undefined;
    this.wsProtocol = undefined;
    this.headers = undefined;
    if (typeof this.protocol == "object") {
        this.protocol["msg"] = undefined;
        this.protocol["opcode"] = undefined;
        this.protocol["fin"] = undefined;
        this.protocol['binary'] = undefined;
        this.tmpSource = undefined;
    }
    this.protocol = undefined;
    // socket, flashsocket
    this.configure = undefined;
    this.delimiter = undefined;
    this.delimiterLen = undefined;
};
/** 找不到A元件庫替代B元件庫 */
function ifdef(a, b) {
    var req;
    try {
        req = require(a);
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') {
            throw e;
        }
        req = {}
    }
    return req;
}


module.exports = exports = FxSocket;


