/**
 * Created by Benson.Liao on 16/3/16.
 */
var debug = require('debug')('Live');
var libRtmp = require('../fxNodeRtmp').RTMP;
var log = libRtmp.AMFLOG;

const FMS_Domain = "43.251.76.111";
const FMS_Port = 443;
var start_time = new Date().getTime();
var client = [];

function connect(uri) {

    var rtmp = undefined;

    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        debug("complete connected!");

        // send connect event
        rtmp.sendInvoke('connect', 1, {
            app: uri.app,
            flashVer: "MAC 10,0,32,18",
            tcUrl: uri.path,
            fpad: false,
            capabilities: 15.0,
            audioCodecs: 0.0,
            videoCodecs: 252.0,
            videoFunction: 1.0
        });
        //// init
        //rtmp.setWindowACK(2500000);
        //rtmp.setPeerBandwidth(2500000,2);
        //rtmp.setChunkSize(4000);

    });

    rtmp.on('message', function (message) {
        console.log("chunkType: ",message.basicHeader.chunkType);
        if (message.messageHeader.messageType == 20) {
            var data = message.data;
            var cmd = data.commandName;
            var tranId = data.transactionId;
            var argument = data.arguments;
            console.log('INFO :: cmd:%s, argument:%s', cmd, argument);
            if (cmd == 'chk') {
                var body = new Buffer(6).fill(0x00);
                body.writeUInt16BE(0x07, 0);
                var num = (Date.now() & 0xffffffff) >>> 0
                body.writeUInt32BE(num,2);
                var header = new Buffer([2,0,0,0,0,0,6,4,0,0,0,0]);
                var chunk = Buffer.concat([header,body]);
                console.log("SendChunk:",body);
                fms.socket.write(chunk);

                //PingResponse Name: Pong
                //var msg = {
                //    fmt:    0,
                //    csid:   2,
                //    timestamp:  0,
                //    timestampDelta: 0,
                //    msgLength:  body.length,
                //    msgType :   4,
                //    streamId:   0
                //};
                //console.log("makeChunkBasicHeader:",makeChunkBasicHeader(msg));
                //console.log("makeChunkMessageHeader:", makeChunkMessageHeader(msg));
            }
        };
    });
    rtmp.on("data", function (data) {

        if (data[0] == 0x02 && data[6] == 0x06 ) {
            data[6] = 0x07;
            console.log('~~~~ is data ~~~~',data.length);

            log.logHex(data);
            console.log('~~~~ is data end ~~~~');
            fms.socket.write(data);
        }
    });
    rtmp.on("error", function (args) {
        console.log("RTMP ERROR", args);
    });
    rtmp.on('close', function (args) {
        console.log("RTMP connection closed");
    });

    return rtmp;
};
function makeChunkBasicHeader(obj) {
    var fmt = obj.fmt;
    var csid = obj.csid;
    if (csid < 64) {
        var h = new Buffer(1);
        var v = (fmt << 6) | csid;
        h.writeUInt8(v, 0);
        return h;
    }else if (csid > 320) //[64+0,64+255] => [64, 319]
    {
        var h = new Buffer(2);
        var v = 0;
        v = (fmt<<6)|0;
        h.writeUInt8(v,0);
        h.writeUInt8(csid-64,1);
        return h;
    }else if(csid < 65600)
    {
        var h = new Buffer(3);
        var v = 0;
        v = (fmt<<6)|0;
        h.writeUInt8(v,0);
        h.writeUInt16LE(csid-64,1);
        return h;
    }else {
        throw new Error("Bad csid");
    }
}
function makeChunkMessageHeader(obj){
    var h = null;
    var offset = 0;
    var hasExtendTs = false;
    if(obj.absTimestamp >= 0x00ffffff){
        hasExtendTs = true;
    }
    switch(obj.fmt){
        case 0:
            h = new Buffer(11);
            offset = 0;
            if(hasExtendTs){
                writeUInt24BE(h, 0xffffff, offset); offset += 3;
            } else {
                writeUInt24BE(h, obj.absTimestamp, offset); offset += 3;
            }
            writeUInt24BE(h, obj.msgLength, offset); offset += 3;
            h.writeUInt8(obj.msgType,offset); offset += 1;
            h.writeUInt32LE(obj.streamId, offset); offset += 4;
            break;
        case 1:
            h = new Buffer(7);
            offset = 0;
            writeUInt24BE(h, obj.timestamp, offset); offset += 3;
            writeUInt24BE(h, obj.msgLength, offset); offset += 3;
            h.writeUInt8(obj.msgType,offset); offset += 1;
            break;
        case 2:
            h = new Buffer(3);
            offset = 0;
            writeUInt24BE(h,obj.timestamp,offset); offset += 3;
            break;
        case 3:
            h = new Buffer(0);
            break;
    }
    if( hasExtendTs && (obj.fmt == 0 || obj.fmt == 3)){
        var ts = new Buffer(4);
        ts.writeUInt32BE(obj.absTimestamp, 0);
        h = Buffer.concat([h, ts]);
    }
    return h;
}
function Call(rtmp, commandName, obj){

    var s1 = new libRtmp.AMF.AMFSerialiser(commandName);
    var s2 = new libRtmp.AMF.AMFSerialiser(1);
    var data_buf = libRtmp.amfUtils.amf0Encode([{},obj]);
    var buf = new Buffer(s1.byteLength + s2.byteLength).fill(0x0);
    s1.write(buf.slice(0,s1.byteLength));
    s2.write(buf.slice(s1.byteLength,s1.byteLength + s2.byteLength));
    buf = Buffer.concat([buf, data_buf]);
    if (rtmp)
        rtmp.sendPacket(0x14, libRtmp.RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, buf);
    else
        connections[rtmp.name].write({"NetStatusEvent":"Connect.FMS.Failed"})
};
function set0x06(rtmp, commandName, obj){

    var s1 = new libRtmp.AMF.AMFSerialiser(commandName);
    var s2 = new libRtmp.AMF.AMFSerialiser(1);
    var data_buf = libRtmp.amfUtils.amf0Encode([{},obj]);
    var buf = new Buffer(s1.byteLength + s2.byteLength).fill(0x0);
    s1.write(buf.slice(0,s1.byteLength));
    s2.write(buf.slice(s1.byteLength,s1.byteLength + s2.byteLength));
    buf = Buffer.concat([buf, data_buf]);
    if (rtmp)
        rtmp.sendPacket(0x14, libRtmp.RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, buf);
    else
        connections[rtmp.name].write({"NetStatusEvent":"Connect.FMS.Failed"})
};
var uri = {
        host:"43.251.76.111",
        port:1935,
        path:"rtmp://43.251.76.111/motest/g1",
        app:"motest/g1"
    };
