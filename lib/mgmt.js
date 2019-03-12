/**
 * Created by Benson.Liao on 2016/5/30.
 * + Admin Control Port : 8100
 * + Remote Logging Port : 10080
 * + User Console HTTP Port : 10082
 */

const fxNet  = require('fxNetSocket').NetCoonection;
const daemon = require('fxNetSocket').daemon;
const parser = require('fxNetSocket').parser;
const NSLog  = require('fxNetSocket').logger.getInstance();
const edittor= require('./AssignEdittor.js');
const events = require('events');
const fs     = require('fs');
const util   = require('util');
const exec   = require('child_process').exec;
const isWorker = ('NODE_CDID' in process.env);
const isMaster = (isWorker === false);

const AssignPath = "../configuration/Assign.json";
const IPFilterPath = "../configuration/IPFilter.json";
const LBLimitedPath = "../configuration/LoadBalanceLimited.json";
const GAME_LB_NAME_ASSIGN = "casino_game_rule";
const GAME_LB_NAME = "loadBalance";

const syncAssignFile = true;
const saveHeapTime   = (10 * 60 * 1000);

util.inherits(mgmt, events.EventEmitter); // 繼承事件
/** output interface **/
const MGMT_FUNC = {
    "getClusterInfos"         :true,
    "restartCluster"          :true,
    "addCluster"              :true,
    "killCluster"             :true,
    "editCluster"             :true,
    "getAssign"               :true,
    "updateAssign"            :true,
    "editAssign"              :true,
    "deleteAssign"            :true,
    "clusterLockEnabled"      :true,
    "killClusterToPID"        :true,
    "clusterLockEnabledToPID" :true,
    "trashCluster"            :true,
    "mutexServiceLock"        :true,
    "getLBGamePath"           :true,
    "setLBGamePath"           :true,
    "getLBGamePathOnRole"     :true,
    "setLBGamePathOnRole"     :true,
    "kickoutToPID"            :true,
    "reloadToPID"             :true,
    "getSysLog"               :true,
    "killZombieCluster"       :false,
    "setLogLevel"             :true,
    "reloadMgmt"              :true,
    "setRecordEnabled"        :true,
    "readBlockIPs"            :true
};
/**
 * @class
 * @param delegate
 * @param cfg
 * @param port
 */
