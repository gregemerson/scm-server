/*
    Business Rules of Note.
    - Access token don't (virtually) expire.
    - Clients can have only one access token at a time.
    - Guests cannot login or logout and have only read access throughout
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
    
    // Remove exercise set if no client is referencing it
    Client.afterRemote('*.__unlink__exerciseSets', function(ctx, emptyObj, next) {
        let exerciseSetId = parseInt(ctx.req.params.fk);
        let exerciseSet = null;
        app.models.ExerciseSet.findById(exerciseSetId)
        .then((es) => {
            exerciseSet = es;
            return exerciseSet.clients({limit: 1});
        })
        .then((clients) => {
            if (clients.length == 0) {
                return exerciseSet.destroy();
            }
            next();
            return Promise.resolve();
        })
        .then(() => {
            next();
            return Promise.resolve();
        })
        .catch((err) => {
            next(err);
        })
    });

    // For diagnostics
    Client.beforeRemote('**', function(ctx, exerciseSet, next) {
        console.log(ctx.methodString, 'was invoked remotely on client');
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

    Client.remoteMethod(
        'exerciseSetSharing',
        {
          accepts: [
              {arg: 'clientId', type: 'number', required: true},
              {arg: 'receivedOnly', type: 'boolean', required: true}
            ],
            http: {path: '/:clientId/exerciseSetSharing/:receivedOnly', verb: 'get'},
            returns: {arg: 'lists', type: 'Object'}
        }
    );

    /* 
    Get client's receivd and shared lists
    */
    Client.exerciseSetSharing = (clientId, receivedOnly, callback) => {
        try {
            result = {
                shared: null,
                received: null
            };
            var whereClause = receivedOnly ? {receiverId: clientId} : 
                {where: {or: [{receiverId: clientId}, {sharerId: clientId}]}};
            var receivedSetToClient = {};
            var sharedSetToClient = {};
            var clientIds = [];
            var clientToUserName = {};
            var receivedExerciseSets = [];
            var sharedExerciseSets = [];
            var client;
            app.models.SharedExerciseSet.find({where: whereClause})
            .then((shares) => {
                shares.forEach((share) => {
                    clientIds.push(share.sharerId);
                    if (share.receiverId == clientId) {
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
                return Client.findById(clientId);
            })
            .then((result) => {
                client = result;
                return client.receivedExerciseSets({});
            })
            .then((sets) => {
                sets.forEach((set) => {
                    Client.toShareDescriptor(set,
                        clientIdToUserName[receivedSetToClient[set.id]]);
                });
                result.received = sets;
                return client.sharedExerciseSets({});
            })
            .then((sets) => {
                sets.forEach((set) => {
                    Client.toShareDescriptor(set,
                        clientIdToUserName[sharedExerciseSets[set.id]]);
                });
                result.shared = sets;
                callback(null, result);
                return Promise.resolve();            
            })
            .catch((err) => {         
                // @todo logging
                callback(new Error('Could not construct share lists'));
                return Promise.resolve();
            });
        }
        catch(err) {
            console.log('Exeption thrown');
            console.dir(err);
            callback(err);           
        }
    }

    Client.toShareDescriptor = (exerciseSet, username) => {
        exerciseSet.__data['username'] = username;
        delete exerciseSet.__data.created;
        delete exerciseSet.__data.disabledExercises;
        delete exerciseSet.__data.exerciseOrdering;
        delete exerciseSet.__data.ownerId;
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
        this.maxExerciseSets = 2;
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
        'shareExerciseSet',
        {
          accepts: [
              {arg: 'sharerId', type: 'number', required: true},
              {arg: 'data', type: 'Object', http: {source: 'body'}, required: true}
            ],
            http: {path: '/:sharerId/sharedExerciseSets', verb: 'post'},
            returns: {arg: 'share', type: 'Object'}
        }
    );

    /*
    shareIn is an object containing properties receiverName and exerciseSetId
    */
    Client.shareExerciseSet = function(sharerId, shareIn, cb) {
        let receiver = null;
        let sharer = null;
        let exerciseSet = null;
        try {
            var sharedExerciseSet;
            if (shareIn.receiverName == constraints.user.guestUsername) {
                return cb(Client.createClientError("Cannot share with guest"));
            }
            shareIn.created = Date.now();
            return Client.findOne({where: {username: shareIn.receiverName}})
            .then((result) => {
                if (!result) {
                    return Promise.reject('Receiver does not exist');
                }
                return Client.findOne({where: {id: sharerId}});
            })
            .then((result) => {
                sharer = result;
                if (sharer.username == constraints.user.guestUsername) {
                    return Promise.reject("Guest cannot share");
                }
                return sharer.exerciseSets.findOne({where: {id: shareIn.exerciseSetId}});        
            })
            .then((result) => {
                if (!exerciseSet) {
                    return Promise.reject('Sharer does not have exercise set')
                }
                exerciseSet = result;
                return receiver.exerciseSets.findOne({where: {id:shareIn.exerciseSetId}});
            })
            .then((result) => {
                if (result) {
                    return Promise.reject('Receiver already has exercise set')
                }
                return app.models.SharedExerciseSet.findOne({where: {
                            exerciseSetId: shareIn.exerciseSetId,
                            sharerId: sharerId,
                            receiverId: shareIn.receiverId
                        }});
            })
            .then((share) => {
                if (share) {
                    return Promise.reject('Exercise set has already been shared');
                }
                return app.models.SharedExerciseSet.create(shareIn);
            })
            .then((result) => {
                return Promise.resolve(Client.toShareDescriptor(exerciseSet, shareIn.receiverName));
            })
            .catch((reason) => {
                let err = new Error(reason);
                err.status = 400;
                return Promise.resolve(err);
            });
        }
        catch(err) {
            return cb(Client.createClientError('Could not share'));
        }
    }

    /*
    shareIn is an object containing properties receiverName and exerciseSetId
    */
    Client.shareExerciseSet2 = function(sharerId, shareIn, cb) {
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
                                return cb(Client.toShareDescriptor(sharedExerciseSet, shareIn.receiverName));
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
        'unshareExerciseSet',
        {
          accepts: [
              {arg: 'sharerId', type: 'number', required: true},
              {arg: 'data', type: 'Object', http: {source: 'body'}, required: true}
            ],
            http: {path: '/:sharerId/sharedExerciseSets', verb: 'post'},
            returns: {arg: 'share', type: 'Object'}
        }
    );

    /*
    shareIn is an object containing properties receiverName and exerciseSetId
    */
    Client.unshareExerciseSet = function(sharerId, shareIn, cb) {
        try {
            return Client.findOne({
                where: {
                    username: shareIn.receiverName
                }
            })
            .then((receiver) => {
                return app.models.SharedExerciseSet.destroyAll({where: {
                            exerciseSetId: shareIn.exerciseSetId,
                            sharerId: sharerId,
                            receiverId: receiver.id
                }});
            })
            .catch((err) => {
                return Promis.resolve(err)
            }); 
        }
        catch (err) {
            return cb(err);
        }
    }

    Client.remoteMethod(
        'receiveExerciseSet',
        {
          accepts: [
              {arg: 'clientId', type: 'number', required: true},
              {arg: 'exerciseSetId', type: 'number', required: true}
            ],
          http: {path: '/:clientId/receivedExerciseSets/:exerciseSetId', verb: 'get'},
          returns: {arg: 'receivedExerciseSet', type: 'Object'}
        }
    );

    Client.receiveExerciseSet = function(clientId, exerciseSetId, cb) {
        let tx = null;
        try {
            var receiver;
            var receivedExerciseSet = null;
            return Client.findById(clientId)
            .then((transaction) => {
                tx = transaction;
            })
            .then((client) => {
                receiver = client;
                return client.receivedExerciseSets.findOne({where: {id: exerciseSetId}});
            })
            .then((exerciseSet) => {
                receivedExerciseSet = exerciseSet;
                return receiver.exerciseSets.add(exerciseSet, {transaction: tx});
            })
            .then((resolved) => {
                return app.models.SharedExerciseSet.destroyAll({
                    where: {
                        receiverId: clientId,
                        exerciseSetId: exerciseSetId
                    }
                }, {transaction: tx});
            })
            .then((resolved) => {
                tx.commit();
                return Promise.resolve(receivedExerciseSet);
            })
            .catch((err) => {
                if (tx) tx.rollback();
                return Promise.resolve(err);
            });
        }
        catch (err) {
            if (tx) tx.rollback();
            cb(err);
        }
    }
}
