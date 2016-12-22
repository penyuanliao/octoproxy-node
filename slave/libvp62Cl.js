/**
 * Created by Benson.Liao on 16/3/9.
 */
/**
 * Created by Benson.Liao on 15/12/9.
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

const debug         = require('debug')('rtmp:BridgeSrv');
debug.log           = console.log.bind(console); //file log 需要下這行
const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const util          = require('util');
const path          = require('path');
const fs            = require('fs');
const libRtmp       = require('../fxNodeRtmp').RTMP;
const amfUtils      = require('../fxNodeRtmp').amfUtils;
const log           = require('../fxNodeRtmp').AMFLOG;
const isWorker      = ('NODE_CDID' in process.env);
const events        = require('events');
const isMaster      = (isWorker === false);
const cdid          = process.env.NODE_CDID || 0;
const NSLog         = fxNetSocket.logger.getInstance();
if (isMaster)
    NSLog.configure({logFileEnabled:false, consoleEnabled:true, level:'trace', dateFormat:'[yyyy-MM-dd hh:mm:ss]',filePath:"./",fileName:'libvp62_ID' + cdid, maximumFileSize: 1024 * 1024 * 100});

const MUXER_NONE    = "none";
const MUXER_FLV     = "flv";
const MUXER_AVC     = "avc1";

const DEF_OPTIONS     = {
    bFMSHost:'127.0.0.1',
    bFMSPort:1935,
    videoPaths:"/video/stream/live"
};

util.inherits(libvp62Cl, events.EventEmitter);

function libvp62Cl(options) {

    events.EventEmitter.call(this);
    /* Variables */

    options = (typeof options == "undefined") ? DEF_OPTIONS : options;

    this.config  = options;

    //noinspection JSUnresolvedVariable
    this.uptime        = new Date().getTime();

    this.flvHeader     = true; // once flv Header

    this.AVC_HEADER    = new Buffer([0,0,0,1]);
    this._muxer        = MUXER_AVC;
    this._videocodecid = "VP62";



    var path = this.config.videoPaths;
    if (path.substr(0,1) == "/") path = path.substr(1, path.length);
    NSLog.log("trace",'** RTMP stream client has been created. **');
    this.setupFMSClient(path);

    this.flag_write_enabled = false;
    if (this.flag_write_enabled) this.fxFile = fs.createWriteStream('rtmpData.JSON',{ flags:'w' });

    this.lastUpdateTime = undefined;

}

libvp62Cl.prototype.init = function () {
    this.initProcessEvent();
};

/**
 * 建立fms連線
 * @param namespace {string} NetConnection自己封裝的Client
 */
libvp62Cl.prototype.setupFMSClient = function (namespace) {
    var _rtmp;
    var uri = "rtmp://" + this.config.bFMSHost + ":" + this.config.bFMSPort + "/" + namespace;
    NSLog.log('info', 'setupFMSClient:%s', uri);
    //建立FMS連線
    _rtmp = this.connect(uri);

    _rtmp.name = namespace;
    this.rtmp = _rtmp;
    var self = this;

};
/**
 * 連線到伺服器
 * @param uri {object}
 * @returns {RTMPClient}
 */
