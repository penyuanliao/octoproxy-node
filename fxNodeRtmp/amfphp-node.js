/**
 * Created by Benson.Liao on 2016/11/9.
 */
const log           = require('./log.js');
const assert        = require('assert');
const responder     = require('./amf3/responder.js');
const AMFConnection = require('./amf3/AMFConnection.js');
const amf0          = require("./amfUtils.js");
const netAMF        = AMFConnection.NetAMF;
const fxNetSocket   = require('fxNetSocket');
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
    // gateway2.setAMFService("67f00a37933c1c839bb4f8101b05bc6fa72ff612",1, "中文字","64");

    gateway2.setAMFService("9d1adf64597438079dcbbe09a34e6720a6b3e813","127.0.0.1", "5906");

};

simplest.prototype.ping2_Result = function (data) {
    console.log("Option1 ping2_Result:", new Date().getTime() - this.timestamp, 'ms', JSON.stringify(data));
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

simple.demo3();