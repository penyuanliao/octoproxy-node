/**
 * Created by Benson.Liao on 18/06/05.
 */
const net          = require("net");
const util         = require("util");
const EventEmitter = require("events");
const log          = require("../log.js");

util.inherits(AVCParser, EventEmitter);

const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);

function AVCParser(codec) {

    this.setMaxListeners(0);
    EventEmitter.call(this);
    if (typeof codec == "undefined") this.codec = {};
    else this.codec = codec;

    this.sequenceOfHeader = false;

    Object.defineProperty(this, "tsHeader", {
        get:function () {
            if (this.codec) {
                if (Buffer.isBuffer(this.codec) && Buffer.isBuffer(this.codec.pps)) {
                    return Buffer.concat([this.codec.sps, this.codec.pps]);
                } else {
                    return Buffer.alloc(0);
                }
            } else {
                return Buffer.alloc(0);
            }
            },
        enumerable: false,
        configurable:false

    })
}
AVCParser.prototype.cleanUp = function () {
    //h.264
    //0x1F
    //h.265
    //0x7E
};
AVCParser.FrameTypes = {
    KeyFrame: 1,
    InterFrame: 2,
    DisposableInterFrame: 3,
    GeneratedKeyFrame: 4,
    VideoInfo: 5
};
AVCParser.parseNALUHeader = function (buf) {
    log.logHex(buf);
    let offset = 0;
    let params = {};

    // params.forbidden = avc >> 7;
    // params.NRI = (avc & 0x7F) >> 5;
    // params.type = (avc & 0x1F);

    params.videoTagHeader = buf.slice(offset, offset + 5); //AVC metadata
    params.frameType = params.videoTagHeader.readUInt8(0) >> 4;
    params.codecID = params.videoTagHeader.readUInt8(0) & 0xF;
    //AVC = 7
    if (params.codecID == 7) {
        //AVC sequence header:0
        //AVC NALU:1
        //AVC end of sequence: 2
        params.AVCPacketType = params.videoTagHeader.readUInt8(1);
        params.CompositionTime = (params.AVCPacketType == 1) ? params.videoTagHeader.readUInt24BE(2) : 0;
    } else {
        return 0;
    }
    offset += 5;
    // AVCDecoderConfigurationRecord
    params.version = buf.readUInt8(offset++);
    params.indication = buf.readUInt8(offset++); // AVCProfileIndication
    params.compatibility = buf.readUInt8(offset++); // profile_compatibility
    params.level = buf.readUInt8(offset++); //AVCLevelIndication

    //reserved 6bit
    let byte = buf.readUInt8(offset++);
    let reserved = byte >> 2; // 8-bit;
    params.lenSizeMinusOne = (byte & 0x3) + 1; // 2-bit
    if (params.lenSizeMinusOne == 0 || reserved != 0b111111) {
        console.error("AVCDecoderConfigurationRecord sps length size minus == 0", params.lenSizeMinusOne);
        return 0;
    }

    byte = buf.readUInt8(offset++);
    reserved = byte >> 5;
    params.spsNum = (byte & 0x1F); // only one
    if (params.spsNum != 1) return 0;
    params.spsLen = buf.readUInt16BE(offset);
    offset += 2;
    params.sps = buf.slice(offset, offset + params.spsLen);
    offset += params.spsLen;
    params.ppsNum = buf.readUInt8(offset++); // only one
    if (params.ppsNum != 1) return 0;
    params.ppsLen = buf.readUInt16BE(offset);
    offset += 2;
    params.pps = buf.slice(offset, offset + params.ppsLen);
    offset += params.ppsLen;
    return params;
};
AVCParser.prototype.readPrefixHeader = function (buf) {
    let offset = 0;
    const avc = buf.readUInt8(offset++); //1-keyframe
    const avcTag = buf.readUInt8(offset++); //AVC sequence header:0, AVC NALU:1,
    const codecID = avc & 0xF;
    if (avcTag != 0 || codecID == 12) {
        this.codec.naluObj = this.initProfile();
        return null;
    }

    const time = buf.readUInt24BE(offset);
    offset += 3;
    const version = buf.readUInt8(offset++);
    const indication = buf.readUInt8(offset++);
    const compatibility = buf.readUInt8(offset++);
    const level = buf.readUInt8(offset++);
    const lenSizeMinusOne = (buf.readUInt8(offset++) & 3) + 1;

    if (lenSizeMinusOne == 0) {
        this.codec.naluObj = this.initProfile();
        return null;
    }

    const spsNum = (buf.readUInt8(offset++) & 0x1F);
    const spsLen = buf.readUInt16BE(offset);
    offset += 2;
    const sps = buf.slice(offset, offset + spsLen);
    offset += spsLen;
    const ppsNum = buf.readUInt8(offset++);
    const ppsLen = buf.readUInt16BE(offset);
    offset += 2;
    const pps = buf.slice(offset, offset + ppsLen);
    offset += ppsLen;


    this.codec.sps = Buffer.concat([startCode, sps]);
    this.codec.spsLen = sps.byteLength;
    this.codec.pps = Buffer.concat([startCode, pps]);
    this.codec.ppsLen = pps.byteLength;

    this.codec.naluObj = {
        indication: indication,
        lenSizeMinusOne: lenSizeMinusOne
    };
    return {
        sps: this.codec.sps,
        pps: this.codec.pps,
    };
};
AVCParser.prototype.initProfile = function () {
    return {
        indication: 0,
        lenSizeMinusOne: 0
    }
};
/**
 * TS:  Transport Stream
 * PES: Packet Elementary Stream
 * ES:  Elementary Stream
 * @param buf
 */
