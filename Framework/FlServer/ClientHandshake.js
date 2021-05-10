/**
 * Created by Benson.Liao on 18/06/05.
 */

const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const log           = require("./log.js");
const RTMP_SIG_SIZE = 1536;
const uptime        = new Date().getTime();

function C0Chunk(buffer) {
    if (Buffer.isBuffer(buffer)) {
        this.buffer = buffer.slice(0, C0Chunk.byteLength);
    } else {
        this.buffer = Buffer.allocUnsafe(C0Chunk.byteLength);
        this.setDefaults();
    }

    var self  = this;
    var props = {
        "version": {
            get:function () { return self.buffer.readUInt8(0) },
            set:function (version) {
                if (typeof version == "undefined") version = self.version;
                self.buffer.writeUInt8(version, 0) },
            enumerable: false,
            configurable: false
        }
    };

    Object.defineProperties(this, props);
}
C0Chunk.prototype.isValid = function () {
    return (this.version == 0x03);
};
C0Chunk.prototype.setDefaults = function() {
    this.version = 0x03;
};
C0Chunk.byteLength = 1;

function C1Chunk(buffer) {
    var self  = this;

    if (Buffer.isBuffer(buffer)) {
        this.buffer = buffer.slice(0, C1Chunk.byteLength);
    } else {
        this.buffer = Buffer.allocUnsafe(C1Chunk.byteLength);
        this.setDefaults();
    }

    var getFMSVersion = function () {
        if (this.zeros == 0) return "0.0.0.0";
        return self.buffer.readUInt8(4) + '.' + self.buffer.readUInt8(5) + '.' + self.buffer.readUInt8(6) + '.' + self.buffer.readUInt8(7);
    };

    var props = {
        "time": {
            get:function () { return self.buffer.readUInt32BE(0) },
            set:function (time) { self.buffer.writeUInt32BE(time, 0) },
            enumerable: false,
            configurable: false
        },
        "fmsVersion": {
            get:getFMSVersion,
            enumerable: false,
            configurable: false
        },
        "zeros": {
            get:function () {
                return self.buffer.readUInt32BE(4);
            },
            set:function (zeros) {
                self.buffer.writeUInt32BE(zeros, 4);
            },
            enumerable: false,
            configurable: false
        },
        "random": {
            get:function () {
                return self.buffer.slice(8);
            },
            set:function (buffer) {
                if (buffer instanceof Buffer)
                    buffer.copy(self.buffer, 8, 0, 1528);
                else if (typeof buffer == 'number')
                    self.buffer.fill(buffer, 8, C1Chunk.byteLength);
                else
                    throw new Error("ArgumentError");
            },
            enumerable: false,
            configurable: false
        }
    };

    Object.defineProperties(this, props);
}
C1Chunk.prototype.isValid = function () {
    // check for all zeros (bytes 4-7)
    // (note that typically this ends up making most packets invalid as they specify the version of FMS here)
    return (this.zeros == 0 || this.fmsVersion != null) ;
};
C1Chunk.prototype.setDefaults = function() {
    this.time = ((new Date().getTime() - uptime) % 4294967296);
    this.zeros = 0x00;
    this.random = 0xff;
};
C1Chunk.byteLength = RTMP_SIG_SIZE;


