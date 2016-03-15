#!/usr/bin/env node

var async = require('async');
var GitHubApi = require("github");
var RegistryClient = require('bower-registry-client');
var Config = require('bower-config');
var config = Config.read(process.cwd(), {});
var registry = new RegistryClient(config);
var organization = process.argv.slice(-1)[0];

if (!organization) {
	console.error('Please supply organization as an argument');
	process.exit(1);
}

console.log('Looking for repositories under', organization);

var github = new GitHubApi({
	version: "3.0.0",
	protocol: "https",
	host: "api.github.com",
	timeout: 5000,
	headers: {
		"user-agent": 'Bower repo registrar'
	}
});

async.waterfall([
	// Lists the organization's info
	function(cb) {
		github.orgs.get({
			org: organization
		}, cb);
	},
	// Loops over each paged result of repositories and combine them into a single array
	function(data, cb) {
		var i = 0;
		var pageCount = Math.ceil(data.public_repos / 100);
		var repos = [];

		async.doWhilst(
			function (cb) {
				github.repos.getFromOrg({
					org: organization,
					page: ++i,
					per_page: 100
				}, function(err, res) {
					repos = repos.concat(
						res.map(function(item) {
							return {
								name: item.name,
								endpoint: item.git_url
							};
						})
					);

					cb(err);
				});
			},
			function () { return i < pageCount; },
			function (err) {
				cb(err, repos);
			}
		);
	},
	// Looks up each repository to see if it's name is registered in the bower registry
	function(repos, cb) {
		console.log('Found', repos.length, 'repositories');

		async.eachSeries(repos, function(repo, cb) {
			async.waterfall([
				// Checks if the package exists within the bower registry
				function(cb) {
					registry.lookup(repo.name, cb);
				},
				function(data, cb) {
					// If the package exists
					if (data) {
						console.log(repo.name, 'is already registered at', data.url);
						return cb();
					}

					// Checks if repository has a bower.json file
					github.repos.getContent({
						user: organization,
						repo: repo.name,
						path: 'bower.json'
					}, function(err, data) {
						if (err)
							return cb(err);

						// If there is no bower.json file
						if (!data) {
							console.log(repo.name, 'does not have a bower.json file');
							return cb();
						}

						// Register the package
						console.log('Registering', repo.name, 'at', repo.endpoint);
						registry.register(repo.name, repo.endpoint, cb);
					});
				}
			], cb);
		}, cb);
	}
], function(err, results) {
	if (err)
		console.error(err, results);
});