var net = require('net'),
	events = require('events'),
	util = require('util'),
	os = require('os');

var AMF = require('./amf');
var RTMPHandshake = require('./handshake');
var RTMPMessage = require('./message');
var amfUtils = require('./amfUtils');
var log = require('./log');

var level ={'sendRTMPPacket':false};

// flv header '464c56010d00000009000000001200836600000000000000'
var RTMPClient = module.exports = function(socket) {
	this.socket = socket;
	this.uptime = os.uptime();
	this.state = 'connecting';
	// video stream //
	this.isVideoStream = false; // 檢查有沒有送出createStream
	this.callbackfunc = undefined; // 視訊事件出發回傳
	this.streamChunkSize = 0; // 伺服器回傳chunkSize大小
	this.videoname = undefined;
	this.socket.acknowledgementSize = 2500000;
	this.socket.ackMaximum = 0;
	this.socket.sequenceNumber = 0;
	this.socket.lastVideoDataSize = 0;
	this.socket.firstSN = false;
	this.socket.videoChunk = [];

	socket.on('connect', this.onSocketConnect.bind(this));
};
util.inherits(RTMPClient, events.EventEmitter);
RTMPClient.prototype.onSocketConnect = function() {
	// On connection send handshake
	var self = this;
	this.handshake = new RTMPHandshake(this);
	this.handshake.on('error', function(err) {
		console.error('ERROR::RTMPClient.prototype.onSocketConnect >> handshake error');
		log.warn('handshake error:',err);
	});
	this.handshake.on('complete', (function() {
		this.socket.chunkPacket = new Buffer(0);
		this.socket.on('data', this.onData.bind(this));
		this.socket.on('end',function () {
			self.socket.end();
			self.emit('end');
		});
		this.socket.on('error', function (e) {
			self.emit('socketError',e);
			console.log('socket error', e);
		});
		this.socket.on('close', function () {
			self.emit('socketClose');
			console.log('socket close');
		});
		this.emit('connect');
	}).bind(this));
	this.handshake.sendClientHandshake();
};
var iAcknowledgement = 0;
var max = 2500000;
/***
 * socket on data 事件
 * @param data
 */
RTMPClient.prototype.onData = function(data) {
	// log("LOG::recieved RTMP data...", "(" + data.length + " bytes)");
	var sock = this.socket;
	var chunkPacket = sock.chunkPacket;

	if (this.isVideoStream) {

		if (sock.ackMaximum > 0) sock.sequenceNumber += data.length; //record by total chunk size
		if (sock.sequenceNumber > (sock.ackMaximum * 0.95) && sock.ackMaximum > 0) {

			log('Acknowledgement %s', sock.sequenceNumber);
			this.setAcknowledgement(sock.sequenceNumber);
			sock.ackMaximum = sock.ackMaximum + sock.acknowledgementSize;

		}else if(sock.sequenceNumber > 1250000 && !sock.firstSN) {
			log('Acknowledgement %s', sock.sequenceNumber);
			this.setAcknowledgement(sock.sequenceNumber);
			sock.firstSN = true;
		}
		// Listener FMS response packet
		if ((data[0] == 0x02 || data[0] == 0x03 || data[0] == 0x04) && this.callbackfunc) {
			if (this.callbackfunc instanceof Function) {
				this.callbackfunc(data);
				// this.callbackfunc = undefined;
				return;
			};
		}
		else
		{
			var fmt = data.readUInt8(0) >> 6;
			var csid = data.readUInt8(0) - fmt;
			// csid = 2 is message type
			if (csid == 2 && fmt < 4 && data.length == 18) {
				var typeID = undefined;
				var timestamp = undefined;
				var dlength = undefined;
				// chunk Msg Header length = 11;
				if (fmt < 3) {
					typeID = data.readUInt8(7);
				}
				if (fmt <= 2) {
					timestamp = data.readUInt24BE(1);
				}
				if (fmt <= 1) {
					dlength = data.readUInt24BE(4);
				}

				if (fmt == 0 && typeID == 0x04) {
					// I think is a ping request ??
					// Server Ping Request (0x04)
					var num = data.readInt32BE(14); // get timestamp value
					this.pingResponse(num);
				}

				console.log('control message');

			}else {
				this.emit('videoData',data);
			}




			//------------------------------------------

			if (typeID === 9 && csid === 4) {
				//
			}else if(typeID === 3 || typeID === 0x1F)  {
				// console.log('!!!!!!! PingRequest !!!!!!', data.length, typeID);

				// log.logHex(data.slice(0,18));
				// var num = data.readInt32BE(14); // get timestamp value
				// this.pingResponse(num);
			}


			// console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
			// log.logHex(data.slice(0,512));
			// console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~');


		}

		return;
	}

	/**
	 * #1 這邊主要處理0x03開頭有沒有
	 * #2 0 > 沒有就認定是前個封包
	 * #3 1 > 這個封包
	 **/
	if (data[0] == 0x02) {this.emit("data", data); return;}
	if (data[0] != 0x03) {
		chunkPacket = Buffer.concat([chunkPacket, data],chunkPacket.length + data.length);
		data = chunkPacket;
	}else{
		chunkPacket = data;
	}

	//start 過濾C3
	var len = 0;
	var passcount = 0;
	const chunkType = (data.readUInt8(0))>>6;
	const headerLength = (chunkType == 0 ? 11 : (chunkType == 1 ? 7 : (chunkType == 2 ? 3 : 0 ) ) );
	const chunkSize = 128;
	while (len < data.length) {
		var obj = data[len];
		var nextAbove = (passcount+1) * chunkSize + headerLength+1;
		if (obj == 0xC3 && len == nextAbove) {
			console.log('0xC3 -> from above in :', (passcount+1)*128 + headerLength+1,len);
			data = Buffer.concat([data.slice(0,len),data.slice(len+1,data.length)],data.length-1);
			passcount++;
		}else
		{
			len++;
		}
	}
	//end 過濾C3
	console.log('::::PASS 0xC3 value (%d)::::', passcount);
	var s = "";
	for (var i = 0; i < data.length; i++) {
		s = s + ","+ data[i];
	}
	console.log("[Debug] chunkPacket size:%d, data size:%d", chunkPacket.length, data.length);

	if (!this.message || this.message.bytesRemaining == 0) {
		this.message = new RTMPMessage(data);
		this.message.on('complete', this.onMessage.bind(this));
	}
	this.message.parseData(data);
};

