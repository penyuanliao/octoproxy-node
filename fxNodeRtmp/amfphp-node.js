/**
 * Created by Benson.Liao on 2016/11/9.
 */
const log           = require('./log.js');
const assert        = require('assert');
const responder     = require('./amf3/responder.js');
const AMFConnection = require('./amf3/AMFConnection.js');
const amf0          = require("./amfUtils.js");
const netAMF        = AMFConnection.NetAMF;
const fxNetSocket   = require('../').fxNetSocket;
const NSLog         = fxNetSocket.logger.getInstance();
NSLog.configure({
    logFileEnabled:false,
    consoleEnabled:true,
    level:'trace',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath:__dirname+"/historyLog",
    id:"octoproxy",
    remoteEnabled: true,
    /*console:console,*/
    trackBehaviorEnabled: false, // toDB server [not implement]
    maximumFileSize: 1024 * 1024 * 100});
NSLog.log("quiet","start -------");
function simplest() {
    this.responds = new responder(this.onResult, this.onStatus);
}
simplest.prototype.option1 = function () {
    var gateway2 = AMFConnection.createGatewayConnection('http://admin.vir777.com:80/amfphp/gateway.php');
    this.timestamp = new Date().getTime();
    gateway2.getService('GameDefine.getGameClosedList', this);
    gateway2.tmpHand = "ping2";
    gateway2.setAMFService();
};
simplest.prototype.option2_1 = function () {

    var gateway2 = new netAMF();
    gateway2.debugEnabled = true;
    gateway2.connect('http://192.168.154.163:80/amfphp/gateway.php');
    var self = this;
    gateway2.call('Dealer.ping6', self.responds,129499264,1.1,[{"JPTypeID":"1","PoolID":1},{"JPTypeID":"2","PoolID":6},{"JPTypeID":"3","PoolID":16406563},{"JPTypeID":"4","PoolID":16406501}]);

};
simplest.prototype.option2_3 = function () {

    var gateway2 = new netAMF();
    gateway2.connect('http://43.251.76.232:80/amfphp/gateway.php');
    var self = this;
    gateway2.call('JackpotServer.JackpotServer.increaseJackpotRate', self.responds,129499264,5,[{"JPTypeID":"1","PoolID":1},{"JPTypeID":"2","PoolID":6},{"JPTypeID":"3","PoolID":16406563},{"JPTypeID":"4","PoolID":16406501}],6,5906,5);

};
simplest.prototype.option2_2 = function () {
    var gateway2 = new netAMF();
    gateway2.client = this;
    gateway2.connect('http://192.168.154.163:80/amfphp/gateway.php');
    gateway2.call('Dealer.ping2', null, [{'hi':1},{'hi':1}], 1.04);

};
simplest.prototype.demo = function () {
    var self = this;
    if (typeof this.gateway2 == "undefined") {
        this.gateway2 = new netAMF();
        this.gateway2.connect('http://43.251.76.232:80/amfphp/gateway.php');
        this.gateway2.debugEnabled = true;
    }
    self.gateway2.call('JackpotServer.JackpotServer.increaseJackpotRate', self.responds,129499264,5,[{"JPTypeID":"1","PoolID":1},{"JPTypeID":"2","PoolID":6},{"JPTypeID":"3","PoolID":16406563},{"JPTypeID":"4","PoolID":16406501}],6,5906,5);

};
simplest.prototype.demo2 = function () {
    var self = this;
    if (typeof this.gateway2 == "undefined") {
        this.gateway2 = new netAMF();
        this.gateway2.connect('http://192.168.154.163:80/amfphp/gateway.php');
        this.gateway2.setKeepAlive = false;
    }
    self.gateway2.call('Dealer.json_data1', self.responds); // null, undefined
};
simplest.prototype.demo3 = function () {
    var gateway2 = AMFConnection.createGatewayConnection('http://43.251.76.215:80/amfphp/gateway.php');///192.168.0.104,192.168.154.163,43.251.76.232
    this.timestamp = new Date().getTime();
    gateway2.getService('Client.loginCheck', this);
    gateway2.tmpHand = "ping2";

    //var o = {"action":"onBeginGame","result":{"event":true,"data":{"event":true,"WagersID":"624599","EncryID":null,"BetInfo":{"Bet":"50","event":true,"BetCredit":"50","BetBalanceRate":"1","BetCreditRate":"1"},"Credit":"4950.00","Bonus":{"Item":"_LOSE_V2","Rate":0,"Bet":"50","Pay":0},"PayTotal":0,"BetTotal":"50","Cards":{"Program":{"Banker":[5,4,2,3,6,2],"Set":{"1":{"Player":[5,1,1],"Intersect":[5],"Diff":{"1":4,"2":2,"3":3,"4":6,"5":2}},"2":{"Player":[1,3,5],"Intersect":{"3":3},"Diff":{"1":4,"2":2,"4":6,"5":2}},"3":{"Player":[2,3,2],"Intersect":{"2":2,"5":2},"Diff":{"1":4,"4":6}}},"Shooter":0}},"BetValue":50,"PayValue":0}}};
    // gateway2.getService('rng.slot.crash.EParadise.onLoadInfo', this);
    // gateway2.setAMFService("129499264","7");
    // gateway2.getService('rng.slot.crash.EParadise.getMachineDetail', this);
    setInterval(function () {
        gateway2.setAMFService("e0f0e29bb1b160c13ea94bb977f8f0b230e49157","111.235.135.54","5090");
    }, 50)


};

