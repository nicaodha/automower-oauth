require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

// Environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const PORT = process.env.PORT || 3000;

// Basic Auth header for token exchange
const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

// Middleware
app.set("trust proxy", 1); // Trust first proxy (Required for Render/Heroku https)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "automower_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { 
      secure: process.env.NODE_ENV === "production", // Secure cookies in production
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }, 
  })
);

// ========== HELPER FUNCTIONS ==========

/**
 * Attempts to refresh the access token using the refresh token in the session.
 * Returns true if successful, false otherwise.
 */
async function refreshAccessToken(req) {
  if (!req.session.refresh_token) return false;

  console.log("🔄 Attempting to refresh token...");
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
    req.session.refresh_token = response.data.refresh_token; // Rotate refresh token
    
    // Explicitly save session to ensure race conditions don't lose the token
    return new Promise((resolve) => {
      req.session.save((err) => {
        if (err) console.error("Session save error:", err);
        resolve(true);
      });
    });

  } catch (error) {
    console.error("❌ Refresh Failed:", error.response?.data || error.message);
    return false;
  }
}

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

// Dashboard view
app.get("/dashboard", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/");

  try {
    // 1. Attempt to fetch mowers directly
    const mowerResponse = await axios.get("https://api.amc.husqvarnagroup.dev/v1/mowers", {
      headers: {
        Authorization: `Bearer ${req.session.access_token}`,
        "Authorization-Provider": "husqvarna",
        "X-Api-Key": CLIENT_ID,
      },
    });

    // 2. Parse JSON:API response (.data.data)
    const mowers = mowerResponse.data.data;
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
      <br/>
      <form method="POST" action="/start">
        <button type="submit">Start Mowing (30 min)</button>
      </form>
      <br/>
      <form method="POST" action="/park">
        <button type="submit">Park Mower</button>
      </form>
    `);

  } catch (err) {
    // 3. Handle 401 Unauthorized (Token Expired)
    if (err.response && err.response.status === 401) {
      console.log("⚠️ Token expired or invalid. Attempting refresh...");
      const refreshed = await refreshAccessToken(req);
      
      if (refreshed) {
        return res.redirect("/dashboard"); // Retry the page load
      } else {
        return res.redirect("/"); // Refresh failed, login again
      }
    }

    console.error("Dashboard error:", err.response?.data || err.message);
    res.send(`
      <h2>Dashboard Error</h2>
      <pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>
    `);
  }
});

// Start mowing
app.post("/start", async (req, res) => {
  if (!req.session.access_token || !req.session.mowerId) return res.redirect("/");

  try {
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
          "Content-Type": "application/vnd.api+json", // Required by Husqvarna
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    // If 401, we could try refresh here, but for simplicity just log it.
    // The user will likely hit /dashboard next and get refreshed there.
    console.error("Start Action Failed:", err.response?.data || err.message);
    res.send(`<p>Failed to start mower:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

// Park mower
app.post("/park", async (req, res) => {
  if (!req.session.access_token || !req.session.mowerId) return res.redirect("/");

  try {
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
          "Content-Type": "application/vnd.api+json", // Required by Husqvarna
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Park Action Failed:", err.response?.data || err.message);
    res.send(`<p>Failed to park mower:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
