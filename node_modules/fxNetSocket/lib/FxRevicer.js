/**
 * Created by Benson.Liao on 20/8/5.
 * @version 1.0.0
 */
const net           = require("net");
const util          = require("util");
const zlib          = require("zlib");
const EventEmitter  = require("events");
const FxReaderPool  = require("./FxReaderPool.js");
const FxWriterPool  = require("./FxWriterPool.js");
const fxStatus      = require('./FxEnum.js').fxStatus;
util.inherits(FxRevicer, EventEmitter);

/** @const {Buffer} TRAILER inflate結尾 */
const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]); //tailer
/**
 * 讀取資料元件
 * @param {FxSocket|*} client
 * @param {("http"|"ws"|"flashsocket"|"socket")} mode
 * @version 0.0.1
 * @constructor
 */
function FxRevicer(client, mode) {

    EventEmitter.call(this);
    this.setProps();
    /** @property {Number} INT32_MAX_VALUE int32最大值 */
    this.INT32_MAX_VALUE =  Math.pow(2,32);
    /** @property {String} mode 資料模式 */
    this.mode = mode;
    /** @property {FxSocket|FxWebSocketClient} client 連線物件 */
    this.client = client;
    /** @property {Boolean} first 檢查是否第一個封包 */
    this.first = true;
    /** @property {Boolean} compressed 是否支援壓縮演算法 */
    this.compressed = false;
    /** @property {Boolean} isRelease 是否回收 */
    this.isRelease = false;
    /** @property {Object} protocol 暫存分析資料 */
    this.protocol = undefined;
    /** @property {Array<Buffer>} srcQueue 暫存Payload */
    this.srcQueue = [];
    /** @property {Number} srcQueueLength 暫存Payload Length */
    this.srcQueueLength = 0;
    /** @property {Array<Buffer>} chunksBuffer 暫存封包資料 */
    this.chunksBuffer = [];
    /** @property {Number} chunksBuffer 暫存封包長度 */
    this.chunksLength = 0;
    /**
     * @property {Object} configure socket 初始設定檔案
     * @property {RegExp} configure.delimiterRegexp 拆解JSON檔案
     */
    this.configure = {
        delimiterRegexp: new RegExp("(\{.+?\})(?={|$)", "g")
    };
    /** @property {FxWriterPool} reader 讀取streaming資料 */
    this.reader = new FxWriterPool();
    this.reader.on("refresh", this.polling.bind(this, this.onHandle.bind(this)));
    this.reader.on("close", this.release.bind(this));
}
/**
 * 設定來源型態
 * @param {("http"|"ws"|"flashsocket"|"socket")} mode
 */
FxRevicer.prototype.setMode = function (mode) {
    this.mode = mode;
};
/**
 * 物件定義
 */
FxRevicer.prototype.setProps = function () {
    Object.defineProperty(this, "glListener", {
        get: function () {
            if (typeof this.client == "undefined") return false;
            if (typeof this.client.delegate == "undefined") return false;
            return this.client.delegate.glListener;
        },
        configurable: false,
        enumerable: false
    })
    /** @property {Boolean} isRelease 是否回傳binary data */
    Object.defineProperty(this, "forcedBinary", {
        get: function () {
            if (typeof this.client == "undefined") return false;
            return this.client.forcedBinary;
        },
        configurable: false,
        enumerable: false
    });
};
/**
 * 建立壓縮演算法
 * @return {InflateRaw|undefined} zlib元件
 */
FxRevicer.prototype.createDecompress = function () {
    const self = this;
    const endpoint = this.client;
    if (this.isRelease) return undefined;

    if (typeof this.stream == "undefined") {
        this.stream = zlib.createInflateRaw({windowBits: zlib.Z_DEFAULT_WINDOWBITS});
        this.stream.on("data", function (data) {
            if (this.isRelease) return;
            this.chunksBuffer.push(data);
            this.chunksLength += data.byteLength;
        }.bind(this));
    }
    return this.stream;
};
/**
 * 處理websocket stream
 * @param {Object} proto;
 * @param {Boolean} proto.fin 最後一個fragment
 * @param {Boolean} proto.rsv1 驗證1 如果第一包採用deflate/Inflate壓縮方式rsv1=1
 * @param {Boolean} proto.rsv2 驗證2
 * @param {Boolean} proto.rsv3 驗證3
 * @param {Number} proto.opcode 操作碼
 * @param {Boolean} proto.compressed 提供deflate/Inflate壓縮套件
 * @param {Number} proto.total 總長度
 * @param {Buffer} proto.hasMask 是否掩碼鍵
 * @param {Buffer} proto.mask 掩碼鍵
 * @param {Number} proto.start payload開始位置
 * @param {Number} proto.payload_length payload總長度
 * @param {Buffer} proto.payload 暫存封包資料
 * @param {Buffer} proto.msg 重組完封包
 */
