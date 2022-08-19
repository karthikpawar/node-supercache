const objectHash = require('object-hash');

const keyGen = async (req: any) => {
    const key = objectHash({
        URL: req.originalUrl,
        body: req.body
        })
    return key
}