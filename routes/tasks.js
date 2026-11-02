var User = require('../models/user');
var Task = require('../models/task');
var h = require('../utils/helpers');

function validateTaskBody(body) {
    body = body || {};
    if (typeof body.name !== 'string' || !body.name.trim()) throw new h.HttpError(400, 'A task must have a name');

    var dl = body.deadline;
    if (dl === undefined || dl === null || dl === '' || (typeof dl !== 'string' && typeof dl !== 'number')) {
        throw new h.HttpError(400, 'A task must have a valid deadline');
    }
    var deadline = (typeof dl === 'number' || /^\d+$/.test(dl)) ? new Date(Number(dl)) : new Date(dl);
    if (isNaN(deadline.getTime())) throw new h.HttpError(400, 'A task must have a valid deadline');

    var description = body.description === undefined || body.description === null ? '' : body.description;
    if (typeof description !== 'string') throw new h.HttpError(400, 'description must be a string');

    var completed = body.completed;
    if (completed === undefined || completed === null || completed === '') completed = false;
    else if (completed === 'true') completed = true;
    else if (completed === 'false') completed = false;
    else if (typeof completed !== 'boolean') throw new h.HttpError(400, 'completed must be true or false');

    var assignedUser = body.assignedUser === undefined || body.assignedUser === null ? '' : body.assignedUser;
    if (typeof assignedUser !== 'string') throw new h.HttpError(400, 'assignedUser must be a user id');
    if (assignedUser !== '' && !h.isValidId(assignedUser)) throw new h.HttpError(400, 'assignedUser is not a valid id');

    var assignedUserName = body.assignedUserName;
    if (assignedUserName !== undefined && assignedUserName !== null && typeof assignedUserName !== 'string') {
        throw new h.HttpError(400, 'assignedUserName must be a string');
    }
    if (assignedUserName === null) assignedUserName = undefined;

    return { name: body.name, description: description, deadline: deadline, completed: completed,
             assignedUser: assignedUser, assignedUserName: assignedUserName };
}

async function resolveAssignee(b) {
    if (b.assignedUser === '') {
        if (b.assignedUserName !== undefined && b.assignedUserName !== '' && b.assignedUserName !== 'unassigned') {
            throw new h.HttpError(400, 'assignedUserName does not match the assigned user');
        }
        return { assignedUser: '', assignedUserName: 'unassigned' };
    }
    var user = await User.findById(b.assignedUser);
    if (!user) throw new h.HttpError(404, 'The assigned user does not exist');
    if (b.assignedUserName !== undefined && b.assignedUserName !== user.name) {
        throw new h.HttpError(400, 'assignedUserName does not match the assigned user');
    }
    return { assignedUser: String(user._id), assignedUserName: user.name };
}

async function syncUser(taskId, prevUserId, newUserId, completed) {
    taskId = String(taskId);
    if (prevUserId && prevUserId !== newUserId) {
        await User.updateOne({ _id: prevUserId }, { $pull: { pendingTasks: taskId } });
    }
    if (newUserId) {
        await User.updateOne({ _id: newUserId },
            completed ? { $pull: { pendingTasks: taskId } } : { $addToSet: { pendingTasks: taskId } });
    }
}

module.exports = function (router) {

    router.route('/tasks')
        .get(async function (req, res) {
            var result = await h.runListQuery(Task, req, 100);
            h.send(res, 200, 'OK', result);
        })
        .post(async function (req, res) {
            var b = validateTaskBody(req.body);
            var who = await resolveAssignee(b);
            var task = await Task.create({
                name: b.name, description: b.description, deadline: b.deadline, completed: b.completed,
                assignedUser: who.assignedUser, assignedUserName: who.assignedUserName
            });
            await syncUser(task._id, '', task.assignedUser, task.completed);
            h.send(res, 201, 'Task created', task);
        });

    router.route('/tasks/:id')
        .get(async function (req, res) {
            var select = h.parseSelect(req);
            if (!h.isValidId(req.params.id)) throw new h.HttpError(404, 'Task not found');
            var q = Task.findById(req.params.id);
            if (select) q = q.select(select);
            var task = await q;
            if (!task) throw new h.HttpError(404, 'Task not found');
            h.send(res, 200, 'OK', task);
        })
        .put(async function (req, res) {
            if (!h.isValidId(req.params.id)) throw new h.HttpError(404, 'Task not found');
            var task = await Task.findById(req.params.id);
            if (!task) throw new h.HttpError(404, 'Task not found');

            var b = validateTaskBody(req.body);
            var who = await resolveAssignee(b);

            var prevUser = task.assignedUser;
            task.name = b.name;
            task.description = b.description;
            task.deadline = b.deadline;
            task.completed = b.completed;
            task.assignedUser = who.assignedUser;
            task.assignedUserName = who.assignedUserName;
            await task.save();
            await syncUser(task._id, prevUser, task.assignedUser, task.completed);
            h.send(res, 200, 'Task updated', task);
        })
        .delete(async function (req, res) {
            if (!h.isValidId(req.params.id)) throw new h.HttpError(404, 'Task not found');
            var task = await Task.findById(req.params.id);
            if (!task) throw new h.HttpError(404, 'Task not found');
            if (task.assignedUser) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: String(task._id) } });
            }
            await task.deleteOne();
            h.send(res, 200, 'Task deleted', {});
        });

    return router;
};
