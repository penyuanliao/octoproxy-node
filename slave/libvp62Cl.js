/**
 * Created by Benson.Liao on 16/3/9.
 */
/**
 * Created by Benson.Liao on 15/12/9.
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

const debug = require('debug')('rtmp:BridgeSrv');
debug.log = console.log.bind(console); //file log 需要下這行
const fxNetSocket = require('fxNetSocket');
const net = require('net');
const util = require('util');
const path = require('path');
const fs   = require('fs');
const FxConnection = fxNetSocket.netConnection;
const parser = fxNetSocket.parser;
const utilities = fxNetSocket.utilities;
const amfUtils = require('../fxNodeRtmp').amfUtils;
const libRtmp = require('../fxNodeRtmp').RTMP;
const log = require('../fxNodeRtmp').AMFLOG;
const isWorker = ('NODE_CDID' in process.env);
const events = require('events');
const isMaster = (isWorker === false);
const NSLog  = fxNetSocket.logger.getInstance();
NSLog.configure({logFileEnabled:false, consoleEnabled:true, level:'trace', dateFormat:'[yyyy-MM-dd hh:mm:ss]',filePath:"./", maximumFileSize: 1024 * 1024 * 100});

// util.inherits(libvp62Cl,fxNetSocket.clusterConstructor);
util.inherits(libvp62Cl, events.EventEmitter);

function libvp62Cl() {

    /* Variables */

    this.connections = []; //記錄連線物件

    /* rtmp config - Variables */
    this.rtmpConnectListener = true; //send request "connect" event to be received data.

    // this.init();

    this.config = process.env.streamConfig;

    this.config = {
        bFMSHost:'43.251.79.212',
        bFMSPort:1935,
        videoPaths:["video/daabb/video0"]
    };
    var videoPaths = this.config.videoPaths;
    
    for (var vPthNum = 0; vPthNum < videoPaths.length; vPthNum++ ) {
        this.setupFMSClient(videoPaths[vPthNum]);
        console.log('create stream');
    }

    this.fxFile = fs.createWriteStream('rtmpData.JSON',{ flags:'w' });

    this.flvHeader = true;

};

libvp62Cl.prototype.init = function () {
    this.initProcessEvent();
};

/**
 * 建立fms連線
 * @param client NetConnection自己封裝的Client
 */
libvp62Cl.prototype.setupFMSClient = function (namespace) {
    var _rtmp;
    var uri = {
        host:this.config.bFMSHost,
        port:this.config.bFMSPort,
        path:"rtmp://" + this.config.bFMSHost + ":" + this.config.bFMSPort + "/" + path.dirname(namespace),
        app:path.dirname(namespace),
        video:path.basename(namespace)
    };
    console.log(uri);
    //建立FMS連線
    _rtmp = this.connect(uri);

    _rtmp.name = namespace;
    //存在array裡面方便讀取
    if (!this.connections[namespace] || typeof this.connections[namespace] == 'undefined'
        || this.connections[namespace] == "" || this.connections[namespace] == null) {
        this.connections[namespace] = _rtmp;
    }else
    {
        debug("ERROR video of repeated impact to ", namespace);
    };
    this.rtmp = _rtmp;

};

/**
 * 連線到伺服器
 * @param uri obj{host,port}
 * @param socket 連線client socket
 * @returns {RTMPClient}
 */