FxRevicer.prototype.onHandle = function (proto) {
    const endpoint = this.client;
    if (this.isRelease) return false;
    let payload;
    if (proto.fin === false) {
        this.srcQueue.push(proto.payload);
        this.srcQueueLength += proto.payload.byteLength;
        return false;
    } else if (this.srcQueue.length != 0) {
        this.srcQueue.push(proto.payload);
        this.srcQueueLength += proto.payload.byteLength;
        payload = Buffer.concat(this.srcQueue, this.srcQueueLength);
        this.srcQueue = [];
        this.srcQueueLength = 0;
    } else {
        payload = proto.payload;
    }
    if (proto.compressed) {
        const stream = this.createDecompress();
        if (typeof stream == "undefined") return false;
        stream.write(payload);
        stream.write(TRAILER);
        stream.flush(zlib.Z_SYNC_FLUSH, function () {
            if (proto.opcode == 8) {
                // console.info('onHandle() opcode:', proto.opcode);
                this.emitDestroy();
                return true;
            }
            const data = Buffer.concat(this.chunksBuffer, this.chunksLength);
            this.chunksBuffer = [];
            this.chunksLength = 0;
            if (endpoint.pingEnable == true && this.recordPing(endpoint, data) == true) return true;
            this.emitMessage((endpoint.forcedBinary ? data : data.toString()));
        }.bind(this));
    } else {
        if (this.isRelease) return false;
        if (proto.opcode == 8) {
            this.emitDestroy();
            return true;
        }
        if (endpoint.pingEnable == true && this.recordPing(endpoint, proto.payload) == true) return true;
        if (this.forcedBinary) {
            this.emitMessage(proto.payload);
        } else {
            this.emitMessage(proto.payload.toString());
        }
        return true;
    }
};
/**
 * 發送訊息
 * @param {Buffer|String} data 資料
 */
FxRevicer.prototype.emitMessage = function (data) {
    if (this.glListener) {
        this.client.delegate.emit("message", {'client':this.client,'data':data});
    } else {
        /**
         * 監聽事件接收的訊息
         *
         * @event FxRevicer#message
         * @type {Object|String|Buffer}
         */
        this.client.emit("message", data);
    }
};
FxRevicer.prototype.emitClose = function () {
    if (this.isRelease) {
    } else if (this.client.constructor.name == "FxSocket") {
        this.client.close();
    } else if (this.client.constructor.name == "FxWebSocketClient") {
        this.client.close();
    }
};
FxRevicer.prototype.emitDestroy = function () {
    if (this.isRelease) {
    } else if (this.client.constructor.name == "FxSocket") {
        this.client.checkFinishTCP();
    } else if (this.client.constructor.name == "FxWebSocketClient") {
        this.client.destroy();
    }
}

/**
 * @typedef proto
 * @param {Boolean} proto.fin 最後一個fragment
 * @param {Boolean} proto.rsv1 驗證1 如果第一包採用deflate/Inflate壓縮方式rsv1=1
 * @param {Boolean} proto.rsv2 驗證2
 * @param {Boolean} proto.rsv3 驗證3
 * @param {Number} proto.opcode 操作碼
 * @param {Boolean} proto.compressed 提供deflate/Inflate壓縮套件
 * @param {Number} proto.total 總長度
 * @param {Buffer} proto.hasMask 是否掩碼鍵
 * @param {Buffer} proto.mask 掩碼鍵
 * @param {Number} proto.start payload開始位置
 * @param {Number} proto.payload_length payload總長度
 * @param {Buffer} proto.payload 暫存封包資料
 * @param {Buffer} proto.msg 重組完封包
 *
 */
/**
 * @callback pollingCallback
 * @param {proto} proto - 封包相關資訊
 */
/**
 * 輪詢檢查數據資料
 * @param {pollingCallback} cb 完成資料解析回應
 * @fires FxRevicer#refresh
 * @description stream on readable
 */
