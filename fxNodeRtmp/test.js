var AMF = require('./amf');
var RTMPClient = require('./client');
var RTMPPacket = require('./packet');
var RTMPMessage = require('./message');
var log = require('./log');

var amfUtils = require('./amfutils.js');

// simplest
var obj = [ {a1: 'this a1',
    a2: [ 1, 2, 3, '4', '5' ],
    a3: { name: 'a3' },
    a4: 123 }];
/*
var data = new Buffer([3,0,2,97,49,2,0,7,116,104,105,115,32,97,49,0,2,97,50,10,0,0,0,5,0,63,240,0,0,0,0,0,0,0,64,0,0,0,0,0,0,0,0,64,8,0,0,0,0,0,0,2,0,1,52,2,0,1,53,0,2,97,51,3,0,4,110,97,109,101,2,0,2,97,51,0,0,9,0,2,97,52,0,64,94,192,0,0,0,0,0,0,0,9])
log.logHex(data);
console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
log.logHex(data = amfUtils.amf0Encode([obj]));
console.log(amfUtils.amf0Decode(data)[0]);
var s1 = new AMF.AMFSerialiser("setObj");
var s2 = new AMF.AMFSerialiser(1);
var buf = new Buffer(s2.byteLength);

s2.write(buf.slice(0,s2.byteLength));
//log.logHex(amfUtils.encodeAmf0Cmd({cmd:["publish"], transId: 1, cmdObj: obj, name:"setObj", type: RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE}))

var opt = {cmd:"call", transId: 1, cmdObj: "login", args:"Benson"};
console.log(opt.cmd);
data = amfUtils.encodeAdobeAmf0Cmd(opt);
return;
*/
var rtmp = RTMPClient.connect('43.251.76.111',443, function() {
	console.log("connected!");

    /*var s1 = new AMF.AMFSerialiser("connect");
    var s2 = new AMF.AMFSerialiser(1);
    var s3 = new AMF.AMFSerialiser({
        app: "ondemand?auth=daEaparbYcMbbaOd0cMdHavcvdja3a8c0bB-bpctkg-vga-Jxt&slist=vod/&aifp=vod",
        flashVer: "MAC 10,0,32,18",
        tcUrl: "rtmp://cp98428.edgefcs.net:1935/ondemand?auth=daEaparbYcMbbaOd0cMdHavcvdja3a8c0bB-bpctkg-vga-Jxt&slist=vod/&aifp=vod",
        fpad: false,
        capabilities: 15.0,
        audioCodecs: 3191.0,
        videoCodecs: 252.0,
        videoFunction: 1.0,
    });
    var buf = new Buffer(s1.byteLength + s2.byteLength + s3.byteLength);
    s1.write(buf.slice(0,s1.byteLength));
    s2.write(buf.slice(s1.byteLength,s1.byteLength + s2.byteLength));
    s3.write(buf.slice(s1.byteLength + s2.byteLength));

    rtmp.sendPacket(0x03, RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, buf);
    */

    rtmp.sendInvoke("connect", 1, {
        app: "motest/g1",
        flashVer: "MAC 10,0,32,18",
        tcUrl: "rtmp://43.251.76.107:23/motest/g1",
        fpad: false,
        capabilities: 15.0,
        audioCodecs: 0.0,
        videoCodecs: 252.0,
        videoFunction: 1.0
    });

    setTimeout(function () {
        //rtmp.sendPacket(0x03, 0x14, b);



        //rtmp.sendInvokeMessage("login", 1, {}, "Benson");
        //SendRTMPPacket(rtmp,"login",1, {}, amfUtils.amf0Encode(["Benson"]) );
        rtmp.sendInvokeMessage("setObj", 1, null, "Benson");
        SendRTMPPacket(rtmp,"setObj",1, null, amfUtils.amf0Encode([{},obj]) );
        console.log('-+-+-+-+-+-+-+-+-+-+-+');

    },1000)


});

function SendRTMPPacket(rtmp, commandName,transactionId, commandObj, data_buf){

    var s1 = new AMF.AMFSerialiser(commandName);
    var s2 = new AMF.AMFSerialiser(transactionId);
    var s3 = new AMF.AMFSerialiser(commandObj);
    console.log(commandName);
    var buf = new Buffer(s1.byteLength + s2.byteLength).fill(0x0);
    s1.write(buf.slice(0,s1.byteLength));
    s2.write(buf.slice(s1.byteLength,s1.byteLength + s2.byteLength));
    //s3.write(buf.slice(s3.byteLength));
    buf = Buffer.concat([buf, data_buf]);
    rtmp.sendPacket(0x14, RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, buf);
}
//var test = new Buffer([0x14,0,0, 155, 0, 0 ,26, 17, 0, 2, 0, 5, 108, 111,103, 105, 110, 0,0,0,0,0,0,0,0,0, 5,2,0,4,116,101,115,116]);
rtmp.on('message', function(message) {
    if (message.messageHeader.messageType == 20) {
        //console.log("++++++RTMP MESSAGE", "Type:",message.messageHeader.messageType);//, message.chunks[0].buffer.toString

        var data = message.data;
        var cmd = data.commandName;
        var tranId = data.transactionId;
        var argument = data.arguments;
        console.log('INFO :: cmd:%s, argument:%s', cmd, argument);
        if (cmd === "onLogin") {


            //SendRTMPPacket(rtmp,"setObj",1, {}, amfUtils.amf0Encode([argument[1]]) );
            //SendRTMPPacket(rtmp,"setObj",1, {}, amfUtils.amf0Encode(["Benson"]) );


        }

    }

});


rtmp.on('data', function (data) {


});
rtmp.on('error', function(args) {
    console.log("RTMP ERROR", args);
});
rtmp.on('close', function(args) {
    console.log("RTMP connection closed");
});