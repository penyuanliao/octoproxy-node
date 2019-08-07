/**
 * Created by Benson.Liao on 2016/9/13.
 */

var index = process.argv.findIndex(function (element) {
    return (element == "-v" || element == "--version");
});

if (index != -1) {
    console.log("v" + require("./package.json").version);
    process.exit(0);
}

const appDelegate = require('./AppDelegate');
const main = new appDelegate();
