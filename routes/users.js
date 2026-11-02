var User = require('../models/user');
var Task = require('../models/task');
var h = require('../utils/helpers');

function validateUserBody(body) {
    body = body || {};
    if (typeof body.name !== 'string' || !body.name.trim()) throw new h.HttpError(400, 'A user must have a name');
    if (typeof body.email !== 'string' || !body.email.trim()) throw new h.HttpError(400, 'A user must have an email');

    var pending = body.pendingTasks;
    if (pending === undefined || pending === null || pending === '') pending = [];
    if (typeof pending === 'string') pending = [pending];
    if (!Array.isArray(pending) || pending.some(function (id) { return typeof id !== 'string'; })) {
        throw new h.HttpError(400, 'pendingTasks must be a list of task ids');
    }
    if (pending.some(function (id) { return !h.isValidId(id); })) {
        throw new h.HttpError(400, 'pendingTasks contains an invalid task id');
    }
    var unique = pending.filter(function (id, i) { return pending.indexOf(id) === i; });
    return { name: body.name, email: body.email, pendingTasks: unique };
}

async function checkEmail(email, excludeId) {
    var filter = { email: email };
    if (excludeId) filter._id = { $ne: excludeId };
    if (await User.findOne(filter)) throw new h.HttpError(400, 'A user with that email already exists');
}

async function checkTasks(ids) {
    if (!ids.length) return;
    var tasks = await Task.find({ _id: { $in: ids } });
    if (tasks.length !== ids.length) throw new h.HttpError(404, 'One or more tasks in pendingTasks do not exist');
    if (tasks.some(function (t) { return t.completed; })) {
        throw new h.HttpError(400, 'pendingTasks cannot contain a completed task');
    }
}

async function syncTasks(user, oldIds, newIds) {
    var uid = String(user._id);
    var removed = oldIds.filter(function (id) { return newIds.indexOf(id) === -1; });
    if (removed.length) {
        await Task.updateMany({ _id: { $in: removed }, assignedUser: uid },
            { assignedUser: '', assignedUserName: 'unassigned' });
    }
    if (newIds.length) {
        var tasks = await Task.find({ _id: { $in: newIds } });
        for (var t of tasks) {
            if (t.assignedUser && t.assignedUser !== uid) {
                await User.updateOne({ _id: t.assignedUser }, { $pull: { pendingTasks: String(t._id) } });
            }
        }
        await Task.updateMany({ _id: { $in: newIds } }, { assignedUser: uid, assignedUserName: user.name });
    }
    await Task.updateMany({ assignedUser: uid }, { assignedUserName: user.name });
}

module.exports = function (router) {

    router.route('/users')
        .get(async function (req, res) {
            var result = await h.runListQuery(User, req, undefined);
            h.send(res, 200, 'OK', result);
        })
        .post(async function (req, res) {
            var b = validateUserBody(req.body);
            await checkEmail(b.email);
            await checkTasks(b.pendingTasks);
            var user = await User.create(b);
            await syncTasks(user, [], b.pendingTasks);
            h.send(res, 201, 'User created', user);
        });

    router.route('/users/:id')
        .get(async function (req, res) {
            var select = h.parseSelect(req);
            if (!h.isValidId(req.params.id)) throw new h.HttpError(404, 'User not found');
            var q = User.findById(req.params.id);
            if (select) q = q.select(select);
            var user = await q;
            if (!user) throw new h.HttpError(404, 'User not found');
            h.send(res, 200, 'OK', user);
        })
        .put(async function (req, res) {
            if (!h.isValidId(req.params.id)) throw new h.HttpError(404, 'User not found');
            var user = await User.findById(req.params.id);
            if (!user) throw new h.HttpError(404, 'User not found');

            var b = validateUserBody(req.body);
            await checkEmail(b.email, user._id);
            await checkTasks(b.pendingTasks);

            var oldIds = user.pendingTasks.map(String);
            user.name = b.name;
            user.email = b.email;
            user.pendingTasks = b.pendingTasks;
            await user.save();
            await syncTasks(user, oldIds, b.pendingTasks);
            h.send(res, 200, 'User updated', user);
        })
        .delete(async function (req, res) {
            if (!h.isValidId(req.params.id)) throw new h.HttpError(404, 'User not found');
            var user = await User.findById(req.params.id);
            if (!user) throw new h.HttpError(404, 'User not found');
            await Task.updateMany({ assignedUser: String(user._id) }, { assignedUser: '', assignedUserName: 'unassigned' });
            await user.deleteOne();
            h.send(res, 200, 'User deleted', {});
        });

    return router;
};
