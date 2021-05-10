/**
 * Created by Benson.Liao on 18/06/05.
 */
const util     = require("util");
const stream   = require("stream");
const Readable = stream.Readable;
util.inherits(FLVMuxer, Readable);

const FPS = {
    "60": 16,
    "30": 33,
    "10": 100
};
const FPS_FRAME = {
    "60": [16,   17,  17],
    "30": [33,   33,  34],
    "10": [100, 100, 100],
};
/**
 *
 * @param delegate
 * @param [options]
 * @param {Number} [options.muxerCnf] prev time
 */
function FLVMuxer(delegate, options) {
    this.delegate   = delegate;
    /** flvHeader, metadata **/
    this.flvHeader  = Buffer.from([0x46, 0x4C, 0x56, 0x01, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00]);
    /** @type {Buffer} fileHeader NALU Header, AAC Header **/
    this.fileHeader = undefined;
    this.audioHeader = undefined;
    this.videoHeader = undefined;
    this.fileHeaderReady = false;
    this.hasAbnormalEnabled = false;
    this.abortCount = 0;
    /** timestamp **/
    this.ts         = 0;
    this.compositionTime = {};
    this.vcount     = 0;
    this.acount     = 0;
    this.hasAudio   = true;
    this.hasVideo   = true;
    this.fps        = FPS["10"];
    this.setMaxListeners(0);
    Readable.call(this, options);
    this.on('readable', function (arg) {
        this.read(); //live streaming
    });
    this.lockHeader = true;

}
FLVMuxer.prototype.cleanUp = function (bool) {
    this.vcount     = 0;
    this.acount     = 0;
    if (this.lockHeader == false || bool === true) {
        this.flvHeader  = Buffer.from([0x46, 0x4C, 0x56, 0x01, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00]);
        this.fileHeader = undefined;
        if (this.audioHeader) this.prevAudioHeader = this.audioHeader;
        this.audioHeader = undefined;
        if (this.videoHeader) this.prevVideoHeader = this.videoHeader;
        this.videoHeader = undefined;
        this.fileHeaderReady = false;
    }
    this.read();
};
/**
 * @param typeID
 * @param [msg]
 * @param [msg.timestamp]
 * @param [msg.streamID]
 * @param [msg.ctrl]
 * @param [msg.type]
 * @param [msg.body]
 */
FLVMuxer.prototype.encode = function (typeID, msg) {
    if (typeof this.compositionTime == "undefined") this.compositionTime = {};
    if (typeof this.compositionTime[msg.streamID] == "undefined") this.compositionTime[msg.streamID] = 0;

    let packet;
    let ctrl = -1;
    let skip = false;
    if (typeID === PacketType.PACKET_TYPE_METADATA) {
        packet = this.metadataEncode(msg);
        skip = true;
    } else if (typeID === PacketType.PACKET_TYPE_AUDIO) {
        packet = this.audioEncode(msg);

        if (msg.body.length <= 0 || msg.body.length > 2 && (ctrl = msg.body.readUInt8(1)) == 0) {
            skip = true;
        }
    } else if (typeID === PacketType.PACKET_TYPE_VIDEO) {
        if (msg.body.length >= 2) ctrl = msg.body.readUInt8(0);
        if ( msg.body.length >= 2 && (ctrl == 0x17 && msg.body.readUInt8(1) == 0 || ctrl == 0x57)) {
            skip = true;
        }
        else if ( msg.body.length >= 2 && (ctrl == 0x1c && msg.body.readUInt8(1) == 0 || ctrl == 0x5c)) {
            skip = true;
        }
        packet = this.videoEncode(msg);
    }

    if (this.hasAudio == false && typeID === PacketType.PACKET_TYPE_AUDIO) {

    } if (skip) {

    } else {
        this.push(packet);
        this.delegate.emit("onFlvSession", packet, ctrl);
    }
    if (typeof this.delegate != "undefined") {
        this.delegate.config.muxerCnf.ts = this.compositionTime;
    }
    return packet;
};
/**
 * video
 * @param [msg]
 * @param [msg.timestamp]
 * @param [msg.streamID]
 * @param [msg.ctrl]
 * @param [msg.type]
 * @param [msg.body]
 */
