/**
 * Created by Benson.Liao on 2016/5/30.
 * + Admin Control Port : 8100
 * + Remote Logging Port : 10080
 * + User Console HTTP Port : 10082
 */
const utilities = require('fxNetSocket').utilities;
const fxNet  = require('fxNetSocket').NetCoonection;
const daemon = require('fxNetSocket').daemon;
const parser = require('fxNetSocket').parser;
const NSLog  = require('fxNetSocket').logger.getInstance();
const edittor= require('./AssignEdittor.js');
const events = require('events');
const net    = require('net');
const os     = require('os');
const fs     = require('fs');
const util   = require('util');
const sys    = require('./sysstat.js');
// const Scheduler = require('./Scheduler.js');
const exec   = require('child_process').exec;
const isWorker = ('NODE_CDID' in process.env);
const isMaster = (isWorker === false);

const AssignPath = "../configuration/Assign.json";
const IPFilterPath = "../configuration/BlockList.json";
const LBLimitedPath = "../configuration/LoadBalanceLimited.json";
const AMFConfigPath = "../configuration/AMFConfig.json";
const GAME_LB_NAME_ASSIGN = "casino_game_rule";
const GAME_LB_NAME = "loadBalance";

const syncAssignFile = true;
const saveHeapTime   = (10 * 60 * 1000);

util.inherits(mgmt, events.EventEmitter); // 繼承事件
/** output interface **/
const MGMT_FUNC = {
    "getClusterInfos"         :true,
    "restartCluster"          :true,
    "restartMultiCluster"     :true,
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
    "readBlockIPs"            :true,
    "getAMFConfig"            :true,
    "setAMFConfig"            :true,
    "updatePodDevInfo"        :true,
    "applyJoin"               :true,
    "hotReload"               :true,
    "ipcMessage"              :true,
    "getSchedule"             :true,
    "addSchedule"             :true,
    "cancelSchedule"          :true
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
    if (cfg.push) {
        NSLog.log("info", "[active] Create socket connect to the remote Server on port:%s.", port);
        this.active = this.activeConnect(port, cfg.mgmtHost);
        this.push = cfg.push;
    } else {
        NSLog.log("info", "[passive] Bind the listening socket to the port:%s.", port);
        this.createServer(port);
    }
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
    this.cbCount = 0;
    this.callbackFunc = {};

    // this.scheduler = new Scheduler(this);
    const self = this;
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
    });
    NSLog.log("info", "Memory Usage Monitoring: [%s]", true);
    this.automaticCheckCluster(Object.keys(this.delegate.clusters), 60);
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
        self.onMessage(e.data, e.client);
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
mgmt.prototype.onMessage = function (data, client) {
    NSLog.log('log',"mgmt[message]:", data);
    var self = this;
    var arr = data.match(/(\{.+?\})(?={|$)/g);
    for (var i = 0 ; i < arr.length; i++) {
        var json = JSON.parse(arr[i]);
        switch (json.event){

            case "addClusterSync":
                self.addCluster(json.data[0],json.data[1], json.data[2], json.data[3]);
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
                    self._writeException(client, self.ADMIN_EVENT_TYPE.INVALID_ARGUMENT);
                }
        }
    }
    //you don't connect once every 24 hours
    if ((new Date().getTime() - client.uptime) > 86400000) {
        client.close();
    }
};
mgmt.prototype.close = function () {
    this.mgmtSrv.app.close(function () {
        NSLog.log('warning', "management has close.");
    });
    clearTimeout(this.lastTick);
    this.status.release = true;
};
mgmt.prototype.updateBuffer = function (socket, data) {
    // NSLog.log("debug", '#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //NSLog.log("debug", '#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
        socket.chunkBuffer = Buffer.from(data);
    }else
    {
        if (socket.chunkBuffer.length == 0) {
            socket.chunkBuffer = Buffer.from(data);
        }else
        {
            var total = socket.chunkBuffer.length + data.length;
            socket.chunkBuffer = Buffer.concat([socket.chunkBuffer,data], total);
        }
    }

    socket.chunkBufSize += data.length;
};
/** 尋找管理連線 **/
mgmt.prototype.activeConnect = function (port, host) {
    var self = this;
    var sock = new net.Socket();
    var client = sock;
    sock.on("connect", function () {
        console.log('connect');
        sock.uptime = new Date().getTime();
        sock.write("\0");
        setTimeout(function () {
            sock.write(JSON.stringify({event:"setup", data:[require("os").hostname()]}));
        }, 10)

    });
    sock.on('data', function (chunk) {
        self.updateBuffer(sock, chunk);
        NSLog.log('log',"mgmt[message]:", chunk.toString());
        var arr = sock.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);
        if (typeof arr == "undefined" || !arr) arr = [];

        for (var i = 0 ; i < arr.length; i++) {
            var len = Buffer.byteLength(arr[i]);
            sock.chunkBuffer = sock.chunkBuffer.slice(len, sock.chunkBuffer.length);
            self.onMessage(arr[i], client);
        }
        //you don't connect once every 24 hours
        if ((new Date().getTime() - sock.uptime) > 86400000) {
            sock.destroy();
        }
    });
    sock.on('error', function (e) {
        try {sock.destroy();} catch (err) {}
    });
    sock.on('close', function () {
        NSLog.log("info","Can't connect to machine <%s:%s> after waiting 1 seconds.", host, port);
        setTimeout(function () {
            sock.connect(port, host);
        }, 1000);
    });
    sock.connect(port, host);

    this.setupSysstat();
};
mgmt.prototype.updatePodDevInfo = function (client) {
    console.log('updatePodDevInfo');
    client.write(JSON.stringify({"event":"updatePodDevInfo", cpusUsage:this.cpusUsage, sysInfo: this.sysInfo}));
    client = null;
    arguments[arguments.length-1] = null;
    delete this.sysstat.devices;
    delete this.sysstat.snmp;
};

