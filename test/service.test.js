const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const FxConnection  = fxNetSocket.netConnection;

function Service() {
    this.setup();
}
Service.prototype.setup = function () {
    const option = {
        //[啟用]監聽事件
        runListen: true,
        //[啟用]全域變數監聽
        glListener:false,
        //[啟用]全域變數事件
        baseEvtShow: true,
        //[啟用]接收message事件為Binary data
        binary: true,
        //[啟用]版本
        baseVersion: "v2",
        //[啟用]是否壓縮資料
        zlibDeflatedEnabled: true
    };
    const server = new FxConnection(8000, option);
    server.userPingEnabled = false;
    // server.setBinaryType = "arraybuffer";
    server.on("connection", this.onConnection.bind(this));
    server.on("Listening", function () {
        const info = server.app.address();
        console.log("The service has started to address [%s]:%s. ", info.address, info.port);
    });
};
Service.prototype.onConnection = function (client) {
    console.log('onConnect');
    client.on("connect", function () {
        console.log('connect');
    })
    client.on("message", function (json) {
        setTimeout(function () {
            client.write(json)
        }, 5000);
    });
};

const main = new Service();