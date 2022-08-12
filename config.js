/**
 * Created by Benson.Liao on 16/1/5.
 */
/**
 * @constructor
 */
function config() {
}

/** @type {{}} */
config.appConfig = appParames();
/**
 * @property {Object} env
 */
config.env = process.env.NODE_ENV;
config.pkg_compiler = (typeof process.versions.pkg != "undefined" && typeof process.pkg != "undefined");
process.env.pkg_compiler = config.pkg_compiler;
if (config.pkg_compiler) process.pkg.compiler = true;
const path = require("path");
var octo;
try {octo = require(path.join(process.cwd(), "octo.json")); } catch (e) {}
/**
 * host: ip4 - '0.0.0.0', ip6 - '::'
 * FX
 * Backlog: pending connections
 * **/
config.numCPUs = require('os').cpus().length;

config.InfluxDBConf = Object.freeze({
    enabled: false,
    port: 10084,
    host: "192.168.188.123"
});
/**
 * FxLogger 監控Log資料接收Port
 * @type {number}
 */
config.WPC_Logging_Port = 10080;
/**
 * 服務對外Port
 * @type {number}
 */
config.WPC_HTTP_Port = 10082;
/**
 * 跟Ocoto 對接服務接口
 * @type {number}
 */
config.managePort = 8100;
/**
 * 心跳事件
 * @version 2.0.0
 * @type {string}
 */
config.heartbeat_namespace = "/x-ping-pong";
/**
 * telegram通知系統
 * @version 2.0.0
 * @type {{credentials: {bot: string, token: string}, proxyMode: {port: number, host: string}, enabled: boolean}}
 */
config.telegram = {
    credentials: {bot: "", token:""},
    proxyMode: {host: "", port: 0},
    enabled: false
};

config.specificBase = new Set([
    'ws',
    'web'
]);

config.crossPolicy = Object.freeze({
    'Access-Control-Allow-Origin': []
});
/** 開發環境設定 **/
if (config.env == 'development') {
    config.bFMSHost = require('fxNetSocket').getConfiguration("OctoProxy-Dev");
    config.bExceptions = [
        {"Host":"127.0.0.1", "rules":["/BacPlayerVip"]}
    ];
    config.bFMSPort = 1935;
    config.srvOptions = {
        'host': '0.0.0.0',
        'port': config.appConfig.port,
        'closeWaitTime':5000,
        'backlog': 511
    };
    //建立第二台一樣服務只需複製一樣設定即可
    //合併服務用逗號區隔ex:'Hall, Hall2'
    //會清除空白符號
    config.forkOptions = require('fxNetSocket').getConfig('../configuration/Assign.json');
    config.gamSLB = {
        enabled:true,
        // file: './unittest/GLBS.js',
        file: '../LoadBalancer/NodeLB.js',
        assign:'/fxLB',
        /* 處理視訊lb */
        videoEnabled:true,
        httpEnabled:true,
        vPrefix: '',
        //支援RTMP
        rtmpFrontendEnabled: false
    };
} else {
    
    /** 伺服器環境設定 **/
    config.bFMSHost = require('fxNetSocket').getConfiguration("OctoProxy");
    config.bExceptions = [
        {"Host":"127.0.0.1", "rules":["/BacPlayerVip"]}
    ];
    config.bFMSPort = 1935;
    config.srvOptions = {
        'host': '0.0.0.0',
        'port': config.appConfig.port,
        'closeWaitTime':5000,
        'backlog': 511
    };
    config.forkOptions = require('fxNetSocket').getConfig('../configuration/Assign.json');

    config.gamSLB = {
        enabled:true,
        file: '../LoadBalancer/NodeLB.js',
        assign:'/fxLB',
        /* 處理視訊lb */
        videoEnabled:false,
        httpEnabled:false,
        vPrefix: '',
        rtmpFrontendEnabled: false
    };

    if (typeof octo != "undefined") {
        if (octo.bFMSHost) config.bFMSHost = octo.bFMSHost;
        if (octo.bFMSPort) config.bFMSPort = octo.bFMSPort;
        //if (octo["loadBalancerFile"]) config.gamSLB.file = octo["loadBalancerFile"];
    }
}
if (process.env.Policy == "pipe2") {
    config.WPC_Logging_Port = 10081;
    config.WPC_HTTP_Port = 10083;
    config.managePort = 8101;
}
//todo define the balance
config.balance = 'leastconn';//roundrobin

config.tlsOptions = {
    keyFile: '',
    certFile: '',
    enabled: false
};

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
        }else if (element === "-v" ) {
            var rtmpHost = process.argv[index + 1];
            if (!rtmpHost && typeof rtmpHost != "undefined" && rtmpHost !=0) {
                throw "RTMP Host no definition.";
            }else {
                config.rtmpHostname = rtmpHost;
            }
        }else if (element === "-fo") {
            var assign = process.argv[index + 1];
            if (!assign && typeof assign != "undefined" && assign !=0) {
                config.forkOptions = require('fxNetSocket').getConfig(assign);
            }
        } else if (element === "-m") {
            args["mgmtPort"] = parseInt(process.argv[index + 1]);
        } else if (element === "--gc") {
            config.gc = true;
        } else if (element === "--push") {
            config.push = true;
        }

            });

    return args;
}



/* ************************************************************************
 SINGLETON CLASS DEFINITION
 ************************************************************************ */
function configure() {
    this.config = config;
}
configure.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
configure.getInstance = function () {
    if(this.instance === null) {
        this.instance = new configure();
    }
    return this.instance.config;
};

/**
 *
 * @type {config}
 */
module.exports = exports = configure.getInstance();
/**
 * @namespace config
 * @property srvOptions
 * @property forkOptions
 * @property appConfig
 * @property numCPUs
 * @property bFMSHost
 * @property bExceptions
 * @property bFMSPort
 * @property gamSLB
 * @property specificBase
 * @property env
 * @property balance
 * @property managePort
 * @property WPC_HTTP_Port
 * @property WPC_Logging_Port
 **/
/**
 * @namespace srvOptions
 * @property host
 * @property port
 * @property closeWaitTime
 * @property backlog
 **/
/**
 * @namespace gamSLB
 * @property enabled
 * @property file
 * @property assign
 **/
