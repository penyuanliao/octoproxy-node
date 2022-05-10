/**
 * Created by penyuan on 2016/4/13.
 */

const util = require('util');
const debug = require('debug')('cpbase');
debug.log = console.log.bind(console);
var events = require('events');

util.inherits(clusterConstructor, events.EventEmitter); // 繼承事件

function clusterConstructor() {

    events.EventEmitter.call(this);

    this.name = "ProcessConstructor";
    this.connections = 0;
    this.initProcessEvent();

}
clusterConstructor.prototype.test = function (data) {
    console.log('test',this.name,data);
    //how to use super method.
    //StreamServer.super_.prototype.test.apply(this,[data]);
};

clusterConstructor.prototype.initProcessEvent = function () {
    debug('init process event');
    /** process state **/
    process.on('uncaughtException', this.onUncaughtException);
    process.on("disconnect", this.onDisconnect);
    process.on("SIGQUIT", this.onSIGQUIT);
    process.on("message", this.onMessage.bind(this));
};

clusterConstructor.prototype.onUncaughtException = function (err) {
    console.error(err.stack);
};

clusterConstructor.prototype.onDisconnect = function () {
    debug("sends a QUIT signal (SIGQUIT)");
    process.exit(0);
};

clusterConstructor.prototype.onSIGQUIT = function () {
    debug("IPC channel exit -1");
    process.exit(-1);
};

clusterConstructor.prototype.onMessage = function (data) {
    var json = data;
    if (typeof json === 'string') {

    }else if (typeof json === 'object') {
        if (json.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": this.connections}})
        }
    }else {
        debug('out of hand. dismiss message');
    }
};

module.exports = clusterConstructor;