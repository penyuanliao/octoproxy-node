/**
 * Created by Benson.Liao on 18/06/05.
 */
const net             = require("net");
const util            = require("util");
const EventEmitter    = require("events");
const Transform       = require('stream').Transform;
const FxBufferPool    = require("./FxBufferPool.js");
const SharedManager   = require("./SharedManager.js");
const AVCParser       = require("./Codec/AVCParser.js");
const FLVMuxer        = require("./Codec/FLVMuxer.js");
const AMFMuxer        = require("./Codec/AMFMuxer.js");
const log             = require("./log.js");
const amfUtils        = require("./amfUtils.js");
// const amfUtils     = require("./Codec/amfUtils.js");
const Crypto          = require("crypto");
const fxNetSocket     = require('fxNetSocket');
const NSLog           = fxNetSocket.logger.getInstance();

const SHA256 = 32;

const RTMP_SIG_SIZE = 1536;

const MESSAGE_FORMAT_0 = 0;

const MESSAGE_FORMAT_1 = 1;

const MESSAGE_FORMAT_2 = 2;

const S1Header = Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]);

const RandomCrud = Buffer.from([
    0xf0, 0xee, 0xc2, 0x4a, 0x80, 0x68, 0xbe, 0xe8,
    0x2e, 0x00, 0xd0, 0xd1, 0x02, 0x9e, 0x7e, 0x57,
    0x6e, 0xec, 0x5d, 0x2d, 0x29, 0x80, 0x6f, 0xab,
    0x93, 0xb8, 0xe6, 0x36, 0xcf, 0xeb, 0x31, 0xae
]);

const GenuineFMSConst = "Genuine Adobe Flash Media Server 001";
const GenuineFMSConstCrud = Buffer.concat([Buffer.from(GenuineFMSConst, "utf8"), RandomCrud]);

const GenuineFPConst = "Genuine Adobe Flash Player 001";
const GenuineFPConstCrud = Buffer.concat([Buffer.from(GenuineFPConst, "utf8"), RandomCrud]);

const BasicHeaderSize = [11, 7, 3 , 0];
/** 資料每包大小 **/
const MessagePacketDefault = 4096;

/**
 *
 * @param delegate
 * @param options
 * @constructor
 */
function MediaClient(delegate, options) {
    EventEmitter.call(this);
    this.delegate = delegate;
    this.config = {
        audio_support:true,
        notStream:false
    };
    if (typeof options != "undefined") this.config = options;
    if (typeof this.config.audio_support == "undefined") {
        this.config.audio_support = true;
    }
    if (typeof this.config.notStream == "undefined") {
        this.config.notStream = false;
    }
    if (typeof this.config.muxerCnf == "undefined") {
        this.config.muxerCnf = {};
    }
    this.hasStarting  = false;

    this.inChunkSize  = 128;
    this.outChunkSize = 128;

    this._transId = 0;
    this.transName = {};

    this.hasReceiveAudio = false;
    this.hasReceiveVideo = false;
    this.isPaused = false;
    this.playing  = false;

    this.codec = {
        metadata:{
            width: 0,
            height: 0,
            duration: 0,
            framerate: 0,
            videocodecid: null,
            videodatarate:0,
            audiocodecid:null,
            audiosamplerate: 0,
            audiosamplesize: 0,
            audiodatarate: 0,
            audiochannels: 0,
            stereo: false,
            encoder: null
        },
        spsLen: 0,
        sps: null,
        ppsLen: 0,
        pps: null,
        naluLen:0,
        nalu: null,
        aacLen: 0,
        aac: null
    };
    this.videoSeq = 0;

    this.id = Math.floor(Math.random() * 1000).toString(32) + Math.floor(Math.random() * 1000).toString(32) + Math.floor(Math.random() * 1000).toString(32);
    this.publishStreamName = '';
    this.playStreamName = '';
    this.playStreamID   = 0;
    this.readStream = new FxBufferPool();
    this.avcParser  = new AVCParser(this.codec);
    this.flvMuxing  = new FLVMuxer(this);
    this.amfMuxing  = new AMFMuxer(this);
    this.flvMuxing.hasAudio = this.config.audio_support;
    this.flvMuxing.compositionTime = (typeof this.config.muxerCnf != "undefined") ? (this.config.muxerCnf.compositionTime || {}) : {} ;
    this.flvMuxing.on("abnormal", function () {
        NSLog.log("warning", "============ Abnormal Timestamp into /%s/ ============", this.vName);
        this.applyServer();
    }.bind(this));
    this.currChunkMessage = undefined;
    this.prevChunkMessage = {}; // Incoming Packet
    this.oPrevChunkMessage = {}; // Outgoing Packet

    //處理BINDER事件
    this.binder = {
        enabled: false, //開關
        mode: "receive", //transmit, receive
        packet: [],
    };
    /** ping request **/
    this.pingTimestamp = 0;
    this.ttl = 0;

    Object.defineProperty(this, "transId", {
        get:function () {
            this._transId = this._transId % 0x100000000;
            this._transId++;
            return this._transId; },
        enumerable: false,
        configurable: false
    });

}
util.inherits(MediaClient, EventEmitter);

/**
 * 廣播視訊client連結
 * @param socket
 * @param {Number|Object}[options]
 * @param {Boolean} [options.binding]
 * @param {Number} [options.timeout]
 */
MediaClient.prototype.setup = function (socket, options) {
    if (typeof socket != "undefined") this.socket = socket;
    let timeout = 60000;
    let binding = false;

    if (typeof options == "number") {
        timeout = options;
    } else if (typeof options == "object") {
        timeout = (options.timeout || 60000);
        binding = options.binding || false;
    }
    this.socket.setTimeout(timeout);
    this.onConnection(this.socket, binding);
};
MediaClient.prototype.setupSRCStream = function () {
    var transform = new Transform();
    transform._transform = function (data, enc, next) {
        this.push(data);
        // 完成這筆資料的處理工作
        next();
    };

    this.srcStream = transform;

};
/** Publish a live stream as Node.js media Server **/
MediaClient.prototype.onConnection = function (socket, binding) {
    NSLog.log("info", "onConnection(): %s pass: %s", socket.remoteAddress, binding);
    const self = this;
    let received;
    socket.hsState = MediaClient.STATE.UNINITIALIZED;
    const handshakeHandle = function handshakeHandle(chunk) {
        self.readStream.push(chunk);
        if (socket.hsState == MediaClient.STATE.UNINITIALIZED) {
            received = self.C0C1Handshake(self.readStream, socket);
            if (received) socket.hsState = MediaClient.STATE.VERSION_RECD;
        }
        if (socket.hsState == MediaClient.STATE.VERSION_RECD) {
            received = self.C2Handshake(self.readStream);
            if (received) socket.hsState = MediaClient.STATE.HANDSHAKE_DONE;
        }
        if (socket.hsState == MediaClient.STATE.HANDSHAKE_DONE) {

            if (self.binder.enabled && self.binder.mode == "transmit") {
                if (self.readStream.bufLen == 0) return;
                self.binder.packet.push(chunk.slice(chunk.length - self.readStream.bufLen, chunk.length));
                parseIncoming();
                return;
            }

            if (self.readStream.bufLen !== 0) {
                socket.removeListener("data", handshakeHandle);
                socket.on("data", messageHandle);
                parseIncoming();
            }
            received = undefined;
        }
    };
    var messageHandle = function messageHandle(chunk) {

        self.readStream.push(chunk);
        parseIncoming();
    };

    var parseIncoming = function parseIncoming() {
        var message;

        while (self.readStream.bufLen > 0) {

            if (typeof self.currChunkMessage === "undefined") {
                message = self.parseRTMPMessage(self.readStream, socket);
            } else {
                message = self.currChunkMessage;
            }
            if (message == -1) {
                socket.destroy();
                return;
            }
            if (typeof message != "undefined" && message.hasExtTS != true) {
                message.hasExtTS = self.extendedTimestamp(self.readStream, message);
                if (message.hasExtTS == false) return;
            }
            if (typeof message != "undefined" && message.hasParseBody != true) {
                message.hasParseBody = self.parseBody(self.readStream, message);
                if (message.hasParseBody == false) return;
            }
        }
        // NSLog.log("debug", 'parseIncoming ended:', self.readStream.bufLen);
    };
    if (binding) {
        socket.on("data", messageHandle);
    } else {
        socket.on("data", handshakeHandle);
    }

    socket.on("error", function onError(err) {
        NSLog.log("error", "Socket.Error() # %s %s", err.code, err.message);
        self.emit("error", err);
    });
    socket.on("timeout", function onTimeout() {
        NSLog.log("warning", "Socket.Timeout()");
        socket.end();
    });
    socket.on("close", function onClose() {
        NSLog.log("warning", "Socket.Close() /%s/", self.playStreamName);
        self.emit("close");
        self.release();
    })

};
MediaClient.hasHandshake = function (chunk) {
    if (chunk.length <= 9) return false;

    const version = chunk.readUInt8(0);
    if (version !== 0x03) return false;
    const timestamp = chunk.readUInt32BE(1);
    if (timestamp === 0x00) return false;
    const fixedZeros = chunk.readUInt32BE(5);
    if (fixedZeros !== 0x00) return false;
    return true;
};
/**
 * The handshake begins with the client sending the C0 and C1 chunks.
 * @param {FxBufferPool} stream
 * @param {Socket} socket
 * @return {boolean}
 * @constructor
 */
