/**
 * Created by Benson.Liao on 2016/8/12.
 */
const fxNetSocket   = require('fxNetSocket');
const NSLog         = fxNetSocket.logger.getInstance();
const wsClient      = fxNetSocket.wsClient;
const daemon        = fxNetSocket.daemon;
const net           = require('net');
const events        = require('events');
const util          = require('util');
const xPath         = require('path');

util.inherits(gameLBSrv, events.EventEmitter); // 繼承事件

function gameLBSrv(options, delegate) {

    events.EventEmitter.call(this);

    if (typeof options.moss == "undefined") options.moss = 1024;
    this.delegate = delegate;
    this.gamSLB = options;
    this.cLBSock = undefined;
    this.callfunc = [];

    this.queue    = [];
    this.sendTime = undefined;
    this.waitBulk = false;
    var pkg = (typeof options.pkgFile == "boolean") ? options.pkgFile : false;
    var execArgv = ["--nouse-idle-notification", "--max-old-space-size=" + options.moss];
    if (Boolean(process.env.pkg_compiler)) execArgv = [];
    this.glb_fork_d = new daemon(options.file, ["balancing"], {silent:false, pkgFile:pkg, execArgv: execArgv}); //心跳系統

    this.getGamePathCB = [];
    this.doGetGamePathCB = false;
    this.setGamePathCB = {};
    this.setGamePathCBidx = 0;
}

gameLBSrv.prototype.init_daemon = function () {
    NSLog.log('log','Fx Game LB Fork init process.');
    var self = this;
    this.glb_fork_d.init();

    this.glb_fork_d.emitter.on('onGetPath', function (msg) {
        NSLog.log('info','onGetPath:', msg);
        callback(msg);
    });
    this.glb_fork_d.emitter.on("onGetPathBulk", function (msg) {
        NSLog.log('info','onGetPathBulk:', msg.batch.length);

        var batch = msg.batch;
        var len = batch.length;

        var task;
        for (var n = 0; n < len; n++) {
            task = batch[n];
            callback(task);
        }

    });
    this.glb_fork_d.emitter.on("onAbnormal", function (msg) {
        var host = msg.host;
        if (typeof host != "undefined") {
            self.delegate.mgmtSrv.setIPFilter(host, true);
        }
    });
    this.glb_fork_d.emitter.on('onBusy', function (msg) {
        NSLog.log('info','onBusy:', msg);
        callback(msg);
    });
    this.glb_fork_d.emitter.on('onGetGamePath', function (msg) {
        for (var i = 0; i < self.getGamePathCB.length; i++) {
            var cb = self.getGamePathCB.shift();
            cb(msg["data"]);
        }
    });
    this.glb_fork_d.emitter.on('onSetGamePath', function (msg) {

        if (typeof self.setGamePathCB[msg.index] != "undefined" || self.getGamePathCB[msg.index] != null) {
            self.setGamePathCB[msg.index](msg["result"]);
            delete self.setGamePathCB[msg.index];
        }
    });
    this.glb_fork_d.emitter.on('onGetLBRole2', function (msg) {
        for (var i = 0; i < self.getGamePathCB.length; i++) {
            var cb = self.getGamePathCB.shift();
            cb(msg["data"]);
        }
    });
    this.glb_fork_d.emitter.on('onSetLBRole2', function (msg) {

        if (typeof self.setGamePathCB[msg.index] != "undefined" || self.getGamePathCB[msg.index] != null) {
            self.setGamePathCB[msg.index](msg["result"]);
            delete self.setGamePathCB[msg.index];
        }
    });
    this.glb_fork_d.emitter.on('upProcessList', function (msg) {
        self.emit("upProcessList");
    });
    function callback(d){
        var func = self.callfunc[d.tokencode];
        if (typeof func != 'undefined' && func != null) {
            func(d.action, d);
            self.callfunc[d.tokencode] = null;
            delete self.callfunc[d.tokencode];
            func = null;
        }
    }

};
gameLBSrv.prototype.getGamePath = function (callback) {
    var self = this;
    var o = {};
    o.action = "getGamePath";
    this.getCluster.send(o);
    this.getGamePathCB.push(callback);

    if (this.doGetGamePathCB == false) {
        this.doGetGamePathCB = true;
        setTimeout(function () {
            self.doGetGamePathCB = false;
        }, 10000);
    }
};
gameLBSrv.prototype.setGamePath = function (obj, cb) {
    var o = {};
    o.action = "setGamePath";
    o.data   = obj;
    console.log('setGamePath:', typeof cb != "undefined");
    if (typeof cb != "undefined") {
        o.index = this.setGamePathCBidx++;
        this.setGamePathCB[o.index] = cb;
    }else {
        o.index = -1;
    }

    this.getCluster.send(o);

};
gameLBSrv.prototype.getLBRole2 = function (callback) {
    var self = this;
    var o = {};
    o.action = "getLBRole2";
    this.getCluster.send(o);
    this.getGamePathCB.push(callback);

    if (this.doGetGamePathCB == false) {
        this.doGetGamePathCB = true;
        setTimeout(function () {
            self.doGetGamePathCB = false;
        }, 10000);
    }
};
gameLBSrv.prototype.setLBRole2 = function (obj, cb) {
    var o = {};
    o.action = "setLBRole2";
    o.data   = obj;
    // console.log('setLBRole2:', typeof cb != "undefined");
    if (typeof cb != "undefined") {
        o.index = this.setGamePathCBidx++;
        this.setGamePathCB[o.index] = cb;
    }else {
        o.index = -1;
    }

    this.getCluster.send(o);
};
gameLBSrv.prototype.updateServerCount = function (list, keys) {
    var o = {
        action:"upServerCount",
        list: list,
        keys: keys
    };
    // console.log("info", "updateServerCount", list, keys);
    this.getCluster.send(o);
};
gameLBSrv.prototype.__defineGetter__("getCluster", function () {
   return this.glb_fork_d;
});
/**
 * tokencode index[2bytes] + time[12bytes]
 **/