FLVMuxer.prototype.videoEncode = function (msg) {
    var packet;
    var preTagSize;
    var body      = msg.body;
    var timestamp = msg.timestamp;
    const chunkStreamID  = msg.streamID;
    const streamID = 0;
    var payload   = undefined;


    if (this.hasAudio == false) timestamp = (this.fps - timestamp);
    const prev = this.compositionTime[chunkStreamID];
    this.compositionTime[chunkStreamID] += timestamp;

    if (prev == this.compositionTime[chunkStreamID]) {
        if (this.vcount > 200 && (this.abortCount++ > 10)) {
            this.compositionTime[chunkStreamID] += this.fps;
            if (this.hasAbnormalEnabled == false) {
                this.hasAbnormalEnabled = true;
                this.emit("abnormal");
            }
        }
    } else {
        this.abortCount = 0;
    }
    timestamp = this.compositionTime[chunkStreamID];
    packet =  Buffer.alloc(11, 0);
    packet[0] = 0x09;                            // 1bit tagType
    this.writeUInt24BE(packet, body.length, 1);  // 1-3 bit data len
    packet[4] = (timestamp >> 16) & 0xFF;
    packet[5] = (timestamp >> 8) & 0xFF;
    packet[6] = timestamp & 0xFF;
    packet[7] = (timestamp >> 24) & 0xFF;
    this.writeUInt24BE(packet, streamID, 8);            // 8-11 bit StreamID (Always 0)
    preTagSize = Buffer.alloc(4, 0);
    // this.writeUInt24BE(preTagSize, body.length + fileHeader.length, 1);
    preTagSize.writeUInt32BE(body.length + packet.length, 0);
    packet = Buffer.concat([packet, body, preTagSize], body.length + packet.length + preTagSize.length);

    if (this.vcount === 0) {
        // payload = (typeof this.fileHeader == "undefined") ? this.flvHeader : this.fileHeader;
        // this.fileHeader = Buffer.concat([payload, packet]);
    }
    this.vcount++;
    return packet;
};
/**
 * audio
 * @param [msg]
 * @param [msg.timestamp]
 * @param [msg.streamID]
 * @param [msg.ctrl]
 * @param [msg.type]
 * @param [msg.body]
 */
FLVMuxer.prototype.audioEncode = function (msg) {
    var packet;
    var preTagSize;
    var body      = msg.body;
    var timestamp = msg.timestamp;
    const chunkStreamID  = msg.streamID;
    const streamID = 0;
    var payload   = undefined;

    this.compositionTime[chunkStreamID] += timestamp;
    timestamp = this.compositionTime[chunkStreamID];
    packet =  Buffer.alloc(11, 0);               // 1-4bit pre tag size
    packet[0] = 0x08;                            // 5bit tagType
    this.writeUInt24BE(packet, body.length, 1);  // 1-3 bit data len
    packet[4] = (timestamp >> 16) & 0xFF;
    packet[5] = (timestamp >> 8) & 0xFF;
    packet[6] = timestamp & 0xFF;
    packet[7] = (timestamp >> 24) & 0xFF;
    this.writeUInt24BE(packet, streamID, 8);            // 8-11 bit StreamID (Always 0)
    preTagSize = Buffer.alloc(4, 0);
    preTagSize.writeUInt32BE(body.length + packet.length, 0);
    packet = Buffer.concat([packet, body, preTagSize], body.length + packet.length + preTagSize.length);

    if (this.acount === 0) {
        // payload = (typeof this.fileHeader == "undefined") ? this.flvHeader : this.fileHeader;
        // this.fileHeader = Buffer.concat([payload, packet]);
        if (body.length == 0) return packet;
    }

    this.acount++;

    return packet;
};
/**
 * flv Packet onMetadata is Script Data (0x12) on streaming info.
 * @param {Object} [msg]
 * @param {Number} [msg.timestamp]
 * @param {Number} [msg.streamID]
 * @param {Buffer} [msg.body]
 */
