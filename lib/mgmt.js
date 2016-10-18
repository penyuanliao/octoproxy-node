/**
 * Created by Benson.Liao on 2016/5/30.
 */

const fxNet = require('fxNetSocket').NetCoonection;
const daemon = require('fxNetSocket').daemon;
const parser = require('fxNetSocket').parser;
const NSLog = require('fxNetSocket').logger.getInstance();
const events = require('events');
const fs = require('fs');
const util = require('util');
const isWorker = ('NODE_CDID' in process.env);
const isMaster = (isWorker === false);
const AssignPath = "../configuration/Assign.json";

util.inherits(mgmt, events.EventEmitter); // 繼承事件

const MGMT_FUNC = [
    "getClusterInfos",
    "restartCluster",
    "addCluster",
    "killCluster",
    "editCluster",
    "getAssign",
    "updateAssign",
    "editAssign",
    "deleteAssign",
    "clusterLockEnabled",
    "killClusterToPID",
    "clusterLockEnabledToPID",
    "trashCluster"];

function mgmt(delegate, cfg, port) {
    events.EventEmitter.call(this);

    this.delegate = delegate;
    this.appConfig = cfg.appConfig;
    this.forkOptions = cfg.forkOptions;
    this.lastTick = undefined;
    this.createServer(port);

    this.clusterInfos = undefined;

    // this.getAssign();
    // setTimeout(this.unitTest.bind(this), 5000);
}
mgmt.prototype.unitTest = function () {
    // this.runClusterInfos(60000);

    // this.editCluster('Hall', 'Hall,RouPlayerBM');

};
mgmt.prototype.createServer = function (port) {
    var self = this;
    var mgmtSrv = new fxNet(port, {'runListen':true, glListener:true});
    mgmtSrv.on('connection', function (client) {
        //todo verify access login
        if (client.mode == "ws" || client.mode == "http"){
            client.close();
        }
        client.heartbeatEnabled = false; // timeout false
    });
    mgmtSrv.on('message', function (e) {

        NSLog.log('log',"mgmt[message]:", e.data);

        var arr = e.data.match(/(\{.+?\})(?={|$)/g);
        for (var i = 0 ; i < arr.length; i++) {
            var json = JSON.parse(arr[i]);
            var client = e.client;
            switch (json.event){
                
                case "addClusterSync":
                    self.addCluster(json.data[0],json.data[1]);
                    break;
                case "killClusterSync":
                    self.killCluster(json.data[0]);
                    break;
                case "assign-get":
                    client.write(JSON.stringify(self.getAssign()));

                    break;
                case "assign-edit":
                    self.updateAssign(json.data[0], client);
                    break;
                case "assign-delete":
                    self.deleteAssign(json.data[0]);
                    break;
                default:
                    if (typeof self[json.event] != "undefined" && MGMT_FUNC.indexOf(json.event) != -1) {
                        if (typeof json.data == "undefined") {
                            json.data = [];
                            json.data["0"] = client;
                        }else {
                            json.data[json.data.length.toString()] = client;
                        }
                        self[json.event].apply(self, json.data);
                    }else {
                        self._writeException(client,self.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
                    }
            }
        }

    });
    mgmtSrv.on('httpUpgrade', function (req, client, head) {

        var _get = head[0].split(" ");

        var socket = client.socket;
        var headers = parser.headers.responseHeader(404, {
            "Connection": "close" });
        socket.write(headers + "<html><head></head><body>Sorry, that page doesn't exist!!</body></html>");
        // client.close();

    });
    mgmtSrv.on('disconnect', function (name) {
        console.log('disconnect:', name);
    });

};
mgmt.prototype.test = function () {
    console.log('todo something', arguments[0], arguments[1]);
    var client = arguments[arguments.length-1];
    client.write("todo something");

    client = null;
    arguments[arguments.length-1] = null;
};
/** 09.26 - edit **/
mgmt.prototype.getClusterInfos = function (client) {
    this.clusterInfos = this.updateClusterInfo();
    client.write(JSON.stringify({"event":"getClusterInfos","data":this.clusterInfos}));
    client = null;
    arguments[arguments.length-1] = null;
};
/** 09.26 - edit **/
mgmt.prototype.restartCluster = function (name, client) {
    var server = this.delegate;
    var group = server.clusters[name];

    if (!this._verifyArgs(name, "string") ) {

        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        client = null;
        arguments[arguments.length-1] = null;
        return;
    }

    for (var i = 0; i < group.length; i++) {
        var cluster = group[i];
        cluster.restart();
        NSLog.log('info', "Admin User do restartCluster();");
    }
    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL);
    client = null;
    server = null;
    group  = null;
};
/** 09.26 - edit **/
mgmt.prototype.addCluster = function(file, name, mxoss, client) {
    var server = this.delegate;
    var group = server.clusters[name];
    var env = process.env;
    NSLog.log("trace","addCluster(%s)", file, name, mxoss);
    if (!this._verifyArgs(file, "string") || !this._verifyArgs(name, "string")) {

        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        client = null;
        arguments[arguments.length-1] = null;
        return;
    }

    env.NODE_CDID = ++server.clusterNum;
    var cluster = new daemon(file,[name], {env:env, execArgv:["--nouse-idle-notification","--max-old-space-size=" + mxoss]});
    cluster.init();
    cluster.name = name;
    cluster.mxoss = mxoss;
    if (!group) {
        server.clusters[name] = [];
        server.roundrobinNum[name] = 0;
    }
    server.clusters[name].push(cluster);

    if (typeof client != "undefined") {
        this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "addCluster");
        client = null;
        arguments[arguments.length-1] = null;
    }
    server = null;
    group  = null;
};
/** 09.26 - edit **/
mgmt.prototype.killCluster = function (name, client) {

    var server = this.delegate;
    var group = server.clusters[name];

    if (!this._verifyArgs(name, "string")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        return;
    }else if (typeof group === 'undefined') {
        this._writeException(client, this.ADMIN_EVENT_TYPE.CLUSTER_NOT_READY);
        return;
    }

    while (group.length > 0){
        var cluster = group.shift();
        cluster.stop();
        cluster.stopHeartbeat();
    }
    delete server.clusters[name];

    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "killCluster");
    client = null;
    arguments[arguments.length-1] = null;
    server = null;
    group  = null;
};
/** kill process to search pid **/
mgmt.prototype.killClusterToPID = function (pid, client) {

    var server = this.delegate;
    var _pid = parseInt(pid);

    var groupKeys = Object.keys(server.clusters);

    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        return;
    }

    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];

        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster.stop();
                cluster.stopHeartbeat();
                group.splice(j,1);

                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "killClusterToPID");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }

    }
    server = null;

};
/** 09.26 - edit **/
mgmt.prototype.editCluster = function (oldName, newName, client) {

    var server = this.delegate;
    var oGroup = server.clusters[oldName];
    var nGroup;

    if (!this._verifyArgs(oldName, "string") || !this._verifyArgs(newName, "string")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        return;
    }else if (typeof oGroup === 'undefined') {
        this._writeException(client, this.ADMIN_EVENT_TYPE.CLUSTER_NOT_READY);
        return;
    }
    if (!server.clusters[newName]) {
        server.clusters[newName] = [];
        server.roundrobinNum[newName] = 0;
        nGroup = server.clusters[newName]
    }

    while (oGroup.length > 0){
        var cluster = oGroup.shift();
        cluster.name = newName;
        nGroup.push(cluster);
    }
    delete server.clusters[oldName];

    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "editCluster");
    client = null;

    // this.editAssgin(oldName, {assign:newName, mxoss:mxoss});
    server = null;
    oGroup  = null;
};
/** 複製一個一樣程序然後另個等待回收 **/
mgmt.prototype.cloneCluster = function (assign) {
    var server = this.delegate;
    var group = server.clusters[assign];
    var cluster = group[0];
    var mxoss = cluster.mxoss;
    var file  = cluster._modulePath;


    this.addCluster(file, assign, mxoss);

    var trash = group.shift();

    server.garbageDump.push(trash);

    NSLog.log("trace","cloneCluster(%s)", assign, group.length, server.garbageDump.length);

    server.awaitTrashUserEmpty();

    server = null;
    group = null;
    cluster = null;
    mxoss = null;
    file = null;
};
/** 超出記憶體限制90% **/
mgmt.prototype.outOfRangeMemLimit = function (assign) {
    var server = this.delegate;
    var group = server.clusters[assign];

    if (typeof group == "undefined") return;

    for (var i = 0; i < group.length; i++) {
        var cluster = group[i];
        if (typeof cluster.nodeInfo != 'undefined') {
            var memory = cluster.nodeInfo.memoryUsage["rss"];

            var memory_m = (memory / 1024 / 1024).toFixed(2);
            var maxMemory = (cluster.mxoss * 0.9);
            var isFull = memory_m > maxMemory;
            NSLog.log("log", "outOfRangeMemLimit: %s > %s = %s", memory_m , maxMemory , isFull);
            if (isFull) { //預留10%緩衝
                this.cloneCluster(assign);
            }
        }
    }

    server = null;
    group = null;
};
/** 自動檢查機制 **/
mgmt.prototype.automaticCheckCluster = function (arr_assign, sec) {
    var self = this;

    var times = setTimeout(function () {
        for (var i = 0; i < arr_assign.length; i++) {
            var assign = arr_assign[i];
            self.outOfRangeMemLimit(assign);
        }
        self.automaticCheckCluster(arr_assign, sec);
    }, sec * 1000);

    return times;
};
/** process socket lock & unlock **/
mgmt.prototype.clusterLockEnabled = function (assign, bool, client) {
    var server = this.delegate;
    var group = server.clusters[assign];

    if (!this._verifyArgs(assign, "string") || !this._verifyArgs(bool, "boolean")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        server = null; group = null;
        return;
    }else if (typeof group === 'undefined') {
        this._writeException(client, this.ADMIN_EVENT_TYPE.CLUSTER_NOT_READY);
        server = null; group = null;
        return;
    }
    var i = group.length;
    while (i-- > 0){
        var cluster = group[i];
        cluster._dontDisconnect = bool;
        NSLog.log('info','cluster[%s]._dontDisconnect:%s', assign, cluster._dontDisconnect);
    }
    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "clusterLockEnabled");
    server = null; group = null;
};
/** process socket lock & unlock to pid **/
mgmt.prototype.clusterLockEnabledToPID = function (pid, bool, client) {
    var server = this.delegate;
    var _pid = parseInt(pid);

    var groupKeys = Object.keys(server.clusters);

    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
        return;
    }

    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];

        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster._dontDisconnect = bool;
                NSLog.log('info','cluster[%s]._dontDisconnect:%s', pid, cluster._dontDisconnect);
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "clusterLockEnabledToPID");
                return;
            }

        }

    }

};
/** cluster info message **/
mgmt.prototype.updateClusterInfo = function () {
    var clusters = this.delegate.clusters;
    var list = [];
    var keys = Object.keys(clusters);
    var total = 0;
    //current process (process.memoryUsage()["rss"]/1024).toFixed(2)
    var octoproxy = {
        "pid":process.pid,
        "file":"Main",
        "name":'octoproxy',
        "count": 0,
        "lock":false,
        "memoryUsage":process.memoryUsage()["rss"]
    };
    list.push(octoproxy);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var j   = 0;
        var group = clusters[key];

        while (j < group.length)
        {
            var obj   = {};
            obj.pid   = group[j]._cpfpid;
            obj.name  = key;
            obj.count = group[j].nodeInfo.connections;
            obj.lock  = group[j]._dontDisconnect;

            if (typeof group[j].nodeInfo.memoryUsage != "undefined")
                obj.memoryUsage = (group[j].nodeInfo.memoryUsage["rss"]);
            obj.file = group[j]._modulePath;
            list.push(obj);

            total += group[j].nodeInfo.connections;

            j++;
        }
        group = null;

        octoproxy.count = total;

    }

    clusters = null;

    return list;

};

