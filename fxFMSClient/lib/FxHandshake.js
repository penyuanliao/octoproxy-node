/**
 * Created by penyuan on 2016/3/21.
 */
const crypto = require('crypto');
const util = require('util');
const events = require('events');
const net = require('net');

const uptime = new Date().getTime();
const RTMP_VERSTION = 0x03;
const SHA_256_BITS = 32;
const RTMP_PACKETS1S2_BYTELENGTH = 1536;
const RTMP_RANDOM_BYTELENGTH = 1528;
const uint64_t_limited = 4294967296;// 2^64

/****/
function defineConstant(obj, name, value) {
    obj.__defineGetter__(name, function() { return value; });
}
function defineConstants(obj, dict) {
    for (key in dict)
        defineConstant(obj, key, dict[key]);
}
/****/


var chunk = new Buffer(1536);
/* defineConstants */


util.inherits(FxHandshake, events.EventEmitter);

function FxHandshake(client) {

    if (client instanceof net.Socket) {
        this.socket = client;
    }else if (typeof client == "object" && client.socket instanceof net.Socket) {
        this.socket = client.socket;
    }else {
        throw new Error("Invalid arguments, requires ", typeof client);
    }
    /** argsments **/
    this.receivedChunk = undefined;

    this.chunkS0 = undefined;
    this.chunkS1 = undefined;
    this.chunkS2 = undefined;

    this._chunkC0 = undefined;
    this._chunkC1 = undefined;
    this._chunkC2 = undefined;

    this.state = FxHandshake.STATE_UNINITIALIZED;

    events.EventEmitter.call(this);
    this.onDataResponeFunc = this.onDataRespone.bind(this);
    this.socket.on('data', this.onDataResponeFunc);

}
defineConstants(FxHandshake,{
    STATE_UNINITIALIZED: 0,
    STATE_ACKC0C1_SENT:1,
    STATE_S0_CHANGE:2,
    STATE_S1_CHNAGE:3,
    STATE_ACKC2_SENT:4,
    STATE_S2_CHANGE:5,
    STATE_HANDSHAKE_DONE:6
});


FxHandshake.prototype.onDataRespone = function (chunk) {

    console.log('onDataRespone');

    if (this.receivedChunk) {
        this.receivedChunk = Buffer.concat([this.receivedChunk,chunk]);
    }else {
        this.receivedChunk = chunk;
    }

    if (!this.chunkS0 && this.state == FxHandshake.STATE_ACKC0C1_SENT) {
        console.log('Received ChunkS0');

        this.chunkS0 = this.readChunkS0(this.receivedChunk);
        this.receivedChunk = this.receivedChunk.slice(this.chunkS0.byteLength);
        this.state = FxHandshake.STATE_S0_CHANGE;

        if (!this.chunkS0.isValid()) {
            this.emit("error", 'FxHandshake S0 invalid.');
        }

    }
    //檢查狀態流程跟資料是否到達指定長度
    if (!this.chunkS1 && this.state == FxHandshake.STATE_S0_CHANGE && this.receivedChunk.byteLength >= RTMP_PACKETS1S2_BYTELENGTH) {

        this.chunkS1 = this.readChunkS1(this.receivedChunk);
        console.log('>> Received ChunkS1',this.chunkS1.byteLength);

        this.receivedChunk = this.receivedChunk.slice(this.chunkS1.byteLength);

        if (!this.chunkS1.isValid()) {
            console.log('FxHandshake S1 invalid.');
        }

        this.emit('recievedS0S1',this.chunkS1);

    }
    if (!this.chunkS2 && this.state == FxHandshake.STATE_ACKC2_SENT && this.receivedChunk.byteLength >= RTMP_PACKETS1S2_BYTELENGTH) {
        this.chunkS2 = this.readChunkS2(this.receivedChunk);
        this.receivedChunk = this.receivedChunk.slice(this.chunkS1.byteLength);
        console.log('>> Received ChunkS2.');

        if (!this.chunkS2.isValid(this.chunkC1)) console.log('FxHandshake S1 invalid.');

        this.state = FxHandshake.STATE_HANDSHAKE_DONE;



    }

};

FxHandshake.prototype.sendChunkC0 = function () {
    this._chunkC0 = new chunkC0();
    var buf = this._chunkC0.buf;
    this.socket.write(buf);
};

FxHandshake.prototype.sendChunkC1 = function () {
    this._chunkC1 = new chunkC1();
    var buf = this._chunkC1.buf;
    this.socket.write(buf);
    this.state = FxHandshake.STATE_ACKC0C1_SENT;
};
FxHandshake.prototype.sendChunkC2 = function () {
    this._chunkC2 = new chunkC2();
    this._chunkC2.copy(this.chunkS1);
    this.socket.write(this._chunkC2.buf);
    this.state = FxHandshake.STATE_ACKC2_SENT;
}

FxHandshake.prototype.readChunkS0 = function (chunk) {

    var buf = chunk.slice(0,chunkS0.byteLength);

    return new chunkS0(buf);
};

FxHandshake.prototype.readChunkS1 = function (data) {
    return new chunkS1(data);
};
FxHandshake.prototype.readChunkS2 = function (data) {
    return new chunkS2(data);
};

/**
 * chunkS0
 * @param chunk
 */
function chunkS0(chunk) {

    if (chunk && chunk instanceof Buffer) {
        this.buf = chunk.slice(0, 1);
    } else {
        this.buf = new Buffer(1);
        this.setup();
    }
    console.log('chunckS0Size:', 1);

}

