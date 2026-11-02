var h = require('../utils/helpers');

module.exports = function (app, router) {
    require('./home.js')(router);
    require('./users.js')(router);
    require('./tasks.js')(router);
    app.use('/api', router);
    app.use(h.notFound);
    app.use(h.errorHandler);
};
