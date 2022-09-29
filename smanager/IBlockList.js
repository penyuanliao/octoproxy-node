"use strict";
const net    = require("net");
const util   = require("util");
const events = require("events");
/**
 * 禁止名單
 * @constructor
 */
class IBlockList extends events.EventEmitter {
    constructor() {
        super();
        this.enabled = true;
        this.allow = {};
        this.deny = {};
        this.blockList = this.setup();
    }
    check(address, type) {
        if (this.blockList) {
            return this.blockList.check(address, type);
        } else {
            return (this.deny[address] == true)
        }
    }
    setup() {
        const BlockList = require('net').BlockList;
        if (!BlockList) return false;
        return new BlockList();
    }
    load({enabled, allow, deny}) {
        this.enabled = enabled;
        this.allow = allow;
        this.deny = deny;
        return this;
    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = IBlockList;