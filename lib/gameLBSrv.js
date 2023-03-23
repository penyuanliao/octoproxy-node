"use strict";
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

class gameLBSrv extends events.EventEmitter {
    /**
     * 負載平衡器
     * @param options
     * @param delegate
     * @constructor
     */
    constructor(options, delegate) {
        super();
        if (typeof options.moss == "undefined") options.moss = 1024;
        this.delegate = delegate;
        this.gamSLB = options;
        this.cLBSock = undefined;
        this.callfunc = [];

        this.queue    = [];
        this.sendTime = undefined;
        this.waitBulk = false;
        let pkg = (typeof options.pkgFile == "boolean") ? options.pkgFile : false;
        let execArgv = ["--nouse-idle-notification", "--max-old-space-size=" + options.moss];
        if (pkg) execArgv = [`--options ${execArgv.toString()}`];
        this.glb_fork_d = new daemon(options.file, ["balancing"], {silent:false, pkgFile:pkg, execArgv: execArgv}); //心跳系統

        this.getGamePathCB = [];
        this.doGetGamePathCB = false;
        this.setGamePathCB = {};
        this.setGamePathCBidx = 0;
        this.bulkEnabled = true;
    }
    get getCluster() {
        return this.glb_fork_d;
    }
    refreshActiveCount(group) {
        this.getCluster.send({
            action: "upServerCount",
            list: (group || [])
        })
    };
    updateServerCount(list, keys) {
        this.getCluster.send( {
            action:"upServerCount",
            list: list,
            keys: keys
        });
    }
    init_daemon() {
        NSLog.info('Initialize LoadBalance Service.');
        const child = this.glb_fork_d;
        child.init();
        child.emitter.on('onGetPath', (msg) => {
            NSLog.info(`onGetPath:`, msg);
            this.handle(msg);
        });
        child.emitter.on('onGetPathBulk', (msg) => {
            NSLog.info('onGetPathBulk:', msg.batch.length);
            let batch = msg.batch;
            let len = msg.length;
            let task;
            for (let n = 0; n < len; n++) {
                task = batch[n];
                this.handle(task);
            }
        });
        child.emitter.on('onAbnormal', (msg) => {
            let host = msg.host;
            if (typeof host != "undefined") {
                this.delegate.mgmtSrv.setIPFilter(host, true);
            }
        });
        child.emitter.on('onBusy', (msg) => {
            NSLog.info('onBusy:', msg);
            this.handle(msg);
        });
        //回傳值LB設定值
        child.emitter.on('onGetGamePath', (msg) => {
            let size = this.getGamePathCB.length;
            for (let i = 0; i < size; i++) {
                let invoke = this.getGamePathCB.shift();
                invoke(msg["data"]);
            }
        });
        //回傳設定LB事件
        child.emitter.on('onSetGamePath', (msg) => {
            const {setGamePathCB} = this;
            if (typeof setGamePathCB[msg.index] != "undefined" || setGamePathCB[msg.index] != null) {
                setGamePathCB[msg.index](msg["result"]);
                delete setGamePathCB[msg.index];
            }
        });
        /** @deprecated 屏棄 */
        child.emitter.on('onGetLBRole2', (msg) => {
            const {getGamePathCB} = this;
            for (let i = 0; i < getGamePathCB.length; i++) {
                let invoke = getGamePathCB.shift();
                invoke(msg["data"]);
            }
        });
        /** @deprecated 屏棄 */
        child.emitter.on('onSetLBRole2', (msg) => {
            const {setGamePathCB} = this;
            if (typeof setGamePathCB[msg.index] != "undefined" || setGamePathCB[msg.index] != null) {
                setGamePathCB[msg.index](msg["result"]);
                delete setGamePathCB[msg.index];
            }
        });
        child.emitter.on('upProcessList', (msg) => this.emit('upProcessList', msg));

    };
    //事件響應
    handle(d) {
        const { tokencode, action } = d;
        let invoke = this.callfunc[tokencode];
        if (typeof invoke != "undefined" && invoke != null) {
            invoke(action, d);
            this.callfunc[tokencode] = null;
            delete this.callfunc[tokencode];
            invoke = null;
        } else {
            NSLog.warning(`tokencode => ${tokencode} not invoke function.`)
        }

    };
    //讀取設定檔案
    getGamePath(callback) {
        this.getCluster.send({
            action: "getGamePath"
        });
        this.getGamePathCB.push(callback);
        if (!this.doGetGamePathCB) {
            this.doGetGamePathCB = true;
            setTimeout(() => {
                this.doGetGamePathCB = false;
            }, 10000)
        }
    };
    //儲存設定檔案
    setGamePath(obj, callback) {
        let o = {
            action: "setGamePath",
            data: obj
        };
        if (callback) {
            o.index = this.setGamePathCBidx++;
            this.setGamePathCB[o.index] = callback;
        } else {
            o.index = -1;
        }
        this.getCluster.send(o);
    };
    //
    getLBRole2(callback) {
        this.getCluster.send({
            action: "getLBRole2"
        });
        this.getGamePathCB.push(callback);
        if (!this.doGetGamePathCB) {
            this.doGetGamePathCB = true;
            setTimeout(() => {
                this.doGetGamePathCB = false;
            }, 10000)
        }
    };
    //
    setLBRole2(obj, callback) {
        let o = {
            action: "setLBRole2",
            data: obj
        };
        if (callback) {
            o.index = this.setGamePathCBidx++;
            this.setGamePathCB[o.index] = callback;
        } else {
            o.index = -1;
        }
        this.getCluster.send(o);
    };
    /**
     * 分析轉導服務Path
     * tokencode index[2bytes] + time[12bytes]
     **/
    getLoadBalancePath(url_args, params, cb) {
        let gameType;
        let h, r;
        let host;
        let f5;
        let path;
        let sid;
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
        if (this.getCluster == 'undefined') {
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
        let tokencode = (this.setGamePathCBidx.toString(16)) + Date.now();
        this.callfunc[tokencode] = cb;

        let o = {
            action: this.LBActionEvent.GET_PATH,
            tokencode,
            gameType,
            host,
            f5,
            h,
            r,
            sid
        };

        if (this.bulkEnabled && (Date.now() - this.sendTime) < 10) {
            NSLog.log("info","#10. GameLBSrv send Bulk.");
            this.sendBulk(o);
        } else {
            this.getCluster.send(o, (error) => {
                if (!error && typeof error != "undefined" && error != 0) {
                    // done //
                }else {
                    NSLog.log("error","GetLoadBalancePath Error:", error);
                }
            });
            this.sendTime = Date.now();
        }
        return tokencode;
    };
    /**
     * Promise
     * @param url_args
     * @param params
     * @return {Promise}
     */
    asyncGetLoadBalancePath(url_args, params) {
        return new Promise((resolve) => {
            this.getLoadBalancePath(url_args, params, (action, json) => {
                resolve(json);
            });
        });
    };
    //批次送
    sendBulk(o) {
        this.queue.push(o);
        if (this.waitBulk) return;
        this.waitBulk = true;
        setTimeout( () => {
            NSLog.log("info","#11. GameLBSrv::sendBulk () task length:%s.", this.queue.length);
            let bulks = {
                action: this.LBActionEvent.GET_PATH_BULK,
                batch: this.queue,
                len: this.queue.length
            };

            this.getCluster.send(bulks, (error) => {
                if (!error && typeof error != "undefined" && error != 0) {
                    // done //
                } else {
                    NSLog.log("error","GetLoadBalancePath Bulk Error:", error);
                }
            });
            this.queue = [];
            this.waitBulk = false;
            this.sendTime = new Date().getTime();
        }, 20);
    };
    getGoDead(handle, source) {

        NSLog.log('error','Fx Game LB invalid socket in getGoDead().');

        this.glb_fork_d.send({'evt':'c_init',data:source}, handle, {keepOpen:false});
    };
    init() {
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
    urlParse(params) {
        const {root, dir, base, ext, name} = xPath.parse(params.path);
        const basename = xPath.basename(dir);
        const dirname = dir;
        const edgeName = util.format("%s%s", params.vPrefix, basename);
        const folders = dir.split(xPath.sep);
        const f5       = folders[1];
        let specific   = folders[2];
        if (f5.substr(0, 2) != 'fx') specific = folders[1];
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
        specific: ${specific}
        `);
        */
        if (specific == 'api') {
            return "inind";
        } else if (specific == 'endpoint') {
            let gp = dir.split("/") || [];
            let index = gp.indexOf(specific);
            return {
                dir: gp.slice(index + 1).join("/")
            }
        } else if (specific == 'web') {
            let gp = params.path.split("/") || ["", "", ""];
            return {
                dir: gp.slice(2).join("/")
            }
        } else if (params.specificBase && params.specificBase.has(specific)) {
            let gp = dir.split("/") || [];
            let index = gp.indexOf(specific);
            return {
                dir: gp.slice(index + 1).join("/")
            }
        }
        return edgeName;
    };
    /** 移除回傳事件 **/
    removeCallbackFunc(tokencode) {

        if (tokencode == -1 || typeof tokencode != 'undefined') return;

        this.callfunc[tokencode] = null;
        delete this.callfunc[tokencode];
    };
    responseBusyHandle(handle, source, infos, cb) {

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
    get LBActionEvent() {
        return {
            GET_PATH: "getPath",
            ON_GET_PATH: "onGetPath",
            ON_BUSY: "onBusy",
            GET_PATH_BULK: "getPathBulk",
            ON_GET_PATH_BULK: "onGetPathBulk"
        };
    }
}

module.exports = exports = gameLBSrv;