MediaClient.prototype.C0C1Handshake = function (stream, socket) {
    var buf = stream.read(1537);
    if (!buf || buf == null) {
        return false;
    }
    NSLog.log("info", "+ rtmp handshake [ START ]");
    var C0C1   = buf;
    var type   = C0C1.slice(0, 1);
    var other  = C0C1.slice(1);
    var messageFormat = this.generateS0S1S2(other);
    var output;

    if (messageFormat == MESSAGE_FORMAT_0) {
        output = Buffer.concat([type, other, other])
    } else {
        output = Buffer.concat([type, this.generateS1(messageFormat), this.generateS2(messageFormat, other)]);
    }
    socket.write(output);
    return true;
};
/**
 * The client MUST wait until S1 has been received before sending C2.
 * @param {FxBufferPool} stream
 * @return {boolean}
 * @constructor
 */
MediaClient.prototype.C2Handshake = function (stream) {
    if (stream.bufLen < 1536) return false;
    var buf = stream.read(1536);
    if (!buf || buf == null) {
        return false;
    }
    NSLog.log("info", "+ rtmp handshake [ OK ]");
    return true;

};
/**
 * The server MUST wait until C0 has been received before sending S0 and
 * S1, and MAY wait until after C1 as well. The server MUST wait until
 * C1 has been received before sending S2. The server MUST wait until
 * C2 has been received before sending any other data.
 * @param {Buffer} data
 * @return {number}
 */
