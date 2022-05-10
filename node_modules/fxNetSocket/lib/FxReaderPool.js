"use strict";
/**
 * Created by Benson.Liao on 2020/8/14.
 * @file
 * @module FxReaderPool
 * @version 2.0.0
 */
const net       = require("net");
const util      = require("util");
const stream    = require("stream");
const Readable  = stream.Readable;
util.inherits(FxReaderPool, Readable);
/**
 * 自訂Readable Stream 元件
 * @param {module:Readable.ReadableOptions} options Readable參數
 * @version 2.0.0
 * @constructor
 */
function FxReaderPool(options) {
    /** @property {Number} bufLen 計算剩餘長度 */
    this.bufLen = 0;
    /** @property {Number} seq 計算傳送總長度 */
    this.seq = 0;
    Readable.call(this, options);
}
/**
 * 讀取
 * @param n
 * @private
 */
FxReaderPool.prototype._read = function (n) {
    // redundant? see update below
};
/**
 * 清除
 */
FxReaderPool.prototype.stoped = function () {
    // this.push(null);
};
/**
 * 將輸入資料送Readable
 * @param {Buffer} chunk 資料
 */
FxReaderPool.prototype.push = function (chunk) {
    if (Buffer.isBuffer(chunk) === false) return;
    this.bufLen += chunk.byteLength;
    this.seq += chunk.byteLength;
    FxReaderPool.super_.prototype.push.apply(this, arguments);
    // console.log("push",this._readableState.buffer);
};
/**
 * 讀取Readable資料長度
 * @param {Number} n 長度
 * @return {Buffer|*}
 */
FxReaderPool.prototype.read = function (n) {
    if (n == 0) return Buffer.alloc(0);
    this.bufLen -= n;
    return FxReaderPool.super_.prototype.read.apply(this, arguments);
};
/**
 * 驗證資料長度是否足夠
 * @param {Number} n 長度
 * @return {boolean}
 */
FxReaderPool.prototype.valid = function (n) {
    return this.bufLen >= n;
};
/**
 * 總資料量
 * @return {number}
 */
FxReaderPool.prototype.getSequenceNumber = function () {
    return this.seq;
};
/**
 * 回收物件
 */
FxReaderPool.prototype.release = function () {
    FxReaderPool.super_.prototype.read.apply(this);
    if (this.destroy instanceof Function) {
        this.destroy();
    }
};
/**
 * pipe
 * @param chunk
 */
FxReaderPool.prototype.write = function (chunk) {
    if (!Buffer.isBuffer(chunk)) return;
    this.push(chunk);
    this.emit("refresh");
};
/**
 * pipe end
 */
FxReaderPool.prototype.end = function () {
    this.release();
    this.emit("close");
};
module.exports = exports = FxReaderPool;