RTMPClient.prototype.onMessage = function() {
	this.emit("message", this.message);

	if (this.message.messageHeader.messageType == RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE) {
		switch (this.message.data.commandName) {
			case "_error":
				this.emit("error", this.message.data.arguments);
				break;
			case "close":
				this.socket.end();
				this.emit("close");
				break;
		}
	}
}

RTMPClient.prototype.sendInvoke = function(commandName, transactionId, commandObj, invokeArguments) {
	// TODO: create RTMPInvoke class to parse and/or handle this (that inherits from a general RTMPPacket class)
	var commandNameSerialiser = new AMF.AMFSerialiser(commandName);
    var transactionIdSerialiser = new AMF.AMFSerialiser(transactionId);
    var commandObjSerialiser = new AMF.AMFSerialiser(commandObj);
    if (invokeArguments !== undefined) {
    	var invokeArgumentsSerialiser = new AMF.AMFSerialiser(invokeArguments);
    }

    var amfLength = commandNameSerialiser.byteLength + transactionIdSerialiser.byteLength + commandObjSerialiser.byteLength + ((invokeArguments !== undefined) ? invokeArgumentsSerialiser.byteLength : 0);
    var amfOffset = 0;
    var amfData = new Buffer(amfLength);
    commandNameSerialiser.write(amfData.slice(amfOffset, commandNameSerialiser.byteLength));
    amfOffset += commandNameSerialiser.byteLength;
    transactionIdSerialiser.write(amfData.slice(amfOffset, amfOffset + transactionIdSerialiser.byteLength));
    amfOffset += transactionIdSerialiser.byteLength
    commandObjSerialiser.write(amfData.slice(amfOffset, amfOffset + commandObjSerialiser.byteLength));
    amfOffset += commandObjSerialiser.byteLength;
    if (invokeArguments !== undefined) {
    	invokeArgumentsSerialiser.write(amfData.slice(amfOffset, amfOffset + invokeArgumentsSerialiser.byteLength));
    }

	this.sendPacket(0x03, RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, amfData);
};
RTMPClient.prototype.sendInvokeMessage = function(commandName, transactionId, commandObj, invokeArguments) {
	// TODO: create RTMPInvoke class to parse and/or handle this (that inherits from a general RTMPPacket class)
	var commandNameSerialiser = new AMF.AMFSerialiser(commandName);
	var transactionIdSerialiser = new AMF.AMFSerialiser(transactionId);
	var commandObjSerialiser = new AMF.AMFSerialiser(commandObj);
	if (invokeArguments !== undefined) {
		var invokeArgumentsSerialiser = new AMF.AMFSerialiser(invokeArguments);
	}

	var amfLength = commandNameSerialiser.byteLength + transactionIdSerialiser.byteLength + commandObjSerialiser.byteLength + ((invokeArguments !== undefined) ? invokeArgumentsSerialiser.byteLength : 0);
	var amfOffset = 0;
	var amfData = new Buffer(amfLength);
	commandNameSerialiser.write(amfData.slice(amfOffset, commandNameSerialiser.byteLength));
	amfOffset += commandNameSerialiser.byteLength;
	transactionIdSerialiser.write(amfData.slice(amfOffset, amfOffset + transactionIdSerialiser.byteLength));
	amfOffset += transactionIdSerialiser.byteLength
	commandObjSerialiser.write(amfData.slice(amfOffset, amfOffset + commandObjSerialiser.byteLength));
	amfOffset += commandObjSerialiser.byteLength;
	if (invokeArguments !== undefined) {
		invokeArgumentsSerialiser.write(amfData.slice(amfOffset, amfOffset + invokeArgumentsSerialiser.byteLength));
	}

	this.sendPacket(0x14, RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, amfData);
};
RTMPClient.prototype.fmsCall = function (commandName, arg) {
	//command name名稱
	var s1 = new AMF.AMFSerialiser(commandName);
	//streamid 1 - fms通道
	var s2 = new AMF.AMFSerialiser(1);
	var args = [{}];
	var count = arguments.length;
	while (count-- > 0) {
		args.push(arguments[count]);
	}
	var body = amfUtils.amf0Encode(args);
	var buf = new Buffer(s1.byteLength + s2.byteLength).fill(0x0);
	s1.write(buf.slice(0,s1.byteLength));
	s2.write(buf.slice(s1.byteLength,s1.byteLength + s2.byteLength));
	buf = Buffer.concat([buf, body]);
	if (this)
		this.sendPacket(0x14, RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, buf);
};
/**
 * 0x18 - Ping Message
 * @param num timestamp
 */
