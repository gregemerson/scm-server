module.exports = function(Exercise) {
    var constraints = require('../constraints');
    Exercise.validatesLengthOf('name', {max: constraints.exercise.maxNameLength});
    Exercise.validatesLengthOf('notation', {max: constraints.exercise.maxNotationLength});
    Exercise.validatesLengthOf('category', {max: constraints.exercise.maxCategoryLength});
    Exercise.validatesLengthOf('comments', {max: constraints.exercise.maxExerciseCommentsLength});
};