MediaClient.prototype.generateS0S1S2 = function (data) {
    var sdl    = getServerOffset(data.slice(772, 776));
    var msg    = Buffer.concat([data.slice(0, sdl), data.slice(sdl + SHA256)], 1504);
    var csig   = createHmac(msg, GenuineFMSConst);
    var psig   = data.slice(sdl, sdl + SHA256);

    if (csig.equals(psig)) return MESSAGE_FORMAT_2;

    sdl = getClientOffset(data.slice(8, 12));
    msg = Buffer.concat([data.slice(0, sdl), data.slice(sdl + SHA256)], 1504);
    csig = createHmac(msg, GenuineFMSConst);
    psig   = data.slice(sdl, sdl + SHA256);

    if (csig.equals(psig)) return MESSAGE_FORMAT_1;

    return MESSAGE_FORMAT_0;

};
MediaClient.prototype.generateS1 = function (msgFmt) {
    var randomBytes    = Crypto.randomBytes(RTMP_SIG_SIZE - 8);

    var handshakeBytes = Buffer.concat([S1Header, randomBytes], RTMP_SIG_SIZE);

    var srvDigOffset;

    if (msgFmt === 1) {
        srvDigOffset = getClientOffset(handshakeBytes.slice(8, 12));
    } else {
        srvDigOffset = getServerOffset(handshakeBytes.slice(772, 776));
    }
    var msg = Buffer.concat([handshakeBytes.slice(0, srvDigOffset), handshakeBytes.slice(srvDigOffset + SHA256)], RTMP_SIG_SIZE - SHA256);

    var hash = createHmac(msg, GenuineFMSConst);

    hash.copy(handshakeBytes, srvDigOffset, 0, 32);

    return handshakeBytes;
};
MediaClient.prototype.generateS2 = function (msgFmt, data) {
    var randomBytes = Crypto.randomBytes(RTMP_SIG_SIZE - 32);
    var offset;
    if (msgFmt === 1) {
        offset = getClientOffset(data.slice(8, 12));
    } else {
        offset = getServerOffset(data.slice(772, 776));
    }
    var challengeKey = data.slice(offset, offset + 32);
    var hash = createHmac(challengeKey, GenuineFMSConstCrud);
    var signature = createHmac(randomBytes, hash);
    return Buffer.concat([randomBytes, signature], RTMP_SIG_SIZE);
};
MediaClient.prototype.parseRTMPMessage = function (stream) {
    var message = {};
    var basicHeader;
    var exStreamID;
    var chunkMessageHeader;
    var prevChunk;
    if (stream.valid(1) == false) return;
    if (typeof this.basicHeader == "undefined") {
        basicHeader = stream.read(1);
        if (basicHeader == null || typeof basicHeader == "undefined") {
            NSLog.log("error", 'at MediaClient.parseRTMPMessage() BasicHeader is null. This property cannot be called on Null values.');
            return;
        }
        this.basicHeader = basicHeader;
    } else {
        basicHeader = this.basicHeader;
    }

    message.fmt = basicHeader.readUInt8(0) >> 6;
    message.chunkStreamID = basicHeader.readUInt8(0) & 0x3F;
    if (message.chunkStreamID === 0) {
        if (stream.valid(1) == false) return;
        exStreamID = stream.read(1);
        message.chunkStreamID =  exStreamID.readUInt8(0) + 64;


    } else if (message.chunkStreamID === 1) {
        if (stream.valid(2) == false) return;
        exStreamID = stream.read(2);
        message.chunkStreamID = (exStreamID.readUInt8(1) << 8) + exStreamID.readUInt8(0) + 64;
    }
    if (stream.valid(BasicHeaderSize[message.fmt]) == false) return;

    if (message.fmt == 0) {
        chunkMessageHeader = stream.read(11);
        message.timestamp  = chunkMessageHeader.readUInt24BE(0);
        message.timestampDelta = 0;
        message.messageLength = chunkMessageHeader.readUInt24BE(3);
        message.typeID  = chunkMessageHeader.readUInt8(6);
        message.streamID = chunkMessageHeader.readUInt32LE(7);
        prevChunk = this.prevChunkMessage[message.chunkStreamID];
        if (typeof prevChunk != "undefined") {
            message.timestamp = prevChunk.timestamp;
        }
    } else if (message.fmt == 1) {
        chunkMessageHeader = stream.read(7);
        message.timestampDelta = chunkMessageHeader.readUInt24BE(0);
        message.messageLength = chunkMessageHeader.readUInt24BE(3);
        message.typeID  = chunkMessageHeader.readUInt8(6);
        prevChunk = this.prevChunkMessage[message.chunkStreamID];
        if (typeof prevChunk != "undefined") {
            message.timestamp = prevChunk.timestamp;
            message.streamID = prevChunk.streamID;
        } else {
            NSLog.log("error", "[%s] Chunk reference error for type 1: previous chunk for id %s is not found.", basicHeader[0], message.chunkStreamID );
            return -1;
        }

    } else if (message.fmt == 2) {
        chunkMessageHeader = stream.read(3);
        message.timestampDelta  = chunkMessageHeader.readUInt24BE(0);
        prevChunk = this.prevChunkMessage[message.chunkStreamID];
        if (typeof prevChunk != "undefined") {
            message.timestamp = prevChunk.timestamp;
            message.streamID  = prevChunk.streamID;
            message.messageLength  = prevChunk.messageLength;
            message.typeID    = prevChunk.typeID;
        } else {
            NSLog.log("error", "[%s] Chunk reference error for type 2: previous chunk for id %s is not found", basicHeader[0], message.chunkStreamID);
            return -1;
        }
    } else if (message.fmt == 3) {
        prevChunk = this.prevChunkMessage[message.chunkStreamID];
        if (typeof prevChunk != "undefined") {
            message.timestamp = prevChunk.timestamp;
            message.streamID  = prevChunk.streamID;
            message.messageLength  = prevChunk.messageLength;
            message.timestampDelta = prevChunk.timestampDelta;
            message.typeID    = prevChunk.typeID;
        } else {
            NSLog.log("error", "[%s] Chunk reference error for type 3: previous chunk for id %s is not found", basicHeader[0], message.chunkStreamID);
            return -1;
        }
    } else {
        NSLog.log("error", "Unknown format type: " + message.fmt);
    }

    if (message.streamID > 10) {
        return -1;
    }

    this.currChunkMessage = message;

    return message;

};
MediaClient.prototype.extendedTimestamp = function (stream, message) {
    var chunkBodyHeader;
    if (message.fmt === 0) {
        if (message.timestamp === 0xffffff) {
            if (stream.valid(4) == false) return false;
            chunkBodyHeader = stream.read(4);
            message.timestamp = (chunkBodyHeader.readUInt8(0) * Math.pow(256, 3)) +
                (chunkBodyHeader.readUInt8(1) << 16) +
                (chunkBodyHeader.readUInt8(2) << 8) +
                chunkBodyHeader.readUInt8(3);
        }
    } else if (message.timestampDelta === 0xffffff) {
        if (stream.valid(4) == false) return false;
        chunkBodyHeader = stream.read(4);
        message.timestampDelta = (chunkBodyHeader.readUInt8(0) * Math.pow(256, 3)) +
            (chunkBodyHeader.readUInt8(1) << 16) +
            (chunkBodyHeader.readUInt8(2) << 8) +
            chunkBodyHeader.readUInt8(3)
    }
    return true;
};
/** filter C4 **/
MediaClient.prototype.parseBody = function (stream, message) {
    var rtmpBody      = [];
    var msgLen        = message.messageLength;
    var chunkBodySize = this.realBodySize(msgLen, this.inChunkSize);
    if (stream.valid(chunkBodySize) == false) return false;
    var chunkBody     = stream.read(chunkBodySize);
    var offset        = 0;
    var len           = 0;
    var packet;
    //slice data
    do {
        if (msgLen > this.inChunkSize) {
            packet = chunkBody.slice(offset, offset + this.inChunkSize);
            len += packet.byteLength;
            rtmpBody.push(packet);
            msgLen -= this.inChunkSize;
            offset += this.inChunkSize;
            offset++;
        } else if (msgLen != 0) {
            packet = chunkBody.slice(offset, offset + msgLen);
            len += packet.byteLength;
            rtmpBody.push(packet);
            msgLen -= msgLen;
            offset += msgLen;
        } else {
            NSLog.log("debug", "ParseBody() No data body.", stream.bufLen);
        }

    } while (msgLen > 0);

    message.timestamp += (message.timestampDelta || 0);
    if (typeof this.prevChunkMessage[message.chunkStreamID] == "undefined") this.prevChunkMessage[message.chunkStreamID] = {};
    if (message.typeID != 4) {
        this.prevChunkMessage[message.chunkStreamID] = message;
    }
    var bodyBuf = Buffer.concat(rtmpBody, len);

    // bodyBuf = this.validPacketControl(bodyBuf);

    this.currChunkMessage = undefined;
    this.basicHeader = undefined;
    // DATA AMF TYPE UNKNOWN //
    try {
        this.handleRTMPMessage(message, bodyBuf);
    } catch (e) {
        NSLog.log("error", "handleRTMPMessage() Error:", message, e, "\n", log.logHex(bodyBuf));
    }

    return true;

};
MediaClient.prototype.handleRTMPMessage = function (header, buf) {
    var PacketType = MediaClient.PacketType;
    var cmd;
    // NSLog.log("trace", '# handleRTMPMessage().typeID', header.typeID);
    switch (header.typeID) {
        case PacketType.PACKET_TYPE_CHUNK_SIZE:
        {
            this.inChunkSize = buf.readUInt32BE(0);

            NSLog.log("info", "#4 Income Chunk size maximum value. [ %s ]", this.inChunkSize);

            break;
        }
        case PacketType.PACKET_TYPE_CONTROL:
        {
            var userControlMessage = parseUserControlMessage(buf);
            if (userControlMessage.eventType === 3) {
                var streamID = userControlMessage.streamID;
                var bufferLength = userControlMessage.bufferLength;
                NSLog.log("debug", "[handleRTMPMessage][0x04] BufferLength:%s streamID=%s", bufferLength, streamID);
            } else if (userControlMessage.eventType === 7) {
                var timestamp = userControlMessage.timestamp;
                NSLog.log("debug", "[handleRTMPMessage][0x04] timestamp:%s", timestamp);
            } else if (userControlMessage.eventType === MediaClient.EventType.PING_REQUEST) {
                NSLog.log("trace","[handleRTMPMessage][0x04] PING_REQUEST: %s, ttl:%s", userControlMessage.timestamp, this.ttl);
                this.emit("onPingRequest");
                this.pingResponse(userControlMessage.timestamp);
            } else if (userControlMessage.eventType === MediaClient.EventType.STREAM_BEGIN) {
                NSLog.log("info", "#5 Stream Begin", userControlMessage)
            } else if (userControlMessage.eventType === MediaClient.EventType.BUFFER_EMPTY) {
            } else if (userControlMessage.eventType === MediaClient.EventType.BUFFER_READY) {
            } else {
                NSLog.log("debug", "[handleRTMPMessage][0x04]", header, userControlMessage);
            }
            break;
        }
        case PacketType.PACKET_TYPE_SERVERBW:
        {
            this.parseWindowACKSize(header, buf);
            break;
        }
        case PacketType.PACKET_TYPE_CLIENTBW:
        {
            this.parsePeerBandwidth(header, buf);
            break;
        }
        case PacketType.PACKET_TYPE_AUDIO:
        {
            this.parseAudioMessage(header, buf);
            break;
        }
        case PacketType.PACKET_TYPE_VIDEO:
        {
            this.parseVideoMessage(header, buf);
            break;
        }
        case PacketType.PACKET_TYPE_FLEX_STREAM_SEND:
        {
            // 0x0F AMF3 Data Message
            cmd = amfUtils.decodeAmf0Cmd(buf.slice(1, buf.bufferLength));
            this.handleAMFDataMessage(cmd);
            break;
        }
        case PacketType.PACKET_TYPE_FLEX_MESSAGE:
        {
            // 0x11 AMF3 Invoke Command
            cmd = amfUtils.decodeAmf0Cmd(buf.slice(1, buf.bufferLength));
            this.handleAMFCommandMessage(cmd, header);
            break;
        }
        case PacketType.PACKET_TYPE_METADATA:
        {
            // onGetFPS 資料無法解析
            const indexFPS = buf.indexOf("onGetFPS");
            if (indexFPS != -1) {
                if (buf[0] != 0x02) {
                    buf = Buffer.concat([buf.slice(4, buf.length), Buffer.alloc(4)]);
                }
            }
            // 0x12 AMF0 Data Message
            cmd = amfUtils.decodeAmf0Cmd(buf);
            this.handleAMFDataMessage(cmd);
            break;
        }
        case PacketType.PACKET_TYPE_INVOKE:
        {
            // 0x14 AMF0 Invoke Command
            cmd = amfUtils.decodeAmf0Cmd(buf);
            this.handleAMFCommandMessage(cmd, header);
            break;
        }
        case PacketType.PACKET_TYPE_AGGREGATE:
        {
            this.handleAggregateMessages(header, buf);
            break;
        }
    }
};
/** fixed-Length append to slice length **/
MediaClient.prototype.realBodySize = function (size, chunkSize) {
    var total = size + Math.floor(size / chunkSize);
    if (size % chunkSize) {
        return total;
    } else if ((total -1) < 0) {
        return 0;
    } else {
        return total -1;
    }
};
MediaClient.prototype.parseAudioMessage = function (header, buf) {
    NSLog.log("trace", 'parseAudioMessage()', header.messageLength, header);
    var msg = {
        timestamp:header.timestampDelta,
        streamID: header.chunkStreamID,
        body:buf
    };
    const flvMuxing = this.flvMuxing;
    const fileHeader = flvMuxing.encode(MediaClient.PacketType.PACKET_TYPE_AUDIO, msg);
    if (this.codec.aacLen == 0 && buf.length != 0) {
        NSLog.log("info",'Audio HexLog:', fileHeader.toString('hex'));
        if ((buf[1] % 0xff) != 0) {
            NSLog.log("warning",'Audio buf[1] %s != 0.', (buf[1] % 0xff));
            if (this.socket) this.socket.end();
        } else {
            flvMuxing.audioHeader = fileHeader;
        }
        this.codec.aac = buf;
        this.codec.aacLen = buf.length;
        if (this.amfMuxing) this.amfMuxing.audioHeader = header;
        const payload = (typeof flvMuxing.fileHeader == "undefined") ? flvMuxing.flvHeader : flvMuxing.fileHeader;
        flvMuxing.fileHeader = Buffer.concat([payload, fileHeader], payload.length + fileHeader.length);
        if (flvMuxing.audioHeader && flvMuxing.videoHeader) {
            flvMuxing.fileHeaderReady = true;
            this.emit("fileHeaderReady");
        }
        NSLog.log("info", "[Ready: %s]Initial AAC Audio headers. Beginning of header: %s bytes", flvMuxing.fileHeaderReady, flvMuxing.fileHeader.length);

    } else {
    }
    this.emit("audioData", buf, header);
};
MediaClient.prototype.parseVideoMessage = function (header, buf) {
    const ctrl = buf.readUInt8(0);
    NSLog.log("trace", "at MediaClient.parseVideoMessage() Ctrl:%s", ctrl.toString(16), header);
    let msg = {
        timestamp:header.timestampDelta,
        streamID:header.chunkStreamID,
        body:buf,
        ctrl:buf[0]
    };
    const flvMuxing = this.flvMuxing;
    let fileHeader = flvMuxing.encode(MediaClient.PacketType.PACKET_TYPE_VIDEO, msg);
    if (buf[0] === MediaClient.CONTROL_ID.KEY_FRAME_H264 || buf[0] === MediaClient.CONTROL_ID.KEY_FRAME_H265) {
/*        if (typeof this.delegate != "undefined" && typeof this.delegate.nodeCache != "undefined") {
            this.delegate.nodeCache.bulk("setMemCaching", {key:this.config.videoPaths, value:flvMuxing.ts}, function (err, result) {});
        }*/
    }
    if (this.codec.naluLen == 0 && (buf[0] === MediaClient.CONTROL_ID.KEY_FRAME_H264 || buf[0] === MediaClient.CONTROL_ID.KEY_FRAME_H265)) {
        this.codec.nalu = buf;
        this.codec.naluLen = buf.length;
        if (this.amfMuxing) this.amfMuxing.videoHeader = header;
        let res = this.avcParser.readPrefixHeader(buf);
        let bool = true;
        if (buf[0] === MediaClient.CONTROL_ID.KEY_FRAME_H265) res = true;
        if (res == null) {
            NSLog.log("warning", "Unable to parse AVCDecoderConfigurationRecord.");
            bool = false;
        }
        if (buf.length == 0) {
            NSLog.log("warning", "parseVideoMessage() header buf == 0");
            if (this.socket) this.socket.end();
            bool = false;
        } else {
            flvMuxing.videoHeader = fileHeader;
        }
        if (bool) {
            var payload = (typeof flvMuxing.fileHeader == "undefined") ? flvMuxing.flvHeader : flvMuxing.fileHeader;
            flvMuxing.fileHeader = Buffer.concat([payload, fileHeader]);
            if (flvMuxing.audioHeader && flvMuxing.videoHeader) {
                flvMuxing.fileHeaderReady = true;
                this.emit("fileHeaderReady");
            } else if (this.codec.metadata && !this.codec.metadata.audiodevice) {
                flvMuxing.fileHeaderReady = true;
                if (this.codec.metadata.videocodecid == null) {
                    this.codec.metadata.videocodecid = (buf[0] & 0xf);
                }
                this.emit("fileHeaderReady");
            }

            NSLog.log("info", "[Ready: %s]Initial %s/NALU Video headers. Beginning of header: %s bytes", flvMuxing.fileHeaderReady, MediaClient.CodecID[(buf[0] & 0xf)], flvMuxing.fileHeader.length);
        }
    }
    else if (this.videoSeq >= 2 && (
        (buf[0] == MediaClient.CONTROL_ID.KEY_FRAME_H264 || buf[0] == MediaClient.CONTROL_ID.INTER_FRAME_H264) ||
        (buf[0] == MediaClient.CONTROL_ID.KEY_FRAME_H265 || buf[0] == MediaClient.CONTROL_ID.INTER_FRAME_H265)) ) {
        var packaging = this.avcParser.appendSPSHeader(buf);
        // Recording last keyframe
/*
        if (buf[0] == MediaClient.CONTROL_ID.KEY_FRAME_H264) this.curVideoData = undefined;
        if (typeof this.curVideoData == "undefined") this.curVideoData = packaging;
        else this.currChunkMessage = Buffer.concat([this.curVideoData, packaging]);
*/

        this.emit("videoDataTS", packaging);

    } else {
        NSLog.log("info", "at MediaClient.parseVideoMessage() CTRL:", MediaClient.CONTROL_ID_Marker[buf[0]]);
    }
    if (this.videoSeq > 100 && (this.videoSeq % 100) == 0) {
        if (flvMuxing.fileHeaderReady != true) this.socket.end();
    }
    this.videoSeq++;

    this.emit("videoData", buf, header);

};
MediaClient.prototype.parseWindowACKSize = function (header, buf) {
    const acknowledgement = buf.readUInt32BE(0);
    NSLog.log("debug", "[Init] Window Acknowledgement Size (MessageTypeID=0x05)", acknowledgement);
    this.ackMaximum = acknowledgement;
    this.acknowledgementSize = acknowledgement;
};
MediaClient.prototype.parsePeerBandwidth = function (header, buf) {
    const peerBandwidth = buf.readUInt32BE(0);
    const limitType     = buf.readUInt8(4);
    NSLog.log("debug","[Init] Set Peer Bandwidth (MessageTypeID=0x06): %s limitType: %s", peerBandwidth, limitType);
    this.peerBandwidth = peerBandwidth;
};
/**
 * @setDataFrame
 * @param {object} [cmd]
 * @param {string} [cmd.cmd]
 * @param {string} [cmd.method]
 * @param {number} [cmd.byteLength]
 * @param {number} [cmd.transId]
 * @param {object} [cmd.cmdObj]
 * @param {boolean} [cmd.bool1] |RtmpSampleAccess only
 * @param {boolean} [cmd.bool2] |RtmpSampleAccess only
 */
