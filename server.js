require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: "automower_secret",
  resave: false,
  saveUninitialized: true,
}));

// ========== ROUTES ==========

app.get("/", (req, res) => {
  res.send(`
    <h2>Automower Connect Dashboard</h2>
    <a href="/login">Login with Automower Connect</a>
  `);
});

app.get("/login", (req, res) => {
  const authUrl = `https://api.authentication.husqvarnagroup.dev/v1/oauth2/authorize` +
    `?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=AM.CLOUD`;
  res.redirect(authUrl);
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
    res.send(`<h3>Token Error</h3><pre>${JSON.stringify(err.response?.data, null, 2)}</pre>`);
  }
});

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
    console.error("Failed to refresh token", error.message);
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

    // FIX 1: Access .data.data
    const mowers = mowerResponse.data.data;
    
    if (!Array.isArray(mowers) || mowers.length === 0) {
      return res.send("<p>No mowers found on this account.</p>");
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
      <form method="POST" action="/start"><button type="submit">Start (30m)</button></form>
      <form method="POST" action="/park"><button type="submit">Park</button></form>
    `);
  } catch (err) {
    console.error("Dashboard error:", err.response?.data || err.message);
    res.send(`<h3>Dashboard Error</h3><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
}); // FIX 2: Added closing brace for dashboard route

app.post("/start", async (req, res) => {
  if (!req.session.access_token || !req.session.mowerId) return res.redirect("/");
  await refreshToken(req);

  try {
    // FIX 3: Correct JSON:API Payload and Content-Type
    await axios.post(
      `https://api.amc.husqvarnagroup.dev/v1/mowers/${req.session.mowerId}/actions`,
      {
        data: {
          type: "Start",
          attributes: { duration: 30 }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${req.session.access_token}`,
          "Authorization-Provider": "husqvarna",
          "Content-Type": "application/vnd.api+json",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    res.send(`<p>Failed to start:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

app.post("/park", async (req, res) => {
  if (!req.session.access_token || !req.session.mowerId) return res.redirect("/");
  await refreshToken(req);

  try {
    // FIX 3: Correct JSON:API Payload and Content-Type
    await axios.post(
      `https://api.amc.husqvarnagroup.dev/v1/mowers/${req.session.mowerId}/actions`,
      {
        data: {
          type: "Park",
          attributes: {}
        }
      },
      {
        headers: {
          Authorization: `Bearer ${req.session.access_token}`,
          "Authorization-Provider": "husqvarna",
          "Content-Type": "application/vnd.api+json",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    res.send(`<p>Failed to park:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
