"use strict";
/**
 * Created by Benson.Liao on 2022/09/16.
 * @module FxDaemon
 */
const util   = require('util');
const path   = require('path');
const fs     = require('fs');
const cp     = require('child_process');
const { spawn, fork, exec } = require('child_process');
const events = require('events');
const NSLog  = require('./FxLogger.js').getInstance();
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
class FxDaemon extends events.EventEmitter {
    constructor(modulePath/*, args, options*/) {
        super();
        let options, args;
        // copy github child_process
        if (Array.isArray(arguments[1])) {
            args = arguments[1];
            options = Object.assign({}, arguments[2]);
        } else if (arguments[1] && typeof arguments[1] !== 'object') {
            throw new TypeError('Incorrect value of args option');
        } else {
            args = [];
            options = Object.assign({}, arguments[1]);
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
        this._options = options || {};
        /**
         * Process list of string arguments.
         * @type {Array}
         * @private
         */
        this._args = args;
        /**
         * process 物件
         * @define {module:child_process.spawn|module:child_process.fork}
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
         * @name FxDaemon#custMsgCB
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

        this.optConf = null;

        this.tryDetect = 0;

        this.assign2syntax = options.assign2syntax ? options.assign2syntax : true;
        /**
         * 替代物件名稱
         * @type {Array}
         */
        this.rules = null;

    }

    /**
     * child process
     * @param {*} value
     */
    set child(value) {
        this._cpf = value;
        this.pid = value.pid;
        this.uptime = Date.now();
    }
    set pid(value) {
        this._cpfpid = value;
    }
    get pid() {
        return this._cpfpid;
    }
    /**
     * 是否在運行
     * @return {boolean}
     */
    get running() {
        return this.creationComplete != 0;
    }
    init() {
        const { pkgFile, cmd, _modulePath, _args, _options } = this;

        NSLog.log("info", 'daemon initialize', _modulePath, this._args[0]);

        if (this._cpf) return false;

        this._killed = false;

        if (this.isEmpty()) return false;
        let child;
        if (!pkgFile && !cmd) {
            //js
            child = cp.fork(_modulePath, _args, _options);
        } else if (cmd != false) {
            child = this.spawnCommand();
        } else {
            child = this.executeCommand();
        }
        this.child = child;
        child.on('exit', (code, signal) => {
            NSLog.log("info",'[%s | %s] process will exit %s (%s)', _modulePath, _args[0], signal, code);
            this._killed = true;
            this.setMakeSureComplete(0);
            if  ((code == 0 && (signal == null || !signal)) || (signal == "SIGTERM" && (code == null || !code)))  {
                this.log("info", "Signals termination Done");
            } else {
                this.emitter.emit('unexpected', {name: this.name, signal: signal, code: code});
            }
            if (code === 2) {
                NSLog.log("warning", ` + ${this.name} Exit code SIGINT`);
                this.restart();
                return true;
            }
        });
        child.on('message', (data, handle) => this.handleMessage(data, handle));
        //啟動心跳檢查機制
        if(this._heartbeatEnabled) this.startHeartbeat();
    };
    /**
     * custom IPC message event
     * @param {Object} data
     * @param {*} handle socket.handle
     */
    handleMessage(data, handle) {
        let message = (typeof data === "string") ? JSON.parse(data) : data;

        let { evt, action } = message;

        let { blocking } = this;
        if (message.id && blocking.has(message.id)) {
            let {cb, timeout} = blocking.get(message.id);
            clearTimeout(timeout);
            cb(message);
            cb = null;
        }

        if (evt === 'processInfo') {
            this._msgcb ? this._msgcb(message.data) : false;
        }
        else if (evt === 'processConf') {
            this.nodeConf = message.data;
        }
        else if (evt === 'warp_handle') {
            this.emitter.emit("warp_handle", message, handle);
        }
        else if (evt === 'startWarpComplete') {
            if (message.reboot) {
                this.restart();
            }
            this._dontDisconnect = false;
        }
        else if (evt === 'c_init2' || evt === 'c_init') {

        }
        else if (evt === 'onIpcMessage') {
            this.emitter.emit("onIpcMessage", message);
        }
        else if (evt === 'metadata') {
            this.metadata = message.data;
        }
        else if (evt === 'streamData') {
            if (this.custMsgCB instanceof Function) {
                this.custMsgCB(evt, message);
            }
        }
        else if (typeof action != "undefined") {
            this.emitter.emit(action, message);
            if (action == 'creationComplete') {
                let value = 1;
                if (typeof message.data == "boolean") value = (message.data) ? 1 : 0;
                if (typeof message.data == "number") value = message.data;
                this.setMakeSureComplete(value);
            }
        }
        else {
            NSLog.error(`The system wa unable to find evt: ${evt ? evt : ''} or action: ${action ? action : ''} message event.`)
        }

    };
    isEmpty() {
        return (typeof this._modulePath === 'undefined' || this._modulePath === null || this._modulePath === "");
    };
    spawnCommand() {
        const { _modulePath, _args, cmd } = this;
        let { stdoutFile, stderrFile, stdio, execArgv } = (this._options || {});
        if (typeof stdio == "undefined") this._options.stdio = ['pipe', 'pipe', 'pipe', 'ipc'];
        if (typeof stdoutFile == "string") {
            this._options.stdio[1] = fs.openSync(stdoutFile, "a");
            this.setMakeSureComplete(1);
        }
        if (typeof stderrFile == "string") {
            this._options.stdio[2] = fs.openSync(stderrFile, "a");
        }
        let DEBUG = Boolean(process.env.NODE_DEBUG);
        let child;
        let cur;
        if (this.cmd == "node" && Array.isArray(execArgv)) {
            cur = execArgv.concat([_modulePath], _args);
        } else {
            cur = [_modulePath].concat(_args);
        }
        child = cp.spawn(cmd, cur, this._options);
        // redirect the child process standard output into files
        if (typeof stdoutFile != "string") {
            child.stdout.on("data", (data) => {
                if (DEBUG) console.log("stdout:", data.toString());
                this.setMakeSureComplete(1);
            });
        }
        //redirect the child process err output into files
        if (typeof stderrFile != "string") {
            child.stderr.on("data",(data) => {
                if (DEBUG) console.log("stderr:", data.toString());
            });
        }
        return child;
    };
    executeCommand() {
        //pkg
        let DEBUG = Boolean(process.env.NODE_DEBUG);
        const { _modulePath, _args, cmd } = this;
        let { stdoutFile, stderrFile, stdio, execArgv } = (this._options || {});

        let cur = execArgv.concat([_modulePath]);
        cur = cur.concat(_args);
        if (typeof stdio == "undefined") this._options.stdio =  ['pipe', 'pipe', 'pipe', 'ipc'];
        // let child = cp.spawn("node", cur, this._options);
        let child = cp.spawn(_modulePath, _args, this._options);
        child.stdout.on("data",(data) => {
            if (DEBUG) console.log("stdout:", data.toString());
        });
        child.stderr.on("data",(data) => {
            if (DEBUG) console.log("stderr:", data.toString());
        });
        return child;
    };
    /**
     * 啟動心跳機制
     * @name FxDaemon#startHeartbeat
     * @function startHeartbeat
     * @version 1.0.0
     */
    startHeartbeat() {
        if (this._heartbeat) this.stopHeartbeat();
        this.tryDetect = 0;
        this._heartbeat = setInterval(() => this.patrolling(), heart_times)
    };
    /**
     * 監視線程patrolling
     */
    patrolling() {
        let { tryDetect } = this;
        let out;
        if (!this._lookoutEnabled) return false;

        out = setTimeout(() => this.checkingException(), wait_times);

        this.getInfo({ tryDetect }, (data) => {
            try {
                if (typeof data == "string") data = JSON.stringify(data);
                this.nodeInfo = data;
            } catch (e) {
                NSLog.error(`[${this.pid}] patrolling.getInfo.error: ${e}`);
            }
            if (out) clearTimeout(out);
            this.tryDetect = 0;
        });

    };
    checkingException() {
        let { tryDetect } = this;
        this.tryDetect++;

        NSLog.info(`GetInfo() not received
        timeout: ${wait_times} patrolling: ${this._modulePath}
        tryDetect: ${tryDetect} doWait_maximum: ${doWait_maximum}`);

        if (!(this.tryDetect > doWait_maximum)) return true;

        this.stopHeartbeat();
        this.quit();
        this.tryDetect = 0;
        // execute restart
        setTimeout(() => {
            if (this.isRelease) return false;
            this.init();
            this.emitter.emit('status', 'Daemon init [' + this.name + ']');
            NSLog.log("warning", `${this._modulePath} patrolling.checkingException.init()`);
        }, 1000);
        return false;
    };
    /**
     * 停止心跳機制
     * @name FxDaemon#stopHeartbeat
     * @function startHeartbeat
     */
    stopHeartbeat() {
        NSLog.debug(`[${this.name}] Stop lookout daemon.`);
        clearInterval(this._heartbeat);
        this._heartbeat = undefined;
    };
    /**
     * 送出onconnection事件
     * @name FxDaemon#sendHandle
     * @function sendHandle
     * @param {*} data 數據
     * @param {module:net.Socket=} handle socket.handle
     * @param {function} cb 完成回應
     */
    sendHandle(data, handle, cb) {
        if (this._cpf) {
            if (handle instanceof Function) {
                cb = handle;
                handle = undefined;
            }
            this._handlecb = cb;

            try {
                this._cpf.send({ evt:'onconnection', data }, handle,{ silent:false }, cb);
            }
            catch (e) {
                NSLog.error('send socket handle error.');
            }

        }else{
            NSLog.error('child process is NULL.');
        }
    };
    /**
     * 呼叫子服務事件
     * @name FxDaemon#send
     * @function send
     * @param {Object} message 訊息
     * @param {module:net.Socket=} handle
     * @param {Object} options prcess.send參數
     * @param {Boolean} options.keepOpen sokcet is kept open.
     * @param {Function} cb 回送事件
     * @public
     */
    send(message, handle, options, cb) {
        if (this._dontDisconnect && handle) return false;
        return this.postMessage(message, handle, options, cb);
    };
    /**
     * 送出stream資料(視訊使用)
     * @name FxDaemon#sendStream
     * @function sendStream
     * @param {Buffer|String} data 視訊資料
     * @public
     */
    sendStream(data) {
        if (this._cpf) {
            try {
                this._cpf.send({'evt':'streamData','data': data});
            }
            catch (e) {
                NSLog.debug('sendStream info error.');
            }

        } else {
            NSLog.error('child process is NULL.');
        }
    }
    /**
     * 呼叫子服務更新心跳資訊
     * @name FxDaemon#getInfo
     * @function getInfo
     * @param {Function} cb 回傳
     * @param {Object} data 資料
     * @public
     */
    getInfo(data, cb) {
        if (this._cpf && this._killed == false) {
            this._msgcb = cb;
            try {
                this._cpf.send({evt: 'processInfo','data': data});
            }
            catch (e) {
                NSLog.debug(`Send process info error killed=${this._killed}.`);
            }

        }else  {
            NSLog.log('info','getInfo: Process Is Dead.')
        }
    };
    postMessage(message, handle, options, cb) {
        const { creationComplete, _cpf, _killed } = this;
        if (creationComplete != 1) return false;

        if (_cpf && !_killed) {
            let timeout = (options && options.timeout) ? options.timeout : 5000;
            _cpf.send(message, handle, options, () => {
                if (cb) this.blocking.set(message.id, {cb, timeout: setTimeout(() => {
                        cb({event: false, error:'timeout'});
                        this.blocking.delete(message.id);
                    }, timeout)});
            });

        } else {
            NSLog.log("error", `Daemon ${this.name} child process has died.`)
        }
    }
    /**
     * Promise
     * @param message
     * @param message.id
     * @param handle
     * @param options
     * @return {Promise}
     */
    asyncPostMessage(message, handle, options) {
        return new Promise((resolve) => {
            if (!message.id) {
                reject("the 'id' does not exist.");
            } else {
                this.postMessage(message, handle, options, resolve);
            }
        })
    }
    /**
     * 刪除服務(不會停止心跳服務)
     * @name FxDaemon#quit
     * @function quit
     * @public
     */
    quit() {
        if (this._cpf) {
            // console.log('server-initiated unhappy termination.');
            this._killed = true;

            cp.exec(`kill -9 ${ this.pid }`);

            this._cpf = null;
            this._cpfpid = 0;
        } else {
            // console.log('child process is null.');
        }
    }
    /**
     * 停止服務
     * @name FxDaemon#stop
     * @function stop
     * @public
     */
    stop() {
        if (this._cpf) {
            let signalCode = this._cpf.signalCode;
            this._killed = true;
            try {
                if (!signalCode && signalCode == null) this._cpf.disconnect();
            } catch (e) {
                NSLog.log("error", e);
            }
            // SIGHUP(1), SIGINT(2), SIGQUIT(131), SIGTERM(14)
            this._cpf.kill('SIGTERM');
            this._cpf = null;
            this._cpfpid = 0;
        }
        return this;
    }
    /**
     * 重啟服務
     * @name FxDaemon#restart
     * @function restart
     * @public
     */
    restart() {
        NSLog.log("info", "Daemon restart:", this.name);
        if (this._cpf) {
            this.stopHeartbeat();
            this.stop();
        }
        setTimeout(() => {
            this.init();
            this.emitter.emit('status', 'Daemon init [' + this.name + ']');
            NSLog.log("warning", "restart init()", this._modulePath);
        },1000); // import need wait 1 sec
    };
    gracefulShutdown() {
        process.kill(this._cpfpid, 'SIGINT');
    };
    /**
     * 服務是否建立完成
     * @name FxDaemon#setMakeSureComplete
     * @function setMakeSureComplete
     * @param {Boolean|number} data
     * @public
     */
    setMakeSureComplete(data) {
        let value = 0;
        if (typeof data == "boolean") {
            value = (data ? 1 : 0);
        } else if (typeof data === "number") {
            value = data;
        }
        if (value == 1 && this.creationComplete != 1) {
            this.emit('up');
        }
        else if (this.creationComplete == 1 && value == 0) {
            this.emit('down');
        }
        this.creationComplete  = value;
        return value;
    };
    /**
     * 服務是否還活著
     * @name FxDaemon#isActive
     * @function isActive
     * @returns {boolean}
     * @public
     */
    isActive() {
        const { _cpf } = this;
        if (typeof _cpf == "undefined" || _cpf == null || _cpf == "") return false;
        return !(typeof _cpf.pid == "undefined" || _cpf.pid <= 0);
    }
    /**
     * @name FxDaemon#log
     * @function log
     * @public
     */
    log() {
        if (!this.saveFileLog) return;
        NSLog.log.apply(NSLog, arguments);
    }
    emit(event) {
        this.emitter.emit.apply(this.emitter, arguments);
    }
    on() {
        this.emitter.on.apply(this.emitter, arguments);
    }
    setup() {
    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = FxDaemon;