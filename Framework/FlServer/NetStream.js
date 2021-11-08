/**
 * Created by Benson.Liao on 18/06/05.
 */
"use strict";
const net             = require("net");
const util            = require("util");
const path            = require("path");
const EventEmitter    = require("events");
const FxBufferPool    = require("./FxBufferPool.js");
const amfUtils        = require("./amfUtils.js");
const ClientHandshake = require("./ClientHandshake.js");
const MediaClient     = require("./MediaClient.js");
const fxNetSocket     = require('fxNetSocket');
const log             = require("./log.js");
const NSLog           = fxNetSocket.logger.getInstance();
/** default fms server port **/
const DEFAULT_PORT  = 1935;
/** 資料每包大小 **/
const MessagePacketDefault = 4096;

util.inherits(NetStream, MediaClient);

function NetStream(delegate, options) {

    if (typeof delegate == "undefined") delegate = this;

    MediaClient.call(this, delegate, options);
    // this.readStream = new FxBufferPool();
    this.handshake        = undefined;

    this.fmsVersion       = 0x03;

    this.objectEncoding   = 0.0;

    this.streamIDs        = 1;
    /** 控制是否轉換broadway stream **/
    this.avcTSEnabled     = false;
    /** flv.js **/
    this.flvEnabled       = false;
    this._currRateEnabled = false;
    this.bitrates         = {Bps:0};
    this.pulse            = 0; //prev bandwidth
    this.heartbeat        = 1000;
    this.heartbeatSec     = this.heartbeat / 1000;
    this.uptime = new Date().getTime();
    this.prevSeqSize      = 0;
    this.seqEqualCount    = 0;
    this.pingBuffer       = undefined;
    this.setProperties();
    this.cleanup();
    this.setup();

}
NetStream.prototype.setProperties = function () {
    Object.defineProperties(this, {
        "currRateEnabled":{
            set:function (enabled) {
                if (enabled) {
                    if (typeof this.rateTS != "undefined") {
                        clearInterval(this.rateTS);
                        this.rateTS = undefined;
                    }
                    this.rateTS = setInterval(this.currentRate.bind(this), this.heartbeat);
                } else {
                    clearInterval(this.rateTS);
                    this.rateTS = undefined;
                }
                this._currRateEnabled = enabled;
            },
            get:function () {
                return this._currRateEnabled;
            },
            enumerable:false,
            configurable:false
        },
        "setBitratesHeart":{
            set:function (value) {
                if (typeof value == "number") {
                    self.heartbeat = value;
                    self.heartbeatSec = value/1000;
                }
            },
            get:function () {
                return self.heartbeat;
            },
            enumerable: false,
            configurable: false

        }
    });

};
NetStream.prototype.connect = function (URL) {
    var self  = this;
    var uri  = this.urlDecode(URL);
    var tcUrl = uri.path;
    var app   = uri.app;
    var host  = uri.host;
    var port  = parseInt(uri.port);
    this.vName = path.basename(URL);
    if (this.config.notStream) {
        app = app + uri.vName;
        tcUrl = tcUrl + "/" + uri.vName;
    }
    var setDataFrame = {
        app: app, //app name
        flashVer: "MAC 10,0,32,18", //flash version
        tcUrl: tcUrl, //rtmp path
        fpad: false, // unknown
        capabilities: 239.0, // Content sharing
        audioCodecs: 3575.0, // audio code
        videoCodecs:  252.0, // video code
        videoFunction:  1.0,
        objectEncoding: this.objectEncoding
    };
    var onHandshakeDone = function onHandshakeDone() {
        this.outChunkSize = MessagePacketDefault;
        self.setChunkSize(this.outChunkSize);
        self.sendCommand("connect", 1, setDataFrame);
        self.connectCmdObj = setDataFrame;
    };
    this.on("connect", onHandshakeDone);
    this.socketOptions = {host:host, port:port};
    const connecting = this.socket.connecting;
    if (connecting && this.socket && this.socket.isConnected) {
        NSLog.log("debug", "connecting");
    } else {
        this.socket.connect({host:host, port:port});
    }

};
NetStream.prototype.reconnect = function () {
    if (typeof this.socketOptions != "undefined") {
        NSLog.log("warning", "rtmp has reconnected.");
        this.cleanup();
        this.setup();
        this.socket.connect(this.socketOptions);
    } else {
        NSLog.log("error", "Please try connect");
    }
};
NetStream.prototype.cleanup = function () {
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
    this.currChunkMessage = undefined;
    this.prevChunkMessage = {};
    this.deleteOPrevChunkMessage();
    this.flvMuxing.cleanUp();
    this.videoSeq = 0;
    // this.initCodec();
    if (typeof this.socket != "undefined") {
        this.socket.removeAllListeners("data");
        this.socket.removeAllListeners("error");
        this.socket.removeAllListeners("connect");
        this.socket.removeAllListeners("close");
        this.socket.removeAllListeners("end");
    }

};

