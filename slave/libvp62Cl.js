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
const log           = require('../fxNodeRtmp').AMFLOG;
const isWorker      = ('NODE_CDID' in process.env);
const events        = require('events');
const isMaster      = (isWorker === false);
const cdid          = process.env.NODE_CDID || 0;
const NSLog         = fxNetSocket.logger.getInstance();
if (isMaster)
    NSLog.configure({logFileEnabled:false, consoleEnabled:true, level:'verbose', dateFormat:'[yyyy-MM-dd hh:mm:ss]',filePath:"./",fileName:'libvp62_ID' + cdid, maximumFileSize: 1024 * 1024 * 100});

util.inherits(libvp62Cl, events.EventEmitter);

function libvp62Cl(options) {

    /* Variables */

    this.connections = [];

    this._outputMode = "flv";

    /* rtmp config - Variables */
    this.rtmpConnectListener = true; //send request "connect" event to be received data.
    this.uptime = new Date().getTime();
    // this.init();

    options = (typeof options == "undefined") ? "video/daabb/video0" : options;
    
    this.config = {
        //audio rtmp /video/daaic/video0
        bFMSHost:'103.24.83.249',//43.251.79.212,183.182.64.182,103.24.83.249
        bFMSPort:1935,
        videoPaths:[options]
    };
    // console.log(options);
    var videoPaths = this.config.videoPaths;

    for (var vPthNum = 0; vPthNum < videoPaths.length; vPthNum++ ) {
        var path = videoPaths[vPthNum];
        if (path.substr(0,1) == "/") path = path.substr(1, path.length);
        NSLog.log("trace",'** RTMP stream client has been created. **');
        this.setupFMSClient(path);
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
    var uri = "rtmp://" + this.config.bFMSHost + ":" + this.config.bFMSPort + "/" + namespace;
    NSLog.log('info', 'setupFMSClient:%s', uri);
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
libvp62Cl.prototype.onMetaDataHandler = function (obj) {
    this.emit(this.StreamEvent.META_DATA, obj);
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
    NSLog.log('trace', "** Start IP address:%s:%s", uri.host, uri.port);
    /*
    function handshakeComplete() {
        NSLog.log('debug', "** RTMPClient %s:%s Connected!", rtmp.socket.remoteAddress, rtmp.socket.remotePort);

        if (self.rtmpConnectListener)
        {
            rtmp.isVideoStream = true;

            rtmp.on('status',function (cmd) {
                if (cmd.name == "connect_result") {
                    //完成後就可以自己送出要的事件
                    self.streamPlay(rtmp, uri.video)
                }else if(cmd.name == "close") {
                    rtmp.socket.destroy();
                }
            });
            rtmp.connectResponse();
        }
        rtmp.invoke_connect(uri.app, uri.path);

    }

    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, handshakeComplete, true);
    */
    rtmp = libRtmp.RTMPClient.createRTMPNetStream(uri);

    var onMetadata = this.onMetaDataHandler;

    rtmp.on(this.StreamEvent.META_DATA, onMetadata.bind(self));

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


    var index = 0;
    var total = 0;
    var chunkIdx = 0;

    rtmp.nbufs = undefined;
    rtmp.videoStreamID = 0; // csid
    rtmp.formerHeader = {formerBodySize:0, typeID:undefined, headerBuffer:undefined};

    const hdrSize = rtmp.BasicHeaderSize;

    rtmp.on('videoData', function (data) {
        chunkIdx++;
        // ------------------------------ //
        //        First One Packet        //
        // ------------------------------ //

        var fmt,csid;
        var timestamp, body_size, typeID, streamID, ctrl;
        var curr_nbufs, nbufs, subPackageCount; // filter 0xC4 count
        var offset = 0;
        var sChunksize = rtmp.getRTMPChunkSize;

        /** 合併Packet **/
        self.concatData(rtmp, data);

        var _count = 0;
        /** (2) read_packet **/
        while (rtmp.nbufs.length > 0 && rtmp.nbufs.length > hdrSize[rtmp.nbufs[0] >> 6]) {

            _count++;

            if (rtmp.nbufs.length == 0) return;

            // var isRTMPPacket = rtmp.RTMP_ReadPacket(rtmp.nbufs); //檢查是否為一個Packet
            //
            // NSLog.log("trace", "RTMP_ReadPacket - ", isRTMPPacket == 1);

            /////rtmp.streamChunkSize/////
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
                    NSLog.log("debug", "//// RTMPPacket_IsNotReady() ////");
                    NSLog.log('debug', "chunkIdx:%s,count:%s BodySize: %s, data size:", chunkIdx,_count, body_size, data.length);
                    NSLog.log('debug', "buf:%s", rtmp.nbufs.slice(0, 10).toString('hex'));
                    return;
                }

                curr_nbufs = rtmp.nbufs.slice(0, hdrSize[fmt] + body_size + subPackageCount);
                var firstOnes = curr_nbufs[0].toString(16);


                NSLog.log('info','pre-nbufs:%s , curr_nbufs:%s', rtmp.nbufs.length, curr_nbufs.length);
                //移除資料
                rtmp.nbufs = rtmp.nbufs.slice((hdrSize[fmt] + body_size + subPackageCount), rtmp.nbufs.length);

                NSLog.log('info', "\n----------------\nchunkIdx:%s,count:%s\nBasicHeader:0x%s\nFmt:%s,CSID: %s\nTimestamp: %s\nBodySize: %s\nTypeID:%s\nStreamID:%s\nctrl:%s\nnbufs:%s\n",
                    chunkIdx,_count,firstOnes, fmt, csid, timestamp, body_size, typeID, streamID, 0, rtmp.nbufs.length);
                if (rtmp.nbufs.length > 0) {
                    NSLog.log('info','curr-least:0x%s', curr_nbufs[curr_nbufs.length-1].toString(16));
                    NSLog.log('info','Next-basicHeader:0x%s', rtmp.nbufs[0].toString(16));
                    NSLog.log('info','curr index of 0x00:%s', curr_nbufs.lastIndexOf(0x00));
                    NSLog.log('info','index of 0x00:%s', rtmp.nbufs.indexOf(0x00),rtmp.nbufs[rtmp.nbufs.indexOf(0x00)+1]);
                    NSLog.log('info','----------------');
                }

                rtmp.formerHeader["typeID"] = typeID;
                rtmp.formerHeader["headerBuffer"] = curr_nbufs.slice(0, offset);
                rtmp.formerHeader["formerBodySize"] = body_size;
                // self.setFormerHeader(body_size, typeID, curr_nbufs.slice(0, offset));
                if (typeID == rtmp.PacketType.PACKET_TYPE_VIDEO) {
                    var videoData = curr_nbufs.slice(offset,curr_nbufs.length);
                    ctrl = videoData.readUInt8(0);

                    if (ctrl == rtmp.CONTROL_ID.KEY_FRAME_ON2_VP6 || ctrl == rtmp.CONTROL_ID.INTER_FRAME_ON2_VP6 || ctrl == rtmp.CONTROL_ID.INFO_ON2_VP6) {

                        var filterC4Count = subPackageCount;

                        // ** filter kill 0xC4 ** //
                        /*
                        var subHeader = 0xC0 + csid;
                        for (var i = 1; i <= filterC4Count; i++) {

                            var v = (i * sChunksize);
                            var nlen = videoData.length;

                            videoData = Buffer.concat([videoData.slice(0,v), videoData.slice(v+1, nlen)], nlen-1);

                            // NSLog.log('trace', 'filter(%s):%s', v, videoData[v]);
                        }*/
                        videoData = self.filter0xC4Header(videoData, filterC4Count, sChunksize);
                        NSLog.log('info', '|| ---------------------- write file start ------------------------ ||');
                        //http://albert-oma.blogspot.tw/2016/06/rtmp-spec.html
                        //http://blog.csdn.net/leixiaohua1020/article/details/17934487
                        var fileHeader = self.createVideoHeader(self.flvHeader, body_size, timestamp, streamID);


                        if(ctrl != rtmp.CONTROL_ID.INFO_ON2_VP6) {
                            var curr = Buffer.concat([fileHeader,videoData.slice(0,videoData.length)], fileHeader.length + videoData.length);
                            self.flvHeader = false;
                            self.fxFile.write(curr);
                            NSLog.log('log','------- END -------', curr[curr.length]);
                            var vb= curr.toString('base64');
                            self.emit(self.StreamEvent.VIDEO_DATA, vb, ctrl, timestamp);
                        }
                        
                        // make bodySize //
                        rtmp.formerHeader["formerBodySize"] = videoData.length;
                        
                        NSLog.log('trace', " Write size:%s(%s)",fileHeader.length + videoData.length -1,videoData.slice(1,videoData.length).length);
                        // NSLog.log('info', '|| -------------------- write file end -------------------------- ||');
                        // NSLog.log('trace', 'rm chunk size(1):', parseInt(videoData.length/schunksize), subPackageCount);
                        // NSLog.log('trace', 'video size:%s', videoData[0].toString(16),videoData[1].toString(16));
                        // NSLog.log('trace', 'video Data Length:', videoData.length);
                        NSLog.log('trace', 'ctrl:K-frame(%s) I-frame(%s) Info(%s)', ctrl == rtmp.CONTROL_ID.KEY_FRAME_ON2_VP6, ctrl == rtmp.CONTROL_ID.INTER_FRAME_ON2_VP6, ctrl == rtmp.CONTROL_ID.INFO_ON2_VP6);
                    }

                    if (ctrl == rtmp.CONTROL_ID.KEY_FRAME_H264 || ctrl == rtmp.CONTROL_ID.INTER_FRAME_H264) {
                        NSLog.log("warning", "H264 Not support !!");
                    }

                }
                else if (typeID == rtmp.PacketType.PACKET_TYPE_AUDIO) {
                    ctrl = nbufs.readUInt8(offset);

                    NSLog.log('warning','The audio stream Not support output!!');
                    console.log('The audio stream Not support output!!', curr_nbufs.toString());
                    log.logHex(rtmp.nbufs);

                } else if (typeID == rtmp.PacketType.PACKET_TYPE_METADATA){
                    NSLog.log('info', '----- Metadata -----');
                    NSLog.log('info', '----- AMF0_DATA (0x12), %s bytes, %s total -----', (hdrSize[fmt] + body_size), rtmp.nbufs.length);
                    NSLog.log('info', '----- %s -----', rtmp.nbufs.length);

                }
                else if (typeID == rtmp.PacketType.PACKET_TYPE_CONTROL){
                    NSLog.log('info', '----- User Control Message (0x02), %s bytes -----',(hdrSize[fmt] + body_size));

                    var num = curr_nbufs.readInt32BE(14);

                    rtmp.pingResponse(num);

                }else if (typeID == rtmp.PacketType.PACKET_TYPE_FLV) {
                    NSLog.log("warning", "Aggregate TYPE");
                    var aggregates = curr_nbufs.slice(offset,curr_nbufs.length);
                    aggregates = self.filter0xC4Header(aggregates, subPackageCount, sChunksize);
                    var video_tag,timestamp_extended,previous_tag_size;
                    offset = 0;
                    while (aggregates.length > 0) {
                        NSLog.log("warning", "video_tag:0x%s, len:%s",aggregates[0], aggregates.length);
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
                            // NSLog.log("warning", video_tag, body_size, timestamp, timestamp_extended, streamID, videoData.length, previous_tag_size, aggregates.length,self.flvHeader);
                            if (video_tag == rtmp.PacketType.PACKET_TYPE_AUDIO) {
                                NSLog.log("warning", "AUDIO Not support !!");
                            }else {
                                if (self.getOutputMode == "flv") {
                                    var fileHeader = self.createVideoHeader(self.flvHeader, body_size, timestamp, streamID);
                                    var curr = Buffer.concat([fileHeader,videoData.slice(0,videoData.length)], fileHeader.length + videoData.length);
                                    var vb = curr.toString('base64');
                                    self.emit(self.StreamEvent.VIDEO_DATA, vb, video_tag, timestamp);
                                }else {
                                    self.emit(self.StreamEvent.VIDEO_DATA, videoData.toString('base64'), video_tag, timestamp);
                                }
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
                    NSLog.log("error",'ERROR !!!!!!!!!!!!!!! ERROR', rtmp.nbufs[0] == 0x82, fmt, csid,typeID);
                    log.logHex(curr_nbufs);
                }

            }
            else if ((fmt == 2 || fmt == 3) && csid < 5) {
                /* extended header : 0x82 Unknown H264???*/
                if (rtmp.nbufs[0] == 0x82 && (rtmp.nbufs[5] == rtmp.usrCtrlMsg.BUFFER_EMPTY || rtmp.nbufs[5] == rtmp.usrCtrlMsg.BUFFER_READY)) {
                    if (rtmp.nbufs.length < 10) return; // 長度不夠等資料齊
                    // log.logHex(rtmp.nbufs.slice(0, 10));
                    rtmp.nbufs = rtmp.nbufs.slice(10, rtmp.nbufs.length);
                    continue;
                }else if (rtmp.nbufs[0] == 0x84) {
                    rtmp.nbufs = Buffer.concat([rtmp.formerHeader["headerBuffer"], rtmp.nbufs.slice(4, rtmp.nbufs.length)], rtmp.formerHeader["headerBuffer"].length + rtmp.nbufs.length -4);

                    NSLog.log('trace', '--------------- 0x84 ------------------');
                    continue;
                }
                /* extended header : 0xC4 */

                if (rtmp.nbufs[0] == 0xC4) {
                    NSLog.log('verbose', "C0 + %s", rtmp.nbufs[0] >> 6 );
                    NSLog.log('verbose',"0xC4 extended header typeID[%s] Curr Len[%s] Former Len[%s]", rtmp.formerHeader["typeID"], rtmp.nbufs.length-1, rtmp.formerHeader["formerBodySize"]);

                    if (rtmp.formerHeader["typeID"] == rtmp.PacketType.PACKET_TYPE_FLV) {
                        rtmp.nbufs = Buffer.concat([rtmp.formerHeader["headerBuffer"], rtmp.nbufs.slice(1, rtmp.nbufs.length)], rtmp.formerHeader["headerBuffer"].length + rtmp.nbufs.length -1);
                        NSLog.log('trace', '--------------- 0xC4 Aggregate ------------------');
                        continue;
                    }


                    if (rtmp.nbufs.length < rtmp.formerHeader["formerBodySize"]) return;

                    // body size //
                    curr_nbufs = rtmp.nbufs.slice(1, rtmp.formerHeader["formerBodySize"]);
                    // filter 0xC4
                    var filterC4Count = self.totalRTMPPacket(curr_nbufs, sChunksize);
                    curr_nbufs = self.filter0xC4Header(curr_nbufs, filterC4Count, sChunksize);

                    // set flv header //
                    var header = self.createVideoHeader(false, curr_nbufs.length, 100, 1);

                    curr_nbufs = Buffer.concat([header, curr_nbufs], header.length + curr_nbufs.length);
                    
                    self.emit(self.StreamEvent.VIDEO_DATA, curr_nbufs.toString('base64'), rtmp.CONTROL_ID.INTER_FRAME_ON2_VP6, 100);

                    rtmp.nbufs = rtmp.nbufs.slice(rtmp.nbufs.length, rtmp.nbufs.length);
                    NSLog.log('verbose',"# Ended 0xC4 nbufs.length[%s]", rtmp.nbufs.length);
                    return;
                }
                if (rtmp.nbufs[0] == 0xC2) {
                    NSLog.log('verbose',"0xC2 one size. ");
                }
                
                //unkown header
                // curr_nbufs = rtmp.nbufs.slice(1, preBasicHeader.bodySize + slice);

                NSLog.log('verbose',"Format(%s) nbufs size : %s",rtmp.nbufs[0].toString(16),rtmp.nbufs.length );
                NSLog.log('trace', '---------------------------------');
                // NSLog.log('debug', "Next Packet:*%s %s", curr_nbufs[hdrSize[fmt]], hdrSize[fmt]+1);
                NSLog.log('debug', "hex:", rtmp.nbufs.slice(0,50));
                NSLog.log('debug', "nbufs.length:", rtmp.nbufs.length);
                NSLog.log('debug', "indexof :", rtmp.nbufs.indexOf(0x00), rtmp.nbufs[rtmp.nbufs.indexOf(0x00)+1]);
                NSLog.log('debug', "basic header:%s, current:%s", rtmp.nbufs[0],data[0]);
                NSLog.log('trace', '---------------------------------');

                /**/
                var offset = rtmp.nbufs.indexOf('440000',0, 'hex');
                if (offset == -1) {
                    rtmp.nbufs = undefined;
                    NSLog.log('eroor','------------- rtmp.nbufs = undefined -------------');
                    return;
                }
                rtmp.nbufs = rtmp.nbufs.slice(offset, rtmp.nbufs.length);

            }
        }
        // if(isWorker) process.send({"evt":"videoData","namespace": rtmp.name, "data" : data});
    });

    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        NSLog.log( "error","RTMP ERROR", args);
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function (args) {
        NSLog.log("error","RTMP connection closed");
    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        var header_size = chunk.readUInt8(0);
        if (chunk[0] == 0x02 && chunk.byteLength == 18) {
            var num = chunk.readInt32BE(14);
            rtmp.pingResponse(num);
        }
    });

    return rtmp;
};
/** send stream play name **/
libvp62Cl.prototype.streamPlay = function (rtmp, videoName) {
    rtmp.netStreamConnect(videoName); //ex: play('ddabb');
    rtmp = null;
};
libvp62Cl.prototype.close = function () {
    this.rtmp.socket.destroy();
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

    if (!rtmp.RTMP_ReadPacket(rtmp.nbufs) ) {

        NSLog.log('error', 'Is not RTMP ReadPacket:%s rtmp.nbufs.length:%s ', rtmp.RTMP_ReadPacket(rtmp.nbufs), rtmp.nbufs.length );
        log.logHex(rtmp.nbufs);
        process.exit();
        var nextOffset = rtmp.nbufs.indexOf('440000', 0, 'hex');

        if (nextOffset != -1) {

            console.error('----- DELETE UNKNOWN DATA (%s) -----', nextOffset);
            log.logHex(rtmp.nbufs.slice(0, nextOffset));
            rtmp.nbufs = rtmp.nbufs.slice(nextOffset, rtmp.nbufs.length);

        }
        else if (rtmp.RTMP_ReadPacket(data))  {
            log.logHex(rtmp.nbufs);
            console.log('----- IS NEW DATA ReadPacket -----', rtmp.nbufs.length);
            log.logHex(data);
            NSLog.log('error','reset data()');
            rtmp.nbufs = new Buffer(data);
            process.exit(-1)
        } else if (rtmp.nbufs.length >= rtmp.BasicHeaderSize[(rtmp.nbufs[0] >> 6)]) {

            rtmp.nbufs = new Buffer(0);
        }else {

        }
        if (rtmp.nbufs.length < 10) {
            console.log('rtmp.nbufs.length < 10');
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
/**
 *
 * @param flvHeader {boolean}
 * @param body_size {number}
 * @param timestamp {number}
 * @param streamID {number}
 * @returns {*}
 */
libvp62Cl.prototype.createVideoHeader = function (flvHeader, body_size, timestamp, streamID) {
    var fileHeader;
    var self = this;
    if (flvHeader) {
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
    return fileHeader;
};
libvp62Cl.prototype.setFormerHeader = function (bodySize, typeID, headerBuffer) {
    if (typeof bodySize != "undefined") this.rtmp.formerHeader.formerBodySize = bodySize;
    if (typeof typeID != "undefined") this.rtmp.formerHeader.typeID = typeID;
    if (typeof headerBuffer != "undefined") this.rtmp.formerHeader.headerBuffer = headerBuffer;
};
libvp62Cl.prototype.outputMode = function () {

    return this._outputMode | "flv";
};

libvp62Cl.__defineGetter__("getOutputMode", function () {
    return this._outputMode | "flv";
});

module.exports = exports = libvp62Cl;

if (process.env.test) var service = new libvp62Cl();