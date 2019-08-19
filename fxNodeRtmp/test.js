var AMF = require('./amf');
var RTMPClient = require('./client');
var RTMPPacket = require('./packet');
var RTMPMessage = require('./message');
var log = require('./log');
const amf3Utils      = require('./amf3/amf3Utils.js');
var amf3Deserializer = new amf3Utils.deserializer();

var amfUtils = require('./amfutils.js');


// console.log(amfUtils.amf0encObject(null));
// console.log(amfUtils.amf0encString("play"));
// console.log(amfUtils.amf0encNumber(0));// transactionID = 0
// console.log(amfUtils.amf0encNull()); // Command Object = NULL
// console.log(amfUtils.amf0encString("videosd"));

var obj = {
    "BBJackpot" : {
        "Pools" : []
    }
};

obj.BBJackpot.Pools[0] = null;
obj.BBJackpot.Pools[1] = {
    "PoolID":"grand",
    "JPTypeID":"1",
    "PoolAmount":28426.95952
};
obj.BBJackpot.Pools[2] = {
    "PoolID":"32",
    "JPTypeID":"2",
    "PoolAmount":14.32544
};
obj.BBJackpot.Pools[3] = {
    "PoolID":"32-5148",
    "JPTypeID":"3",
    "PoolAmount":0.04544
};
obj.BBJackpot.Pools[4] = {
    "PoolID":"177560839",
    "JPTypeID":"4",
    "PoolAmount":62.6738
};
var data = amfUtils.amf0Encode([obj]);

// console.log(log.logHex(data));
var bb = new Buffer("0300056576656e7401010004646174610300056576656e7401010008576167657273494402000c3331303630353536383634370007456e6372794944050007426574496e666f0300056576656e74010100074c696e654e756d0200013500074c696e654265740200023130000e42657442616c616e63655261746502000131000d426574437265646974526174650200023130000942657443726564697400404900000000000000000900064372656469740040e863c000000000000a4372656469745f456e6402000834393935302e3030000543617264730a00000001020027322d352d322d332c322d322d322d312c342d352d332d312c322d352d312d332c332d332d322d3200054c696e65730a000000010a000000000008427269636b4e756d00404680000000000000074c6576656c4944003ff00000000000000008506179546f74616c00000000000000000000084672656554696d65000000000000000000000a446f75626c6554696d650000000000000000000008426574546f74616c004049000000000000000942424a61636b706f740a00000000000842657456616c7565004014000000000000000850617956616c7565000000000000000000000009000474696d650a0000000f0041d73d9133c6403a003f908aa000000000003f74098000000000003f51060000000000003f1b000000000000003ee5000000000000000000000000000000003ec2000000000000003f577a0000000000003f21d80000000000003f808c4000000000003f29d80000000000003ec8000000000000003f30640000000000003ed0000000000000000009", "hex")
var bb2 = new Buffer("000474696d650a0000000f0041d73d9133c6403a003f908aa000000000003f74098000000000003f51060000000000003f1b000000000000003ee5000000000000000000000000000000003ec2000000000000003f577a0000000000003f21d80000000000003f808c4000000000003f29d80000000000003ec8000000000000003f30640000000000003ed0000000000000000009000000000000000000000a446f75626c6554696d650000000000000000000008426574546f74616c004049000000000000000942424a61636b706f740a00000000000842657456616c7565004014000000000000000850617956616c7565000000000000000000000009000474696d650a0000000f0041d73d9133c6403a003f908aa000000000003f74098000000000003f51060000000000003f1b000000000000003ee5000000000000000000000000000000003ec2000000000000003f577a0000000000003f21d80000000000003f808c4000000000003f29d80000000000003ec8000000000000003f30640000000000003ed00000000000000000090000000000000000000008426574546f74616c004049000000000000000942424a61636b706f740a00000000000842657456616c7565004014000000000000000850617956616c7565000000000000000000000009000474696d650a0000000f0041d73d9133c6403a003f908aa000000000003f74098000000000003f51060000000000003f1b000000000000003ee5000000000000000000000000000000003ec2000000000000003f577a0000000000003f21d80000000000003f808c4000000000003f29d80000000000003ec8000000000000003f30640000000000003ed00000000000000000090a00000000000842657456616c7565004014000000000000000850617956616c7565000000000000000000000009000474696d650a0000000f0041d73d9133c6403a003f908aa000000000003f74098000000000003f51060000000000003f1b000000000000003ee5000000000000000000000000000000003ec2000000000000003f577a0000000000003f21d80000000000003f808c4000000000003f29d80000000000003ec8000000000000003f30640000000000003ed0000000000000000009", "hex")
log.logHex(amf3Deserializer.amf3Decode(bb))
// log.logHex(amfUtils.amf0EncodeOne(obj));
console.log(JSON.stringify(amfUtils.amf0Decode(bb), null, '\t'));

return;
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



/** 驗證uri字串分解 **/
function verificationString(str) {
    var _path = str.match(/([a-z]+\:\/+)([^\/\s]*)([a-z0-9\-@\^=%&;\/~\+]*)[\?]?([^ \#]*)#?([^ \#]*)/i);

    if (typeof _path === 'undefined') return null;

    if (!_path[2]) return null;

    var url = String(_path[2]).split(":");

    if(!url[1]) url[1] = "443";


    var path = {
        host:url[0],
        port:url[1],
        path:_path[0],
        app:_path[3].substr(1,_path[3].length)
    };
    return path;
}
