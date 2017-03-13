
module.exports = function(Client) {
    var config = require('../../server/config.json');
    var path = require('path');
    var app = require('../../server/server');
    var constraints = require('../constraints');

    Client.validatesUniquenessOf('username');
    Client.validatesLengthOf('username', {min: constraints.user.minUserNameLength, max: constraints.user.maxUserNameLength});
    Client.validatesUniquenessOf('email');
    Client.validatesLengthOf('email', {max: constraints.email.maxEmailLength});

    Client.beforeRemote('create', function(ctx, instance, next) {
        next(Client.createClientError('Create should not being called directly.'));
    });

    Client.verificationFailed = function(error, client, next) {
        error.statusCode = 400;
        try {
            client.destroy(function(e) {
                // @todo log this stranded client record
                if (e) {
                    console.log('> client record orphaned -- '  +  e);
                }
            });
            return next(error);
        }
        catch(e) {
            // @todo logging
            return next(error);
        }
    }

    Client.afterRemote('createNewUser', function(context, unused, next) {
        let client = context.args.options.newClient;
        delete context.args.options.newClient;
        try {
            let options = {
                type: 'email',
                to:client.email,
                from: 'noreply@stick-ctrl.com',
                template: 'views/verify.ejs',
                redirect: '/verification.html',
                tokenGenerator: function (user, cb) { cb("random-token"); }
            };

            client.verify(options, function(err, response) {
                if (err) {
                    // @todo error logging
                    return Client.verificationFailed(err, client, next);
                }
                context.result = {
                    title: 'Signed up successfully',
                    content: 'Please check your email and click on the verification ' +
                        'link before logging in.'
                };
                next();
            });
        }
        catch (err) {
            Client.verificationFailed(err, client, next);
        }
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
            ],
            http: {path: '/:clientId/exerciseSetSharing', verb: 'get'},
            returns: {arg: 'lists', type: 'Object'}
        }
    );

    /* 
    Get client's receivd and shared lists
    */
    Client.exerciseSetSharing = (clientId, cb) => {
        try {
            result = {
                shared: [],
                received: []
            };
            var whereClause = {where: {or: [{receiverId: clientId}, {sharerId: clientId}]}};
            var receivedShares = [];
            var sharedShares = [];
            var clientIds = [clientId];
            var clientToUserName = {};
            var receivedExerciseSets = {};
            var sharedExerciseSets = {};
            var client;
            return app.models.SharedExerciseSet.find({where: whereClause})
            .then((shares) => {
                shares.forEach((share) => {
                    if (share.receiverId == clientId) {
                        clientIds.push(share.sharerId);
                        receivedShares.push(share);
                    }
                    else {
                        clientIds.push(share.receiverId);
                        sharedShares.push(share);
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
                console.log('here are the sets ')
                console.dir(sets)
                sets.forEach((set) => {
                    receivedExerciseSets[set.id] = set;
                });
                return client.sharedExerciseSets({});
            })
            .then((sets) => {
                  sets.forEach((set) => {
                    sharedExerciseSets[set.id] = set;
                });
                receivedShares.forEach((share) => {
                    result.received.push(Client.toShareDescriptor(
                        receivedExerciseSets[share.exerciseSetId], share, clientIdToUserName)
                    )})
                sharedShares.forEach((share) => {
                    result.shared.push(Client.toShareDescriptor(
                        sharedExerciseSets[share.exerciseSetId], share, clientIdToUserName)
                    )})
                return Promise.resolve(result);  
            })
            .catch((reason) => {    
                return Promise.resolve(Client.createError(reason));
            });
        }
        catch(err) {
            console.log('Exeption thrown');
            console.dir(err);
            cb(err);           
        }
    }

    Client.toShareDescriptor = (exerciseSet, share, idsToNames) => {
        exerciseSet.__data['shareId'] = share.id;
        exerciseSet.__data['receiverName'] = idsToNames[share.receiverId];
        exerciseSet.__data['receiverId'] = share.receiverId;
        exerciseSet.__data['sharerName'] = idsToNames[share.sharerId];
        exerciseSet.__data['sharerId'] = share.sharerId;
        exerciseSet.__data['comments'] = share.comments;
        delete exerciseSet.__data.created;
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

    Client.defaultUserSettings = function(clientId) {
        this.clientId = clientId;
        this.currentExerciseSet = -1;
        this.numberOfRepititions = 20;
        this.minTempo = 80;
        this.maxTempo = 80;
        this.tempoStep = 10;       
    }

    Client.initialSubscription = function(clientId) {
        this.clientId = clientId;
        this.expires = null;
        this.kind = 1;
        this.maxExerciseSets = 1;
    }

    Client.remoteMethod(
        'createNewUser',
        {
          accepts: [
              {arg: 'initializer', type: 'Object', http: {source: 'body'}, required: true},
              {arg: "options", type: "object", http: "optionsFromRequest"}
            ],
            http: {path: '/createNewUser', verb: 'post'},
            returns: {root: 'true', type: 'any'}
        }
    );

    Client.createNewUser = function(initializer, options, cb) {
        initializer.created = new Date();
        initializer.lastUpdated = new Date();
        var client = null;
        var tx = null;
        try {
            return Client.beginTransaction({timeout: 10000})
            .then((trans) => {
                tx = trans;
                return Client.find({where: {or: [
                    {username: initializer.username},
                    {email: initializer.email}
                ]}});
            })
            .then((result) => {
                if (result.length == 0) {
                    return Client.create(initializer, {transaction: tx});
                }
                if (result.username == initializer.username) {
                    return Promise.reject('User name is already in use');
                }
                return Promise.reject('Email is already in use')
            })
            .then((cli) => {
                client = cli;
                return app.models.Subscription.create(Client.initialSubscription(client.id), {transaction: tx})                   
            })
            .then((subscription) => {
                return app.models.UserSettings.create(Client.defaultUserSettings(client.id), {transaction: tx})
            })
            .then((settings) => {
                return app.models.ExerciseSet.find({where: {public: 1}});
            })
            .then((exerciseSets) => {
                client.exerciseSets.add(exerciseSets, {transaction: tx});
            })
            .then((results) => {
                tx.commit();
                options.newClient = client;
                return Promise.resolve();
            })
            .catch((err) => {
                console.log('create user error ')
                console.dir(err)
                if (tx) tx.rollback();
                tx = null;
                return Promise.resolve(Client.createError(err));
            });
        }
        catch (err) {
            if (tx) tx.rollback();
            return cb(Client.createError(err));
        }
    }

    Client.createError = function(message) {
        return {
            error: {
                statusCode: 400,
                message: message.toString(),
                errorCode: "PRECONDITIONS_ERROR"
            }
        }
    }

    Client.remoteMethod(
        'shareExerciseSet',
        {
          accepts: [
              {arg: 'sharerId', type: 'number', required: true},
              {arg: 'shareIn', type: 'Object', http: {source: 'body'}, required: true}
            ],
            http: {path: '/:sharerId/shareExerciseSet', verb: 'post'},
            returns: {root: 'true', type: 'Object'}
        }
    );

    /*
    shareIn is an object containing properties receiverName and exerciseSetId
    */
    Client.shareExerciseSet = function(sharerId, shareIn, cb) {
        let receiver = null;
        let sharer = null;
        let setWhere = {where: {exerciseSetId: shareIn.exerciseSetId}};
        let newShare = null;
        let newShareWhere = null;
        try {
            return (new Promise((resolve, reject) => {
                if (shareIn.receiverName != constraints.user.guestUsername) {
                    resolve(null);
                }
                reject("Cannot share with guest");
            }))
            .then(() => {
                return Client.find({where: {or: [{username: shareIn.receiverName}, {id: sharerId}]}})
            })
            .then((clients) => {
                if (clients.length == 2) {
                    sharerIdx = (clients[0].id == sharerId) ? 0 : 1;
                    sharer = clients[sharerIdx];
                    receiver = clients[(sharerIdx + 1) % 2];
                    newShare = {
                        receiverId: receiver.id,
                        sharerId: sharer.id,
                        exerciseSetId: shareIn.exerciseSetId,
                        created: Date.now(),
                        comments: shareIn.comments
                    }
                    newShareWhere = {where: {and: [
                        {receiverId: receiver.id},
                        {sharerId: sharer.id},
                        {exerciseSetId: shareIn.exerciseSetId}
                    ]}}
                    return Promise.resolve();                  
                }
                return Promise.reject('Receiver does not exist');
            })
            .then(() => {
                if (sharer.username != constraints.user.guestUsername) {
                    return sharer.exerciseSets.findOne(setWhere);
                }
                return Promise.reject('Guests cannot share')  
            })
            .then((result) => {
                if (result) {
                    return receiver.exerciseSets.findOne(setWhere);                   
                }
                return Promise.reject('Sharer does not have exercised set');
            })
            .then((result) => {
                if (!result) {
                    return app.models.SharedExerciseSet.findOne(newShareWhere);                    
                }
                return Promise.reject('Receiver already has exercise set');
            })
            .then((result) => {
                if (!result) {
                    return app.models.SharedExerciseSet.create(newShare);
                }
                return Promise.reject('Has already been shared')
            })
            .then((result) => {
                return app.models.ExerciseSet.findById(shareIn.exerciseSetId);
            })
            .then((result) => {
                idsToNames = {};
                idsToNames[sharer.id] = sharer.username;
                idsToNames[receiver.id] = receiver.username;
                Client.toShareDescriptor(result, newShare, idsToNames);
                return Promise.resolve(result);
            })
            .catch((err) => {
                return Promise.resolve(Client.createError(err));
            })
        }
        catch(err) {
            return cb(Client.createError('Could not share'));
        }
    }

    Client.remoteMethod(
        'receiveExerciseSet',
        {
          accepts: [
              {arg: 'receiverId', type: 'number', required: true},
              {arg: 'exerciseSetId', type: 'number', required: true}
            ],
          http: {path: '/:receiverId/receiveExerciseSet/:exerciseSetId', verb: 'get'},
          returns: {root: 'true', type: 'Object'}
        }
    );

    Client.receiveExerciseSet = function(receiverId, exerciseSetId, cb) {
        let tx;
        var receiver;
        var receivedExerciseSet;
        try {
            return Client.beginTransaction({timeout: 10000})
                .then((trans) => {
                    tx = trans;
                    return app.models.SharedExerciseSet.findOne({
                        where: {
                            and: [
                                {receiverId: receiverId},
                                {exerciseSetId: exerciseSetId}
                            ]}});
                })
                .then((share) => {
                    if (share) {
                        return Client.findById(receiverId);
                    }
                    return Promise.reject('Exercise set has not been shared with user');
                })
                .then((client) => {
                    receiver = client;
                    return receiver.exerciseSets.findById(exerciseSetId);
                })
                .then((exerciseSet) => {
                    if (!exerciseSet) {
                        return app.models.ExerciseSet.findById(exerciseSetId);
                    }
                    return Promise.reject('User already has exercise set');
                })
                .then((exerciseSet) => {
                    receivedExerciseSet = exerciseSet;
                    return receiver.exerciseSets.add(exerciseSet, {transaction: tx});
                })
                .then((resolved) => {
                    return app.models.SharedExerciseSet.destroyAll({
                        where: {
                            and: [
                                {receiverId: receiverId},
                                {exerciseSetId: exerciseSetId}
                            ]}}, {transaction: tx});
                })
                .then((resolved) => {
                    tx.commit();
                    return Promise.resolve(receivedExerciseSet);
                })
                .catch((err) => {
                    if (tx) tx.rollback();
                    return Promise.resolve(Client.createError(err));
                });
        }
        catch (err) {
            if (tx) tx.rollback();
            cb(err);
        }
    }
}