mgmt.prototype.runClusterInfos = function (sec) {

    var self = this;

    if (typeof this.lastTick != "undefined") {
        console.log('Service [runSysInfo] is running.');
        return;
    }

    var run = function () {
        console.log(JSON.stringify(self.updateClusterInfo()));
        self.clusterInfos = self.updateClusterInfo();
        self.lastTick = setTimeout(run, sec);
    };

    this.lastTick = setTimeout(run, sec);
};

mgmt.prototype.stopClusterInfos = function () {
    clearTimeout(this.lastTick);
    this.lastTick = undefined;
};
/** 09.26 - get child process list **/
mgmt.prototype.getAssign    = function (client) {
    var assign = require('fxNetSocket').getConfig(AssignPath);

    client.write(JSON.stringify({
        "event": "getAssign",
        "data" : assign
    }));

};
/** write fork object to config file **/
mgmt.prototype.updateAssign = function (obj, client) {

    var path = AssignPath;

    try {
        if (typeof obj == "undefined" || typeof obj != "object") {
            throw new Error("object is not NULL.");
        }
        if (typeof obj["assign"] == "undefined" || typeof obj["assign"] != "string") {
            throw new Error("Cannot read property 'assign' of undefined");
        }
        if (typeof obj["file"] == "undefined" || typeof obj["file"] != "string") {
            throw new Error("Cannot read property 'file' of undefined");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");
        conf["cluster"].push(obj);
        fs.writeFileSync(path, JSON.stringify(conf));
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "updateAssgin");
    }
    catch (e) {
        console.log('Configuation load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
    }
};

mgmt.prototype.editAssign   = function (oAssign, obj, client) {

    var path = AssignPath;

    try {
        if (typeof obj == "undefined" || typeof obj != "object") {
            throw new Error("object is not NULL.");
        }
        if (typeof obj["assign"] == "undefined" || typeof obj["assign"] != "string") {
            throw new Error("Cannot read property 'assign' of undefined");
        }
        if (typeof obj["file"] == "undefined" || typeof obj["file"] != "string") {
            throw new Error("Cannot read property 'file' of undefined");
        }
        if (typeof obj["mxoss"] == "undefined" || typeof obj["mxoss"] != "number") {
            obj["mxoss"] = 1024;
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        for (var i = 0; i < conf["cluster"].length; i++) {

            if (conf["cluster"][i]["assign"] == oAssign) {
                conf["cluster"][i]["assign"] = obj["assign"];
                conf["cluster"][i]["mxoss"] = parseInt(obj["mxoss"]);
                conf["cluster"][i]["file"] = obj["file"];
                break;
            }
        }
        console.log('writeFileSync+++++++++',obj);
        fs.writeFileSync(path, JSON.stringify(conf));

        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "editAssgin");
    }
    catch (e) {
        console.log('Configuation load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
    }
};
/** delete fork name to config file **/
mgmt.prototype.deleteAssign = function (name, client) {

    var path = AssignPath;

    try {
        if (typeof name == "undefined" || typeof name != "string") {
            throw new Error("Cannot read 'name' of undefined.");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");

        for (var i = 0; i < conf.cluster.length; i++) {
            var obj = conf["cluster"][i];
            if (obj.assign == name) {
                delete conf["cluster"][i];
            }
        }
        var saveData = JSON.stringify(conf).replace(",null","");
        fs.writeFileSync(path, saveData);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "deleteAssgin");
    }
    catch (e) {
        console.log('Configuation load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
    }
};

/** function **/
mgmt.prototype.ADMIN_EVENT_TYPE = {
    "INVALID_ARGUMENT" : 0,
    "SUCCESSFUL": 1,
    "FAILED":2,
    "CLUSTER_NOT_READY":3
};
mgmt.prototype._verifyArgs  = function (str, type) {
    if (str == null) {
        return false;
    }else if (typeof str == "undefined") {
        return false;
    }else if (typeof str != type) {
        return false;
    }
    return true;
};
mgmt.prototype._writeException = function (client, event_type) {

    var str = "";

    if (typeof client == "undefined") {
        console.error(new Error("client socket is invalid argument."));
        return;
    }

    if (event_type == 0)
        str = JSON.stringify({"event":"Error", "data": "Error: Invalid Argument"});
    else if (event_type == 1)
        str = JSON.stringify({"event":"Result","action":arguments[2], "data": true});
    else if (event_type == 2)
        str = JSON.stringify({"event":"Result","action":arguments[2], "data": false});
    else if (event_type == 3)
        str = JSON.stringify({"event":"Error", "data": "Error: Cluster not ready."});
    client.write(str);
};


module.exports = exports = mgmt;
// var n = new mgmt();
// n.updateAssgin({assign:"hall2",file:"*.js"});
// n.deleteAssgin("hall2");

