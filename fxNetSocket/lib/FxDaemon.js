/**
 * Created by Benson.Liao on 16/2/16.
 */
const util = require('util');
const cp = require('child_process');
const dlog = require('debug');
const debug = dlog('daemon');
const error = dlog('error');
const wait_times = 15000;
const doWait_maximum = 3;
const heart_times = 5000;
const restart = false;
const retry = {"limit":0, "timeout":1000};

/***
 * HEART BEAT Module
 * @param modulePath
 * @constructor
 */
function Fxdaemon(modulePath/*, args, options*/) {
    var options, args;
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

    this._modulePath = modulePath;
    this._options = options;
    this._args = args;
    this._cpf = null;
    this._cpfpid = 0;
    this._heartbeat = 0;
    this._killed = false;
    this._heartbeatEnabled = options.heartbeatEnabled ? options.heartbeatEnabled : true;
};

Fxdaemon.prototype = {
    init: function () {
        debug('daemon initialize');

        if (this._cpf) return;

        var cp_retry = retry.limit;
        var start = new Date().getTime();

        var context = this;

        context._killed = false;

        (function run() {
            debug('process start %s (%d)', context._modulePath, context._cpfpid);
            if (typeof context._modulePath === 'undefined' || context._modulePath === null || context._modulePath === "") return;

            context._cpf = cp.fork(context._modulePath, context._args, context._options);
            context._cpfpid = context._cpf.pid;
            context._cpf.on('exit', function (code) {
                debug('child process exit');
                if (context._killed) return;

                if (!restart) return;

                if (cp_retry > 0) {
                    var end = new Date().getTime();
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
            context._cpf.on("message", function (message) {

                message = (typeof message === "string") ? JSON.parse(message) : message;

                if (typeof message != "object") return;

                if (message.evt === "processInfo") {
                    context._msgcb ? context._msgcb(message.data):false;

                };

            });

        })();
        //啟動心跳檢查機制
        if(context._heartbeatEnabled) context.startHeartbeat();
    },
    
    startHeartbeat: function () {

        var daemon = this;

        var times = 0;

        function lookoutdaemon() {

            var out = setTimeout(function () {
                times++;
                out = 0;
                debug("miss",times ,">", doWait_maximum)
                if (times > doWait_maximum) {
                    //todo remove and restart

                    times = 0;
                    daemon.stopHeartbeat();
                    daemon.quit();

                    setTimeout(function () {
                        daemon.init();
                    },1000);

                }
            }, wait_times);

            daemon.getInfo(function (data) {
                if (out != 0) {
                    clearTimeout(out);
                    out = 0;
                };
                times = 0;
            }, times > 0 ? "retry=" + times : "retry=0");

        }
        debug('start lookout daemon.');
        daemon._heartbeat = setInterval(lookoutdaemon, heart_times);

    },
    stopHeartbeat: function () {
        debug('stop lookout daemon.');
        var daemon = this;
        daemon._heartbeat = clearInterval(daemon._heartbeat);
    },

    sendHandle: function (data, handle, cb) {
        if (this._cpf) {

            this._handlecb = cb;

            try {
                this._cpf.send({'evt':'onconnection',data:data}, handle,[{ track: false, process: false }]);
            }
            catch (e) {
                error('send socket handle error.');
            }

        }else{
            error('child process is NULL.');
        };
    },
    send: function (message, handle) {
        if (this._cpf) {

            try {

                if (handle) {
                    this._cpf.send(message, handle,[{ track: false, process: false }]);
                }else
                {
                    this._cpf.send(message);
                }

            }
            catch (e) {
                error(e);
            }

        }else{
            error('child process is NULL.');
        };
    },
    sendStream: function (data) {
        if (this._cpf) {
            try {
                if (typeof data != 'string') {
                    msg = JSON.stringify(data);
                }
                this._cpf.send({'evt':'streamData','data':data});
            }
            catch (e) {
                debug('send process info error.');
            }

        }else {
            error('child process is NULL.');
        };
    },
    getInfo: function (cb, data) {

        if (this._cpf) {
            this._msgcb = cb;
            try {
                if (typeof data != 'string') {
                    data = JSON.stringify(data);
                }
                this._cpf.send({'evt':'processInfo','data':data});
            }
            catch (e) {
                debug('send process info error.');
            }

        };
    }, // getInfo code ended

    quit: function () {
        if (this._cpf) {
            debug('server-initiated unhappy termination.');
            this._killed = true;

            cp.exec("kill - 9 " + this._cpfpid);

            this._cpf = null;
            this._cpfpid = 0;
        }else {
            error('child process is null.');
        };

    }, // quit ended
    stop: function () {
        if (this._cpf) {
            var demaon = this;
            daemon._killed = true;
            daemon._cpf.disconnect();
            demaon._cpf.kill('SIGQUIT');
            demaon._cpf = null;
            demaon._cpfpid = 0;

            debug("daemon stop.");
        };
    }

};

module.exports = exports = Fxdaemon;

/*
const cfg = require('./../../config.js');
var opts = cfg.forkOptions;
var env = process.env;
env.NODE_CDID = 0;
console.log(opts.cluster);
var daemon = new Fxdaemon(opts.cluster,{silent:false}, {env:env});
daemon.init();
daemon.sendStream();
*/