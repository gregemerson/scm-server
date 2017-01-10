
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
    Exerciseset.rollback = function(err, tx, cb) {
        if (tx) tx.rollback();
        var error = new Error();
        error.status = 400;
        error.message = err;
        return cb(error);
    }

    // Post (create) new exercise in this exercise set
    Exerciseset.createdExercises = function(id, data, cb) {
        data.created = Date.now();
        var limit = Constraints.exercise.maxPerExerciseSet;
        var es = null;
        var ex = null;
        var tx = null;
        try {
            app.models.Exercise.count({exerciseSetId: 1})
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
            .catch((reason) => {
                Exerciseset.rollback(reason, tx, cb);
            });            
        }
        catch (err) {
            Exerciseset.rollback(err.message, tx, cb);
        }
        /*
        Exerciseset.beginTransaction({}, function(err, tx) {
            try {
                if (err) return Exerciseset.rb(err, tx, cb);
                data.created = Date.now();
                Exerciseset.findById(id, [], function(err, exerciseSet) {
                    if (err) return Exerciseset.rb(err, tx, cb);
                    exerciseSet.exercises.create(data, {transaction: tx}, function(err, newExercise) {
                        if (err) return Exerciseset.rb(err, tx, cb);
                        let ordering = JSON.parse(exerciseSet.exerciseOrdering);
                        ordering.push(newExercise.id);
                        exerciseSet.exerciseOrdering = JSON.stringify(ordering);
                        exerciseSet.save({transaction: tx}, function(err, newSet) {
                            if (err) return Exerciseset.rb(err, tx, cb);
                            tx.commit(function(err) {
                                if (err) return Exerciseset.rb(err, tx, cb);
                            });
                            cb(null, newExercise);
                        });
                    });
                });
            }
            catch (err) {
                Exerciseset.rb(err, tx, cb);
            }
        });
        */
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