var fms = connect(uri);
fms.on('data', function (data) {
})
client.push(fms);
setTimeout(function () {
    Call(fms,"login");
},1000);
setTimeout(function () {
    var currentTimestamp = new Date().getTime() - start_time;
    //
    //var s1 = new libRtmp.AMF.AMFSerialiser("PingResponse");
    //var s2 = new libRtmp.AMF.AMFSerialiser(1);
    //
    //var t = new Buffer(s1.byteLength + s2.byteLength).fill(0x00);
    //s1.write(t.slice(0,s1.byteLength));
    //s2.write(t.slice(s1.byteLength,s1.byteLength + s2.byteLength));
    //var buf = new Buffer([0x00,0x06,
    //    (currentTimestamp >> 24) && 0xff,
    //    (currentTimestamp >> 16) && 0xff,
    //    (currentTimestamp >> 8) && 0xff
    //]);
    //var obj = libRtmp.amfUtils.amf0Encode([{}]);
    //
    //fms.sendPacket(0x04, 0x07,Buffer.concat([t,obj, buf], t.length + obj.length + buf.length));
    //2,0xff,0xe3,0x6c,0,0,6,4,0,0,0,0
    //fms.socket.write(new Buffer([0x02,0,0,0,0,0,6,4,0,0,0,0,0,0x02,0x12,0x00,0x00,0x00]));
    /** pingRespnse **/
    /**
     * 2 byte    | 4 byte
     * EventType | timestamp
     * timestamp: recv from PingRequest.
     */


    console.log("ping....try");


},1000);



const readUInt24BE = function (buf, offset) {


    return (buf[0 + offset] << 16) + (buf[1 + offset] << 8) + buf[2 + offset];
};

const writeUInt24BE = function (buf, value, offest) {


    buf[offest]     = (value >> 16) & 0xFF;
    buf[offest + 1] = (value >> 8) & 0xFF;
    buf[offest + 2] = value & 0xFF;
    return buf;
};