var C2Chunk = function(buffer) {
    var self = this;
    if (Buffer.isBuffer(buffer)) {
        this.buffer = buffer.slice(0, C2Chunk.byteLength);
    } else {
        this.buffer = Buffer.alloc(C2Chunk.byteLength);
        this.setDefaults();
    }

    var props = {
        "time": {
            get:function () { return self.buffer.readUInt32BE(0) },
            set:function (time) {
                self.buffer.writeUInt32BE(time, 0) },
            enumerable: false,
            configurable: false
        },
        "time2": {
            get:function () { return self.buffer.readUInt32BE(4) },
            set:function (time) {
                self.buffer.writeUInt32BE(time, 4) },
            enumerable: false,
            configurable: false
        },
        "random": {
            get:function () {
                return self.buffer.slice(8);
            },
            set:function (buffer) {
                if (buffer instanceof Buffer)
                    buffer.copy(self.buffer, 8, 0, 1528);
                else if (typeof buffer == 'number')
                    self.buffer.fill(buffer, 8, C2Chunk.byteLength);
                else
                    throw new Error("ArgumentError");
            },
            enumerable: false,
            configurable: false
        }
    };

    Object.defineProperties(this, props);
};
C2Chunk.prototype.isValid = function (c1chunk) {
    // check for all zeros (bytes 4-7)
    // (note that typically this ends up making most packets invalid as they specify the version of FMS here)
    return (this.time == c1chunk.time && this.random.compare(c1chunk.random) == 0);
};
C2Chunk.prototype.setDefaults = function(c1chunk) {
    this.time2 = ((new Date().getTime() - uptime) % 4294967296);
};
C2Chunk.prototype.copyFromS1 = C2Chunk.prototype.copyFromC1 = function(c1chunk) {
    this.time = c1chunk.time;
    this.random = c1chunk.random;
};
C2Chunk.byteLength = RTMP_SIG_SIZE;

var S0Chunk = C0Chunk;
var S1Chunk = C1Chunk;
var S2Chunk = C2Chunk;

util.inherits(ClientHandshake, EventEmitter);

function ClientHandshake(socket) {
    EventEmitter.call(this);

    var self = this;

    this.state = ClientHandshake.STATE_UNINITIALIZED;

    this.socket = socket;
}
ClientHandshake.prototype.generateC0C1 = function () {
    /* Create temporary buffer for both */
    var buf = Buffer.allocUnsafe(C0Chunk.byteLength + C1Chunk.byteLength);

    /* C0 Handshake Chunk */
    this.c0chunk = new C0Chunk(buf);
    this.c0chunk.setDefaults();

    /* C1 Handshake Chunk */
    this.c1chunk = new C1Chunk(buf.slice(C0Chunk.byteLength));
    this.c1chunk.setDefaults();

    /* Send C0 + C1 */
    this.socket.write(buf);
    /* Change to VERSION_SENT state */
    this.state = ClientHandshake.STATE_VERSION_SENT;
};
ClientHandshake.prototype.generateC2 = function (s1chunk) {
    this.c2chunk = new C2Chunk();
    this.c2chunk.copyFromS1(s1chunk);
    this.socket.write(this.c2chunk.buffer);
    /* Change to ACK_SENT state */
    this.state = ClientHandshake.STATE_ACK_SENT;
};
ClientHandshake.prototype.S0S1Handshake = function (stream) {
    var buf;
    /* S0 Handshake Chunk */
    if (stream.valid(S0Chunk.byteLength + S1Chunk.byteLength) === false) return;
    buf = stream.read(S0Chunk.byteLength);
    this.s0chunk = new S0Chunk(buf);
    if (!this.s0chunk.isValid()) this.emit("error", 's0 invalid');
    /* S1 Handshake Chunk */
    buf = stream.read(S1Chunk.byteLength);
    this.s1chunk = new S1Chunk(buf);
    if (!this.s1chunk.isValid()) this.emit("error", 's1 invalid');
    this.generateC2(this.s1chunk);
};
ClientHandshake.prototype.S2Handshake = function (stream) {
    var buf;
    /* S2 Handshake Chunk */
    if (stream.valid(S2Chunk.byteLength) === false) return;
    buf = stream.read(S2Chunk.byteLength);
    this.s2chunk = new S2Chunk(buf);
    if (!this.s2chunk.isValid(this.c1chunk)) this.emit("error", 's2 invalid');
    /* Change to HANDSHAKE_DONE state */
    this.state = ClientHandshake.STATE_HANDSHAKE_DONE;
};
ClientHandshake.prototype.release = function () {
    /* Clean up */
    this.s0chunk = undefined;
    this.s1chunk = undefined;
    this.s2chunk = undefined;
    this.c0chunk = undefined;
    this.c1chunk = undefined;
    this.c2chunk = undefined;
    this.socket  = undefined;
};

ClientHandshake.STATE_UNINITIALIZED = 0;
ClientHandshake.STATE_VERSION_SENT = 1;
ClientHandshake.STATE_ACK_SENT = 2;
ClientHandshake.STATE_HANDSHAKE_DONE = 3;


module.exports = exports = ClientHandshake;