const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//api-1
app.post("/register/", async (request, response) => {
  try {
    const { username, password, name, gender } = request.body;
    const getUserQuery = `
    SELECT *
    FROM user
    WHERE username = '${username}';`;
    const userDb = await db.get(getUserQuery);
    if (userDb === undefined) {
      if (password.length >= 6) {
        const hashedPw = await bcrypt.hash(password, 10);
        const createQuery = `
          INSERT INTO user
            ( username, password, name, gender)
            VALUES ('${username}','${hashedPw}','${name}','${gender}');`;
        await db.run(createQuery);
        response.send("User created successfully");
      } else {
        response.status(400);
        response.send("Password is too short");
      }
    } else {
      response.status(400);
      response.send("User already exists");
    }
  } catch (e) {
    console.log(`DB Error:${e.message}`);
  }
});

//api -2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserFromDb = `
    SELECT * 
    FROM
         user
    WHERE  username = '${username}';`;
  const dbUser = await db.get(getUserFromDb);
  if (dbUser !== undefined) {
    const isMatchesPws = await bcrypt.compare(password, dbUser.password);
    if (isMatchesPws === true) {
      let jwtToken = jwt.sign(username, "my_secret_key");
      response.send({ jwtToken });
      console.log(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (jwtToken !== undefined) {
    const jwtToken = authHeader.split(" ")[1];
    jwt.verify(jwtToken, "my_secret_key", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

const tweetResponse = (tweets) => {
  return {
    username: tweets.username,
    tweet: tweets.tweet,
    dateTime: tweets.date_time,
  };
};

//api-3 :return 4 tweets

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweetQuery = `
    SELECT 
        tweet.tweet_id,
        tweet.user_id,
        user.username,
        tweet.tweet,
        tweet.date_time
    FROM follower 
    LEFT JOIN tweet ON tweet.user_id = follower.following_user_id
    LEFT JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username='${request.username}')
    ORDER BY tweet.date_time DESC
    LIMIT 4;`;
  const latestTweet = await db.all(latestTweetQuery);
  response.send(latestTweet.map((eachTweet) => tweetResponse(eachTweet)));
});

//api-4  list of all names of people
app.get("/user/following/", authenticateToken, async (request, response) => {
  const userFollowQuery = `
    SELECT user.name
    FROM follower LEFT JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id= (SELECT user_id FROM user WHERE username = '${request.username}')
    ;`;
  const following = await db.all(userFollowQuery);
  response.send(following);
});

//api-5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const FollowerQuery = `
    SELECT user.name
    FROM follower LEFT JOIN user ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id= (SELECT user_id FROM user WHERE username = '${request.username}')
    ;`;
  const followers = await db.all(FollowerQuery);
  response.send(followers);
});
const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`
    SELECT *
    FROM follower
    WHERE follower_user_id = (SELECT user_id FROM user WHERE username='${request.username}')
    AND following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user 
        WHERE tweet_id = ${tweetId} )`);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//api-6
app.get(
  "tweets/:tweetId/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(`
    SELECT 
    tweet.date_time FROM tweet WHERE tweet_id = ${tweetId}`);
    const { likes } = await db.get(`
    SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = ${tweetId}`);
    const { replies } = await db.get(`
    SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId}`);
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

//api-7
app.get(
  "tweets/:tweetId/likes/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedBy = await db.all(`
    SELECT user.username FROM like NATURAL JOIN user
    WHERE tweet_id = ${tweetId}; `);
    response.send({ likes: likedBy.map((eachItem) => eachItem.username) });
  }
);

//api-8
app.get(
  "tweets/:tweetId/replies/",
  authenticateToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await db.all(`
    SELECT user.name, reply.reply FROM reply NATURAL JOIN user WHERE tweet_id = ${tweetId}; `);
    response.send({ replies });
  }
);
//api-9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const myTweets = await db.all(`
    SELECT tweet.tweet 
    COUNT (DISTINCT like.like_id) AS likes,
    COUNT (DISTINCT reply.reply_id) AS replies,
    tweet.date_time,
    FROM tweet
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON  tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
    GROUP_BY tweet.tweet_id;`);
  response.send(
    myTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});
//api-10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.params;
  const { user_id } = await db.get(`SELECT user_id 
    FROM user WHERE username = '${request.username}';`);
  await db.run(`INSERT INTO tweet (tweet, user_id)
    VALUES ('${tweet}',${user_id})`);
  response.send("Created a Tweet");
});

//api -11 delete

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await db.get(`
    SELECT tweet_id, user_id FROM tweet WHERE tweet_id = ${tweetId}
    AND user_id = (SELECT user_id 
    FROM user WHERE username = '${request.username}');`);
    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
        DELETE FROM tweet
       WHERE tweet_id = ${tweetId}; `);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