MediaClient.prototype.handleAMFDataMessage = function (cmd) {
    if (cmd.cmd === "@setDataFrame") {
        this.receiveSetDataFrame("onMetaData", cmd.cmdObj);
    } else if (cmd.cmd === "onMetaData") {
        this.receiveSetDataFrame(cmd.cmd, cmd.cmdObj);
    } else if (cmd.cmd === "|RtmpSampleAccess") {
        //bool1, bool2
        this.emit("rtmpSampleAccess", cmd.bool1, cmd.bool2)
    } else if (cmd.cmd === "onGetFPS") {
        this.emit("onGetFPS", cmd.cmdObj);
    } else {
        NSLog.log("error", "handleAMFDataMessage.cmd:", cmd);
    }
};
/****
 * create flv metadata packet
 * @param method
 * @param obj
 */
MediaClient.prototype.receiveSetDataFrame = function (method, obj) {
    NSLog.log("trace", "receiveSetDataFrame() method:", method);
    if (method === "onMetaData") {

        this.codec.metadata = obj;
        this.flvMuxing.fps = Math.ceil(1000/obj.framerate);
        var tag = amfUtils.amf0encString(method);
        var type = Buffer.from([0x08, 0x00, 0x00, 0x00, 0x09, 0x00]);
        var data = amfUtils.amf0encObject(obj);
        if (obj.videocodecid == null || typeof obj.videocodecid == "undefined" || obj.videocodecid == "") {
            if (this.socket) this.socket.end();
            NSLog.log("warning", "onMetaData n/a", JSON.stringify(obj, null, '\t'));
        }
        var metadata = Buffer.concat([tag, type, data.slice(2, data.length)]);
        var msg = {
            timestamp:0,
            streamID:0,
            body:metadata
        };
        this.flvMuxing.cleanUp();
        this.videoSeq = 0;
        this.flvMuxing.encode(MediaClient.PacketType.PACKET_TYPE_METADATA, msg);

    }
};
/***
 * Invoke Message
 * @param [cmd]
 * @param [cmd.cmd]
 * @param [header]
 */