function mgmt(delegate, cfg, port) {
    events.EventEmitter.call(this);
    /** resource **/
    this.delegate = delegate;
    /** sys config **/
    this.appConfig = cfg.appConfig;
    /** fork config **/
    this.forkOptions = cfg.forkOptions;
    /** update info tick **/
    this.lastTick = undefined;
    /** total client count **/
    this.octoProxyCount = 0;
    /** create server transport mechanisms **/
    this.createServer(port);
    /** cluster sys info **/
    this.clusterInfos = undefined;
    /** octoproxy heap use history file **/
    this.fsHeapUsed = undefined;
    /** do save file to different folder **/
/*    this.saveHeapUsed();
    this.loopSaveHeapUsed(saveHeapTime);*/
    // this.getAssign();
    // setTimeout(this.unitTest.bind(this), 5000);
    /** Node Server enable us to deny access. **/
    this.blockIPsEnabled = undefined;

    this.AssignPath = AssignPath;
    this.IPFilterPath = IPFilterPath;
    this.blockIPs = this.readFile(IPFilterPath, {enabled:true, allow:{}, deny:{}});
    this.uptime = new Date().getTime();

    this.procConns = [];
    this.procKeys = [];
    this.status = {release:false};
    var self = this;
    setTimeout(function () {
        self.updateClusterInfo(1)
    },1000);
    this.runClusterInfos(5000);
    Object.defineProperties(this, {
        "blockIPsEnabled": {
            get:function () {
                if (typeof self.blockIPs != "undefined" && typeof self.blockIPs.enabled == "boolean") {
                    return self.blockIPs.enabled;
                } else {
                    return false;
                }
            }, configurable: false, enumerable: false
        }
    })

}
mgmt.prototype.unitTest = function () {

    console.log('unitTest RUN');
    // this.mutexServiceLock(true);

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
        client.uptime = new Date().getTime();

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
                    if (typeof self[json.event] != "undefined" && MGMT_FUNC[json.event] == true) {
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
        //you don't connect once every 24 hours
        if ((new Date().getTime() - e.client.uptime) > 86400000) {
            e.client.close();
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
    this.mgmtSrv = mgmtSrv;
};
mgmt.prototype.close = function () {
    this.mgmtSrv.app.close(function () {
        NSLog.log('warning', "management has close.");
    });
    clearTimeout(this.lastTick);
    this.status.release = true;
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
mgmt.prototype.restartCluster = function (name, pid, client) {
    var server = this.delegate;
    if (name == GAME_LB_NAME_ASSIGN) {

        this.restartGLoadBalance(client);
        return;
    }
    var group = server.clusters[name];

    if (!this._verifyArgs(name, "string") ) {

        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onRestartCluster");
        client = null;
        arguments[arguments.length-1] = null;
        return;
    }
    for (var i = 0; i < group.length; i++) {
        var cluster = group[i];

        if (cluster._cpfpid == pid) {
            cluster.restart();
            NSLog.log('info', "Admin User do restartCluster();", pid);
            this.checkZombieCluster(cluster, pid);
        } else {
            var old = false;
            if(typeof client == "undefined") {
                client = pid;
                old = true;
            }
            if (old == false) return;
            NSLog.log('info', "*** Admin User do restartCluster();", cluster._cpfpid);
            cluster.restart();
            this.checkZombieCluster(cluster, cluster._cpfpid);
        }

    }
    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onRestartCluster");
    client = null;
    server = null;
    group  = null;
};
mgmt.prototype.checkZombieCluster = function (cluster, pid) {
    setTimeout(function () {
        if (typeof cluster._cpfpid == "undefined" || cluster._cpfpid == pid) {
            NSLog.log("error", "Kill to process is Just like real zombies!");
            self.killZombieCluster(name)
        }
    }, 60000);
};
mgmt.prototype.killZombieCluster = function (name, client) {
    var server = this.delegate;

    var group = server.clusters[name];
    if (!this._verifyArgs(name, "string") ) {

        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "killZombieCluster");
        client = null;
        arguments[arguments.length-1] = null;
        return;
    }
    for (var i = 0; i < group.length; i++) {
        var cluster = group[i];
        cluster.stopHeartbeat();
        cluster.stop();
        cluster.init();
        NSLog.log('info', "Admin User do killZombieCluster();", name);
    }
    if (typeof client != "undefined") this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "killZombieCluster");
    client = null;
    server = null;
    group  = null;
};
mgmt.prototype.restartGLoadBalance = function (client) {
    var LBSrv = this.delegate["gameLBSrv"].getCluster;
    LBSrv.name = GAME_LB_NAME;
    if (typeof LBSrv != "undefined") {

        LBSrv.restart();
        NSLog.log('info', "Admin User do restartGLoadBalance();");
        this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onRestartCluster");
        this.procKeys = [];
        this.rstGLB = true;
        var self = this;
        setTimeout(function () {
            self.rstGLB = false;
        }, 2000);
        this.delegate["gameLBSrv"].on("upProcessList", function restartHandle() {
            self.LBUpUserCount(self.procConns, self.procKeys);
            self.delegate["gameLBSrv"].removeListener("upProcessList", restartHandle);
        })
    }

    LBSrv = null;

};

mgmt.prototype.setLBGamePath = function (o, client) {
    var LBSrv = this.delegate["gameLBSrv"];
    if (typeof LBSrv != "undefined") {
        LBSrv.setGamePath(o, function (result) {
            // console.log('onSetGamePath:', result);
            client.write(JSON.stringify({"event":"onSetLBGamePath","data":result}));
        });
    }
};

mgmt.prototype.getLBGamePath = function (client) {
    var LBSrv = this.delegate["gameLBSrv"];
    if (typeof LBSrv != "undefined") {
        LBSrv.getGamePath(function (data) {
            console.log('onGetLBGamePath');
            client.write(JSON.stringify({"event":"onGetLBGamePath","data":data}));
        })
    }
};
mgmt.prototype.setLBGamePathOnRole = function (o, client) {
    console.log('setLBGamePathOnRole', o);
    var LBSrv = this.delegate["gameLBSrv"];
    if (typeof LBSrv != "undefined") {
        LBSrv.setLBRole2(o, function (result) {
            // console.log('onSetGamePath:', result);
            client.write(JSON.stringify({"event":"onSetLBGamePathOnRole","data":result}));
        });
    }
};

mgmt.prototype.getLBGamePathOnRole = function (client) {

    NSLog.log("debug",'getLBGamePathOnRole');

    var data = fs.readFileSync(LBLimitedPath);
    var conf = eval("("+data+")");
    client.write(JSON.stringify({"event":"onGetLBGamePathOnRole", "data":conf}));
};
/** 09.26 - edit **/
mgmt.prototype.addCluster = function(file, name, mxoss, client) {
    var server = this.delegate;
    var group = server.clusters[name];
    var env = process.env;
    var pkg = false;
    NSLog.log("debug","addCluster(%s)", file, name, mxoss);
    if (!this._verifyArgs(file, "string") || !this._verifyArgs(name, "string")) {

        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onAddCluster");
        client = null;
        arguments[arguments.length-1] = null;
        return;
    }
    if (isNaN(parseInt(mxoss))) mxoss = 2048;
    if (file.indexOf(".js") == -1) pkg = true;
    var execArgv = ["--nouse-idle-notification", "--always-compact", "--max-old-space-size=" + mxoss];
    env.NODE_CDID = ++server.clusterNum;
    var cluster = new daemon(file,[name], {env:env, silent:false, execArgv:execArgv, pkgFile: pkg});
    cluster.init();
    cluster.name = name;
    cluster.mxoss = mxoss;
    if (!group) {
        server.clusters[name] = [];
        server.roundrobinNum[name] = 0;
    }
    server.clusters[name].push(cluster);
    if (syncAssignFile)
        this.updateAssign({"file":file, "assign": name, "mxoss":mxoss});

    if (typeof client != "undefined") {
        this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onAddCluster");
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
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT,"onKillCluster");
        return;
    }else if (typeof group === 'undefined') {
        this._writeException(client, this.ADMIN_EVENT_TYPE.CLUSTER_NOT_READY,"onKillCluster");
        return;
    }

    while (group.length > 0){
        var cluster = group.shift();
        cluster.stop();
        cluster.stopHeartbeat();
    }
    delete server.clusters[name];

    if (syncAssignFile)
        this.deleteAssign(name);

    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onKillCluster");
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
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onKillClusterToPID");
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
                if (syncAssignFile)
                    this.deleteAssign(key);
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onKillClusterToPID");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }

    }
    server = null;

};
/** kick out child process live user **/
mgmt.prototype.kickoutToPID = function (pid, params, client) {
    var server = this.delegate;
    var _pid = parseInt(pid);
    var groupKeys = Object.keys(server.clusters);
    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onKickoutToPID");
        return;
    }
    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];

        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster.send({'evt':'kickUsersOut', params:params});
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onKickoutToPID");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }

    }
    server = null;
};
mgmt.prototype.reloadToPID = function (pid, params, client) {
    var server = this.delegate;
    var _pid = parseInt(pid);
    var groupKeys = Object.keys(server.clusters);
    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onReloadToPID");
        return;
    }
    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];

        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster.send({'evt':'reload', params:params});
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onReloadToPID");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }

    }
    server = null;
};
mgmt.prototype.setLogLevel = function (pid, params, client) {
    var server = this.delegate;
    var _pid = parseInt(pid);
    var groupKeys = Object.keys(server.clusters);
    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onSetLogLevel");
        return;
    }
    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];
        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster.send({'evt':'setLogLevel', params:params});
                cluster.nodeInfo.lv = params.lv;
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onSetLogLevel");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }

    }
    server = null;
};
mgmt.prototype.reloadMgmt = function (pid, client) {

    if (process.pid != pid) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "reloadMgmt");
        return;
    }

    if (typeof this.delegate != "undefined") {
        this.delegate.reLoadManagement();
    }
    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onEditCluster");
};
mgmt.prototype.setRecordEnabled = function (enabled, client) {
    if (typeof enabled == "undefined") enabled = false;
    if (typeof this.delegate != "undefined") {
        this.delegate.recordEnabled = enabled;
    }
    NSLog.log("warning", "setRecordEnabled:", enabled);
    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onSetRecordEnabled");
};
mgmt.prototype.readBlockIPs = function (client) {
    this.blockIPs = this.readFile(IPFilterPath, {enabled:false, allow:{}, deny:{}});
    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onReadBlockIPs");
};
/** setting deny address **/
mgmt.prototype.setIPFilter = function (ip, state, endTime, count, log) {
    var checkIP = ip.match(/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);

    // var checkIPv6 = ip.match(/(?:[\w\d]{1,4}:){7}[\w\d]{1,4}/);
    // ip.split(":")
    if (checkIP == null) return;

    var obj = {address: checkIP.toString(), state:state, startTime: new Date().toISOString()};

    if (state) {
        edittor.setIPFilterAdd.apply(this, [obj]);
    } else {
        edittor.setIPFilterDel.apply(this, [obj]);
    }
};
/** live cluster edit **/
mgmt.prototype.editCluster = function (oldName, newName, mxoss, client) {

    var server = this.delegate;
    var oGroup = server.clusters[oldName];
    var nGroup;
    var file;

    if (!this._verifyArgs(oldName, "string") || !this._verifyArgs(newName, "string")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onEditCluster");
        return;
    }else if (typeof oGroup === 'undefined') {
        this._writeException(client, this.ADMIN_EVENT_TYPE.CLUSTER_NOT_READY, "onEditCluster");
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
        if (typeof mxoss == "undefined") mxoss = cluster.mxoss;
        if (typeof mxoss != "number") mxoss = 2048;
        file  = cluster._modulePath;
        nGroup.push(cluster);
    }
    if (syncAssignFile) {
        this.editAssign(oldName, {file:file,assign:newName, mxoss:mxoss});
        file = null;
        mxoss = null;
    }

    delete server.clusters[oldName];

    this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onEditCluster");

    client = null;
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
/**
 * 自動檢查機制 start auto remove mem
 * @param arr_assign {array} assign list
 * @param sec {number} clock time
 * @return {Object|number}
 */
mgmt.prototype.automaticCheckCluster = function (arr_assign, sec) {
    var self = this;

    var times = setTimeout(function () {
        for (var i = 0; i < arr_assign.length; i++) {
            var assign = arr_assign[i];
            self.outOfRangeMemLimit(assign);
        }
        if (self.status.release) return;
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
mgmt.prototype.updateClusterInfo = function (state) {
    var clusters = this.delegate.clusters;
    var list = [];
    var keys = Object.keys(clusters);
    var total = 0;
    //current process (process.memoryUsage()["rss"]/1024).toFixed(2)
    var procConns = [];
    var procKeys  = [];
    var octoproxy = {
        "pid":process.pid,
        "file":"Main",
        "name":'octoproxy',
        "pkey":'octoproxy',
        "count": 0,
        "lock":this.delegate._lockState,
        "memoryUsage":process.memoryUsage(),
        "complete":true,
        "lv": "debug",
        "uptime": this.uptime
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
            obj.pkey  = key + "_" + j;
            obj.count = group[j].nodeInfo.connections;
            obj.lock  = group[j]._dontDisconnect;
            obj.complete = group[j].creationComplete;
            obj.uptime = group[j].uptime;
            obj.lv   = group[j].nodeInfo.lv;
            if (typeof group[j].nodeInfo.memoryUsage != "undefined") {
                obj.memoryUsage = (group[j].nodeInfo.memoryUsage);
            }
            obj.bitrates = group[j].nodeInfo.bitrates;
            obj.file = group[j]._modulePath;
            list.push(obj);
            procKeys.push(key);
            procConns.push(group[j].nodeInfo.connections);
            total += group[j].nodeInfo.connections;

            j++;
        }
        group = null;

        octoproxy.count = this.octoProxyCount = total;

    }
    if (this.rstGLB == true) {
        this.LBUpUserCount(procConns, procKeys);
    }
    else if (procKeys.toString() == this.procKeys.toString()) {
        this.LBUpUserCount(procConns, undefined);
    } else {
        if (state == 1) {
            this.LBUpUserCount(procConns, procKeys);
        }
    }
    this.procConns = procConns;
    this.procKeys = procKeys;

    if (typeof this.LBInfo == "undefined") {
        this.LBInfo = this.addGameLB();
        list.push(this.LBInfo);
    } else {
        this.LBInfo = this.addGameLB();
        list.push(this.LBInfo);
    }
    clusters = null;

    return list;

};
mgmt.prototype.addGameLB = function () {

    var LBSrv = this.delegate["gameLBSrv"].getCluster;
    if (typeof LBSrv == "undefined") return undefined;
    var obj   = {
        "pid"  :LBSrv._cpfpid,
        "name" :GAME_LB_NAME_ASSIGN,
        "pkey" :GAME_LB_NAME_ASSIGN,
        "count":0,
        "lv"   :LBSrv.lv,
        "lock" :LBSrv._dontDisconnect,
        "memoryUsage":{"rss":0},
        "file":GAME_LB_NAME,
        "complete":LBSrv.creationComplete,
        "uptime":LBSrv.uptime
    };
    obj["memoryUsage"] = LBSrv.nodeInfo.memoryUsage;
    return obj;
};
mgmt.prototype.LBUpUserCount = function (list, keys) {
    var LBSrv = this.delegate["gameLBSrv"];
    if (typeof LBSrv != "undefined") LBSrv.updateServerCount(list, keys);
};
/****/
mgmt.prototype.runClusterInfos = function (sec) {
    var self = this;

    if (typeof this.lastTick != "undefined") {
        console.log('Service [runSysInfo] is running.');
        return;
    }

    var run = function () {
        // console.log(JSON.stringify(self.updateClusterInfo()));
        self.clusterInfos = self.updateClusterInfo(1);
        self.lastTick = setTimeout(run, sec);
    };
    if (typeof this.lastTick == "undefined") {
        this.lastTick = setTimeout(run, sec);
    }

};
/****/
mgmt.prototype.stopClusterInfos = function () {
    clearTimeout(this.lastTick);
    this.lastTick = undefined;
};
mgmt.prototype.getSysLog = function (client) {
    // var recordDashboard = this.delegate.recordDashboard;
    // client.write(JSON.stringify({"event":"onGetSysLog","data":recordDashboard.octolog}));
};
mgmt.prototype.updateGetSysLog = function () {
    // NSLog.log("debug", "updateGetSysLog");
    if (typeof this.delegate != "undefined" && typeof this.delegate.recordDashboard != "undefined") {

    }
};
/** 09.26 - get child process list **/
mgmt.prototype.getAssign    = function (client) {
    edittor.getAssign.apply(this, arguments);
};
/** write fork object to config file **/
mgmt.prototype.updateAssign = function (obj, client) {
    edittor.updateAssign.apply(this, arguments);
};

mgmt.prototype.editAssign   = function (oAssign, obj, client) {
    edittor.editAssign.apply(this, arguments);
};
/** delete fork name to config file **/
mgmt.prototype.deleteAssign = function (name, client) {
    edittor.deleteAssign.apply(this, arguments);
};

mgmt.prototype.mutexServiceLock = function (bool) {
    var server = this.delegate;

    var path = AssignPath;

    try {
        if (typeof bool != "boolean") {
            throw new Error("object is not Boolean.");
        }
        var data = fs.readFileSync(path);
        var conf = eval("("+data+")");
        conf["lockState"] = bool;
        fs.writeFileSync(path, JSON.stringify(conf));
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.SUCCESSFUL, "mutexServiceLock");

        server.lockState = bool;
    }
    catch (e) {
        console.log('Configuation load file error:', e);
        if (typeof client != "undefined")
            this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
    }

};

mgmt.prototype.loadIPFilter = function (client) {
    var data = edittor.getIPFilter.apply(this);
    client.write(JSON.stringify({
        "event": "loadIPFilter",
        "result" : true
    }));

    this.blockIPs = data;
};

mgmt.prototype.reboot = function () {
    // exec("sh startup.sh");
    // process.exit(0);
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
        str = JSON.stringify({"event":"error", "data": "Error: Invalid Argument"});
    else if (event_type == 1)
        str = JSON.stringify({"event":"result","action":arguments[2], "data": true});
    else if (event_type == 2)
        str = JSON.stringify({"event":"result","action":arguments[2], "data": false});
    else if (event_type == 3)
        str = JSON.stringify({"event":"error", "data": "Error: Cluster not ready."});
    client.write(str);
};
mgmt.prototype.loopSaveHeapUsed = function (sec) {
    setTimeout(this.saveHeapUsed.bind(this), sec);
};
mgmt.prototype.saveHeapUsed = function () {
    var heapUsed = process.memoryUsage().heapUsed;

    this.fsHeapUsed = this.loadFile('./historyLog/');

    if (this.fsHeapUsed) {
        this.fsHeapUsed.write(JSON.stringify([new Date().getTime(), heapUsed, this.octoProxyCount ]) + ",\r\n");
    }
    this.loopSaveHeapUsed(saveHeapTime);
};
mgmt.prototype.loadFile = function (path) {
    return fs.createWriteStream(path + 'HeapUsedOctoProxy.log',{ flags:'a+' });
};
mgmt.prototype.checkedIPDeny = function (ip) {

    //Denying the connection.
    if (typeof ip != "string") return false;
    // console.log(this.blockIPs["deny"]);
    if (typeof this.blockIPs["deny"][ip] != "undefined" && this.blockIPs["deny"][ip].enabled === true) {
        return true;
    } else {
        /*
        var sp = ip.split(".");
        var str = sp[0] + "." + sp[1] + "." + sp[2] + ".*";
        var str2 = sp[0] + "." + sp[1] + ".*.*";
        var classC;
        var classB;
        if (typeof this.blockIPs[str] != "undefined") classC = ip.match(/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){2}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);

        if (typeof classC != "undefined" && classC != null) {
            return (this.blockIPs[classC[0] + ".*"] === true);
        }
        if (typeof this.blockIPs[str2] != "undefined") classB = ip.match(/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){1}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
        if (typeof classB != "undefined" && classB != null) {
            return (this.blockIPs[classB[0] + ".*.*"] === true);
        }
        */
        return false;
    }


};
mgmt.prototype.readFile = function (path, defObj) {
    var data;
    try {
        data = fs.readFileSync(path);
        return eval("("+data+")");
    } catch (e) {
        NSLog.log("error", "Loading conf path '%s' not found.", path);
        data = defObj;
        this.writeFile(path, data);
        return data;
    }
};
mgmt.prototype.writeFile = function (path, data) {
    return fs.writeFileSync(path, JSON.stringify(data, null, "\t"));
};



module.exports = exports = mgmt;
// var n = new mgmt();
// n.updateAssgin({assign:"hall2",file:"*.js"});
// n.deleteAssgin("hall2");