chunkS0.prototype.isValid = function () {
    return this.version == RTMP_VERSTION;
};
chunkS0.prototype.__defineGetter__('version', function () {

    console.log('getter Version:', this.buf.readUInt8(0));

    return this.buf.readUInt8(0);
});
chunkS0.prototype.__defineSetter__('version', function(version) {
    this.buf.writeUInt8(version, 0);
});
chunkS0.prototype.setup = function () {
    this.version = 0x03;
};
chunkS0.prototype.byteLength = 1;
// =============================== //
//        Read S1 Handshake        //
// =============================== //
/** S1 Packet size **/
function chunkS1(chunk) {
    if (chunk && chunk instanceof Buffer) {
        // Read Server Buffer
        this.buf = chunk.slice(0, RTMP_PACKETS1S2_BYTELENGTH);
    }else {
        // Send Server Buffer
        this.buf = new Buffer(RTMP_PACKETS1S2_BYTELENGTH);
        this.setup();
    }

    // S1 Header //
    // #1 Time 4 - bytes ( 4*8 = 32 )
    // #2 Zero 4 - bytes ( 4*8 = 32 )
    // #3 Random 1528 - bytes

}

chunkS1.prototype.setup = function () {
    this.time = ((new Date().getTime() - uptime) % uint64_t_limited);
    this.zeros = 0x00;
    this.random = 0xff;
};
chunkS1.prototype.__defineGetter__('time', function () {
    return this.buf.readUInt32BE(0);
});
chunkS1.prototype.__defineSetter__('time', function (time) {
    return this.buf.writeUInt32BE(time,0);
});

chunkS1.prototype.__defineGetter__('zeros', function () {
    return this.buf.readUInt32BE(4);
});
chunkS1.prototype.__defineSetter__('zeros', function (zero) {
    return this.buf.writeUInt32BE(zero, 0);
});
chunkS1.prototype.__defineGetter__('fmsVersion', function() {
    if (this.zeros == 0) return null;
    return this.buf.readUInt8(4) + '.' + this.buf.readUInt8(5) + '.' + this.buf.readUInt8(6) + '.' + this.buf.readUInt8(7);
});

chunkS1.prototype.__defineGetter__('random', function() {
    return this.buf.slice(8);
});
chunkS1.prototype.__defineSetter__('random', function (randomBuf) {

    if (randomBuf instanceof Buffer){
        var time_zeros = this.buf.slice(0,8);
        this.buf = Buffer.concat([time_zeros, randomBuf], RTMP_RANDOM_BYTELENGTH + time_zeros.length);
    }
    else if (typeof randomBuf == 'number')
        this.buf.fill(randomBuf, 8, RTMP_PACKETS1S2_BYTELENGTH);
    else
        throw new Error('chunkS1 random Setter ArgumentError.');
});
chunkS1.prototype.isValid = function () {

    return (this.zeros == 0 || this.fmsVersion != null);
};

chunkS1.prototype.byteLength = RTMP_PACKETS1S2_BYTELENGTH;

// =============================== //
//        Send S2 Handshake        //
// =============================== //
function chunkS2(chunk) {
    if (chunk && chunk instanceof Buffer) {
        // Read Server Buffer
        this.buf = chunk.slice(0, RTMP_PACKETS1S2_BYTELENGTH);
    }else {
        // Send Server Buffer
        this.buf = new Buffer(RTMP_PACKETS1S2_BYTELENGTH);
        this.setup();
    }

    // #1 time
    // #2 time2
    // #3 1528 random
};

chunkS2.prototype.setup = function () {
    this.time2 = ((new Date().getTime() - uptime) % uint64_t_limited);
};
chunkS2.prototype.__defineGetter__('time', function () {
    return this.buf.readUInt32BE(0);
});
chunkS2.prototype.__defineSetter__('time', function (time) {
    return this.buf.writeUInt32BE(time, 0);
});
chunkS2.prototype.__defineGetter__('time2', function () {
    return this.buf.readUInt32BE(4);
});
chunkS2.prototype.__defineSetter__('time2', function (time2) {
    return this.buf.writeUInt32BE(time2, 4);
});
chunkS2.prototype.__defineGetter__('random', function () {
    return this.buf.slice(8);
});
chunkS2.prototype.__defineSetter__('random', function (buf) {
    if (buf instanceof Buffer){
        var time = this.buf.slice(0,8);
        this.buf = Buffer.concat([time, buf], RTMP_PACKETS1S2_BYTELENGTH);
    }
    else if (typeof Buffer == 'number')
        this.buf.fill(buf, 8, RTMP_PACKETS1S2_BYTELENGTH);
    else
        throw new Error('chunkS1 random Setter ArgumentError.');
});

chunkS2.prototype.copy = function (packet) {
    if (packet instanceof chunkS1) {
        this.time = packet.time;
        this.random = packet.random;
    }

};
chunkS2.prototype.isValid = function(c1chunk) {
    // Compare the recieved chunk with the sent chunk's time and random value
    return (this.time == c1chunk.time && this.random.compare(c1chunk.random) == 0);
}

chunkS2.prototype.byteLength = RTMP_PACKETS1S2_BYTELENGTH;

var chunkC0 = chunkS0;
var chunkC1 = chunkS1;
var chunkC2 = chunkS2;

module.exports = FxHandshake;