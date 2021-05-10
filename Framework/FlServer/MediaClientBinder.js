"use strict";
/**
 * Created by Benson.Liao on 21/03/25.
 */
const net             = require("net");
const util            = require("util");
const path            = require("path");
const FxBufferPool    = require("./FxBufferPool.js");
const amfUtils        = require("./amfUtils.js");
const ClientHandshake = require("./ClientHandshake.js");
const MediaClient     = require("./MediaClient.js");
const fxNetSocket     = require('fxNetSocket');
const log             = require("./log.js");
const NSLog           = fxNetSocket.logger.getInstance();
/** default fms server port **/
const DEFAULT_PORT  = 1935;
/** 資料每包大小 **/
const MessagePacketDefault = 4096;
/**
 * 
 * @constructor
 */
function MediaClientBinder(delegate, options) {
    MediaClient.call(this, delegate, options);
    /*
    this.binder = {
        enabled: false,
        mode: "transmit",//receive
        packet: [],
    };
     */
    this.binder.enabled = true;
    this.binder.mode = "transmit";
}
util.inherits(MediaClientBinder, MediaClient);

MediaClientBinder.prototype.connect = function (cmd) {
    NSLog.log("info", "MediaClientBinder.connect() ", cmd);
    // MediaClientBinder.super_.prototype.connect.apply(this, arguments);
    this.connectCmdObj = cmd.cmdObj;
    this.app = this.connectCmdObj.app;
    this.objectEncoding = (cmd.cmdObj.objectEncoding != null) ? cmd.cmdObj.objectEncoding : 0.0;
    this.outChunkSize = MessagePacketDefault;
    this.emit("connect", cmd, this.binder.packet);
};
MediaClientBinder.hasHandshake = function (chunk) {
    if (chunk.length <= 9) return false;

    const version = chunk.readUInt8(0);
    const timestamp = chunk.readUInt32BE(1);
    const fixedZeros = chunk.readUInt32BE(5);
    if (version !== 3) return false;
    if (timestamp === 0) {
        return fixedZeros !== 0x00;
    } else {
        return fixedZeros === 0x00;
    }
};
module.exports = exports = MediaClientBinder;