mgmt.prototype.applyJoin = function (host, id) {
    var self = this;
    var sock = new net.Socket();
    sock.on("connect", function () {
        sock.uptime = new Date().getTime();
        sock.write("\0");
        setTimeout(function () {
            sock.write(JSON.stringify({event:"applyJoin", data:[require("os").hostname(), id]}));
        }, 10)
    });
    sock.on('data', function (chunk) {
        self.updateBuffer(sock, chunk);
        NSLog.log('debug',"mgmt[message]:", chunk.toString());
        var arr = sock.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);
        if (typeof arr == "undefined" || !arr) arr = [];

        for (var i = 0 ; i < arr.length; i++) {
            var len = Buffer.byteLength(arr[i]);
            sock.chunkBuffer = sock.chunkBuffer.slice(len, sock.chunkBuffer.length);
            self.onMessage(arr[i], sock);
        }
        //you don't connect once every 24 hours
        if ((new Date().getTime() - sock.uptime) > 86400000) {
            sock.destroy();
        }
    });
    sock.on('error', function (e) {
        // self.emit("error", e);
        try {sock.destroy();}
        catch (e) {}
    });
    sock.on('close', function () {
        NSLog.log("info","close applyJoin Client Connect.");
    });
    sock.connect(8100, host);
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
        } else if (typeof client != "undefined") {
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
mgmt.prototype.restartMultiCluster = function (group, client) {
    if (this.hasMultiReboot) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.FAILED, "onRestartCluster");
        return false;
    }
    this.hasMultiReboot = true;
    this.multiReboot(group, client).then((res) => {
        this.hasMultiReboot = false;
    }).catch((err) => {
        this.hasMultiReboot = false;
    })
};
/**
 *
 * @param {Array} group
 */
