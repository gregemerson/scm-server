
var Constraints = function() {}

Constraints.prototype.exercise = {
    maxNameLength: 60,
    maxNotationLength: 600,
    maxCategoryLength: 100,
    maxExerciseCommentsLength: 100,
    maxExerciseSetCommentsLength: 200,
    maxSharedExerciseComments: 100,
    maxPerExerciseSet: 24
}

Constraints.prototype.email = {
    maxEmailLength: 254,
    guestEmail: 'guest@guest.com'
}

Constraints.prototype.user = {
    minUserNameLength: 5,
    maxUserNameLength: 20
}

Constraints.prototype.exerciseSets = {
    maxNoSubscription: 3,
    maxHasSubscription: 100
}

module.exports = new Constraints();