RTMPClient.prototype.pingResponse = function (num) {
	var rtmpBuffer = new Buffer('4200000000000604000700000000', 'hex');
	rtmpBuffer.writeUInt32BE(num, 10);
	// //console.log('windowACK: '+rtmpBuffer.hex());
	log.logHex(rtmpBuffer);
	this.socket.write(rtmpBuffer);
};
/**
 * 0x05 – Window Acknowledgement Size
 * @param size
 */
RTMPClient.prototype.setWindowACK = function (size) {
	// var rtmpBuffer = new Buffer('023b659c000004050000000000000000', 'hex');
	var rtmpBuffer = new Buffer('02d5d359000004050000000000000000', 'hex');
	rtmpBuffer.writeUInt32BE(size, 12);
	// //console.log('windowACK: '+rtmpBuffer.hex());
	log.logHex(rtmpBuffer);
	this.socket.write(rtmpBuffer);

};
RTMPClient.prototype.setAcknowledgement = function (size) {
	var rtmpBuffer = new Buffer('420000000000040300000000', 'hex');
	rtmpBuffer.writeUInt32BE(size, 8);
	this.socket.write(rtmpBuffer);
};
RTMPClient.prototype.acknowledgement = function (size) {
	var rtmpBuffer = new Buffer('c20000000000', 'hex');
	rtmpBuffer.writeUInt32BE(size, 2);
	console.log(rtmpBuffer);
	this.socket.write(rtmpBuffer);
};

RTMPClient.prototype.setBufferLength = function (size) {
	var rtmpBuffer = new Buffer('4200000000000a040003000000000000012c', 'hex');
	// rtmpBuffer.writeUInt32BE(size, 12);
	this.socket.write(rtmpBuffer);
};

/**
 * 0x06 – Set Peer Bandwidth
 * @param size
 * @param type
 */
RTMPClient.prototype.setPeerBandwidth = function (size, type) {
	var rtmpBuffer = new Buffer('0200000000000506000000000000000000', 'hex');
	rtmpBuffer.writeUInt32BE(size, 12);
	rtmpBuffer[16] = type;
	// //console.log('setPeerBandwidth: '+rtmpBuffer.hex());
	this.socket.write(rtmpBuffer);
};
/**
 * 0x01 – Set Chunk Size
 * @param size
 */