MediaClient.prototype.handleAMFCommandMessage = function (cmd, header) {
    NSLog.log("trace", "handleAMFCommandMessage.cmd:%s", cmd.cmd); //JSON.stringify(cmd, null, '\t')

    this.emit("command", cmd);
    if (cmd.cmd === "_error" || cmd.cmd === "_result") {
        this.responder(cmd);
    } else if (typeof this[cmd.cmd] != "undefined") {
        this[cmd.cmd](cmd, header);
    } else if (typeof this.delegate[cmd.cmd] != "undefined") {
        this.delegate[cmd.cmd](cmd, header);
    } else {
        NSLog.log("error", "%s server not found.", cmd.cmd);
    }

};
MediaClient.prototype.handleAggregateMessages = function (header, buf) {
    NSLog.log("error", "handleAggregateMessages()");
    var aggregateMessages = new FxBufferPool();
    aggregateMessages.push(buf);
    var message;
    while (aggregateMessages.bufLen > 0) {
        message = this.parseAggregateMessage(aggregateMessages);
        this.parseBody(aggregateMessages, message);
    }
};
MediaClient.prototype.parseAggregateMessage = function (stream, tMessage) {
    var message = {};
    var chunkMessageHeader;
    chunkMessageHeader = stream.read(11);
    message.chunkStreamID = tMessage.chunkStreamID;
    message.timestampDelta = chunkMessageHeader.readUInt24BE(0);
    message.messageLength = chunkMessageHeader.readUInt24BE(3);
    message.typeID  = chunkMessageHeader.readUInt8(6);
    message.streamID = chunkMessageHeader.readUInt32LE(7);
    message.timestamp = tMessage.timestamp;

    return message;
};
/** api command **/
MediaClient.prototype.connect = function (cmd) {
    NSLog.log("info", "MediaClient.connect()", cmd);

    this.connectCmdObj = cmd.cmdObj;
    this.app = this.connectCmdObj.app;
    this.objectEncoding = (cmd.cmdObj.objectEncoding != null) ? cmd.cmdObj.objectEncoding : 0.0;
    this.outChunkSize = MessagePacketDefault;
    this.setWindowACK(2500000);
    this.setPeerBandwidth(2500000, 2);
    this.setChunkSize(this.outChunkSize);
    this.respondConnect(cmd.transId);
    this.emit("connect", cmd);
};
MediaClient.prototype.initCodec = function () {
    this.codec = {
        metadata:{
            width: 0,
            height: 0,
            duration: 0,
            framerate: 0,
            videocodecid: null,
            videodatarate:0,
            audiocodecid:null,
            audiosamplerate: 0,
            audiosamplesize: 0,
            audiodatarate: 0,
            audiochannels: 0,
            stereo: false,
            encoder: null
        },
        spsLen: 0,
        sps: null,
        ppsLen: 0,
        pps: null,
        naluLen:0,
        nalu: null,
        aacLen: 0,
        aac: null
    };
    this.avcParser.codec = this.codec;
};
/** 回應connect事件 **/
MediaClient.prototype.respondConnect = function (transId) {
    let rtmpHeader = {
        chunkStreamID: 3,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: 0
    };
    let opt = {
        cmd: "_result",
        transId: transId,
        cmdObj: {
            fmsVer:"FMS/3,0,1,123",
            capabilities: 31.0
        },
        info: {
            level: "status",
            code: "NetConnection.Connect.Success",
            description: 'Connection succeeded.',
            objectEncoding: this.objectEncoding,
            data:{version:"3,0,1,123"}
        }
    };
    let body = amfUtils.encodeAmf0Cmd(opt);

    const message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);
    NSLog.log("info", "++ rtmp connection [ OK ]");
};
MediaClient.prototype.sendStatusMessage = function (sid, level, code, desc, details) {
    let rtmpHeader = {
        chunkStreamID: 4,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: sid
    };
    let opt = {
        cmd: "onStatus",
        transId: 0,
        cmdObj: null,
        info: {
            level: level,
            code: code,
            description: desc,
            details: details
        }
    };
    let body = amfUtils.encodeAmf0Cmd(opt);

    const message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);
};
MediaClient.prototype.respondRejectConnect = function (transId) {
    let rtmpHeader = {
        chunkStreamID: 3,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: 0
    };
    let opt = {
        cmd: "_error",
        transId: transId,
        cmdObj: {
            fmsVer:"FMS/3,0,1,123",
            capabilities: 31
        },
        info: {
            level: 'error',
            code: 'NetConnection.Connect.Rejected',
            description: 'Connection failed.',
            objectEncoding: this.objectEncoding
        }
    };
    let body = amfUtils.encodeAmf0Cmd(opt);
    const message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);
};
MediaClient.prototype.respondFailed = function (transId) {
    let rtmpHeader = {
        chunkStreamID: 3,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: 0
    };
    let opt = {
        cmd: "_error",
        transId: transId,
        cmdObj: {
            fmsVer:"FMS/3,0,1,123",
            capabilities: 31
        },
        info: {
            level: 'error',
            code: 'NetConnection.Call.Failed',
            description: 'Method not found (releaseStream).',
            objectEncoding: this.objectEncoding
        }
    };
    let body = amfUtils.encodeAmf0Cmd(opt);
    const message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);
};
MediaClient.prototype.close = function (cmd) {
    NSLog.log("warning", "close()", cmd);
};
MediaClient.prototype.release = function () {
    if (this.readStream.bufLen > 0) this.readStream.release();
    this.readStream       = new FxBufferPool();
    this.currChunkMessage = undefined;
    this.basicHeader      = undefined;
    this._transId         = 0;
    this.transName        = {};
    this.inChunkSize      = 128;
    this.outChunkSize     = 128;
    if (typeof this.handshake != "undefined") {
        this.handshake.release();
        this.handshake = undefined;
    }

    this.flvMuxing.cleanUp();
    this.flvMuxing = undefined;
    this.amfMuxing.release();
    this.amfMuxing = undefined;
    this.avcParser.codec = undefined;
    this.avcParser = undefined;
    this.videoSeq = 0;
    if (typeof this.socket != "undefined") {
        this.socket.removeAllListeners("data");
        this.socket.removeAllListeners("error");
        this.socket.removeAllListeners("connect");
        this.socket.removeAllListeners("close");
        this.socket.removeAllListeners("end");
    }
    this.currChunkMessage = undefined;
    this.prevChunkMessage = {};
    this.deleteOPrevChunkMessage();
};

MediaClient.prototype.getOPrevChunkMessage = function (chunkStreamID) {
    if (this.oPrevChunkMessage instanceof Map) {
        return this.oPrevChunkMessage.get(chunkStreamID) || null;
    } else {
        return this.oPrevChunkMessage[chunkStreamID] || null;
    }
};
MediaClient.prototype.setOPrevChunkMessage = function (chunkStreamID, header) {
    if (this.oPrevChunkMessage instanceof Map) {
        this.oPrevChunkMessage.set(chunkStreamID, header);
    } else {
        this.oPrevChunkMessage[chunkStreamID] = header;
    }
};
MediaClient.prototype.deleteOPrevChunkMessage = function () {
    if (this.oPrevChunkMessage instanceof Map) {
        this.oPrevChunkMessage.clear();
    } else {
        const keys = Object.keys(this.oPrevChunkMessage);
        for (let i = 0; i < keys.length; i++) {
            delete this.oPrevChunkMessage[keys[i]];
        }
    }
};
MediaClient.prototype.responder = function (cmd) {
    var action = this.transName[cmd.transId] + cmd.cmd;
    this.transName[cmd.transId] = undefined;
    delete this.transName[cmd.transId];
    if (cmd.cmd === "_error") {
        if (typeof this.delegate[action] != "undefined") {
            this.delegate[action](cmd);
        } else if (typeof this[action] != "undefined") {
            this[action](cmd);
        } else {
            NSLog.log("error", "%s action not found.", action);
        }
    } else if (cmd.cmd === "_result") {

        if (typeof this.delegate[action] != "undefined") {
            this.delegate[action](cmd);
        } else if (typeof this[action] != "undefined") {
            this[action](cmd);
        } else {
            NSLog.log("error", "%s action not found.", action);
        }
    }
};
MediaClient.prototype.onStatus = function (cmd, header) {
    NSLog.log("info", "onStatus()", cmd, header);
};
/** client create new live stream **/
MediaClient.prototype.createStream = function (cmd) {
    NSLog.log("debug", 'MediaClient.createStream()');
    var rtmpHeader = {
        chunkStreamID: 3,
        timestamp: 0,
        messageTypeID: MediaClient.PacketType.PACKET_TYPE_INVOKE,
        messageStreamID: 0
    };
    var opt = {
        cmd: "_result",
        transId: cmd.transId,
        cmdObj: null,
        info: 1
    };
    var body = amfUtils.encodeAmf0Cmd(opt);
    var message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);
    this.emit("createStream", cmd);
};
MediaClient.prototype.releaseStream = function (cmd) {
    NSLog.log("info", "releaseStream()", cmd);
    this.emit("releaseStream", cmd);
};
MediaClient.prototype.deleteStream = function (cmd) {
    NSLog.log("debug", "MediaClient.deleteStream()", cmd);
    this.emit("deleteStream", cmd);
};
MediaClient.prototype.closeStream = function (cmd) {

};
MediaClient.prototype.FCPublish = function (cmd) {
    NSLog.log("info", 'FCPublish()');
};
MediaClient.prototype.FCUnpublish = function (cmd) {
    NSLog.log("info", 'FCUnpublish', cmd);
};
MediaClient.prototype.publish = function (cmd) {
    NSLog.log("info", '++ Publish', cmd);
    if (cmd.type === "live" && cmd.streamName == "") {
        this.publishStreamName = this.connectCmdObj.app;
        //this.playStreamName = this.connectCmdObj.app;
    } else {
        this.publishStreamName = this.connectCmdObj.app + '/' + cmd.streamName;
    }

    if (this.respondPublish()) {
        this.emit("publish", cmd);
    }
};

