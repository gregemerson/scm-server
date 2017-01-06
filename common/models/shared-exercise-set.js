module.exports = function(SharedExerciseSet) {
    var constraints = require('../constraints');
    SharedExerciseSet.validatesLengthOf('comments', {
        max: constraints.exercise.maxSharedExerciseComments
    });
};
