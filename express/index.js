const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const randtoken = require('rand-token');
const nodemailer = require('nodemailer');
const bcrypt = require("bcrypt");
const hosturl = process.env.hosturl || "http://localhost:3000";
const cors = require('cors');
const moment = require('moment');
const jwt = require('jsonwebtoken');

const connection = require ('./js/db');
const userRouter = require ('./routes/user');
const tempPageRouter = require ('./routes/tempPage');


//read global secret vars
const fs = require('fs');
let rawdata = fs.readFileSync('express/global.json');
let secretData = JSON.parse(rawdata);
//end of global secret vars

// ============================================================
// Express Server Set Up
// ============================================================

const app = express();

// Enable user routes in user.js
app.use('/',userRouter);
app.use('/',tempPageRouter);

//Enable temp pages in tempPage.js

// Middleware to connect Express and Angular
app.use(express.static(path.join(__dirname, '../build/')));
app.use(express.json());

// Listen for requests on defined port
const port = process.env.PORT || 3000;
var server = app.listen(port, 'localhost', function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('TigerTalks listening at http://%s:%s', host, port);
});


// Send email
function sendEmail(email, token) {
  let mail = nodemailer.createTransport({
    host: secretData.emailhost,
    port: '465',
    auth: {
      user: secretData.emailuser, // Your email id
      pass: secretData.emailpassword // Your password
    }
  });

  let mailOptions = {
    from: 'noreply@tigertalks.com',
    to: email,
    subject: 'Email verification - TigerTalks.com',
    html: `<p>You requested for email verification, kindly <a href="` + hosturl + `/api/verifytoken/${encodeURIComponent(token)}/email/${encodeURIComponent(email)}">click here to verify your email</a>.</p>`

  };

  mail.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error);
      return 1
    } else {
      console.log("Email Sent");
      return 0
    }
  });
}

function generateJWT(id) {
  let payload = { subject: id };
  let options = { expiresIn: secretData.jwtexpiration };
  return jwt.sign(payload, secretData.jwtkey, options);
}

//body parser
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());
app.use(session({
  secret: 'secret',
  resave: true,
  saveUninitialized: true
}));



// Use cors to bypass cross origin security error
app.use(cors());

// ============================================================
// Endpoints
// ============================================================
// '/' is an "endpoint", more can be made to make requests to backend (e.g. app.get('/getRecentPosts) etc)


//display the host URL which can be an environmetal variable
app.get('/api/hosturl', function (request, response) {
  response.send(hosturl);
  console.log(hosturl);
});

app.get('/api/verifytoken/:token/email/:email', (req, res) => {
  let email = decodeURIComponent(req.params.email);
  let token = decodeURIComponent(req.params.token);
  let isVerified = 0;
  console.log(req.params)
  connection.query('SELECT * FROM user WHERE Email = ?', [email], function (error, results, fields) {
    if (error) {
      throw error;
    }
    if (results.length > 0) {
      if (results[0].Token === token) {
        isVerified = 1;
        console.log("did update to 1!")
      } else {
        res.send("Wrong token/email!");
      }
    } else {
      console.log("error here");
    }

    if (isVerified == 1) {
      connection.query(`UPDATE user SET isVerified='1' WHERE Token =?`, [token], function (err, result) {
        if (err) throw err;
        console.log("Record updated");
        res.redirect('/#/signin');

      })
    }
  })
})

// Authorize login
app.post('/api/auth', function (req, res) {
  let netID = req.body.netID;
  let password = req.body.password;
  
  //ensure user entered login
  if (netID && password) {
    //query database for username
    connection.query(`SELECT * FROM user WHERE Id = ?`, [netID], function (error, results, fields) {
      if (error) {
        throw error;
      }
      if (results.length > 0) {
        if (results[0].IsVerified !== 1) {
          res.status(403).send("Please Verify Email!")
        } else {
          //check password hash validity
          let hash = results[0].Password;
          if (bcrypt.compareSync(password, hash)) {
            req.session.loggedin = true;
            req.session.netID = netID;
            req.session.name = results[0].FirstName;

            // generate jwt token
            let token = generateJWT(netID);
            res.cookie('netId',netID);
            res.status(200).cookie('token', token).send({message: 'Login successful!'});
          } else {
            res.status(401).send('Incorrect Username and/or Password!'); //wrong password but don't tell user
          }
        }
      } else {
        res.status(401).send('Incorrect Username and/or Password!'); //wrong username but don't tell user
      }
      res.end();
    });
  } else {
    res.status(401).send('Please enter Username and Password!');
    res.end();
  }
});

