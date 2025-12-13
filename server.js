require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.get("/", (req, res) => {
  res.send(\`
    <h2>Automower Connect OAuth Demo</h2>
    <a href="/login">Login with Automower Connect</a>
  \`);
});

app.get("/login", (req, res) => {
  const authUrl = \`https://api.authentication.husqvarnagroup.dev/v1/oauth2/authorize?client_id=\${CLIENT_ID}&redirect_uri=\${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=AM.CLOUD\`;
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

    const { access_token, refresh_token } = response.data;

    res.send(\`
      <h3>OAuth Token Received</h3>
      <p><strong>Access Token:</strong> \${access_token}</p>
      <p><strong>Refresh Token:</strong> \${refresh_token}</p>
      <p>Save these securely!</p>
    \`);
  } catch (err) {
    res.send(\`<p>Error fetching token: \${err.message}</p>\`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`Running on \${PORT}\`));