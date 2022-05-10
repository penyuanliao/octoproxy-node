const os = require("os");
const util = require("util");
function FxViewMapping() {

}
FxViewMapping.hostname = function (CICD) {
    if (typeof CICD == "undefined") CICD = "";
    var name = util.format("%s$%s$%s", os.hostname(), process.pid, CICD);
    var cipher = FxViewMapping.strEncode(name);
    return cipher;
}
const crypto = require("crypto");
FxViewMapping.strEncode = function (str, iv) {
    const secret = "tMNkvhb4VVjJaZcUe9tPSdy2vsNCD9F2";
    if (typeof str != 'string') str = JSON.stringify(str);
    iv = iv || "";
    var clearEncoding = 'utf8';
    var cipherEncoding = 'base64';
    var cipherChunks = [];
    var cipher = crypto.createCipheriv('aes-256-ecb', secret, iv);
    cipher.setAutoPadding(true);
    cipherChunks.push(cipher.update(str, clearEncoding, cipherEncoding));
    cipherChunks.push(cipher.final(cipherEncoding));
    return cipherChunks.join('');
}

module.exports = exports = FxViewMapping;