AVCParser.prototype.appendSPSHeader = function (buf) {
    const lenSizeMinusOne = this.codec.naluObj.lenSizeMinusOne;
    var packets = [];
    var d;
    var size;
    var offset = 0;
    var totalLen = 0;
    if (buf.length < 10) {
        // console.log('appendSPSHeader()', buf);
    }
    var avc = buf.readUInt8(offset++); //1-keyframe

    var avcTag = buf.readUInt8(offset++);

    var time = buf.readUInt24BE(offset);
    offset += 3;

    if (lenSizeMinusOne === 0) return Buffer.alloc(0);

    while (offset < buf.length) {

        size = buf.readUIntBE(offset, lenSizeMinusOne);

        offset += lenSizeMinusOne;
        d = buf.slice(offset, offset + size);
        // packets;
        if (this.sequenceOfHeader && d[0] === 0x65 && d[1] == 0x88) {
            packets.push(this.codec.sps);
            packets.push(this.codec.pps);
        }
        packets.push(startCode);
        packets.push(d);
        //d[0] & this.codec.naluObj.indication; // Frame Type
        totalLen += startCode.byteLength;
        totalLen += d.byteLength;

        offset += size;
    }
    return Buffer.concat(packets, totalLen);
};

AVCParser.NALU_TYPE_SLICE    = 1;
AVCParser.NALU_TYPE_DPA      = 2;
AVCParser.NALU_TYPE_DPB      = 3;
AVCParser.NALU_TYPE_DPC      = 4;
AVCParser.NALU_TYPE_IDR      = 5;
AVCParser.NALU_TYPE_SEI      = 6;
AVCParser.NALU_TYPE_SPS      = 7;
AVCParser.NALU_TYPE_PPS      = 8;
AVCParser.NALU_TYPE_AUD      = 9;
AVCParser.NALU_TYPE_EOSEQ    = 10;
AVCParser.NALU_TYPE_EOSTREAM = 11;
AVCParser.NALU_TYPE_FILL     = 12;

/** indication(0x1f) Frame Type **/
/*    NALU HEAD    */
/* +-------------+ */
/* |0|1|2|3|4|5|6| */
/* +-+-+-+-+-+-+-+ */
/* |F|NRI| TYPE  | */
/* +-------------+ */
AVCParser.TYPE_SEI_FRAME     = 0x06;
AVCParser.TYPE_SLICE_FRAME   = 0x41;
AVCParser.TYPE_IDR_FRAME     = 0x65;
AVCParser.TYPE_S_FRAME       = 0x61;
AVCParser.TYPE_SPS_FRAME     = 0x67;
AVCParser.TYPE_PPS_FRAME     = 0x68;

module.exports = exports = AVCParser;