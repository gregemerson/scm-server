module.exports = function enableAuthentication(server) {
  // enable authentication
  server.enableAuth();

 // set the view engine to ejs
 server.set('view engine', 'ejs');
};
