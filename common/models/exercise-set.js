
module.exports = function(Exerciseset) {
    var app = require('../../server/server');
    var constraints = require('../constraints');

    Exerciseset.validatesLengthOf('name', {max: constraints.exercise.maxNameLength});
    Exerciseset.validatesLengthOf('category', {max: constraints.exercise.maxCategoryLength});
    Exerciseset.validatesLengthOf('comments', {max: constraints.exercise.maxExerciseSetCommentsLength});

    Exerciseset.beforeRemote('*.__create__exercises', function(ctx, instance, next) {
        // @todo Need to limit number of exercises here

        ctx.req.body['created'] = new Date();
        ctx.req.body['ownerId'] = ctx.req.accessToken.userId;
        next();
    });

    Exerciseset.beforeRemote('create', function(ctx, instance, next) {
        // @todo Limit number of exercise sets here
    });

    // Set the new set as currentExerciseSet
    Exerciseset.afterRemote('create', function(ctx, exerciseSet, next) {
        app.models.Usersettings.find(
            {where: {clientId: ctx.req.accessToken.userId}},
                function(err, settings) { 
                    settings.currentExerciseSet = exerciseSet.id;
                    settings.save();
                });

        next();
    });
/*
    // For diagnostics
    Exerciseset.beforeRemote('**', function(ctx, exerciseSet, next) {
        console.log(ctx.methodString, 'was invoked remotely');
        next();
    });
*/

    // Post (create) new exercise in this exercise set
    Exerciseset.createdExercises = function(id, data, cb) {
        let es = ex = tx = null;
        try {
            data.created = Date.now();
            let limit = constraints.exercise.maxPerExerciseSet;
            return  app.models.Exercise.count({exerciseSetId: id})
            .then((result) => {
                if (result >= limit) {
                    return Promise.reject('No more exercises can be added');
                }
                return Exerciseset.beginTransaction({});
            })
            .then((transaction) => {
                tx = transaction;
                return Exerciseset.findById(id);
            })
            .then((exerciseSet) => {
                es = exerciseSet;
                return exerciseSet.exercises.create(data, {transaction: tx});
            })
            .then((exercise) => {
                ex = exercise;
                let ordering = JSON.parse(es.exerciseOrdering);
                ordering.push(exercise.id);
                es.exerciseOrdering = JSON.stringify(ordering);
                return es.save({transaction: tx});         
            })
            .then((set) => {
                return tx.commit();
            })
            .then(() => {
                return Promise.resolve(ex);
            })
            .catch((reason) => {
                if (tx) tx.rollback();
                let err = new Error(reason);
                err.status = 400;
                return Promise.resolve(err);
            });
        }
        catch(err) {
            if (tx) tx.rollback();
            cb(err);
        }
    }
     
    Exerciseset.remoteMethod(
        'createdExercises', 
        {
          accepts: [
              {arg: 'id', type: 'number', required: true},
              {arg: 'data', type: 'Object', http: {source: 'body'}, required: true}
            ],
          http: {path: '/:id/createdExercises', verb: 'post'},
          returns: {arg: 'exercise', type: 'Object'}
        }
    );
};