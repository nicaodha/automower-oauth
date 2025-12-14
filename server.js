require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

// Environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// Basic Auth header for token exchange
const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "automower_secret",
    resave: false,
    saveUninitialized: true,
  })
);

// ========== ROUTES ==========

// Landing page
app.get("/", (req, res) => {
  res.send(`
    <h2>Automower Connect Dashboard</h2>
    <a href="/login">Login with Automower Connect</a>
  `);
});

// Redirect to Automower login
app.get("/login", (req, res) => {
  const authUrl =
    `https://api.authentication.husqvarnagroup.dev/v1/oauth2/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=AM.CLOUD`;

  res.redirect(authUrl);
});

// OAuth2 Callback
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
      `<h3>Token Exchange Error</h3><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

// Refresh token helper
async function refreshToken(req) {
  if (!req.session.refresh_token) return;

  try {
    const response = await axios.post(
      "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: req.session.refresh_token,
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
  } catch (error) {
    console.error("Failed to refresh token", error.response?.data || error.message);
  }
}

// Dashboard view
app.get("/dashboard", async (req, res) => {
  if (!req.session.access_token) {
    console.log("Missing access token in session.");
    return res.redirect("/");
  }

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
    if (!Array.isArray(mowers) || mowers.length === 0) {
      return res.send("<p>No mowers linked to your account.</p>");
    }

    const mower = mowers[0];
    req.session.mowerId = mower.id;

    const mowerName = mower.attributes?.system?.name || "Unknown";
    const mowerActivity = mower.attributes?.mower?.activity || "Unknown";
    const batteryLevel = mower.attributes?.battery?.batteryPercent ?? "Unknown";

    res.send(`
      <h2>Welcome to Automower Dashboard</h2>
      <p><strong>Name:</strong> ${mowerName}</p>
      <p><strong>Status:</strong> ${mowerActivity}</p>
      <p><strong>Battery:</strong> ${batteryLevel}%</p>
      <form method="POST" action="/start">
        <button type="submit">Start Mowing (30 min)</button>
      </form>
      <form method="POST" action="/park">
        <button type="submit">Park Mower</button>
      </form>
    `);
  } catch (err) {
    console.error("Dashboard error:", err.response?.data || err.message);
    res.send(`
      <h3>Dashboard Error</h3>
      <pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>
    `);
  }
});

// Start mowing
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
    res.send(`<p>Failed to start mower:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

// Park mower
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
    res.send(`<p>Failed to park mower:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