mgmt.prototype.multiReboot = async function (group, client) {
    const server = this.delegate;
    const keys = Object.keys(server.clusters);
    const LBSrv = this.delegate["gameLBSrv"].getCluster;
    let index;
    if ((index = group.indexOf(LBSrv._cpfpid)) != -1) {
        this.restartGLoadBalance(client);
        group.splice(index, 1);
    }

    for (let name of keys) {
        let clusterGroup = server.clusters[name];
        if (!Array.isArray(clusterGroup)) continue;
        for (let cluster of clusterGroup) {
            index = group.indexOf(String(cluster._cpfpid));
            if (index !== -1) {
                cluster.restart();
                NSLog.log('info', "Admin User do restartCluster();", cluster._cpfpid);
                this.checkZombieCluster(cluster, cluster._cpfpid);
                group.splice(index, 1);
                const wait = await this.waiting(1000);
            }
            if (group.length == 0) return true;
        }
    }
    return true;
};
mgmt.prototype.waiting = async function (millisecond) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve();
        }, millisecond || 500);
    })
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

mgmt.prototype.setAMFConfig = function (o, client) {
    NSLog.log("debug",'setAMFConfig()', o);
    fs.writeFileSync(AMFConfigPath, JSON.stringify(o, null, "\t"));
};