// logout user; delete server-session and local cookie
app.get('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log(err);
    }
    res.redirect('/#/home');
  });
  res.clearCookie('token');
  res.clearCookie('netId');
});

//Verify if user is logged in
app.get('/api/loggedin', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('Welcome back, ' + request.session.name + '!');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});

//reads req and verifies user doesnt exist already
app.post('/api/registerUser', (req, res) => {
  let user = {
    id: req.body.Id,
    fName: req.body.FirstName,
    lName: req.body.LastName,
    email: req.body.Email,
    userType: req.body.UserType,
    permission: req.body.Permission,
    bio: req.body.Bio || '',
    pName: req.body.PreferredName || '',
    pronouns: req.body.Pronouns || '',
    password: bcrypt.hashSync(req.body.Password, 10), //hash/salting function
    isVerified: 0,
    token: randtoken.generate(10)
  }
  
  //check if user exists
  connection.query(`SELECT * FROM user WHERE Id=\'${user.id}\' OR Email=\'${user.email}\';`, function (err, result) {
    if (err) {
      console.log(err);
      throw err;
    }
    if (result[0] !== undefined) {
      console.log('User exists');
      res.status(403).send("User already exists");
    } else {
      console.log("New user, proceeding to insert");
      
      //insert into database. Report error if fail, otherwise redirect user to login page
      connection.query(`INSERT INTO user (Id,FirstName,LastName,Email,UserType,Permission,Bio,PName,Pronouns,isVerified,Password,Token) 
                        VALUES ('${user.id}','${user.fName}','${user.lName}','${user.email}','${user.userType}','${user.permission}','
                                ${user.bio}','${user.pName}','${user.pronouns}','${user.isVerified}','${user.password}','${user.token}') `,
        function (err, result) {
          if (err) {
            console.log("Error: ", err);
          } else {
            // send verification email
            sendEmail(user.email, user.token);
            res.status(200).send({message: 'Account created.'});
          }
        }
      );
    }
  })
  
});

