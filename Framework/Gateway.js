const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const RPCClient     = require("../lib/RPCSocket.js").Client;

util.inherits(Gateway, EventEmitter);
function Gateway() {
    EventEmitter.call(this);

    this.adapters = {};

    this.setup();

}
Gateway.prototype.setup = function () {
    const OPTIONS = Object.freeze({
        host:"127.0.0.1",
        port:5213,
        balance:"/fxLive/fxLB?gameType=fetchWager",
        delimiter:'\r\n'});
    this.adapters = this.createAdapter(OPTIONS);
};
Gateway.prototype.createAdapter = function (options) {
    return new RPCClient(this, options);
};
module.exports = exports = Gateway;