/**
 * Created by Benson.Liao on 16/2/16.
 * @module Fxdaemon
 */
const util = require('util');
const path = require('path');
const fs   = require('fs');
const cp = require('child_process');
const events = require('events');
const dlog = require('debug');
dlog.log = console.log.bind(console); //file log 需要下這行
const debug = dlog('daemon');
const error = dlog('error');
const NSLog = require('./FxLogger.js').getInstance();
/**
 * @typedef {number} wait_times 心跳檢查時間
 * @default 15000 毫秒
 */
const wait_times = 15000;
/**
 * @typedef {number} doWait_maximum 最大檢查允許沒回應次數
 * @default 15000 毫秒
 */
const doWait_maximum = 5;
const heart_times = 5000;
const restart = false;

const retry = {"limit":0, "timeout":1000};

/***
 * HEART BEAT Module
 * @param {Object} modulePath 參數
 * @version 1.0.0
 * @constructor
 */
function Fxdaemon(modulePath/*, args, options*/) {
    let options, args;
    // copy github child_process
    if (Array.isArray(arguments[1])) {
        args = arguments[1];
        options = util._extend({}, arguments[2]);
    } else if (arguments[1] && typeof arguments[1] !== 'object') {
        throw new TypeError('Incorrect value of args option');
    } else {
        args = [];
        options = util._extend({}, arguments[1]);
    }
    /**
     * 程序相關資訊
     * @typedef {Object} nodeInfo 監控資訊
     * @property {Object} memoryUsage 記憶體使用量
     * @property {Number} connections 統計人數
     */
    this.nodeInfo = {"memoryUsage": undefined,"connections": 0};
    this.nodeConf = {lv: 'debug', f2db: ""};
    /**
     * 檔案路徑
     * @property {String} _modulePath 路徑
     * @private
     */
    this._modulePath = modulePath;
    /**
     * 設定參數
     * @property {Object} _options 參數
     * @private
     */
    this._options = options;
    /**
     * Process list of string arguments.
     * @type {Array}
     * @private
     */
    this._args = args;
    /**
     * process 物件
     * @type {module:child_process.spawn|module:child_process.fork}
     * @private
     */
    this._cpf = null;
    /**
     * Process identifier (PID)
     * @type {number}
     * @private
     */
    this._cpfpid = 0;
    /**
     * 心跳計時器
     * @type {Timer}
     * @private
     */
    this._heartbeat = 0;
    /**
     * 是否已經死掉
     * @type {boolean}
     * @private
     */
    this._killed = true;
    /**
     * 是否在運行
     * @type {boolean}
     * @private
     */
    this._running = false;
    /**
     * 是否啟動心跳機制
     * @type {boolean}
     * @private
     */
    this._heartbeatEnabled = (typeof options.heartbeatEnabled != "undefined") ? options.heartbeatEnabled : true;
    /**
     * 啟動輪詢檢查
     * @type {boolean}
     * @private
     */
    this._lookoutEnabled = (typeof options.lookoutEnabled != "undefined") ? options.lookoutEnabled : true;
    /* todo Don't disconnect existing clients when a new connection comes in, refuse new connection. */
    /**
     * 禁止使用者進入
     * @type {boolean}
     * @private
     */
    this._dontDisconnect = false;
    /**
     * 自動回收物件
     * @type {boolean}
     * @private
     */
    this._autorelease = false; // not implement
    /**
     * 紀錄處理事件
     * @type {boolean}
     */
    this.saveFileLog = true;
    /**
     * 自訂事件回傳
     * @name Fxdaemon#custMsgCB
     * @type Function
     * @default undefined
     * @public
     */
    this.custMsgCB = undefined;
    /**
     * 記憶體大小
     * @type {number}
     */
    this.mxoss = 2048;
    /**
     * 物件名稱
     * @type {string}
     */
    this.name = "";
    /**
     * 建立時間
     * @type {Number}
     */
    this.uptime = 0;
    /**
     * 設定pkg檔案路徑
     * @type {Boolean|String}
     */
    this.pkgFile = options.pkgFile ? options.pkgFile : false;
    /**
     * 設定其他檔案路徑
     * @type {Boolean|String}
     */
    this.cmd = options.cmd ? options.cmd : false;
    /**
     * make sure initiallization process send creationComplete
     * @type {Number}
     */
    this.creationComplete = 0;
    /**
     * released source code
     * @type {boolean} isRelease
     */
    this.isRelease = false;
    // if (this.cmd != false) this.creationComplete = true;
    /**
     * exec has not use complete event
     * @type {module:events.EventEmitter.EventEmitter}
     */
    this.emitter = new events.EventEmitter();
    /**
     * done callback
     */
    this.blocking = new Map();
};

