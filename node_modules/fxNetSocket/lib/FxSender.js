/**
 * Created by Benson.Liao on 20/8/5.
 * @version 1.0.0
 */
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const zlib          = require("zlib");
const stream        = require("stream");
const Transform     = stream.Transform;
const log           = require("./log.js");

util.inherits(FxSender, EventEmitter);
/** @const {Buffer} TRAILER inflate結尾 */
const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]); //tailer
/**
 * 壓縮資料資訊
 * @interface CompressInfo
 * @property {Boolean} fin
 * @property {Buffer} FrameInfo#data
 */
/**
 * 發送資料
 * @constructor
 * @version 2.0.0
 */
function FxSender(delegate) {
    EventEmitter.call(this);
    this.delegate = delegate;
    /** @property {Number} INT32_MAX_VALUE int32最大值 */
    this.INT32_MAX_VALUE =  Math.pow(2,32);
    /** @property {Buffer} masking_key 資料掩碼鍵 */
    this.masking_key = Buffer.alloc(4);
    /** @property {Array<Buffer>} chunkBuffer 壓縮資料Stream暫存 */
    this.chunkBuffer = [];
    /** @property {Number} chunkLength 統計chunkBuffer資料長度 */
    this.chunkLength = 0;
    /** @property {module:stream.internal.Transform} wStream 處理ws資料 */
    this.wStream = this.setupTransform();
    /** @property {Boolean} pipelines 是否資料流pipe串聯 */
    this._pipelines = false;
    /** @property {Boolean} isRelease 是否回收 */
    this.isRelease = false;
    /** @property {Array<CompressInfo>} 暫存壓縮清單 */
    this.outQueue = [];
    /** @property {Boolean} pending 等待壓縮flush */
    this.pending = false;
    /** @property {Number} fragmenting 封包拆包次數 */
    this.fragmenting = 0;
    this._comInfo = {
        opcode: 0
    };

    this.setupProp();
}
FxSender.prototype.setupProp = function () {
    Object.defineProperty(this, "pipelines", {
        get: function () {
            return this._pipelines;
        },
        enumerable: true,
        configurable: true
    })
};
/**
 * Stream:Write資料流至客端
 * @description 處理壓縮過Deflate Stream
 * @private
 * @return {module:stream.internal.Transform}
 */
FxSender.prototype.setupTransform = function () {
    const self = this;
    const endpoint = this.delegate;
    const tranform = new Transform();
    tranform._transform = function (data, enc, next) {
        // remove deflate trailer data
        const rmTrailer = data.slice(data.length - TRAILER.byteLength, data.length);
        const fin = (rmTrailer.indexOf(TRAILER) != -1);
        const len = (fin ? data.length - TRAILER.byteLength : data.length);
        const raw = (len == 1) ? Buffer.alloc(0) : data.slice(0, len);
        let opcode = (endpoint._binaryType == 2 ? 2 : 1);
        if (self._comInfo.opcode) {
            opcode = self._comInfo.opcode;
        }
        //console.log("FxSender::transform() fin: %s, opcode: %s, len: %s", fin, opcode, len);
        const payload = self.datafragment(raw, opcode, fin);
        this.push(payload);
        next();
        self._comInfo.opcode = 0;
    };
    tranform.on("close", function () {
        //console.log('_transform close');
    });
    /*
    tranform.on("readable", function () {
        const buf = tranform.read();
        log.logHex(buf)
    })
    */
    tranform._final = function (callback) {
        //console.log('final');
    };
    return tranform;
};
/**
 * 資料流pipelines
 * @param {net.Socket} socket 網路傳輸socket
 * @protected
 */
FxSender.prototype.pipe = function (socket) {
    if (this.wStream) {
        this.createCompress().pipe(this.wStream).pipe(socket);
        this._pipelines = true;
    } else {
        this._pipelines = false;
    }
};
FxSender.prototype.unpipe = function (socket) {
    if (this.wStream) {
        this.createCompress().unpipe(this.wStream).unpipe(socket);
    }
    this._pipelines = false;
};
/**
 * 建立zlib Deflate
 * @public
 * @return {DeflateRaw}
 */
FxSender.prototype.createCompress = function () {
    const endpoint = this;
    if (typeof this.inflate == "undefined") {
        this.inflate = zlib.createDeflateRaw({windowBits: zlib.Z_DEFAULT_WINDOWBITS});
        this.inflate.on("data", (chunk) => this.onCompression(chunk));
    }
    return this.inflate;
};
/**
 * 開始壓縮資料
 * @param {Object} info 壓縮資訊
 * @param {Boolean} info.fin 結束
 * @param {Boolean} info.opcode 事件代號
 * @param {Buffer} info.data 壓縮資料
 * @param {function} callback 回傳完成事件
 * @return {Boolean}
 * @public
 */