gameLBSrv.prototype.getLoadBalancePath = function (url_args, params, cb) {
    var gameType;
    var h, r;
    var host;
    var f5;
    var path;
    var sid;
    if (typeof url_args != "undefined") {
        if (typeof url_args["gametype"] != "undefined") {
            gameType = url_args["gametype"];
        } else {
            gameType = url_args["stream"];
        }
        h = url_args["h"];
        r = url_args["r"];
        sid = url_args["sid"];
    }
    if (this.glb_fork_d == 'undefined') {
        NSLog.log('error','Fx Game LB Fork is undefined.');
        return;
    }
    if (typeof params == "string") {
        host = params;
    } else {
        host = params.host;

        path = params.f5.split("/");
        if ("/" + path[1] != params.f5) {
            f5 = path[1];
        } else {
            f5 = "/";
        }

    }
    this.setGamePathCBidx = (++this.setGamePathCBidx % 0x10000);
    var tokencode = (this.setGamePathCBidx.toString(16)) + new Date().getTime();
    this.callfunc[tokencode] = cb;

    var o = {};
    o.action    = this.LBActionEvent.GET_PATH;
    o.tokencode = tokencode;
    o.gameType  = gameType;
    o.host      = host;
    o.f5        = f5;
    o.h         = h;
    o.r         = r;
    o.sid       = sid;

    if ((new Date().getTime() - this.sendTime) < 10) {
        NSLog.log("info","#10. GameLBSrv send Bulk.");
        this.sendBulk(o);
    } else {
        this.glb_fork_d.send(o,function (error) {
            if (!error && typeof error != "undefined" && error != 0) {
                // done //
            }else {
                NSLog.log("error","GetLoadBalancePath Error:", error);
            }
        });
        this.sendTime = new Date().getTime();
    }
    return tokencode;
};

gameLBSrv.prototype.sendBulk = function (o) {

    this.queue.push(o);
    if (this.waitBulk == false) {
        var self = this;
        this.waitBulk = true;

        setTimeout(function () {
            NSLog.log("info","#11. GameLBSrv::sendBulk () task length:%s.", self.queue.length);
            var bulks = {
                action: self.LBActionEvent.GET_PATH_BULK,
                batch: self.queue,
                len: self.queue.length
            };

            self.glb_fork_d.send(bulks, function (error) {
                if (!error && typeof error != "undefined" && error != 0) {
                    // done //
                } else {
                    NSLog.log("error","GetLoadBalancePath Bulk Error:", error);
                }
            });
            self.queue = [];
            self.waitBulk = false;

            self.sendTime = new Date().getTime();
        }, 20);
    }
};

gameLBSrv.prototype.getGoDead = function (handle, source) {

    NSLog.log('error','Fx Game LB invalid socket in getGoDead().');

    this.glb_fork_d.send({'evt':'c_init',data:source}, handle, {keepOpen:false});
};

