/**
 * Created by Benson.Liao on 16/3/9.
 */
const net = require('net');
var client = new net.Socket();
client.connect(80, '127.0.0.1', function () {
    console.log('connect');
    /** 重要 - 因為要辨識是websocket或socket 由第一個封包來確認是否為socket所以送個0 **/
    //#1 送出確認狀態
    client.write("/motest/g1");
    //#2 送出RTMP連線
    //client.write(JSON.stringify({event:"Connect", data:"rtmp://10.251.40.14:1935/motest/g1"}));
    //client.write(JSON.stringify({event:"Connect", data:"motest/g1"}))

});
client.on('data', function(data) {
    console.log('DATA: ' + data);
    var json = JSON.parse(data);
    //#3 接收RTMP連線狀態
    if (json.NetStatusEvent === "Connected.amfIsReady") {
        //FMS setObj func
        var sample = [ {a1: 'this a1 1234567890',
            a2: [ 1, 2, 3, '5', '4' ],
            a3: { name: 'be' },
            a4: 123 }];
        client.write(JSON.stringify({event:"Send",data:sample}));

        //FMS serverHandlerAMF
        //client.write(JSON.stringify(JSON>stringify(/*要送出的Object*/));
    }else if(json.cmd == "dadadaamf"){
        console.log('data:',json.args);
    }
});
client.on('close', function() {
    console.log('Connection closed');
});