FxSender.prototype.compressing = function (info, callback) {
    if (this.isRelease) return false;
    const inflate = this.createCompress();
    const fin = info.fin || true;
    if (this.pending == true) {
        this.outQueue.push(arguments);
        return false;
    }
    this.pending = true;
    this._comInfo.opcode = info.opcode;
    this.inflate.write(info.data);
    this.inflate.flush(zlib.Z_SYNC_FLUSH, () => {
        this.pending = false;
        if (this.isRelease) return;
        const len = (fin ? (this.chunkLength - 4) : this.chunkLength);
        const packaged = Buffer.concat(this.chunkBuffer, len);
        this.chunkBuffer = [];
        this.chunkLength = 0;
        // console.log('compressing zlib:', Buffer.byteLength(packaged));
        if (this.outQueue.length != 0) {
            const next = this.outQueue.shift();
            this.compressing.apply(this, next);
        }
        if (callback) callback(packaged);
    });
    return true;
};
/**
 * 處理完成資料
 * @param {Buffer} chunk
 * @private
 */
FxSender.prototype.onCompression = function (chunk) {
    this.chunkBuffer.push(chunk);
    this.chunkLength += chunk.byteLength;
    //這裡可以寫拆小檔案
};
FxSender.prototype.datafragment = function (payload, opcode, fin) {
    const endpoint = this.delegate;
    if (this.fragmenting > 0) {
        opcode = 0;
    }
    //console.log('[v]fxSender.datafragment.fragmenting:%s, opcode:%s, fin:%s', this.fragmenting, opcode, fin);
    const size = payload.byteLength;
    const basic = this.writeFraming({
        fin: fin,
        opcode: opcode,
        masked: false,
        payload: payload,
        compress: (endpoint.compressed && endpoint.zlibDeflatedEnabled),
    });
    return Buffer.concat([basic, payload], basic.length + size);
};
/**
 * 產生檔頭資訊
 * @param {String} options 參數
 * @param {Boolean} options.fin 封包分段是否最後一包(final fragment)
 * @param {Boolean} options.opcode 資料型態
 * @param {Boolean} options.masked 資料是否遮罩(C->S: TRUE, S->C: FALSE)
 * @param {Boolean} options.payload 資料
 * @param {Boolean} options.compress 是否壓縮資料deflate-stream
 * @public
 * @return {Buffer}
 */
FxSender.prototype.writeFraming = function (options) {
    let fin = options.fin;
    let opcode = options.opcode;
    let masked = options.masked;
    let payload = options.payload;
    let compress = options.compress || false;
    let start, mask, i;
    let len = payload.length;
    // fix Buffer Reusable
    // Creates the buffer for meta-data
    let meta = Buffer.allocUnsafe(2 + (len < 126 ? 0 : (len < 65536 ? 2 : 8)) + (masked ? 4 : 0));
    // Sets fin and opcode
    if (compress) {
        meta[0] = (fin << 7);
        if (this.fragmenting == 0 && opcode <= 2) {
            meta[0] += (compress << 6)
        }
        meta[0] += opcode;
    }
    else {
        meta[0] = (fin ? 128 : 0) + opcode;
    }
    // Sets the mask and length
    meta[1] = masked ? 128 : 0;
    start = 2;
    if (len < 126) {
        meta[1] += len;
    } else if (len < 65536) {
        meta[1] += 126;
        meta.writeUInt16BE(len, 2);
        start += 2
    } else {
        // Warning: JS doesn't support integers greater than 2^53
        meta[1] += 127;
        meta.writeUInt32BE(Math.floor(len / this.INT32_MAX_VALUE), 2);
        meta.writeUInt32BE(len % this.INT32_MAX_VALUE, 6);
        start += 8;
    }

    // Set the mask-key 4 bytes(client only)
    if (masked) {
        mask = this.masking_key;
        // mask = crypto.randomBytes(4);
        // bufferUtil.mask(payload, mask, payload, start, payload.length);
        for (i = 0; i < 4; i++) {
            meta[start + i] = mask[i] = Math.floor(Math.random() * 256);
        }
        for (i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
        start += 4;
    }
    if (fin == false) {
        this.fragmenting++;
    } else {
        this.fragmenting = 0;
    }

    return meta;
};
/**
 * 回收
 */
FxSender.prototype.release = function () {
    if (this.pipelines) {
        this.unpipe(this.delegate.socket);
    }
    if (this.wStream) {
        if (this.wStream.destroyed) this.wStream.destroy();
        this.wStream = undefined;
    }
    if (this.inflate) {
        if (this.inflate.destroyed) this.inflate.close(function () {});
        this.inflate = undefined;
    }
    this.outQueue.length = 0;
    this.pending = false;
    this.delegate = undefined;
    this.chunkBuffer = undefined;
    this.chunkLength = 0;
    this.isRelease = true;
};
module.exports = exports = FxSender;