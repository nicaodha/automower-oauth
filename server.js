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
app.set("trust proxy", 1); 
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "automower_simple_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { 
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 
    }, 
  })
);

// Helper function to fetch mower status
async function fetchMowerStatus(accessToken) {
    try {
        const mowerResponse = await axios.get("https://api.amc.husqvarnagroup.dev/v1/mowers", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Authorization-Provider": "husqvarna",
                "X-Api-Key": CLIENT_ID,
            },
        });

        // Husqvarna uses JSON:API format: data is nested under .data.data
        const mowers = mowerResponse.data.data;
        if (!Array.isArray(mowers) || mowers.length === 0) {
            return { error: "No mowers linked to your account." };
        }

        const mower = mowers[0];
        const name = mower.attributes?.system?.name || "Unknown Mower";
        const activity = mower.attributes?.mower?.activity || "Unknown";
        const battery = mower.attributes?.battery?.batteryPercent ?? "N/A";

        return { 
            status: "SUCCESS", 
            name, 
            activity, 
            battery 
        };
    } catch (err) {
        // Log the error in the server console for debugging
        console.error("Mower status fetch failed:", err.response?.data || err.message);
        
        // Return a readable error message for the front end
        const status = err.response?.status;
        const errorData = err.response?.data?.errors?.[0]?.title || err.message;
        
        return { 
            error: `API Call Failed (${status || 'N/A'}): ${errorData}` 
        };
    }
}

// ========== ROUTES ==========

// Landing page
app.get("/", (req, res) => {
  res.send(`
    <h2>Automower Connect Status Check</h2>
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

// OAuth2 Callback - The Token Receiver
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No code received. Authorization was likely denied.");

  let accessToken;

  // 1. Exchange Code for Tokens
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

    accessToken = response.data.access_token;
    const { refresh_token, expires_in, token_type } = response.data;
    
    // Store tokens in session (though we won't use them much here)
    req.session.access_token = accessToken;
    req.session.refresh_token = refresh_token;

    // 2. Fetch Mower Status using the new Access Token
    const mower = await fetchMowerStatus(accessToken);
    let mowerStatusHtml;

    if (mower.error) {
        mowerStatusHtml = `<p style="color: red;">❌ **Mower Status Check Failed:** ${mower.error}</p>`;
    } else {
        mowerStatusHtml = `
            <h3>✅ Mower Status (API Check Successful)</h3>
            <p><strong>Mower Name:</strong> ${mower.name}</p>
            <p><strong>Activity:</strong> ${mower.activity}</p>
            <p><strong>Battery Level:</strong> ${mower.battery}%</p>
        `;
    }

    // 3. Render Confirmation Page
    res.send(`
      <h2>✅ Success! Tokens Received</h2>
      <p>This confirms your OAuth flow, client ID, client secret, and redirect URI are correct.</p>
      
      <p><strong>Token Status:</strong> Access Token received (expires in ${expires_in} seconds).</p>
      
      <hr/>
      ${mowerStatusHtml}
      <hr/>
      <a href="/">Start Over</a>
    `);

  } catch (err) {
    console.error("Token exchange error:", err.response?.data || err.message);
    res.send(`
      <h3>❌ Token Exchange Error</h3>
      <p>Could not get tokens. Check logs for details.</p>
      <pre>${JSON.stringify(err.response?.data || err.message, null, 2)}</pre>
    `);
  }
});


// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
