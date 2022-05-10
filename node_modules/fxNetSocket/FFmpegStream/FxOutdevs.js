/**
 * Created by Benson.Liao on 15/12/8.
 */
const debug = require('debug')('Outdevs');
const events = require('events');
const util = require('util');
const http = require('http');
const net = require('net');
const cp = require('child_process'),
    spawn = cp.spawn;
const frameMaximum = 10 * 1024 * 1024;
const updateTime = 1000; //FPS循環時間
//MaxDpbMbs 直接表示了對播放設備的解碼性能要求值越高，代表播放設備解碼性能要求越高，相對的輸出影片的壓縮率也越越高 level:v
var h264Level = {
    "l396":"1",
    "l396H":"1b",
    "l900":"1.1",
    "l2376L":"1.2",
    "l2376M":"1.3",
    "l2376H":"2",
    "l4752":"2.1",
    "l8100":"3",
    "l18000":"3.1",
    "l20480":"4",
    "l32768":"4.1",
    "l34816":"4.2",
    "l110400":"5",
    "l184320":"5.1",
    "l184320":"5.2"
}

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

// var logger = require('../lib/FxLogger.js');

util.inherits(FxOutdevs, events.EventEmitter);

function FxOutdevs(fileName, procfile, customParams) {

    /*** Arguments ***/
    this._fileName = fileName;

    this.running = false;

    this.ffmpeg = null;

    this.ffmpeg_pid = 0;

    this._encode = true;
    this._encodeStr = 'base64';

    this.STATUS = stdoutStatus.INIT;

    this.keyframe = 0;
    this.sliceType = "";
    // this.currFrameBuf = [];

    //FPS
    this.FPS = 0;
    this.frames = 0;
    this.getTickTime;
    this.lastTime;

    if (!procfile) {
        this._procfile = 'ffmpeg';
    }else
    {
        this._procfile = procfile;
    }

    /*** Initialize ***/

    events.EventEmitter.call(this);

    if (typeof customParams != "undefined" && typeof customParams.protocol == "string" && (customParams.protocol == "http" || customParams.protocol == "tcp")) {
        const self = this;
        const proto = customParams.protocol;
        let proxy;
        if (proto == "http")
            proxy = http.createServer(onHttpConnection).listen(onListening);
        else if (proto == "tcp")
            proxy = net.createServer(onConnection).listen(onListening);

        let maxChunk = 0; //拆包問題
        let pervLen  = 0; //前一包大小
        let prefix   = ""; //擋頭
        let segments = Buffer.from([]);
        function onHttpConnection(req, res) {
            req.on("data", function (chunk) {
                prefix = chunk.readUInt32BE(0);
                if (prefix == 0x000001) {
                    self.emit('streamData',(self._encode) ? segments.toString('base64') : segments);
                    segments = Buffer.from(chunk);
                } else {
                    segments = Buffer.concat([segments, chunk], segments.length + chunk.length);
                }
                pervLen = chunk.length;
            });
            req.on("end", function () {
                res.end();
            })
            proxy.close();
        }
        function onConnection(socket) {
            socket.on("data", function (chunk) {
                prefix = chunk.readUInt32BE(0);
                // console.log(prefix, pervLen, chunk.length, chunk.readUInt32BE(0));
                if (prefix == 0x000001) {
                    self.emit('streamData',(self._encode) ? segments.toString('base64') : segments);
                    segments = Buffer.from(chunk);
                } else {
                    segments = Buffer.concat([segments, chunk], segments.length + chunk.length);
                }
                pervLen = chunk.length;
            });
            socket.on("end", function () {
                socket.end();
            })
            proxy.close();
        }

        function onListening() {
            if (proto == "http")
                customParams.output = "http://127.0.0.1:" + proxy.address().port;
            else
                customParams.output = "tcp://127.0.0.1:" + proxy.address().port;
            console.log("listening", customParams.output);
            self.init(customParams);
        }
    } else {
        this.init(customParams);
    }

}

