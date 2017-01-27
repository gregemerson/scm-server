/*
    Business Rules.
    - Clients can have only one access token at a time. Tokens time-out in 2 weeks
    - Guests cannot login or logout and the guest access token (virtually) never expires
    - When no client references an exercise set, the set will be deleted
    - 
*/

module.exports = function(Client) {
    var app = require('../../server/server');
    var constraints = require('../constraints');

    Client.validatesUniquenessOf('username');
    Client.validatesLengthOf('username', {min: constraints.user.minUserNameLength, max: constraints.user.maxUserNameLength});
    Client.validatesUniquenessOf('email');
    Client.validatesLengthOf('email', {max: constraints.email.maxEmailLength});

    Client.beforeRemote('create', function(ctx, instance, next) {
        next(Client.createClientError('Create should not being called directly.'));
    });

    Client.beforeRemote('*.__create__exerciseSets', function(ctx, instance, next) {
        ctx.req.body['created'] = new Date();
        ctx.req.body['ownerId'] = ctx.req.accessToken.userId;
        next();
    });

    Client.beforeRemote('*.__unlink__exerciseSets', function(ctx, emptyObj, next) {
        let exerciseSetId = parseInt(ctx.req.params.fk);
        app.models.Client.findOne(exerciseSetId, function(err, exerciseSet) {
            if (err) {
                next(err);
            }
            else {
                exerciseSet.clients.find({limit: 1}, function(err, clients) {
                    if (clients.length == 0) {
                        exerciseSet.destroy(function(err) {
                            if (err) {
                                next(err);
                            }
                            else {
                                next();
                            }
                        });
                    }
                    else {
                        next();
                    }
                });
            }
        });
    });

    // For diagnostics
    Client.beforeRemote('**', function(ctx, exerciseSet, next) {
        console.log(ctx.methodString, 'was invoked remotely');
        next();
    });
           

    Client.beforeRemote('updateAttributes', function(ctx, instance, next) {
        // @todo add acl that the membershipExpiry property can only be set by the admin
        delete ctx.req.body.membershipExpiry;
        next();
    });

    Client.beforeRemote('login', function(ctx, instance, next) { 
        // Tokens expire in 200 years
        ctx.req.body.ttl = 60 * 60 * 24 * 365 * 200;
        next();
    });

    Client.beforeRemote('logout', function(ctx, instance, next) {
        // Extra protection
        Client.find({where: {username: 'guest'}}, function(err, user){
            if (err || !ctx.req.accessToken || user.id == ctx.req.accessToken.id) {
                next(Client.createClientError('Guests cannot logout.'));           
            }
            else {
                next();
            }
        });
    });

    Client.afterRemote('login', function(ctx, auth, next) {
        var deleteCallback = function(err, info) {
            // @todo Need to log these
            console.log(err, info);
        };
        app.models.AccessToken.destroyAll({and: [{userId: auth.userId}, {id: {neq: auth.id}}]}, deleteCallback);
        next();
    });

    Client.afterRemote('findById', (ctx, client, next) => {
        try {
            var receivedSetToClient = {};
            var sharedSetToClient = {};
            var clientIds = [];
            var clientToUserName = {};
            var receivedExerciseSets = [];
            var sharedExerciseSets = [];
        app.models.SharedExerciseSet.find({where: {or: [{receiverId: client.id}, {sharerId: client.id}]}})
            .then((shares) => {
                shares.forEach((share) => {
                    clientIds.push(share.sharerId);
                    if (share.receiverId == client.id) {
                        // Who shared with client
                        receivedSetToClient[share.exerciseSetId] = share.sharerId;
                    }
                    else {
                        // With whom did client share
                        sharedSetToClient[share.exerciseSetId] = share.receiverId;
                    }
                });
            })
            .then(() => Client.idsToUserNames(clientIds))
            .then((clientIdToName) => {
                clientIdToUserName = clientIdToName;
                console.log('mappings')
                console.dir(clientIdToName)
                console.dir(receivedSetToClient)
                console.dir(sharedSetToClient)
                return client.receivedExerciseSets({});
            })
            .then((sets) => {
                console.log('received exercise sets')
                console.dir(sets)
                sets.forEach((set) => {
                    Client.toExerciseSetDescriptor(set,
                        clientIdToUserName[receivedSetToClient[set.id]]);
                });
                ctx.result.__data['receivedExerciseSets'] = sets;
                return client.sharedExerciseSets({});
            })
            .then((sets) => {
                sets.forEach((set) => {
                    Client.toExerciseSetDescriptor(set,
                        clientIdToUserName[sharedExerciseSets[set.id]]);
                });
                ctx.result.__data['sharedExerciseSets'] = sets;
                next();
                console.log('the result is ')
                console.dir(ctx.result)
                return Promise.resolve();            
            })
            .catch((err) => {
                // @todo logging
                console.log('Error in creating share lists');
                console.dir(err);
                next(new Error('Could not construct share lists'));
            });
        }
        catch(err) {
            console.log('Exeption thrown');
            console.dir(err);
            next(err);           
        }
    });

    Client.toExerciseSetDescriptor = (exerciseSet, username) => {
        exerciseSet['username'] = username;
        delete exerciseSet.created;
        delete exerciseSet.disabledExercises;
        delete exerciseSet.exerciseOrdering;
    }

    Client.idsToUserNames = function(ids) {
        return Client.find({
            where: {id: {inq: ids}},
            fields: {id: true, username: true}
        })
        .then((usernames) => {
            var map = {};
            usernames.forEach(function(value) {
                map[value.id] = value.username;
            })
            return Promise.resolve(map);
        });
    }

    Client.createClientError = function(message) {
        var error = new Error();
        error.status = 400;
        error.message = message;
        return error;
    }

    Client.rollbackOnError = function(err, tx, cb) {
        tx.rollback();
        return cb(err); 
    }

    Client.defaultUserSettings = function() {
        this.currentExerciseSet = -1;
        this.numberOfRepititions = 20;
        this.minTempo = 80;
        this.maxTempo = 80;
        this.tempoStep = 10;       
    }

    Client.initialSubscription = function() {
        this.expires = null;
        this.kind = 1;
        this.maxExerciseSets = 1;
    }

    Client.remoteMethod(
        'createNewUser',
        {
          accepts: [
              {arg: 'initializer', type: 'Object', http: {source: 'body'}, required: true}
            ],
            http: {path: '/createNewUser', verb: 'post'},
            returns: {arg: 'userInfo', type: 'Object'}
        }
    );

    Client.createNewUser = function(initializer, cb) {
        initializer.created = new Date();
        initializer.lastUpdated = new Date();
        var sub = null;
        var set = null;
        var cli = null;
        var tx = null;
        try {
            Client.beginTransaction({timeout: 10000}, function(err, trans) {
                if (err) return cb(err);
                tx = trans;
                app.models.Subscription.create(Client.initialSubscription(), {transaction: tx})
                .then((subscription) => {
                    sub = subscription;
                    initializer.subscriptionId = subscription.id;
                    return app.models.UserSettings.create(Client.defaultUserSettings(), {transaction: tx})
                })
                .then((settings) => {
                    set = settings;
                    initializer.usersettingsId = settings.id;
                    return Client.create(initializer, {transaction: tx});
                })
                .then((client) => {
                    cli = client;
                    return set.updateAttributes({clientId: cli.id}, {transaction: tx});
                })
                .then((settings) => {
                    return sub.updateAttributes({clientId: cli.id}, {transaction: tx});
                })
                .then((subscription) => {
                    return app.models.ExerciseSet.find({where: {public: 1}});
                })
                .then((sets) => {
                    console.log('the sets object is: ')
                    console.dir(sets);
                    var promises = [];
                    sets.forEach((exerciseSet) => {
                        promises.push(cli.exerciseSets.add(exerciseSet, {transaction: tx}));
                    });
                    return Promise.all(promises);
                })
                .then((results) => {
                    tx.commit();
                    return cb(null, {id: cli.id});
                })
                .catch((err) => {
                    console.log(err);
                    return Client.rollbackOnError(err, tx, cb);
                });
            });
        }
        catch (err) {
            if (tx) {
                return Client.rollbackOnError(err, tx, cb);
            }
            else {
                return cb(err);
            }
        }
    }

    Client.remoteMethod(
        'sharedExerciseSets',
        {
          accepts: [
              {arg: 'sharerId', type: 'number', required: true},
              {arg: 'data', type: 'Object', http: {source: 'body'}, required: true}
            ],
            http: {path: '/:sharerId/sharedExerciseSets', verb: 'post'},
            returns: {arg: 'share', type: 'Object'}
        }
    );

    Client.sharedExerciseSets = function(sharerId, shareIn, cb) {
        try {
            var sharedExerciseSet;
            if (shareIn.receiverName == constraints.user.guestUsername) {
                return cb(Client.createClientError("Cannot share with guest"));
            }
            shareIn.created = Date.now();
            Client.findOne({where: {username: shareIn.receiverName}}, function(err, receiver){
                if (err) return cb(err);
                if (!receiver) {
                    return cb(Client.createClientError("User does not exist"));
                }
                shareIn.receiverId = receiver.id;
                Client.findOne({where: {id: sharerId}}, function(err, sharer) {
                    if (err) return cb(err);
                    if (sharer.username == constraints.user.guestUsername) {
                        return cb(Client.createClientError("Guest cannot share"));
                    }
                    sharer.exerciseSets.findOne({where: {id: shareIn.exerciseSetId}}, function(err, exerciseSet) {
                        if (err) return cb(err);
                        if (!exerciseSet) {
                            return cb(Client.createClientError(
                                'Sharer does not have the exercise set'));
                        }
                        sharedExerciseSet = exerciseSet;
                        app.models.SharedExerciseSet.findOne({where: {
                            exerciseSetId: shareIn.exerciseSetId,
                            sharerId: sharerId,
                            receiverId: shareIn.receiverId
                        }}, function(err, existingShare) {
                            if (err) return cb(err);
                            if (existingShare) {
                                return cb(existingShare);
                            }
                            app.models.SharedExerciseSet.create(shareIn, function(err, instance) {
                                if (err) return cb(err);
                                return cb(Client.toExerciseSetDescriptor(sharedExerciseSet));
                            });
                        });
                    });
                });
            });
        }
        catch (err) {
            return cb(err);
        }
    }

    Client.remoteMethod(
        'receiveExerciseSets',
        {
          accepts: [
              {arg: 'clientId', type: 'number', required: true},
              {arg: 'exerciseSetId', type: 'number', required: true}
            ],
          http: {path: '/:clientId/receivedExerciseSets/:exerciseSetId', verb: 'get'},
          returns: {arg: 'receiveExerciseSet', type: 'Object'}
        }
    );

    Client.receiveExerciseSets = function(clientId, exerciseSetId, cb) {
        try {
            Client.findOne({where: {id: clientId}}, function(err, client) {
                if (err) return cb(err);
                if (!client) return cb(Client.createClientError('Could not fiind user'));
                client.receivedExerciseSets.findOne({where: {id: exerciseSetId}}, function(err, exerciseSet) {
                    if (err) return cb(err);
                    if (!exerciseSet) return cb(Client.createClientError('Exercise set has not be shared with user'));
                    client.exerciseSets.add(exerciseSet, options, function(err) {
                        if (err) return cb(err);
                        cb(exerciseSet);
                    }); 
                });
            });
        }
        catch (err) {
            cb(err);
        }
    }
}