libvp62Cl.prototype.connect = function (uri) {
    var self = this;
    var rtmp = undefined;
    NSLog.log('trace', "** Start IP address: %s **", uri);
    // #1 建立連線
    rtmp = libRtmp.RTMPClient.createRTMPNetStream(uri);
    // #2 接收FMS訊息
    rtmp.on('message', function (message) {
        //檢查FMS訊息Type = 20(0x14 invoke message structure)
        if (message.messageHeader.messageType == 20) {
            //message 裡有Data結構為{commandName:FMS回傳的名稱(String), transactionId:傳輸編號(int),arguments:FMS回傳的變數(Array)};
            var data = message.data;
            var cmd = data.commandName;
            var tranId = data.transactionId;
            var argument = data.arguments;
            debug('INFO :: cmd:%s, argument:%s tranID:%s', cmd, argument, tranId);
            //這邊暫時忽略_result訊息
            if (cmd == "chk") {
                debug('RTMP message event "chk":', message);

            } else if(cmd != '_result') {
                debug('RTMP message event "_result":', message);

            }else
            {
                debug('RTMP message event:', message);
            }
        }
    });

    const hdrSize = rtmp.BasicHeaderSize;
    var total = 0;
    var chunkIdx = 0;

    rtmp.nbufs = undefined;
    rtmp.videoStreamID = 0; // csid
    rtmp.previousHeader = {bodySize:0, typeID:undefined, headerBuffer:undefined};
    var audioSize = 0;
    var invokeSize = 0;


    rtmp.on('videoData', function (data) {
        chunkIdx++;
        // ------------------------------ //
        //        First One Packet        //
        // ------------------------------ //

        var fmt, csid;
        var timestamp, body_size, typeID, streamID, ctrl;
        var curr_nbufs, nbufs, subPackageCount; // filter 0xC4 count
        var offset = 0;
        var sChunksize = rtmp.getRTMPChunkSize;
        // var filterResults;// 過濾結果資料
        var fileHeader;
        var filterC4Count;
        var lastOutput;
        /** 合併Packet **/
        self.concatData(rtmp, data);

        var _count = 0;
        /** (2) read_packet **/
        while (rtmp.nbufs.length > 0 && rtmp.nbufs.length > hdrSize[rtmp.nbufs[0] >> 6]) {

            _count++;

            nbufs = rtmp.nbufs;
            offset = 0;
            fmt = nbufs.readUInt8(offset) >> 6;
            csid = nbufs.readUInt8(offset) & (0x3f);         // (0)
            offset += 1;
            if (fmt == 0 || fmt == 1) {
                //timestamp 3 bytes;
                timestamp = nbufs.readUInt8(offset) << 16;   // (1)
                timestamp += nbufs.readUInt8(offset+1) << 8; // (2)
                timestamp += nbufs.readUInt8(offset+2);      // (3)
                offset += 3;
                body_size = nbufs.readUInt8(offset) << 16;   // (4)
                body_size += nbufs.readUInt8(offset+1) << 8; // (5)
                body_size += nbufs.readUInt8(offset+2);      // (6)
                offset += 3;
                typeID = nbufs.readUInt8(offset);            // (7)
                offset += 1;
                if (fmt == 0) {
                    streamID = nbufs.readUInt32LE(offset);   // (11)
                    offset += 4;
                }else {
                    streamID = 1;
                }

                //計算分包數量 // 0xC4 = 0xC0 + CSID(4)
                subPackageCount = parseInt((body_size/sChunksize));
                var end = ((body_size % sChunksize == 0 && body_size > 0) ? 1 : 0);
                subPackageCount = subPackageCount - end;

                NSLog.log('debug','PacketSize(%s) > total(%s) [cur(%s), nbufs(%s)] end:%s', (body_size + hdrSize[fmt] + subPackageCount) , rtmp.nbufs.length, data[0], nbufs[0], subPackageCount);

                if ((body_size + hdrSize[fmt] + subPackageCount) > rtmp.nbufs.length || csid > 4) {
                    NSLog.log("debug", "# ----- RTMPPacket_IsNotReady() ----- #");
                    NSLog.log('debug', "ChunkCount[%s], BodySize[%s]", chunkIdx, body_size);
                    return;
                }

                curr_nbufs = rtmp.nbufs.slice(0, hdrSize[fmt] + body_size + subPackageCount);

                NSLog.log('info','Do buf.slice > onBuffer:%s , onData:%s', rtmp.nbufs.length, curr_nbufs.length);
                //移除資料
                rtmp.nbufs = rtmp.nbufs.slice((hdrSize[fmt] + body_size + subPackageCount), rtmp.nbufs.length);

                NSLog.log('info', "\n----------------\nchunkIdx:%s,count:%s\nBasicHeader:0x%s[ Fmt:%s CSID: %s ]\nTimestamp: %s\nBodySize: %s\nTypeID:%s\nStreamID:%s\nLastBuf:%s\n----------------",
                    chunkIdx,_count,curr_nbufs[0].toString(16), fmt, csid, timestamp, body_size, typeID, streamID, rtmp.nbufs.length);
                if (rtmp.nbufs.length > 0) {
                    NSLog.log('info','## Next Packet Header:0x%s ##', rtmp.nbufs[0].toString(16));
                    if (rtmp.nbufs[0] == 0xC4 && rtmp.nbufs[1] == 0x44 && body_size == 0) curr_nbufs = rtmp.nbufs.slice(1, rtmp.nbufs.length);
                }
                if (typeID == rtmp.PacketType.PACKET_TYPE_VIDEO) {
                    self.setPreviousHeader(body_size, typeID, curr_nbufs.slice(0, offset)); // make previous header
                    var videoData = curr_nbufs.slice(offset,curr_nbufs.length);
                    ctrl = videoData.readUInt8(0);

                    if (ctrl == rtmp.CONTROL_ID.KEY_FRAME_ON2_VP6 || ctrl == rtmp.CONTROL_ID.INTER_FRAME_ON2_VP6 || ctrl == rtmp.CONTROL_ID.INFO_ON2_VP6 ||
                        ctrl == rtmp.CONTROL_ID.KEY_FRAME_H264 || ctrl == rtmp.CONTROL_ID.INTER_FRAME_H264) {

                        filterC4Count = subPackageCount;

                        // ** filter kill 0xC4 ** //
                        videoData = self.filter0xC4Header(videoData, filterC4Count, sChunksize);

                        //http://albert-oma.blogspot.tw/2016/06/rtmp-spec.html
                        //http://blog.csdn.net/leixiaohua1020/article/details/17934487

                        if (ctrl == rtmp.CONTROL_ID.INFO_ON2_VP6 || ctrl == rtmp.CONTROL_ID.INFO_ON2_H264) {
                            // don't something
                            // log.logHex(videoData);
                            continue;
                        }

                        /** FLV file format **/
                        if (self.muxer == "flv") {
                            fileHeader = self.createVideoHeader(body_size, timestamp, streamID);

                            var curr = Buffer.concat([fileHeader,videoData.slice(0,videoData.length)], fileHeader.length + videoData.length);

                            self.fileWrite(curr);
                            lastOutput = curr.toString('base64');
                        }
                        else if (self.muxer == MUXER_AVC){
                            lastOutput = self.createAVCVideoHeader(videoData);
                        }
                        else {
                            lastOutput = videoData.toString('base64');
                            if (videoData[0] == 0x17 && videoData[1] == 0x00) {
                                self.emit("naluInfo", lastOutput);
                            }
                        }

                        self.emit(self.StreamEvent.VIDEO_DATA, lastOutput, ctrl, timestamp);
                        if (self.videoCodecID == "H264" || self.videoCodecID == "avc1"){
                            NSLog.log('trace', 'CTRL:K-frame(%s) I-frame(%s)', ctrl == rtmp.CONTROL_ID.KEY_FRAME_H264, ctrl == rtmp.CONTROL_ID.INTER_FRAME_H264);
                        }else {
                            NSLog.log('trace', 'CTRL:K-frame(%s) I-frame(%s) Info(%s)', ctrl == rtmp.CONTROL_ID.KEY_FRAME_ON2_VP6, ctrl == rtmp.CONTROL_ID.INTER_FRAME_ON2_VP6, ctrl == rtmp.CONTROL_ID.INFO_ON2_VP6);
                        }
                    }

                    if (0) {
                        filterC4Count = subPackageCount;
                        videoData = self.filter0xC4Header(videoData, filterC4Count, sChunksize);
                        NSLog.log("warning", "H264 Not support !!");
                    }

                }
                else if (typeID == rtmp.PacketType.PACKET_TYPE_AUDIO) {
                    if (body_size > 0) ctrl = curr_nbufs.readUInt8(hdrSize[fmt] + 1);

                    audioSize = body_size;
                    NSLog.log('warning','The audio stream Not support output!!',body_size, subPackageCount);


                } else if (typeID == rtmp.PacketType.PACKET_TYPE_METADATA){
                    NSLog.log('info', '----- Metadata -----');
                    NSLog.log('info', '----- AMF0_DATA (0x12), %s bytes, %s total -----', (hdrSize[fmt] + body_size), rtmp.nbufs.length);
                    NSLog.log('info', '----- %s -----', rtmp.nbufs.length);
                    invokeSize = body_size;
                }
                else if (typeID == rtmp.PacketType.PACKET_TYPE_CONTROL){
                    NSLog.log('info', '----- User Control Message (0x02), %s bytes -----',(hdrSize[fmt] + body_size));

                    var num = curr_nbufs.readInt32BE(14);

                    rtmp.pingResponse(num);

                }
                else if (typeID == rtmp.PacketType.PACKET_TYPE_FLV) {
                    NSLog.log("info", "Aggregate TYPE");
                    var aggregates = curr_nbufs.slice(offset,curr_nbufs.length);
                    aggregates = self.filter0xC4Header(aggregates, subPackageCount, sChunksize);
                    var video_tag,timestamp_extended,previous_tag_size;
                    offset = 0;
                    while (aggregates.length > 0) {
                        NSLog.log("trace", "video_tag:0x%s, len:%s",aggregates[0], aggregates.length);
                        video_tag = aggregates[offset++];
                        if (video_tag == rtmp.PacketType.PACKET_TYPE_VIDEO || video_tag == rtmp.PacketType.PACKET_TYPE_AUDIO) {
                            body_size = aggregates.readUInt8(offset) << 16;   // (1)
                            body_size += aggregates.readUInt8(offset+1) << 8; // (2)
                            body_size += aggregates.readUInt8(offset+2);      // (3)
                            offset += 3;
                            timestamp = aggregates.readUInt8(offset) << 16;   // (4)
                            timestamp += aggregates.readUInt8(offset+1) << 8; // (5)
                            timestamp += aggregates.readUInt8(offset+2);      // (6)
                            offset += 3;
                            timestamp_extended = aggregates.readUInt8(offset++);
                            streamID = aggregates.readUInt8(offset) << 16;   // (8)
                            streamID += aggregates.readUInt8(offset+1) << 8; // (9)
                            streamID += aggregates.readUInt8(offset+2);      // (10)
                            offset += 3;
                            videoData = aggregates.slice(offset,offset + body_size);
                            offset += body_size;
                            previous_tag_size = aggregates.readUInt32BE(offset);
                            offset += 4;
                            aggregates = aggregates.slice(offset,aggregates.length);
                            offset = 0;
                            ctrl = videoData.readUInt8(0);
                            // NSLog.log("trace", video_tag, body_size, timestamp, timestamp_extended, streamID, videoData.length, previous_tag_size, aggregates.length,self.flvHeader);
                            if (video_tag == rtmp.PacketType.PACKET_TYPE_AUDIO) {
                                NSLog.log("warning", "AUDIO Not support !!");
                            }else {
                                if (self.muxer == "flv") {
                                    fileHeader = self.createVideoHeader(body_size, timestamp, streamID);
                                    videoData = Buffer.concat([fileHeader,videoData.slice(0,videoData.length)], fileHeader.length + videoData.length);
                                    lastOutput = videoData.toString('base64');
                                }
                                else if (self.muxer == MUXER_AVC){
                                    lastOutput = self.createAVCVideoHeader(videoData);
                                }
                                else {
                                    lastOutput = videoData.toString('base64');
                                }

                                self.emit(self.StreamEvent.VIDEO_DATA, lastOutput, ctrl, timestamp);
                                videoData = undefined;
                            }

                        }else {
                            NSLog.log("error", "TYPE UNKNOWN");
                            log.logHex(aggregates);
                            process.exit()
                        }
                    }
                }
                else {

                    /* extended header : 0x82 Unknown H264???*/
                    if (rtmp.nbufs[0] == 0x82 ) {
                        if (rtmp.nbufs.length < 10) return; // 長度不夠等資料齊
                        // log.logHex(rtmp.nbufs.slice(0, 10));
                        NSLog.log("trace", "---------- User Control Message 0x%s -----------",rtmp.nbufs[5]);
                        rtmp.nbufs = rtmp.nbufs.slice(10, rtmp.nbufs.length);
                        continue;
                    }



                    if (typeID == rtmp.PacketType.PACKET_TYPE_INVOKE) {

                        var obj = amfUtils.decodeAmf0Cmd(curr_nbufs.slice(offset, curr_nbufs.length));
                        self.emit(self.StreamEvent.STATUS, obj);
                        NSLog.log("trace", "---------- User Control Message (%s) -----------", obj.cmd);
                        continue;
                    }else if (fmt == 0 && csid == 0x02 && typeID == 0x01) {
                        var num = data.readUInt32BE(12);
                        console.log('setRTMPChunkSize:', num);
                    }

                    log.logHex(curr_nbufs);
                    NSLog.log("error",'ERROR !!!!!!!!!!!!!!! ERROR', rtmp.nbufs[0] == 0x82, fmt, csid,typeID);

                }

            }
            else if ((fmt == 2 || fmt == 3) && csid < 5)
            {
                /* Extended header : 0x82 Unknown H264???*/
                if (rtmp.nbufs[0] == 0x82 && (rtmp.nbufs[5] == rtmp.usrCtrlMsg.BUFFER_EMPTY || rtmp.nbufs[5] == rtmp.usrCtrlMsg.BUFFER_READY)) {
                    if (rtmp.nbufs.length < 10) return; // 長度不夠等資料齊
                    rtmp.nbufs = rtmp.nbufs.slice(10, rtmp.nbufs.length);
                    NSLog.log('error', '{ [0x84] BUFFER_READY }');
                    continue;
                }else if (rtmp.nbufs[0] == 0x84 && rtmp.nbufs.length >= 5) {
                    if (rtmp.nbufs[4] == rtmp.CONTROL_ID.HE_AAC || rtmp.nbufs[4] == rtmp.CONTROL_ID.ASAO_AUDIO || rtmp.nbufs[4] === rtmp.CONTROL_ID.UNKNOWN_AUDIO) {
                        // timestamp = (rtmp.nbufs.readUInt8(1) << 16) + (rtmp.nbufs.readUInt8(2) << 8) + rtmp.nbufs.readUInt8(3);

                        if (rtmp.nbufs.length < (audioSize + 4)) return;

                        NSLog.log('trace', '{ 1.Audio Packet DROP }',rtmp.nbufs.length, audioSize);

                        rtmp.nbufs = rtmp.nbufs.slice((audioSize+4), rtmp.nbufs.length);

                        // Audio Packet drop//
                    }else if (typeof rtmp.CONTROL_ID_Marker[rtmp.nbufs[4]] != "undefined") {
                        // Video Packet //
                        rtmp.nbufs = Buffer.concat([rtmp.previousHeader["headerBuffer"], rtmp.nbufs.slice(4, rtmp.nbufs.length)], rtmp.previousHeader["headerBuffer"].length + rtmp.nbufs.length -4);
                    }else {
                        NSLog.log('error', '{ [0x84] tag is not video & audio }');

                        while (rtmp.nbufs[0] == 0x84) {
                            if (rtmp.nbufs.toString().substr(0,24).indexOf('onGetFPS') != -1) {
                                rtmp.nbufs = rtmp.nbufs.slice(24,rtmp.nbufs.length);
                                NSLog.log('error', 'DROP onGetFPS()',rtmp.nbufs.length);
                            }else if (rtmp.nbufs.toString().substr(0,24).indexOf('onFI') != -1) {
                                rtmp.nbufs = rtmp.nbufs.slice(55,rtmp.nbufs.length);
                                NSLog.log('error', "Message 'onFI' unknown on stream.(%s)", invokeSize+4);
                            } else {
                                break;
                            }
                        }

                        if (rtmp.nbufs.length > 0) {
                            log.logHex(rtmp.nbufs);
                            continue;
                        }else {

                        }
                    }

                    NSLog.log('trace', '--------------- 0x84 ------------------');

                    continue;
                }
                /* Unknown Header : 0xC2 */
                if (rtmp.nbufs[0] == 0xC2) {
                    NSLog.log('verbose',"0xC2 One size header. ");
                    if (rtmp.nbufs.length < 7) return;

                    NSLog.log('trace', "Header[0xC2] Unknown Control Message(0x20, 0x1f) drop packet.");
                    // Stream Stop FMS send Event //
                    if (rtmp.nbufs[2] == 0x20 || rtmp.nbufs[2] == 0x1f) {
                        rtmp.nbufs = rtmp.nbufs.slice(7, rtmp.nbufs.length);
                        continue;
                    }
                }
                /* Extended Header : 0xC4 */
                if (rtmp.nbufs[0] == 0xC4 && rtmp.nbufs.length >= 2) {
                    NSLog.log('verbose', "C0 + %s", rtmp.nbufs[0] - 0xC0 );
                    NSLog.log('verbose',"0xC4 extended header typeID[%s] Curr Len[%s] Former Len[%s]", rtmp.previousHeader["typeID"], rtmp.nbufs.length-1, rtmp.previousHeader["bodySize"]);

                    if (rtmp.nbufs.length < rtmp.previousHeader["bodySize"]) return;
                    // Aggregate //
                    if (rtmp.previousHeader["typeID"] == rtmp.PacketType.PACKET_TYPE_FLV) {
                        rtmp.nbufs = Buffer.concat([rtmp.previousHeader["headerBuffer"], rtmp.nbufs.slice(1, rtmp.nbufs.length)], rtmp.previousHeader["headerBuffer"].length + rtmp.nbufs.length -1);
                        NSLog.log('trace', '--------------- 0xC4 Aggregate ------------------');
                        continue;
                    }
                    if (rtmp.nbufs[1] === rtmp.CONTROL_ID.UNKNOWN_AUDIO) {
                        NSLog.log('trace', '{ 2.Audio Packet DROP }',rtmp.nbufs.length, audioSize);

                        rtmp.nbufs = rtmp.nbufs.slice((audioSize+1), rtmp.nbufs.length);
                        continue;
                    }

                    filterC4Count = self.totalRTMPPacket(rtmp.previousHeader["bodySize"], sChunksize);
                    curr_nbufs    = rtmp.nbufs.slice(1, rtmp.previousHeader["bodySize"] + filterC4Count + 1);
                    curr_nbufs    = self.filter0xC4Header(curr_nbufs, filterC4Count, sChunksize);
                    ctrl = curr_nbufs.readUInt8(0);
                    if (self.muxer == "flv") {
                        // set flv header //
                        fileHeader = self.createVideoHeader(curr_nbufs.length, 100, 1);
                        curr_nbufs = Buffer.concat([fileHeader, curr_nbufs], fileHeader.length + curr_nbufs.length);
                        lastOutput = curr_nbufs.toString('base64');
                    }
                    else if (self.muxer == MUXER_AVC){
                        lastOutput = self.createAVCVideoHeader(curr_nbufs);
                    }
                    else {
                        lastOutput = curr_nbufs.toString('base64');
                    }
                    self.emit(self.StreamEvent.VIDEO_DATA, lastOutput, ctrl, 100);
                    rtmp.nbufs = rtmp.nbufs.slice((rtmp.previousHeader["bodySize"] + filterC4Count + 1), rtmp.nbufs.length);
                    // rtmp.nbufs = rtmp.nbufs.slice(rtmp.nbufs.length, rtmp.nbufs.length);
                    NSLog.log('verbose',"# Ended 0xC4 nbufs.length[%s]", rtmp.nbufs.length, rtmp.previousHeader["bodySize"], rtmp.nbufs[0], curr_nbufs[curr_nbufs.length-1]);
                    return;
                }

                NSLog.log('verbose',"Format(%s) nbufs size : %s",rtmp.nbufs[0].toString(16),rtmp.nbufs.length );
                NSLog.log('trace', '---------------------------------');
                // NSLog.log('debug', "Next Packet:*%s %s", curr_nbufs[hdrSize[fmt]], hdrSize[fmt]+1);
                NSLog.log('debug', "hex:", rtmp.nbufs.slice(0,50));
                NSLog.log('debug', "nbufs.length:", rtmp.nbufs.length);
                NSLog.log('debug', "indexof :", rtmp.nbufs.indexOf(0x00), rtmp.nbufs[rtmp.nbufs.indexOf(0x00)+1]);
                NSLog.log('debug', "basic header:%s, current:%s", rtmp.nbufs[0],data[0]);
                NSLog.log('trace', '---------------------------------');

                /* Last Data Unknown so find header */
                offset = rtmp.nbufs.indexOf('440000',0, 'hex');
                if (offset == -1) {
                    rtmp.nbufs = undefined;
                    NSLog.log('error','------------- rtmp.nbufs = undefined -------------');
                    return;
                }
                rtmp.nbufs = rtmp.nbufs.slice(offset, rtmp.nbufs.length);

            }
            else {
                // unknown basic header //
                rtmp.nbufs = undefined;
                NSLog.log("error", "unknown basic header!!!");
                return;
            }
        }
        // if(isWorker) process.send({"evt":"videoData","namespace": rtmp.name, "data" : data});
    });

    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        NSLog.log( "error","RTMP ERROR", args);
        rtmp.socket.destroy();
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function () {
        NSLog.log("error","RTMP connection closed. System Uptime: %s", self.formatUpTime(new Date().getTime() - self.uptime));
        self.rtmp.removeAllListeners();
        setTimeout(function () {
            self.setupFMSClient(rtmp.name);
        },5000);
    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        // var header_size = chunk.readUInt8(0);
        if (chunk[0] == 0x02 && chunk.byteLength == 18) {
            var num = chunk.readInt32BE(14);
            rtmp.pingResponse(num);
        }
    });
    rtmp.on(self.StreamEvent.STATUS, function (event) {
        self.emit(self.StreamEvent.STATUS, event);
    });

    var onMetadata = this.onMetaDataHandler;
    rtmp.on(this.StreamEvent.META_DATA, onMetadata.bind(self));
    return rtmp;
};
libvp62Cl.prototype.onMetaDataHandler = function (obj) {
    this.videoCodecID = obj[1]["videocodecid"];
    this.emit(this.StreamEvent.META_DATA, obj);
};
/** send stream play name **/
libvp62Cl.prototype.streamPlay = function (rtmp, videoName) {
    rtmp.netStreamConnect(videoName); //ex: play('ddabb');
    rtmp = null;
};

