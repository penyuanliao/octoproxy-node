/**
 * Created by Benson.Liao on 2016/11/17.
 */
const amf3Utils = require('./amf3Utils.js');
const amfUtils = require('../amfUtils.js');
function AmfOutgoingMessage() {
    this.AMFVersion = 3; //0:AMF0, 3:AMF3
    this.Header_Count = 0;
    this.Message_Count = 1;
    this.Messages = {};
    this.response_count = 0;
    this.buffer = new Buffer(2048);
    this.offset = 0;
    this.amf3Serializer = new amf3Utils.serializer();
    this.amf3Deserializer = new amf3Utils.deserializer();

    console.log('AmfOutgoingMessage');
}
AmfOutgoingMessage.prototype.setCommandName = function (cmdName) {
    this.Messages["TargetURI"]   = cmdName;
    this.Messages["ResponseURI"] = "/" + (++this.response_count);
};
AmfOutgoingMessage.prototype.call = function (cmmandName/* args */) {

    console.log('call', cmmandName);
    this.Messages["CommandName"]   = cmmandName; // TargetURI
    this.Messages["ResponseURI"]   = "/" + (++this.response_count);
    this.Messages["MessageLength"] = 0;
    console.log(arguments.length);
    var strictArr = [];
    strictArr.push(1);
    // strictArr.push(0x11);
    var args = Array.prototype.slice.call(arguments);
    args.shift();
    this.writeMessage.apply(this,args);
};
AmfOutgoingMessage.prototype.writeMessage = function () {
    var i, buf, buf2;
    var strictArray = [];

    if (this.AMFVersion == this.ObjectEncoding.AMF0) {
        for (i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            strictArray.push(arg);
        }
        buf = amfUtils.amf0encSArray(strictArray);
    }else {
        buf = amfUtils.amf0encSArray(strictArray); // Strict array header
        
        buf.writeInt8(arguments.length, 4); // set Array Length
        var AMFToAMF3 = Buffer.from([0x11]); // change encode to amf3

        var body = [];

        for (i = 1; i < arguments.length; i++) {
            body.push(arguments[i]);
        }

        var AMF3Message = this.amf3Serializer.amf3Encode(arguments[1], amf3Utils.AMF_Constants.AMF3_OBJECT);
        var dec = this.amf3Deserializer.amf3Decode(Buffer.from("0a0b010b76616c75650404096e616d6509030106033101", 'hex'));

        for (i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            strictArray.push(arg);
        }
        buf2 = amfUtils.amf0encSArray(strictArray);

        console.log(arguments[1],AMF3Message,dec, this.amf3Deserializer.amf3Decode(AMF3Message));
        var d = new Date();
        console.log(buf,strictArray, d.getTime(), d.getMilliseconds());
    }
    //0a 0b 01 03 30 04 01 03 31 0a 01 09 6e 61 6d 65 09 03 01 06 02 0b 76 61 6c 75 65 04 01 01 01
};

AmfOutgoingMessage.__defineSetter__("objectEncoding", function (value) {
    this.AMFVersion = value;
});

AmfOutgoingMessage.prototype.ObjectEncoding = {
    AMF0: 0,
    AMF3: 3
};

module.exports = exports = AmfOutgoingMessage;