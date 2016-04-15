var net = require('net'),
	events = require('events'),
	util = require('util'),
	os = require('os');

var AMF = require('./amf');
var RTMPHandshake = require('./handshake');
var RTMPMessage = require('./message');
var amfUtils = require('./amfUtils');
var log = require('./log');

var level ={'sendRTMPPacket':true};

var RTMPClient = module.exports = function(socket) {
	console.log('LOG::NEW RTMPClient');
	this.socket = socket;
	this.socket.name = new Date().getTime();
	this.state = 'connecting'; 
	socket.on('connect', this.onSocketConnect.bind(this));
};
util.inherits(RTMPClient, events.EventEmitter);
RTMPClient.prototype.onSocketConnect = function() {
	console.log('LOG::RTMPClient.prototype.onSocketConnect');
	// On connection send handshake
	this.handshake = new RTMPHandshake(this);
	this.handshake.on('error', function(err) {
		console.log('ERROR::RTMPClient.prototype.onSocketConnect >> handshake error');
		log.warn('handshake error:',err);
	});
	this.handshake.on('complete', (function() {
		log('handshake complete');
		this.socket.on('data', this.onData.bind(this));
		this.socket.on('end',function () {
			this.socket.end();
			this.emit('end');
		});
		this.socket.on('error', function (e) {
			this.emit('socketError',e);
		});
		this.socket.on('close', function () {
			this.emit('socketClose');
		});
		this.emit('connect');
	}).bind(this));
	this.handshake.sendClientHandshake();
};
/***
 * socket on data 事件
 * @param data
 */
var chunkPacket = new Buffer(0);
RTMPClient.prototype.onData = function(data) {
	//log("LOG::recieved RTMP data...", "(" + data.length + " bytes)");
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
	var len = data.length - 1;
	var passcount = 0;
	while (len >= 0) {
		var obj = data[len];
		if (obj == 0xC3) {
			data = Buffer.concat([data.slice(0,len),data.slice(len+1,data.length)],data.length-1);
			passcount++;
		}else
		{
			len--;
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
		this.message.name = "bytes_"+data.length;
		this.message.on('complete', this.onMessage.bind(this));
	}
	this.message.parseData(data);
}


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
	console.log('LOG::RTMPClient.prototype.sendInvoke');
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
	console.log('LOG::RTMPClient.prototype.sendInvoke');

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
	var rtmpBuffer = new Buffer('023b659c000004050000000000000000', 'hex');
	rtmpBuffer.writeUInt32BE(size, 12);
	// //console.log('windowACK: '+rtmpBuffer.hex());
	log.logHex(rtmpBuffer);
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
		log.logHex(data);
	}
	this.socket.write(rawData);

}

RTMPClient.prototype.sendRawData = function(packet) {
	log("sending raw data...", "(" + packet.length + " bytes)");
	log.logHex(packet);
	console.log('LOG::RTMPClient.prototype.sendRawData (w)');
	this.socket.write(packet);
}

RTMPClient.connect = function(host, port, connectListener) {
	console.log('LOG::RTMPClient.connect');
	const DEFAULT_PORT = 1935;
	if (!connectListener && typeof port == "function") {
		connectListener = port;
		port = DEFAULT_PORT;
	}
	var socket = new net.Socket();
	socket.connect(port || DEFAULT_PORT, host);
	var client = new RTMPClient(socket);
	if (connectListener && typeof connectListener == "function") 
		client.on('connect', connectListener)
	return client;
};
RTMPClient.connectComplete = function (host, port, complete) {
	var rtmp = libRtmp.RTMPClient.connect(host,port, function () {
		rtmp.sendInvoke('connect', 1, {
			app: "motest/g1",
			flashVer: "MAC 10,0,32,18",
			tcUrl: "rtmp://43.251.76.107:23/motest/g1",
			fpad: false,
			capabilities: 15.0,
			audioCodecs: 0.0,
			videoCodecs: 252.0,
			videoFunction: 1.0
		});
	});
};