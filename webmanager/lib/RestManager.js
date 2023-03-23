"use strict";

// const fs            = require("fs");
// const nPath         = require("path");
const EventEmitter  = require("events");
const NSLog         = require('fxNetSocket').logger.getInstance();
const restify       = require('restify');
const errors        = require('restify-errors');
const corsMiddleware = require('restify-cors-middleware2');
const { Roles, HTTPPermissions } = require('./Permissions.js');
/**
 * 管理介面
 * @constructor
 */
class RestManager extends EventEmitter {
    constructor(delegate) {
        super();
        this.version = '2.0.1';
        this.delegate = delegate;
        this.route = '';//'octopus';
        this.visitorAPI = new Set([
            '/user/login',
            '/user/logout',
            '/user/2fa'
        ]);
        this.permissions = new Map([
            [Roles.Guest, new Set(['/user/login'])],
            [Roles.Manager, new Set([ '/message/apply', '/dir/' ])],
            [Roles.Boss, new Set(['root'])]
        ]);
        this.accept = new Set(['appsettings', 'configuration']);
        this.server = this.createAPIServer();
    };
    createAPIServer() {
        const server = restify.createServer({
            name: 'manager.api',
            version: this.version
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
        server.use(async (req, res) => {
            console.log(`url => ${req.url}`);
            res.setHeader('Access-Control-Allow-Origin', "*");
            if (this.visitorAPI.has(req.url)) return;

            let auth = this.verifyAuth(req.authorization);
            if (auth == 1) {
                //未授權
                res.send(new errors['NotAuthorizedError']("You are not authorized to access this api. You must sign-in using your credentials for authorization."));
            }
            else if (auth == 2) {
                //未通過驗證
                res.send(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
            } else {
                let { data, result } = auth;
                console.log(auth);

                result = 1;
                if (result == false) {
                    res.send(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
                } else {
                    if (data) {
                        const {twoFactor, otpauth, permission} = data;
                        console.log(`${req.url} twoFactor:${twoFactor}, otpauth:${otpauth} permission: ${permission}`);
                        let rule = this.permissions.get(permission);
                        if (rule.has('root')) return;
                        if (!rule.has(req.url)) {
                            console.error(`rule ${req.url} permission denied.`);
                            res.send(new errors['UnauthorizedError'](`The caller does not permission.`));
                        }
                    }
                }
            }
        });
        server.get(`${route}/version`, (req, res, next) => {
            res.send({
                result: true,
                version: this.delegate.manager.version,
                node: process.versions.node
            });
            return next();
        });
        //登入驗證
        server.post(`${route}/user/login`, async (req, res) => {
            let {username, password} = req.body;
            let sessionID = req.header('proxy-session-id');
            let session = await this.userSession(sessionID);
            let user = await this.login({username, password});
            if (user != false) {
                session.user = username;
                session.token = user.token;
                session.status = 'authorized';
                await this.userSession(sessionID, session);
                res.send({result: true, data: { token: user.token }});
            } else {
                res.send({result: false});
            }
        });
        //登出
        server.post(`${route}/user/logout`, async (req, res) => {
            let { username } = req.body;
            NSLog.info(`${req.url} user: ${username} logout`);
            let sessionID = req.header('proxy-session-id');
            let session = await this.userSession(sessionID);
            let logout = await this.delegate.auth.logout({ username });
            session.user = 'Guest';
            session.status = 'not_authorized';
            await this.userSession(sessionID, session);
            res.send({ result: logout });
        });
        server.post(`${route}/user/password`, async (req, res) => this.password(req, res));
        //二次驗證
        server.post(`${route}/user/2fa`, async (req, res) => {
            const {auth} = this.delegate;
            const {authorization} = req;
            const {token} = req.body;
            res.send(await auth.verify2FA({
                credentials: authorization.credentials,
                token
            }));
        });
        server.get(`${route}/amf/config`, async (req, res) => {
            let src = await this.delegate.manager.send({ method: "getAMFConfig" })
            res.send(src);
        });
        // load balancing forwarding rule
        server.get(`${route}/balancing/rule`, async (req, res) => {

            let src = await this.delegate.manager.send({
                method: "getLBGamePath"
            });
            res.send(src);
        });
        server.post(`${route}/balancing/rule`, async (req, res) => {
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
        });
        server.get(`${route}/process/sys/info`, async (req, res) => {
            let src = await this.delegate.manager.send({
                method: "getSysInfo"
            });
            res.send(src);
        });
        server.get(`${route}/process/sys/metadata`, async (req, res) => {
            let src = await this.delegate.manager.send({
                method: "metadata"
            });
            res.send(src);
        });
        server.del(`${route}/process/user/kickout`, async (req, res) => {
            let {pid, trash, params} = req.body || {};
            let src = await this.delegate.manager.send({
                method: "kickoutToPID",
                pid: pid,
                trash: (trash == true),
                params: params
            });
            res.send(src);
        });
        server.get(`${route}/process/info`, async (req, res) => {
            let src = await this.delegate.manager.send({
                method: "getServiceInfo"
            });
            res.send(src);
        });
        server.post(`${route}/process/info`, async (req, res) => {
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
        });
        server.put(`${route}/process/info`, async (req, res) => {
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
        });
        server.patch(`${route}/process/batch/reboot`, async (req, res) => {

            let json = req.body || {};
            let delay = json.delay || 1000;
            let group = json.group;
            if (!Array.isArray(group)) {
                res.send({result: false , error: "invalid argument"});
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
        server.post(`${route}/process/warp/tunnel`, async (req, res) => {
            let json = req.body || {};
            let {from, togo, that, list} = json;
            if (!from || !that) {
                res.send({result: false , error: "invalid argument"});
            }
            let src = await this.delegate.manager.send({
                method: "warpTunnel",
                params: json
            });
            res.send(src);
        });
        server.get(`${route}/service/dashboard/info`, async (req, res) => {
            let src = await this.delegate.manager.send({
                method: "getDashboardInfo"
            })
            if (src.result) {
                res.send(src);
            } else {
                res.send({result: false});
            }
        });
        server.post(`${route}/service/lockdown/mode`, async (req, res) => {
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
        });
        server.post(`${route}/service/blocklist`, async (req, res) => {

            const {auth} = this.delegate;

            const {authorization} = req;
            const {result, data} = await auth.jwtVerify(authorization.credentials);
            console.log(result, data);

            let src = await this.delegate.manager.send({
                method: "readIPBlockList"
            });
            res.send(src);
        });
        server.put(`${route}/service/blocklist`, async (req, res) => this.blocklistHandle(req, res));
        server.del(`${route}/service/blocklist`, async (req, res) => this.blocklistHandle(req, res));
        server.get(`${route}/user/otp/qrcode`, async (req, res) => {
            const {otp} = this.delegate;
            const img = await otp.test();
            res.setHeader('Content-Type', 'image/png');
            res.end(img);
        });
        server.get(`${route}/user/login/gen/otp`, async (req, res) => {
            const {auth} = this.delegate;

            const {authorization} = req;

            let img = auth.generate2FAQRCode(authorization.credentials);

            if (img) {
                res.setHeader('Content-Type', 'image/png');
                res.end(img);
            } else {
                res.send({result: false});
            }
        });
        server.get(`${route}/dir/:folder`, async (req, res) => {
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
            } else {
                res.send(src);
            }
        });
        server.put(`${route}/dir`, async (req, res) => {
            let folder = (req.body.folder || 'appsettings');

            if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
            } else {
                let src;
                src = await this.delegate.manager.send({
                    method: "readFiles",
                    folder
                });
                res.send(src);
            }
        });
        server.get(`${route}/dir/:folder/:filename`, async (req, res) => {
            let folder = (req.params.folder || 'appsettings');
            let filename = this.getFilename(req.params.filename);

            if (!filename) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid file name'});
            } else if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
            } else {
                let src = await this.delegate.manager.send({
                    method: "readFileContents",
                    folder,
                    filename
                });
                res.send(src);
            }
        });
        server.post(`${route}/dir/:folder/:filename`, async (req, res) => {
            let folder = (req.params.folder || 'appsettings');
            let filename = this.getFilename(req.params.filename);
            if (!filename) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid file name'});
                return;
            } else if (!this.acceptFolder(folder)) {
                res.send({
                    result: false,
                    code: 'InvalidName',
                    message: 'This is not a valid folder'});
                return;
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
        });

        server.patch('/message/apply', async (req, res) => {
            let {result, error} = await this.verifyAuth(req.authorization);
            if (result === false) {
                return res.send(new errors['UnauthorizedError'](error));
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
     * @return {Promise<Object>}
     */
    async password (req, res) {
        const { delegate } = this;
        let { password, newPassword } = req.body;
        let { authorization } = req;
        let result = await delegate.auth.changePassword({ password, newPassword, authorization });
        res.send({ result });
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

    async blocklistHandle(req, res) {
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
            return res.send(new errors['UnauthorizedError']('Access is denied due to invalid credentials.'));
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
    };
    async login({username, password}) {
        let login = await this.delegate.auth.login(arguments[0])
        if (login === false) {
            return false;
        } else {
            return login;
        }
    };
    async userSession(sessionID, data) {
        let {delegate} = this;
        if (delegate.httpServer) {
            if (data) {
                return await delegate.httpServer.setSession(sessionID, data);
            } else {
                return await delegate.httpServer.getSession(sessionID);
            }
        } else {
            return false;
        }
    }
    clean() {

    };
    release() {

    };
}

module.exports = exports = RestManager;