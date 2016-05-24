/**
 * Created by penyuan on 2016/3/21.
 */

var net = require("net"),
    log = require("../../fxNodeRtmp/log"),
    crypto = require('crypto');
var fxHandshake = require('./FxHandshake');

const DEFAULT_PORT = 1935;
const RTMP_HANDSHAKE_PACKET_SIZE = 1536;
const UPTIME = new Date().getTime();



function FxClient(host,port) {
    this.socket = undefined;
    this.host = host;
    this.port = port;
    this.chunkSize = 128;
    this.receiveChunkSize = 128;
    this.receiveTimestamp = null;
    this.state = "initialize";

    this.self = this;

    var sock = new net.Socket(host);

    this.socket = sock;
    this.socket.name = "rtmpClient";
    this.state = "connecting";

    this.handshake = new fxHandshake(sock);

    sock.connect(this.port || DEFAULT_PORT, this.host);
    sock.on('connect', this.connect.bind(this));

    // sock.on('data', this.onData.bind(this));
    sock.on('error', function (err) {

    });

}


FxClient.prototype = {
    //連上RTMP時候
    connect:function () {
        console.log('#1 connect');

        this.handshake.sendChunkC0();
        this.handshake.sendChunkC1();
        this.handshake.on('recievedS0S1', function (packet) {
            console.log('recievedS0S1');
            this.sendChunkC2();
        })
        // var sock = this.socket;

        // this.handshakeC0Chunk();
        // this.handshakeC1Chunk();
    },
    onData:function (chunk) {




        
        console.log('#2 onData chunck size',receivedChunk.length,1536);

        if (receivedChunk.length < 1536) return;
        log.logHex(chunk);
        var buf = receivedChunk.slice(0,1);
        var s0 = sh.readChunkS0(buf);

        //S0 1-bytes
        if (s0.isValid()) {
            receivedChunk = receivedChunk.slice(1,receivedChunk.length);
        }else{
            console.error('handshake S0 valid error');
        }

        if (receivedChunk.length >= RTMP_HANDSHAKE_PACKET_SIZE) {
            // this.handshakeS1Chunk(buf);
            buf = receivedChunk.slice(0, RTMP_HANDSHAKE_PACKET_SIZE);

            var timestamp = buf.readUInt32BE(0);

            console.log("timestamp: ",timestamp);

            var fmsVersion = buf.readUInt8(4) + '.' + buf.readUInt8(5) + '.' + buf.readUInt8(6) + '.' + buf.readUInt8(7);

            console.log("fmsVersion: ",fmsVersion);

        }



        //S1 1536-bytes
        //S2 1536-bytes



        var sock = this.socket;

    },
    handshakeC0Chunk:function () {
        console.log('#1-1 set Chunk C0');
        this.state = "SendingC0";
        var buf = new Buffer(1);
        buf.writeUInt8(0x03,0);
        this.socket.write(buf);

    },
    handshakeC1Chunk:function () {
        console.log('#1-2 set Chunk C1');
        this.state = "SendingC1";
        var buf = new Buffer(RTMP_HANDSHAKE_PACKET_SIZE).fill(0x00);
        buf.writeUInt32BE(((new Date().getTime() - UPTIME) % 4294967296),0);
        this.socket.write(buf);
    },
    handshakeS1Chunk:function (chunk) {

        if (chunk && chunk instanceof Buffer) {

        }

        var s1Chunk = {};

        s1Chunk.buf = chunk.slice(0, RTMP_HANDSHAKE_PACKET_SIZE);
        // console.log(buf.byteLength);
    }
    
};


module.exports = new FxClient("43.251.76.111","443");//"rtmp://43.251.76.111:443/motest/g1"