gameLBSrv.prototype.init = function () {
    var self = this;
    var cLBSock = self.cLBSock = new net.Socket();
    cLBSock.on('connect', function () {

        NSLog.log('info', "FX Game LB Server Socket has Connection.");

        self.cLBSock.write("/fxLB\0");
    });
    cLBSock.on('close', function () {
        setTimeout(function () {

            self.cLBSock.removeAllListeners();
            self.cLBSock = null;

            NSLog.log('warning', 'FX Casino LB Socket connect in close() after 5 secs continuous retries.');

            self.init();

        }, 5000);
    });
    cLBSock.on('error', function (err) {
        NSLog.log('err', 'FX Casino LB Socket error:', err.code);
    });
    cLBSock.on('data', function (chunk) {

        var data = chunk.toString('utf8').replace("\0","");
        var d = JSON.parse(data);
        NSLog.log('info','gameLBSrv response:', data);
        if (d.action == 'ready') {
            NSLog.log('info', "FX Game LB Server Socket has Ready.");

        }else if (d.action == 'onGetPath' || d.action == 'onBusy') {
            if (d.action == 'onBusy')
                NSLog.log('info', "the server is currently busy. please try again later (%s).", d.mTime);
            else
                NSLog.log('info', "FX Game LB Server response action:%s.", d.action , data);

            var func = self.callfunc[d.tokencode];
            if (typeof func != 'undefined' && func != null) {
                func(d.action, d);
                self.callfunc[d.tokencode] = null;
                func = null;
            }
        }


    });
    cLBSock.connect(this.gamSLB.port, this.gamSLB.host);

};
/**
 * 調整HTTP URL RULE
 * @param params
 * @return {string}
 */
gameLBSrv.prototype.urlParse = function (params) {
    const {root, dir, base, ext, name} = xPath.parse(params.path);

    const basename = xPath.basename(dir);
    const dirname = dir;
    const slashOffset = (dirname[0] == "/" ? 2 : 1);
    const offset = dirname.indexOf("/", slashOffset);
    const edgeName = util.format("%s%s", params.vPrefix, dirname.substr((offset == -1 ? 0 : offset)));
    const folders = dir.split("/");
    /*
    console.log(` urlParse ->
    root: ${root}
    dir: ${dir}
    base: ${base}
    basename: ${basename}
    dirname: ${dirname}
    edgeName: ${edgeName}
    ext: ${ext}
    f5: ${folders[1]}
    `);
    */
    if (folders[1] == 'api') {
        return "inind";
    }
    return edgeName;
}

/** call and waiting callback **/
gameLBSrv.prototype.__old = function (gameType, cb) {
    /*
    var tokencode = new Date().getTime();

    setTimeout(function () {
        var o = {};
        o.action = 'onBusy';
        o.tokencode = tokencode;
        o.path = "/Hall/service.h1";
        o.mTime = 1000;
        cb(o.action,o);
    },1);
    return tokencode;
     */
    if (!this.cLBSock) {
        NSLog.log("error","Connection LoadBalance.json(%s) closed by update server may be down");
        return -1;
    }

    if (this.cLBSock.writable == true) {
        var tokencode = new Date().getTime();
        NSLog.log('info', 'getPath gameType:',gameType);
        this.cLBSock.write(JSON.stringify({action:'getPath', tokencode:tokencode, gameType:gameType}) + "\0");
        this.callfunc[tokencode] = cb;
        return tokencode;
    }else {
        NSLog.log('error','cLBSock.writable=false');
    }

    return -1;
};

/** 移除回傳事件 **/
gameLBSrv.prototype.removeCallbackFunc = function (tokencode) {

    if (tokencode == -1 || typeof tokencode != 'undefined') return;

    this.callfunc[tokencode] = null;
    delete this.callfunc[tokencode];
};
gameLBSrv.prototype.responseBusyHandle = function (handle, source, infos, cb) {

    var socket = new net.Socket({
        handle:handle,
        allowHalfOpen:false
    });
    socket.readable = socket.writable = true;


    var ws = new wsClient(socket, function () {
        NSLog.log('trace','handshake successful. MODE:' + ws.mode.toLocaleUpperCase());

        ws.write(infos);

        ws.destroy();

        if (!cb) return;

        setTimeout(function () {
            NSLog.log('trace','CallBack handle close()');
            cb();
        }, 10);

    });
    ws.on('data', function (data) {
        //console.log('Data Event is received ws-packet Stream.');
        NSLog.log('trace','ws data: ', data);
    });
    ws.on('message', function (msg) {
        //console.log('Message is decode ws-packet Stream on:', msg);
        NSLog.log('trace','ws message:', msg);
    });
    socket.emit("connect");
    socket.emit('data', Buffer.from(source));

    socket.resume();
};
/** send fork **/
gameLBSrv.prototype._refuseRemoteWithSocket = function () {
    
};
gameLBSrv.prototype._refuseRemoteWithWebsocket = function () {

};


gameLBSrv.prototype.LBActionEvent = {
    GET_PATH: "getPath",
    ON_GET_PATH: "onGetPath",
    ON_BUSY: "onBusy",
    GET_PATH_BULK: "getPathBulk",
    ON_GET_PATH_BULK: "onGetPathBulk"
};

module.exports = exports = gameLBSrv;
