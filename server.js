// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const basicAuth = Buffer.from(
  `${CLIENT_ID}:${CLIENT_SECRET}`
).toString("base64");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "automower_secret",
    resave: false,
    saveUninitialized: true,
  })
);

app.get("/", (req, res) => {
  res.send(`
    <h2>Automower Connect Dashboard</h2>
    <a href="/login">Login with Automower Connect</a>
  `);
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/");

  await refreshToken(req);

  try {
    const mowerResponse = await axios.get("https://api.amc.husqvarnagroup.dev/v1/mowers", {
      headers: {
        Authorization: `Bearer ${req.session.access_token}`,
        "Authorization-Provider": "husqvarna",
        "X-Api-Key": CLIENT_ID,
      },
    });

    const mowers = mowerResponse.data;
    if (!mowers.length) {
      return res.send("<p>No mowers linked to your account.</p>");
    }

    const mower = mowers[0];
    req.session.mowerId = mower.id;

    res.send(`
      <h2>Welcome to Automower Dashboard</h2>
      <p><strong>Name:</strong> ${mower.attributes.system.name}</p>
      <p><strong>Status:</strong> ${mower.attributes.mower.activity}</p>
      <p><strong>Battery:</strong> ${mower.attributes.battery.batteryPercent}%</p>
      <form method="POST" action="/start">
        <button type="submit">Start Mowing (30 min)</button>
      </form>
      <form method="POST" action="/park">
        <button type="submit">Park Mower</button>
      </form>
    `);
  } catch (err) {
    console.error("Dashboard error:", err.response?.data || err.message);
    res.send(`<p>Error fetching mower data:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});


app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No code received");

  try {
    const response = await axios.post(
      "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
      }
    );

    req.session.access_token = response.data.access_token;
    req.session.refresh_token = response.data.refresh_token;

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Token exchange error:", err.response?.data || err.message);
    res.send(
      `<pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/");

  try {
    const mowerResponse = await axios.get(
      "https://api.amc.husqvarnagroup.dev/v1/mowers",
      {
        headers: {
          Authorization: `Bearer ${req.session.access_token}`,
          "Authorization-Provider": "husqvarna",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );

    const mower = mowerResponse.data[0];

    res.send(`
      <h2>Automower Dashboard</h2>
      <p>Name: ${mower.attributes.system.name}</p>
      <p>Status: ${mower.attributes.mower.activity}</p>
      <p>Battery: ${mower.attributes.battery.batteryPercent}%</p>
    `);
  } catch (err) {
    res.send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