NetStream.prototype.urlDecode = function (URL) {
    var args = URL.match(/(rtmp|http):\/\/(\w+:{0,1}\w*@)?([\w\.]+)(:([a-zA-Z0-9_]+)\/|\/)?(\S+[a-zA-Z0-9_\.]+)/i);
    if (typeof args == "undefined" && args) {
        NSLog.log('error', new Error("URL input error."));
    }
    var obj   = {};
    obj.path  = path.dirname(args[0]);
    obj.app   = path.dirname(args[6]) + "/";
    obj.host  = args[3];
    obj.port  = parseInt(args[5]) || DEFAULT_PORT;
    obj.vName = path.basename(URL);
    return obj;
};

NetStream.prototype.setup = function () {
    var self   = this;
    this.socket = new net.Socket();
    var socket = this.socket;
    socket.isConnected = false;
    var handshakeHandle = function handshakeHandle(chunk) {
        self.readStream.push(chunk);
        if (self.handshake.state === ClientHandshake.STATE_VERSION_SENT) {
            NSLog.log("info", '#1 Handshake received S0S1 Chunk. [ STATE_VERSION_SENT ]');
            self.handshake.S0S1Handshake(self.readStream);
        }
        if (self.handshake.state === ClientHandshake.STATE_ACK_SENT) {
            NSLog.log("info", '#2 Handshake received S2 Chunk. [ STATE_ACK_SENT ]');
            self.handshake.S2Handshake(self.readStream);
        }
        if (self.handshake.state === ClientHandshake.STATE_HANDSHAKE_DONE) {
            NSLog.log("info", '#3 Handshake [ OK ]');
            socket.removeListener("data", handshakeHandle);
            socket.on("data", messageHandle);
            self.fmsVersion = self.handshake.s2chunk.fmsVersion;
            self.handshake.release();
            self.handshake = undefined;
            self.emit("connect");
        }
    };
    var messageHandle = function messageHandle(chunk) {
        chunk = self.validPacketControl(chunk);
        self.makeAcknowledgement();
        self.readStream.push(chunk);
        parseIncoming();
    };
    var parseIncoming = function parseIncoming() {
        var message;

        while (self.readStream.bufLen > 0) {

            if (typeof self.currChunkMessage === "undefined") {
                message = self.parseRTMPMessage(self.readStream);
                if (typeof message == "undefined") {
                    NSLog.log("info",'at parseIncoming() insufficient data read (%s).', self.readStream.bufLen);
                    return;
                } else if (message == -1) {
                    self.currChunkMessage = undefined;
                    NSLog.log("debug", "at parseIncoming() has null socket.end().");
                    socket.end();
                    return;
                }
            } else {
                message = self.currChunkMessage;
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

    };
    var onConnectionFunc = socket.onConnectionFunc = this.onConnection.bind(this);
    socket.on("connect", onConnectionFunc);
    socket.on("data", handshakeHandle);
    socket.on("close", function onClose() {
        socket.removeListener("data", messageHandle);
        socket.removeAllListeners("data");
        onConnectionFunc = undefined;
        messageHandle = undefined;
        handshakeHandle = undefined;
        socket = undefined;
    });
    socket.on("error", this.emit.bind(this, "error"));
};
/** Duplicate the live service stream **/
NetStream.prototype.onConnection = function () {
    NSLog.log("info", '#0 RTMP Handshake [Start]');
    this.socket.removeListener("connect", this.socket.onConnectionFunc);
    this.socket.onConnectionFunc = undefined;
    this.socket.isConnected = true;
    this.handshake = new ClientHandshake(this.socket);
    this.handshake.generateC0C1();
    var self = this;

    this.socket.on("error", function onError(err) {
        NSLog.log("error", "Socket.Error() # %s %s", err.code, err.message);
        if (err.code === "ENETUNREACH") {

        }
    });
    this.socket.on("timeout", function onTimeout() {
        NSLog.log("warning", "NetStream.Socket.Timeout()");
        self.socket.end();
    });
    this.socket.on("close", function onClose() {
        NSLog.log("warning", "NetStream.Socket.Close()");
        self.emit("close");
        // self.socket.removeAllListeners("close");
        self.socket.removeAllListeners("timeout");
        self.socket.removeAllListeners("error");
        self.socket.isConnected = false;
    });

};
NetStream.prototype.close = function () {
    if (typeof this.socket != "undefined") {
        if (this.socket && this.socket.writable && !this.socket.destroyed) {
            this.socket.destroy();
        } else {
            this.reconnect();
        }
    }
};
/**  **/
NetStream.prototype.validPacketControl = function (chunk) {

    if (Buffer.isBuffer(chunk) == false || chunk.length < 18) return chunk;

    var index = chunk.indexOf("02000000000006040000000000", 0, "hex");
    if (index != -1) {
        var buf1 = chunk.slice(0, index);
        var buf2 = chunk.slice(index + 18, chunk.length);
        var ping = chunk.slice(index, index + 18);

        if (this.readStream.bufLen > 0 && index >= 0) {
            if (index + 18 > chunk.length) return chunk;
            var num = ping.readUInt32BE(14); // get timestamp value
            this.pingResponse(num, ping[13]);

            chunk = Buffer.concat([buf1, buf2], buf1.length + buf2.length);

            NSLog.log("warning",'data inside (User Control Message Ping Request)', num, ping, buf2.length);
        }

    }
    // 斷包插入ping
    // if (this.readStream.bufLen > 0 && chunk.length > 0) {
    //     NSLog.log("debug", 'chkShardMessage', this.readStream.bufLen);
    //     chunk = this.chkShardMessage(chunk);
    // }
    return chunk;
};
/****/
NetStream.prototype.makeAcknowledgement = function () {
    var seqNum = this.readStream.getSequenceNumber();
    // NSLog.log("debug", 'makeAcknowledgement() max:%s seq:%s', this.ackMaximum, seqNum);
    if (this.ackMaximum > 0 && seqNum > (this.ackMaximum * 0.95)) {
        this.setAcknowledgement(seqNum);
        this.ackMaximum += this.acknowledgementSize;
    }
};
NetStream.prototype.onStatus = function (cmd, header) {
    if (cmd.info.code === "NetStream.Play.UnpublishNotify") {
        NSLog.log("info", "NetStream.Play.UnpublishNotify", this.playStreamName);
        this.emit("NetStream.Play.UnpublishNotify"); //發佈停止
    } else if (cmd.info.code === "NetStream.Play.Start") {
        var words = this.connectCmdObj.app.split("");
        if (words[words.length-1] == "/") {
            this.playStreamName = this.connectCmdObj.app + cmd.info.details;

        } else {
            this.playStreamName = this.connectCmdObj.app + '/' + cmd.info.details;
        }
        NSLog.log("info", "NetStream.Play.Start() stream:", this.playStreamName);

        this.emit("NetStream.Play.Start", this.playStreamName);
    } else if (cmd.info.code === "NetStream.Play.PublishNotify") {
        NSLog.log("info", "NetStream.Play.PublishNotify()", cmd);
        this.emit("NetStream.Play.PublishNotify", cmd); //發佈開始
    } else if (cmd.info.code === "NetStream.Play.Reset") {
        NSLog.log("info", "NetStream.Play.Reset()", cmd);
        this.emit("NetStream.Play.Reset", cmd)
    }  else if (cmd.info.code === "NetStream.Publish.Start") {
        NSLog.log("info", "NetStream.Publish.Start()", cmd);
        this.emit("NetStream.Publish.Start", cmd)
    } else {
        NSLog.log("info", "NetStream::onStatus()", cmd, header);
    }
};

/** ＃2 connect result **/
NetStream.prototype.connect_result = function (cmd) {
    NSLog.log("info", 'connect_result()', cmd, this.streamIDs);
    if (cmd.info.code == "NetConnection.Connect.Success") {
        var index = this.streamIDs;
        if (this.config.notStream) {

        } else {
            this.sendCommand("createStream", index, {});
        }

        this.emit("fmsConnect", cmd)
        // client.sendCommand("loginAsNode", 0, {});
    }
};
/** ＃3 createStream result **/
NetStream.prototype.createStream_result = function (cmd) {
    NSLog.log("debug", 'createStream_result()', cmd);
    var index = this.streamIDs;
    this.startPlay("play", index, null, this.vName);
};
NetStream.prototype.setMode_result = function (cmd) {
    NSLog.log("debug", 'setMode_result()', cmd);
};
NetStream.prototype.applyServer = function () {
    NSLog.log("debug", 'applyServer()', this.delegate.pendingApply);
    if (this.delegate.pendingApply == true) {
        return false;
    }
    if (this.flvMuxing.hasAbnormalEnabled) {
        this.delegate.pendingApply = true;
        setTimeout(function () {
            this.called("applyServer");
        }.bind(this), 5000);
    }
    return true;
};
NetStream.prototype.applyServer_result = function (cmd) {
    this.flvMuxing.hasAbnormalEnabled = false;
    NSLog.log("debug", 'applyServer_result()', cmd);
    setTimeout(function () {
        this.delegate.pendingApply = false;
    }.bind(this), 5000);
};
NetStream.prototype.currentRate = function () {
    const self = this;
    let bandwidth = this.readStream.getSequenceNumber();
    if (bandwidth == 0) return;
    var oldPulse = this.pulse || 0;

    this.pulse = Math.floor(bandwidth / 1024);

    var bitrates = self.bitrates.Bps = ((this.pulse - oldPulse) / this.heartbeatSec);
    /*
    if (typeof self.bitrates.chart == "undefined") self.bitrates.chart = [];
    self.bitrates.chart.push(bitrates);
    if (typeof self.bitrates.chart.length > 120) self.bitrates.chart.shift();
    */
    var app = (typeof this.connectCmdObj != "undefined") ? this.connectCmdObj.app : "*";
    const size = this.readStream.seq;
    NSLog.log("debug", "%s%s bitrates:%s KB/s, download: %s KB", app, this.vName , bitrates, Math.ceil(size/1000));
    if (this.readStream.seq == this.prevSeqSize) {
        this.seqEqualCount++;
    } else {
        this.seqEqualCount = 0;
    }
    if (this.seqEqualCount >= 300) {
        this.close();
    }
    this.prevSeqSize = size;
};
module.exports = exports = NetStream;


if (process.env.ns_test) {
    NSLog.configure({
        /* File for record */
        logFileEnabled:false,
        /* console log */
        consoleEnabled:true,
        /* quiet, error, warning, info, debug, trace, log */
        level:'trace',
        dateFormat:'[yyyy-MM-dd hh:mm:ss]',
        filePath:"./",
        fileName:'',
        maximumFileSize: 1024 * 1024 * 100});
    var client = new NetStream();
    // client.connect("rtmp://103.24.83.229:1935/video/daaie/video0");
    client.connect("rtmp://103.24.83.229:1935/video/dabib/videosd");
    // client.connect("rtmp://183.182.64.182/video/demo1/video0");
}