/** combine data **/
libvp62Cl.prototype.concatData = function (rtmp, data) {
    /* (1) detect packet size */
    if (!rtmp.nbufs || rtmp.nbufs.length == 0)
        rtmp.nbufs = new Buffer(data);
    else
    {
        rtmp.nbufs = Buffer.concat([rtmp.nbufs, data], rtmp.nbufs.length + data.length);
        NSLog.log("debug", 'chucnk Data ReadPacket:%s',rtmp.RTMP_ReadPacket({buf:rtmp.nbufs}) == 1)
    }

    if (rtmp.nbufs[0] == 0x00 && rtmp.nbufs[1] == 0x44) rtmp.nbufs = rtmp.nbufs.slice(1, rtmp.nbufs.length);//不知道哪裡算錯這邊多了00

    if (!rtmp.RTMP_ReadPacket({buf:rtmp.nbufs}) ) {

        NSLog.log('error', 'Is not RTMP ReadPacket:%s rtmp.nbufs.length:%s ', rtmp.RTMP_ReadPacket(rtmp.nbufs), rtmp.nbufs.length );

        var nextOffset = rtmp.nbufs.indexOf('440000', 0, 'hex');

        if (nextOffset != -1) {

            NSLog.log('warning','----- DELETE UNKNOWN DATA (%s) -----', nextOffset);
            log.logHex(rtmp.nbufs.slice(0, nextOffset));
            rtmp.nbufs = rtmp.nbufs.slice(nextOffset, rtmp.nbufs.length);

        } else if (rtmp.RTMP_ReadPacket(data))  {
            log.logHex(rtmp.nbufs);
            NSLog.log('error','----- IS NEW DATA ReadPacket -----', rtmp.nbufs.length);
            log.logHex(data);
            rtmp.nbufs = new Buffer(data);
            this.__disposeSocket(rtmp);
        } else if (rtmp.nbufs.length >= rtmp.BasicHeaderSize[(rtmp.nbufs[0] >> 6)]) {

            rtmp.nbufs = new Buffer(0);
        }else {
            log.logHex(rtmp.nbufs);
            this.__disposeSocket(rtmp);
        }
        if (rtmp.nbufs.length < 10) {
            NSLog.log('error','rtmp.nbufs.length < 10');
            log.logHex(rtmp.nbufs);
        }

    }

    rtmp = null;
    data = null;
};
libvp62Cl.prototype.totalRTMPPacket = function (body_size, sChunksize) {
    var sum = parseInt((body_size/sChunksize));
    var end = ((body_size % sChunksize == 0) ? 1 : 0);
    sum = sum - end;

    return sum;
};
libvp62Cl.prototype.filter0xC4Header = function (videoData, filterC4Count, sChunksize) {
    for (var i = 1; i <= filterC4Count; i++) {

        var v = (i * sChunksize);
        var nlen = videoData.length;

        videoData = Buffer.concat([videoData.slice(0,v), videoData.slice(v+1, nlen)], nlen-1);
    }
    return videoData;
};
libvp62Cl.prototype.writeUInt24BE = function(buffer,value, offset) {
    buffer[offset + 2] = value & 0xff;
    buffer[offset + 1] = value >> 8;
    buffer[offset] = value >> 16;
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
        }else if(data.evt == "processInfo") {

            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": Object.keys(this.connections).length}})
        }else{
            debug('out of hand. dismiss message');
        }

    }

};
/**
 *
 * @param body_size {number}
 * @param timestamp {number}
 * @param streamID {number}
 * @returns {*}
 */