mgmt.prototype.getAMFConfig = function (client) {
    console.log("debug",'getAMFConfig()');

    var data = fs.readFileSync(AMFConfigPath);
    var conf = eval("("+data+")");
    client.write(JSON.stringify({"event":"onGetAMFConfig", "data":conf}));
};
/** 09.26 - edit **/
mgmt.prototype.addCluster = function(file, name, mxoss, option, client) {
    var server = this.delegate;
    var group = server.clusters[name];
    var env = process.env;
    var pkg = false;
    var lookout = true;
    var cmd = false;
    var opt, args;
    var clone = (typeof option != "undefined" && typeof option.clone == "boolean") ? option.clone: false;
    if (typeof file == "object") {
        opt = file;
        file = opt.file;
    } else if (typeof option != "undefined") {
        opt = option;
    }

    NSLog.log("debug","addCluster(%s)", file, name, mxoss);
    if (!this._verifyArgs(file, "string") || !this._verifyArgs(name, "string")) {

        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onAddCluster");
        client = null;
        arguments[arguments.length-1] = null;
        return;
    }
    if (isNaN(parseInt(mxoss))) mxoss = 2048;
    if (file.indexOf(".js") == -1) pkg = true;
    var execArgv = ["--nouse-idle-notification", "--max-old-space-size=" + mxoss];
    var cmdLine = [name];
    if (typeof opt != "undefined") {
        if (opt.gc == true) execArgv.push("--expose-gc");
        if (opt.compact == true) execArgv.push("--always-compact");
        if (opt.inspect == true) execArgv.push("--inspect");
        if (typeof opt.v8Flags != "undefined") {
            const flags = opt.v8Flags;
            if (Array.isArray(flags)) {
                for (var f = 0; f < flags.length; f++) {
                    execArgv.push(flags[f]);
                }
            } else if (typeof flags == "string") {
                execArgv.push(flags);
            }
        }
        if (opt.lookout == false) lookout = false;
        if (opt.cmd != false) cmd = opt.cmd;
        if (opt.file.indexOf(".js") == -1) pkg = true;
        if (pkg) execArgv = []; // octoProxy pkg versions
        if (typeof opt.args == "string") {
            args = utilities.trimAny(opt.args);
            cmdLine = cmdLine.concat(args.split(","));
        } else if (Array.isArray(opt.args) && opt.args.length > 0) {
            args = utilities.trimAny(opt.args.join(","));
            cmdLine = cmdLine.concat(args.split(","));
        }
    } else {
        opt = {};
        execArgv.push("--always-compact");
    }
    const daemonOptions = {
        env: env,
        silent: false,
        execArgv: execArgv,
        //心跳系統
        lookoutEnabled: lookout,
        pkgFile: pkg,
        cmd: cmd
    };
    env.NODE_CDID = ++server.clusterNum;
    if (opt.env) mgmt.setEnvironmentVariables(env, opt.env);
    if (Boolean(process.env.pkg_compiler) == true) execArgv = []; // octoProxy pkg versions
    const cluster = new daemon(file, cmdLine, daemonOptions);
    cluster.name = name;
    cluster.mxoss = mxoss;
    cluster.ats = (typeof opt.ats == "boolean") ? opt.ats : false;
    cluster.optConf = opt;
    if (!group) {
        server.clusters[name] = [];
        server.roundrobinNum[name] = 0;
    }
    cluster.init();

    server.clusters[name].push(cluster);

    cluster.emitter.on('warp_handle', function (message, handle) {
        server.duringWarp(message, handle);
    });

    cluster.emitter.on("onIpcMessage", function (message) {
        this.onIpcMessage(message);
    }.bind(this));

    cluster.emitter.on('restart', function () {
        this.refreshClusterParams(cluster);
    }.bind(this));

    if (syncAssignFile && clone != true)
        this.updateAssign({"file":file, "assign": name, "mxoss": Number(mxoss), args: opt.args, cmd:cmd, lookout: lookout, ats: cluster.ats});

    if (typeof client != "undefined") {
        this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onAddCluster");
        client = null;
        arguments[arguments.length-1] = null;
    }
    server = null;
    group  = null;
};
mgmt.prototype.refreshClusterParams = function (cluster) {
    if (typeof cluster == "undefined") return false;
    const index = cluster._options.env.NODE_CDID;
    const conf  = this.getAssign();
    const params = conf.cluster[index];
    if (params && params.assign == cluster.name && params.reload == true) {
        if (params.env) mgmt.setEnvironmentVariables(cluster._options.env, params.env);
        if (params.file != cluster._modulePath) cluster._modulePath = params.file;
        if (typeof params.ats == "boolean" && params.ats != cluster.ats) cluster.ats = params.ats;
        if (typeof params["recycleExpired"] == "number" && params["recycleExpired"] != cluster.optConf["recycleExpired"]) {
            cluster.optConf["recycleExpired"] = params["recycleExpired"];
        }
        delete params.reload;
        edittor.saveAssign.apply(this, [conf]);
        NSLog.log("debug", "%s %s configure refresh", params.file, params.assign)
    }
};
mgmt.setEnvironmentVariables = function (envVars, data) {
    let name;
    let value;
    let args;
    if (typeof data == "string") {
        args = mgmt.envStrFormatter(data);
    } else if (Array.isArray(data)) {
        args = data;
    } else {
        return envVars;
    }
    for (let envVar of args) {
        if (Array.isArray(envVar)) {
            name = envVar[0];
            value = envVar[1];
        }
        else if (typeof envVar == "object") {
            name = envVar.name;
            value = envVar.value;
        }
        if (name) {
            envVars[name] = value;
        }
    }
    return envVars;
};
mgmt.envStrFormatter = function (data) {
    let params = data.split(",");
    let strValue;
    let args = [];
    for (let str of params) {
        if (typeof str == "string") {
            strValue = str.split("=");
            args.push(strValue);
        }
    }
    return args;
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
                cluster.isRelease = true;
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
    this._writeException(client, this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onKillClusterToPID");
};
/** kick out child process live user **/
mgmt.prototype.kickoutToPID = function (pid, trash, params, client) {
    var server = this.delegate;
    var _pid = parseInt(pid);
    var groupKeys = Object.keys(server.clusters);
    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onKickoutToPID");
        return;
    }
    var j;
    if (trash === true) {
        var g = server.garbageDump;
        for (j = 0; j < g.length; j++) {
            if (g[j]._cpfpid == pid) {
                g[j].send({'evt':'kickUsersOut', params:params});
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onKickoutToPID");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }
    } else {
        for (var i = 0; i < groupKeys.length; i++) {
            var key = groupKeys[i];

            var group = server.clusters[key];
            for (j = 0; j < group.length; j++) {
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
mgmt.prototype.hotReload = function (pid, params, client) {

    const server = this.delegate;
    const _pid = parseInt(pid);
    var groupKeys = Object.keys(server.clusters);
    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onHotReload");
        return;
    }
    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];

        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                cluster.send({'evt':'hotReload', params:params});
                cluster._dontDisconnect = true;
                this._writeException(client, this.ADMIN_EVENT_TYPE.SUCCESSFUL, "onHotReload");
                client = null;
                arguments[arguments.length-1] = null;
                return;
            }

        }

    }
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
                if (typeof cluster.nodeConf != "undefined") cluster.nodeConf.lv = params.lv;
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
mgmt.prototype.editCluster = function (oldName, newName, options, client) {

    var server = this.delegate;
    var oGroup = server.clusters[oldName];
    var nGroup;
    var file;
    var mxoss;
    if (typeof options == "number" || typeof options == "string") {
        mxoss = options;
        options = {};
    }

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
        nGroup = server.clusters[newName];
    } else {
        nGroup = server.clusters[oldName];
    }

    while (oGroup.length > 0){
        var cluster = oGroup.shift();
        cluster.name = newName;
        if (typeof mxoss == "undefined") mxoss = cluster.mxoss;
        if (typeof mxoss != "number") mxoss = 2048;
        file  = cluster._modulePath;
        if (typeof options.ats == "boolean") {
            cluster.ats = options.ats;
        }
        nGroup.push(cluster);
    }
    if (syncAssignFile) {
        this.editAssign(oldName, {file:file,assign:newName, mxoss:mxoss, options:options});
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

    if (typeof cluster.optConf != "undefined") {
        file = cluster.optConf;
    }
    this.addCluster(file, assign, mxoss, {clone: true});

    var trash = group.shift();
    trash.recycleStartDate = new Date().getTime();
    server.garbageDump.push(trash);

    NSLog.log("warning","cloneCluster(%s)", assign, group.length, server.garbageDump.length);

    server.awaitRecycle();

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
        if (cluster.ats != true) continue;
        if (typeof cluster.nodeInfo != 'undefined' && typeof cluster.nodeInfo.memoryUsage != "undefined") {
            var memory = cluster.nodeInfo.memoryUsage["rss"];
            var memory_m = (memory / 1024 / 1024).toFixed(2);
            var maxMemory = (cluster.mxoss * 0.9);
            var isFull = memory_m > maxMemory;
            NSLog.log("debug", "outOfRangeMemLimit: %s > %s = %s", memory_m , maxMemory , isFull, server.garbageDump.length);
            if (typeof cluster.overload != "number") cluster.overload = 0;
            if (isFull) { //預留10%緩衝
                cluster.overload++;
                if (cluster.overload > 2) this.cloneCluster(assign);
            } else {
                cluster.overload = 0;
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
    if (typeof this.autoTimes != "undefined") {
        clearTimeout(this.autoTimes);
        this.autoTimes = undefined;
    }
    this.autoTimes = setTimeout(function () {
        for (var i = 0; i < arr_assign.length; i++) {
            var assign = arr_assign[i];
            self.outOfRangeMemLimit(assign);
        }
        if (self.status.release) return;
        self.automaticCheckCluster(Object.keys(self.delegate.clusters), sec);
    }, sec * 1000);
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
        "lock":this.delegate._lockdown,
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
        var obj;
        while (j < group.length)
        {
            obj       = {};
            obj.pid   = group[j]._cpfpid;
            obj.name  = key;
            obj.pkey  = key + "_" + j;
            obj.count = group[j].nodeInfo.connections;
            obj.lock  = group[j]._dontDisconnect;
            obj.complete = group[j].creationComplete;
            obj.uptime = group[j].uptime;
            obj.ats   = group[j].ats;
            obj.lookout = group[j]._lookoutEnabled;
            obj.args = group[j]._args.slice(1);

            if (typeof group[j].nodeInfo.memoryUsage != "undefined") {
                obj.memoryUsage = (group[j].nodeInfo.memoryUsage);
            }
            if (typeof group[j].nodeConf != "undefined") {
                obj.lv   = group[j].nodeConf.lv;
                obj.f2db = (group[j].nodeConf.f2db);
                obj.amf = (group[j].nodeConf.amf);
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

    group = this.delegate.garbageDump;
    j = 0;
    while (j < group.length)
    {
        obj       = {trash:true};
        obj.pid   = group[j]._cpfpid;
        obj.name  = group[j].name;
        obj.pkey  = group[j].name + "_" + j;
        obj.count = group[j].nodeInfo.connections;
        obj.lock  = group[j]._dontDisconnect;
        obj.complete = group[j].creationComplete;
        obj.uptime = group[j].uptime;

        if (typeof group[j].nodeInfo.memoryUsage != "undefined") {
            obj.memoryUsage = (group[j].nodeInfo.memoryUsage);
        }
        if (typeof group[j].nodeConf != "undefined") {
            obj.lv   = group[j].nodeConf.lv;
            obj.f2db = (group[j].nodeConf.f2db);
            obj.amf = (group[j].nodeConf.amf);
        }

        obj.bitrates = group[j].nodeInfo.bitrates;
        obj.file = group[j]._modulePath;
        list.push(obj);
        total += group[j].nodeInfo.connections;

        j++;
    }
    group = null;
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
        "uptime":LBSrv.uptime,
        "args": LBSrv._args
    };
    obj["memoryUsage"] = LBSrv.nodeInfo.memoryUsage;
    if (typeof LBSrv.nodeConf != "undefined") {
        obj.lv   = LBSrv.nodeConf.lv;
        obj.f2db = (LBSrv.nodeConf.f2db);
        obj.amf = (LBSrv.nodeConf.amf);
    }
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
        if (self.push) self.getPID();
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
    return edittor.getAssign.apply(this, arguments);
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
    NSLog.log("info", "mgmt.deleteAssign(%s)", name);
    edittor.deleteAssign.apply(this, arguments);
};
//未知
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
//未知
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
mgmt.prototype.setupSysstat = function () {
    console.log('** setupSysstat **');
    if (typeof this.sysstat != "undefined") return;
    var self = this;
    this.sysstat      = new sys.sysstat();
    this.cpusUsage    = {};
    this.cpusUsagePid = {};
    this.sysInfo      = {memory:0, hdd:0, cpuCount: os.cpus().length};
    this.getDiskUse();
    this.getLoadAvg();
    this.getNetInfo(1000);
    this.counting = 0;
    setInterval(function () {
        self.getDiskUse();
        self.getLoadAvg();
        self.counting++;
        if (self.counting >= 2) {
            self.counting = 0;
            self.getNetInfo(1000);
        }
    }, 5000);
};
mgmt.prototype.runPID = function (arr) {
    var self = this;

    for (var i = 0; i < arr.length; i++) {
        var pid = arr[i];
        var cpu = this.sysstat.pidCPU(pid);
        this.sysstat.on(pid, function (cpid, info) {
            // self.cpusUsage[process.pid.toString()] = info;
            //NSLog.log('debug',cpid, info);
            self.cpusUsage[cpid.toString()] = info;
            self.emit(cpid, info);
        });

    }

};
mgmt.prototype.getPID = function () {
    var clusters = this.clusterInfos;
    if (typeof clusters == "undefined") return;
    var arr_pid = [];
    for (var i = 0; i < clusters.length; i++) {
        var cluster = clusters[i];

        if (typeof this.cpusUsagePid[cluster["pid"]] == 'undefined') {
            this.cpusUsagePid[cluster["pid"]] = cluster["pid"];
            arr_pid.push(parseInt(cluster["pid"]));
        }else{

        }

    }

    this.runPID(arr_pid);
};
mgmt.prototype.getDiskUse = function () {
    var self = this;
    this.sysstat.fd(function (data) {
        if (typeof data == 'number') {
            self.sysInfo["hdd"] = data;
        }else {
            console.error('getDiskUse:', data);
        }
    });
    if (typeof self.sysInfo["hddBlocks"] == "undefined") {
        this.sysstat.fdblocks(function (data) {
            self.sysInfo["hddBlocks"] = data;
        })
    }
};
mgmt.prototype.getLoadAvg = function () {
    this.sysInfo["loadavg"] = os.loadavg();
    this.sysInfo["freemem"] = os.freemem();
};
mgmt.prototype.getNetInfo = function (delay) {
    var self = this;
    if (typeof this.sysstat != "undefined") {
        this.sysstat.netDev(delay, function (info) {
            self.sysInfo["devices"] = info;
        });
        this.sysstat.netSnmp(delay, function (info) {
            self.sysInfo["snmp"] = info;
        });
    }
};
mgmt.prototype.ipcMessage = function (pid, params, client) {
    var server = this.delegate;
    var _pid = parseInt(pid);
    var groupKeys = Object.keys(server.clusters);
    if (!this._verifyArgs(_pid, "number")) {
        this._writeException(client,this.ADMIN_EVENT_TYPE.INVALID_ARGUMENT, "onIpcMessage");
        return;
    }
    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];
        var group = server.clusters[key];
        for (var j = 0; j < group.length; j++) {
            var cluster = group[j];
            var c_pid   = cluster._cpfpid;

            if (c_pid == pid) {
                params.id = "/" + this.cbCount++;
                cluster.send({'evt':'ipcMessage', params:params});
                var ts = setTimeout(function () {
                    this.callbackFunc[params.id] = null;
                }.bind(this), 10000);
                this.callbackFunc[params.id] = {
                    c: client,
                    ts: ts
                };
                return;
            }

        }

    }
    server = null;
};
mgmt.prototype.onIpcMessage = function (message) {
    if (typeof this.callbackFunc[message.id] != "undefined") {
        const client = this.callbackFunc[message.id].client;
        client.write(JSON.stringify({"event":"result", "data": message.params}));
        this.callbackFunc[message.id] = null;
        clearTimeout(this.callbackFunc[message.id].ts);
    }
};
mgmt.prototype.getSchedule = function (client) {
    if (this.scheduler) {
        const data = this.scheduler.getSchedule();
        client.write(JSON.stringify({"event":"onGetSchedule", "data": data}));
        console.log('getSchedule', data);

    } else {
        return [];
    }
};
mgmt.prototype.addSchedule = function (params, client) {
    if (typeof this.scheduler == "undefined") {
        this.scheduler = new Scheduler(this);
    }
    console.log('addSchedule');
    const bool = this.scheduler.job(params);
    const data = this.scheduler.getSchedule();
    client.write(JSON.stringify({event:"onAddSchedule", data:  {res: bool, data: data}}));
};
mgmt.prototype.cancelSchedule = function (params, client) {
    console.log('cancelSchedule');
    const bool = this.scheduler.cancel(params);
    const data = this.scheduler.getSchedule();
    client.write(JSON.stringify({event:"onCancelSchedule", data: {res: bool, data: data}}));
};
mgmt.prototype.getSignature = function (appID) {
    if (typeof appID == "string" && appID != "") {
        return (appID === "284vu86");
    } else {
        return false;
    }
};
module.exports = exports = mgmt;
// var n = new mgmt();
// n.updateAssgin({assign:"hall2",file:"*.js"});
// n.deleteAssgin("hall2");

