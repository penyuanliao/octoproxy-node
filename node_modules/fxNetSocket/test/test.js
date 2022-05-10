/**
 * Created by Benson.Liao on 2016/10/14.
 */
console.log('create');

setInterval(function () {
    // console.log('runing');
},100);

process.on('message', function (data, handle) {
    var json = data;
    if (typeof json === 'string') {
        process.send({"action":"test", "data": data});
    }else if(typeof json === 'object'){

        if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
        }else{
            console.log('debug', 'out of hand. dismiss message');
        }

    }
});