libvp62Cl.prototype.createVideoHeader = function (body_size, timestamp, streamID) {
    var fileHeader;
    var self = this;
    if (self.flvHeader) {
        fileHeader = new Buffer(24);
        fileHeader.write("FLV",0);
        fileHeader[13] = 0x09;
        self.writeUInt24BE(fileHeader, body_size, 14);
        fileHeader.writeUInt32BE(timestamp, 17);
        self.writeUInt24BE(fileHeader, streamID, 21);

    }else
    {
        fileHeader = new Buffer(11);
        fileHeader[0] = 0x09;                          //(1)
        self.writeUInt24BE(fileHeader, body_size, 1);  //(3)
        fileHeader.writeUInt32BE(timestamp, 4);        //(4)
        self.writeUInt24BE(fileHeader, streamID, 8);   //(3)
    }
    self.flvHeader = false;
    return fileHeader;
};
libvp62Cl.prototype.createAVCVideoHeader = function (videoData) {

    var frames = undefined;
    if (videoData.readUInt16BE(0) == 0x1700) {
        var offset = 13;
        //SRS
        var SRSLen = videoData.readUInt16BE(11);
        var SRS = videoData.slice(offset, SRSLen);
        offset += SRSLen;
        offset += 3;
        var PPS = videoData.slice(offset, videoData.length);

        frames = Buffer.concat([this.AVC_HEADER,SRS,this.AVC_HEADER,PPS], this.AVC_HEADER.length*2 + SRS.length + PPS.length);
    } else {
        frames = Buffer.concat([this.AVC_HEADER,videoData.slice(9,videoData.length)], this.AVC_HEADER.length + videoData.length -9);
    }
    this.fileWrite(frames);
    return frames.toString('base64');
};
libvp62Cl.prototype.setPreviousHeader = function (bodySize, typeID, headerBuffer) {
    if (typeof bodySize != "undefined") this.rtmp.previousHeader.bodySize = bodySize;
    if (typeof typeID != "undefined") this.rtmp.previousHeader.typeID = typeID;
    if (typeof headerBuffer != "undefined") this.rtmp.previousHeader.headerBuffer = headerBuffer;
};
/** close stream **/
libvp62Cl.prototype.close = function () {
    this.rtmp.close();
    this.rtmp.socket.destroy();
};
libvp62Cl.prototype.pause = function () {
    this.rtmp.pause();
};
libvp62Cl.prototype.resume = function () {
    this.rtmp.resume();
};
/** release stream **/
libvp62Cl.prototype.dispose = function () {
    this.rtmp.deleteStream();
    this.rtmp.removeAllListeners();
    this.rtmp = undefined;
};
libvp62Cl.prototype.__disposeSocket = function (rtmp) {
    rtmp.socket.destroy();
    // process.exit();
};
/**
 * @param type {string}
 */
