/**
 * Created by penyuan on 2016/3/21.
 */

var net = require("net"),
    log = require("../../fxNodeRtmp/log"),
    crypto = require('crypto');
var sh = require('./FxHandshake');

const DEFAULT_PORT = 1935;
const RTMP_HANDSHAKE_PACKET_SIZE = 1536;
const UPTIME = new Date().getTime();
var receivedChunk;


function FxClient(host,port) {
    this.socket = undefined;
    this.host = host;
    this.port = port;
    this.chunkSize = 128;
    this.receiveChunkSize = 128;
    this.receiveTimestamp = null;

    this.self = this;

    var sock = new net.Socket(host);
    sock.connect(this.port || DEFAULT_PORT, this.host);
    sock.on('connect', this.connect.bind(this));
    sock.on('data', this.onData.bind(this));
    this.socket = sock;
}


FxClient.prototype = {
    connect:function () {
        console.log('#1 connect');
        var sock = this.socket;


        this.handshakeC0Chunk();
        this.handshakeC1Chunk();
    },
    onData:function (chunk) {
        console.log('#2 onData chunck size',chunk.length,new Buffer(1536).length);
        log.logHex(chunk);

        if (receivedChunk) {
            receivedChunk = Buffer.concat([receivedChunk,chunk]);
        }else {
            receivedChunk = chunk;
        }

        var buf = receivedChunk.slice(0,1);
        var s0 = sh.readChunkS0(buf);


        //S0 1-bytes
        if (s0.isValid()) {
            receivedChunk = receivedChunk.slice(1,receivedChunk.length);
        }else{
            console.error('handshake S0 valid error');
        }

        if (receivedChunk.length >= RTMP_HANDSHAKE_PACKET_SIZE) {
            buf = receivedChunk.slice(0, RTMP_HANDSHAKE_PACKET_SIZE);

            var timestamp = buf.readUInt32BE(0);

            console.log("timestamp: ",timestamp);
            
            var msgFormat = sh.GetServerGenuineConstDigestOffset(buf.slice(772, 776));
            console.log("sdl:" +
                "",msgFormat);


        }



        //S1 1536-bytes
        //S2 1536-bytes



        var sock = this.socket;

    },
    handshakeC0Chunk:function () {
        console.log('#1-1 set Chunk C0');
        var buf = new Buffer(1);
        buf.writeUInt8(0x03,0);
        this.socket.write(buf);

    },
    handshakeC1Chunk:function () {
        console.log('#1-2 set Chunk C1');
        var buf = new Buffer(RTMP_HANDSHAKE_PACKET_SIZE).fill(0x00);
        buf.writeUInt32BE(((new Date().getTime() - UPTIME) % 4294967296),0);
        this.socket.write(buf);
    }
};


module.exports = new FxClient("43.251.76.111","443");//"rtmp://43.251.76.111:443/motest/g1"