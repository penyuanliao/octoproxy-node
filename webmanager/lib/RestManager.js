"use strict";

const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const NSLog         = require('fxNetSocket').logger.getInstance();
const restify       = require('restify');
const errors        = require('restify-errors');
const corsMiddleware = require('restify-cors-middleware2');
/**
 * 管理介面
 * @constructor
 */
class RestManager extends EventEmitter {
    constructor(delegate) {
        super();
        this.delegate = delegate;
        this.route = '';//'octopus';
        this.visitorAPI = new Set([
            '/user/login',
            '/user/logout',
            '/user/2fa'
        ]);
        this.permissions = new Map([
            [0, new Set()],
            [5, new Set([ '/message/apply' ])],
            [777, new Set(['root'])]
        ]);

        this.accept = new Set(['appsettings', 'configuration']);
        this.server = this.createAPIServer();
    };
    ssl() {
        var options = {
            key: fs.readFileSync('./server-key.pem'),
            ca: [fs.readFileSync('./cert.pem')],
            cert: fs.readFileSync('./server-cert.pem')
        };
    }
    createAPIServer() {
        const server = restify.createServer({
            name: 'manager.api',
            version: '1.0.0'
        });
        const cors = corsMiddleware({
            preflightMaxAge: 5, //Optional
            origins: ['*'],
            allowHeaders: ['appid', 'authorization'],
            exposeHeaders: ['appid', 'authorization']
        });
        const { route } = this;
        server.pre(cors.preflight);
        server.use(cors.actual);
        server.use(restify.plugins.acceptParser(server.acceptable));
        server.use(restify.plugins.queryParser());
        server.use(restify.plugins.bodyParser());
        server.use(restify.plugins.authorizationParser()); // header authorization parser
        server.use(async (req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', "*");
            if (this.visitorAPI.has(req.url)) return next();

            let auth = await this.verifyAuth(req.authorization);
            if (auth == 1) {
                //未授權
                next(new errors['NotAuthorizedError']("You are not authorized to access this api. You must sign-in using your credentials for authorization."));
            }
            else if (auth == 2) {
                //未通過驗證
                next(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
            } else {
                let { data, result } = auth;
                console.log(`auth => ${req.url}`);
                console.log(auth);


                if (result == false) {
                    next(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
                } else {
                    if (data) {
                        const {twoFactor, otpauth, permission} = data;
                        console.log(`${req.url} twoFactor:${twoFactor}, otpauth:${otpauth}`);
                        let rule = this.permissions.get(permission);
                        if (rule.has('root')) return next();
                        if (!rule.has(req.url)) {
                            console.error(`rule ${req.url} permission denied.`);
                            next(new errors['UnauthorizedError'](`The caller does not permission.`));
                            return
                        }
                    }

                    next();
                }
            }
        });
        server.get(`${route}/version`, function (req, res, next) {
            res.send({
                result: true,
                version: this.version
            });
            return next();
        })
        server.post(`${route}/echo/:name/:passs`, function (req, res, next) {
            console.log(req.body);
            console.log(req.query);
            res.send(req.params);
            return next();
        });
        //登入驗證
        server.post(`${route}/user/login`, async (req, res, next) => {
            let {username, password} = req.body;
            let sessionID = req.header('proxy-session-id');
            let session = await this.delegate.httpServer.getSession(sessionID);
            let user = await this.login({username, password});
            if (user.result) {
                session.user = username;
                await this.delegate.httpServer.setSession(sessionID, session);
            }
            res.send(user);
            return next();
        });
        server.post(`${route}/user/logout`, async (req, res, next) => {
            let { username } = req.body;
            NSLog.info(`${req.url} user: ${username}`);
            let logout = await this.delegate.auth.logout({ username });
            res.send({ result: logout });
            return next();
        })
        server.post(`${route}/user/password`, (req, res, next) => this.password(req, res, next));
        //二次驗證
        server.post(`${route}/user/2fa`, async (req, res, next) => {
            const {otp, auth} = this.delegate;
            const {authorization} = req;
            let {result, data} = await auth.jwtVerify(authorization.credentials);
            const {token} = req.body;
            if (result) {
                const {username} = data;
                const db = await auth.getSecret(username);
                let secret = '';
                if (db) {
                    secret = db.otp;
                }
                let result = otp.verify({secret, token});
                if (result) {
                    res.send({
                        result,
                        token: await auth.otpAuth(data)
                    })
                } else {
                    res.send({result})
                }
            }
            return next();
        });
        server.get(`${route}/amf/config`, async (req, res, next) => {
            let src = await this.delegate.manager.send({ method: "getAMFConfig" })
            res.send(src);
            return next();
        });
        // load balancing forwarding rule
        server.get(`${route}/balancing/rule`, async (req, res, next) => {

            let src = await this.delegate.manager.send({
                method: "getLBGamePath"
            });
            res.send(src);
            return next();
        });
        server.post(`${route}/balancing/rule`, async (req, res, next) => {
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
        server.get(`${route}/process/sys/info`, async (req, res, next) => {
            let src = await this.delegate.manager.send({
                method: "getSysInfo"
            });
            res.send(src);
            return next();
        });
        server.get(`${route}/process/sys/metadata`, async (req, res, next) => {
            let src = await this.delegate.manager.send({
                method: "metadata"
            });
            res.send(src);
            return next();
        });
        server.del(`${route}/process/user/kickout`, async (req, res, next) => {
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
        server.get(`${route}/process/info`, async (req, res, next) => {
            let src = await this.delegate.manager.send({
                method: "getServiceInfo"
            });
            res.send(src);
            return next();
        });
        server.post(`${route}/process/info`, async (req, res, next) => {
            let {
                mxoss,
                file,
                assign,
                args,
                lookout,
                ats,
                recycleExpired,
                pkg,
                cmd,
                heartbeat,
                env,
                compact,
                inspect,
                v8Flags
            } = (req.body || {});
            if (!mxoss) req.body.mxoss = 1024;
            if (!file || !assign) {
                res.send({result: false , error: "invalid argument"});
            } else {
                req.body.clone = false;
                let src = await this.delegate.manager.send({
                    method: "addCluster",
                    options: req.body
                });
                res.send(src);
            }
            return next();
        });
        server.put(`${route}/process/info`, async (req, res, next) => {
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
        server.patch(`${route}/process/batch/reboot`, async (req, res, next) => {

            let json = req.body || {};
            let delay = json.delay || 1000;
            let group = json.group;
            if (!Array.isArray(group)) {
                res.send({result: false , error: "invalid argument"});
                return next();
            } else {
                this.delegate.queueSteps({
                    method: 'restartMultiCluster',
                    show: (value) => {
                        console.log(` => step.value: ${value}`);
                    }
                });
                let src = await this.delegate.manager.send({
                    method: "restartMultiCluster",
                    group,
                    delay
                });
                res.send(src);
            }

        });
        server.post(`${route}/process/warp/tunnel`, async (req, res, next) => {
            let json = req.body || {};
            let {from, togo, that, list} = json;
            if (!from || !that) {
                res.send({result: false , error: "invalid argument"});
                return next();
            }
            let src = await this.delegate.manager.send({
                method: "warpTunnel",
                params: json
            });
            res.send(src);
            return next();
        });
        server.get(`${route}/service/dashboard/info`, async (req, res, next) => {
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
        server.post(`${route}/service/lockdown/mode`, async (req, res, next) => {
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
        server.post(`${route}/service/blocklist`, async (req, res, next) => {

            const {auth} = this.delegate;

            const {authorization} = req;
            const {result, data} = await auth.jwtVerify(authorization.credentials);
            console.log(result, data);

            let src = await this.delegate.manager.send({
                method: "readIPBlockList"
            });
            res.send(src);
            return next();
        });
        server.put(`${route}/service/blocklist`, async (req, res, next) => this.blocklistHandle(req, res, next));
        server.del(`${route}/service/blocklist`, async (req, res, next) => this.blocklistHandle(req, res, next));
        server.get(`${route}/user/otp/qrcode`, async (req, res, next) => {
            const {otp} = this.delegate;
            const img = await otp.test();
            res.setHeader('Content-Type', 'image/png');
            res.end(img);
            return next();
        });
        server.get(`${route}/user/login/gen/otp`, async (req, res, next) => {
            const {otp, auth} = this.delegate;

            const {authorization} = req;
            const {result, data} = await auth.jwtVerify(authorization.credentials);

            if (result) {
                const {username} = data;
                const db = await auth.getSecret(username)
                let secret;
                if (db) {
                    secret = db.otp;
                } else {
                    secret = otp.generateSecret(32);
                    await auth.registerOTP(username, secret);
                }

                let url = otp.generateURL({
                    issuer: "octoMan",
                    username,
                    secret
                });
                console.log(`url: ${url}`);
                const img = await otp.create_qrcode(url, 'buffer');
                res.setHeader('Content-Type', 'image/png');
                res.end(img);
            } else {
                res.send({result: false});
            }
            return next();
        });
        server.get(`${route}/dir/:folder`, async (req, res, next) => {
            let folder = (req.params.folder || 'appsettings');
            let src = await this.delegate.manager.send({
                method: "readFiles",
                folder
            });

            if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
                return next();
            }

            res.send(src);
            return next();
        });
        server.put(`${route}/dir`, async (req, res, next) => {
            let folder = (req.body.folder || 'appsettings');

            if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
                return next();
            }

            let src;
            src = await this.delegate.manager.send({
                method: "readFiles",
                folder
            });
            res.send(src);
            return next();
        });
        server.get(`${route}/dir/:folder/:filename`, async (req, res, next) => {
            let folder = (req.params.folder || 'appsettings');
            let filename = this.getFilename(req.params.filename);

            if (!filename) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid file name'});
                return next();
            } else if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
                return next();
            }

            let src = await this.delegate.manager.send({
                method: "readFileContents",
                folder,
                filename
            });
            res.send(src);
            return next();
        });
        server.post(`${route}/dir/:folder/:filename`, async (req, res, next) => {
            let folder = (req.params.folder || 'appsettings');
            let filename = this.getFilename(req.params.filename);
            if (!filename) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid file name'});
                return next();
            } else if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
                return next();
            }
            let {
                data,
                reload
            } = req.body || {};
            let src = await this.delegate.manager.send({
                method: "saveFileContents",
                folder,
                filename,
                data
            });

            if (Array.isArray(reload)) {
                for (let i = 0; i < reload.length; i++) {
                    let item = reload[i];
                    await this.delegate.manager.send({
                        method: 'ipcMessage',
                        pid: item.pid,
                        params: (item.params)
                    });
                }
            }
            res.send(src);
            return next();
        });

        server.patch('/message/apply', async (req, res, next) => {
            let {result, error} = await this.verifyAuth(req.authorization);
            if (result === false) {
                return next(new errors['UnauthorizedError'](error));
            }

            let { pid, appName, streamName, host } = req.params;

            let src = await this.delegate.manager.send({
                method: 'ipcMessage',
                pid,
                params: {
                    cmd: 'apply',
                    appName,
                    streamName,
                    host
                }
            });

            res.send(src);
        });

        return server;
    };

    /**
     * @api {post} /user/password change user password
     * @apiName ChangePassword
     * @group User
     * @param req
     * @param res
     * @param next
     * @return {Promise<Object>}
     */
    async password (req, res, next) {
        const { delegate } = this;
        let { password, newPassword } = req.body;
        let { authorization } = req;
        let result = await delegate.auth.changePassword({ password, newPassword, authorization });
        res.send({ result });
        return next();
    }

    acceptFolder(str) {
        if (!str) str = 'appsettings';
        let {accept} = this;
        return (accept.has(str));
    }
    failMassage({code, message}) {
        return {result: false, code, message };
    }
    /**
     * 驗證使用者token
     * @param {Object} authorization
     * @param {('Bearer'|'Basic')}authorization.scheme
     * @param authorization.credentials
     */
    async verifyAuth(authorization) {
        // console.log(`authorization.credentials: ${authorization.credentials}`);

        const { credentials } = authorization;

        // if (!credentials) return 2;

        let auth = await this.delegate.auth.jwtVerify(credentials);

        if (auth.result) {
            let { username } = auth.data;
            let { permission } = await this.delegate.auth.getPermission(username);
            auth.data.permission = permission;
        }
        // if (!auth.result) return 1;

        return auth;
    }
    setup() {
        console.log('create');
    };
    getServer() {
        return this.server.server;
    };
    start({port}) {
        const server = this.server

        server.listen(port, function () {
            console.log('RestManager %s listening at %s', server.name, server.url);
        });
    }
    getFilename(filename) {
        let match = filename.match(/[\w,\s-]+.json/g);
        if (!match) {
            return false;
        } else {
            return match[0];
        }
    };

    async blocklistHandle(req, res, next) {
        let {
            address,
            enabled,
            endTime,
            count,
            log,
            range,
            subnet,
            type
        } = req.body || {};

        const {auth} = this.delegate;

        const {authorization} = req;
        const {result, data} = await auth.jwtVerify(authorization.credentials);
        if (result == false) {
            return next(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
        }
        let src = await this.delegate.manager.send({
            method: "IPBlockList",
            ip: address,
            state: enabled,
            endTime,
            count,
            log,
            author: data.username,
            range,
            subnet,
            type
        });
        res.send(src);
        return next();
    }
    async login({username, password}) {
        let login = await this.delegate.auth.login(arguments[0])
        if (login === false) {
            return {
                result: false
            };
        } else {
            return {
                result: true,
                data: {
                    token: login
                }
            };
        }
    }
    clean() {

    };
    release() {

    };
}

module.exports = exports = RestManager;