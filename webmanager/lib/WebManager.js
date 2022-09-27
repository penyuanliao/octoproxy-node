"use strict";
const Path          = require("path");
const util          = require("util");
const EventEmitter  = require("events").EventEmitter;
const NSLog         = require('fxNetSocket').logger.getInstance();
const express       = require("express");
const session       = require('express-session');
const bodyParser    = require('body-parser');
const ejs = require('ejs');
/**
 * 
 * @constructor
 */
class WebManager extends EventEmitter {
    constructor({delegate, listen, port}) {
        super();
        this.delegate = delegate;
        this.app = this.createHttpServer();
        this.server = this.listen({ listen, port });
    }
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
        app.use('/css', express.static(__dirname + '/css'));
        app.use('/fonts', express.static(__dirname + '/fonts'));
        app.use('/js', express.static(__dirname + '/js'));

        app.use(session({
            secret: 'sidonia_shizuka',
            name: 'user', // optional
            saveUninitialized: false,
            resave: true,
        }));
        app.get('/mgr/test', (req, res) => {

            console.log(req.session)
            console.log(req.sessionID)
            req.session.user = '1234'
            res.send('Hello World!')

        });
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
        app.set('views', Path.resolve(__dirname, '../html'));
        app.get('/mgr/test2', (req, res) => {
            res.render('index', {user: "pug", mode: 'http'});
        })
    }
    setup() {}
    clean() {}
    release() {}
}
module.exports = exports = WebManager;