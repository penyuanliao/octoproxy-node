/**
 * Created by Benson.Liao on 16/1/5.
 */
var config = module.exports = {};
config.appConfig = appParames();
config.env = process.env.NODE_ENV;
/**
 * host: ip4 - '0.0.0.0', ip6 - '::'
 *
 * Backlog: pending connections
 * **/
config.numCPUs = require('os').cpus().length;
/*
 bFMSHost:"10.251.34.14",
 bFMSPort:1935,
 bNodePort:80
* */
/** 開發環境設定 **/
if (config.env == 'development') {
    config.bFMSHost = "43.251.76.26"; //107 3.5
    config.bFMSPort = 443;
    config.srvOptions = {
        'host': '0.0.0.0',
        'port': config.appConfig.port,
        'closeWaitTime':5000,
        'backlog': 2048
    };
    //建立第二台一樣服務只需複製一樣設定即可
    config.forkOptions = {
        'webCluster':'',
        'webNum':0,
        'cluster': [{
            file:'./FxBridgeSrv.js',
            assign:'HallPic'
        },{
            file:'./FxBridgeSrv.js',
            assign:'Hall'
        },{
            file:'./FxBridgeSrv.js',
            assign:'BacPlayerLight'
        }]
    };
} else {
    /** 伺服器環境設定 **/
    if (config.env == 'QA'){
        config.bFMSHost = "10.251.34.14";
    }else
    {
        config.bFMSHost = "10.251.34.26";
    }
    config.bFMSPort = 1935;
    config.srvOptions = {
        'host': '0.0.0.0',
        'port': config.appConfig.port,
        'closeWaitTime':5000,
        'backlog': 511
    };
    config.forkOptions = {
        'webCluster':'',
        'webNum':0,
        'cluster': [{
            file:'./FxBridgeSrv.js',
            assign:'BacPlayerLight'
        },{
            file:'./FxBridgeSrv.js',
            assign:'Hall'
        },{
            file:'./FxBridgeSrv.js',
            assign:'HallPic'
        },{
            file:'./FxBridgeSrv.js',
            assign:'BacPlayerBM'
        },{
            file:'../www/slot/slot.js',
            assign:'slotFX'
        },{
            file:'../www/demo/application3.js',
            assign:'figLeaf'
        }]
    };
}
config.assignRule = [];
/** FMS連線Port **/
config.rtmpPort = 1935;
//todo define the balance
config.balance = 'leastconn';//roundrobin

/**
 * Application parameters
 * @param -p port
 * @param -f loadfile or remote link
 * **/
function appParames(){
    var args = {};
    process.argv.forEach(function(element, index, arr) {
        // Processing

        if (element === "-p") {
            var port = parseInt(process.argv[index + 1]);

            args["port"] = !isNaN(port) ? port : ((config.env == 'development') ? 8000:80);
        }else if (element === "-f") {
            var fileName = process.argv[index + 1];
            if (!fileName && typeof fileName != "undefined" && fileName !=0) {
                fileName = "";
                throw "fileName no definition.";
            }
            args["fileName"] = fileName.split(" ");
        }else if (element === "-v" ){
            var rtmpHost = process.argv[index + 1];
            if (!rtmpHost && typeof rtmpHost != "undefined" && rtmpHost !=0) {
                throw "RTMP Host no definition.";
            }else {
                config.rtmpHostname = rtmpHost;
            }
        }

            });

    return args;
}