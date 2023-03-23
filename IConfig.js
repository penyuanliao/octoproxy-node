"use strict";
const { Command }   = require('commander');
const { getConfig } = require('fxNetSocket');
var instance = null;
var cmdOpts = null;
/**
 *
 * @constructor
 */
class IConfig {
    constructor() {
        /**
         * 系統環境變數
         * @property {Object} env
         */
        this.env = process.env.NODE_ENV;

        this.numCPUs = require('os').cpus().length;
        /**
         * 心跳事件
         * @version 2.0.0
         * @type {string}
         */
        this.heartbeat_namespace = "/x-ping-pong";

        this.level = 'debug';

        this.webManagePrefix = 'mgr'

        this.specificBase = new Set([
            'ws',
            'web'
        ]);
        this.crossPolicy = Object.freeze({
            'Access-Control-Allow-Origin': [],
            'requestMethod': new Set([
                "POST"
            ]),
            'secFetchMode': 'cors'
        });

        this.balance = 'leastconn'; //roundrobin

        this.setupLoadBalance();

        this.setupManager();

        this.setupLogMonitor();

        this.setupDirector();
    }
    setupLoadBalance() {
        this.gamSLB = {
            /**
             * 啟用loadBalance
             * @type {boolean}
             */
            enabled: true,
            /**
             * 改用pkg封裝
             */
            pkgFile: false,
            /**
             * 負載均衡程式
             * @type {string}
             */
            file: '../LoadBalancer/NodeLB.js',
            /**
             * 負載均衡Path
             * @type {string}
             */
            assign: '/fxLB',
            /**
             * 支援視訊規則模組
             * @type {boolean}
             */
            videoEnabled: true,
            /**
             * 支援http模組
             * @type {boolean}
             */
            httpEnabled: true,
            /**
             * 視訊程序edgeName前綴詞 ex: edge_
             * @type {string}
             */
            vPrefix: '',
            /**
             * 支援RTMP
             * @type {boolean}
             */
            rtmpFrontendEnabled: false
        }
    };
    setupLogMonitor() {
        this.InfluxDBConf = {
            enabled: false,
            port: 10084,
            host: "192.168.188.123"
        }
        /**
         * telegram通知系統
         * @version 2.0.0
         * @type {{credentials: {bot: string, token: string}, proxyMode: {port: number, host: string}, enabled: boolean}}
         */
        this.telegram = {
            credentials: {bot: "", token:""},
            proxyMode: {host: "", port: 0},
            enabled: false
        };
    };
    setupDirector() {
        this.breaker = {
            route: '*'
        }
    };
    setupManager() {
        this.wpc = {
            /**
             * FxLogger 監控Log資料接收Port
             * @type {number}
             */
            logging: {port: 10080},
            /**
             * 服務對外websocket Port
             * @type {number}
             */
            ws: {port: 10082},
            /**
             * 服務對外restful Port
             * @type {number}
             */
            rest: {

                listen: true,

                port: 10083,

                router: ['/octopus'],

                pathRewrite: function (pathname, req) {
                    return pathname.replace('/octopus', '');
                }
            },
            /**
             * 服務對外http Port
             * @type {number}
             */
            http: {
                listen: true,

                port: 10084,

                router: [`/mgr`],

                session: {
                    // sessionID hash secret
                    secret: 'sidonia_shizuka',
                    name: 'user',
                    saveUninitialized: false,
                    resave: true
                }
            },
            /**
             *
             */
            udp: {
                port: 8080
            },
            debug: false,
            // http proxy mode
            proxyMode: true
        }

        /**
         * 跟Ocoto 對接服務接口
         * @type {number}
         */
        this.managePort = 8100;

        this.IManagerConfig = {
            server: {
                //server被動等連線
                passive: {
                    enabled: true,
                    host: "0.0.0.0",
                    port: this.managePort,
                    // 提供HTTP Server
                    web: true,
                    // 是否聆聽port服務
                    listen: true
                },
                //server主動連線
                active: {
                    enabled: false,
                    port: this.managePort,
                    host: "127.0.0.1",
                },
            },
            client: {
                mode: "active",
                active: {
                    host: "127.0.0.1",
                    port: this.managePort
                },
                passive: {
                    host: "0.0.0.0",
                    port: this.managePort
                }
            },
            SIGNATURE: "284vu86",
            telegram: {
                bot: "",
                token: "",
                chats: {
                    sys: "-1001314121392"
                },
                enabled: false,
                proxyMode: {
                    host: "",
                    port: 0,
                    enabled: false
                }
            }
        };
    };
    setupAppArguments(options) {
        this.cmdOpts = options;
        let { port, pushHost, wpcLogPort, wpcHttpPort, wpcManagePort} = options;
        if (port) {
            this.cmdOpts.port = Number.parseInt(port);
        } else {
            this.cmdOpts.port = 8000;
        }
        if (wpcLogPort) this.cmdOpts.wpcLogPort = Number(wpcLogPort);
        if (wpcHttpPort) this.cmdOpts.wpcHttpPort = Number(wpcHttpPort);
        if (wpcManagePort) this.cmdOpts.wpcManagePort = Number(wpcManagePort);
        if (pushHost) {
            this.cmdOpts.push = true;
        }

        this.setup();
    }
    /** 伺服器環境設定 **/
    setup() {

        let { host, port } = this.cmdOpts;

        this.srvOptions = {
            host: (host || '0.0.0.0'),
            port,
            closeWaitTime: 5000,
            backlog: 511
        };

        this.tlsOptions = {
            keyFile: '',
            certFile: '',
            enabled: false
        };

        this.forkOptions = getConfig('../configuration/Assign.json');
        // wait for ready
        this.taskSync = false;

        if (this.env === 'development') {
            this.development();
        }
        else if (this.env === 'sms') {
            this.sms();
        }
        else if (this.env === 'release') {
            this.release();
        }
    }
    development() {

    };
    sms() {};
    release() {};
    static version() {
        try {
            let npm_package = require('package.json');
            return npm_package.version || 'None';
        } catch (e) {
            return 'None';
        }

    };
    /**
     * Application parameters
     * @return {*}
     * @constructor
     */
    static StartAppArguments() {
        if (cmdOpts) return cmdOpts;
        const cmd = new Command();
        cmd.version(`
        version: ${IConfig.version()}
        node: ${process.versions.node}
        node.v8.engine: ${process.versions.v8}
        `);
        cmd.option('-mode, --compatibilityMode <string>', 'run compatibility mode old version.');
        cmd.option('-p, --port <number>', 'Start server listening to port.');
        cmd.option('-h, --host <string>', 'Start server listening to host.');
        cmd.option('-gc, --gc', 'Running global.gc() manually garbage collection');
        cmd.option('-ph, --pushHost <string>', 'Push manager to manager server.');
        cmd.option('--wpc-log-port <number>', 'manager server port.');
        cmd.option('--wpc-http-port <number>', 'manager server port.');
        cmd.option('--wpc-manage-port <number>', 'manager server port.');
        cmd.parse(process.argv);
        return cmdOpts = cmd.opts();
    };
    static getInstance() {
        if (instance === null) {
            instance = new IConfig();
            instance.setupAppArguments(IConfig.StartAppArguments());
        }
        return instance;
    };
    static ManagerAccounts() {
        let accounts = new Map([
            [
                'root',  {
                username: "newflash@mail.chungyo.net",
                password: "gv2Z3UyOrs",
                permission: 777,
            }],
            [
                'guest', {
                username: "sguest@mail.chungyo.net",
                password: "36Gfi5ryW6",
                permission: 1,
            }]
        ]);
        return {
            authorization: {
                enabled: false,
                secret: "sidonia",
                accounts: [ ...accounts.values() ]
            }
        }
    };
}

module.exports = exports = IConfig;