//create post demo form
app.get('/api/createPostDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="createPost" name="createpost" id="createpost">Title:<input type="text" name="Title" id="Title"><br>postbody:<input type="text" name="Body" id="Body"><br>category:<input type="text" name="Category" id="Category"><br>tigerspaceid:<input type="text" name="TigerSpaceId" id="TigerSpaceId"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});

//create new post as most recent of previous posts
app.post('/api/createPost', (req, res) => {

  let title = req.body.Title;
  let postbody = req.body.Body;
  let category = req.body.Category;
  let tigerspaceid = req.body.TigerSpaceId;

  //ensure the user is logged in before anything
  if (req.session.loggedin) {
    //first query the db to get the latest post ID
    connection.query(`SELECT id FROM post ORDER BY id DESC LIMIT 1;`, function (err, result) {
      if (err) {
        throw err;
      }
      let highestPost = 0;
      if (result.length > 0) {
        highestPost = result[0].id;
      }
      highestPost++;
      console.log(highestPost);

      connection.query(`SELECT id FROM post WHERE id ='${highestPost}\';`, function (err, result) {
        //sanity check that if it ever fails, we need to restructure
        if (!(typeof result[0] === "undefined")) {
          console.log('crucial sanity check failed, restructure post ID incrementation');
        } else {
          console.log("New post, proceeding to insert");
          //insert into database. Report error if fail, otherwise redirect user to login page
          connection.query(`INSERT INTO post (Id,Title,Body,Category,Upvotes,TigerSpaceId,Timestamp,Bump,UserID) VALUES ('${highestPost}','${title}','${postbody}','${category}','1','${tigerspaceid}','${moment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}','${moment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}','${req.session.netID}') `, function (err, result) {
            if (err) {
              console.log("Error: ", err);
            } else {
              //optimally redirect user to their newly created post
              res.redirect('/#/');
            }
          })
        }
      })
    })
  } else {
    console.log("User isn't logged in, therefore can't submit a post.");
    res.redirect('/#/signin');
  }
});

//create comment demo form
app.get('/api/createCommentDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="createComment" name="createComment" id="createComment">PostId:<input type="text" name="postid" id="postid"><br>comment body:<input type="text" name="commentbody" id="commentbody"><br>userid: ' + request.session.netID + '<input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});

//create new comment as most recent of previous posts
app.post('/api/createComment', (req, res) => {

  console.log("HIT");
  let unfilteredNetId=(req.headers.cookie).split(';');
  let filteredNetId=unfilteredNetId[0].replace('netId=','');
  let postid = req.body.postId;
  let commentbody = req.body.body;

  //ensure the user is logged in before anything
  if (filteredNetId.length<30) {
    //first query the db to get the latest comment ID
    connection.query(`SELECT id FROM comment ORDER BY id DESC LIMIT 1;`, function (err, result) {
      if (err) {
        throw err;
      }
      let highestComment = 0;
      if (result.length > 0) {
        highestComment = result[0].id;
      }

      highestComment++;
      console.log(highestComment);

      connection.query(`SELECT id FROM comment WHERE id ='${highestComment}\';`, function (err, result) {
        //sanity check that if it ever fails, we need to restructure
        if (!(typeof result[0] === "undefined")) {
          console.log('crucial sanity check failed, restructure comment ID incrementation');
        } else {
          console.log("New comment, proceeding to insert");
          //insert into database. Report error if fail, otherwise redirect user to login page
          connection.query(`INSERT INTO comment (Id,PostId,Body,Upvotes,UserID,Timestamp) VALUES ('${highestComment}','${postid}','${commentbody}','1','${filteredNetId}','${moment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}') `, function (err, result) {
            if (err) {
              console.log("Error: ", err);
            } 
            else {
              connection.query(`UPDATE post SET Bump = '${moment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}' WHERE Id = '${postid}'`, function (err, result) {
                if (err) {
                  console.log("Error: ", err);
                } else {
                  //optimally refresh the post page with the new comment now posted
                  res.redirect('/#/');
                }
              })
            }
          })
        }
      })
    })
  } else {
    console.log("User isn't logged in, therefore can't submit a comment.");
    res.redirect('/#/signin');
  }
});


//view post
app.get('/api/getPost/:postid/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
  if (req.session.loggedin) {
    connection.query(`SELECT * FROM post WHERE id ='${postid}\';`, function (err, result) {
      //sanity check that if it ever fails, we need to restructure
      if (result.length > 0) {
        res.send(result[0]);
      } else {
        res.send("Post not found.");
      }
    })

  } else {
    console.log("User isn't logged in, therefore can't view posts.");
    res.redirect('/#/signin');
  }
});

app.get('/api/getPostData/:postid/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
 
    connection.query(`SELECT s.UserId,u.Id, s.Major,u.Pronouns, p.Timestamp,p.Body,p.Upvotes, p.Id,p.Title
    FROM user AS u INNER JOIN student AS s ON s.UserId= u.Id
    INNER JOIN post AS p ON p.UserId=s.UserId
    WHERE p.Id='${postid}\';`, function (err, result) {
      //sanity check that if it ever fails, we need to restructure
      console.log(result);
      if (result.length > 0) {
        res.send(result);
      } else {
        res.send("Post not found.");
      }
    })

});

app.get('/api/getCommentData/:postid/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
 
    connection.query(`SELECT u.Id, s.Major,u.Pronouns, c.Timestamp,c.Body,c.Upvotes, c.PostId 
    FROM user AS u INNER JOIN student AS s ON s.UserId= u.Id
    INNER JOIN comment AS c ON c.UserId=s.UserId
    WHERE c.PostId='${postid}\';`, function (err, result) {
      //sanity check that if it ever fails, we need to restructure
      console.log(result);
      if (result.length > 0) {
        res.send(result);
      } else {
        res.send("Post not found.");
      }
    })

 
});

