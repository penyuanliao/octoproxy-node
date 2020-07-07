const net = require("net");
const util = require("util");
const EventEmitter = require("events");

util.inherits(Scheduler, EventEmitter);

function Scheduler() {
    EventEmitter.call(this);
    this.jobs = [];

}
Scheduler.prototype.load = function () {
    
};
Scheduler.prototype.clock = function (job, timestamp) {
    var now = new Date().getTime();
    var waiting = timestamp - now;
    var self = this;
    this.job.waiting = setTimeout(function () {
        if (job.status == "active") {
            self.trigger(job.target)
        }
    }, waiting)
};
Scheduler.prototype.trigger = function (target) {

    switch (target) {
        case "reboot": {
            break;
        }
    }
};

module.exports = exports = Scheduler;