RTMPClient.prototype.setChunkSize = function (size) {
	var rtmpBuffer = new Buffer('02000000000004010000000000000000', 'hex');
	rtmpBuffer.writeUInt32BE(size, 12);
	// //console.log('setChunkSize: '+rtmpBuffer.hex());
	this.socket.write(rtmpBuffer);
};
RTMPClient.prototype.sendPacket = function(channel, messageType, data) {
	//TODO: Check if given a RTMPPacket object that specifies channel, messageType, data inside the object (e.g. RTMPInvoke)

	// If we aren't handshaken, then defer sending until we have
	if (!this.handshake || this.handshake.state != RTMPHandshake.STATE_HANDSHAKE_DONE) {
		this.on('connect', (function(){ // TODO: test this works correctly and does not end up with undefined parameters
			console.log('ERROR !!!!!!! then defer sending until we have');
			this.sendPacket(channel, messageType, data);
		}).bind(this));
		return;
	}

	var message = new RTMPMessage();
    var rawData = message.sendData(channel, messageType, data);

	if (level.sendRTMPPacket) {
		log("sending RTMP packet...",  "(" + rawData.length + " bytes)");
		log.logHex(rawData);
	}

	this.socket.write(rawData);

}

RTMPClient.prototype.sendRawData = function(packet) {
	log("sending raw data...", "(" + packet.length + " bytes)");
	log.logHex(packet);
	console.log('LOG::RTMPClient.prototype.sendRawData (w)');
	this.socket.write(packet);
};

RTMPClient.prototype.createStream = function(name) {
	var self = this;
	this.isVideoStream = true;
	this.callbackfunc = function (data) {
		console.log('callbasekfunc createStream');
		var fmsObj = amfUtils.decodeAmf0Cmd(data.slice(12, data.length));
		// console.log(amfUtils.decodeAmf0Cmd(fmsObj));
		if (fmsObj.cmd == "_result" && fmsObj.info == 1) {
			console.log('createStream successful');
			self.callbackfunc = undefined;
			self.emit("createStreamEvent",fmsObj.info);
		};
	};

	this.sendInvoke('createStream',2,{});

};

RTMPClient.prototype.streamPlay = function(name) {
	console.log('TRACE >> sending play(%s)',name );
	var self = this;

	var header = new Buffer('080000b800001c110100000000','hex');
	var cmdName = amfUtils.amf0encString("play");
	var tranID = amfUtils.amf0encNumber(0); // transactionID = 0
	var cmdObj = amfUtils.amf0encNull(); // Command Object = NULL
	var stramName = amfUtils.amf0encString(name);
	var bodySize = cmdName.length + tranID.length + cmdObj.length + stramName.length + 1;
	console.log('length:', bodySize);
	header.writeUInt24BE(bodySize,4);
	var body = Buffer.concat([header,cmdName, tranID, cmdObj, stramName], header.length + cmdName.length + tranID.length + cmdObj.length + stramName.length);
	self.callbackfunc = function (data) {
		// self.callbackfunc = null;
		// #1 server SetChunkSize
		var iPacket = self.filterPacket(data);

		if (iPacket.header.CSID == 2 && iPacket.header.typeID == 0x01) {
			var chunkSize = iPacket.header.bodyBuf.readUInt32BE(0);
			console.log('server SetChunkSize(4): ', chunkSize);
			self.streamChunkSize = chunkSize;

			data = data.slice(iPacket.header.offset, data.length);
		}

		// #2 User Control Message Stream Begin 1

		iPacket = self.filterPacket(data);
		if (iPacket.header.CSID == 2 && iPacket.header.typeID == 0x04) {
			// #2-1 2bytes event type
			var eventType = iPacket.header.bodyBuf.readUInt16BE(0);
			var eventData = iPacket.header.bodyBuf.readUInt32BE(2);
			console.log('server eventType:%d eventData:%d ', eventType, eventData);

			data = data.slice(iPacket.header.offset, data.length);

		}

		// #3 AMF0 Command onStatus('NetStream.Play.Reset') //

		iPacket = self.filterPacket(data);

		if (iPacket.header.CSID == 4 && iPacket.header.typeID == 0x14)
		{
			var cmdStatusReset = amfUtils.decodeAmf0Cmd(iPacket.header.bodyBuf);

			console.log('onStatus Reset:', cmdStatusReset);

			data = data.slice(iPacket.header.offset, data.length);
		}
		console.log('iPacket.header.typeID ', iPacket.header.typeID);

		// #4 AMF0 Command onStatus('NetStream.Play.Start') //

		if(data.length > 0) {

			iPacket = self.filterPacket(data);
			if (iPacket.header.CSID == 4 && iPacket.header.typeID == 0x14) {

				var cmdStatusStart = amfUtils.decodeAmf0Cmd(iPacket.header.bodyBuf);

				console.log('amfObj Start:', cmdStatusStart);

				data = data.slice(iPacket.header.offset, data.length);
			}
		}

		// #4 AMF0 Data |RtmpSampleAccess() //

		if(data.length > 0) {

			iPacket = self.filterPacket(data);
			if (iPacket.header.CSID == 4 && iPacket.header.typeID == 0x12) {

				var rtmpSampleAccess = amfUtils.amf0Decode(iPacket.header.bodyBuf);

				console.log('amfObj RtmpSampleAccess:', rtmpSampleAccess);

				data = data.slice(iPacket.header.offset, data.length);

			}
		}

		// #5 AMF0 Data onMetaData() //
		if (data.length > 0) {
			iPacket = self.filterPacket(data);
			if (iPacket.header.CSID == 4 && iPacket.header.typeID == 0x12) {

				var amfObj = amfUtils.amf0Decode(iPacket.header.bodyBuf);
				console.log('amfObj onMetaData:', amfObj);

				data = data.slice(iPacket.header.offset, data.length);
			}
		}

		if(data.length > 0) {
			console.log('data > 0');
			iPacket = self.filterPacket(data);
			if (iPacket.header.CSID == 4 && iPacket.header.typeID == 0x09) {
				console.log('video Data > 0x09');
				// log.logHex(data);
				self.emit('videoData', data);
				self.callbackfunc = null;
			}
			// log.logHex(data);
		}

		console.log('play successful');
	};
	self.socket.write(body);

};

