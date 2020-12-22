const net = require("net");
const util = require("util");
const EventEmitter = require("events");
const Schedule = require('node-schedule');
const NSLog  = require('fxNetSocket').logger.getInstance();
util.inherits(Scheduler, EventEmitter);

const BehaviorDefine = Object.freeze({
    "Reboot": "Reboot",
    "BlueGreen": "Blue-green"
});

function Scheduler(delegate) {
    EventEmitter.call(this);
    this.schedules = [];
    this.schedulesInfo = {};
    this.scheduleId = 0;
    this.delegate = delegate;
    this.job({
        time: [2020, 12, 18, 1, 26, 0],
        name:"binder",
        behavior: BehaviorDefine.Reboot,
        repeating: "week"
    });
}
Scheduler.prototype.getSchedule = function () {
    return this.schedules;
};
Scheduler.prototype.job = function (params) {
    const {time, name, behavior} = params;

    if (Array.isArray(time) == false) {
        return false;
    }
    if (typeof time == "string") {
        return this.createRuleJob(params);
    }
    //repeating
    const [year, month, date, hours, min, sec] = time;
    const id = "task-" + this.scheduleId++;
    if (["hours", "week", "day", "month"].indexOf(params.repeating) == -1) params.repeating = false;
    console.log(parseInt(year), parseInt(month) - 1, parseInt(date), parseInt(hours), parseInt(min), parseInt(sec));
    let task = {
        id: id,
        name: name,
        job: "",
        repeating: params.repeating || false,
        dateAdded: new Date().getTime(),
        behavior: behavior || BehaviorDefine.Reboot,
        executeTime: new Date(parseInt(year), parseInt(month)-1, parseInt(date), parseInt(hours), parseInt(min), parseInt(sec), 0)
    };
    if (params.repeating != false) {
        let rule = new Schedule.RecurrenceRule();

        if (params.repeating.toLowerCase() == "week") {
            rule.dayOfWeek = [task.executeTime.getDay()];
        } else if (params.repeating.toLowerCase() == "day") {
            rule.dayOfWeek = [new Schedule.Range(0, 6)];
        } else if (params.repeating.toLowerCase() == "hours") {

        } else if (params.repeating.toLowerCase() == "month") {
            rule.date = task.executeTime.getDate();
        }
        rule.hour = task.executeTime.getHours();
        rule.minute = task.executeTime.getMinutes();
        rule.second = task.executeTime.getSeconds();
        task.job = Schedule.scheduleJob(rule, this.onTrigger.bind(this, name, id));
    } else {
        task.job = Schedule.scheduleJob(task.executeTime, this.onTrigger.bind(this, name, id));
    }
    this.schedulesInfo[id] = task;

    this.refresh();
    return true;
};
Scheduler.prototype.createRuleJob = function (params) {
    const {time, name, behavior} = params;
    const id = "task-" + this.scheduleId++;
    let task = {
        id: id,
        name: name,
        job: "",
        repeating: false,
        dateAdded: new Date().getTime(),
        behavior: behavior || BehaviorDefine.Reboot,
        executeTime: time
    };
    task.job = Schedule.scheduleJob(task.executeTime, this.onTrigger.bind(this, name, id));
    this.schedulesInfo[id] = task;
    this.refresh();
    return true;
};
Scheduler.prototype.onTrigger = function (name, id) {
    let out = (typeof this.delegate == "undefined");

    if (out == false) {
        const {behavior} = this.schedulesInfo[id];
        switch (behavior) {
            case BehaviorDefine.Reboot:
                this.systemReboot(name, id);
                break;
            case BehaviorDefine.BlueGreen:
                this.deploymentBlueGreen(name);
                break;
            default:
        }
    }
    if (this.schedulesInfo[id].repeating == false) {
        this.schedulesInfo[id] = undefined;
        delete this.schedulesInfo[id];
    }
    this.refresh();
};
Scheduler.prototype.systemReboot = function (name, id) {
    if (name == "casino_game_rule") {
        this.delegate.restartGLoadBalance();
    } else {
        const group = this.delegate.delegate.clusters;
        const clusters = group[name];
        if (Array.isArray(clusters)) {
            for (let i = 0; i < clusters.length; i++) {
                let cluster = clusters[i];
                NSLog.log("debug", "Schedule[%s]Daemon has waiting restart.", name);
                cluster.restart();
            }
        }
    }
};
Scheduler.prototype.deploymentBlueGreen = function (assign) {
    const group = this.delegate.delegate.clusters[assign];
    if (typeof group == "undefined") return false;
    let cluster;
    for (let i = 0; i < group.length; i++) {
        cluster = group[i];
        this.delegate.delegate.cloneCluster(assign);
        NSLog.log("info", "Using blue-green deployment. %s to Green...OK", assign);
    }
};
Scheduler.prototype.cancel = function (params) {
    let result = false;
    const {id} = params;
    if (this.schedulesInfo[id].job) {
        this.schedulesInfo[id].job.cancel();
        result = true;
    }
    this.schedulesInfo[id] = undefined;
    delete this.schedulesInfo[id];
    this.refresh();
    return result;
};
Scheduler.prototype.refresh = function () {
    const keys = Object.keys(this.schedulesInfo);
    let list = [];
    let item;
    for (let i = 0; i < keys.length; i++) {
        let {id, name, dateAdded, executeTime, behavior, repeating} = this.schedulesInfo[keys[i]];
        let task = {
            id: id,
            name: name,
            behavior: behavior,
            dateAdded: dateAdded,
            countDown: 0,
        };
        let time = new Date();

        if (repeating == false) {
            task.executeTime = executeTime.getTime();
            task.countDown = (task.executeTime - time.getTime());
        } else {
            if (time.getTime() > executeTime.getTime()) {
                time.setTime(executeTime.getTime());
                if (repeating.toLowerCase() == "week") {
                    time.setDate(time.getDate() + 7);
                } else if (repeating.toLowerCase() == "day") {
                    time.setDate(time.getDate() + 1);
                } else if (repeating.toLowerCase() == "hours") {
                    time.setHours(time.getHours() + 1);
                } else if (repeating.toLowerCase() == "month") {
                    time.setMonth(time.getMonth() + 1);
                }

                this.schedulesInfo[keys[i]].executeTime = time;
                task.executeTime = this.schedulesInfo[keys[i]].executeTime.getTime();

            } else {
                task.executeTime = executeTime.getTime();
            }

            task.countDown = (task.executeTime - new Date().getTime());
        }
        if (task.countDown < 0) task.countDown = 0;
        list.push(task);
    }
    this.schedules = list;
};

module.exports = exports = Scheduler;