FxRevicer.prototype.polling = function (cb) {
    let loop = true;
    let res;
    while (loop) {
        if (this.mode == fxStatus.websocket) {
            res = this.parser(cb);
        } else if (this.mode == fxStatus.socket) {
            res = this.parserSocket();
        } else if (this.mode == fxStatus.flashSocket) {
            res = this.parserXMLSocket();
        } else if (this.mode == fxStatus.http) {

        } else {
            res = false;
            console.error(Error(util.format("FxRevicer::polling() Error invalid mode '%s'", this.mode)));
        }



        if (res != true) {
            if (typeof res == "string") console.error(Error(res));
            loop = false;
        }
    }
}
/**
 * 更新資料
 * @param {Buffer} chunk streaming data
 */
FxRevicer.prototype.push = function (chunk) {
    if (Buffer.isBuffer(chunk)) {
        this.reader.write(chunk);
    }
};
/**
 * [websocket] 分析資料
 * @param {Function} cb 完成資料解析回應
 */
FxRevicer.prototype.parser = function (cb) {
    let protocol;
    let buf;
    if (typeof this.protocol == "undefined") {
        if (this.reader.valid(2) == false) return false;
        this.protocol = this.basicHeader();
        protocol = this.protocol;

        if (protocol.opcode < 0x00 || protocol.opcode > 0x0F) {
            // Invalid opcode
            return Error("Invalid opcode:" + protocol.opcode);
        }
        if (protocol.opcode >= 8 && !protocol.fin) {
            // Control frames must not be fragmented
            return Error("Control frames must not be fragmented");
        }

    } else {
        protocol = this.protocol;
    }
    let hasMask;
    let payload_length;
    if (typeof protocol.payload_length == "undefined") {
        buf = this.reader.read(1);
        const part = buf.readUInt8(0);
        hasMask = part >> 7; // mask, payload len info
        payload_length = part % 128; //  if 0-125, that is the payload length
        protocol.hasMask = hasMask;
        protocol.start = hasMask ? 6 : 2;
        // Get the actual payload length // 1-7bit = 127
        if (payload_length === 126) {
            const ext1Buf = this.reader.read(2)
            payload_length = ext1Buf.readUInt16BE(0); // a 16-bit unsigned integer
            protocol.start += 2; // If 126, the following 2 bytes interpreted as a 16-bit unsigned integer;

        } else if (payload_length == 127) {
            const ext2Buf = this.reader.read(8);
            // Warning: JS can only store up to 2^53 in its number format
            payload_length = ext2Buf.readUInt32LE(0) * this.INT32_MAX_VALUE + ext2Buf.readUInt32BE(4);
            protocol.start += 8; // If 127, the following 8 bytes interpreted as a 64-bit unsigned integer;
        }
        protocol.payload_length = payload_length;

        protocol.total = protocol.start + payload_length;

        if (hasMask) {
            // if mask start is masking-key,but be init set start 6 so need -4
            // frame-masking-key : 4( %x00-FF )
            protocol.mask = this.reader.read(4);
        }
    } else {
        payload_length = protocol.payload_length;
        hasMask = protocol.hasMask;
    }
    // console.log("payload_length: ", payload_length, this.reader.bufLen, this.reader.valid(payload_length));

    if (this.reader.valid(payload_length) == false) return false;
    // Extract the payload
    protocol.payload = this.reader.read(payload_length);

    if (hasMask) {
        // by c decode

        for (let i = 0; i < protocol.payload.length; i++) {
            // j = i MOD 4 //
            // transformed-octet-i = original-octet-i XOR masking-key-octet-j //
            protocol.payload[i] ^= protocol.mask[i % 4];　// [RFC-6455 Page-32] XOR
        }
        //bufferUtil.unmask(protocol.payload, protocol.mask)
    }

    if (protocol.opcode == 2)
        protocol.msg = protocol.payload;
    else
        protocol.msg = protocol.payload;
    this.protocol = undefined;
    if (cb) cb(protocol);
    return true;
}
/**
 * [websocket] 分析檔頭資料
 * @return {{rsv2: boolean, rsv1: boolean, fin: boolean, rsv3: boolean, compressed: FxRevicer.compressed, opcode: number}}
 */
