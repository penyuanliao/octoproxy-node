/**
 * Created by Benson.Liao on 2016/8/12.
 */
var net = require('net');
const tryMsgType = false;
console.log('::::::: UnitTest Game LB Server :::::::');

process.on('message', function (msg) {

    if (tryMsgType) {
        console.log('Process receive Message type of', typeof msg , JSON.stringify(msg));
    }


    if (msg.action == 'getPath') {
        //todo run something
        var o = {};
        o.action = "onGetPath"; // or onBusy
        o.tokencode = msg.tokencode;
        o.path = "/Hall/service.h1";
        process.send(o);

        console.log('message',"GLBS:getPath Event");

    }
    if(msg.evt == "processInfo") {
        process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}});
    }
});