//view post comments
app.get('/api/getPostComments/:postid/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
  if (req.session.loggedin) {
    connection.query(`SELECT * FROM comment WHERE PostId ='${postid}';`, function (err, result) {
      //sanity check that if it ever fails, we need to restructure
      if (result.length > 0) {
        res.send(result);
      } else {
        res.send("Post not found.");
      }
    })

  } else {
    console.log("User isn't logged in, therefore can't view posts.");
    res.redirect('/#/signin');
  }
});


//delete post/comments demo
app.get('/api/adminDeletePost', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="deletePost" name="deletePost" id="deletePost">POST ID TO BE PURGED:<input type="text" name="postid" id="postid"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});



//imagine the following people can delete posts/comments
//any administrators can delete all posts/comments
//a tigerspace moderator can delete posts/comments on their space
//any post creator can wipe their individual post body, but not the comments 
//any commenter can delete their individual comments

app.post('/api/deletePost', (req, res) => {

  let postid = req.body.postid;

  //ensure the user is logged in before anything
  //this is where we would check if admin or mod of tigerspace 
  if (req.session.loggedin) {
    //purge comments before purging the post
    connection.query(`DELETE FROM comment WHERE PostId = ${postid}\;`, function (err, result) {
      if (err) {
        throw err;
      }
      connection.query(`DELETE FROM post WHERE Id = ${postid}\;`, function (err, result) {
        if (err) {
          throw err;
        }
        console.log("Post deleted.");
        res.redirect('/#/');
      })
    })
  } else {
    console.log("User isn't logged in, therefore can't submit a post.");
    res.redirect('/#/signin');
  }
});


//delete comments as a user demo
app.get('/api/userDeleteOwnCommentDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="userDeleteOwnComment" name="deleteComment" id="deleteComment">COMMENT ID TO BE PURGED:<input type="text" name="commentid" id="commentid"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});


app.post('/api/userDeleteOwnComment', (req, res) => {

  let commentid = req.body.commentid;

  //ensure the user is logged in before anything
  //this is where we would check if admin or mod of tigerspace 
  if (req.session.loggedin) {
    //first query the db to verify user is author of the comment
    connection.query(`SELECT UserID FROM comment WHERE Id = ${commentid}\;`, function (err, result) {
      if (err) {
        throw err;
      }
      if (result.length > 0) {
        //if signed in user is comment author
        if (result[0].UserID == req.session.netID) {
          //purge it 
          connection.query(`DELETE FROM comment WHERE Id = ${commentid}\;`, function (err, result) {
            if (err) {
              throw err;
            }
            console.log("Comment deleted.");
          })
        } else {
          res.send("Permission not granted!");
        }
      } else {
        res.send("Comment not found.");
      }

    })
  } else {
    console.log("User isn't logged in, therefore can't submit a post.");
    res.redirect('/#/signin');
  }
});


//retrieves 10 most recent posts
app.get('/api/getRecentPosts/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
  if (req.session.loggedin) {
    connection.query(`SELECT * FROM post ORDER BY Bump DESC LIMIT 10;`, function (err, result) {
      //sanity check that if it ever fails, we need to restructure
      if (result.length > 0) {
        res.send(result);
      } else {
        res.send("Post not found.");
      }
    })

  } else {
    console.log("User isn't logged in, therefore can't view posts.");
    res.redirect('/#/signin');
  }
});

app.get('/api/sendEmail/verify/:id', (req, res) => {
  let userID = decodeURIComponent(req.params.id);
  
  connection.query(`SELECT Email, Token FROM user WHERE Id=\'${userID}\';`, function (err, result) {
    if (err) {
        throw err;
    }
    if (result.length > 0) {
      let email = result[0].Email;
      let token = result[0].Token;
      sendEmail(email, token);
      res.status(200).send({ message: 'Verification email sent!'});
    } else {
      console.log('User does not exist');
      res.status(401).send({ message: 'User does not exist.'});
    }

  })
});



