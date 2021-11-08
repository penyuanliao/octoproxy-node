
const net = require("net");
const socket = new net.Socket();
socket.on("data", function (data) {
    console.log(data.toString());
})
socket.connect( 8000, function () {
    socket.end("/x-ping-pong")
});
