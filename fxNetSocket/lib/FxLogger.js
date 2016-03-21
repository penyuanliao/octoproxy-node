/**
 * Created by Benson.Liao on 15/12/21.
 */
var debug = require('debug')('Logger');
var fs = require('fs'),
    util = require('util'),
    exec = require('child_process'),
    log_file;
var logger =  function logger() {
    /* Variables */
    /* Codes */
};

logger.prototype.debug = function (d) {
    var time = new Date();
    var st = "[" + time.getFullYear() + "/" + (time.getMonth() + 1) + "/" + time.getDate() + " " + time.getHours() + ":" + time.getMinutes() + "]";
    if (typeof log_file === 'undefined') log_file = fs.createWriteStream(__dirname + '/'+ formatDate() +'.log',{ flags:'w' });
    log_file.write(st + util.format(d) + '\r\n'); // win:\r\n linux:\n mac:\r
    //debug(st, util.format(d));
};
/**
 * polling set timer run child process state.
 * @param proc : child_process
 * @param name : link name
 * @param delay : delay
 */
logger.prototype.pollingWithProcess = function(proc, name, delay) {
    var keepWatch = setInterval(function () {
        if (proc.running == false && proc.STATUS >= 2) {
            setTimeout(function () {
                clearInterval(keepWatch);
            },delay*2);
        }
        exec.exec('ps -p ' + proc.pid + ' -o rss,pmem,pcpu,vsize,time',function (err, stdout, stderr) {
            err = err || stderr;
            if (!err) {
                logger.instance.debug('[SYSINFO] ffmpeg'+ name + '\r\n' + stdout.toString());
                logger.instance.debug('[Nodejs]process.memoryUsage: rss=' + process.memoryUsage().rss + ", heapTotal=" + process.memoryUsage().heapTotal + ", heapUsed=" + process.memoryUsage().heapUsed);
            };
        });
        /** 檢查各種狀態 **/
        if (typeof proc != 'undefined' && (proc !== null) && proc !== "") {

            if (parseInt(proc.exitCode) === 255) {
                debug("[Polling-255] ffmpeg " + name + " process to Shutdown. (use kill -15 PID) -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);
                logger.instance.debug("[Polling] ffmpeg " + name + " process to Shutdown. (use kill -15 PID) -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);
            }else if (proc.signalCode === "SIGKILL") {
                debug("[Polling-sigkill] ffmpeg " + name + " process to Shutdown. (use kill -9 PID) -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);
                logger.instance.debug("[Polling-sigkill] ffmpeg " + name + " process to Shutdown. (use kill -9 PID) -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);
            }
            else if (parseInt(proc.exitCode) === 0) {
                    debug("[Polling-0] ffmpeg " + name + " process to Shutdown. (use kill -9 PID) -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);
                    logger.instance.debug("[Polling-0] ffmpeg " + name + " process to Shutdown. (use kill -9 PID) -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);

            }else {
                debug("[Polling-log] ffmpeg " + name + " process to Working." + " -proc.exitCode=" + proc.exitCode + " -proc.killed=" + proc.killed + " -proc.signalCode=" + proc.signalCode);
            }

        }
        else{
            logger.instance.debug("[Polling] ffmpeg " + name + " process is NULL.");
        }


    },delay);
};

function formatDate() {
    var date = new Date();
    return (date.getFullYear() + '_' + (date.getMonth() + 1) + '_' + date.getDate());
};
/** ping once ipAddress confirm network has connection. **/
logger.prototype.reachabilityWithHostName = function (name) {

    var args = name.toString().split(":");

    var nc = exec.exec("nc -vz " + args[0] + " " + args[1], function (err, stdout, stderr) {
       err = err || stderr;

        debug(new Date(),"to ",name,":",stdout.toString().search("succeeded!"));
        logger.instance.debug("reachability:" + stdout);
    });
};
/**
 * 統計pid記憶體使用量
 * @param PIDs
 */
logger.prototype.logTotalMemoryUsage = function (PIDs) {
    exec.exec("ps -p " + PIDs + " -o pcpu,pmem,vsz,rss | awk '{pcpu += $1; pmem += $2; vsz += $3; rss += $4;} END { print pcpu, pmem, vsz, rss }'", function (err, stdout, stderr) {
        err = err || stderr;
        if (!err) {
            var args = stdout.toString().split(" ");
            debug(new Date(),">> Total Memory %CPU=" + args[0] + ",%MEM=" + args[1] + ",VSZ=" + args[2] + ",RSS=" + args[3]);
        }
    });
};
/**
 * is Dead or Alive
 * @param pid
 * @param callback
 */
logger.prototype.procState = function (pid, callback) {
    exec.exec("ps -p " + pid + " -o pid | awk '{pid += $1;} END {print pid}'", function (err, stdout, stderr) {
        err = err || stderr;
        if (!err) {
            callback((pid === stdout))
        }
    });
};


/* ************************************************************************
                    SINGLETON CLASS DEFINITION
 ************************************************************************ */

logger.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
logger.getInstance = function () {
  if(this.instance === null) {
      this.instance = new logger();
  }
  return this.instance;
};
module.exports = exports = logger.getInstance();