libvp62Cl.prototype.__defineSetter__("muxer", function (type) {
    if (typeof type != "undefined" && type) {
        this._muxer = type;
    }
});
libvp62Cl.prototype.__defineGetter__("muxer", function () {
    return this._muxer;
});
/**
 *
 * @param codecID {string}
 */
libvp62Cl.prototype.__defineSetter__("videoCodecID", function (codecID) {
    if (typeof codecID != "undefined" && codecID) {
        this._videocodecid = codecID;
    }
    if (codecID.toUpperCase() == "H264" || codecID.toUpperCase() == "AVC1") this.muxer = MUXER_NONE; // this.muxer = MUXER_AVC;

    if (codecID.toUpperCase() == "VP62" || codecID.toUpperCase() == "VP6A" || codecID.toUpperCase() == "VP6F") this.muxer = MUXER_FLV;

});
libvp62Cl.prototype.__defineGetter__("videoCodecID", function () {
    return this._videocodecid;
});

/**
 *
 * @param data {Buffer}
 */
libvp62Cl.prototype.fileWrite = function (data) {
    if (this.flag_write_enabled) {
        NSLog.log('log', '|| ---------------------- save file ------------------------ ||');
        this.fxFile.write(data);
    }
};
libvp62Cl.prototype.release = function () {

};
libvp62Cl.prototype.formatUpTime = function (time) {
    var uptime = parseInt(time/1000);
    var day = parseInt(uptime/(60*60*24));
    uptime = uptime - day;
    var hours = parseInt(uptime/(60*60));
    uptime = uptime - hours;
    var min = parseInt(uptime/(60*60));
    uptime = uptime - min;
    var sec = parseInt(uptime);
    var str = "0" + day + ":";
    if (hours < 10)
        str = str + "0" + hours + ":";
    else
        str = str + hours + ":";

    if (min < 10)
        str = str + "0" + min + ":";
    else
        str = str + min + ":";

    if (sec < 10)
        str = str + "0" + sec;
    else
        str = str + sec;

    str += ("." + time%1000);

    return str;
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

if (process.env.test) {
    var service = new libvp62Cl();
    service.on(service.StreamEvent.STATUS, function (obj) {
        NSLog.log("info","service.StreamEvent.STATUS ",obj);
    })
}