//flag comment demo
app.get('/api/flagCommentDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="flagComment" name="flagComment" id="flagComment">COMMENT ID TO BE FLAGGED:<input type="text" name="commentid" id="commentid"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});

//flag comment
app.post('/api/flagComment', (req, res) => {

  let commentid = req.body.commentid;

  //ensure the user is logged in before anything
  //this is where we would check if admin or mod of tigerspace 
  if (req.session.loggedin) {
    //first query the db to verify comment exists
    connection.query(`SELECT Id FROM comment WHERE Id = '${commentid}'\;`, function (err, result) {
      if (err) {
        throw err;
      }
      if (result.length > 0) {
          //flag it
          connection.query(`INSERT INTO flaggedcomment (CommentId,UserId) VALUES ('${commentid}','${req.session.netID}') `), function (err, result) {
            if (err) {
              console.log("Error: ", err);
            } 
          }
          res.send(200, '{"message":"ok"}');        
      } else {
        res.send("Comment not found.");
      }
    })
    
  } else {
    console.log("User isn't logged in, therefore can't flag a comment.");
    res.redirect('/#/signin');
  }
});



//flag post demo
app.get('/api/flagPostDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="flagPost" name="flagPost" id="flagPost">POST ID TO BE FLAGGED:<input type="text" name="postid" id="postid"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});

//flag post
app.post('/api/flagPost', (req, res) => {

  let postid = req.body.postid;

  //ensure the user is logged in before anything
  //this is where we would check if admin or mod of tigerspace 
  if (req.session.loggedin) {
    //first query the db to verify post exists
    connection.query(`SELECT Id FROM post WHERE Id = '${postid}'\;`, function (err, result) {
      if (err) {
        throw err;
      }
      if (result.length > 0) {
          //flag it
          connection.query(`INSERT INTO flaggedpost (Postid,UserId) VALUES ('${postid}','${req.session.netID}') `), function (err, result) {
            if (err) {
              console.log("Error: ", err);
            } 
          }
          res.send(200, '{"message":"ok"}');
      } else {
        res.send("Post not found.");
      }
    })
    
  } else {
    console.log("User isn't logged in, therefore can't flag a post.");
    res.redirect('/#/signin');
  }
});

//get flagged posts
app.get('/api/getFlaggedPosts/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
  if (req.session.loggedin) {
    connection.query(`SELECT * FROM flaggedpost;`, function (err, result) {
      if (result.length > 0) {
        res.send(result);
      } else {
        res.send("No flagged posts found.");
      }
    })

  } else {
    console.log("User isn't logged in, therefore can't view flagged posts.");
    res.redirect('/#/signin');
  }
});

//get flagged posts
app.get('/api/getFlaggedComments/', (req, res) => {
  let postid = decodeURIComponent(req.params.postid);

  //ensure the user is logged in before anything
  if (req.session.loggedin) {
    connection.query(`SELECT * FROM flaggedcomment;`, function (err, result) {
      if (result.length > 0) {
        res.send(result);
      } else {
        res.send("No flagged comments found.");
      }
    })

  } else {
    console.log("User isn't logged in, therefore can't view flagged comments.");
    res.redirect('/#/signin');
  }
});

//unflag post demo
app.get('/api/unflagPostDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="unflagPost" name="unflagPost" id="unflagPost">POST ID TO BE UNFLAGGED:<input type="text" name="postid" id="postid"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});


//unflag comment demo
app.get('/api/unflagCommentDemo', function (request, response) {
  if (request.session.loggedin) {
    console.log(request.session);
    response.send('<form method="post" action="unflagComment" name="unflagComment" id="unflagComment">COMMENT ID TO BE UNFLAGGED:<input type="text" name="commentid" id="commentid"><br>userid: ' + request.session.netID + ' <input type="submit"></form>');
  } else {
    response.send('Please login to view this page!');
  }
  response.end();
});


//unflag post
app.post('/api/unflagPost', (req, res) => {

  let postid = req.body.postid;

  //ensure the user is logged in before anything
  //this is where we would check if admin or mod of tigerspace 
  if (req.session.loggedin) {
    //first query the db to verify post exists
    connection.query(`SELECT Id FROM post WHERE Id = '${postid}'\;`, function (err, result) {
      if (err) {
        throw err;
      }
      if (result.length > 0) {
          //flag it
          connection.query(`DELETE FROM flaggedpost WHERE PostId = '${postid}'\;`), function (err, result) {
            if (err) {
              console.log("Error: ", err);
            } 
          }
          res.send(200, '{"message":"ok"}');
      } else {
        res.send("Post not found.");
      }
    }) 
  } else {
    console.log("User isn't logged in, therefore can't flag a post.");
    res.redirect('/#/signin');
  }
});