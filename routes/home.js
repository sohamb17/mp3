module.exports = function (router) {
    router.route('/').get(function (req, res) {
        res.json({ message: 'OK', data: 'Llama.io API' });
    });
    return router;
};
