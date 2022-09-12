const http = require('http');


let i = 10;
let j = 0;
do {
    http.get('http://127.0.0.1:8000/fxlive/http/fxLB?gameType=s1', (res) => {
        let data = ''
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            console.log(++j, data);
        })
    })
} while (--i > 0)

