/**
 * Created by Benson.Liao on 18/06/05.
 */
const net       = require("net");
const util      = require("util");
const stream    = require("stream");
const Transform = stream.Transform;
const amfUtils  = require("../amfUtils.js");
util.inherits(AMFMuxer, Transform);

//TODO AMF FLASH STREAM

function AMFMuxer(delegate, options) {
    this.delegate = delegate;
    this.cached  = [];
    this.preload = [];
    this.videoHeader = {chunkStreamID: 4};
    this.audioHeader = {chunkStreamID: 4};
    this.isRelease = false;
    Transform.call(this, options);
}

AMFMuxer.prototype._transform = function (buf, enc, next) {
    // 將輸入進來的資料直接推送出去
    this.push(buf);
    // 完成這筆資料的處理工作
    next();
};
AMFMuxer.prototype.createStreaming = function (timestamp, typeID, chunkStreamID, body) {
    let rtmpHeader = {
        chunkStreamID: chunkStreamID || 4,
        timestamp: timestamp,
        messageTypeID: typeID,
        messageStreamID: 1,
        fmt: 0
    };

    return [rtmpHeader, body];
};
AMFMuxer.prototype.createStreaming2 = function (header, body) {
    let prevChunkMessage = this.delegate.getOPrevChunkMessage(header.chunkStreamID);

    let prev_ts;
    let prev_typeID;
    let prev_csid;
    let prev_len;
    let rtmpHeader = {
        chunkStreamID: header.chunkStreamID,
        timestamp: header.timestampDelta,
        messageTypeID: header.typeID,
        messageStreamID: header.streamID,
        fmt: 0,
        bodyLen:body.length
    };

    return [rtmpHeader, body];
};
AMFMuxer.prototype.writePacket = function (header, body) {
    if (!this.isRelease) {
        const buf = this.delegate.createRTMPMessage.apply(this.delegate, arguments);
        this.delegate.write(buf);
    }
};
AMFMuxer.prototype.getMetaDataInfo = function (metadata) {
    let rtmpHeader = {
        chunkStreamID: 4,
        timestamp: 0,
        messageTypeID: 0x12,
        messageStreamID: 1
    };
    let opt = {
        cmd: "onMetaData",
        transId: 0,
        cmdObj: metadata || this.delegate.codec.metadata
    };
    const body = amfUtils.encodeAmf0Cmd(opt);
    let packet;

    return [rtmpHeader, body];
};
AMFMuxer.prototype.getVideoInfo = function (code, codecID) {
    if (typeof codecID == "undefined") {
        if (!this.delegate.codec) return false;
        if (!this.delegate.codec.metadata) return false;
        codecID = this.delegate.codec.metadata.videocodecid;
    }
    const header = 0b01010000 + codecID;
    const {
        chunkStreamID
    } = this.videoHeader;
    return this.createStreaming(0, 0x09, chunkStreamID, Buffer.from([header, code]));
};
AMFMuxer.prototype.getNALInfo = function () {

    if (typeof this.delegate != "undefined") {
        var nalu = this.delegate.codec.nalu;
        const {
            chunkStreamID
        } = this.videoHeader;
        return this.createStreaming(0, 0x09, chunkStreamID, nalu);
    }
};
AMFMuxer.prototype.getAACInfo = function () {
    if (typeof this.delegate != "undefined") {
        var aac = this.delegate.codec.aac;
        const {
            chunkStreamID
        } = this.audioHeader;
        return this.createStreaming(0, 0x08, chunkStreamID, aac);
    }
};
AMFMuxer.prototype.loadBegin = function (socket) {};
AMFMuxer.prototype.release = function () {
    this.delegate = undefined;
    this.audioHeader = undefined;
    this.videoHeader = undefined;
    if (this.destroy instanceof Function) {
        this.destroy();
    }
    this.isRelease = true;
};
module.exports = exports = AMFMuxer;