FxOutdevs.prototype.init = function (customParams) {
    try {
        var self = this;
        self.running = true;
        self.doDropPacket = false;
        //
        //var params = ["-y", "-re",
        //    "-i", _fileName,
        //    "-r", "30000/1001", "-max_delay", "100", "-b:a", "128k", "-bt", "10k",
        //    "-vcodec", "libx264", "-pass", "1", "-coder", "0", "-bf", "0",
        //    "-flags", "-loop", "-wpredp", "0", "-an",
        //    "-preset:v", "ultrafast", "-tune:v", "zerolatency", "-f", "h264", "pipe:1"];
        // -r set 10 fps for flv streaming source.
        // -- , "-pass", "1"
        // "-crf", "22" 視頻質量
        // , "-x264opts", "ref=1:bframes=2:frameref=1"
        // i,p,p..i 數量
        var fps = 10;
        var maxrate = "300k";
        var vcodec = "libx264";
        var output = "pipe:1";
        if (typeof customParams != 'undefined') {
            if (typeof customParams.fps === 'number') fps = customParams.fps;
            if (typeof customParams.maxrate === 'string') maxrate = customParams.maxrate;
            if (typeof customParams.vcodec === 'string') vcodec = customParams.vcodec;
            if (typeof customParams.encode === "boolean") self.setEncodeVideo("");
            if (typeof customParams.encode === "string") self.setEncodeVideo(customParams.encode);
            if (typeof customParams.output === "string" && customParams.output != "") output = customParams.output;
        }
        var params = ["-y", "-i", this._fileName, "-loglevel", avLog.quiet, "-r", fps,"-maxrate:v", maxrate, "-b:v", maxrate, "-b:a", "8k", "-g", "100", "-bt", "10k","-pass", "1", "-bufsize", "0k", "-vcodec", vcodec, "-coder", "0", "-bf", "0", "-timeout", "20000", "-flags", "-loop", "-wpredp", "0", "-an", "-preset:v", "ultrafast", "-tune", "zerolatency","-level:v", "5.2", "-f", "h264", output];
        var fmParams = " " + (params.toString()).replace(/[,]/g, " ");
        debug("ffmpeg " + fmParams);

        this.ffmpeg = spawn(self._procfile, params);
        this.ffmpeg_pid = this.ffmpeg.pid;
        //checkProccess(this.ffmpeg); //

        this.streamDelegate = this.ffmpeg.stdout;

        var stream_data = "";

        var streamDataHandler = function (chunk) {
            //debug("[OUTPUT] %d bytes", chunk.length);

            // console.log("this.keyframe : ",self.keyframe++);

            try {
                if (!(chunk && chunk.length)) {
                    throw new Error("[Error] - Data is NULL.");
                }
                self.running = true;
                self.STATUS = stdoutStatus.OPEN;
                // Confirm Buffer do reset
                if (stream_data == ""){
                    stream_data = Buffer.from(chunk);
                }
                else{
                    stream_data = Buffer.concat([stream_data, chunk]);
                }

                // CHECK stdout cmdline單列指令長度是否已經是8192(win平台不確定)
                if (chunk.length < 8192) {
                    //self.streamdata = stream_data.toString('base64');
                    //debug("[Total] %d bytes", stream_data.length);
                    self.emit('streamData',(self._encode) ? stream_data.toString('base64') : stream_data, {keyframe: self.keyframe, sliceType:self.sliceType});
                    // self.currFrameBuf.push(stream_data);
                    stream_data = ""; // reset stream
                    self.frames++;
                    this.doDropPacket = false; // drop large data!!!
                }else {
                    if ( frameMaximum < stream_data.length) {
                        // stream_data = 0;
                        this.doDropPacket = true; // drop large data!!!
                        console.error(new Date(), "stream data is large size.", frameMaximum, stream_data.length);
                        stream_data = 0;
                    }
                }

            }
            catch (e) {
                debug("Stream::", e);
                stream_data = "";
            }

        };

        var stderrDataHanlder = function (buf) {
            var str = String(buf);
            // debug('[INFO] stderr info::', str);
            var info = str.match(/(\b\w+)=\s{0,}([\w:./]+)/g);

            if (str.indexOf("Slice:I") != -1) self.sliceType = "I";
            if (str.indexOf("Slice:P") != -1) self.sliceType = "P";
            if (info) {
                // console.log(info[0].trim().split("="));

                var frameArr = info[0].trim().split("=");
                if (frameArr) {
                    if (frameArr[0] == "frame") {
                        self.keyframe = parseInt(frameArr[1].trim());
                        //console.log('frame:%d', self.keyframe);
                        // self.currFrameBuf = [];
                    }
                }
            }


            //  1. Network is unreachable
            //  2. Cannot open connection
        };

        var stdoutCloseHandler = function(code) {
            debug(self.name + ' you are terminated.');
            // logger.debug("[Close] close_event - Child process exited with code " + code);
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
            // logger.debug("[Exit] Exit_event - Child process exited ");


        };
        var readableHandler = function () {
            debug('[Debug] readable first stream in here.');
            // logger.debug("[readable] readable_evnt - readable first stream in here.");
        };

        var streamErrorHandler = function(err) {
            debug("[ERROR] Some stream error: ", err);
            // logger.debug("[streamError] Some stream error: " + err);
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
        // logger.debug("FxOutdevs Exception ERRORS: " + e);
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

FxOutdevs.prototype.setEncodeVideo = function (encode) {
    if (encode === 'base64') {
        this._encode = true;
        this._encodeStr = encode;
    } else if (encode === 'hex' || encode === 16) {
        this._encode = true;
        this._encodeStr = "hex";
    } else if (encode === '') {
        this._encode = false;
        this._encodeStr = "";
    }
};

FxOutdevs.prototype.setupFPS = function () {
    var self = this;
    this.getTickTime = new Date().getTime();
    this.lastTime = this.getTickTime;

    function fps_loop() {
        self.fpsObj = setTimeout(function () {
            self.getTickTime = new Date().getTime();
            if ( (self.getTickTime - self.lastTime) > updateTime) {
                self.FPS = (self.frames / (self.getTickTime - self.lastTime) * 1000);
                self.frames = 0;
                self.lastTime = this.getTickTime;
                console.log('+ FPS:%s', self.FPS);
            }

        }, 0);
    }


};
FxOutdevs.prototype.getFPS = function () {
    return this.FPS;
};
FxOutdevs.prototype.StopFPS = function () {
    clearTimeout(this.fpsObj);
};


/** 定期紀錄child process 狀態 太多會busy **/
function checkProccess(proc) {
    // logger.debug("[Debug] Child process ffmpeg '" + this._fileName + "' start.");
    // logger.pollingWithProcess(proc, this._fileName, 60000); // 1 min
};

module.exports = exports = FxOutdevs;

//var fx = new FxOutdevs("url");
//fx.on('streamData', function (base64) {
//    debug('Data Length', base64.length);
//});