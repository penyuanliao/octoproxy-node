/**
 * Created by Benson.Liao on 18/06/05.
 */
const util      = require("util");
const stream    = require("stream");
const Readable  = stream.Readable;
const Transform = stream.Transform;
const log       = require("./log.js");

util.inherits(FxBufferPool, Readable);

/**
 *
 * @param options
 * @constructor FxBufferPool
 * @constructs read
 */
function FxBufferPool(options) {

    this.bufLen = 0;
    this.seq = 0;

    Readable.call(this, options);
}

FxBufferPool.prototype._read = function (n) {
    // redundant? see update below
};
FxBufferPool.prototype.stoped = function () {
    // this.push(null);
};
FxBufferPool.prototype.push = function (chunk) {
    if (Buffer.isBuffer(chunk) === false) return;
    this.bufLen += chunk.byteLength;
    this.seq += chunk.byteLength;
    FxBufferPool.super_.prototype.push.apply(this, arguments);
    // console.log("push",this._readableState.buffer);
};

FxBufferPool.prototype.read = function (n) {
    if (n == 0) return;
    this.bufLen -= n;
    return FxBufferPool.super_.prototype.read.apply(this, arguments);
};

FxBufferPool.prototype.valid = function (n) {
  return this.bufLen >= n;
};

FxBufferPool.prototype.getSequenceNumber = function () {
    return this.seq;
};
FxBufferPool.prototype.release = function () {
    FxBufferPool.super_.prototype.read.apply(this);
    if (this.destroy instanceof Function) {
        this.destroy();
    }
};
// Monkey-patch Buffer
Buffer.prototype.readUInt24BE = function(offset) {
    return (this.readUInt8(offset) << 16) + (this.readUInt8(offset+1) << 8) + this.readUInt8(offset+2);
};
Buffer.prototype.writeUInt24BE = function(value, offset) {
    this[offset + 2] = value & 0xff;
    this[offset + 1] = value >> 8;
    this[offset] = value >> 16;
};
Buffer.prototype.readUIntBE = function (offset, size) {
    var value = 0;
    var len = 0;
    var mv;
    while (len < size) {
        mv = (8 * (size - len -1));
        value += this[offset + len] << mv;
        len++;
    }

    return value;
};



module.exports = exports = FxBufferPool;