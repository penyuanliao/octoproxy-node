/**
 * Created by Benson.Liao on 18/06/05.
 */
const net          = require("net");
const util         = require("util");
const EventEmitter = require("events");

util.inherits(GameServer, EventEmitter);

function GameServer() {
    EventEmitter.call(this);
}
GameServer.prototype.setup = function () {
    var self = this;
    var client = new nStream(this, {notStream:true});
    client.initStatus = {initGameInfoBB:false, initGameInfoMi: false, initGameInfoVIP:false};
    client.connect("rtmp://43.251.76.219:443/Hall/service.NodeJS");
    client.on("fmsConnect", function (cmd) {
        client.called("loginAsNode");
    });
    this.client = client;
};
GameServer.prototype.loginAsNode_result = function (result) {
    console.log('loginAsNode_result', result);
};
GameServer.prototype.initGameInfoBB = function (result) {
    this.client.initStatus.initGameInfoBB = true;
    this.client.called("getMiHalldata");
};
GameServer.prototype.getMiHalldata_result = function (result) {
};
GameServer.prototype.initGameInfoMi = function (result) {
    this.client.initStatus.initGameInfoMi = true;
    this.client.called("getVIPHalldata");
};
GameServer.prototype.getVIPHalldata_result = function (result) {
};
GameServer.prototype.initGameInfoBB = function (result) {
    this.client.initStatus.initGameInfoVIP = true;
    this.client.called("updateNode", true);
};
GameServer.prototype.updateNode_result = function (result) {

};
GameServer.prototype.updateItalkingURL = function (result) {
    // console.log(arguments);
};
GameServer.prototype.updateGameInfoMi = function (result) {
    // console.log(arguments);
};
GameServer.prototype.updateGameInfoVIP = function (result) {
    // console.log(arguments);
};
GameServer.prototype.uppdateHallInfo = function (result) {
    // console.log(arguments);
};
GameServer.prototype.updateGameInfo = function (result) {
    // console.log(arguments);
};
GameServer.prototype.getJumpMessage = function (result) {

};
module.exports = exports = GameServer;