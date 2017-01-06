

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

    // Set the new set as currentExerciseSet
    Exerciseset.afterRemote('create', function(ctx, exerciseSet, next) {
        // @todo Limit number of exercise sets here

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
    Exerciseset.rb = function(err, tx, cb) {
        tx.rollback();
        return cb(err);
    }

    Exerciseset.createdExercises = function(id, data, cb) {
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