simplest.prototype.ping2_Result = function (data) {
    // console.log("Option1 ping2_Result:", new Date().getTime() - this.timestamp, 'ms', data);
};
simplest.prototype.ping2_Status = function (err) {
    console.log("Option1 ping2_Status:", new Date().getTime() - this.timestamp, 'ms', err);
};
simplest.prototype.onResult = function (data) {
    console.log('Option2 Result:', JSON.parse(JSON.stringify(data)));
};
simplest.prototype.onStatus = function (data) {
    console.log('Option2 onStatus:', data);
};
var simple = new simplest();

// simple.demo3();

const amf3Utils = require('./amf3/amf3Utils.js');
var serializer = new amf3Utils.serializer();
// var deserializer = new amf3Utils.deserializer();

// var a = Buffer.from("000000010012417070656e64546f4761746577617955726c000000002e1106573f5048505345535349443d35316564336633353564613834373463653937333862336337643961653061340001000d2f3533322f6f6e526573756c7400046e756c6c00000372110a0b010b6576656e740309646174610a0b01000311576167657273494406193132313430343632383333330f456e6372794944010f426574496e666f0a0b0100030f4c696e654e756d0603310f4c696e65426574060535301d42657442616c616e636552617465060e1b4265744372656469745261746506053130134265744372656469740432010d437265646974061134393836332e3030154372656469745f456e64061135303032392e30300b43617264730909010665352d31302d362d372d372c322d362d352d372d342c372d382d382d352d352c322d312d352d352d372c382d312d362d382d370665362d382d31322d372d352c322d372d352d372d342c372d322d382d352d352c322d322d352d352d372c382d332d362d382d370663362d362d352d332d352c322d372d372d372d342c372d322d382d352d352c322d322d352d352d372c382d332d362d382d370663382d312d332d342d342c362d382d382d352d352c322d332d352d342d342c372d362d382d332d372c382d332d362d382d370b4c696e65730909010903010a0b0113456c656d656e744944040a0b47726964730631302c312c312c322c362c332c31312c342c31362c32312c310d5061796f666604301747726964735061796f6666062d342c302c302c382c382c382c31302c382c312c312c300d446f75626c650401010903010a0b0130040c32060f332c312c372c32360416380611382c31302c342c303c0401010907010a0b0130040732060b362c372c380f477269644e756d04033604183c0401010a0b0130040232061131312c31352c31364404033604063c0401010a0b0130040532061731332c31342c31372c31384404043604103c0401010901010f5061747465726e0a0b011b506c617965725061747465726e09330104010401040104010400040104000400040004010401040104010401040004010400040004000401040104010401040104001b4f726967696e5061747465726e093301040004010401040104000401040004000400040104010401040104010400040104000400040004010401040104010401040017426f6d625061747465726e0603421b57696e6e65725061747465726e091e1b5061747465726e5061796f666604320111506179546f74616c04812611426574546f74616c04321142657456616c756504051150617956616c756505403099999999999a0101","hex");
// var gateway2 = new netAMF();
// console.log(JSON.stringify(gateway2.readBody(a),null,'\t'));
// log.logHex(a);
console.log(serializer.amf3Encode([{"1":1}]));