FxRevicer.prototype.basicHeader = function () {
    const buf  = this.reader.read(1)
    const part = buf.readUInt8(0);
    const fin  = (part & 0x80) == 0x80;
    const rsv1 = (part & 0x40) == 0x40;
    const rsv2 = (part & 0x20) == 0x20;
    const rsv3 = (part & 0x10) == 0x10;
    const opcode = part & 0x0F;
    if (this.first && rsv1 == true) {
        this.compressed = true;
        this.first = false;
    }
    // console.log(part, fin, rsv1, (rsv2 != false || rsv3 != false), "compressed", this.compressed);
    return {
        fin:  fin,
        rsv1: rsv1,
        rsv2: rsv2,
        rsv3: rsv3,
        opcode: opcode,
        compressed: this.compressed
    }
};
/**
 * TODO處理FLASH Native Socket
 * @param {function=} cb 回傳結果
 */
FxRevicer.prototype.parserSocket = function (cb) {
    let buf = this.reader.read(this.reader.bufLen);
    this.emit("data", buf);
    if (typeof this.chunkBuffer == "undefined" || this.chunkBuffer.length <= 0) {
        this.chunkBuffer = Buffer.from(chunk);
    } else {
        this.chunkBuffer = Buffer.concat([this.chunkBuffer, buf], this.chunkBuffer.length + buf.length);
    }
    let arr = this.chunkBuffer.toString().match(this.configure.delimiterRegexp);
    if (typeof arr == "undefined" || arr == null) return false;
    if (this.first) {
        let json = JSON.parse(arr[0]);
        if (json.action == "setup")
        {
            json.delimiterRegexp = this.configure.delimiterRegexp;
            this.options.configure = json;
            this.first = false;
            this.chunksBuffer = this.chunksBuffer.slice(Buffer.byteLength(arr[0]), this.chunksBuffer.length);
            this.emitMessage(json);
        }
    } else {
        for (let i = 0 ; i < arr.length; i++) {
            try {
                const len = Buffer.byteLength(arr[i]);
                let json = JSON.parse(arr[i]);
                this.chunksBuffer = this.chunksBuffer.slice(len, this.chunksBuffer.length);
                arr[i] = undefined;
                this.emitMessage(json);
            } catch (e) {
                console.error(e);
            }
        }
        arr.length = 0;
    }
    return true;
};
/**
 * TODO處理FLASH XMLSocket
 * @param {function=} cb 回傳結果
 */
FxRevicer.prototype.parserXMLSocket = function (cb) {
    const endpoint = this.client;
    let buf = this.reader.read(this.reader.bufLen);
    this.emit("data", buf);
    if (typeof this.chunkBuffer == "undefined" || this.chunkBuffer.length <= 0) {
        this.chunkBuffer = Buffer.from(chunk);
    } else {

        this.chunkBuffer = Buffer.concat([this.chunkBuffer, buf], this.chunkBuffer.length + buf.length);
    }
    let offset = this.chunkBuffer.indexOf("\0");
    let data;
    if (offset != -1) {
        data = this.chunkBuffer.slice(0, offset);
        this.chunkBuffer = chunkBuffer.slice(offset + 1, this.chunkBuffer.length);
        offset = chunkBuffer.indexOf("\0");
        if (endpoint.pingEnable == true && this.recordPing(endpoint, data) == true) return true;
        if (typeof data != "undefined") {
            this.emitMessage(data);
        }
        data = undefined;
        return true;
    } else {
        return false;
    }
};
/**
 * 檢查資料是否ping event
 * @param {String|Buffer} data 資料
 * @return {boolean}
 */
FxRevicer.prototype.recordPing = function (endpoint, data) {

    if (typeof data == "undefined" || data == null) return false;

    if (data.indexOf('"ping":') != -1) {
        const json = JSON.parse(data);
        if (typeof json.ping != "number" && typeof json.rtt != "number") return false;
        
        const ping = endpoint.probeResult(json);
        if (this.glListener)
        {
            this.emit("ping", {client: endpoint, ping: ping});
        }
        else
        {
            endpoint.emit("ping", ping);
        }
        return true;
    }
    return false;
}
/**
 * 回收
 */
FxRevicer.prototype.release = function () {
    this.isRelease = true;
    this.client = undefined;
    this.reader.release();

    if (this.stream) {
        if (this.stream.destroyed) {
            this.stream.close(function () {});
        }
        this.stream = undefined;
    }
};

module.exports = exports = FxRevicer;