Fxdaemon.prototype = /** @lends Fxdaemon */ {
    constructor:Fxdaemon,
    /**
     * 處理程序初始化物件
     * @name Fxdaemon#init
     * @function init
     */
    init: function () {
        NSLog.log("info", 'daemon initialize', this._modulePath, this._args[0]);

        if (this._cpf) return;

        let cp_retry = retry.limit;
        let start = new Date().getTime();

        const context = this;

        context._killed = false;

        (function run() {
            debug('process start %s (%d)', context._modulePath, context._cpfpid);
            if (typeof context._modulePath === 'undefined' || context._modulePath === null || context._modulePath === "") return;

            if (typeof context._options != "object") context._options = {};
            // context._modulePath = path.resolve(process.cwd(), context._modulePath);
            if (context.pkgFile === false && context.cmd == false) {
                context._cpf = cp.fork(context._modulePath, context._args, context._options);
            } else if (context.cmd != false) {
                if (typeof context._options.stdio == "undefined") context._options.stdio = ['pipe', 'pipe', 'pipe', 'ipc'];
                if (typeof context.optConf.stdoutFile == "string") {
                    context._options.stdio[1] = fs.openSync(context.optConf.stdoutFile, "a");
                    context.setMakeSureComplete(true);
                }
                if (typeof context.optConf.stderrFile == "string") {
                    context._options.stdio[2] = fs.openSync(context.optConf.stderrFile, "a");
                }

                let cur;
                if (context.cmd == "node" && Array.isArray(context._options.execArgv)) {
                    cur = context._options.execArgv.concat([context._modulePath],context._args);
                } else {
                    cur = [context._modulePath].concat(context._args);
                }
                context._cpf = cp.spawn(context.cmd, cur, context._options);
                // redirect the child process standard output into files
                if (typeof context.optConf.stdoutFile != "string") {
                    context._cpf.stdout.on("data", function (data) {
                        if (Boolean(process.env.NODE_DEBUG) == true) console.log("stdout:", data.toString());
                        context.setMakeSureComplete(true);
                    })
                }
                //redirect the child process err output into files
                if(typeof context.optConf.stderrFile != "string") {
                    context._cpf.stderr.on("data", function (data) {
                        if (Boolean(process.env.NODE_DEBUG) == true) console.log("stderr:", data.toString());
                    })
                }
            } else {
                let cur = context._options.execArgv.concat([context._modulePath]);
                cur = cur.concat(context._args);
                if (typeof context._options.stdio == "undefined") context._options.stdio =  ['pipe', 'pipe', 'pipe', 'ipc'];
                // context._cpf = cp.spawn("node", cur, context._options);
                context._cpf = cp.spawn(context._modulePath, context._args, context._options);
                context._cpf.stdout.on("data", function (data) {
                    if (Boolean(process.env.NODE_DEBUG) == true) console.log("stdout:", data.toString());
                })
                context._cpf.stderr.on("data", function (data) {
                    if (Boolean(process.env.NODE_DEBUG) == true) console.log("stderr:", data.toString());
                })
            }

            context._cpfpid = context._cpf.pid;
            context.uptime = new Date().getTime();
            context._cpf.on('exit', function (code, signal) {
                context.log("info",'[%s | %s] process will exit %s (%s)', context._modulePath, context._args[0], signal, code);
                context._killed = true;
                context._running = false;
                context.setMakeSureComplete(false);
                if  ((code == 0 && (signal == null || !signal)) || (signal == "SIGTERM" && (code == null || !code)))  {
                    context.log("info", "Signals termination Done");
                } else {
                    context.emitter.emit('unexpected', {name: context.name, signal: signal, code: code});
                }
                if (code === 2) {
                    NSLog.log("warning", ` + Exit code SIGINT`);
                    context.restart();
                    return;
                }
                if (!restart) return;

                if (cp_retry > 0) {
                    let end = new Date().getTime();
                    if (end - start < retry.timeout){
                        setTimeout(function(){run();},100);
                        cp_retry--;
                    }else {
                        context._cpf = null;
                        context._cpfpid = 0;
                    };

                }else {
                    run();
                };

            });
            // Receive Child Process Send Message //
            context._cpf.on("message", function (message, handle) {
                message = (typeof message === "string") ? JSON.parse(message) : message;

                if (typeof message != "object") return;

                if (message.evt === "processInfo") {
                    context._running = true;
                    context._msgcb ? context._msgcb(message.data):false;
                };
                if (message.evt === "processConf") {
                    context.nodeConf = message.data;
                }
                // todo socket goto other cluster
                if (message.evt === "socket") {
                    // context.emit("message", {evt:message.evt, goto:message.goto, handle:handle});
                    if (context.custMsgCB){
                        context.custMsgCB(message.evt,{evt:message.evt, goto:message.goto, handle:handle});
                    }
                }
                else if (message.evt === "warp_handle") {
                    context.emitter.emit("warp_handle", message, handle);
                    if (context.custMsgCB){
                        context.custMsgCB(message.evt,{evt:message.evt, goto:message.goto, handle:handle});
                    }
                }
                else if (message.evt === "hotReloadComplete") {
                    context.restart();
                    context._dontDisconnect = false;
                }
                else if (message.evt === "c_init2" || message.evt === "c_init") {
                    let {blocking} = context;
                    if (blocking.has(message.id)) {
                        let {cb, timeout} = blocking.get(message.id);
                        clearTimeout(timeout);
                        cb(message);
                    }
                }
                else if (message.evt === "onIpcMessage") {
                    context.emitter.emit("onIpcMessage", message);
                }
                else if (message.evt === "metadata") {
                    context.metadata = message.data;
                }
                else if (message.evt === "streamData") {
                    // context.emit("streamData", message);
                    if (context.custMsgCB){
                        context.custMsgCB(message.evt, message);
                    }
                }else if (typeof message.action != 'undefined') {
                    context.emitter.emit(message.action, message);
                    if (message.action == "creationComplete") {
                        context.setMakeSureComplete((typeof message.data == "boolean" || typeof message.data == "number") ? message.data : true);
                    }
                }

            });

        })();
        //啟動心跳檢查機制
        if(context._heartbeatEnabled) context.startHeartbeat();

    },
    /**
     * 啟動心跳機制
     * @name Fxdaemon#startHeartbeat
     * @function startHeartbeat
     * @version 1.0.0
     */
    startHeartbeat: function () {

        const daemon = this;

        let tries = 0;

        function lookoutdaemon() {
            let out;
            if (daemon._lookoutEnabled == true) {
                //15s check
                out = setTimeout(() => {
                    tries++;
                    out = 0;
                    NSLog.log("info", "lookout Daemon(%s) try %s %s %s", daemon._modulePath, tries ,">", doWait_maximum)
                    if (tries > doWait_maximum) {
                        //todo remove and restart

                        tries = 0;
                        daemon.stopHeartbeat();
                        daemon.quit();

                        setTimeout( () => {
                            if (daemon.isRelease) return false; //已經回收
                            daemon.init();
                            daemon.emitter.emit('status', 'Daemon init [' + daemon.name + ']');
                            NSLog.log("warning", "lookoutdaemon init()", daemon._modulePath);
                        },1000);

                    }
                }, wait_times);
            }

            daemon.getInfo((data) => {
                try {
                    if (typeof data == 'string') {
                        data = JSON.parse(data);
                    }
                    daemon.nodeInfo = data;
                }
                catch (e) {
                }

                if (out != 0) {
                    clearTimeout(out);
                    out = 0;
                };
                tries = 0;
            }, { tries: tries });

        }
        if (daemon._heartbeat) daemon.stopHeartbeat();
        daemon._heartbeat = setInterval(() => lookoutdaemon(), heart_times);
    },
    /**
     * 啟動心跳機制
     * @name Fxdaemon#startHeartbeat
     * @function startHeartbeat
     */
    stopHeartbeat: function () {
        debug('stop lookout daemon.');
        const daemon = this;
        daemon._heartbeat = clearInterval(daemon._heartbeat);
    },
    /**
     * 送出onconnection事件
     * @name Fxdaemon#sendHandle
     * @function sendHandle
     * @param {*} data 數據
     * @param {module:net.Socket=} handle socket.handle
     * @param {function} cb 完成回應
     */
    sendHandle: function (data, handle, cb) {
        if (this._cpf) {
            if (handle instanceof Function) {
                cb = handle;
                handle = undefined;
            }
            this._handlecb = cb;

            try {
                this._cpf.send({'evt':'onconnection',data:data}, handle,{silent:false}, cb);
            }
            catch (e) {
                error('send socket handle error.');
            }

        }else{
            error('child process is NULL.');
        };
    },
    /**
     * 呼叫子服務事件
     * @name Fxdaemon#send
     * @function send
     * @param {Object} message 訊息
     * @param {module:net.Socket=} handle
     * @param {Object} options prcess.send參數
     * @param {Boolean} options.keepOpen sokcet is kept open.
     * @param {Function} cb 回送事件
     * @public
     */
    send: function (message, handle, options, cb) {

        if (this._dontDisconnect && handle) return false;
        return this.postMessage(message, handle, options, cb);
    },
    /**
     * 送出stream資料(視訊使用)
     * @name Fxdaemon#sendStream
     * @function sendStream
     * @param {Buffer|String} data 視訊資料
     * @public
     */
    sendStream: function (data) {
        if (this._cpf) {
            try {
                if (typeof data != 'string') {
                    msg = JSON.stringify(data);
                }
                this._cpf.send({'evt':'streamData','data':data});
            }
            catch (e) {
                debug('sendStream info error.');
            }

        }else {
            error('child process is NULL.');
        };
    },
    /**
     * 呼叫子服務更新心跳資訊
     * @name Fxdaemon#getInfo
     * @function getInfo
     * @param {Function} cb 回傳
     * @param {Object} data 資料
     * @public
     */
    getInfo: function (cb, data) {

        if (this._cpf && this._killed == false) {
            this._msgcb = cb;
            try {
                this._cpf.send({'evt':'processInfo','data':data});
            }
            catch (e) {
                debug('send process info error.', this._killed);
            }

        }else  {
            NSLog.log('info','getInfo: Process Is Dead. ')
        };
    }, // getInfo code ended
    /**
     * 發送訊號
     * @param message
     * @param handle
     * @param options
     * @param cb
     * @public
     */
    postMessage: function (message, handle, options, cb) {
        const { creationComplete, _cpf, _killed } = this;
        if (creationComplete != 1) return false;

        if (_cpf && !_killed) {
            _cpf.send(message, handle, options, () => {
                if (cb) this.blocking.set(message.id, {cb, timeout: setTimeout(() => {
                        cb({event: false, error:'timeout'});
                        this.blocking.delete(message.id);
                    }, 5000)});
            });

        } else {
            NSLog.log("error", `Daemon ${this.name} child process has died.`)
        };
    },
    /**
     * Promise
     * @param message
     * @param message.id
     * @param handle
     * @param options
     * @return {Promise}
     */
    asyncPostMessage: function (message, handle, options) {
        return new Promise((resolve) => {
            if (!message.id) {
                reject("the 'id' does not exist.");
            } else {
                this.postMessage(message, handle, options, resolve);
            }
        })
    },
    /**
     * 刪除服務(不會停止心跳服務)
     * @name Fxdaemon#quit
     * @function quit
     * @public
     */
    quit: function () {
        if (this._cpf) {
            debug('server-initiated unhappy termination.');
            this._killed = true;

            cp.exec("kill -9 " + this._cpfpid);

            this._cpf = null;
            this._cpfpid = 0;
        }else {
            error('child process is null.');
        };

    }, // quit ended
    /**
     * 停止服務
     * @name Fxdaemon#stop
     * @function stop
     * @public
     */
    stop: function () {
        if (this._cpf) {
            const daemon = this;
            let signalCode = daemon._cpf.signalCode;
            daemon._killed = true;
            try {
                if (!signalCode && signalCode == null) daemon._cpf.disconnect();
            } catch (e) {
                NSLog.log("error", e);
            }
            // SIGHUP(1), SIGINT(2), SIGQUIT(131), SIGTERM(14)
            daemon._cpf.kill('SIGTERM');
            daemon._cpf = null;
            daemon._cpfpid = 0;

            debug("daemon stop.");
        };
    },
    /**
     * 重啟服務
     * @name Fxdaemon#restart
     * @function restart
     * @public
     */
    restart: function () {
        NSLog.log("info", "Daemon restart:", this.name);
        const daemon = this;
        if (this._cpf) {
            daemon.stopHeartbeat();
            daemon.stop();
        }
        setTimeout(function () {
            daemon.init();
            daemon.emitter.emit('status', 'Daemon init [' + daemon.name + ']');
            NSLog.log("warning", "restart init()", daemon._modulePath);
        },1000); // import need wait 1 sec
    },
    /**
     * @name Fxdaemon#log
     * @function log
     * @public
     */
    log: function () {
        if (!this.saveFileLog) return;

        NSLog.log.apply(NSLog, arguments)
    },
    /**
     * 服務是否建立完成
     * @name Fxdaemon#setMakeSureComplete
     * @function setMakeSureComplete
     * @param {Boolean|number} bool
     * @public
     */
    setMakeSureComplete: function (data) {
        let value = 0;
        if (typeof data == "boolean") {
            value = (data ? 1 : 0);
        } else if (typeof data === "number") {
            value = Number.parseInt(data);
        }
        if (value == 1 && this.creationComplete != 1) {
            this.emit('up');
        }
        else if (this.creationComplete == 1 && value == 0) {
            this.emit('down');
        }
        this.creationComplete  = value;
        return value;
    },
    /**
     * 服務是否還活著
     * @name Fxdaemon#isActive
     * @function isActive
     * @returns {boolean}
     * @public
     */
    isActive: function () {
        const context = this;
        if (typeof context._cpf == "undefined" || context._cpf == null || context._cpf == "") return false;
        if (typeof context._cpf.pid == "undefined" || context._cpf.pid <= 0 ) return false;
        return true;
    },
    /***/
    emit: function (event) {
        this.emitter.emit.apply(this.emitter, arguments);
    },
    /***/
    on: function () {
        this.emitter.on.apply(this.emitter, arguments);
    }
};

module.exports = exports = Fxdaemon;

/*
 const cfg = require('./../../config.js');
 let opts = cfg.forkOptions;
 let env = process.env;
 env.NODE_CDID = 0;
 console.log(opts.cluster);
 let daemon = new Fxdaemon(opts.cluster,{silent:false}, {env:env});
 daemon.init();
 daemon.sendStream();
 */
