var ID_RE = /^[0-9a-fA-F]{24}$/;

function isValidId(id) {
    return typeof id === 'string' && ID_RE.test(id);
}

function HttpError(status, message) {
    this.status = status;
    this.message = message;
}

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

function parseJSONParam(req, name) {
    var raw = req.query[name];
    if (raw === undefined) return undefined;
    var v;
    try { v = JSON.parse(raw); } catch (e) { throw new HttpError(400, 'The "' + name + '" parameter is not valid JSON'); }
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        throw new HttpError(400, 'The "' + name + '" parameter must be a JSON object');
    }
    return v;
}

function parseIntParam(req, name) {
    var raw = req.query[name];
    if (raw === undefined) return undefined;
    var n = Number(raw);
    if (typeof raw !== 'string' || raw.trim() === '' || !Number.isInteger(n) || n < 0) {
        throw new HttpError(400, 'The "' + name + '" parameter must be a non-negative integer');
    }
    return n;
}

function parseSelect(req) {
    return parseJSONParam(req, 'select');
}

async function runListQuery(Model, req, defaultLimit) {
    var where = parseJSONParam(req, 'where') || {};
    var sort = parseJSONParam(req, 'sort');
    var select = parseJSONParam(req, 'select');
    var skip = parseIntParam(req, 'skip');
    var limit = parseIntParam(req, 'limit');
    var count = req.query.count === 'true';

    try {
        if (count) return await Model.countDocuments(where);
        var q = Model.find(where);
        if (sort) q = q.sort(sort);
        if (select) q = q.select(select);
        if (skip !== undefined) q = q.skip(skip);
        if (limit === undefined) limit = defaultLimit;
        if (limit !== undefined) q = q.limit(limit);
        return await q;
    } catch (e) {
        if (e.name === 'CastError' || e.name === 'MongoServerError' || /projection|sort/i.test(e.message)) {
            throw new HttpError(400, 'One of the query parameters is invalid');
        }
        throw e;
    }
}

function notFound(req, res) {
    send(res, 404, 'Route not found', {});
}

function errorHandler(err, req, res, next) {
    if (err instanceof HttpError) return send(res, err.status, err.message, {});
    if (err.type === 'entity.parse.failed') return send(res, 400, 'Request body is not valid JSON', {});
    if (err.code === 11000) return send(res, 400, 'A user with that email already exists', {});
    if (err.name === 'CastError' || err.name === 'ValidationError') return send(res, 400, 'Invalid data in request', {});
    console.error(err);
    send(res, 500, 'Something went wrong on the server', {});
}

module.exports = {
    isValidId: isValidId, HttpError: HttpError, send: send, parseSelect: parseSelect,
    runListQuery: runListQuery, notFound: notFound, errorHandler: errorHandler
};
