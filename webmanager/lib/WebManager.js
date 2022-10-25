"use strict";
const Path          = require("path");
const util          = require("util");
const EventEmitter  = require("events").EventEmitter;
// const NSLog         = require('fxNetSocket').logger.getInstance();
const express       = require("express");
const session       = require('express-session');
const bodyParser    = require('body-parser');
const {nanoid}      = require('nanoid');
// const ejs = require('ejs');

class WebManager extends EventEmitter {
    /**
     * Web服務
     * @param {*} delegate 代理
     * @param {Boolean} listen 監聽
     * @param {Number} port 服務埠
     * @param {Object} options session參數
     */
    constructor({delegate, listen, port, options}) {
        super();
        this.delegate = delegate;
        this.store = new session.MemoryStore();
        this.options = this.setupOptions(options);
        this.app = this.createHttpServer();
        this.server = this.listen({ listen, port });
    }
    setupOptions(options) {
        let {store} = this;
        if (options) {
            return  Object.assign({store}, options);;
        } else {
            return {
                store,
                secret: nanoid(12),
                name: 'user',
                saveUninitialized: false,
                resave: true
            };
        }
    };
    listen({listen, port}) {
        let { app } = this;
        let server;
        if (port) {
            server = app.listen(port);
        } else {
            server = app.listen();
        }
        if (listen != true) server.close();
        return server;
    };
    createHttpServer() {
        let app = express(); //建立Express個體

        app.use(bodyParser.json()); // support json encoded bodies
        app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
        app.use('/mgr/src/bootstrap3', express.static(Path.resolve(__dirname, '../src/bootstrap3')));
        app.use('/mgr/cryptoJS', express.static(Path.resolve(__dirname, '../src/cryptoJS')));
        app.use('/mgr/css', express.static(Path.resolve(__dirname, '../src/css')));
        app.use('/mgr/fonts', express.static(Path.resolve(__dirname, '../src/fonts')));
        app.use('/mgr/js', express.static(Path.resolve(__dirname, '../src/js')));
        app.use(async (req, res, next) => {
            let url = req.url;
            if (url.indexOf('/mgr') == -1) {
                console.log(req.rawHeaders);
            }
            res.setHeader('connection', 'close');
            next();
        });
        app.use(session(this.options));
        // app.get('/mgr/test', (req, res) => {
        //
        //     console.log(req.session)
        //     console.log(req.sessionID)
        //     console.log(req.session.user, req.headers.cookie)
        //     req.session.user = '1234'
        //     res.send('Hello World!')
        //
        // });
        /*
        //ejs
        app.set("view options", {
            openDelimiter: "{{",
            delimiter: " ",
            closeDelimiter: "}}"
        });
        app.set('view engine', 'ejs');
        app.get('/', function(req, res) {
            res.render('index', {hidden:"hidden", title: "12345"});

        });
         */
        this.setPug(app);

        return app;
    };
    getServer() {
        return this.server;
    };
    setPug(app) {
        app.set('view engine', 'pug');
        app.set('views', Path.resolve(__dirname, '../src/html'));
        app.get(['/mgr/node'], (req, res, next) => {
            if (!req.session.user) {
                req.session.user = 'Guest';
                req.session.status = 'not_authorized';
            }
            console.log(req.sessionID, req.session);
            // console.log(`${req.sessionID} => req.session.user: ${req.session.user}`);
            // let {token} = req.session;
            res.render('index', {
                pathname: req.url,
                user: {
                    name: req.session.user,
                    status: req.session.status
                },
                mode: 'pug'});
            return next();
        });
        app.get('/mgr/dashboard', (req, res, next) => {
            console.log(req.url);

            res.render('dashboard', {
                pathname: req.url,
                user: {
                    name: req.session.user,
                    status: req.session.status,
                    token: req.session.token
                },
                mode: 'pug'});
            return next();
        });
    };
    /**
     * 取得session資訊
     * @param sessionID
     * @return {Promise}
     */
    getSession(sessionID) {
        return new Promise((resolve) => {
            let { store } = this;
            store.get(sessionID, (err, sess) => resolve(sess));
        });
    };
    /**
     * 寫入session資訊
     * @param sessionID
     * @param session
     * @return {Promise}
     */
    setSession(sessionID, session) {
        return new Promise((resolve) => {
            let { store } = this;
            store.set(sessionID, session, (err, sess) => {
                resolve(sess)
            });
        })
    };
    clean() {}
    release() {}
}
module.exports = exports = WebManager;