libvp62Cl.prototype.connect = function (uri) {
    var self = this;
    var rtmp = undefined;
    // #1 建立連線
    console.log('.', uri.host, uri.port);
    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        debug("RTMPClient Connected!");

        if (self.rtmpConnectListener) {
            rtmp.isVideoStream = true;
            rtmp.connectResponse();
            rtmp.on('status',function (cmd) {
                if (cmd.name == "connect_result") {
                    streamPlay()
                }
            })
        }

        //LNX 11,7,700,203
        //MAC 10,0,32,18
        //MAC 11,8,800,94
        //WIN 17,0,0,160
        //#2-1 告訴FMS進行connect連線
        NSLog.log('debug','app:%s',uri.app);
        rtmp.sendInvoke('connect', 1, {
            app: uri.app, //app name
            flashVer: "WIN 17,0,0,160", //flash version
            tcUrl: uri.path, //rtmp path
            fpad: false, // unknown
            capabilities: 239, // unknown
            audioCodecs: 3575, // audio code
            videoCodecs: 252, // video code
            videoFunction: 1,
            objectEncoding: 0
        });

        //完成後就可以自己送出要的事件

        function streamPlay() {
            rtmp.netStreamConnect(uri.video); //ex: play('ddabb');
        }

    },true);
    rtmp.on(this.StreamEvent.META_DATA,function (obj) {
        self.emit(self.StreamEvent.META_DATA, obj);
    });

    // #2 接收FMS訊息
    rtmp.on('message', function (message) {
        //檢查FMS訊息Type = 20(0x14 invoke message structure)
        if (message.messageHeader.messageType == 20) {
            //message 裡有Data結構為{commandName:FMS回傳的名稱(String), transactionId:傳輸編號(int),arguments:FMS回傳的變數(Array)};
            var data = message.data;
            var cmd = data.commandName;
            var tranId = data.transactionId;
            var argument = data.arguments;
            debug('INFO :: cmd:%s, argument:%s', cmd, argument);
            //這邊暫時忽略_result訊息
            if (cmd == "chk") {
                debug('RTMP message event "chk":', message);

            } else if(cmd != '_result') {
                debug('RTMP message event "_result":', message);

            }else
            {
                debug('RTMP message event:', message);
            }
        };
    });


    var index = 0;
    var total = 0;
    var chunkIdx = 0;
    const RTMP_TYPE = {
        USER_CTRL_MSG:  0x04,
        AUDIO:          0x08,
        VIDEO:          0x09,
        AMF0_DATA:      0x12,
        METADATA:       0x18
    };
    const CONTROL_ID = {
        KEY_FRAME_ON2_VP6:     0x14,
        KEY_FRAME_H264:        0x17,
        INTER_FRAME_ON2_VP6:   0x24,
        INTER_FRAME_H264:      0x27,
        INFO_ON2_VP6:          0x54,
        HE_AAC:                0xaf
    };
    rtmp.nbufs = undefined;
    rtmp.videoStreamID = 0;

    const hdrSize = rtmp.BasicHeaderSize;

    rtmp.on('videoData', function (data) {
        chunkIdx++;
        // ------------------------------ //
        //        First One Packet        //
        // ------------------------------ //

        var fmt,csid;
        var timestamp, body_size, typeID, streamID, ctrl;
        var curr_nbufs, nbufs, subPackageCount;
        var offset = 0;
        var schunksize = rtmp.streamChunkSize;
        var packet;

        /* detect packet size */
        if (!rtmp.nbufs || rtmp.nbufs.length == 0)
            rtmp.nbufs = new Buffer(data);
        else
        {
            rtmp.nbufs = Buffer.concat([rtmp.nbufs, data], rtmp.nbufs.length + data.length);
        }

        var _count = 0;
        while (rtmp.nbufs.length > 0 && rtmp.nbufs.length > hdrSize[rtmp.nbufs[0] >> 6]) {

            _count++;


            var is_rtmp_type = rtmp.RTMP_ReadPacket(rtmp.nbufs);

            console.log("RTMP_ReadPacket - ",is_rtmp_type == 1);

            /////rtmp.streamChunkSize/////
            nbufs = rtmp.nbufs;
            // rtmp.RTMP_ReadPacket(rtmp.nbufs);
            offset = 0;
            fmt = nbufs.readUInt8(offset) >> 6;
            csid = nbufs.readUInt8(offset) & (0x3f); // (0)
            offset += 1;
            if (fmt == 0 || fmt == 1) {
                //timestamp 3 bytes;
                timestamp = nbufs.readUInt8(offset) << 16; // (1)
                timestamp += nbufs.readUInt8(offset+1) << 8; // (2)
                timestamp += nbufs.readUInt8(offset+2);      // (3)
                offset += 3;
                body_size = nbufs.readUInt8(offset) << 16; // (4)
                body_size += nbufs.readUInt8(offset+1) << 8; // (5)
                body_size += nbufs.readUInt8(offset+2);      // (6)
                offset += 3;
                typeID = nbufs.readUInt8(offset);          // (7)
                offset += 1;
                if (fmt == 0) {
                    streamID = nbufs.readUInt32LE(offset);     // (11)
                    offset+=4;
                }

                //計算分包數量
                subPackageCount = parseInt((body_size/schunksize));
                var end = ((body_size % schunksize == 0) ? 1 : 0);
                subPackageCount = subPackageCount - end;

                NSLog.log('debug','body_size(%s) > total(%s) [cur(%s), nbufs(%s)] end:%s', (body_size + hdrSize[fmt]) , rtmp.nbufs.length, data[0], nbufs[0], end);

                if ((body_size + hdrSize[fmt]) > rtmp.nbufs.length) {
                    NSLog.log("debug", "//// RTMPPacket_IsNotReady() ////");
                    NSLog.log('debug', "chunkIdx:%s,count:%s \nBodySize: %s", chunkIdx,_count, body_size)
                    return;
                }

                curr_nbufs = rtmp.nbufs.slice(0, hdrSize[fmt] + body_size + subPackageCount);
                var firstOnes = curr_nbufs[0].toString(16);
                NSLog.log('info','pre-nbufs:%s , curr_nbufs:%s', rtmp.nbufs.length, curr_nbufs.length);
                //移除資料
                rtmp.nbufs = rtmp.nbufs.slice((hdrSize[fmt] + body_size + subPackageCount), rtmp.nbufs.length);

                NSLog.log('info', "\n----------------\nchunkIdx:%s,count:%s\nBasicHeader:0x%s\nFmt:%s\nCSID: %s\nTimestamp: %s\nBodySize: %s\nTypeID:%s\nStreamID:%s\nctrl:%s\nnbufs:%s\n",
                    chunkIdx,_count,firstOnes, fmt, csid, timestamp, body_size, typeID, streamID, 0, rtmp.nbufs.length);
                if (rtmp.nbufs.length > 0) {
                    console.log('curr-least:0x%s', curr_nbufs[curr_nbufs.length-1].toString(16));
                    console.log('Next-basicHeader:0x%s', rtmp.nbufs[0].toString(16));
                    console.log('curr index of 0x00:%s', curr_nbufs.lastIndexOf(0x00));
                    console.log('index of 0x00:%s', rtmp.nbufs.indexOf(0x00),rtmp.nbufs[rtmp.nbufs.indexOf(0x00)+1]);
                    console.log('----------------');
                }
                /**/

                if (typeID == RTMP_TYPE.VIDEO) {
                    var videoData = curr_nbufs.slice(offset,curr_nbufs.length);
                    ctrl = videoData.readUInt8(0);

                    if (ctrl == CONTROL_ID.KEY_FRAME_ON2_VP6 || ctrl == CONTROL_ID.INTER_FRAME_ON2_VP6 || ctrl == CONTROL_ID.INFO_ON2_VP6) {

                        var filterC4Count = parseInt(videoData.length/schunksize);

                        // ** filter kill 0xC4 **
                        for (var i = 1; i <= filterC4Count; i++) {

                            var v = (i * schunksize);
                            var nlen = videoData.length;

                            videoData = Buffer.concat([videoData.slice(0,v), videoData.slice(v+1, nlen)], nlen-1);

                            // NSLog.log('trace', 'filter(%s):%s', v, videoData[v]);
                        }
                        NSLog.log('info', '|| ---------------------- write file start ------------------------ ||');
                        //http://albert-oma.blogspot.tw/2016/06/rtmp-spec.html
                        //http://blog.csdn.net/leixiaohua1020/article/details/17934487
                        var header;
                        if (self.flvHeader) {
                            header = new Buffer(24);
                            header.write("FLV",0);
                            header[13] = 0x09;
                            self.writeUInt24BE(header, body_size, 14);
                            header.writeUInt32BE(timestamp, 17);
                            self.writeUInt24BE(header, streamID, 21);

                        }else
                        {
                            header = new Buffer(11);
                            header[0] = 0x09;                          //(1)
                            self.writeUInt24BE(header, body_size, 1);  //(3)
                            header.writeUInt32BE(timestamp, 4);        //(4)
                            self.writeUInt24BE(header, streamID, 8);   //(3)
                        }

                        if(ctrl != CONTROL_ID.INFO_ON2_VP6) {
                            var curr = Buffer.concat([header,videoData.slice(0,videoData.length)], header.length + videoData.length);
                            self.flvHeader = false;
                            self.fxFile.write(curr);
                            NSLog.log('info','------- END -------', curr[curr.length]);
                            var vb= curr.toString('base64');
                            self.emit(self.StreamEvent.VIDEO_DATA, vb);
                        }

                        NSLog.log('trace', " Write size:%s(%s)",header.length + videoData.length -1,videoData.slice(1,videoData.length).length);
                        // NSLog.log('info', '|| -------------------- write file end -------------------------- ||');
                        // NSLog.log('trace', 'rm chunk size(1):', parseInt(videoData.length/schunksize), subPackageCount);
                        // NSLog.log('trace', 'video size:%s', videoData[0].toString(16),videoData[1].toString(16));
                        // NSLog.log('trace', 'video Data Length:', videoData.length);
                        NSLog.log('trace', 'ctrl:K-frame(%s) I-frame(%s) Info(%s)', ctrl == CONTROL_ID.KEY_FRAME_ON2_VP6, ctrl == CONTROL_ID.INTER_FRAME_ON2_VP6, ctrl == CONTROL_ID.INFO_ON2_VP6);
                    }

                    if (ctrl == CONTROL_ID.KEY_FRAME_H264 || ctrl == CONTROL_ID.INTER_FRAME_H264) {
                        NSLog.log("warning", "H264 Not support !!");
                    }

                }
                else if (typeID == RTMP_TYPE.AUDIO) {
                    ctrl = nbufs.readUInt8(offset);
                    NSLog.log('warning','The audio stream Not support output!!');}
                else if (typeID == RTMP_TYPE.METADATA){
                    NSLog.log('info', '----- Metadata -----');
                }
                else if (typeID == RTMP_TYPE.AMF0_DATA){
                    NSLog.log('info', '----- AMF0_DATA (0x12), %s bytes, %s total -----', (hdrSize[fmt] + body_size), rtmp.nbufs.length);

                    NSLog.log('info', '----- %s -----', rtmp.nbufs.length);

                }
                else if (typeID == RTMP_TYPE.USER_CTRL_MSG){
                    NSLog.log('info', '----- User Control Message (0x02), %s bytes -----',(hdrSize[fmt] + body_size));

                    var num = curr_nbufs.readInt32BE(14);
                    
                    console.log(curr_nbufs);

                    rtmp.pingResponse(num);

                }
                else {

                    var chks = rtmp.nbufs.slice(0,12);
                    console.log(chks);
                    console.log('ERROR !!!!!!!!!!!!!!! ERROR');

                }



            }else if (fmt == 2 || fmt == 3){

                /* extended header : 0xC4 */

                if (rtmp.nbufs[0] == 0xC4) {
                    NSLog.log('verbose','');
                    NSLog.log('verbose',"0xC4 extended header (%s timestamp:)", rtmp.nbufs[hdrSize[fmt]] >> 6, data.length-1);
                    // log.logHex(rtmp.nbufs);
                    rtmp.nbufs = rtmp.nbufs.slice(rtmp.nbufs.length, rtmp.nbufs.length);
                    return;
                }
                if (rtmp.nbufs[0] == 0xC2) {
                    NSLog.log('verbose',"0xC2 one size. ");
                    log.logHex(rtmp.nbufs);
                }
                
                //unkown header
                // curr_nbufs = rtmp.nbufs.slice(1, preBasicHeader.bodySize + slice);

                NSLog.log('verbose',"Format(%s) nbufs size : %s",rtmp.nbufs[0].toString(16),rtmp.nbufs.length );
                NSLog.log('trace', '---------------------------------');
                NSLog.log('debug', fmt, csid);
                // NSLog.log('debug', "Next Packet:*%s %s", curr_nbufs[hdrSize[fmt]], hdrSize[fmt]+1);
                NSLog.log('debug', "hex:", rtmp.nbufs.slice(0,16));
                NSLog.log('debug', "nbufs.length:", rtmp.nbufs.length);
                NSLog.log('debug', "indexof :", rtmp.nbufs.indexOf(0x00), rtmp.nbufs[rtmp.nbufs.indexOf(0x00)+1]);
                NSLog.log('debug', "basic header:%s, current:%s", rtmp.nbufs[0],data[0]);
                NSLog.log('trace', '---------------------------------');
                if (rtmp.nbufs.indexOf(0x00) == -1) {
                    rtmp.nbufs = undefined;
                    return;
                }
                rtmp.nbufs = rtmp.nbufs.slice(rtmp.nbufs.indexOf(0x00)+1, rtmp.nbufs.length);
                // rtmp.nbufs = rtmp.nbufs.slice((hdrSize[fmt] + preBasicHeader.bodySize), rtmp.nbufs.length);
            }
        }



return;

        if(isWorker) process.send({"evt":"videoData","namespace": rtmp.name, "data" : data});
    });

    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        console.log("RTMP ERROR", args);
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function (args) {
        console.log("RTMP connection closed");
    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        var header_size = chunk.readUInt8(0);
        
        // console.log('header_size:%d, number:%d', header_size, chunk.readInt32BE(14));

        if (chunk[0] == 0x02 && chunk.byteLength == 18) {
            console.log(chunk);
            var num = chunk.readInt32BE(14);
            rtmp.pingResponse(num);

        }
    });

    return rtmp;
};
/** cluster parent send message event **/
libvp62Cl.prototype.onMessage = function (data) {
    // libvp62Cl.super_.prototype.onMessage(data).apply(this,[data]);
    var self = this;
    var json = data;
    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if (data.evt == "c_init") {

            debug("Conversion Socket.Hanlde from Child Process.");

            var socket = new net.Socket({
                handle:handle,
                allowHalfOpen:srv.app.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = srv.app;
            self.srv.app.emit("connection", socket);
            socket.emit("connect");
            socket.emit('data',new Buffer(data.data));
            socket.resume();
            return;
        }else if(data.evt == "processInfo") {

            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": Object.keys(this.connections).length}})
        }else{
            debug('out of hand. dismiss message');
        };

    };

};

const RTMP_PACKET_TYPE = {
    CHUNK_SIZE:      1,
    PING:            4,
    AUDIO:           8,
    VIDEO:           9,
    METADATA:       22
};


libvp62Cl.prototype.sliceData = function (data) {
    //TODO 1.合併資料

    //TODO 2.檢查basicHeader

    //TODO 2.1 檢查 StreamID 4 ?!


};
libvp62Cl.prototype.writeUInt24BE = function(buffer,value, offset) {
    buffer[offset + 2] = value & 0xff;
    buffer[offset + 1] = value >> 8;
    buffer[offset] = value >> 16;
};

libvp62Cl.prototype.StreamEvent = {
    "META_DATA":    "onMetaData",
    "VIDEO_DATA":   "onVideoData",
    "AUDIO_DATA":   "onAudioData",
    "CHUNK_SIZE":   "onSetChunkSize",
    "BANDWIDTH" :   "onBandwidth",
    "SAMPLE_ACCESS":"onSampleAccess",
    "GET_FPS":      "onGetFPS",
    "STATUS":       "onStatus"
};

module.exports = exports = libvp62Cl;

if (process.env.test)
var service = new libvp62Cl();

setInterval(function () {

},5000);