MediaClient.prototype.respondPublish = function () {
    let rtmpHeader = {
        chunkStreamID: 5,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: 1
    };
    let opt;
    var state = true;
    if (typeof SharedManager.producers.get(this.publishStreamName) != "undefined" &&
        SharedManager.producers.get(this.publishStreamName).release == false) {

        opt = {
            cmd: 'onStatus',
            transId: 0,
            cmdObj: null,
            info: {
                level: 'error',
                code: 'NetStream.Publish.BadName',
                description: 'Stream already publishing'
            }
        };
        state = false;
    } else {
        opt = {
            cmd: 'onStatus',
            transId: 0,
            cmdObj: null,
            info: {
                level: 'status',
                code: 'NetStream.Publish.Start',
                description: 'Start publishing'
            }
        };
    }



    var rtmpBody = amfUtils.encodeAmf0Cmd(opt);
    var rtmpMessage = this.createRTMPMessage(rtmpHeader, rtmpBody);
    this.write(rtmpMessage);

    return state;
};
MediaClient.prototype.publishNotify = function (bool) {
    let rtmpHeader = {
        chunkStreamID: 5,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: 1
    };
    const opt = {
        cmd: 'onStatus',
        transId: 0,
        cmdObj: null,
        info: {
            level: 'status',
            code: (bool ? "NetStream.Play.PublishNotify" : "NetStream.Play.UnpublishNotify"),
            description: 'Start publishing'
        }
    };
    const rtmpBody = amfUtils.encodeAmf0Cmd(opt);
    let rtmpMessage = this.createRTMPMessage(rtmpHeader, rtmpBody);
    const res = this.write(rtmpMessage);
    if (res == false) {}
};
MediaClient.prototype.netStreamEvent = function (code, description) {
    let rtmpHeader = {
        chunkStreamID: 5,
        timestamp: 0,
        messageTypeID: MediaClient.PacketType.PACKET_TYPE_INVOKE,
        messageStreamID: 1
    };
    let opt = {
        cmd: 'onStatus',
        transId: 0,
        cmdObj: null,
        info: {
            level: 'status',
            code: code
        }
    };
    if (description) opt.info.description = description;
    const rtmpBody = amfUtils.encodeAmf0Cmd(opt);
    const rtmpMessage = this.createRTMPMessage(rtmpHeader, rtmpBody);
    this.write(rtmpMessage);
};
/** client play **/
MediaClient.prototype.play = function (cmd, header) {
    NSLog.log("info", "++ MediaClient.play()", cmd);
    var words = this.connectCmdObj.app.split("");
    this.playStreamID   = header.streamID;
    this.playing        = true;
    if (words[words.length-1] == "/") {
        this.playStreamName = this.connectCmdObj.app + cmd.streamName;

    } else {
        this.playStreamName = this.connectCmdObj.app + '/' + cmd.streamName;
    }
    this.respondPlay(cmd);
    this.emit("play", this.playStreamName);
};
MediaClient.prototype.play2 = function (cmd) {
    NSLog.log("info", "++ MediaClient.play2()", cmd);
};
MediaClient.prototype.respondPlay = function (cmd) {
    this.setChunkSize(MessagePacketDefault);
    this.sendStreamStatus(MediaClient.EventType.STREAM_BEGIN, this.playStreamID);
    this.sendStatusMessage(this.playStreamID, "status", "NetStream.Play.Reset", util.format("Playing and resetting %s.", cmd.streamName), cmd.streamName);
    this.sendStatusMessage(this.playStreamID, "status", "NetStream.Play.Start", util.format("Started playing %s.", cmd.streamName), cmd.streamName);
    this.sendRtmpSampleAccess(this.playStreamID);
};
MediaClient.prototype.sendRtmpSampleAccess = function (sid) {
    var rtmpHeader = {
        chunkStreamID: 4,
        timestamp: 0,
        messageTypeID: MediaClient.PacketType.PACKET_TYPE_METADATA,
        messageStreamID: sid
    };
    var opt = {
        cmd: "|RtmpSampleAccess",
        transId: 0,
        bool1: false,
        bool2: false
    };
    var body = amfUtils.encodeAmf0Cmd(opt);

    var message = this.createRTMPMessage(rtmpHeader, body);

    this.write(message);
};
MediaClient.prototype.pause = function (cmd) {
    this.isPaused = cmd.pause;
    //TODO paused video event
    if (this.isPaused) {

    } else {

    }
};
MediaClient.prototype.receiveAudio = function (cmd) {
    this.hasReceiveAudio = cmd.bool;

};
MediaClient.prototype.receiveVideo = function (cmd) {
    this.hasReceiveVideo = cmd.bool;
};

