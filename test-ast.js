const vultlib = require('vultlib');
const result = vultlib.main({
    dparse: true,
    files: [{ file: "test.vult", code: "fun main() { return 0; }" }]
});
console.log(JSON.stringify(result, null, 2));