FLVMuxer.prototype.metadataEncode = function (msg) {
    let packet;
    var preTagSize;
    var body = msg.body;
    var timestamp = msg.timestamp;
    const chunkStreamID  = msg.streamID;
    const streamID = 0;

    if (this.hasAudio === true) this.flvHeader[4] |= 1 << 2;
    if (this.hasVideo === true) this.flvHeader[4] |= 1;
    preTagSize    = Buffer.alloc(4, 0);
    var tagHeader = Buffer.alloc(11, 0);
    tagHeader[0] = 0x12; // 1bit tagType
    this.writeUInt24BE(tagHeader, body.length, 1);  // 2-4 bit DataLength
    tagHeader.writeUInt32BE(timestamp, 4);  // 5-8 bit timestamp
    this.writeUInt24BE(tagHeader, streamID, 9); // 9-11 bit StreamID (Always 0)
    preTagSize.writeUInt32BE(body.length + tagHeader.length, 0);
    if (this.flvHeader.length == 13) {
        packet = Buffer.concat([this.flvHeader.slice(0, 13), tagHeader, body, preTagSize], this.flvHeader.length + body.length + tagHeader.length + preTagSize.length);
        this.flvHeader = packet;
    } else {
        const fileHeader = Buffer.from([0x46, 0x4C, 0x56, 0x01, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00]);
        packet = Buffer.concat([fileHeader, tagHeader, body, preTagSize]);
        this.flvHeader = packet;
    }
    return packet;
};
/**
 * flv Packet onMetadata is Script Data (0x12) on streaming info.
 * @param {Object} [msg]
 * @param {Number} [msg.timestamp]
 * @param {Number} [msg.streamID]
 * @param {Buffer} [msg.body]
 * @description | tag(1) | size(3) | timestamp(3) | timestamp_extended(1) | streamID(3) | body_tag(1) | data(n) | previous tag size (3) |
 */
FLVMuxer.scriptDataEncode = function (msg) {
    const streamID = 0;
    const body = msg.body || Buffer.alloc(0);
    let packet;
    let tagHeader = Buffer.allocUnsafe(11);

    tagHeader.writeUInt8(0x12, 0); // tag

    tagHeader.writeUIntBE(body.length, 1, 3); // size

    tagHeader.writeUIntBE(streamID, 8, 3); // timestamp

    let preTagSize = Buffer.allocUnsafe(4);

    preTagSize.writeUInt32BE(body.length + tagHeader.length, 0);

    packet = Buffer.concat([tagHeader, body, preTagSize]);

    return packet;
};

FLVMuxer.prototype.setGroupOfPictures = function (msg, packet) {
    if (msg.body[0] == 0x17) {
        this.currFrame = Buffer.from(packet);
    } else if (typeof this.currFrame != "undefined") {
        this.currFrame = Buffer.concat([this.currFrame, packet]);
    }
};

FLVMuxer.prototype.writeUInt24BE = function(buffer,value, offset) {
    buffer[offset + 2] = value & 0xff;
    buffer[offset + 1] = value >> 8;
    buffer[offset] = value >> 16;
};
FLVMuxer.prototype._read = function (n) {
    // redundant? see update below
};

const PacketType = {
    PACKET_TYPE_NONE : 				0x00,
    PACKET_TYPE_CHUNK_SIZE: 		0x01,
    PACKET_TYPE_BYTES_READ: 		0x03,
    PACKET_TYPE_CONTROL:			0x04,
    PACKET_TYPE_SERVERBW:			0x05,
    PACKET_TYPE_CLIENTBW:			0x06,
    PACKET_TYPE_AUDIO:				0x08,
    PACKET_TYPE_VIDEO:				0x09,
    /*
    PACKET_TYPE_FLEX_STREAM_SEND:	0x0f,
    PACKET_TYPE_FLEX_SHARED_OBJECT:	0x10,
    PACKET_TYPE_FLEX_MESSAGE:		0x11,
    */
    PACKET_TYPE_METADATA:			0x12,
    PACKET_TYPE_SHARED_OBJECT:		0x13,
    PACKET_TYPE_INVOKE:				0x14,
    PACKET_TYPE_AGGREGATE:			0x16

};

module.exports = exports = FLVMuxer;

/**
 * @namespace FLVMuxer.unpipe
 */
