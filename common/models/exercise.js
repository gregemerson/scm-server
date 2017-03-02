module.exports = function(Exercise) {
    var constraints = require('../constraints');
    Exercise.validatesLengthOf('name', {max: constraints.exercise.maxNameLength});
    Exercise.validatesLengthOf('notation', {min: 1, max: constraints.exercise.maxNotationLength});
    Exercise.validatesLengthOf('category', {min: 1, max: constraints.exercise.maxCategoryLength});
    //Exercise.validatesLengthOf('comments', {min: -1, max: constraints.exercise.maxExerciseCommentsLength});

    // For diagnostics
    Exercise.beforeRemote('**', function(ctx, exerciseSet, next) {
        console.log(ctx.methodString, 'was invoked remotely on exercise');
        next();
    });
};