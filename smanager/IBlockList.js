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
        this.blockList = null;
    }
    check(address, type) {
        if (this.blockList) {
            return this.blockList.check(address, type);
        } else {
            if (!this.deny[address]) return false;
            let { enabled, startTime, endTime} = (this.deny[address]);
            if (endTime && ((startTime + endTime) - Date.now() < 0)) {
                return false;
            }
            return enabled;
        }
    };
    create(deny) {
        let blockList = this.setup();
        if (!blockList) return false;
        let keys = Object.keys(deny);
        const ipVersion = ['ipv4', 'ipv6'];
        for (let address of keys) {
            let { enabled, startTime, endTime, range, subnet, type } = deny[address];
            if (!enabled) continue;
            if (endTime && ((startTime + endTime) - Date.now() < 0)) continue;
            if (ipVersion.indexOf(type) == -1) type = ipVersion[0];
            if (subnet) {
                if (type == 'ipv4' && subnet >= 0 && subnet <= 32) {
                    blockList.addSubnet(address, subnet, type);
                }
                if (type == 'ipv6' && subnet >=0 && subnet <= 128) {
                    blockList.addSubnet(address, subnet, type);
                }
            }
            if (range) {
                blockList.addRange(address, range, type);
            } else {
                blockList.addAddress(address, type);
            }
        }

        return blockList;
    };
    setup() {
        const BlockList = require('net').BlockList;
        if (!BlockList) return false;
        return new BlockList();
    }
    load({enabled, allow, deny}) {
        if (enabled) this.enabled = enabled;
        if (allow) this.allow = allow;
        if (deny) this.deny = deny;
        this.blockList = this.create(deny);
        return this;
    };
    clean() {
        this.blockList = this.create({});
        this.allow = {};
        this.deny = {};
    };
    release() {

    };
}
module.exports = exports = IBlockList;