var local  = [
    ["localhost", "127.0.0.1:10082"],
    ["localhost:8000", "127.0.0.1:8000"],
    ["localhost:1935", "127.0.0.1:1935", "v2"]
];

var selectOptions = new Map(
    [
        ['local', { label: 'local', data: local }]
    ]);


var serverEntries = [local];