/** Close FMS Stream **/
RTMPClient.prototype.deleteStream = function () {

	var header = new Buffer(8);
	var offset = 0;
	header.writeInt8(0x43,offset++); // 01 00 00 11
	var timestamp = os.uptime() - this.uptime;
	header.writeUInt24BE(timestamp,offset);
	offset += 3;

	var cmdName = amfUtils.amf0encString("deleteStream");
	var tranID = amfUtils.amf0encNumber(0);
	var cmdObj = amfUtils.amf0encNull();
	var inkove = amfUtils.amf0encNumber(1);

	var bodySize = cmdName.length + tranID.length + cmdObj.length + inkove.length;

	header.writeUInt24BE(bodySize, offset);
	offset += 3;
	header.writeUInt8(0x11,offset++);

	var buf = Buffer.concat([header, cmdName, tranID, cmdObj, inkove],( header.length + bodySize.length ));

	this.sokcet.write(buf);

};

RTMPClient.prototype.filterPacket = function (data) {
	var chunk1st = data.readUInt8(data);
	var fmt = chunk1st >> 6;
	var CSID = chunk1st & (0x3f);
	var iRTMPPacket = {header:{fmt:fmt, CSID:CSID}};
	var headerBytesLength = 0;
	var offset = 1;
	if (fmt === 0) {
		headerBytesLength = 12; //header (full header).
		var header = data.slice(0,headerBytesLength);
		var timestamp = header.readUInt24BE(offset);
		offset += 3;
		var bodySize = header.readUInt24BE(offset);
		offset += 3;
		var typeID = header.readUInt8(offset);
		offset += 1;
		var streamID = header.readUInt32LE(offset); //Message ID
		offset += 4;

		var body = data.slice(12, 12 + bodySize);
		console.log(' fmt:%d \n csid:%d \n timestamp:%s \n bodySize:%d \n typeID(message):%d(%s) \n streamID:%d \n ' +
			'offset:%d \n data-len: %d \n',
			fmt, CSID,timestamp, bodySize,typeID, "0x" + typeID.toString(16), streamID,
			offset,data.length
		);
		offset += bodySize;

		iRTMPPacket.header = {
			fmt: fmt,
			CSID: CSID,
			timestamp: timestamp,
			bodySize: bodySize,
			typeID: typeID,
			streamID: streamID,
			bodyBuf: body,
			offset: offset
		};

	}else if (fmt === 1) {
		headerBytesLength = 8 ; //like type b00. not including message ID (4 last bytes).
		var basicHeader = data.slice(0,headerBytesLength);
		var timestamp = basicHeader.readUInt24BE(offset);
		offset += 3;
		var bodySize = basicHeader.readUInt24BE(offset);
		offset += 3;
		var typeID = basicHeader.readUInt8(offset);
		offset += 1;
		iRTMPPacket.header = {
			fmt: fmt,
			CSID: CSID,
			timestamp: timestamp,
			bodySize: bodySize,
			typeID: typeID,
			offset: offset
		};

	}else if (fmt === 2) {
		headerBytesLength = 4; //Basic Header and timestamp (3 bytes) are included.
		var basicHeader = data.slice(0,headerBytesLength);
		var timestamp = basicHeader.readUInt24BE(offset);
		offset += 3;
		iRTMPPacket.header = {
			fmt: fmt,
			CSID: CSID,
			timestamp: timestamp,
			offset: offset
		};

	}else if (fmt === 3) {
		headerBytesLength = 1; //only the Basic Header is included.

		iRTMPPacket.header = {
			fmt: fmt,
			CSID: CSID,
			offset: offset
		}

	}

	return iRTMPPacket;
};

