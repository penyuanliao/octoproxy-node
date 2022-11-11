"use strict";
const events = require("events");
const Schedule = require('node-schedule');
const NSLog  = require('fxNetSocket').logger.getInstance();

class Scheduler extends events.EventEmitter {
    /**
     * 排程管理服務
     * @param delegate
     * @constructor
     */
    constructor(delegate) {
        super();
        this.schedules = []; //清單
        this.schedulesInfo = new Map();
        this.scheduleId = 0;
        this.delegate = delegate;
        this.storedEnabled = false;
    }
    static get BehaviorDefine() {
        return {
            Reboot: "Reboot",
            BlueGreen: "Blue-Green",
        };
    };
    /**
     * 排程清單
     * @return {[]}
     */
    getSchedule() {
        return this.schedules;
    }
    /**
     * 新增排程
     * @param params
     * @return {boolean}
     */
    job(params) {
        const {time, name, behavior, pid} = params;

        if (Array.isArray(time) == false) {
            return false;
        }
        if (typeof time == "string") {
            return this.createRuleJob(params);
        }
        let repeating = params.repeating || "None";
        //repeating
        const [year, month, date, hours, min, sec] = time;
        const id = "task-" + this.scheduleId++;
        if (["hours", "week", "day", "month"].indexOf(repeating.toLowerCase()) == -1) params.repeating = false;
        // console.log(parseInt(year), parseInt(month) - 1, parseInt(date), parseInt(hours), parseInt(min), parseInt(sec));
        let task = {
            id: id,
            name,
            pid,
            job: "",
            repeating: (params.repeating ? params.repeating.toLowerCase() : false),
            dateAdded: new Date().getTime(),
            behavior: behavior || Scheduler.BehaviorDefine.Reboot,
            executeTime: new Date(parseInt(year), parseInt(month)-1, parseInt(date), parseInt(hours), parseInt(min), parseInt(sec), 0)
        };
        if (params.repeating != false) {
            let rule = new Schedule.RecurrenceRule();

            if (params.repeating.toLowerCase() == "week") {
                rule.dayOfWeek = [task.executeTime.getDay()];
            } else if (params.repeating.toLowerCase() == "day") {
                rule.dayOfWeek = [new Schedule.Range(0, 6)];
            } else if (params.repeating.toLowerCase() == "hours") {
                rule.hour = params.customize || 1;
                task.customize = rule.hour;
            } else if (params.repeating.toLowerCase() == "month") {
                rule.date = task.executeTime.getDate();
            }
            if (params.repeating.toLowerCase() != "hours") {
                rule.hour = task.executeTime.getHours();
                rule.minute = task.executeTime.getMinutes();
                rule.second = task.executeTime.getSeconds();
            }
            task.job = Schedule.scheduleJob(rule, this.onTrigger.bind(this, name, id));
        } else {
            task.job = Schedule.scheduleJob(task.executeTime, this.onTrigger.bind(this, name, id));
        }
        NSLog.info(`task -> 
        ${task.id} 
        ${task.name} 
        ${task.pid} 
        ${task.behavior} 
        ${task.executeTime} 
        `);
        this.schedulesInfo.set(id, task);

        this.refresh();
        return true;
    };
    /**
     * 建立新的排程
     * @param time
     * @param name
     * @param behavior
     * @param pid
     * @param repeating
     * @return {boolean}
     */
    createRuleJob({time, name, behavior, pid, repeating}) {
        const id = "task-" + this.scheduleId++;
        let task = {
            id: id,
            name,
            pid,
            job: "",
            repeating: false,
            dateAdded: new Date().getTime(),
            behavior: behavior || Scheduler.BehaviorDefine.Reboot,
            executeTime: time
        };
        task.job = Schedule.scheduleJob(task.executeTime, () => this.onTrigger(name, id, pid));
        this.schedulesInfo.set(id, task);
        this.refresh();
        return true;
    };
    async onTrigger(name, id, pid) {
        let currPID;
        let out = (typeof this.delegate == "undefined");
        if (out == false) {
            const {behavior, repeating} = this.schedulesInfo.get(id);
            NSLog.debug(`onTrigger ${name}, id:${id}, pid: ${pid} behavior: ${behavior}`);
            switch (behavior) {
                case Scheduler.BehaviorDefine.Reboot:
                    this.systemReboot(name, pid);
                    break;
                case Scheduler.BehaviorDefine.BlueGreen:
                    currPID = await this.deploymentBlueGreen(name, id, pid);
                    break;
                default:
            }
            if (repeating == false) {
                this.schedulesInfo.delete(id);
            } else {
                if (currPID) {
                    this.schedulesInfo.get(id).pid = currPID;
                    NSLog.debug(`>>`, this.schedulesInfo.get(id));
                }
            }
        }

        this.refresh();
    };
    systemReboot(name, pid) {
        this.delegate.restartCluster({
            name,
            gracefully: false,
            pid
        });
        NSLog.log("debug", "Scheduler[%s]Daemon has waiting restart.", name);
    };
    async deploymentBlueGreen(assign, id, pid) {
        NSLog.log("info", `Using blue-green deployment. ${assign}-${pid} to Blue...Start`);
        const manager = this.delegate.delegate;
        let nPid = await manager.cloneCluster({assign, pid});
        NSLog.log("info", `Using blue-green deployment. ${assign}-${nPid} to Green...OK`);
        return nPid;
    };
    cancel(params) {
        let result = false;
        const {id} = params;
        if (this.schedulesInfo.has(id)) {
            if (this.schedulesInfo.get(id).job) {
                this.schedulesInfo.get(id).job.cancel();
                result = true;
            }
        }

        this.schedulesInfo.delete(id);
        this.refresh();
        return result;
    };
    refresh() {
        let list = [];
        let item;
        for (let item of this.schedulesInfo.values()) {
            let {id, name, dateAdded, executeTime, behavior, repeating, customize} = item;
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
                        time.setHours(time.getHours() + (customize ? customize : 1));
                    } else if (repeating.toLowerCase() == "month") {
                        time.setMonth(time.getMonth() + 1);
                    }

                    item.executeTime = time;
                    task.executeTime = item.executeTime.getTime();

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
    save() {
        const {storedEnabled} = this;
        if (storedEnabled == false) return false;
    };
    clear() {

    };
    release() {
    };
}
module.exports = exports = Scheduler;