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

// Helper function to log detailed Axios errors
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

// ========== ROUTES ==========

// Landing page
app.get("/", (req, res) => {
  res.send(`
    <h2>Automower Connect Token Test</h2>
    <a href="/login">Login with Automower Connect to test</a>
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

    const { access_token, refresh_token, expires_in, token_type } = response.data;

    res.send(`
      <h2>✅ Success! Tokens Received from Husqvarna</h2>
      <p>This confirms your OAuth flow, client ID, client secret, and redirect URI are correct.</p>
      
      <p><strong>Access Token (Session):</strong> The Access Token is now stored in your server session.</p>
      <pre>
        Token Type: ${token_type}
        Expires In: ${expires_in} seconds
        Access Token: ${access_token.substring(0, 10)}... (truncated)
      </pre>

      <p><strong>Refresh Token:</strong></p>
      <pre>
        Refresh Token: ${refresh_token.substring(0, 10)}... (truncated)
      </pre>
      
      <hr/>
      <a href="/">Start Over</a>
    `);

  } catch (err) {
    // Log detailed error to the console
    logAxiosError("TOKEN EXCHANGE FAILURE", err);

    // Display error details to the user
    const status = err.response?.status;
    const data = err.response?.data;
    const message = err.message;
    
    res.send(`
      <h3>❌ Token Exchange Error (HTTP Status: ${status || 'N/A'})</h3>
      <p>This usually means your <strong>CLIENT_ID</strong> or <strong>CLIENT_SECRET</strong> is incorrect in your environment.</p>
      <p>Message: ${message}</p>
      <pre>Response Data:\n${JSON.stringify(data || {}, null, 2)}</pre>
    `);
  }
});


// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