RTMPClient.prototype.netStreamConnect = function (name) {

	var self = this;
	
	this.on('createStreamEvent', function (result) {
		self.streamPlay(name);
	});

	this.createStream(name);
	
};

RTMPClient.prototype.connectResponse = function () {

	var self = this;

	self.isVideoStream = true;
	self.callbackfunc = function (data) {

		try {
			var iPacket = self.filterPacket(data); //id = 5

			console.log('Window Acknowledgement Size(Message Type ID=5)', iPacket.header.bodyBuf.readUInt32BE(0));

			if (iPacket.header.typeID){
				self.socket.ackMaximum = iPacket.header.bodyBuf.readUInt32BE(0);
				self.socket.acknowledgementSize = iPacket.header.bodyBuf.readUInt32BE(0);
				self.setWindowACK(iPacket.header.bodyBuf.readUInt32BE(0));
				// this.setBufferLength(0);
			}

			data = data.slice(iPacket.header.offset, data.length);

			iPacket = self.filterPacket(data); //id = 6

			// console.log('Set Peer Bandwidth(Message Type ID=6)', iPacket.header.bodyBuf.readUInt32BE(0));

			data = data.slice(iPacket.header.offset, data.length);

			iPacket = self.filterPacket(data); //id = 1

			// console.log('Set Chunk Size (Message Type ID=1)', iPacket.header.bodyBuf.readUInt32BE(0));

			data = data.slice(iPacket.header.offset, data.length);

			iPacket = self.filterPacket(data); //id = 1

			// var dataLength = iPacket.header.bodyBuf.length;
			var cmd = amfUtils.decodeAmf0Cmd(iPacket.header.bodyBuf);

			// console.log('Data(Message Type ID=6)', amfUtils.amf0DecodeOne(iPacket.header.bodyBuf.slice(19,iPacket.header.bodyBuf.length)));

			self.callbackfunc = undefined;

			// //紀錄一下connect回傳結果
			// if (!self.resInvoke) self.resInvoke = {};
			// self.resInvoke["connect" + cmd.cmd] = cmd;
			cmd.name = "connect" + cmd.cmd;
			self.emit('status', cmd);

		}
		catch (e) {
			// logMyErrors(e); // print to sys info
			console.error('RTMPClient.prototype.connectResponse error:', e);
		}

	};

};



RTMPClient.connect = function(host, port, connectListener) {
	const DEFAULT_PORT = 1935;
	var client;
	if (!connectListener && typeof port == "function") {
		connectListener = port;
		port = DEFAULT_PORT;
	}
	var socket = new net.Socket();
	socket.connect(port || DEFAULT_PORT, host);

	client = new RTMPClient(socket);
	socket.on('error', function (err) {
		client.emit('error',err);
	});
	if (connectListener && typeof connectListener == "function") 
		client.on('connect', connectListener);
	return client;
};
// RTMPClient.connectComplete = function (host, port, complete) {
// 	var rtmp = libRtmp.RTMPClient.connect(host,port, function () {
// 		rtmp.sendInvoke('connect', 1, {
// 			app: "motest/g1",
// 			flashVer: "MAC 10,0,32,18",
// 			tcUrl: "rtmp://43.251.76.107:23/motest/g1",
// 			fpad: false,
// 			capabilities: 15.0,
// 			audioCodecs: 0.0,
// 			videoCodecs: 252.0,
// 			videoFunction: 1.0
// 		});
// 	});
// };