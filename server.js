require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const PORT = process.env.PORT || 3000;

const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

// Middleware
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "automower_secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    },
  })
);

// Helper function to log detailed Axios errors (for console)
function logAxiosError(context, err) {
    const status = err.response?.status;
    const data = err.response?.data;
    const headers = err.response?.headers;
    const config = err.config;

    console.error(`\n--- ❌ ERROR: ${context} ---`);
    console.error(`Request URL: ${config?.url}`);
    console.error(`HTTP Status: ${status || 'N/A'}`);
    console.error(`Message: ${err.message}`);
    console.error(`Response Data: ${JSON.stringify(data, null, 2)}`);
    console.error(`Response Headers: ${JSON.stringify(headers, null, 2)}`);
    console.error('---------------------------\n');
}

// ========== HELPER FUNCTIONS ==========

/**
 * Attempts to refresh the access token only when needed. 
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
    req.session.refresh_token = response.data.refresh_token; 
    
    // Explicitly save session to avoid race conditions
    return new Promise((resolve) => {
      req.session.save((err) => {
        if (err) console.error("Session save error:", err);
        resolve(true);
      });
    });

  } catch (error) {
    // Log the details of the refresh error (usually 400 Bad Request)
    logAxiosError("TOKEN REFRESH FAILURE", error);
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
    // Log detailed error for callback
    logAxiosError("CALLBACK TOKEN EXCHANGE FAILURE", err);
    res.send(
      `<h3>Callback Error</h3><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`
    );
  }
});

// Dashboard view
app.get("/dashboard", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/");

  try {
    // 1. Attempt to fetch mowers using the current token
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
      <form method="POST" action="/start"><button type="submit">Start Mowing (30 min)</button></form>
      <form method="POST" action="/park"><button type="submit">Park Mower</button></form>
    `);

  } catch (err) {
    // 3. Handle 401 Unauthorized (Token Expired)
    if (err.response && err.response.status === 401) {
      console.log("⚠️ Token expired or invalid. Attempting refresh...");
      const refreshed = await refreshAccessToken(req);
      
      if (refreshed) {
        // Token refreshed successfully, retry the dashboard load
        return res.redirect("/dashboard"); 
      } else {
        // Refresh failed (e.g., 400 Bad Request), force re-login
        return res.redirect("/"); 
      }
    }

    // 4. Log and Display ANY other dashboard error
    logAxiosError("DASHBOARD MOWER FETCH FAILURE", err);
    res.send(`
      <h2>Dashboard Error</h2>
      <p>Could not fetch mower data. Check logs for details.</p>
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
          "Content-Type": "application/vnd.api+json",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    logAxiosError("START ACTION FAILURE", err);
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
          "Content-Type": "application/vnd.api+json",
          "X-Api-Key": CLIENT_ID,
        },
      }
    );
    res.redirect("/dashboard");
  } catch (err) {
    logAxiosError("PARK ACTION FAILURE", err);
    res.send(`<p>Failed to park mower:</p><pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>`);
  }
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
