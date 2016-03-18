/**
 * Created by Benson.Liao on 15/12/8.
 */
var debug = require('debug')('Outdevs');
var events = require('events');
var util = require('util');
var _fileName,
    cp = require('child_process'),
    spawn = cp.spawn;

var avLog = {
    "quiet"  : -8,
    "panic"  :  0,
    "fatal"  :  8,
    "error"  : 16,
    "warning": 24,
    "info"   : 32,
    "verbose": 40,
    "debug"  : 48,
    "trace"  : 56
};

const stdoutStatus = {
    'INIT':  0,
    'OPEN':  1,
    'CLOSE': 2,
    'ERROR': 3
};

var logger = require('../lib/FxLogger.js');

util.inherits(FxOutdevs, events.EventEmitter);

function FxOutdevs(fileName, procfile) {

    /*** Arguments ***/
    _fileName = fileName;

    this.running = false;

    this.ffmpeg = null;

    this.ffmpeg_pid = 0;

    this.STATUS = stdoutStatus.INIT;

    if (!procfile) {
        this._procfile = 'ffmpeg';
    }

    /*** Initialize ***/

    events.EventEmitter.call(this);

    this.init();

}

FxOutdevs.prototype.init = function () {
    try {
        var self = this;
        self.running = true;
        //
        //var params = ["-y", "-re",
        //    "-i", _fileName,
        //    "-r", "30000/1001", "-max_delay", "100", "-b:a", "128k", "-bt", "10k",
        //    "-vcodec", "libx264", "-pass", "1", "-coder", "0", "-bf", "0",
        //    "-flags", "-loop", "-wpredp", "0", "-an",
        //    "-preset:v", "ultrafast", "-tune:v", "zerolatency", "-f", "h264", "pipe:1"];
        // -r set 10 fps for flv streaming source.
        // -- , "-pass", "1"
        var params = ["-y", "-i", _fileName, "-loglevel", avLog.quiet, "-r", "10", "-b:v", "300k", "-b:a", "8k", "-bt", "10k","-pass", "1", "-vcodec", "libx264", "-coder", "0", "-bf", "0", "-timeout", "1", "-flags", "-loop", "-wpredp", "0", "-an", "-preset:v", "ultrafast", "-tune", "zerolatency","-level:v", "5.2", "-f", "h264", "pipe:1"];
        var fmParams = " " + (params.toString()).replace(/[,]/g, " ");
        debug("ffmpeg " + fmParams);

        this.ffmpeg = spawn(self._procfile, params);
        this.ffmpeg_pid = this.ffmpeg.pid;
        //checkProccess(this.ffmpeg); //

        this.streamDelegate = this.ffmpeg.stdout;

        var stream_data = "";

        var streamDataHandler = function (chunk) {
            //debug("[OUTPUT] %d bytes", chunk.length);
            try {
                if (!(chunk && chunk.length)) {
                    throw new Error("[Error] - Data is NULL.");
                }
                self.running = true;
                self.STATUS = stdoutStatus.OPEN;
                // Confirm Buffer do reset
                if (stream_data == "")
                    stream_data = new Buffer(chunk);
                else
                    stream_data = Buffer.concat([stream_data, chunk]);
                // CHECK stdout cmdline單列指令長度是否已經是8192(win平台不確定)
                if (chunk.length < 8192) {
                    //self.streamdata = stream_data.toString('base64');
                    //debug("[Total] %d bytes", stream_data.length);
                    self.emit('streamData',stream_data.toString('base64'));
                    stream_data.writeUIntLE(0, 0, stream_data.length);
                    stream_data = ""; // reset stream
                }else {

                }
            }
            catch (e) {
                debug("Stream::", e);
            }

        };

        var stderrDataHanlder = function (buf) {
            var str = String(buf);
            debug('[INFO] stderr info::', str);
            //  1. Network is unreachable
            //  2. Cannot open connection
        };

        var stdoutCloseHandler = function(code) {
            debug(self.name + ' you are terminated.');
            logger.debug("[Close] close_event - Child process exited with code " + code);
            self.running = false;
            self.STATUS = stdoutStatus.CLOSE;
            self.emit('close', code);
            //remove event
            self.streamDelegate.removeListener("data", streamDataHandler);
            self.ffmpeg.stderr.removeListener("data", stderrDataHanlder);
            self.ffmpeg.removeListener("close", stdoutCloseHandler);
            self.ffmpeg.removeListener("exit",stdoutExitHandler);
            self.streamDelegate.removeListener("readable", readableHandler);
            self.streamDelegate.removeListener("error", streamErrorHandler);
            self.release();
        };
        var stdoutExitHandler = function() {
            debug('[Debug] Hasta la vista, baby!');
            self.running = false;
            self.emit('exit');
            logger.debug("[Exit] Exit_event - Child process exited ");


        };
        var readableHandler = function () {
            debug('[Debug] readable first stream in here.');
            logger.debug("[readable] readable_evnt - readable first stream in here.");
        };

        var streamErrorHandler = function(err) {
            debug("[ERROR] Some stream error: ", err);
            logger.debug("[streamError] Some stream error: " + err);
            self.running = false;
            self.STATUS = stdoutStatus.ERROR;
            self.emit('error');
        };

        this.streamDelegate.on("data", streamDataHandler); // Standard Output 標準輸出串流(輸出cli視窗)
        /* 接收事件 不建立這個事件會卡住...雷 */
        this.ffmpeg.stderr.on("data", stderrDataHanlder); // Standard Error 標準錯誤輸出串流(輸出cli視窗)

        this.ffmpeg.on("close", stdoutCloseHandler); //

        this.ffmpeg.on("exit",stdoutExitHandler); //

        this.streamDelegate.on("readable", readableHandler);

        this.streamDelegate.on("error", streamErrorHandler);

    }
    catch (e) {
        debug('[ERROR]createServer::', e);
        logger.debug("FxOutdevs Exception ERRORS: " + e);
    }
};

FxOutdevs.prototype.quit = function () {
    if (this.ffmpeg) {
        debug('ffmpeg maybe termination.');
        this.running = false;
        cp.exec("kill -9 " + this.ffmpeg_pid);

        this.release();

    }
};
FxOutdevs.prototype.release = function () {
    this.ffmpeg = null;
    this.ffmpeg_pid = 0;
    this.streamDelegate = null;
};

/** destroy ffmpeg stream **/
FxOutdevs.prototype.disconnect = function () {

    if (this.ffmpeg != null && typeof this.ffmpeg != 'undefined') {
        this.ffmpeg.disconnect();
        this.ffmpeg.kill('SIGINT');
        this.ffmpeg = null;
    }

};
/** ffmpeg command line then pipe the STDOUT stream to the NodJS. The data to encode BASE64 string then send it.  **/
FxOutdevs.prototype.streamByReadBase64 = function (callback) {
    this.on("streamData", callback);
};
/** ffmpeg command line then pipe. use stream.pipe to send incoming to a your stream object. **/
FxOutdevs.prototype.streamPipe = function (dest) {
  this.ffmpeg.pipe(dest);
};

/** 定期紀錄child process 狀態 太多會busy **/
function checkProccess(proc) {
    logger.debug("[Debug] Child process ffmpeg '" + _fileName + "' start.");
    logger.pollingWithProcess(proc,_fileName, 60000); // 1 min
};

module.exports = exports = FxOutdevs;

//var fx = new FxOutdevs("url");
//fx.on('streamData', function (base64) {
//    debug('Data Length', base64.length);
//});