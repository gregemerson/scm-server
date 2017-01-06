var path = require('path');
var app = require(path.resolve(__dirname, '../server/server'));
//var ds = app.datasources.mysqlDs;

// Step one - create tables
//ds.automigrate();
//
/*
var clients = [
{
    email: 'amazatron@hotmail.com',
    created: new Date(),
    lastModifiedAt: new Date(),
    username: 'gemerson',
    password: 'thrackle912',
    emailVerified: true
},
{
    email: 'guest@guest.com',
    created: new Date(),
    lastModifiedAt: new Date(),
    username: 'guest',
    password: 'guest',
    emailVerified: true
}];
count = clients.length;
clients.forEach(function(value) {
    app.models.Client.create(value, function(err, user) {
        if (err) {
            throw err;
        }
        if (count == 1) {
            ds.disconnect();
        }
        count--;
    })
});
        */

[{username: 'gemerson', role: 'administrator'},{username: 'guest', role: 'guest'}].forEach(function(value) {
    app.models.Client.findOne({where: {username: value.username}}, function(err, user) {
        if (err) throw err;
        app.models.Role.create({
            name: value.role,
            created: new Date(),
            modified: new Date()
        }, function(err, role) {
            if (err) throw err;
            app.models.RoleMapping.create({
                roleId: role.id,
                principalType: app.models.RoleMapping.USER,
                principalId: user.id
        }, function(err, principal) {
            if (err) throw err;
        });
        });
    });
});


