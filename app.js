var express		= require('express'),			// Webserver
	twilio 		= require('twilio'),			// Texting
	bodyParser 	= require("body-parser"),		// Parsing
	Twitter 	= require('node-twitter-api'),	// Twitter
	restler 	= require('restler'),			// Watson REST API
	uuid 		= require('node-uuid');			// Random uids
	fs 			= require('fs');				// For loading api keys

// Instantiate webserver
var app = express();

// Info/Services if running on Bluemix server
var appInfo = JSON.parse(process.env.VCAP_APPLICATION || null);
var services = JSON.parse(process.env.VCAP_SERVICES || null);

// Loads twitter keys
var keys, twitter;
fs.readFile(__dirname + '/keys.json', function(err, data) {
	if(err) {
		throw err;
	}
	keys = JSON.parse(data);
	console.log("Keys loaded");

	twitter = new Twitter({
		consumerKey: keys['twitter']['consumerKey'],
	    consumerSecret: keys['twitter']['consumerSecret']
	});
});

// START: Watson user-modeling API info //
function getEnv(service, variable) {
    var VCAP_SERVICES = process.env["VCAP_SERVICES"],
        services = JSON.parse(VCAP_SERVICES);

    return services[service][0].credentials[variable];
}
function watsonUrl() {
    return getEnv("user_modeling", "url");
}

function watsonUsername() {
    return getEnv("user_modeling", "username");
}

function watsonPassword() {
    return getEnv("user_modeling", "password");
}
// END //

/*
// Gets user id from name
function getUser(name, callback) {
	twitter.users('search', {'q':'@' + name},"18165381-pkd41P25HXwPQRVdSLcVsYSZ1vGy0Wb22iTBCO5Ql", "Rquu5X4JO3xgkOUK0RBtbw6eBeYOkvMjvxuwPhuGdaUe0", function(err, data){ 
		var user = Array.prototype.slice.call(data, 0).filter(function(val) {
			return val['screen_name'] == name;
		})[0];
		if(user === undefined) {
			callback("User not found", null); 
			return;
		}
		callback(null, user.id_str);
		return;
	});
}*/

// Gets posts for given user
function getPosts(name, callback) {
	twitter.getTimeline("user", {'screen_name' : name, count: 200}, keys['twitter']['accessToken'], keys['twitter']['accessSecret'], function(err, data){
		var texts = undefined;
		if(data) {
			texts = Array.prototype.slice.call(data, 0).map(function(val) {
				return val['text'];
			});
		}
		if (texts === undefined || texts.length == 0){
			callback("No tweets", null);
			return;
		}
		callback(null, texts);
	});
}

// Formats tweets for Watson user-modeling API
function buildContent(tweets) {
    var content = {
        "contentItems": [
            {
                "userid": uuid.v1().toString(),
                "id": uuid.v1().toString(),
                "sourceid": "twitter",
                "contenttype": "application/json",
                "language": "en",
                "content": JSON.stringify(tweets)
            }
        ]
    };
    return content;
}

// Takes two dictionaries and combines them into one
// B overwrites A
function combineDicts(A, B) {
	var ret = {};
	for(var attr in A) {
		ret[attr] = A[attr];
	}
	for(var attr in B) {
		ret[attr] = B[attr];
	}
	return ret;
}

// Flattens personality data given by Watson into a single dictionary
function flattenTree(data) {
	ret = {}
	if(data['name'] && data['percentage']) {
		ret[data['name']] = data['percentage'];
	}
	if(data['children']) {
		for(var i in data['children']) {
			ret = combineDicts(ret, flattenTree(data['children'][i]));
		}
	}
	return ret;
}

// Takes dictionary, sorts by keys, and returns top values
function getTop(data, i) {
	var tuples = [];
	for(var attr in data) { tuples.push([attr, data[attr]]); }
	tuples.sort(function(a, b) {
		a = a[1];
		b = b[1];

		return a > b ? -1 : (a < b ? 1 : 0);
	});
	return tuples.slice(0,i);
}

// Returns personality data for a user's tweet data
function getPersonality(text, callback) {
	if (process.env["VCAP_SERVICES"] === undefined) {
		callback("NOT RUNNING ON BLUEMIX", null);
		return;
	}
	restler.post(watsonUrl() + "api/v2/profile", {
        headers: 	{ "Content-Type": "application/json" },
        data: 		JSON.stringify(buildContent(text)),
        username: 	watsonUsername(),
        password: 	watsonPassword()
    }).on("complete", function (data) {
    	raw = combineDicts({}, data);
    	try {
	    	data = data['tree']['children'];
	    	ret = {}
	    	for(var i = 0; i < data.length; i++) {
	    		ret = combineDicts(ret, flattenTree(data[i]))
	    	}
	        callback(null, [ret, raw]);
	    } catch(err) {
    		callback("ERROR: NO DATA", null);
    		return;	    	
	    }
    }).on("error", function (error) {
        console.log(error);
        callback(error, null);
    });
}

function getGraph(data, callback) {
	if (process.env["VCAP_SERVICES"] === undefined) {
		callback("NOT RUNNING ON BLUEMIX", null);
		return;
	}
	restler.post(watsonUrl() + "api/v2/visualize", {
		data 	: JSON.stringify(data),
		headers : { 'Content-Type'  :'application/json' },
        username: watsonUsername(),
        password: watsonPassword(),
        d3		: "false"
	}).on("complete", function(graph) {
		console.log("GRAPH: ", graph);
		callback(null, graph);
	}).on("error", function(error) {
		console.log(error);
		callback(error, null);
	});
}

// Webserver settings
app.configure(function() {
	app.use(express.bodyParser());
	app.use(app.router);
	app.use(express.errorHandler());
	app.use(express.json());
	app.use(express.static(__dirname + "/public"));
	app.use(bodyParser.urlencoded({extended: true}));
});


// Responds to texts
app.get("/sms", function(req, res) {
	res.set('Content-Type', 'text/plain');
	var user = req.param('Body');

	getPosts(user, function(err, textData) {
		if(err) {
			res.send("ERROR: COULD NOT GET POSTS");
			return;
		}
		getPersonality(textData, function(errTwo, perData) {
			if(errTwo) {
				res.send("ERROR: PERSONALITY");
				return;
			}
			var s = "Top five traits for " + user + ":\n";
			var traits = getTop(perData[0], 5);
			for(var i = 0; i < traits.length; i++) {
				s += traits[i][0] + ": " + traits[i][1] * 100 + "%\n";
			}
			res.send(s);
		});
	});
});

// Script for main form
app.post('/form', function (req, res) {
	var user = req.body.name.replace('@', '');

	// Async is a pain in the ass
	getPosts(user, function(errA, posts) {
		if(errA) {
			res.send("ERROR: COULD NOT GET POSTS");
			return;
		}
		getPersonality(posts, function(errB, personality) {
			if(errB) {
				res.send("ERROR: PERSONALITY");
				return;
			}
			getGraph(personality[1], function(errC, graph) {
				console.log(graph);
				if(errC) {
					res.send("ERROR: GRAPH");
					return;
				}
				// Send top 5 and graph
				res.send(JSON.stringify([getTop(personality[0], 5), graph]));
			});
		});
	});
});

// Defaults to localhost:3000 unless running on bluemix server
var port = (process.env.VCAP_APP_PORT || 3000);
var host = (process.env.VCAP_APP_HOST || 'localhost');
app.listen(port, host);
