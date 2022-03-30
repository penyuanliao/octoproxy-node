"use strict";

const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const NSLog         = require('fxNetSocket').logger.getInstance();
const restify       = require('restify');
const errors        = require('restify-errors');

/**
 * 管理介面
 * @constructor
 */
class RestManager extends EventEmitter {
    constructor(delegate) {
        super();
        this.delegate = delegate;
        this.server = this.createAPIServer();
    }
    createAPIServer() {
        const server = restify.createServer({
            name: 'manager.api',
            version: '1.0.0'
        });

        server.use(restify.plugins.acceptParser(server.acceptable));
        server.use(restify.plugins.queryParser());
        server.use(restify.plugins.bodyParser());
        server.use(restify.plugins.authorizationParser()); // header authorization parser
        server.use(async (req,res, next) => {
            res.setHeader('Access-Control-Allow-Origin', "*")
            if (res.url === '/user/login') return next();
            const valid = await this.verifyAuth(req.authorization);
            console.log('valid', valid, req.url);

            if (valid == 1) {
                //未通過驗證
                next(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
            } if (valid == 2) {
                //未授權
                next(new errors['NotAuthorizedError']("You are not authorized to access this api. You must sign-in using your credentials for authorization."));
            } else {
                next();
            }
        });
        server.post('/echo/:name/:pass', function (req, res, next) {
            console.log(req.body);
            console.log(req.query);
            res.send(req.params);
            return next();
        });
        server.post('/user/login', async (req, res, next) => {
            let {username, password} = req.body;
            console.log(typeof req.body);
            let login = await this.delegate.auth.login({
                username, password
            })
            if (login === false) {
                res.send({
                    result: false
                });
            } else {
                res.send({
                    result: true,
                    data: {
                        token: login
                    }
                });
            }
            return next();
        });
        server.get('/amf/config', async (req, res, next) => {

            let src = await this.delegate.manager.send({
                method: "getAMFConfig"
            })
            res.send(src);
            return next();
        });
        // load balancing forwarding rule
        server.get('/balancing/rule', async (req, res, next) => {

            let src = await this.delegate.manager.send({
                method: "getLBGamePath"
            });
            res.send(src);
            return next();
        });
        server.post('/balancing/rule', async (req, res, next) => {
            let data;
            let json = req.body;
            let checked = true;
            if (json.name && json.rule) {
                data = {
                    name: json.name || "",
                    rule: json.rule || []
                };
            } else if (typeof json == "object") {
                data = json;
            } else {
                res.send(new errors["InvalidArgumentError"]("op receives arguments failed."));
                checked = false;
            }
            if (checked) {
                let src = await this.delegate.manager.send({
                    method: "setLBGamePath",
                    data: data
                });
                res.send(src);
            }

            return next();
        });
        server.get('/process/info', async (req, res, next) => {
            let src = await this.delegate.manager.send({
                method: "getServiceInfo"
            });
            res.send(src);
            return next();
        });
        server.get('/process/sys/info', async (req, res, next) => {
            let src = await this.delegate.manager.send({
                method: "getSysInfo"
            });
            res.send(src);
            return next();
        });
        server.del('/process/user/kickout', async (req, res, next) => {
            let {pid, trash, params} = req.body || {};
            let src = await this.delegate.manager.send({
                method: "kickoutToPID",
                pid: pid,
                trash: (trash == true),
                params: params
            });
            res.send(src);
            return next();
        });
        server.put('/process/info', async (req, res, next) => {
            let {oAssign, nAssign, pid, options} = req.body || {};
            if (pid == 'all') {
                pid = 0;
            }
            else if (Number.isNaN(Number(pid))) {
                pid = undefined;
            }
            if (!oAssign || !nAssign) {
                res.send({result: false , error: "invalid argument"});
            } else {
                let src = await this.delegate.manager.send({
                    method: "editCluster",
                    oldName: oAssign,
                    newName: nAssign,
                    pid,
                    options: options
                });
                res.send(src);
            }

            return next();
        });
        server.get('/service/dashboard/info', async (req, res, next) => {
            let src = await this.delegate.manager.send({
                method: "getDashboardInfo"
            })
            if (src.result) {
                res.send(src);
            } else {
                res.send({result: false});
            }
            return next();
        });
        server.post('/service/lockdown/mode', async (req, res, next) => {
            let json = req.body || {};
            let src = await this.delegate.manager.send({
                method: "lockdownMode",
                bool: json.bool
            })
            if (src.result) {
                res.send(src);
            } else {
                res.send({result: false});
            }
            return next();
        });
        return server;
    }
}

/**
 * 驗證使用者token
 * @param {Object} authorization
 * @param {('Bearer'|'Basic')}authorization.scheme
 * @param authorization.credentials
 */
RestManager.prototype.verifyAuth = async function (authorization) {
    console.log(`authorization.credentials: ${authorization.credentials}`);
    console.log("jwtVerify: ",await this.delegate.auth.jwtVerify(authorization.credentials));
    return 0;
}
RestManager.prototype.setup = function () {
    console.log('create');
};
RestManager.prototype.getServer = function () {
    return this.server.server;
}
RestManager.prototype.start = function (port) {
    const server = this.server

    server.listen(port, function () {
        console.log('RestManager %s listening at %s', server.name, server.url);
    });
}


RestManager.prototype.clean = function () {

};
RestManager.prototype.release = function () {

};

module.exports = exports = RestManager;