const path           = require("path");
const util          = require("util");
const EventEmitter  = require("events");
const OctoPlugins   = require("../lib/OctoPlugins.js");

util.inherits(BinderIPC, EventEmitter);
function BinderIPC() {
    EventEmitter.call(this);
    this.setup();
    setInterval(function () {
        // console.log('wait');
    }, 10000)
    console.log(path.resolve(process.cwd(), "../configuration"));
}
BinderIPC.prototype.setup = function (server) {
    const self = this;
    this.octoPlugins = new OctoPlugins(this, console);
    this.octoPlugins.onReload = function onReload(data, handle) {
        //重新載入事件
        return true;
    };
    var onCustomMessage = function onCustomMessage(data, handle) {
        console.log(data);
        //客製化事件
    };
    var onKickUsersOut = function onKickUsersOut(data, handle) {
        //踢人事件
    };
    this.octoPlugins.on("ipcMessage", onCustomMessage);

    this.octoPlugins.on("kickUsersOut", onKickUsersOut);

    this.octoPlugins.setupIPCBridge(server);

    this.octoPlugins.makeSureComplete();
};
module.exports = exports = BinderIPC;

const main = new BinderIPC();