MediaClient.prototype.setWindowACK = function (size) {
    var rtmpBuffer = Buffer.from('02000000000004050000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    this.write(rtmpBuffer);
};
MediaClient.prototype.setAcknowledgement = function (size) {
    NSLog.log('trace','Acknowledgement:%s', size);
    var rtmpBuffer = Buffer.from('420000000000040300000000', 'hex');
    if (size >= 0xFFFFFFF) {
        rtmpBuffer.writeUInt32BE(size, 8);
        this.write(rtmpBuffer);
    } else {
        rtmpBuffer = Buffer.from('42000000000008030000000000000000', 'hex');
        var firstBit32 = Math.floor(size/0x100000000);
        var secondBit32 = size - (firstBit32 * 0x100000000);
        rtmpBuffer.writeUInt32BE(firstBit32, 8);
        rtmpBuffer.writeUInt32BE(secondBit32, 12);
        this.write(rtmpBuffer);
    }
};
/**
 * 0x06 – Set Peer Bandwidth
 * @param size
 * @param type
 */
MediaClient.prototype.setPeerBandwidth = function (size, type) {
    var rtmpBuffer = Buffer.from('0200000000000506000000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    rtmpBuffer[16] = type;
    this.write(rtmpBuffer);
};
/**
 * 0x01 – Set Chunk Size
 * @param size
 */
MediaClient.prototype.setChunkSize = function (size) {
    var rtmpBuffer = Buffer.from('02000000000004010000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    this.write(rtmpBuffer);
};
MediaClient.prototype.pingRequest = function (num) {
    NSLog.log("debug", "pingRequest", num);
    let rtmpHeader = {
        chunkStreamID: 2,
        timestamp: 0,
        messageTypeID: MediaClient.PacketType.PACKET_TYPE_CONTROL,
        messageStreamID: 0
    };
    let body = Buffer.allocUnsafe(6);
    body.writeInt16BE(MediaClient.EventType.PING_RESPONSE, 0);
    body.writeUInt32BE((num % 4294967295),2);
    let message = this.createRTMPMessage(rtmpHeader, body);
    if (this.socket) this.write(message);
};
MediaClient.prototype.setOnGetFPS = function (num) {

    let obj = { cmd: 'onGetFPS', byteLength: 11, cmdObj: num };
    let body = amfUtils.encodeAmf0Cmd(obj);
    let rtmpHeader = {
        chunkStreamID: 5,
        timestamp: 0,
        messageTypeID: MediaClient.PacketType.PACKET_TYPE_METADATA,
        messageStreamID: 1
    };
    let message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);
};
/** 0x18 - Ping Message **/
MediaClient.prototype.pingResponse = function (num, type) {
    NSLog.log("debug", "pingResponse", num, type);

    var rtmpBuffer = Buffer.from('4200000000000604000700000000', 'hex');
    rtmpBuffer.writeUInt32BE(num, 10);
    if (typeof type != "undefined") rtmpBuffer[9] = 0x03;
    this.write(rtmpBuffer);
    this.ttl = (this.pingTimestamp - num);
    this.pingTimestamp = num;
};

MediaClient.prototype.sendStreamStatus = function (eventType, streamID) {
    var rtmpBuffer = Buffer.from('020000000000060400000000000000000000', 'hex');
    rtmpBuffer.writeUInt16BE(eventType, 12);
    rtmpBuffer.writeUInt32BE(streamID, 14);
    this.write(rtmpBuffer);
};

/** object to buffer **/
MediaClient.prototype.createRTMPMessage = function (header, body) {
    let fmt = 0;
    let bodySize = body.length;
    if (header.chunkStreamID == null || typeof header.chunkStreamID == "undefined") {
        NSLog.log("error", "createRTMPMessage(): chunkStreamID is not found");
    }
    if (header.timestamp == null || typeof header.timestamp == "undefined") {
        NSLog.log("error", "createRTMPMessage(): timestamp is not found");
    }
    if (header.messageTypeID == null || typeof header.messageTypeID == "undefined") {
        NSLog.log("error", "createRTMPMessage(): messageTypeID is not found");
    }
    if (header.messageStreamID == null || typeof header.messageStreamID == "undefined") {
        NSLog.log("error", "createRTMPMessage(): messageStreamID is not found");
    }
    if (typeof header.fmt != "undefined") {
        fmt = header.fmt;
    }
    fmt = this.headerFormatter(header, bodySize);

    var useExtendedTimestamp = false;
    var timestamp;
    if (header.timestamp >= 0xffffff) {
        useExtendedTimestamp = true;
        timestamp = [0xff, 0xff, 0xff];
    } else {
        timestamp = [(header.timestamp >> 16) & 0xff, (header.timestamp >> 8) & 0xff, header.timestamp & 0xff];
    }
    var basicHeader = rtmpChunkBasicHeaderCreate(fmt, header.chunkStreamID)[0];
    var buf;
    if (fmt == 0) {
        buf = Buffer.from([
            basicHeader,
            timestamp[0],
            timestamp[1],
            timestamp[2],
            (bodySize >> 16) & 0xff,
            (bodySize >> 8) & 0xff,
            bodySize & 0xff,
            header.messageTypeID,
            header.messageStreamID & 0xff,
            (header.messageStreamID >>> 8) & 0xff,
            (header.messageStreamID >>> 16) & 0xff,
            (header.messageStreamID >>> 24) & 0xff
        ]);
    } else if (fmt == 1) {
        buf = Buffer.from([
            basicHeader,
            timestamp[0],
            timestamp[1],
            timestamp[2],
            (bodySize >> 16) & 0xff,
            (bodySize >> 8) & 0xff,
            bodySize & 0xff,
            header.messageTypeID
        ]);
    } else if (fmt == 2) {
        buf = Buffer.from([
            basicHeader,
            timestamp[0],
            timestamp[1],
            timestamp[2]
        ]);
    } else {
        buf = Buffer.from([basicHeader]);
    }

    if (useExtendedTimestamp) {
        var extendedTimestamp = Buffer.from([
            (header.timestamp >> 24) & 0xff,
            (header.timestamp >> 16) & 0xff,
            (header.timestamp >> 8) & 0xff,
            header.timestamp & 0xff
        ]);
        buf = Buffer.concat([buf, extendedTimestamp], buf.length + extendedTimestamp.length);
    }

    var offset = 0;
    // var chunkBodySize = this.realBodySize(bodySize, this.outChunkSize);
    var chunkBody = [];
    var basicHeader3 = rtmpChunkBasicHeaderCreate(3, header.chunkStreamID);
    do {
        if (bodySize > this.outChunkSize) {
            chunkBody.push(body.slice(offset, offset + this.outChunkSize));
            bodySize -= this.outChunkSize;
            offset += this.outChunkSize;
            chunkBody.push(basicHeader3);
        } else {
            chunkBody.push(body.slice(offset, offset + bodySize));
            offset   += bodySize;
            bodySize -= bodySize;
        }
    } while ( bodySize > 0);
    chunkBody.unshift(buf);
    return Buffer.concat(chunkBody);
};
MediaClient.prototype.headerFormatter = function (header, len) {
    let prevChunkMessage = this.getOPrevChunkMessage(header.chunkStreamID);
    let fmt = 0;
    if (prevChunkMessage == null) {
    } else {
        const {
            timestamp,
            messageTypeID,
            messageStreamID,
            bodyLen
        } = prevChunkMessage;

        if (messageStreamID == header.messageStreamID) {
            fmt = 1;
        }
        if (fmt == 1 && bodyLen === len && messageTypeID == header.messageTypeID) {
            fmt = 2;
        }
        if (fmt == 2 && timestamp == header.timestamp) {
            fmt = 3;
        }
    }
    header.fmt = fmt;
    this.setOPrevChunkMessage(header.chunkStreamID, header);
    return fmt;
};
MediaClient.prototype.sendCommand = function (cmd, sid, cmdObj) {
    var rtmpHeader = {
        chunkStreamID: 3,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: sid
    };
    var transId = this.transId;
    var opt = {
        cmd: cmd,
        transId: transId,
        cmdObj: cmdObj
    };
    var body = amfUtils.encodeAmf0Cmd(opt);

    var message = this.createRTMPMessage(rtmpHeader, body);

    this.transName[transId] = cmd;

    this.write(message);
};
MediaClient.prototype.startPlay  = function (cmd, sid, cmdObj, streamName) {
    var rtmpHeader = {
        chunkStreamID: 3,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: sid
    };
    var transId = this.transId;
    var opt = {
        cmd: cmd,
        transId: transId,
        cmdObj: cmdObj,
        streamName:streamName
    };
    var body = amfUtils.encodeAmf0Cmd(opt);

    var message = this.createRTMPMessage(rtmpHeader, body);

    this.transName[transId] = cmd;

    this.write(message);
};
/** customize command **/
MediaClient.prototype.called = function (cmd, arg) {

    var args = [{}];
    var count = 1;
    var transId = this.transId;
    this.transName[transId] = cmd;
    while (count < arguments.length) {
        args.push(arguments[count++]);
    }

    var rtmpHeader = {
        chunkStreamID: MediaClient.ChunkStreamType.INVOKE_COMMAND_MESSAGES,
        timestamp: 0,
        messageTypeID: 0x14,
        messageStreamID: 0
    };
    var body;
    var packet = [];
    packet.push(amfUtils.amf0EncodeOne(cmd));
    packet.push(amfUtils.amf0EncodeOne(transId));
    packet.push(amfUtils.amf0Encode(args));
    body = Buffer.concat(packet);
    var message = this.createRTMPMessage(rtmpHeader, body);
    this.write(message);

    return transId;
};

MediaClient.prototype.write = function (buf) {
    if ((this.socket && this.socket.writable && !this.socket.destroyed)) {
        const connecting = !this.socket.connecting;
        if (connecting) {
            this.socket.write(buf);
            return true;
        }
    }
    return false;
};

MediaClient.prototype.applyServer = function () {

};
MediaClient.prototype.createProducer = function () {
    return {
        id: this.id,
        publish:this,
        consumers:{}
    };
};
MediaClient.prototype.setupBitrates = function () {
    this.bitrates = {};
    const self = this;
    Object.defineProperties(this.bitrates, {
        "rxkBs": {
            get: function () {
                return (self.socket ? (self.socket.bytesRead/1024).toFixed(2) : 0);
            },
            enumerable:true,
            configurable:false
        },
        "txkBs": {
            get: function () {
                return (self.socket ? (self.socket.bytesWritten/1024).toFixed(2) : 0);
            },
            enumerable:true,
            configurable:false
        }
    });
    return this.bitrates;
};
MediaClient.prototype.startHeartbeat = function (sec) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    let millisecond = parseInt(sec) * 1000;
    if (millisecond < 1000 || isNaN(millisecond)) return false;
    this.heartbeat = setInterval(function () {
        this.emit("heartbeat");
    }.bind(this), millisecond);

    return true;
};
MediaClient.prototype.stopHeartbeat = function () {
    if (this.heartbeat) clearInterval(this.heartbeat);
};

function getServerOffset(buf) {
    var offset = buf[0] + buf[1] + buf[2] + buf[3];
    offset = (offset % 728) + 726;
    return offset;
}
function getClientOffset(buf) {
    var offset = buf[0] + buf[1] + buf[2] + buf[3];
    offset = (offset % 728) + 12;
    return offset;
}

/**
 *
 * @param data
 * @param key
 * @return {*|PromiseLike<ArrayBuffer>}
 */
function createHmac(data, key) {
    var hmac = Crypto.createHmac("sha256", key);
    hmac.update(data);
    return hmac.digest();
}
/**
 * #2 User Control Message Stream Begin 1
 * @param buf
 * @return {{eventType: Number, eventData}}
 */
function parseUserControlMessage(buf) {
    var message = {
        eventType:buf.readUInt16BE(0),
        eventData:buf.slice(2, buf.length)
    };
    if (message.eventType === MediaClient.EventType.STREAM_BEGIN) {

    } else if (message.eventType === 3) {

        message.streamID = message.eventData.readUInt24BE(0) + message.eventData.readUInt8(3);
        message.bufferLength = message.eventData.readUInt24BE(4) + message.eventData.readUInt8(7);
    }
    else if (message.eventType === MediaClient.EventType.PING_RESPONSE) {
        /** Server Request **/
        message.timestamp = message.eventData.readUInt24BE(0) + message.eventData.readUInt8(3);
    }
    else if (message.eventType === MediaClient.EventType.PING_REQUEST) {
        /** Client Request **/
        // message.timestamp = message.eventData.readUInt24BE(0) + message.eventData.readUInt8(3);
        message.timestamp = message.eventData.readUInt32BE(0);
    }
    return message;
}

function rtmpChunkBasicHeaderCreate(fmt, cid) {
    var out;
    if (cid >= 64 + 255) {
        out = Buffer.alloc(3);
        out[0] = (fmt << 6) | 1;
        out[1] = (cid - 64) & 0xFF;
        out[2] = ((cid - 64) >> 8) & 0xFF;
    } else if (cid >= 64) {
        out = Buffer.alloc(2);
        out[0] = (fmt << 6) | 0;
        out[1] = (cid - 64) & 0xFF;
    } else {
        out = Buffer.alloc(1);
        out[0] = (fmt << 6) | cid;
    }
    return out;
}
Object.defineProperties(MediaClient, {
    STATE: {
        get: function () {
            return {
                UNINITIALIZED: 0,
                VERSION_RECD:  1,
                ACK_RECD:      2,
                HANDSHAKE_DONE:3
            };
        },
        enumerable:true,
        configurable:false
    },
    PacketType: {
        get: function () {
            return {
                PACKET_TYPE_NONE : 				0x00,
                PACKET_TYPE_CHUNK_SIZE: 		0x01,
                PACKET_TYPE_BYTES_READ: 		0x03,
                PACKET_TYPE_CONTROL:			0x04,
                PACKET_TYPE_SERVERBW:			0x05,
                PACKET_TYPE_CLIENTBW:			0x06,
                PACKET_TYPE_AUDIO:				0x08,
                PACKET_TYPE_VIDEO:				0x09,
                PACKET_TYPE_FLEX_STREAM_SEND:	0x0F,
                PACKET_TYPE_FLEX_SHARED_OBJECT:	0x10,
                PACKET_TYPE_FLEX_MESSAGE:		0x11,
                PACKET_TYPE_METADATA:			0x12,
                PACKET_TYPE_SHARED_OBJECT:		0x13,
                PACKET_TYPE_INVOKE:				0x14,
                PACKET_TYPE_AGGREGATE:			0x16

            };
        },
        enumerable:true,
        configurable:false
    },
    PacketTypeMarker: {
        get: function () {
            return {
                0x00: "PACKET_TYPE_NONE",
                0x01: "PACKET_TYPE_CHUNK_SIZE",
                0x03: "PACKET_TYPE_BYTES_READ",
                0x04: "PACKET_TYPE_CONTROL",
                0x05: "PACKET_TYPE_SERVERBW",
                0x06: "PACKET_TYPE_CLIENTBW",
                0x08: "PACKET_TYPE_AUDIO",
                0x09: "PACKET_TYPE_VIDEO",
                0x0F: "PACKET_TYPE_FLEX_STREAM_SEND",
                0x10: "PACKET_TYPE_FLEX_SHARED_OBJECT",
                0x11: "PACKET_TYPE_FLEX_MESSAGE",
                0x12: "PACKET_TYPE_METADATA",
                0x13: "PACKET_TYPE_SHARED_OBJECT",
                0x14: "PACKET_TYPE_INVOKE",
                0x16: "PACKET_TYPE_AGGREGATE"
            }
        },
        enumerable:true,
        configurable:false
    },
    CONTROL_ID: {
        get: function () {
            return {
                KEY_FRAME_ON2_VP6:     0x14,
                KEY_FRAME_H264:        0x17,
                INTER_FRAME_ON2_VP6:   0x24,
                INTER_FRAME_H264:      0x27,
                INFO_ON2_VP6:          0x54,
                INFO_ON2_H264:         0x57,
                HE_AAC:                0xaf,
                ASAO_AUDIO:			   0x58,
                UNKNOWN_AUDIO:         0x2A,
                KEY_FRAME_H265:        0x1c,
                INTER_FRAME_H265:      0x2c,
                INFO_ON2_H265:         0x5c,
            }
        },
        enumerable:true,
        configurable:false
    },
    CONTROL_ID_Marker: {
        get: function () {
            return {
                0x14:"KEY_FRAME_ON2_VP6",
                0x17:"KEY_FRAME_H264",
                0x24:"INTER_FRAME_ON2_VP6",
                0x27:"INTER_FRAME_H264",
                0x54:"INFO_ON2_VP6",
                0x57:"INFO_ON2_H264",
                0xaf:"HE_AAC",
                0x58:"ASAO_AUDIO",
                0x2a:"UNKNOWN_AUDIO",
                0x1c:"KEY_FRAME_H265",
                0x2c:"INTER_FRAME_H265",
                0x5c:"INFO_ON2_H265"
            };
        },
        enumerable:true,
        configurable:false
    },
    EventType: {
        get: function () { return {
            STREAM_BEGIN:	0x00,
            PING_REQUEST:	0x06,
            PING_RESPONSE:	0x07,
            BUFFER_EMPTY:   0x1f,
            BUFFER_READY:   0x20
        } },
        enumerable:true,
        configurable:false
    },
    ChunkStreamType: {
        get: function () { return {
            PROTOCOL_CONTROL_MESSAGES:	0x02,
            USER_CONTROL_MESSAGES:	    0x02,
            COMMAND_SERVER_MESSAGES:	0x03,
            AUDIO_MESSAGES:             0x04,
            VIDEO_MESSAGES:             0x06,
            COMMAND_STREAM_MESSAGES:    0x08,
            INVOKE_COMMAND_MESSAGES:    0x14
        } },
        enumerable:true,
        configurable:false
    }
});
/** @namespace MediaClient.STATE.UNINITIALIZED */
/** @namespace MediaClient.STATE.VERSION_RECD */
/** @namespace MediaClient.STATE.ACK_RECD */
/** @namespace MediaClient.STATE.HANDSHAKE_DONE */
/** @namespace MediaClient.PacketType.PACKET_TYPE_NONE */
/** @namespace MediaClient.PacketType.PACKET_TYPE_CHUNK_SIZE */
/** @namespace MediaClient.PacketType.PACKET_TYPE_BYTES_READ */
/** @namespace MediaClient.PacketType.PACKET_TYPE_CONTROL */
/** @namespace MediaClient.PacketType.PACKET_TYPE_SERVERBW */
/** @namespace MediaClient.PacketType.PACKET_TYPE_CLIENTBW */
/** @namespace MediaClient.PacketType.PACKET_TYPE_AUDIO */
/** @namespace MediaClient.PacketType.PACKET_TYPE_VIDEO */
/** @namespace MediaClient.PacketType.PACKET_TYPE_FLEX_STREAM_SEND */
/** @namespace MediaClient.PacketType.PACKET_TYPE_FLEX_SHARED_OBJECT */
/** @namespace MediaClient.PacketType.PACKET_TYPE_FLEX_MESSAGE */
/** @namespace MediaClient.PacketType.PACKET_TYPE_METADATA */
/** @namespace MediaClient.PacketType.PACKET_TYPE_SHARED_OBJECT */
/** @namespace MediaClient.PacketType.PACKET_TYPE_INVOKE */
/** @namespace MediaClient.PacketType.PACKET_TYPE_AGGREGATE */
/** @namespace MediaClient.CONTROL_ID.KEY_FRAME_ON2_VP6 */
/** @namespace MediaClient.CONTROL_ID.KEY_FRAME_H264 */
/** @namespace MediaClient.CONTROL_ID.INTER_FRAME_ON2_VP6 */
/** @namespace MediaClient.CONTROL_ID.INTER_FRAME_H264 */
/** @namespace MediaClient.CONTROL_ID.INFO_ON2_VP6 */
/** @namespace MediaClient.CONTROL_ID.INFO_ON2_H264 */
/** @namespace MediaClient.CONTROL_ID.HE_AAC */
/** @namespace MediaClient.CONTROL_ID.ASAO_AUDIO */
/** @namespace MediaClient.CONTROL_ID.KEY_FRAME_H265 */
/** @namespace MediaClient.CONTROL_ID.INTER_FRAME_H265 */
/** @namespace MediaClient.CONTROL_ID.INFO_ON2_H265 */
/** @namespace MediaClient.ChunkStreamType.PROTOCOL_CONTROL_MESSAGES */
/** @namespace MediaClient.ChunkStreamType.USER_CONTROL_MESSAGES */
/** @namespace MediaClient.ChunkStreamType.COMMAND_SERVER_MESSAGES */
/** @namespace MediaClient.ChunkStreamType.AUDIO_MESSAGES */
/** @namespace MediaClient.ChunkStreamType.VIDEO_MESSAGES */
/** @namespace MediaClient.ChunkStreamType.COMMAND_STREAM_MESSAGES */
/** @namespace MediaClient.ChunkStreamType.INVOKE_COMMAND_MESSAGES */
/**
 * enum
 */
var CodecID;
(function (CodecID) {
    CodecID[CodecID["H263"] = 2] = "H263";
    CodecID[CodecID["ScreenVideo"] = 3] = "ScreenVideo";
    CodecID[CodecID["On2VP6"] = 4] = "On2VP6";
    CodecID[CodecID["On2VP6Alpha"] = 5] = "On2VP6Alpha";
    CodecID[CodecID["ScreenVideo2"] = 6] = "ScreenVideo2";
    CodecID[CodecID["H264_AVC"] = 7] = "H264_AVC";
    CodecID[CodecID["H265_HEVC"] = 12] = "H265_HEVC";


})(CodecID = MediaClient.CodecID || (MediaClient.CodecID = {}));

module.exports = exports = MediaClient;
