// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");
const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: "automower_secret", resave: false, saveUninitialized: true }));

app.get("/", (req, res) => {
  res.send(`
    <h2>Automower Connect Dashboard</h2>
    <a href="/login">Login with Automower Connect</a>
  `);
});

app.get("/login", (req, res) => {
  const authUrl = `https://api.authentication.husqvarnagroup.dev/v1/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=AM.CLOUD`;
  res.redirect(authUrl);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No code received");

  try {
    const response = await axios.post(
      "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token",
      null,
      {
        params: {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    req.session.access_token = response.data.access_token;
    req.session.refresh_token = response.data.refresh_token;
    res.redirect("/dashboard");
  } catch (err) {
  const husqvarnaError = err.response?.data || err.message;
  console.error("Token exchange error:", husqvarnaError);
  res.send(`
    <h3>Error fetching token</h3>
    <pre>${JSON.stringify(husqvarnaError, null, 2)}</pre>
  `);
}
});

async function refreshToken(req) {
  if (!req.session.refresh_token) return;
  try {
    const response = await axios.post(
      "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token",
      null,
      {
        params: {
          grant_type: "refresh_token",
          refresh_token: req.session.refresh_token,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    req.session.access_token = response.data.access_token;
    req.session.refresh_token = response.data.refresh_token;
  } catch (error) {
    console.error("Failed to refresh token", error.response?.data || error.message);
  }
}

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

    const mower = mowerResponse.data[0];
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
    res.send(`<p>Error fetching mower data: ${err.message}</p>`);
  }
});

app.post("/start", async (req, res) => {
  if (!req.session.access_token || !req.session.mowerId) return res.redirect("/");
  await refreshToken(req);
  try {
    await axios.post(
      `https://api.amc.husqvarnagroup.dev/v1/mowers/${req.session.mowerId}/actions`,
      { action: "START", duration: 30 },
      {
        headers: {
          Authorization: `Bearer ${req.session.access_token}`,
          "Authorization-Provider": "husqvarna",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    res.send(`<p>Failed to start mower: ${err.message}</p>`);
  }
});

app.post("/park", async (req, res) => {
  if (!req.session.access_token || !req.session.mowerId) return res.redirect("/");
  await refreshToken(req);
  try {
    await axios.post(
      `https://api.amc.husqvarnagroup.dev/v1/mowers/${req.session.mowerId}/actions`,
      { action: "PARK" },
      {
        headers: {
          Authorization: `Bearer ${req.session.access_token}`,
          "Authorization-Provider": "husqvarna",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    res.send(`<p>Failed to park mower: ${err.message}</p>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
