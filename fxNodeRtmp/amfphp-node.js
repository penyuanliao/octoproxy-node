/**
 * Created by Benson.Liao on 2016/11/9.
 */
const log           = require('./log.js');
const assert        = require('assert');
const responder     = require('./amf3/responder.js');
const AMFConnection = require('./amf3/AMFConnection.js');
const netAMF        = AMFConnection.NetAMF;

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
    gateway2.connect('http://192.168.154.163:80/amfphp/gateway.php');
    var self = this;
    gateway2.call('Dealer.ping', self.responds, {"action":"betInfolog","bs":778,"betInfo":{"status":"beginGame2","line":5,"lineBet":10,"wagersID":"428082","credit":"187735.00"}});

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
        this.gateway2.connect('http://192.168.154.163:80/amfphp/gateway.php');
        this.gateway2.setKeepAlive = false;
    }
    self.gateway2.call('Dealer.ping_wait', self.responds,5); // null, undefined
};

simplest.prototype.ping2_Result = function (data) {
    console.log("Option1 ping2_Result:", new Date().getTime() - this.timestamp, 'ms', data);
};
simplest.prototype.onResult = function (data) {
    console.log('Option2 Result:', JSON.stringify(data));
};
simplest.prototype.onStatus = function (data) {
    console.log('Option2 onStatus:', data);
};
var simple = new simplest();

simple.option2_1();